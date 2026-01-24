import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

const { auth } = initFirebase();

const contractIdEl = document.getElementById("contractId");
const inviteEmailEl = document.getElementById("inviteEmail");
const inviteBtn = document.getElementById("inviteBtn");
const backBtn = document.getElementById("backBtn");
const reloadBtn = document.getElementById("reloadBtn");
const membersTbody = document.getElementById("membersTbody");
const statusEl = document.getElementById("status");

function getContractId() {
  const u = new URL(location.href);
  return u.searchParams.get("contract_id");
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
function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadMembers(currentUser, contractId) {
  membersTbody.innerHTML = `<tr><td colspan="4" class="muted">読み込み中...</td></tr>`;

  const res = await apiFetch(
    currentUser,
    `/v1/contracts/members?contract_id=${encodeURIComponent(contractId)}`,
    { method: "GET" }
  );

  // payment 未設定なら API が 409 を返す想定（後述）
  const rows = res.members || [];
  if (!rows.length) {
    membersTbody.innerHTML = `<tr><td colspan="4" class="muted">メンバーがいません</td></tr>`;
    return;
  }

  membersTbody.innerHTML = rows.map(m => `
    <tr>
      <td>${esc(m.email || "-")}</td>
      <td>${esc(m.role || "-")}</td>
      <td>${esc(m.status || "-")}</td>
      <td>${esc(m.last_login_at || "-")}</td>
    </tr>
  `).join("");
}

async function sendInvite(currentUser, contractId) {
  const email = (inviteEmailEl.value || "").trim().toLowerCase();
  if (!email) { alert("メールアドレスを入力してください。"); return; }
  if (!email.includes("@")) { alert("メールアドレスの形式が正しくありません。"); return; }

  inviteBtn.disabled = true;
  try {
    await apiFetch(currentUser, "/v1/invites", {
      method: "POST",
      body: { contract_id: contractId, email },
    });
    inviteEmailEl.value = "";
    setStatus("招待メールを送信しました。", "ok");
  } finally {
    inviteBtn.disabled = false;
  }
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
  reloadBtn.addEventListener("click", () => loadMembers(currentUser, contractId));
  inviteBtn.addEventListener("click", async () => {
    clearStatus();
    try {
      await sendInvite(currentUser, contractId);
      await loadMembers(currentUser, contractId);
    } catch (e) {
      console.error(e);
      setStatus(e.message, "error");
    }
  });

  try {
    await loadMembers(currentUser, contractId);
  } catch (e) {
    console.error(e);
    // 支払い未設定などはここに落ちる
    alert(e.message);
    location.href = "./contracts.html";
  }
})();
