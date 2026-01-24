import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

const { auth } = initFirebase();

const contractIdEl = document.getElementById("contractId");
const seatSel = document.getElementById("seatLimitSelect");
const knowSel = document.getElementById("knowledgeCountSelect");
const noteEl = document.getElementById("note");

const kpiBase = document.getElementById("kpiBase");
const kpiExtra = document.getElementById("kpiExtra");
const kpiMonthly = document.getElementById("kpiMonthly");

const backBtn = document.getElementById("backBtn");
const saveBtn = document.getElementById("saveBtn");
const paymentBtn = document.getElementById("paymentBtn");

const statusEl = document.getElementById("status");

function getContractId() {
  const u = new URL(location.href);
  return u.searchParams.get("contract_id");
}
function yen(n) {
  if (n == null || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("ja-JP") + "円";
}
function setStatus(msg, type = "") {
  statusEl.style.display = "block";
  statusEl.className = "status " + type;
  statusEl.textContent = msg;
}
function clearStatus() {
  statusEl.style.display = "none";
  statusEl.textContent = "";
  statusEl.className = "status";
}
function clampNote(s) {
  const t = (s ?? "").trim();
  return t.length <= 400 ? t : t.slice(0, 400);
}

let pricing = null;

function normalizePricing(p) {
  return {
    seats: Array.isArray(p?.seats) ? p.seats : [],
    knowledge_count: Array.isArray(p?.knowledge_count) ? p.knowledge_count : [],
  };
}

function getBaseFee(seatLimit) {
  const seats = pricing.seats
    .map((x) => ({ seat_limit: Number(x.seat_limit), monthly_fee: x.monthly_fee }))
    .filter((x) => Number.isFinite(x.seat_limit))
    .sort((a, b) => a.seat_limit - b.seat_limit);

  const hit = seats.find((r) => r.seat_limit === Number(seatLimit));
  return hit ? hit.monthly_fee : null; // NULL=要相談
}

function getKnowledgeFee(knowledgeCount) {
  const krows = pricing.knowledge_count
    .map((x) => ({ value: Number(x.value), monthly_price: Number(x.monthly_price ?? 0) }))
    .filter((x) => Number.isFinite(x.value))
    .sort((a, b) => a.value - b.value);

  const hit = krows.find((k) => k.value === Number(knowledgeCount));
  return hit ? hit.monthly_price : null;
}

function computeMonthlyAmountYen() {
  const seatLimit = Number(seatSel.value || 0);
  const knowledgeCount = Number(knowSel.value || 0);

  const base = getBaseFee(seatLimit);
  const extra = getKnowledgeFee(knowledgeCount);
  if (base == null || extra == null) return null;
  return Number(base) + Number(extra);
}

function renderEstimate() {
  const seatLimit = Number(seatSel.value || 0);
  const knowledgeCount = Number(knowSel.value || 0);

  const base = getBaseFee(seatLimit);
  const extra = getKnowledgeFee(knowledgeCount);
  const total = computeMonthlyAmountYen();

  kpiBase.textContent = base == null ? "-" : yen(base);
  kpiExtra.textContent = extra == null ? "-" : yen(extra);
  kpiMonthly.textContent = total == null ? "-" : yen(total);

  // 金額が確定できる場合のみ更新可能
  saveBtn.disabled = (total == null);
}

function fillSelects() {
  const seats = pricing.seats
    .map((x) => ({ seat_limit: Number(x.seat_limit), monthly_fee: x.monthly_fee, label: x.label || "" }))
    .filter((x) => Number.isFinite(x.seat_limit))
    .sort((a, b) => a.seat_limit - b.seat_limit);

  seatSel.innerHTML = "";
  for (const r of seats) {
    const opt = document.createElement("option");
    opt.value = String(r.seat_limit);
    opt.textContent =
      (r.monthly_fee == null) ? (r.label || `${r.seat_limit}人以上（要相談）`) : `${r.seat_limit}人まで`;
    seatSel.appendChild(opt);
  }
  seatSel.disabled = false;

  const krows = pricing.knowledge_count
    .map((x) => ({ value: Number(x.value), label: x.label || `${x.value}` }))
    .filter((x) => Number.isFinite(x.value))
    .sort((a, b) => a.value - b.value);

  knowSel.innerHTML = "";
  for (const k of krows) {
    const opt = document.createElement("option");
    opt.value = String(k.value);
    opt.textContent = k.label;
    knowSel.appendChild(opt);
  }
  knowSel.disabled = false;
}

async function loadCurrentContractFromList(currentUser, contractId) {
  const list = await apiFetch(currentUser, "/v1/contracts");
  const hit = (list || []).find((x) => x.contract_id === contractId);
  if (!hit) throw new Error("契約が見つかりません。");
  return hit;
}

// ✅ 追加：支払い設定を「完了扱い」にする
async function markPaymentConfigured(currentUser, contractId) {
  // サーバ側で payment_method_configured = true / start_at を確定する想定
  return await apiFetch(currentUser, "/v1/contracts/mark-paid", {
    method: "POST",
    body: { contract_id: contractId },
  });
}

(async function boot() {
  const currentUser = await requireUser(auth, { loginUrl: "./login.html" });

  const contractId = getContractId();
  if (!contractId) {
    alert("contract_id がありません。");
    location.href = "./contracts.html";
    return;
  }
  contractIdEl.textContent = contractId;

  backBtn.addEventListener("click", () => location.href = "./contracts.html");

  // pricing を読む → セレクト構築
  const p = await apiFetch(currentUser, "/v1/pricing", { method: "GET" });
  pricing = normalizePricing(p);
  fillSelects();

  // 現在の契約値を読み込む（一覧から拾う）
  const c = await loadCurrentContractFromList(currentUser, contractId);

  // 初期値セット
  if (c.seat_limit != null) seatSel.value = String(c.seat_limit);
  if (c.knowledge_count != null) knowSel.value = String(c.knowledge_count);
  noteEl.value = c.note || "";

  renderEstimate();

  seatSel.addEventListener("change", renderEstimate);
  knowSel.addEventListener("change", renderEstimate);

  // ✅ 「支払い設定へ」＝完了扱い
  paymentBtn.addEventListener("click", async () => {
    clearStatus();
    paymentBtn.disabled = true;

    try {
      setStatus("支払い設定を完了しました（仮）。", "ok");
      await markPaymentConfigured(currentUser, contractId);

      // 一覧へ戻す
      setTimeout(() => location.href = "./contracts.html", 350);
    } catch (e) {
      console.error(e);
      setStatus(`支払い設定（仮）に失敗しました:\n${e.message}`, "error");
      paymentBtn.disabled = false;
    }
  });

  saveBtn.addEventListener("click", async () => {
    clearStatus();
    saveBtn.disabled = true;

    try {
      const monthly_amount_yen = computeMonthlyAmountYen();
      if (monthly_amount_yen == null) throw new Error("金額が確定できません（要相談のプランの可能性があります）。");

      await apiFetch(currentUser, "/v1/contracts/update", {
        method: "POST",
        body: {
          contract_id: contractId,
          seat_limit: Number(seatSel.value),
          knowledge_count: Number(knowSel.value),
          monthly_amount_yen,
          note: clampNote(noteEl.value),
        },
      });

      setStatus("更新しました。", "ok");
      setTimeout(() => location.href = "./contracts.html", 350);
    } catch (e) {
      console.error(e);
      setStatus(`更新に失敗しました:\n${e.message}`, "error");
      saveBtn.disabled = false;
    }
  });
})();
