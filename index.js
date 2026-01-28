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

    // 管理機能は tenant_admin に統合するので index では常に隠す
    if (adminArea) adminArea.style.display = "none";

    const sess = await loadSession(user);

    elWho.textContent = `${sess.email || user.email || "(unknown)"}`;

    // 1) サービス未登録
    if (!sess.user_exists) {
      setStatus("このアカウントは未登録です。新規Account作成へ移動します。", "error");
      setTimeout(() => goto("./account_new.html"), 200);
      return;
    }

    const accounts = Array.isArray(sess.accounts) ? sess.accounts : [];

    // 2) 所属Accountが0
    if (accounts.length === 0) {
      setStatus("所属Accountがありません。新規Account作成へ移動します。", "error");
      setTimeout(() => goto("./account_new.html"), 200);
      return;
    }

    // 3) Accountが1つ → tenantsへ
    if (accounts.length === 1) {
      const a = accounts[0];
      const aid = encodeURIComponent(a.account_id);
      setStatus("Accountを確認しました。テナント一覧へ移動します。", "ok");
      setTimeout(() => goto(`./tenants.html?account_id=${aid}`), 150);
      return;
    }

    // 4) Accountが複数 → accounts選択（将来）
    setStatus("複数のAccountがあります。選択してください。", "ok");
    setTimeout(() => goto("./accounts.html"), 150);

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

// QA検索は tenant 確定後に使う想定だが、暫定で残す（落とさない）
btnSearch.onclick = () => goto("./qa_search.html");
