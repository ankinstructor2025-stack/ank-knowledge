// ank_firebase.js（共通）
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

/**
 * ログイン必須画面で使う
 * - "一瞬null" を即未ログイン扱いにしない
 * - 少し待っても user が来なければ login へ
 */
export async function requireUser(auth, { loginUrl = "./contracts.html", waitMs = 3000 } = {}) {
  // まず currentUser が既にあるなら即返す
  if (auth.currentUser) return auth.currentUser;

  // authStateReady がある環境はそれを優先
  if (typeof auth.authStateReady === "function") {
    await auth.authStateReady();
    if (auth.currentUser) return auth.currentUser;

    location.replace(loginUrl);
    throw new Error("not signed in");
  }

  // フォールバック：一定時間 user を待つ（nullを即判定しない）
  const u = await new Promise((resolve) => {
    const start = Date.now();
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        unsub();
        resolve(user);
        return;
      }

      // null が来ても即リダイレクトせず、waitMs だけ待つ
      if (Date.now() - start >= waitMs) {
        unsub();
        resolve(null);
      }
    });

    // 念のためのタイムアウト（コールバックが来ないケース）
    setTimeout(() => {
      try { unsub(); } catch {}
      resolve(auth.currentUser || null);
    }, waitMs + 500);
  });

  if (!u) {
    location.replace(loginUrl);
    throw new Error("not signed in");
  }
  return u;
}
