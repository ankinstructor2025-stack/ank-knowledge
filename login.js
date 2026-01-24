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

  // users未登録 → 新規契約画面（契約導線だけ）
  if (!sess.user_exists) {
    location.replace("./contracts.html");
    return;
  }

  // users登録済 & active契約あり → 通常画面
  if (sess.has_active_contract) {
    location.replace("./index.html");
    return;
  }

  // users登録済だが active 契約なし（招待待ち/未有効化）
  // ここは運用次第だが、いったん contracts に落とす（表示は後で調整してOK）
  location.replace("./contracts.html");
}

btnEl.addEventListener("click", async () => {
  setMsg("");
  setBusy(true);

  try {
    setMsg("ログイン中...");
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    setMsg("ログイン後の状態を確認中...");
    await routeAfterLogin(user);

  } catch (err) {
    console.error(err);
    const popupBlocked =
      err?.code === "auth/popup-blocked" || err?.code === "auth/popup-closed-by-user";

    setMsg(
      popupBlocked
        ? "ログインできませんでした。ポップアップがブロックされていないか確認してください。"
        : "ログインに失敗しました。時間をおいて再度お試しください。"
    );
    setBusy(false);
    return;
  }
});
