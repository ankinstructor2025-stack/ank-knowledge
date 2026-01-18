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

function setMsg(text) {
  const el = document.getElementById("msg");
  if (el) el.textContent = text;
}

function disableBtn(disabled) {
  const btn = document.getElementById("btnLogin");
  if (btn) btn.disabled = disabled;
}

try {
  // firebaseConfig 未設定チェック
  if (!firebaseConfig || !firebaseConfig.apiKey) {
    setMsg("firebaseConfig が未設定です（Firebase コンソールの設定を login.js に貼り付けてください）");
    disableBtn(true);
  } else {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();

    document.getElementById("btnLogin").addEventListener("click", async () => {
      disableBtn(true);
      setMsg("ログインしています…");
      try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        setMsg(`ログイン成功：${user.email}`);
        // TODO: ここで管理画面へ遷移
        // location.href = "./admin.html";
      } catch (e) {
        console.error(e);
        setMsg("ログインに失敗しました（ポップアップ許可、またはFirebase設定を確認してください）");
      } finally {
        disableBtn(false);
      }
    });
  }
} catch (e) {
  console.error(e);
  setMsg("初期化に失敗しました（firebaseConfig の貼り付け内容を確認してください）");
  disableBtn(true);
}
