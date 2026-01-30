// login.js
import { initFirebase } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";
import { GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const { auth } = initFirebase();

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const msgEl = document.getElementById("msg");
const btnEl = document.getElementById("btnLogin");

function setMsg(text) { msgEl.textContent = text || ""; }
function setBusy(busy) { btnEl.disabled = !!busy; }

function getReturnTo() {
  try {
    const u = new URL(window.location.href);
    const v = u.searchParams.get("return_to");
    return v ? decodeURIComponent(v) : null;
  } catch {
    return null;
  }
}

async function routeAfterLogin(user) {
  // 1) return_to があれば最優先（invite.html へ戻す等）
  const returnTo = getReturnTo();
  if (returnTo) {
    location.replace(returnTo);
    return;
  }

  // 2) return_to が無い場合は /v1/session で分岐
  const sess = await apiFetch(user, "/v1/session", { method: "GET" });

  // account_id を必ず取り出す（キー揺れ吸収）
  const accountId =
    sess.account_id ||
    sess.accountId ||
    (sess.account && sess.account.account_id) ||
    "";

  // tenants.html は account_id 前提なので、無いなら止める（noneで進めない）
  function gotoTenants() {
    if (!accountId) {
      setMsg("account_id が取得できませんでした。/v1/session のレスポンスを確認してください。");
      setBusy(false);
      return;
    }
    location.replace(`./tenants.html?account_id=${encodeURIComponent(accountId)}`);
  }

  // users未登録 → 新規テナント画面（契約導線だけ）
  if (!sess.user_exists) {
    gotoTenants();
    return;
  }

  // users登録済 & active契約あり → 通常画面
  if (sess.has_active_contract) {
    location.replace("./");   // ルートに戻す（= index.htmlが表示される）
    return;
  }

  // users登録済だが active 契約なし（招待待ち/未有効化）
  gotoTenants();
}

btnEl.addEventListener("click", async () => {
  try {
    setBusy(true);
    setMsg("");

    // Googleログイン（ポップアップ）
    const result = await signInWithPopup(auth, provider);

    // 遷移
    await routeAfterLogin(result.user);
  } catch (e) {
    // popup closed / blocked もここに入る
    console.error(e);
    setMsg(`ログインに失敗しました: ${e?.message || e}`);
    setBusy(false);
  }
});

