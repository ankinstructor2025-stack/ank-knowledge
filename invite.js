import { initFirebase } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const LOGIN_URL = "./login.html";
const INVITE_TOKEN_KEY = "ank_invite_token";

const { auth } = initFirebase();

// DOM（invite.htmlに合わせる） :contentReference[oaicite:1]{index=1}
const elDesc = document.getElementById("desc");
const elTokenInfo = document.getElementById("tokenInfo");
const elStatus = document.getElementById("status");
const acceptBtn = document.getElementById("acceptBtn");
const clearBtn = document.getElementById("clearBtn");

// utils
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

function gotoLogin(returnToUrl) {
  const returnTo = encodeURIComponent(returnToUrl);
  window.location.replace(`${LOGIN_URL}?return_to=${returnTo}`);
}

(async function main() {
  // 1) URL token があれば保存（招待メールから開いた時）
  const queryToken = getQueryToken();
  if (queryToken) saveToken(queryToken);

  // 2) token が無ければ終了（未ログインでも表示はする）
  const token = loadToken();
  if (!token) {
    elDesc.textContent = "招待情報が見つかりません。招待メールのリンクから開き直してください。";
    elTokenInfo.textContent = "";
    setStatus("token が見つかりません。", "error");
    acceptBtn.disabled = true;
    return;
  }

  // 3) 初期表示
  elDesc.textContent = "招待を承諾する場合は、下のボタンを押してください。";
  elTokenInfo.textContent = `招待トークン: ${token.slice(0, 8)}…`;
  acceptBtn.disabled = true;

  let currentUser = null;

  function refreshUI() {
    // 未ログインでもページは見せる。ボタンはログイン誘導。
    if (!currentUser) {
      acceptBtn.disabled = false;
      acceptBtn.textContent = "ログインして参加を確定する";
      setStatus("未ログインです。ボタンを押すとログイン画面へ移動します。", "");
      return;
    }

    acceptBtn.disabled = false;
    acceptBtn.textContent = "参加を確定する";
    setStatus("ログイン済みです。参加を確定できます。", "");
  }

  // 4) 認証状態の監視（未ログインでもリダイレクトしない）
  onAuthStateChanged(auth, (u) => {
    currentUser = u;
    refreshUI();
  });

  // 5) 承諾
  acceptBtn.onclick = async () => {
    acceptBtn.disabled = true;

    // 未ログインならログインへ（return_toでこのページに戻す）
    if (!currentUser) {
      setStatus("ログイン画面へ移動します。", "");
      gotoLogin(window.location.href);
      return;
    }

    // ログイン済みなら consume を叩いて user_contracts を active 化
    try {
      setStatus("参加処理中…", "");
      await apiFetch(currentUser, "/v1/invites/consume", {
        method: "POST",
        body: { token },
      });

      clearToken();
      setStatus("参加が確定しました。メイン画面へ移動します。", "ok");
      setTimeout(() => {
        window.location.replace("./index.html");
      }, 500);
    } catch (e) {
      setStatus(e?.message || String(e), "error");
      acceptBtn.disabled = false;
    }
  };

  // 6) 招待情報を消す（ローカルだけ）
  clearBtn.onclick = () => {
    clearToken();
    setStatus("招待情報を削除しました。", "");
    elTokenInfo.textContent = "";
    acceptBtn.disabled = true;
  };

  // 初期描画
  refreshUI();
})();
