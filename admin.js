// admin.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

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
 * ★ Cloud Run のURL（末尾スラッシュなし）
 */
const API_BASE = "https://ank-admin-api-986862757498.asia-northeast1.run.app";

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

// contract display
const contractIdEl = $("contractId");
const contractStatusEl = $("contractStatus");
const paymentMethodEl = $("paymentMethod");
const paidUntilEl = $("paidUntil");

const refreshAllBtn = $("refreshAllBtn");
const initContractBtn = $("initContractBtn");
const openBillingBtn = $("openBillingBtn");

const seatLimitSelect = $("seatLimitSelect");
const knowledgeCountSelect = $("knowledgeCountSelect");
const saveContractBtn = $("saveContractBtn"); // ※APIがあれば有効化できる

// KPIs
const kpiMonthly = $("kpiMonthly");
const kpiBase = $("kpiBase");
const kpiExtra = $("kpiExtra");
const kpiSearchLimit = $("kpiSearchLimit");

// pricing display
const pricingSeatsTbody = $("pricingSeatsTbody");
const pricingKnowledge = $("pricingKnowledge");
const pricingSearchLimit = $("pricingSearchLimit");
const pricingPoc = $("pricingPoc");

// users
const refreshUsersBtn = $("refreshUsersBtn");
const userOps = $("userOps");
const newUserEmail = $("newUserEmail");
const newUserRole = $("newUserRole");
const addUserBtn = $("addUserBtn");
const usersTbody = $("usersTbody");

// ===== State =====
let currentUser = null;
let pricing = null;   // pricing.json
let contract = null;  // contract json
let users = [];
let myRole = "member";

// ===== Helpers =====
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
  if (typeof n !== "number") return String(n);
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

// ===== Pricing logic =====
function normalizePricing(p) {
  // 防御的に整形（想定キーが無いときでも落ちないようにする）
  const seats = Array.isArray(p?.seats) ? p.seats : [];

  // knowledge_count: [{value,label,monthly_price}] を優先
  const knowledge_count = Array.isArray(p?.knowledge_count) ? p.knowledge_count : [];

  // 旧形式のフォールバック（残っていてもOK）
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
  const seats = pricing.seats
    .map(x => ({
      seat_limit: Number(x.seat_limit),
      monthly_fee: x.monthly_fee,
      label: x.label
    }))
    .filter(x => Number.isFinite(x.seat_limit))
    .sort((a, b) => a.seat_limit - b.seat_limit);

  const exact = seats.find(s => s.seat_limit === Number(seatLimit));
  if (exact) return exact.monthly_fee ?? null;

  for (const s of seats) {
    if (Number(seatLimit) <= s.seat_limit) return s.monthly_fee ?? null;
  }
  return null;
}

function getKnowledgeMonthlyPriceFromPricing(knowledgeCount) {
  // 新形式 knowledge_count を最優先
  if (pricing?.knowledge_count?.length) {
    const k = pricing.knowledge_count
      .map(x => ({
        value: Number(x.value),
        monthly_price: Number(x.monthly_price),
        label: x.label
      }))
      .filter(x => Number.isFinite(x.value))
      .sort((a, b) => a.value - b.value);

    const hit = k.find(x => x.value === Number(knowledgeCount));
    if (hit) return Number.isFinite(hit.monthly_price) ? hit.monthly_price : 0;

    // 定義外は「最大定義値」に丸めない（危険なので）→ null
    return null;
  }

  // フォールバック（旧形式）
  const baseIncluded = Number(pricing?.knowledge?.base_included ?? 1);
  const extraUnit = Number(pricing?.knowledge?.extra_monthly_fee ?? 0);
  const extraCount = Math.max(0, Number(knowledgeCount) - baseIncluded);
  return extraCount * extraUnit;
}

function computeDerived(contractLike) {
  if (!pricing || !contractLike) {
    return {
      baseFee: null,
      extraKnowledgeFee: null,
      total: null,
      searchLimitPerDay: null
    };
  }

  const seatLimit = Number(contractLike.seat_limit || 0);
  const knowledgeCount = Number(contractLike.knowledge_count || 1);

  const baseFee = getBaseFeeFromPricing(seatLimit);
  const extraKnowledgeFee = getKnowledgeMonthlyPriceFromPricing(knowledgeCount);

  const perUser = Number(pricing.search_limit?.per_user_per_day ?? 0);
  const searchLimitPerDay = seatLimit && perUser ? seatLimit * perUser : null;

  const total =
    (baseFee === null || extraKnowledgeFee === null)
      ? null
      : (Number(baseFee) + Number(extraKnowledgeFee));

  return { baseFee, extraKnowledgeFee, total, searchLimitPerDay };
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

  // seats table
  const rows = pricing.seats
    .map(s => ({
      seat_limit: s.seat_limit,
      monthly_fee: s.monthly_fee,
      label: s.label
    }))
    .sort((a, b) => Number(a.seat_limit) - Number(b.seat_limit));

  pricingSeatsTbody.innerHTML = rows.map(r => {
    const lim = (r.label && r.monthly_fee == null)
      ? r.label
      : `${r.seat_limit}人まで`;
    const fee = (r.monthly_fee == null) ? "-" : yen(Number(r.monthly_fee));
    const note = (r.monthly_fee == null) ? "個別見積" : "";
    return `<tr><td>${escapeHtml(lim)}</td><td>${escapeHtml(fee)}</td><td class="muted">${escapeHtml(note)}</td></tr>`;
  }).join("");

  // knowledge pricing display (新形式)
  if (pricing.knowledge_count?.length) {
    const krows = pricing.knowledge_count
      .map(k => ({
        value: Number(k.value),
        label: k.label ?? `${k.value}`,
        monthly_price: Number(k.monthly_price ?? 0)
      }))
      .filter(x => Number.isFinite(x.value))
      .sort((a, b) => a.value - b.value);

    pricingKnowledge.textContent =
      krows.map(x => `${x.label}: ${yen(x.monthly_price)}/月`).join(" / ");

    // knowledge select options
    knowledgeCountSelect.innerHTML = "";
    for (const k of krows) {
      const opt = document.createElement("option");
      opt.value = String(k.value);
      opt.textContent = k.label || `${k.value}ナレッジ`;
      opt.dataset.monthlyPrice = String(Number.isFinite(k.monthly_price) ? k.monthly_price : 0);
      knowledgeCountSelect.appendChild(opt);
    }
    knowledgeCountSelect.disabled = false;
  } else {
    pricingKnowledge.textContent = "knowledge_count が pricing.json にありません";
    knowledgeCountSelect.innerHTML = "";
    knowledgeCountSelect.disabled = true;
  }

  // search limit
  const perUser = Number(pricing.search_limit?.per_user_per_day ?? 0);
  const note = pricing.search_limit?.note ? `（${pricing.search_limit.note}）` : "";
  pricingSearchLimit.textContent = `利用者数 × ${perUser}回/日 ${note}`.trim();

  // poc
  if (pricing.poc) {
    pricingPoc.textContent = `${pricing.poc.knowledge_types}種類 / ${pricing.poc.days}日 / ${yen(Number(pricing.poc.price))}`;
  } else {
    pricingPoc.textContent = "-";
  }

  // seat options
  seatLimitSelect.innerHTML = "";
  for (const r of rows) {
    if (!Number.isFinite(Number(r.seat_limit))) continue;
    const isConsult = (r.monthly_fee == null);
    const opt = document.createElement("option");
    opt.value = String(r.seat_limit);
    opt.textContent = isConsult
      ? (r.label || `${r.seat_limit}人以上（要相談）`)
      : `${r.seat_limit}人まで`;
    opt.dataset.isConsult = isConsult ? "1" : "0";
    seatLimitSelect.appendChild(opt);
  }
  seatLimitSelect.disabled = false;
}

async function loadPricing() {
  const p = await apiFetch(`/pricing`, { method: "GET" });
  pricing = normalizePricing(p);
  renderPricing();
}

// ===== Contract =====
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
    // pricing定義外の値は危険なので、selectに無ければ先頭に戻す
    const has = Array.from(knowledgeCountSelect.options).some(o => o.value === v);
    knowledgeCountSelect.value = has ? v : knowledgeCountSelect.options[0].value;
  }

  const derived = computeDerived({
    seat_limit: Number(seatLimitSelect.value || contract?.seat_limit || 0),
    knowledge_count: Number(knowledgeCountSelect.value || contract?.knowledge_count || 1)
  });

  kpiBase.textContent = (derived.baseFee == null) ? "-" : yen(Number(derived.baseFee));
  kpiExtra.textContent = (derived.extraKnowledgeFee == null) ? "-" : yen(Number(derived.extraKnowledgeFee));
  kpiMonthly.textContent = (derived.total == null) ? "-" : yen(Number(derived.total));
  kpiSearchLimit.textContent = (derived.searchLimitPerDay == null) ? "-" : `${derived.searchLimitPerDay.toLocaleString("ja-JP")}回/日`;

  hideBanner();
  if (contract?.status === "grace") {
    showBanner("warn", "支払い確認が取れていません（猶予期間）。検索画面に警告を表示します。");
  }
  if (contract?.status === "suspended" || contract?.status === "cancelled") {
    showBanner("bad", "契約が停止しています。検索は停止（または強い警告）対象です。");
  }

  saveContractBtn.disabled = !(pricing && contract);
}

async function loadContract() {
  contract = await apiFetch(`/contract`, { method: "GET" });
  renderContract();
}

async function initContract() {
  let defaultSeat = 10;
  if (pricing?.seats?.length) {
    const sorted = pricing.seats
      .map(s => Number(s.seat_limit))
      .filter(n => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (sorted.length) defaultSeat = sorted[0];
  }

  // knowledge_count は pricing の先頭（=最小）に合わせる（危険な値にしない）
  let defaultKnowledge = 1;
  if (pricing?.knowledge_count?.length) {
    const sortedK = pricing.knowledge_count
      .map(k => Number(k.value))
      .filter(n => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (sortedK.length) defaultKnowledge = sortedK[0];
  }

  const payload = {
    seat_limit: defaultSeat,
    knowledge_count: defaultKnowledge,
    status: "active",
    payment_method_configured: false
  };

  await apiFetch(`/contract/init`, { method: "POST", body: payload });
  await loadContract();
}

seatLimitSelect.addEventListener("change", () => renderContract());
knowledgeCountSelect.addEventListener("change", () => renderContract());

saveContractBtn.addEventListener("click", async () => {
  alert("契約内容の保存APIが未実装です。API側に /contract/update を用意したら有効化します。");
});

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

function renderEstimateFromUI() {
  const seatLimit = Number(seatLimitSelect.value);
  const knowledgeCount = Number(knowledgeCountSelect.value);

  const derived = computeDerived({
    seat_limit: seatLimit,
    knowledge_count: knowledgeCount
  });

  kpiBase.textContent = derived.baseFee != null ? yen(derived.baseFee) : "-";
  kpiExtra.textContent = derived.extraKnowledgeFee != null ? yen(derived.extraKnowledgeFee) : "-";
  kpiMonthly.textContent = derived.total != null ? yen(derived.total) : "-";
  kpiSearchLimit.textContent =
    derived.searchLimitPerDay != null
      ? `${derived.searchLimitPerDay.toLocaleString()}回/日`
      : "-";
}

async function loadUsers() {
  users = await apiFetch(`/users`, { method: "GET" });
  renderUsers();
  computeMyRole();
}

async function addUser(email, role) {
  await apiFetch(`/users`, {
    method: "POST",
    body: { email, role }
  });
}

async function updateUser(email, patch) {
  await apiFetch(`/users/update`, {
    method: "POST",
    body: { email, patch }
  });
}

// ===== Events =====
logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  location.href = "./login.html";
});

refreshAllBtn.addEventListener("click", async () => {
  try {
    await loadPricing();
    await loadUsers();
    await loadContract();
  } catch (e) {
    console.error(e);
    showBanner("bad", `更新に失敗: ${e.message}`);
  }
});

initContractBtn.addEventListener("click", async () => {
  try {
    await initContract();
  } catch (e) {
    console.error(e);
    showBanner("warn", `契約初期化: ${e.message}`);
  }
});

openBillingBtn.addEventListener("click", async () => {
  if (contract?.billing_url) {
    location.href = contract.billing_url;
    return;
  }
  alert("billing_url が未設定です（APIが返すようにしてください）。");
});

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
    location.href = "./login.html";
    return;
  }
  currentUser = u;
  userEmailEl.textContent = u.email || "-";

  setActiveTab("contract");

  try {
    // pricing → users → contract の順（UIが自然）
    await loadPricing();
    await loadUsers();
    if (contract) {
      await loadContract();
    } else {
      // ★ 未契約でも初期値で見積もりを出す
      renderEstimateFromUI();
    }
  } catch (e) {
    console.error(e);
    showBanner("bad", `初期化に失敗: ${e.message}`);
  }
});
