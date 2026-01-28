import { initFirebase } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const { auth } = initFirebase();

const params = new URLSearchParams(location.search);
const accountId = params.get("account_id");

const ul = document.getElementById("tenantList");
const btnCreate = document.getElementById("btnCreate");
const nameInput = document.getElementById("tenantName");
const createStatus = document.getElementById("createStatus");
const listStatus = document.getElementById("listStatus");
const debugInfo = document.getElementById("debugInfo");

function setCreate(msg, cls = "") {
  createStatus.textContent = msg;
  createStatus.className = "status " + cls;
}
function setList(msg, cls = "") {
  listStatus.textContent = msg;
  listStatus.className = "status " + cls;
}

function renderTenants(list) {
  ul.innerHTML = "";
  if (!list || list.length === 0) {
    ul.innerHTML = "<li>まだテナントがありません</li>";
    return;
  }
  for (const t of list) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `./qa_search.html?tenant_id=${encodeURIComponent(t.tenant_id)}`;
    a.textContent = t.name || t.tenant_id;
    li.appendChild(a);
    ul.appendChild(li);
  }
}

async function loadTenants(user) {
  setList("読み込み中…");
  const res = await apiFetch(user, `/v1/tenants?account_id=${encodeURIComponent(accountId)}`, { method: "GET" });
  renderTenants(res.tenants || []);
  setList(`表示件数: ${(res.tenants || []).length}`, "ok");
}

debugInfo.textContent = `JS起動OK / account_id=${accountId || "(none)"}`;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("./login.html");
    return;
  }
  if (!accountId) {
    setList("URLに account_id がありません。tenants.html?account_id=... の形式で開いてください。", "err");
    return;
  }
  try {
    await loadTenants(user);
  } catch (e) {
    console.error(e);
    setList(e?.message || String(e), "err");
  }
});

btnCreate.addEventListener("click", async (ev) => {
  ev.preventDefault();

  // ここが出なければ「クリックが発火してない」
  setCreate("クリック検知…", "ok");
  console.log("btnCreate clicked");

  try {
    if (!auth.currentUser) throw new Error("not signed in");
    if (!accountId) throw new Error("account_id missing");

    setCreate("作成API呼び出し中…");

    const res = await apiFetch(
      auth.currentUser,
      "/v1/tenant",
      {
        method: "POST",
        body: {
          account_id: accountId,
          name: nameInput.value.trim()
        }
      }
    );

    console.log("create tenant ok", res);
    setCreate(`作成しました: ${res.tenant_id}`, "ok");
    nameInput.value = "";

    await loadTenants(auth.currentUser);

  } catch (e) {
    console.error(e);
    setCreate(e?.message || String(e), "err");
  }
});
