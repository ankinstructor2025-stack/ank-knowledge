import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

const { auth } = initFirebase();

const seatSel = document.getElementById("seatLimitSelect");
const knowSel = document.getElementById("knowledgeCountSelect");
const noteEl = document.getElementById("note");

const createBtn = document.getElementById("createBtn");
const backBtn = document.getElementById("backBtn");
const statusEl = document.getElementById("status");
const whoamiEl = document.getElementById("whoami");

const kpiBase = document.getElementById("kpiBase");
const kpiExtra = document.getElementById("kpiExtra");
const kpiMonthly = document.getElementById("kpiMonthly");
const kpiSearchLimit = document.getElementById("kpiSearchLimit");

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
function yen(n) {
  if (n == null || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("ja-JP") + "円";
}
function clampNote(s) {
  const t = (s ?? "").trim();
  if (t.length <= 400) return t;
  return t.slice(0, 400);
}

let pricing = null;

function normalizePricing(p) {
  return {
    seats: Array.isArray(p?.seats) ? p.seats : [],
    knowledge_count: Array.isArray(p?.knowledge_count) ? p.knowledge_count : [],
    search_limit: p?.search_limit || { per_user_per_day: 0, note: "" },
  };
}

function fillSelectOptions() {
  // seats
  const seats = pricing.seats
    .map((x) => ({
      seat_limit: Number(x.seat_limit),
      monthly_fee: x.monthly_fee, // NULLなら「要相談」
      label: x.label || "",
    }))
    .filter((x) => Number.isFinite(x.seat_limit))
    .sort((a, b) => a.seat_limit - b.seat_limit);

  seatSel.innerHTML = "";
  for (const r of seats) {
    const opt = document.createElement("option");
    opt.value = String(r.seat_limit);
    opt.textContent = (r.monthly_fee == null)
      ? (r.label || `${r.seat_limit}人以上（要相談）`)
      : `${r.seat_limit}人まで`;
    seatSel.appendChild(opt);
  }
  seatSel.disabled = false;

  // knowledge_count
  const krows = pricing.knowledge_count
    .map((x) => ({
      value: Number(x.value),
      label: x.label || `${x.value}`,
      monthly_price: Number(x.monthly_price ?? 0),
    }))
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

  if (seatSel.options.length) seatSel.value = seatSel.options[0].value;
  if (knowSel.options.length) knowSel.value = knowSel.options[0].value;
}

function getBaseFee(seatLimit) {
  const seats = pricing.seats
    .map((x) => ({ seat_limit: Number(x.seat_limit), monthly_fee: x.monthly_fee }))
    .filter((x) => Number.isFinite(x.seat_limit))
    .sort((a, b) => a.seat_limit - b.seat_limit);

  const hit = seats.find((r) => r.seat_limit === Number(seatLimit));
  return hit ? hit.monthly_fee : null;
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
  if (!pricing) return null;

  const seatLimit = Number(seatSel.value || 0);
  const knowledgeCount = Number(knowSel.value || 0);

  const base = getBaseFee(seatLimit);
  const extra = getKnowledgeFee(knowledgeCount);

  // 要相談（NULL）や定義外は null（契約作成を無効）
  if (base == null || extra == null) return null;

  return Number(base) + Number(extra);
}

function renderEstimate() {
  if (!pricing) return;

  const seatLimit = Number(seatSel.value || 0);
  const knowledgeCount = Number(knowSel.value || 0);

  const base = getBaseFee(seatLimit);
  const extra = getKnowledgeFee(knowledgeCount);
  const total = computeMonthlyAmountYen();

  const perUser = Number(pricing.search_limit?.per_user_per_day ?? 0);
  const searchLimitPerDay = (seatLimit && perUser) ? seatLimit * perUser : null;

  kpiBase.textContent = base == null ? "-" : yen(base);
  kpiExtra.textContent = extra == null ? "-" : yen(extra);
  kpiMonthly.textContent = total == null ? "-" : yen(total);
  kpiSearchLimit.textContent = searchLimitPerDay == null ? "-" : `${searchLimitPerDay.toLocaleString("ja-JP")}回/日`;

  // 月額が算出できるときだけ作成可能
  createBtn.disabled = (total == null);
}

async function createContract(currentUser) {
  clearStatus();
  createBtn.disabled = true;

  try {
    const seat_limit = Number(seatSel.value);
    const knowledge_count = Number(knowSel.value);
    const monthly_amount_yen = computeMonthlyAmountYen();
    const note = clampNote(noteEl?.value || "");

    if (monthly_amount_yen == null) {
      throw new Error("金額が確定できません（要相談のプランの可能性があります）。");
    }

    await apiFetch(currentUser, "/v1/contract", {
      method: "POST",
      body: {
        user_id: currentUser.uid,
        email: currentUser.email,
        display_name: currentUser.displayName || "",
        seat_limit,
        knowledge_count,
        monthly_amount_yen,
        note,
      },
    });

    setStatus("契約を作成しました。一覧に戻ります。", "ok");
    setTimeout(() => {
      location.href = "./contracts.html";
    }, 400);
  } catch (e) {
    console.error(e);
    setStatus(`契約作成に失敗しました:\n${e.message}`, "error");
    createBtn.disabled = false;
  }
}

(async function boot() {
  const currentUser = await requireUser(auth, { loginUrl: "./login.html" });

  if (whoamiEl) whoamiEl.textContent = currentUser.email || "";

  backBtn.addEventListener("click", () => {
    location.href = "./contracts.html";
  });

  // pricing 読み込み → セレクト構築
  const p = await apiFetch(currentUser, "/v1/pricing", { method: "GET" });
  pricing = normalizePricing(p);

  fillSelectOptions();
  renderEstimate();

  seatSel.addEventListener("change", renderEstimate);
  knowSel.addEventListener("change", renderEstimate);

  createBtn.addEventListener("click", () => createContract(currentUser));
})();
