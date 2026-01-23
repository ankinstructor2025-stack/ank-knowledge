// ================== 設定 ==================

// login.html / admin.html と同じ Firebase 設定にする
const firebaseConfig = {
  apiKey: "AIzaSyBpHlwulq6lnbmBzNm0rEYNahWk7liD3BM",
  authDomain: "ank-project-77283.firebaseapp.com",
  projectId: "ank-project-77283",
  storageBucket: "ank-project-77283.firebasestorage.app",
  messagingSenderId: "707356972093",
  appId: "1:707356972093:web:03d20f1c1e5948150f8654"
};

// Cloud Run API
const API_BASE = "https://ank-admin-api-986862757498.asia-northeast1.run.app";

// ログイン画面
const LOGIN_URL = "./login.html";

// localStorage key
const INVITE_TOKEN_KEY = "ank_invite_token";

// ==========================================

// Firebase init（多重初期化ガード）
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// DOM
const elDesc = document.getElementById("desc");
const elTokenInfo = document.getElementById("tokenInfo");
const elStatus = document.getElementById("status");
const loginBtn = document.getElementById("loginBtn");
const acceptBtn = document.getElementById("acceptBtn");
const clearBtn = document.getElementById("clearBtn");

// ---------- utils ----------

function setStatus(msg, type = "") {
  elStatus.style.display = "block";
  elStatus.className = "status " + type;
  elStatus.textContent = msg;
}

function getQueryToken() {
  const u = new URL(window.location.href);
  return u.searchParams.get("token");
}

function saveToken(token) {
  localStorage.setItem(INVITE_TOKEN_KEY, token);
}

function loadToken() {
  return localStorage.getItem(INVITE_TOKEN_KEY);
}

function clearToken() {
  localStorage.removeItem(INVITE_TOKEN_KEY);
}

async function apiFetch(path, { method = "GET", body = null, idToken = null } = {}) {
  const headers = {};
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || `API error ${res.status}`);
  }
  return data;
}

function gotoLogin() {
  const returnTo = encodeURIComponent(window.location.href);
  window.location.href = `${LOGIN_URL}?return_to=${returnTo}`;
}

// ---------- main ----------

(async function main() {
  const queryToken = getQueryToken();
  if (queryToken) {
    saveToken(queryToken);
  }

  const token = loadToken();
  if (!token) {
    elDesc.textContent = "招待情報が見つかりません。招待メールのリンクから開き直してください。";
    setStatus("token が見つかりません。", "error");
    return;
  }

  elDesc.textContent = "この招待で参加する場合、ログイン後に「参加を確定する」を押してください。";
  elTokenInfo.innerHTML = `招待トークン: <code>${token.slice(0, 8)}...</code>`;

  // 認証状態監視
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      acceptBtn.disabled = true;
      setStatus("未ログインです。ログインしてください。");
      return;
    }

    acceptBtn.disabled = false;
    setStatus("ログイン済みです。参加を確定できます。");
  });

  // events
  loginBtn.onclick = gotoLogin;

  acceptBtn.onclick = async () => {
    acceptBtn.disabled = true;
    try {
      setStatus("参加処理中...");
      const user = firebase.auth().currentUser;
      if (!user) throw new Error("未ログインです");

      const idToken = await user.getIdToken(true);
      await apiFetch("/v1/invites/consume", {
        method: "POST",
        idToken,
        body: { token },
      });

      clearToken();
      setStatus("参加が確定しました。", "ok");
      // window.location.href = "./qa_search.html"; // 任意
    } catch (e) {
      setStatus(e.message, "error");
      acceptBtn.disabled = false;
    }
  };

  clearBtn.onclick = () => {
    clearToken();
    setStatus("招待情報を削除しました。", "");
  };
})();
