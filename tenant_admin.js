import { initFirebase } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const { auth } = initFirebase();

const params = new URLSearchParams(location.search);
const tenantId = params.get("tenant_id");
const accountId = params.get("account_id");
const initialTab = (params.get("tab") || "contract").toLowerCase();

const titleEl = document.getElementById("title");
const subEl = document.getElementById("sub");
const tenantIdEl = document.getElementById("tenantId");
const tenantNameEl = document.getElementById("tenantName");
const tenantStatusEl = document.getElementById("tenantStatus");
const contractStatusEl = document.getElementById("contractStatus");
const paymentStatusEl = document.getElementById("paymentStatus");

const seatSel = document.getElementById("seatLimitSelect");
const knowSel = document.getElementById("knowledgeCountSelect");
const noteEl = document.getElementById("note");

const kpiBase = document.getElementById("kpiBase");
const kpiExtra = document.getElementById("kpiExtra");
const kpiMonthly = document.getElementById("kpiMonthly");

const backBtn = document.getElementById("backBtn");
const saveBtn = document.getElementById("saveBtn");
const paymentBtn = document.getElementById("paymentBtn");

const btnSearch = document.getElementById("btnSearch");

const statusEl = document.getElementById("status");

const tabHint = document.getElementById("tabHint");
const tabContract = document.getElementById("tabContract");
const tabUsers = document.getElementById("tabUsers");
const tabKnowledge = document.getElementById("tabKnowledge");

const panelContract = document.getElementById("panelContract");
const panelUsers = document.getElementById("panelUsers");
const panelKnowledge = document.getElementById("panelKnowledge");

// Users/Knowledge 内のボタン（将来用）
const btnInvite = document.getElementById("btnInvite");
const btnMembersReload = document.getElementById("btnMembersReload");
const btnUpload = document.getElementById("btnUpload");
const btnBuild = document.getElementById("btnBuild");

let pricing = null;
let tenant = null;

function yen(n) {
  if (n == null || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("ja-JP") + "円";
}

function setStatus(msg, type = "") {
  if (!statusEl) return;
  statusEl.style.display = "block";
  statusEl.className = "status " + type;
  statusEl.textContent = msg;
}

function clearStatus() {
  if (!statusEl) return;
  statusEl.style.display = "none";
  statusEl.textContent = "";
  statusEl.className = "status";
}

function clampNote(s) {
  const t = (s ?? "").trim();
  return t.length <= 400 ? t : t.slice(0, 400);
}

function normalizePricing(p) {
  return {
    seats: Array.isArray(p?.seats) ? p.seats : [],
    knowledge_count: Array.isArray(p?.knowledge_count) ? p.knowledge_count : [],
  };
}

function fillSelects() {
  if (!seatSel || !knowSel) return;

  const seats = pricing.seats
    .map((x) => ({ seat_limit: Number(x.seat_limit), monthly_fee: x.monthly_fee, label: x.label || "" }))
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

  const krows = pricing.knowledge_count
    .map((x) => ({ value: Number(x.value), monthly_price: Number(x.monthly_price ?? 0), label: x.label || `${x.value}` }))
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
  if (!seatSel || !knowSel) return null;

  const seatLimit = Number(seatSel.value || 0);
  const knowledgeCount = Number(knowSel.value || 0);

  const base = getBaseFee(seatLimit);
  const extra = getKnowledgeFee(knowledgeCount);
  if (base == null || extra == null) return null;
  return Number(base) + Number(extra);
}

function renderEstimate() {
  const total = computeMonthlyAmountYen();

  const seatLimit = Number(seatSel?.value || 0);
  const knowledgeCount = Number(knowSel?.value || 0);

  const base = getBaseFee(seatLimit);
  const extra = getKnowledgeFee(knowledgeCount);

  if (kpiBase) kpiBase.textContent = base == null ? "-" : yen(base);
  if (kpiExtra) kpiExtra.textContent = extra == null ? "-" : yen(extra);
  if (kpiMonthly) kpiMonthly.textContent = total == null ? "-" : yen(total);

  if (saveBtn) saveBtn.disabled = (total == null);
}

function activateTab(name) {
  const key = ["contract", "users", "knowledge"].includes(name) ? name : "contract";

  const tabs = [
    { btn: tabContract, panel: panelContract, key: "contract" },
    { btn: tabUsers, panel: panelUsers, key: "users" },
    { btn: tabKnowledge, panel: panelKnowledge, key: "knowledge" },
  ];

  for (const t of tabs) {
    if (!t.btn || !t.panel) continue;
    const active = (t.key === key);
    t.btn.classList.toggle("active", active);
    t.btn.setAttribute("aria-selected", active ? "true" : "false");
    t.panel.classList.toggle("active", active);
  }
}

function applyTabPolicy() {
  const cs = tenant?.contract_status || "draft";
  const canManage = (cs === "active");

  if (tabUsers) tabUsers.setAttribute("aria-disabled", canManage ? "false" : "true");
  if (tabKnowledge) tabKnowledge.setAttribute("aria-disabled", canManage ? "false" : "true");

  if (btnInvite) btnInvite.disabled = !canManage;
  if (btnMembersReload) btnMembersReload.disabled = !canManage;
  if (btnUpload) btnUpload.disabled = !canManage;
  if (btnBuild) btnBuild.disabled = !canManage;

  if (tabHint) {
    tabHint.textContent = canManage
      ? ""
      : "契約が未確定です。契約タブで「契約を確定（保存）」を実行すると、ユーザー管理・ナレッジ管理が利用できます。";
  }

  // 契約未確定の状態で users/knowledge を開こうとしても、contract に戻す
  const selected = document.querySelector(".tab-btn.active")?.getAttribute("data-tab") || "contract";
  if (!canManage && (selected === "users" || selected === "knowledge")) {
    activateTab("contract");
  }
}

function applyTenantToUI() {
  if (tenantIdEl) tenantIdEl.textContent = tenant?.tenant_id || tenantId || "";
  if (tenantNameEl) tenantNameEl.textContent = tenant?.name || "(未設定)";
  if (tenantStatusEl) tenantStatusEl.textContent = tenant?.status || "active";

  const cs = tenant?.contract_status || "draft";
  if (contractStatusEl) contractStatusEl.textContent = cs;

  const paid = !!tenant?.payment_method_configured;
  if (paymentStatusEl) paymentStatusEl.textContent = paid ? "configured" : "not configured";

  if (titleEl) titleEl.textContent = tenant?.name ? `テナント管理：${tenant.name}` : "テナント管理";

  // QA検索は契約確定後に解放（今はこのボタンだけ）
  const canUse = (cs === "active");
  if (btnSearch) btnSearch.disabled = !canUse;

  applyTabPolicy();
}

async function loadTenant(currentUser) {
  const res = await apiFetch(
    currentUser,
    `/v1/tenant?tenant_id=${encodeURIComponent(tenantId)}&account_id=${encodeURIComponent(accountId || "")}`,
    { method: "GET" }
  );
  tenant = res;

  applyTenantToUI();

  // 既存値をフォームへ
  if (seatSel && tenant.seat_limit != null) seatSel.value = String(tenant.seat_limit);
  if (knowSel && tenant.knowledge_count != null) knowSel.value = String(tenant.knowledge_count);
  if (noteEl) noteEl.value = tenant.note || "";

  // 初期タブ（URLのtab）を適用（ただし契約未確定なら contract に寄せる）
  const canManage = ((tenant?.contract_status || "draft") === "active");
  if (!canManage && (initialTab === "users" || initialTab === "knowledge")) {
    activateTab("contract");
  } else {
    activateTab(initialTab);
  }
}

async function saveContract(currentUser) {
  clearStatus();
  if (saveBtn) saveBtn.disabled = true;

  try {
    const monthly_amount_yen = computeMonthlyAmountYen();
    if (monthly_amount_yen == null) throw new Error("金額が確定できません（要相談のプランの可能性があります）。");

    await apiFetch(currentUser, "/v1/tenant/contract", {
      method: "POST",
      body: {
        tenant_id: tenantId,
        account_id: accountId || "",
        seat_limit: Number(seatSel?.value),
        knowledge_count: Number(knowSel?.value),
        monthly_amount_yen,
        note: clampNote(noteEl?.value),
        contract_status: "active",
      },
    });

    setStatus("契約を確定しました。", "ok");
    await loadTenant(currentUser);
  } catch (e) {
    console.error(e);
    setStatus(`保存に失敗しました:\n${e.message}`, "error");
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function markPaid(currentUser) {
  clearStatus();
  if (paymentBtn) paymentBtn.disabled = true;

  try {
    await apiFetch(currentUser, "/v1/tenant/mark-paid", {
      method: "POST",
      body: {
        tenant_id: tenantId,
        account_id: accountId || "",
      },
    });
    setStatus("支払い設定を完了しました（仮）。", "ok");
    await loadTenant(currentUser);
  } catch (e) {
    console.error(e);
    setStatus(`支払い設定（仮）に失敗しました:\n${e.message}`, "error");
  } finally {
    if (paymentBtn) paymentBtn.disabled = false;
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("./login.html");
    return;
  }
  if (!tenantId) {
    if (subEl) subEl.textContent = "tenant_id がありません。";
    return;
  }

  if (subEl) subEl.textContent = `tenant_id=${tenantId}`;

  try {
    const p = await apiFetch(user, "/v1/pricing", { method: "GET" });
    pricing = normalizePricing(p);
    fillSelects();

    await loadTenant(user);

    renderEstimate();
    if (seatSel) seatSel.addEventListener("change", renderEstimate);
    if (knowSel) knowSel.addEventListener("change", renderEstimate);
  } catch (e) {
    console.error(e);
    if (subEl) subEl.textContent = e.message || String(e);
  }
});

// ===== handlers（全部 null ガード）
if (backBtn) {
  backBtn.addEventListener("click", () => {
    if (accountId) location.href = `./tenants.html?account_id=${encodeURIComponent(accountId)}`;
    else location.href = "./accounts.html";
  });
}

if (paymentBtn) {
  paymentBtn.addEventListener("click", async () => {
    if (!auth.currentUser) return;
    await markPaid(auth.currentUser);
  });
}

if (saveBtn) {
  saveBtn.addEventListener("click", async () => {
    if (!auth.currentUser) return;
    await saveContract(auth.currentUser);
  });
}

if (btnSearch) {
  btnSearch.addEventListener("click", () => {
    location.href = `./qa_search.html?tenant_id=${encodeURIComponent(tenantId)}`;
  });
}

if (tabContract) tabContract.addEventListener("click", () => activateTab("contract"));
if (tabUsers) {
  tabUsers.addEventListener("click", () => {
    if (tabUsers.getAttribute("aria-disabled") === "true") return;
    activateTab("users");
  });
}
if (tabKnowledge) {
  tabKnowledge.addEventListener("click", () => {
    if (tabKnowledge.getAttribute("aria-disabled") === "true") return;
    activateTab("knowledge");
  });
}
