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
const kpiExtra = document.getElementById("kpiExtra"); // ★HTML側にあるので合わせる
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

/**
 * pricing は「旧形式」を正とする:
 * {
 *   currency: "JPY",
 *   seats: [{seat_limit, monthly_fee, label}],
 *   knowledge_count: [{value, monthly_price, label}],
 *   notes: {...}
 * }
 *
 * ただし、現状は「新形式」も受ける:
 * {
 *   currency: "JPY",
 *   seats: [5,10,30],
 *   knowledge_count: [1,2,3,4,5],
 *   knowledge_add_price: 50000,
 *   ...
 * }
 */
function normalizePricing(p) {
  const currency = (p?.currency || "JPY").toString();
  const notes = p?.notes || {};

  // --- seats ---
  let seats = [];
  if (Array.isArray(p?.seats) && p.seats.length > 0) {
    const first = p.seats[0];

    if (typeof first === "number") {
      // 新形式: [5,10,30]
      seats = p.seats
        .map(v => ({
          seat_limit: Number(v),
          monthly_fee: 0,
          label: ""
        }))
        .filter(x => Number.isFinite(x.seat_limit))
        .sort((a, b) => a.seat_limit - b.seat_limit);
    } else {
      // 旧形式: [{seat_limit, monthly_fee, label}]
      seats = p.seats
        .map(x => ({
          seat_limit: Number(x?.seat_limit),
          monthly_fee: Number(x?.monthly_fee),
          label: String(x?.label || "")
        }))
        .filter(x => Number.isFinite(x.seat_limit) && Number.isFinite(x.monthly_fee))
        .sort((a, b) => a.seat_limit - b.seat_limit);
    }
  }

  // --- knowledge_count ---
  let knowledge_count = [];
  if (Array.isArray(p?.knowledge_count) && p.knowledge_count.length > 0) {
    const first = p.knowledge_count[0];

    if (typeof first === "number") {
      // 新形式: [1,2,3,4,5]
      const add = Number(p?.knowledge_add_price || 0);

      knowledge_count = p.knowledge_count
        .map(v => {
          const vv = Number(v);
          const monthly_price = (vv > 1 && Number.isFinite(add)) ? (vv - 1) * add : 0;
          return {
            value: vv,
            monthly_price,
            label: String(vv)
          };
        })
        .filter(x => Number.isFinite(x.value) && Number.isFinite(x.monthly_price))
        .sort((a, b) => a.value - b.value);
    } else {
      // 旧形式: [{value, monthly_price, label}]
      knowledge_count = p.knowledge_count
        .map(x => ({
          value: Number(x?.value),
          monthly_price: Number(x?.monthly_price || 0),
          label: String(x?.label || x?.value || "")
        }))
        .filter(x => Number.isFinite(x.value) && Number.isFinite(x.monthly_price))
        .sort((a, b) => a.value - b.value);
    }
  }

  // 旧コード互換のため plans も用意（内部用）
  const plans = [];
  for (const s of seats) {
    for (const k of knowledge_count) {
      plans.push({
        plan_id: `seat${s.seat_limit}_kc${k.value}`,
        label: s.label || "",
        seat_limit: s.seat_limit,
        knowledge_count: k.value,
        monthly_price: (Number(s.monthly_fee) || 0) + (Number(k.monthly_price) || 0),
        base_fee: Number(s.monthly_fee) || 0,
        extra_fee: Number(k.monthly_price) || 0,
      });
    }
  }

  return { currency, notes, seats, knowledge_count, plans };
}

// 旧名のまま。中身は seats / knowledge_count を使う
function fillSelectsFromPlans(pricing) {
  seatSel.innerHTML = "";
  knowSel.innerHTML = "";

  seatSel.appendChild(new Option("選択してください", ""));
  knowSel.appendChild(new Option("選択してください", ""));

  for (const s of pricing.seats) {
    seatSel.appendChild(new Option(`${s.seat_limit}人まで`, String(s.seat_limit)));
  }

  for (const k of pricing.knowledge_count) {
    const extra = (k.monthly_price > 0) ? `（+${yen(k.monthly_price)}）` : "（基本料金に含む）";
    const label = k.label ? `${k.label}${extra}` : `${k.value}${extra}`;
    knowSel.appendChild(new Option(label, String(k.value)));
  }

  seatSel.disabled = false;
  knowSel.disabled = false;
}

// 旧名のまま。内部は plans（＝ seats×knowledge で自動生成）から探す
function findPlan(pricing, seatLimit, knowledgeCount) {
  return pricing.plans.find(p =>
    p.seat_limit === Number(seatLimit) &&
    p.knowledge_count === Number(knowledgeCount)
  ) || null;
}

// 旧名のまま。monthly_price は base + extra の合算を表示
function renderEstimate(pricing) {
  const seatRaw = seatSel.value || "";
  const knowRaw = knowSel.value || "";

  if (!seatRaw || !knowRaw) {
    kpiBase.textContent = "-";
    if (kpiExtra) kpiExtra.textContent = "0円";
    kpiMonthly.textContent = "-";
    btnSave.disabled = true;
    setStatus("", "");
    return;
  }

  const plan = findPlan(pricing, Number(seatRaw), Number(knowRaw));
  if (!plan) {
    kpiBase.textContent = "-";
    if (kpiExtra) kpiExtra.textContent = "0円";
    kpiMonthly.textContent = "-";
    btnSave.disabled = true;
    setStatus("料金計算に失敗しました。", "err");
    return;
  }

  setStatus(
    `人数=${plan.seat_limit} / ナレッジ=${plan.knowledge_count} / 月額=${yen(plan.monthly_price)}`,
    "ok"
  );
  kpiBase.textContent = yen(plan.base_fee);
  if (kpiExtra) kpiExtra.textContent = yen(plan.extra_fee);
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
    if (!plan) throw new Error("料金が確定できません。");

    const note = clampNote(noteEl.value || "");

    await apiFetch(currentUser, "/v1/tenant/contract", {
      method: "POST",
      body: {
        account_id: accountId,
        tenant_id: tenantId,
        // plan_id はあってもなくても良い（tenant.jsonに保存したければ使う）
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

  let pricingRaw;
  try {
    pricingRaw = await apiFetch(currentUser, "/v1/pricing", { method: "GET" });
  } catch (e) {
    setStatus("pricing取得に失敗: " + (e?.message || String(e)), "err");
    return;
  }

  const pricing = normalizePricing(pricingRaw);

  // seats / knowledge_count が取れていない場合にだけ止める
  if (!pricing.seats.length || !pricing.knowledge_count.length) {
    setStatus("pricingの形式が不正です: " + JSON.stringify(pricingRaw), "err");
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
    setStatus("tenant取得に失敗: " + (e?.message || String(e)), "err");
    return;
  }

  renderEstimate(pricing);
  seatSel.addEventListener("change", () => renderEstimate(pricing));
  knowSel.addEventListener("change", () => renderEstimate(pricing));

  btnSave.addEventListener("click", () => saveContract(currentUser, pricing));
  btnPayDummy.addEventListener("click", () => markPaid(currentUser));
})();
