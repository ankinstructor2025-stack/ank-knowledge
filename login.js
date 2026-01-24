// login.js
import { initFirebase } from "./ank_firebase.js";
import { GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const { auth } = initFirebase();

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const msgEl = document.getElementById("msg");
const btnEl = document.getElementById("btnLogin");

function setMsg(text) { msgEl.textContent = text; }
function setBusy(busy) { btnEl.disabled = busy; }

function getReturnTo() {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get("return_to");
  } catch {
    return null;
  }
}

btnEl.addEventListener("click", async () => {
  setMsg("");
  setBusy(true);

  try {
    const result = await signInWithPopup(auth, provider);
    console.log("login user:", result.user?.email);

    const returnTo = getReturnTo();
    location.href = returnTo || "./contracts.html";
  } catch (err) {
    console.error(err);
    const popupBlocked =
      err?.code === "auth/popup-blocked" || err?.code === "auth/popup-closed-by-user";
    setMsg(
      popupBlocked
        ? "ログインできませんでした。ポップアップがブロックされていないか確認してください。"
        : "ログインに失敗しました。時間をおいて再度お試しください。"
    );
  } finally {
    setBusy(false);
  }
});
