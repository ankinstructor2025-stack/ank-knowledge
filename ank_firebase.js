// ank_firebase.js（共通）
// Firebase v12 modular に統一

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBpHlwulq6lnbmBzNm0rEYNahWk7liD3BM",
  authDomain: "ank-project-77283.firebaseapp.com",
  projectId: "ank-project-77283",
  storageBucket: "ank-project-77283.firebasestorage.app",
  messagingSenderId: "707356972093",
  appId: "1:707356972093:web:03d20f1c1e5948150f8654",
};

export function initFirebase() {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  return { app, auth };
}

// ログイン必須画面で使う（未ログインなら login へ飛ばす）
export async function requireUser(auth, { loginUrl = "./login.html" } = {}) {
  // v12 は authStateReady() が使える。初期化完了後に currentUser を確定させる
  if (typeof auth.authStateReady === "function") {
    await auth.authStateReady();
    const u = auth.currentUser;
    if (!u) {
      location.replace(loginUrl);
      throw new Error("not signed in");
    }
    return u;
  }

  // フォールバック（古い環境向け）
  return await new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) return;
      unsub();
      resolve(u);
    });
    // それでも取れなければ未ログイン扱い
    setTimeout(() => {
      unsub();
      location.replace(loginUrl);
    }, 1200);
  });
}
