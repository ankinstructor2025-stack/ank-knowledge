import { initFirebase } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const LOGIN_URL = "./login.html";
const INVITE_TOKEN_KEY = "ank_invite_token";

const { auth } = initFirebase();

// DOM
const elDesc = document.getElementById("desc");
const elTokenInfo = document.getElementById("tokenInfo");
const elStatus = document.getElementById("status");
const loginBtn = document.getElementById("loginBtn");
const acceptBtn = document.getElementById("acceptBtn");
const clearBtn = document.getElementById("clearBtn");

function setStatus(msg, type = "") {
  elStatus.style.display = "block";
  elStatus.className = "status " + type;
  elStatus.textContent = msg;
}
function getQueryToken() {
  const u = new URL(window.location.href);
  return u.searchParams.get("token");
}
function saveToken(token) { localStorage.setItem(INVITE_TOKEN_KEY, token); }
function loadToken() { return localStorage.getItem(INVITE_TOKEN_KEY); }
function clearToken() { localStorage.removeItem(INVITE_TOKEN_KEY); }
function gotoLogin() {
  const returnTo = encodeURIComponent(window.location.href);
  window.location.href = `${LOGIN_URL}?return_to=${returnTo}`;
}

(async function main() {
  const queryToken = getQueryToken();
  if (queryToken) saveToken(queryToken);

  const token = loadToken();
  if (!token) {
    elDesc.textContent = "招待情報が見つかりません。招待メールのリンクから開き直してください。";
    setStatus("token が見つかりません。", "error");
    acceptBtn.disabled = true;
    return;
  }

  elDesc.textContent = "この招待で参加する場合、ログイン後に「参加を確定する」を押してください。";
  elTokenInfo.textContent = `招待トークン: ${token.slice(0, 8)}...`;

  loginBtn.onclick = gotoLogin;

  let currentUser = null;
  acceptBtn.disabled = true;
  setStatus("未ログインです。ログインしてください。");

  // ✅ modular 正式形
  onAuthStateChanged(auth, (u) => {
    currentUser = u;
    acceptBtn.disabled = !u;
    setStatus(u ? "ログイン済みです。参加を確定できます。" : "未ログインです。ログインしてください。");
  });

  acceptBtn.onclick = async () => {
    acceptBtn.disabled = true;
    try {
      setStatus("参加処理中...");

      if (!currentUser) throw new Error("未ログインです");

      await apiFetch(currentUser, "/v1/invites/consume", {
        method: "POST",
        body: { token },
      });

      clearToken();
      setStatus("参加が確定しました。", "ok");
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
