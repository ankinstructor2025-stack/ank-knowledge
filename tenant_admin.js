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
  location.href =
    `./tenant_admin.html?tenant_id=${encodeURIComponent(tenantId)}` +
    `&account_id=${encodeURIComponent(accountId)}` +
    `&tab=${encodeURIComponent(next)}`;
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

function yen(n) {
  if (n == null || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("ja-JP") + "円";
}

function clampNote(s) {
  const t = (s ?? "").trim();
  return t.length <= 400 ? t : t.slice(0, 400);
}

function normalizePricing(p) {
  const currency = (p?.currency || "JPY").toString();
  const plansRaw = Array.isArray(p?.plans) ? p.plans : [];
  const notes = p?.notes || {};

  const plans = plansRaw
    .map(x => ({
      plan_id: String(x.plan_id || ""),
      label: String(x.label || ""),
      seat_limit: Number(x.seat_limit),
      knowledge_count: Number(x.knowledge_count),
      monthly_price: Number(x.monthly_price),
    }))
    .filter(x =>
      x.plan_id &&
      Number.isFinite(x.seat_limit) &&
      Number.isFinite(x.knowledge_count) &&
      Number.isFinite(x.monthly_price)
    );

  return { currency, notes, plans };
}

function fillSelectsFromPlans(pricing) {
  // ここで必ず埋める（未選択プレースホルダ付き）
  seatSel.innerHTML = "";
  knowSel.innerHTML = "";

  const seatOpt0 = document.createElement("option");
  seatOpt0.value = "";
  seatOpt0.textContent = "選択してください";
  seatSel.appendChild(seatOpt0);

  const knowOpt0 = document.createElement("option");
  knowOpt0.value = "";
  knowOpt0.textContent = "選択してください";
  knowSel.appendChild(knowOpt0);

  const seats = Array.from(new Set(pricing.plans.map(p => p.seat_limit))).sort((a,b) => a-b);
  const knows = Array.from(new Set(pricing.plans.map(p => p.knowledge_count))).sort((a,b) => a-b);

  for (const s of seats) {
    const opt = document.createElement("option");
    opt.value = String(s);
    opt.textContent = `${s}人まで`;
    seatSel.appendChild(opt);
  }
  for (const k of knows) {
    const opt = document.createElement("option");
    opt.value = String(k);
    opt.textContent = String(k);
    knowSel.appendChild(opt);
  }

  seatSel.disabled = false;
  knowSel.disabled = false;
}

function findPlan(pricing, seatLimit, knowledgeCount) {
  return pricing.plans.find(p =>
    p.seat_limit === Number(seatLimit) &&
    p.knowledge_count === Number(knowledgeCount)
  ) || null;
}

function renderEstimate(pricing) {
  const seatRaw = seatSel.value || "";
  const knowRaw = knowSel.value || "";

  if (!seatRaw || !knowRaw) {
    kpiBase.textContent = "-";
    kpiMonthly.textContent = "-";
    btnSave.disabled = true;
    setStatus("", "");
    return;
  }

  const plan = findPlan(pricing, Number(seatRaw), Number(knowRaw));
  if (!plan) {
    kpiBase.textContent = "-";
    kpiMonthly.textContent = "-";
    btnSave.disabled = true;
    setStatus("選択した組み合わせに一致するプランがありません。", "err");
    return;
  }

  setStatus(`選択プラン: ${plan.plan_id}（${plan.label}）`, "ok");
  kpiBase.textContent = yen(plan.monthly_price);
  kpiMonthly.textContent = yen(plan.monthly_price);
  btnSave.disabled = false;
}

async function loadTenant(currentUser) {
  return await apiFetch(
    currentUser,
    `/v1/tenant?tenant_id=${encodeURIComponent(tenantId)}&account_id=${encodeURIComponent(accountId)}`,
    { method: "GET" }
  );
}

async function saveContract(currentUser, pricing) {
  btnSave.disabled = true;
  try {
    const tenant = await loadTenant(currentUser);
    if (tenant?.payment_method_configured) {
      throw new Error("支払い設定が完了しているため、契約は変更できません。");
    }

    const seatRaw = seatSel.value || "";
    const knowRaw = knowSel.value || "";
    if (!seatRaw || !knowRaw) throw new Error("人数とナレッジ数を選択してください。");

    const plan = findPlan(pricing, Number(seatRaw), Number(knowRaw));
    if (!plan) throw new Error("プランが確定できません（組み合わせが一致しません）。");

    const note = clampNote(noteEl.value || "");

    await apiFetch(currentUser, "/v1/tenant/contract", {
      method: "POST",
      body: {
        account_id: accountId,
        tenant_id: tenantId,
        plan_id: plan.plan_id,
        seat_limit: plan.seat_limit,
        knowledge_count: plan.knowledge_count,
        monthly_amount_yen: plan.monthly_price,
        note
      }
    });

    setStatus("保存しました（DB作成も実行されます）。", "ok");

  } catch (e) {
    console.error(e);
    setStatus(e?.message || String(e), "err");
  } finally {
    btnSave.disabled = false;
  }
}

async function markPaid(currentUser) {
  btnPayDummy.disabled = true;
  try {
    await apiFetch(currentUser, "/v1/tenant/mark-paid", {
      method: "POST",
      body: { account_id: accountId, tenant_id: tenantId }
    });
    setStatus("支払い設定完了（仮）にしました。以後、契約は変更不可です。", "ok");
  } catch (e) {
    console.error(e);
    setStatus(e?.message || String(e), "err");
  } finally {
    btnPayDummy.disabled = false;
  }
}

(async function boot() {
  const currentUser = await requireUser(auth, { loginUrl: "./login.html" });

  metaLine.textContent = `tenant_id=${tenantId} / account_id=${accountId} / tab=${tab}`;
  showPanel(tab);

  if (tab !== "contract") return;

  // ★ pricing 取得（失敗したら理由を表示）
  let pricingRaw;
  try {
    pricingRaw = await apiFetch(currentUser, "/v1/pricing", { method: "GET" });
  } catch (e) {
    setStatus("pricing取得に失敗: " + (e?.message || String(e)), "err");
    return;
  }

  const pricing = normalizePricing(pricingRaw);

  // ★ ここで plans が空なら、その内容を表示（原因切り分け）
  if (!pricing.plans.length) {
    setStatus("pricing.plans が空です: " + JSON.stringify(pricingRaw), "err");
    return;
  }

  fillSelectsFromPlans(pricing);

  // 既存の tenant 設定があれば選択状態を復元
  try {
    const t = await loadTenant(currentUser);
    if (t?.seat_limit != null) seatSel.value = String(t.seat_limit);
    if (t?.knowledge_count != null) knowSel.value = String(t.knowledge_count);
    if (t?.note) noteEl.value = t.note;
  } catch (e) {
    // tenant取得失敗は表示して止める（価格選択の前提なので）
    setStatus("tenant取得に失敗: " + (e?.message || String(e)), "err");
    return;
  }

  renderEstimate(pricing);
  seatSel.addEventListener("change", () => renderEstimate(pricing));
  knowSel.addEventListener("change", () => renderEstimate(pricing));

  btnSave.addEventListener("click", () => saveContract(currentUser, pricing));
  btnPayDummy.addEventListener("click", () => markPaid(currentUser));
})();
