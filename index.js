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

// 新: account/tenant 前提のセッション
async function loadSession(user) {
  // まずは /v1/session に寄せる（API側を後で実装）
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

    // 表示（最低限）
    elWho.textContent = `${sess.email || user.email || "(unknown)"}`;

    // 1) user.json が無い（=サービス未登録）
    if (!sess.user_exists) {
      setStatus("このアカウントは未登録です。新規Account作成へ移動します。", "error");
      setTimeout(() => goto("./account_new.html"), 400);
      return;
    }

    const accounts = Array.isArray(sess.accounts) ? sess.accounts : [];

    // 2) 所属Accountが0（=招待未確定など）
    if (accounts.length === 0) {
      setStatus("所属Accountがありません。招待の確定、または新規Account作成が必要です。", "error");
      setTimeout(() => goto("./account_new.html"), 600);
      return;
    }

    // 3) Accountが1つなら自動選択してTenant一覧へ
    //    Accountが複数ならAccount選択画面へ
    if (accounts.length === 1) {
      const a = accounts[0];
      // あとで tenants.html 側で account_id を使う
      const aid = encodeURIComponent(a.account_id);
      setStatus("Accountを確認しました。テナント一覧へ移動します。", "ok");
      setTimeout(() => goto(`./tenants.html?account_id=${aid}`), 200);
      return;
    } else {
      // last_used があるなら自動遷移でもOKだが、まずは選択画面へ
      setStatus("複数のAccountがあります。選択してください。", "ok");
      setTimeout(() => goto("./accounts.html"), 200);
      return;
    }

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

// メンバー共通：検索（tenant確定後の画面で使うのが本来だが、今は残す）
btnSearch.onclick = () => goto("./qa_search.html");

// 管理者メニュー（ここは tenant内role が確定してから出すのが本筋）
// いまは index では隠しておく（誤表示防止）
adminArea.style.display = "none";
btnContracts && (btnContracts.onclick = () => goto("./contracts.html"));
btnMembers && (btnMembers.onclick = () => goto("./admin_members.html"));
btnKnowledge && (btnKnowledge.onclick = () => goto("./admin_knowledge.html"));
btnAdminSearch && (btnAdminSearch.onclick = () => goto("./qa_maintenance.html"));
