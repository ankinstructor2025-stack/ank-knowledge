import { initFirebase } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const { auth } = initFirebase();

const elWho = document.getElementById("who");
const elSub = document.getElementById("sub");
const elStatus = document.getElementById("status");
const adminArea = document.getElementById("adminArea");

const btnLogout = document.getElementById("btnLogout");
const btnSearch = document.getElementById("btnSearch");
const btnContracts = document.getElementById("btnContracts");
const btnMembers = document.getElementById("btnMembers");
const btnKnowledge = document.getElementById("btnKnowledge");
const btnAdminSearch = document.getElementById("btnAdminSearch");

function setStatus(msg, type = "") {
  elStatus.style.display = "block";
  elStatus.className = "status " + type;
  elStatus.textContent = msg;
}

function gotoLogin(returnTo) {
  const rt = encodeURIComponent(returnTo || "./index.html");
  location.replace(`./login.html?return_to=${rt}`);
}

function goto(path) {
  location.href = path;
}

async function loadSession(user) {
  // /v1/session は Bearer 必須
  return await apiFetch(user, "/v1/session", { method: "GET" });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    gotoLogin("./index.html");
    return;
  }

  try {
    elWho.textContent = "状態確認中…";
    elSub.textContent = "";

    const sess = await loadSession(user);

    // 1) users 登録済みでなければ index には入れない
    if (!sess.user_exists) {
      setStatus("このアカウントは未登録です。契約画面へ移動します。", "error");
      setTimeout(() => goto("./contracts.html"), 400);
      return;
    }

    // 2) active 契約が無ければ index には入れない（招待未確定など）
    if (!sess.has_active_contract) {
      setStatus("契約が有効化されていません。招待の確定が必要です。", "error");
      // ここは運用次第：招待メールへ誘導 or contractsへ
      // ひとまず contracts へ
      setTimeout(() => goto("./contracts.html"), 600);
      return;
    }

    // 表示
    elWho.textContent = `${sess.email}`;
    elSub.textContent = `role: ${sess.role || "(none)"} / active: ${sess.has_active_contract ? "yes" : "no"}`;

    // 3) role で管理者領域を出し分け
    adminArea.style.display = (sess.role === "admin") ? "block" : "none";

  } catch (e) {
    console.error(e);
    setStatus(e?.message || String(e), "error");
  }
});

btnLogout.onclick = async () => {
  try {
    await signOut(auth);
  } finally {
    gotoLogin("./index.html");
  }
};

// 遷移先は、あなたの実ファイル名に合わせて変えてOK
btnSearch.onclick = () => goto("./qa_search.html");

// 管理者メニュー（ファイルが未作成なら後で差し替え）
btnContracts && (btnContracts.onclick = () => goto("./contracts.html"));
btnMembers && (btnMembers.onclick = () => goto("./admin_members.html"));
btnKnowledge && (btnKnowledge.onclick = () => goto("./admin_knowledge.html"));
btnAdminSearch && (btnAdminSearch.onclick = () => goto("./qa_search.html"));
