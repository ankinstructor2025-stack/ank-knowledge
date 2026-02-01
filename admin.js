// admin_main.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

import { state, dom, bindDom } from "./admin_state.js";
import { setActiveTab } from "./admin_utils.js";
import { createApi } from "./admin_api.js";
import { createPricingModule } from "./admin_pricing.js";
import { createContractModule } from "./admin_contract.js";
import { createUsersModule } from "./admin_users.js";
import { context } from "./shared/context.js";

// === single-tab only: 別タブ遷移禁止 ===
window.open = function () {
  throw new Error("window.open is disabled (admin is single-tab only)");
};

document.addEventListener("DOMContentLoaded", () => {
  // <a target="_blank"> を無効化
  document.querySelectorAll('a[target="_blank"]').forEach(a => {
    a.removeAttribute("target");
    a.removeAttribute("rel");
  });
});

const firebaseConfig = {
  apiKey: "AIzaSyBpHlwulq6lnbmBzNm0rEYNahWk7liD3BM",
  authDomain: "ank-project-77283.firebaseapp.com",
  projectId: "ank-project-77283",
  storageBucket: "ank-project-77283.firebasestorage.app",
  messagingSenderId: "707356972093",
  appId: "1:707356972093:web:03d20f1c1e5948150f8654",
};

const API_BASE = "https://ank-admin-api-986862757498.asia-northeast1.run.app";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

bindDom();

const api = createApi({ API_BASE, state });
const pricingModule = createPricingModule({ state, dom, api });
const contractModule = createContractModule({ state, dom, api, pricingModule });
const usersModule = createUsersModule({ state, dom, api });

dom.tabContract.addEventListener("click", () => setActiveTab(dom, "contract"));
dom.tabUsers.addEventListener("click", () => setActiveTab(dom, "users"));

dom.logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  location.href = "./login.html";
});

pricingModule.bindPricingEvents();
contractModule.bindContractEvents();
usersModule.bindUserEvents();

onAuthStateChanged(auth, async (u) => {
  if (!u) {
    location.replace("./login.html");
    return;
  }

  document.body.style.display = "block";
  // ★追加：ログイン時に作業コンテキストを確定（QA-only前提）
  try {
    await context.bootstrap(api.fetch.bind(api), { endpoint: "/v1/session" });
  } catch (e) {
    console.error("context bootstrap failed:", e);
    // tenant が取れない＝作業不能。loginへ戻す（ループしない）
    location.replace("./login.html");
    return;
  }
  state.currentUser = u;

  setActiveTab(dom, "contract");

  await pricingModule.loadPricing();
  const me = await usersModule.checkUser();
  state.myUserId = me.user_id;

  await contractModule.loadContract();

  if (me.isContracted) {
    // 将来: users一覧APIができたらここでロード
    await usersModule.loadUsers();
  }
});
