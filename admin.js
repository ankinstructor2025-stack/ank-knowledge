import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

/* Firebase */
const firebaseConfig = {
  apiKey: "AIzaSyBpHlwulq6lnbmBzNm0rEYNahWk7liD3BM",
  authDomain: "ank-project-77283.firebaseapp.com",
  projectId: "ank-project-77283",
  storageBucket: "ank-project-77283.firebasestorage.app",
  messagingSenderId: "707356972093",
  appId: "1:707356972093:web:03d20f1c1e5948150f8654"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

/**
 * ★ ank-admin-api のURL（末尾スラッシュなし）
 */
const API_BASE = "https://ank-admin-api-986862757498.asia-northeast1.run.app";

/**
 * tenant_id の保存キー
 * 契約開始（/contract/init）で発行された tenant_id をここに保存
 */
const TENANT_KEY = "ank_tenant_id";

// ===== DOM =====
const $ = (id) => document.getElementById(id);

const bannerEl = $("banner");
const contractBadge = $("contractBadge");
const statusBadge = $("statusBadge");
const roleBadge = $("roleBadge");
const userEmailEl = $("userEmail");

const tabContract = $("tab-contract");
const tabUsers = $("tab-users");
const panelContract = $("panel-contract");
const panelUsers = $("panel-users");

const logoutBtn = $("logoutBtn");
const refreshAllBtn = $("refreshAllBtn");

const contractIdEl = $("contractId");
const contractStatusEl = $("contractStatus");
const paymentMethodEl = $("paymentMethod");
const paidUntilEl = $("paidUntil");

const seatLimitSelect = $("seatLimitSelect");
const knowledgeCountSelect = $("knowledgeCountSelect");

const saveContractBtn = $("saveContractBtn");   // ★このボタンを「新規/更新」共通にする
const initContractBtn = $("initContractBtn");   // ★誤解を生むので隠す
const openBillingBtn = $("openBillingBtn");     // ★無くても動くようにする（今回修正）

const kpiMonthly = $("kpiMonthly");
const kpiBase = $("kpiBase");
const kpiExtra = $("kpiExtra");
const kpiSearchLimit = $("kpiSearchLimit");

const pricingSeatsTbody = $("pricingSeatsTbody");
const pricingKnowledge = $("pricingKnowledge");
const pricingSearchLimit = $("pricingSearchLimit");
const pricingPoc = $("pricingPoc");

const refreshUsersBtn = $("refreshUsersBtn");
const userOps = $("userOps");
const newUserEmail = $("newUserEmail");
const newUserRole = $("newUserRole");
const addUserBtn = $("addUserBtn");
const usersTbody = $("usersTbody");

// ===== State =====
let currentUser = null;
let pricing = null;    // pricing.json（正規化済み）
let contract = null;   // contract（契約済みなら object / 未契約なら null）
let users = [];
let myRole = "member";

// ===== UI helpers =====
function showBanner(kind, text) {
  bannerEl.hidden = false;
  bannerEl.className = "banner";
  if (kind === "warn") bannerEl.classList.add("warn");
  if (kind === "bad") bannerEl.classList.add("bad");
  bannerEl.textContent = text;
}
function hideBanner() {
  bannerEl.hidden = true;
  bannerEl.textContent = "";
}

function setActiveTab(tabName) {
  const isContract = tabName === "contract";
  tabContract.setAttribute("aria-selected", String(isContract));
  tabUsers.setAttribute("aria-selected", String(!isContract));
  panelContract.hidden = !isContract;
  panelUsers.hidden = isContract;
}
tabContract.addEventListener("click", () => setActiveTab("contract"));
tabUsers.addEventListener("click", () => setActiveTab("users"));

function yen(n) {
  if (n === null || n === undefined) return "-";
  if (typeof n !== "number" || Number.isNaN(n)) return "-";
  return n.toLocaleString("ja-JP") + "円";
}
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function fmtLastLogin(v) {
  if (!v) return "-";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString();
  } catch {
    return String(v);
  }
}

// ===== tenant_id =====
function getTenantId() {
  return localStorage.getItem(TENANT_KEY) || "";
}
function setTenantId(tid) {
  if (tid) localStorage.setItem(TENANT_KEY, tid);
}
function clearTenantId() {
  localStorage.removeItem(TENANT_KEY);
}

// ===== Billing redirect（今回追加）=====
function tryRedirectToBilling(reason = "") {
  const url = contract?.billing_url;
  if (!url) return false;

  // openBillingBtn がある場合は「自動遷移しない」運用にもできるが、
  // いまは “導線が失われない” を優先して、ボタンが無い場合に自動遷移する。
  if (!openBillingBtn) {
    console.log(`[billing] redirect (${reason}) -> ${url}`);
    location.href = url;
    return true;
  }

  // ボタンがある場合はボタン経由で遷移（従来通り）
  // ただし、UX上必要ならここを自動遷移に変えてもOK。
  return false;
}

// ===== API =====
async function apiFetch(path, { method = "GET", body = null } = {}) {
  if (!currentUser) throw new Error("not signed in");
  const token = await currentUser.getIdToken(true);

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return null;
}

async function apiFetchWithTenant(path, opts = {}) {
  const tid = getTenantId();
  if (!tid) throw new Error("tenant_id is missing (not contracted yet)");
  const sep = path.includes("?") ? "&" : "?";
  return apiFetch(`${path}${sep}tenant_id=${encodeURIComponent(tid)}`, opts);
}

// ===== Pricing =====
function normalizePricing(p) {
  const seats = Array.isArray(p?.seats) ? p.seats : [];
  const knowledge_count = Array.isArray(p?.knowledge_count) ? p.knowledge_count : [];
  const legacyKnowledge = p?.knowledge || { base_included: 1, extra_monthly_fee: 0 };

  return {
    seats,
    knowledge_count,
    knowledge: legacyKnowledge,
    search_limit: p?.search_limit || { per_user_per_day: 0, note: "" },
    poc: p?.poc || null
  };
}

function getBaseFeeFromPricing(seatLimit) {
  if (!pricing) return null;
  const rows = pricing.seats
    .map(x => ({ seat_limit: Number(x.seat_limit), monthly_fee: x.monthly_fee, label: x.label }))
    .filter(x => Number.isFinite(x.seat_limit))
    .sort((a, b) => a.seat_limit - b.seat_limit);

  const exact = rows.find(r => r.seat_limit === Number(seatLimit));
  if (exact) return exact.monthly_fee ?? null;

  for (const r of rows) {
    if (Number(seatLimit) <= r.seat_limit) return r.monthly_fee ?? null;
  }
  return null;
}

function getKnowledgeMonthlyPriceFromPricing(knowledgeCount) {
  if (pricing?.knowledge_count?.length) {
    const krows = pricing.knowledge_count
      .map(x => ({ value: Number(x.value), monthly_price: Number(x.monthly_price ?? 0), label: x.label }))
      .filter(x => Number.isFinite(x.value))
      .sort((a, b) => a.value - b.value);

    const hit = krows.find(x => x.value === Number(knowledgeCount));
    if (hit) return Number.isFinite(hit.monthly_price) ? hit.monthly_price : 0;
    return null;
  }

  const baseIncluded = Number(pricing?.knowledge?.base_included ?? 1);
  const extraUnit = Number(pricing?.knowledge?.extra_monthly_fee ?? 0);
  const extraCount = Math.max(0, Number(knowledgeCount) - baseIncluded);
  return extraCount * extraUnit;
}

function computeDerived({ seat_limit, knowledge_count }) {
  if (!pricing) return { baseFee: null, extraKnowledgeFee: null, total: null, searchLimitPerDay: null };

  const seatLimit = Number(seat_limit || 0);
  const knowledgeCount = Number(knowledge_count || 1);

  const baseFee = getBaseFeeFromPricing(seatLimit);
  const extraKnowledgeFee = getKnowledgeMonthlyPriceFromPricing(knowledgeCount);

  const perUser = Number(pricing.search_limit?.per_user_per_day ?? 0);
  const searchLimitPerDay = (seatLimit && perUser) ? (seatLimit * perUser) : null;

  const total =
    (baseFee === null || extraKnowledgeFee === null)
      ? null
      : (Number(baseFee) + Number(extraKnowledgeFee));

  return { baseFee, extraKnowledgeFee, total, searchLimitPerDay };
}

function renderEstimateFromUI() {
  const seatLimit = Number(seatLimitSelect?.value || 0);
  const knowledgeCount = Number(knowledgeCountSelect?.value || 1);

  const derived = computeDerived({ seat_limit: seatLimit, knowledge_count: knowledgeCount });

  kpiBase.textContent = (derived.baseFee == null) ? "-" : yen(Number(derived.baseFee));
  kpiExtra.textContent = (derived.extraKnowledgeFee == null) ? "-" : yen(Number(derived.extraKnowledgeFee));
  kpiMonthly.textContent = (derived.total == null) ? "-" : yen(Number(derived.total));
  kpiSearchLimit.textContent =
    (derived.searchLimitPerDay == null)
      ? "-"
      : `${derived.searchLimitPerDay.toLocaleString("ja-JP")}回/日`;
}

function renderPricing() {
  if (!pricing) {
    pricingSeatsTbody.innerHTML = `<tr><td colspan="3" class="muted">pricing.json が未読込です</td></tr>`;
    pricingKnowledge.textContent = "-";
    pricingSearchLimit.textContent = "-";
    pricingPoc.textContent = "-";
    seatLimitSelect.innerHTML = "";
    seatLimitSelect.disabled = true;
    knowledgeCountSelect.innerHTML = "";
    knowledgeCountSelect.disabled = true;
    return;
  }

  const seatRows = pricing.seats
    .map(s => ({ seat_limit: Number(s.seat_limit), monthly_fee: s.monthly_fee, label: s.label }))
    .filter(x => Number.isFinite(x.seat_limit))
    .sort((a, b) => a.seat_limit - b.seat_limit);

  pricingSeatsTbody.innerHTML = seatRows.map(r => {
    const lim = (r.label && r.monthly_fee == null) ? r.label : `${r.seat_limit}人まで`;
    const fee = (r.monthly_fee == null) ? "-" : yen(Number(r.monthly_fee));
    const note = (r.monthly_fee == null) ? "個別見積" : "";
    return `<tr><td>${escapeHtml(lim)}</td><td>${escapeHtml(fee)}</td><td class="muted">${escapeHtml(note)}</td></tr>`;
  }).join("");

  seatLimitSelect.innerHTML = "";
  for (const r of seatRows) {
    const opt = document.createElement("option");
    opt.value = String(r.seat_limit);
    opt.textContent = (r.monthly_fee == null)
      ? (r.label || `${r.seat_limit}人以上（要相談）`)
      : `${r.seat_limit}人まで`;
    seatLimitSelect.appendChild(opt);
  }
  seatLimitSelect.disabled = false;

  if (pricing.knowledge_count?.length) {
    const krows = pricing.knowledge_count
      .map(k => ({ value: Number(k.value), label: k.label ?? `${k.value}ナレッジ`, monthly_price: Number(k.monthly_price ?? 0) }))
      .filter(x => Number.isFinite(x.value))
      .sort((a, b) => a.value - b.value);

    pricingKnowledge.textContent = krows.map(x => `${x.label}: ${yen(x.monthly_price)}/月`).join(" / ");

    knowledgeCountSelect.innerHTML = "";
    for (const k of krows) {
      const opt = document.createElement("option");
      opt.value = String(k.value);
      opt.textContent = k.label;
      knowledgeCountSelect.appendChild(opt);
    }
    knowledgeCountSelect.disabled = false;
    if (knowledgeCountSelect.options.length) knowledgeCountSelect.value = knowledgeCountSelect.options[0].value;
  } else {
    const baseIncluded = Number(pricing.knowledge?.base_included ?? 1);
    const extraUnit = Number(pricing.knowledge?.extra_monthly_fee ?? 0);
    pricingKnowledge.textContent = `基本に含む: ${baseIncluded} / 追加: ${yen(extraUnit)} / 月`;

    knowledgeCountSelect.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = String(baseIncluded);
    opt.textContent = `${baseIncluded}ナレッジ`;
    knowledgeCountSelect.appendChild(opt);
    knowledgeCountSelect.disabled = false;
  }

  const perUser = Number(pricing.search_limit?.per_user_per_day ?? 0);
  const note = pricing.search_limit?.note ? `（${pricing.search_limit.note}）` : "";
  pricingSearchLimit.textContent = `利用者数 × ${perUser}回/日 ${note}`.trim();

  if (pricing.poc) {
    pricingPoc.textContent = `${pricing.poc.knowledge_types}種類 / ${pricing.poc.days}日 / ${yen(Number(pricing.poc.price))}`;
  } else {
    pricingPoc.textContent = "-";
  }
}

async function loadPricing() {
  const p = await apiFetch(`/pricing`, { method: "GET" });
  pricing = normalizePricing(p);
  renderPricing();
  renderEstimateFromUI();
}

// ===== Contract =====
function setPrimaryContractButton() {
  const hasTenant = !!getTenantId();
  if (!hasTenant) {
    saveContractBtn.textContent = "新規契約を開始する";
    saveContractBtn.disabled = !pricing;
    return;
  }
  saveContractBtn.textContent = "契約内容を更新する";
  saveContractBtn.disabled = !(pricing && contract);
}

function renderContract() {
  contractBadge.textContent = `contract: ${contract?.contract_id ?? "-"}`;
  statusBadge.textContent = `status: ${contract?.status ?? "-"}`;

  contractIdEl.textContent = contract?.contract_id ?? "-";
  contractStatusEl.textContent = contract?.status ?? "-";
  paymentMethodEl.textContent = contract?.payment_method_configured ? "設定済み" : "未設定";
  paidUntilEl.textContent = contract?.paid_until ?? "-";

  if (contract?.seat_limit && seatLimitSelect.options.length) {
    seatLimitSelect.value = String(contract.seat_limit);
  }
  if (contract?.knowledge_count != null && knowledgeCountSelect.options.length) {
    const v = String(contract.knowledge_count);
    const has = Array.from(knowledgeCountSelect.options).some(o => o.value === v);
    knowledgeCountSelect.value = has ? v : knowledgeCountSelect.options[0].value;
  }

  renderEstimateFromUI();

  hideBanner();
  if (contract?.status === "grace") {
    showBanner("warn", "支払い確認が取れていません（猶予期間）。検索画面に警告を表示します。");
  }
  if (contract?.status === "suspended" || contract?.status === "cancelled") {
    showBanner("bad", "契約が停止しています。検索は停止（または強い警告）対象です。");
  }

  // openBillingBtn は “存在する場合のみ” 制御
  if (openBillingBtn) {
    openBillingBtn.disabled = !contract?.billing_url;
    // billing_url があるなら表示（HTML側で消してない場合だけ）
    openBillingBtn.style.display = contract?.billing_url ? "" : "none";
  } else {
    // ボタンが無い場合は、billing_urlが返ってきた瞬間に自動遷移
    tryRedirectToBilling("renderContract");
  }

  setPrimaryContractButton();
}

function renderNoContract() {
  contract = null;

  contractBadge.textContent = `contract: -`;
  statusBadge.textContent = `status: -`;

  contractIdEl.textContent = "-";
  contractStatusEl.textContent = "-";
  paymentMethodEl.textContent = "-";
  paidUntilEl.textContent = "-";

  if (openBillingBtn) {
    openBillingBtn.disabled = true;
    openBillingBtn.style.display = "none";
  }

  hideBanner();
  renderEstimateFromUI();
  setPrimaryContractButton();

  users = [];
  renderUsers();
  roleBadge.textContent = `role: -`;
  userOps.hidden = true;
}

async function loadContractOrNull() {
  if (!getTenantId()) {
    renderNoContract();
    return null;
  }

  const resp = await apiFetchWithTenant(`/contract`, { method: "GET" });
  contract = resp?.contract ?? null;

  if (!contract) {
    renderNoContract();
    return null;
  }

  renderContract();
  return contract;
}

async function contractInitFromUI() {
  const seat_limit = Number(seatLimitSelect?.value || 10);
  const knowledge_count = Number(knowledgeCountSelect?.value || 1);

  const derived = computeDerived({ seat_limit, knowledge_count });

  const payload = {
    seat_limit,
    knowledge_count,
    monthly_price: (derived.total == null) ? 50000 : Number(derived.total),
    search_limit_per_month: 1000,
    status: "active",
    payment_method_configured: false
  };

  const resp = await apiFetch(`/contract/init`, { method: "POST", body: payload });

  const tenantId = resp?.tenant_id;
  if (tenantId) setTenantId(tenantId);

  // サーバが billing_url を返す場合があるので、契約取得前に契約オブジェクトを暫定反映してもよい
  // ただし、最終的にはGET /contractで確定させる
  await loadContractOrNull();
  await loadUsers();
}

// select変更で見積もり更新
seatLimitSelect.addEventListener("change", () => renderEstimateFromUI());
knowledgeCountSelect.addEventListener("change", () => renderEstimateFromUI());

// ★同じボタンで「新規/更新」
saveContractBtn.addEventListener("click", async () => {
  try {
    if (!getTenantId()) {
      await contractInitFromUI();
      return;
    }
    alert("契約内容の更新API（POST /contract/update）が未実装です。先にAPI側を実装したらここで呼びます。");
  } catch (e) {
    console.error(e);
    showBanner("bad", `処理に失敗: ${e.message}`);
  }
});

// 「初期化」ボタンは誤解防止で隠す
if (initContractBtn) {
  initContractBtn.style.display = "none";
}

// ===== Users =====
function computeMyRole() {
  myRole = "member";
  if (!currentUser) return;

  const myEmail = (currentUser.email || "").toLowerCase();
  const me = users.find(u => (u.email || "").toLowerCase() === myEmail);
  if (me && me.role) myRole = me.role;

  roleBadge.textContent = `role: ${myRole}`;
  userOps.hidden = (myRole !== "admin");
}

function countActiveAdmins() {
  return users.filter(u => u.status !== "disabled" && u.role === "admin").length;
}

function renderUsers() {
  usersTbody.innerHTML = "";
  if (!users.length) {
    usersTbody.innerHTML = `<tr><td colspan="5" class="muted">ユーザーがいません</td></tr>`;
    return;
  }

  const activeAdminCount = countActiveAdmins();

  for (const u of users) {
    const tr = document.createElement("tr");
    const email = u.email ?? "-";
    const role = u.role ?? "member";
    const status = u.status ?? "active";
    const lastLogin = fmtLastLogin(u.last_login_at);

    tr.innerHTML = `
      <td>${escapeHtml(email)}</td>
      <td>${escapeHtml(role)}</td>
      <td>${escapeHtml(status)}</td>
      <td>${escapeHtml(lastLogin)}</td>
      <td></td>
    `;

    const opsTd = tr.querySelector("td:last-child");

    if (myRole === "admin") {
      const roleBtn = document.createElement("button");
      roleBtn.textContent = (role === "admin") ? "memberにする" : "adminにする";
      roleBtn.style.marginRight = "6px";

      const isLastAdmin = (role === "admin" && status !== "disabled" && activeAdminCount <= 1);
      roleBtn.disabled = isLastAdmin;

      roleBtn.addEventListener("click", async () => {
        const newRole = (role === "admin") ? "member" : "admin";
        await updateUser(email, { role: newRole });
        await loadUsers();
      });

      const disableBtn = document.createElement("button");
      disableBtn.className = (status === "disabled") ? "" : "danger";
      disableBtn.textContent = (status === "disabled") ? "有効化" : "無効化";
      disableBtn.disabled = (role === "admin" && status !== "disabled" && activeAdminCount <= 1);

      disableBtn.addEventListener("click", async () => {
        const newStatus = (status === "disabled") ? "active" : "disabled";
        await updateUser(email, { status: newStatus });
        await loadUsers();
      });

      opsTd.appendChild(roleBtn);
      opsTd.appendChild(disableBtn);
    } else {
      opsTd.textContent = "-";
    }

    usersTbody.appendChild(tr);
  }
}

async function loadUsers() {
  if (!getTenantId()) {
    users = [];
    renderUsers();
    roleBadge.textContent = `role: -`;
    userOps.hidden = true;
    return;
  }

  const resp = await apiFetchWithTenant(`/users`, { method: "GET" });
  users = Array.isArray(resp?.users) ? resp.users : [];
  renderUsers();
  computeMyRole();
}

async function addUser(email, role) {
  await apiFetchWithTenant(`/users`, { method: "POST", body: { email, role } });
}

async function updateUser(email, patch) {
  const body = {
    tenant_id: getTenantId(),
    users: users.map(u => {
      if ((u.email || "").toLowerCase() !== (email || "").toLowerCase()) return u;
      return { ...u, ...patch };
    })
  };
  await apiFetch(`/users/update`, { method: "POST", body });
}

// ===== Events =====
logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  location.href = "./login.html";
});

refreshAllBtn.addEventListener("click", async () => {
  try {
    await loadPricing();
    await loadContractOrNull();
    await loadUsers();
  } catch (e) {
    console.error(e);
    showBanner("bad", `更新に失敗: ${e.message}`);
  }
});

// openBillingBtn は “存在する場合のみ” バインド
if (openBillingBtn) {
  openBillingBtn.addEventListener("click", async () => {
    if (contract?.billing_url) {
      location.href = contract.billing_url;
      return;
    }
    alert("billing_url が未設定です（APIが返すようにしてください）。");
  });
}

refreshUsersBtn.addEventListener("click", async () => {
  try {
    await loadUsers();
  } catch (e) {
    console.error(e);
    showBanner("bad", `ユーザー一覧の取得に失敗: ${e.message}`);
  }
});

addUserBtn.addEventListener("click", async () => {
  const email = (newUserEmail.value || "").trim().toLowerCase();
  const role = newUserRole.value;

  if (!email) return alert("メールアドレスを入力してください。");
  if (!email.includes("@")) return alert("メールアドレスの形式が正しくありません。");

  addUserBtn.disabled = true;
  try {
    await addUser(email, role);
    newUserEmail.value = "";
    await loadUsers();
  } catch (e) {
    console.error(e);
    alert(`追加に失敗: ${e.message}`);
  } finally {
    addUserBtn.disabled = false;
  }
});

// ===== Boot =====
onAuthStateChanged(auth, async (u) => {
  if (!u) {
    location.replace("./login.html");
    return;
  }

  document.body.style.display = "block";

  currentUser = u;
  userEmailEl.textContent = u.email || "-";
  setActiveTab("contract");

  try {
    await loadPricing();

    if (!getTenantId()) {
      renderNoContract();
      return;
    }

    await loadContractOrNull();
    await loadUsers();
  } catch (e) {
    console.error(e);
    showBanner("bad", `初期化に失敗: ${e.message}`);
  }
});
