// admin.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/**
 * ★ここをあなたのFirebase設定に置き換え
 * login.js と同じ firebaseConfig を貼るのが安全
 */
const firebaseConfig = {
  // apiKey: "...",
  // authDomain: "...",
  // projectId: "...",
  // appId: "..."
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ★ここを Cloud Run のURLに変更（例：https://xxxx-uc.a.run.app）
const API_BASE = "https://YOUR_CLOUD_RUN_DOMAIN";

// ====== DOM ======
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

const contractIdEl = $("contractId");
const contractStatusEl = $("contractStatus");
const paymentMethodEl = $("paymentMethod");
const paidUntilEl = $("paidUntil");
const seatLimitEl = $("seatLimit");
const knowledgeCountEl = $("knowledgeCount");
const searchLimitEl = $("searchLimit");

const refreshContractBtn = $("refreshContractBtn");
const initContractBtn = $("initContractBtn");
const openBillingBtn = $("openBillingBtn");

const refreshUsersBtn = $("refreshUsersBtn");
const userOps = $("userOps");
const newUserEmail = $("newUserEmail");
const newUserRole = $("newUserRole");
const addUserBtn = $("addUserBtn");
const usersTbody = $("usersTbody");

// ====== State ======
let currentUser = null;
let contract = null;      // { contract_id, status, payment_method_configured, paid_until, seat_limit, knowledge_count, ... }
let users = [];           // [{ email, uid, role, status, last_login_at }]
let myRole = "member";

// ====== UI helpers ======
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

// ====== API ======
async function apiFetch(path, { method = "GET", body = null } = {}) {
  if (!currentUser) throw new Error("not signed in");

  const token = await currentUser.getIdToken(true); // 取得（必要ならキャッシュ可）
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

// ====== contract ======
function renderContract() {
  if (!contract) {
    contractBadge.textContent = "contract: -";
    statusBadge.textContent = "status: -";
    contractIdEl.textContent = "-";
    contractStatusEl.textContent = "-";
    paymentMethodEl.textContent = "-";
    paidUntilEl.textContent = "-";
    seatLimitEl.textContent = "-";
    knowledgeCountEl.textContent = "-";
    searchLimitEl.textContent = "-";
    return;
  }

  contractBadge.textContent = `contract: ${contract.contract_id ?? "-"}`;
  statusBadge.textContent = `status: ${contract.status ?? "-"}`;

  contractIdEl.textContent = contract.contract_id ?? "-";
  contractStatusEl.textContent = contract.status ?? "-";
  paymentMethodEl.textContent = contract.payment_method_configured ? "設定済み" : "未設定";
  paidUntilEl.textContent = contract.paid_until ?? "-";
  seatLimitEl.textContent = contract.seat_limit ?? "-";
  knowledgeCountEl.textContent = contract.knowledge_count ?? "-";

  // 参考：利用者数×100回/日（1ナレッジ想定）
  const seat = Number(contract.seat_limit || 0);
  const lim = seat ? (seat * 100) : 0;
  searchLimitEl.textContent = lim ? `${lim} 回/日（参考）` : "-";

  hideBanner();
  if (contract.status === "grace") {
    showBanner("warn", "支払い確認が取れていません（猶予期間）。検索画面に警告を表示します。");
  }
  if (contract.status === "suspended" || contract.status === "cancelled") {
    showBanner("bad", "契約が停止しています。検索は停止（または強い警告）対象です。");
  }
}

async function loadContract() {
  // contract_id は “契約したときの uid” 前提：uidをキーにしてサーバで解決
  contract = await apiFetch(`/contract`, { method: "GET" });
  renderContract();
}

async function initContract() {
  // 初回用：存在すればエラーでOK（UI的には警告だけ出す）
  // body で seat_limit 等の初期値を渡せるようにしておく
  const payload = {
    seat_limit: 10,
    knowledge_count: 1,
    status: "active",
    payment_method_configured: false
  };
  await apiFetch(`/contract/init`, { method: "POST", body: payload });
  await loadContract();
}

// ====== users ======
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

function fmtLastLogin(v) {
  if (!v) return "-";
  // v は ISO を想定
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString();
  } catch {
    return String(v);
  }
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
      // role toggle
      const roleBtn = document.createElement("button");
      roleBtn.textContent = (role === "admin") ? "memberにする" : "adminにする";
      roleBtn.style.marginRight = "6px";

      // ガード：最後のadminをmemberに変更不可
      const isLastAdmin = (role === "admin" && status !== "disabled" && activeAdminCount <= 1);
      roleBtn.disabled = isLastAdmin;

      roleBtn.addEventListener("click", async () => {
        const newRole = (role === "admin") ? "member" : "admin";
        await updateUser(email, { role: newRole });
        await loadUsers();
      });

      // disable/enable
      const disableBtn = document.createElement("button");
      disableBtn.className = (status === "disabled") ? "" : "danger";
      disableBtn.textContent = (status === "disabled") ? "有効化" : "無効化";

      // ガード：最後のadminを無効化不可
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

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadUsers() {
  users = await apiFetch(`/users`, { method: "GET" });
  renderUsers();
  computeMyRole();
}

async function addUser(email, role) {
  await apiFetch(`/users`, {
    method: "POST",
    body: { email, role } // uidは初回ログインで紐づける想定でもOK
  });
}

async function updateUser(email, patch) {
  // emailキーで更新（PoCではこれが一番簡単）
  await apiFetch(`/users/update`, {
    method: "POST",
    body: { email, patch }
  });
}

// ====== events ======
logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  location.href = "./login.html";
});

refreshContractBtn.addEventListener("click", async () => {
  try {
    await loadContract();
  } catch (e) {
    console.error(e);
    showBanner("bad", `契約情報の取得に失敗: ${e.message}`);
  }
});

initContractBtn.addEventListener("click", async () => {
  try {
    await initContract();
    showBanner("warn", "契約を初期化しました（すでに存在する場合は失敗する想定です）。");
  } catch (e) {
    console.error(e);
    showBanner("warn", `契約初期化: ${e.message}`);
  }
});

openBillingBtn.addEventListener("click", async () => {
  // 決済ページURLは contract から返すのが理想。ここは仮。
  // 例：contract.billing_url があればそれへ遷移。
  if (contract?.billing_url) {
    location.href = contract.billing_url;
    return;
  }
  alert("billing_url が未設定です（API側で返すようにしてください）。");
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

  if (!email) {
    alert("メールアドレスを入力してください。");
    return;
  }
  if (!email.includes("@")) {
    alert("メールアドレスの形式が正しくありません。");
    return;
  }

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

// ====== boot ======
onAuthStateChanged(auth, async (u) => {
  if (!u) {
    // 未ログイン → loginへ
    location.href = "./login.html";
    return;
  }
  currentUser = u;
  userEmailEl.textContent = u.email || "-";

  // 初期表示
  setActiveTab("contract");

  try {
    // 先に users を読み、myRole を確定
    await loadUsers();

    // admin でない場合でも契約は表示する（閲覧のみ）
    await loadContract();
  } catch (e) {
    console.error(e);
    showBanner("bad", `初期化に失敗: ${e.message}`);
  }
});
