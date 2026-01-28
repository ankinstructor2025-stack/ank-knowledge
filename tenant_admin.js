import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

const { auth } = initFirebase();

const qs = new URLSearchParams(location.search);
const tenantId = (qs.get("tenant_id") || "").trim();
const accountId = (qs.get("account_id") || "").trim();
const tab = (qs.get("tab") || "contract").trim();

const metaLine = document.getElementById("metaLine");
const backBtn = document.getElementById("backBtn");

const tabContract = document.getElementById("tabContract");
const tabUsers = document.getElementById("tabUsers");
const tabKnowledge = document.getElementById("tabKnowledge");

const panelContract = document.getElementById("panelContract");
const panelUsers = document.getElementById("panelUsers");
const panelKnowledge = document.getElementById("panelKnowledge");

const seatSel = document.getElementById("seatLimitSelect");
const knowSel = document.getElementById("knowledgeCountSelect");
const noteEl = document.getElementById("note");

const kpiBase = document.getElementById("kpiBase");
const kpiExtra = document.getElementById("kpiExtra");
const kpiMonthly = document.getElementById("kpiMonthly");

const btnSave = document.getElementById("btnSave");
const btnPayDummy = document.getElementById("btnPayDummy");
const statusEl = document.getElementById("status");

function showPanel(name) {
  panelContract.style.display = (name === "contract") ? "" : "none";
  panelUsers.style.display = (name === "users") ? "" : "none";
  panelKnowledge.style.display = (name === "knowledge") ? "" : "none";
}

function goTab(next) {
  location.href = `./tenant_admin.html?tenant_id=${encodeURIComponent(tenantId)}&account_id=${encodeURIComponent(accountId)}&tab=${encodeURIComponent(next)}`;
}

tabContract.onclick = () => goTab("contract");
tabUsers.onclick = () => goTab("users");
tabKnowledge.onclick = () => goTab("knowledge");

backBtn.onclick = () => {
  location.href = `./tenants.html?account_id=${encodeURIComponent(accountId)}`;
};

function setStatus(msg, type = "") {
  statusEl.className = "status " + (type || "");
  statusEl.textContent = msg || "";
  statusEl.style.display = msg ? "block" : "none";
}

function yen(n, currency = "JPY") {
  if (n == null || Number.isNaN(Number(n))) return "-";
  if (currency === "JPY") return Number(n).toLocaleString("ja-JP") + "円";
  return String(n);
}

function clampNote(s) {
  const t = (s ?? "").trim();
  return t.length <= 400 ? t : t.slice(0, 400);
}

let pricing = null;   // {currency, plans[], notes}
let tenant = null;

function normalizePricing(p) {
  const currency = (p?.currency || "JPY").toString();
  const notes = p?.notes || {};
  const plans = Array.isArray(p?.plans) ? p.plans : [];
  const normPlans = plans
    .map(x => ({
      plan_id: (x.plan_id || "").toString(),
      label: (x.label || "").toString(),
      seat_limit: Number(x.seat_limit),
      knowledge_count: Number(x.knowledge_count),
      monthly_price: Number(x.monthly_price),
    }))
    .filter(x => x.plan_id && Number.isFinite(x.seat_limit) && Number.isFinite(x.knowledge_count) && Number.isFinite(x.monthly_price))
    .sort((a,b) => a.monthly_price - b.monthly_price);

  return { currency, notes, plans: normPlans };
}

function uniqueSorted(nums) {
  return Array.from(new Set(nums)).sort((a,b) => a-b);
}

function fillOptionsFromPlans() {
  const seats = uniqueSorted(pricing.plans.map(p => p.seat_limit));
  const knows = uniqueSorted(pricing.plans.map(p => p.knowledge_count));

  seatSel.innerHTML = "";
  for (const s of seats) {
    const opt = document.createElement("option");
    opt.value = String(s);
    opt.textContent = `${s}人まで`;
    seatSel.appendChild(opt);
  }
  seatSel.disabled = false;

  knowSel.innerHTML = "";
  for (const k of knows) {
    const opt = document.createElement("option");
    opt.value = String(k);
    opt.textContent = String(k);
    knowSel.appendChild(opt);
  }
  knowSel.disabled = false;
}

function findPlan(seatLimit, knowledgeCount) {
  return pricing.plans.find(p =>
    p.seat_limit === Number(seatLimit) &&
    p.knowledge_count === Number(knowledgeCount)
  ) || null;
}

function renderEstimate() {
  const seatLimit = Number(seatSel.value || 0);
  const knowledgeCount = Number(knowSel.value || 0);

  const plan = findPlan(seatLimit, knowledgeCount);
  if (!plan) {
    kpiBase.textContent = "-";
    kpiMonthly.textContent = "-";
    btnSave.disabled = true;
    setStatus("選択した組み合わせに一致するプランがありません。", "err");
    return;
  }

  setStatus("", "");
  kpiBase.textContent = yen(plan.monthly_price, pricing.currency);
  kpiMonthly.textContent = yen(plan.monthly_price, pricing.currency);
  btnSave.disabled = false;
}

async function loadTenant(currentUser) {
  const res = await apiFetch(currentUser, `/v1/tenant?tenant_id=${encodeURIComponent(tenantId)}&account_id=${encodeURIComponent(accountId)}`, { method: "GET" });
  return res;
}

async function saveContract(currentUser) {
  setStatus("", "");
  btnSave.disabled = true;

  try {
    tenant = await loadTenant(currentUser);

    // 支払い後は保存不可（バックでも弾くが、UIでも先に止める）
    if (tenant?.payment_method_configured) {
      throw new Error("支払い設定が完了しているため、契約は変更できません。");
    }

    const seat_limit = Number(seatSel.value);
    const knowledge_count = Number(knowSel.value);
    const note = clampNote(noteEl.value || "");

    const plan = findPlan(seat_limit, knowledge_count);
    if (!plan) throw new Error("プランが確定できません（組み合わせが一致しません）。");

    const monthly_amount_yen = plan.monthly_price;

    await apiFetch(currentUser, "/v1/tenant/contract", {
      method: "POST",
      body: {
        account_id: accountId,
        tenant_id: tenantId,
        plan_id: plan.plan_id,
        seat_limit,
        knowledge_count,
        monthly_amount_yen,
        note,
      }
    });

    setStatus("保存しました（DBも生成されます）。", "ok");
    tenant = await loadTenant(currentUser);

  } catch (e) {
    console.error(e);
    setStatus(e?.message || String(e), "err");
  } finally {
    btnSave.disabled = false;
  }
}

async function markPaid(currentUser) {
  setStatus("", "");
  btnPayDummy.disabled = true;

  try {
    await apiFetch(currentUser, "/v1/tenant/mark-paid", {
      method: "POST",
      body: { account_id: accountId, tenant_id: tenantId }
    });
    setStatus("支払い設定完了（仮）にしました。以後、契約は変更不可です。", "ok");
    tenant = await loadTenant(currentUser);

  } catch (e) {
    console.error(e);
    setStatus(e?.message || String(e), "err");
  } finally {
    btnPayDummy.disabled = false;
  }
}

(async function boot() {
  const currentUser = await requireUser(auth, { loginUrl: "./login.html" });

  if (!tenantId || !accountId) {
    setStatus("URLに tenant_id / account_id がありません。", "err");
    return;
  }

  metaLine.innerHTML = `tenant_id=<code>${escapeHtml(tenantId)}</code> / account_id=<code>${escapeHtml(accountId)}</code> / tab=<code>${escapeHtml(tab)}</code>`;
  showPanel(tab);

  if (tab !== "contract") return;

  // pricing（settings/pricing.json を返す想定）
  pricing = normalizePricing(await apiFetch(currentUser, "/v1/pricing", { method: "GET" }));
  fillOptionsFromPlans();

  tenant = await loadTenant(currentUser);

  if (tenant?.seat_limit != null) seatSel.value = String(tenant.seat_limit);
  if (tenant?.knowledge_count != null) knowSel.value = String(tenant.knowledge_count);
  if (tenant?.note) noteEl.value = tenant.note;

  renderEstimate();
  seatSel.addEventListener("change", renderEstimate);
  knowSel.addEventListener("change", renderEstimate);

  btnSave.addEventListener("click", () => saveContract(currentUser));
  btnPayDummy.addEventListener("click", () => markPaid(currentUser));
})();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
