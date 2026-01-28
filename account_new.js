import { initFirebase } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const { auth } = initFirebase();

const btnCreate = document.getElementById("btnCreate");
const elStatus = document.getElementById("status");
const elName = document.getElementById("accountName");

function setStatus(msg, type = "") {
  elStatus.textContent = msg;
  elStatus.className = "status " + type;
}

function goto(path) {
  location.href = path;
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    location.replace("./login.html");
  }
});

btnCreate.onclick = async () => {
  try {
    setStatus("作成中…");

    const name = elName.value.trim();

    const res = await apiFetch(
      auth.currentUser,
      "/v1/account",
      {
        method: "POST",
        body: { name }
      }
    );

    // account_id が返ってくる想定
    const accountId = res.account_id;

    setStatus("作成しました。移動します。", "ok");

    setTimeout(() => {
      goto(`./tenants.html?account_id=${encodeURIComponent(accountId)}`);
    }, 400);

  } catch (e) {
    console.error(e);
    setStatus(e.message || String(e), "error");
  }
};
