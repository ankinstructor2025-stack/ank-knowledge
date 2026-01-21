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
const userOps = $("userOps");
const newUserEmail = $("newUserEmail");
const newUserRole = $("newUserRole");
const addUserBtn = $("addUserBtn");
const usersTbody = $("usersTbody");

// ===== State =====
let currentUser = null;
let pricing = null;   // pricing.json（整形済み）
let contract = null;  // contract json（未契約なら null）
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

function isNotFoundError(e) {
  // apiFetch は "API error 404: ..." の形式
  return String(e?.message || "").includes("API error 404");
}

// ===== API =====
async function apiFetch(path, { method = "GET", body = null } = {}) {
  if (!currentUser) throw new Error("not signed in");

  const token = await currentUser.getIdToken(true);
  const headers = {
    "Authorization": `Bearer ${token}`
  };

  if (body != null) {
    headers["Content-Type"] = "application/json";
  }
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

  const rows = pricing.seats
    .map(x => ({
      seat_limit: Number(x.seat_limit),
      monthly_fee: x.monthly_fee,
      label: x.label
    }))
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
  // 新形式 knowledge_count を最優先
  if (pricing?.knowledge_count?.length) {
    const krows = pricing.knowledge_count
      .map(x => ({
        value: Number(x.value),
        monthly_price: Number(x.monthly_price ?? 0),
        label: x.label
      }))
      .filter(x => Number.isFinite(x.value))
      .sort((a, b) => a.value - b.value);

    const hit = krows.find(x => x.value === Number(knowledgeCount));
    if (hit) return Number.isFinite(hit.monthly_price) ? hit.monthly_price : 0;

    // 定義外は危険なので null（丸めない）
    return null;
  }

  // フォールバック（旧形式）
  const baseIncluded = Number(pricing?.knowledge?.base_included ?? 1);
  const extraUnit = Number(pricing?.knowledge?.extra_monthly_fee ?? 0);
  const extraCount = Math.max(0, Number(knowledgeCount) - baseIncluded);
  return extraCount * extraUnit;
}

function computeDerived({ seat_limit, knowledge_count }) {
  if (!pricing) {
    return { baseFee: null, extraKnowledgeFee: null, total: null, searchLimitPerDay: null };
  }

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
  // 契約が無くても、選択値で見積もりを出す
  const seatLimit = Number(seatLimitSelect?.value || 0);
  const knowledgeCount = Number(knowledgeCountSelect?.value || 1);

  const derived = computeDerived({
    seat_limit: seatLimit,
    knowledge_count: knowledgeCount
  });

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

  // seats table
  const seatRows = pricing.seats
    .map(s => ({
      seat_limit: Number(s.seat_limit),
      monthly_fee: s.monthly_fee,
      label: s.label
    }))
    .filter(x => Number.isFinite(x.seat_limit))
    .sort((a, b) => a.seat_limit - b.seat_limit);

  pricingSeatsTbody.innerHTML = seatRows.map(r => {
    const lim = (r.label && r.monthly_fee == null) ? r.label : `${r.seat_limit}人まで`;
    const fee = (r.monthly_fee == null) ? "-" : yen(Number(r.monthly_fee));
    const note = (r.monthly_fee == null) ? "個別見積" : "";
    return `<tr><td>${escapeHtml(lim)}</td><td>${escapeHtml(fee)}</td><td class="muted">${escapeHtml(note)}</td></tr>`;
  }).join("");

  // seat options
  seatLimitSelect.innerHTML = "";
  for (const r of seatRows) {
    const isConsult = (r.monthly_fee == null);
    const opt = document.createElement("option");
    opt.value = String(r.seat_limit);
    opt.textContent = isConsult
      ? (r.label || `${r.seat_limit}人以上（要相談）`)
      : `${r.seat_limit}人まで`;
    seatLimitSelect.appendChild(opt);
  }
  seatLimitSelect.disabled = false;

  // knowledge pricing + options
  if (pricing.knowledge_count?.length) {
    const krows = pricing.knowledge_count
      .map(k => ({
        value: Number(k.value),
        label: k.label ?? `${k.value}ナレッジ`,
        monthly_price: Number(k.monthly_price ?? 0)
      }))
      .filter(x => Number.isFinite(x.value))
      .sort((a, b) => a.value - b.value);

    pricingKnowledge.textContent =
      krows.map(x => `${x.label}: ${yen(x.monthly_price)}/月`).join(" / ");

    knowledgeCountSelect.innerHTML = "";
    for (const k of krows) {
      const opt = document.createElement("option");
      opt.value = String(k.value);
      opt.textContent = k.label;
      knowledgeCountSelect.appendChild(opt);
    }
    knowledgeCountSelect.disabled = false;

    // 未契約時の初期値（先頭＝最小）を自然にする
    if (knowledgeCountSelect.options.length) {
      knowledgeCountSelect.value = knowledgeCountSelect.options[0].value;
    }
  } else {
    // フォールバック表示（旧形式のみのとき）
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
}

async function loadPricing() {
  const p = await apiFetch(`/pricing`, { method: "GET" });
  pricing = normalizePricing(p);
  renderPricing();

  // pricing が揃ったら、未契約でも初期見積もりを出す（select初期値で）
  renderEstimateFromUI();
}

// ===== Contract =====
function renderContract() {
  contractBadge.textContent = `contract: ${contract?.contract_id ?? "-"}`;
  statusBadge.textContent = `status: ${contract?.status ?? "-"}`;

  contractIdEl.textContent = contract?.contract_id ?? "-";
  contractStatusEl.textContent = contract?.status ?? "-";
  paymentMethodEl.textContent = contract?.payment_method_configured ? "設定済み" : "未設定";
  paidUntilEl.textContent = contract?.paid_until ?? "-";

  // 契約値があれば select に反映
  if (contract?.seat_limit && seatLimitSelect.options.length) {
    seatLimitSelect.value = String(contract.seat_limit);
  }
  if (contract?.knowledge_count != null && knowledgeCountSelect.options.length) {
    const v = String(contract.knowledge_count);
    const has = Array.from(knowledgeCountSelect.options).some(o => o.value === v);
    knowledgeCountSelect.value = has ? v : knowledgeCountSelect.options[0].value;
  }

  // KPI は select の値で再計算
  renderEstimateFromUI();

  hideBanner();
  if (contract?.status === "grace") {
    showBanner("warn", "支払い確認が取れていません（猶予期間）。検索画面に警告を表示します。");
  }
  if (contract?.status === "suspended" || contract?.status === "cancelled") {
    showBanner("bad", "契約が停止しています。検索は停止（または強い警告）対象です。");
  }

  saveContractBtn.disabled = !(pricing && contract);
}

function renderNoContract() {
  contractBadge.textContent = `contract: -`;
  statusBadge.textContent = `status: -`;

  contractIdEl.textContent = "-";
  contractStatusEl.textContent = "-";
  paymentMethodEl.textContent = "-";
  paidUntilEl.textContent = "-";

  // 未契約でも、pricing が読めていれば契約作成できる
  saveContractBtn.disabled = !pricing;

  hideBanner();
  saveContractBtn.disabled = true;

  // 未契約でも見積もりは出す
  renderEstimateFromUI();
}

async function loadContractOrNull() {
  try {
    contract = await apiFetch(`/contract`, { method: "GET" });
    renderContract();
    return contract;
  } catch (e) {
    if (isNotFoundError(e)) {
      contract = null;
      renderNoContract();
      return null;
    }
    throw e;
  }
}

async function initContract() {
  // 初期値は pricing の最小に寄せる
  let defaultSeat = 10;
  if (pricing?.seats?.length) {
    const sorted = pricing.seats
      .map(s => Number(s.seat_limit))
      .filter(n => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (sorted.length) defaultSeat = sorted[0];
  }

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
  await loadContractOrNull();
}

// select 変更で即見積もり
seatLimitSelect.addEventListener("change", () => {
  renderEstimateFromUI();
});
knowledgeCountSelect.addEventListener("change", () => {
  renderEstimateFromUI();
});

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

async function loadUsers() {
  const email = currentUser.email; // ← ログイン成功時に取得している想定

  const result = await apiFetch(
    `/v1/user-check?email=${encodeURIComponent(email)}`,
    { method: "GET" }
  );

  if (!result.exists) {
    // 未契約 → 契約導線へ
    loadPricing();
    return;
  }

  // 契約済
  myUserId = result.user_id;
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

  // body を display:none にしている場合でも、ログイン後に必ず表示
  document.body.style.display = "block";

  currentUser = u;
  userEmailEl.textContent = u.email || "-";

  setActiveTab("contract");
});
