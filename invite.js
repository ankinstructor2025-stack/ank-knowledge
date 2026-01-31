import { initFirebase } from "./ank_firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const LOGIN_URL = "./login.html";
const INVITE_TOKEN_KEY = "ank_invite_token";
// “参加確定した”扱いを一時的にローカルへ残す（将来は user.json 等へ移行）
const INVITE_ACCEPTED_KEY = "ank_invite_accepted_tokens";

const { auth } = initFirebase();

// DOM（invite.htmlに合わせる）
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

function loadAcceptedTokens() {
  try {
    return JSON.parse(localStorage.getItem(INVITE_ACCEPTED_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveAcceptedToken(token) {
  const arr = loadAcceptedTokens();
  if (!arr.includes(token)) arr.push(token);
  localStorage.setItem(INVITE_ACCEPTED_KEY, JSON.stringify(arr));
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
  elDesc.textContent = "招待を確認しました。下のボタンでログインへ進みます。";
  elTokenInfo.textContent = `招待トークン: ${token.slice(0, 8)}…`;
  acceptBtn.disabled = true;

  let currentUser = null;

  function refreshUI() {
    // 未ログインでもページは見せる。ボタンはログイン誘導。
    if (!currentUser) {
      acceptBtn.disabled = false;
      acceptBtn.textContent = "ログインして続ける";
      setStatus("未ログインです。ボタンを押すとログイン画面へ移動します。", "");
      return;
    }

    acceptBtn.disabled = false;
    acceptBtn.textContent = "次へ進む";
    setStatus(
      "ログイン済みです。この画面では DB へ書き込みはしません（移行中のため）。\n次へ進むと、招待トークンを保持したままメイン画面へ移動します。",
      ""
    );
  }

  // 4) 認証状態の監視（未ログインでもリダイレクトしない）
  onAuthStateChanged(auth, (u) => {
    currentUser = u;
    refreshUI();
  });

  // 5) 次へ（DBアクセスを止めるため API 呼び出しはしない）
  acceptBtn.onclick = async () => {
    acceptBtn.disabled = true;

    // 未ログインならログインへ（return_toでこのページに戻す）
    if (!currentUser) {
      setStatus("ログイン画面へ移動します。", "");
      gotoLogin(window.location.href);
      return;
    }

    // ログイン済み：DBへは触らず、ローカルに「承認済み」印を付けて index へ
    try {
      setStatus("遷移します…", "");
      saveAcceptedToken(token);

      // token は保持（あとで index 側で user.json 反映などに使う前提）
      window.location.replace("./index.html");
    } catch (e) {
      setStatus(e?.message || String(e), "error");
      acceptBtn.disabled = false;
    }
  };

  // 6) 招待情報を消す（ローカルだけ）
  clearBtn.onclick = () => {
    clearToken();
    localStorage.removeItem(INVITE_ACCEPTED_KEY);
    setStatus("招待情報を削除しました。", "");
    elTokenInfo.textContent = "";
    acceptBtn.disabled = true;
  };

  // 初期描画
  refreshUI();
})();
