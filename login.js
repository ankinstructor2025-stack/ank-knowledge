// login.js
// 目的：Googleログイン（Firebase Authentication）で管理者を認証する
// 使い方：Firebaseコンソールで表示された firebaseConfig を下に貼り付けてください

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

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

/* ===== Google プロバイダ設定 ===== */
const provider = new GoogleAuthProvider();

// ★ ここが重要：毎回アカウント選択を強制
provider.setCustomParameters({
  prompt: "select_account",
});

/* ===== UI ヘルパー ===== */
const msgEl = document.getElementById("msg");
const btnEl = document.getElementById("btnLogin");

function setMsg(text) {
  msgEl.textContent = text;
}

function disableBtn(disabled) {
  btnEl.disabled = disabled;
}

/* ===== ログイン処理 ===== */
btnEl.addEventListener("click", async () => {
  setMsg("");
  disableBtn(true);

  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    // ここでは「初回かどうか」は判定しない
    // → 次画面で ANK 側の状態を確認する
    console.log("login user:", user.email);

    // 次の画面へ
    location.href = "/ank-knowledge/contracts.html";

  } catch (err) {
    console.error(err);

    // ポップアップブロック専用メッセージ
    if (
      err.code === "auth/popup-blocked" ||
      err.code === "auth/popup-closed-by-user"
    ) {
      setMsg("ログインできませんでした。ポップアップがブロックされていないか確認してください。");
    } else {
      setMsg("ログインに失敗しました。時間をおいて再度お試しください。");
    }
  } finally {
    disableBtn(false);
  }
});
