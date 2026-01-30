// login.js
import { initFirebase } from "./ank_firebase.js";
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const { auth } = initFirebase();

/**
 * login.js は “ログインするだけ”。
 * 遷移判断（/v1/session を見てどこへ行くか）は index.js に一本化する。
 */

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const msgEl = document.getElementById("msg");
const btnEl = document.getElementById("btnLogin");

function setMsg(text) {
  if (msgEl) msgEl.textContent = text || "";
}
function setBusy(busy) {
  if (btnEl) btnEl.disabled = !!busy;
}

function getReturnTo() {
  const u = new URL(location.href);
  const rt = (u.searchParams.get("return_to") || "").trim();
  // 安全のため「同一オリジン内の相対パス」だけ許可
  if (!rt) return "";
  if (rt.startsWith("http://") || rt.startsWith("https://")) return "";
  if (!rt.startsWith("./") && !rt.startsWith("/")) return "";
  return rt;
}

function gotoAfterLogin() {
  const rt = getReturnTo();
  // ここでは “判断” しない。必ず戻すだけ。
  location.replace(rt || "./");
}

// すでにログイン済みなら即戻す
onAuthStateChanged(auth, (user) => {
  if (user) gotoAfterLogin();
});

if (btnEl) {
  btnEl.addEventListener("click", async () => {
    try {
      setMsg("");
      setBusy(true);

      // Googleログイン（ポップアップ）
      await signInWithPopup(auth, provider);

      // 成功したら戻す（index.js が次を決める）
      gotoAfterLogin();
    } catch (e) {
      console.error(e);
      setMsg(`ログインに失敗しました: ${e?.message || e}`);
      setBusy(false);
    }
  });
}
