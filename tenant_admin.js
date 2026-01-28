import { initFirebase } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const { auth } = initFirebase();

const params = new URLSearchParams(location.search);
const tenantId = params.get("tenant_id");
const accountId = params.get("account_id");

const elTitle = document.getElementById("title");
const elSub = document.getElementById("sub");
const elTenantId = document.getElementById("tenantId");
const elName = document.getElementById("tenantName");
const elStatus = document.getElementById("tenantStatus");

const btnSearch = document.getElementById("btnSearch");
const btnBack = document.getElementById("btnBack");

function goto(path) {
  location.href = path;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("./login.html");
    return;
  }
  if (!tenantId) {
    elSub.textContent = "tenant_id がありません";
    return;
  }

  elTenantId.textContent = tenantId;

  try {
    // 表示用：tenant.json を読むAPI
    const res = await apiFetch(
      user,
      `/v1/tenant?tenant_id=${encodeURIComponent(tenantId)}&account_id=${encodeURIComponent(accountId || "")}`,
      { method: "GET" }
    );

    elTitle.textContent = res.name ? `テナント管理：${res.name}` : "テナント管理";
    elName.textContent = res.name || "(未設定)";
    elStatus.textContent = res.status || "active";

  } catch (e) {
    console.error(e);
    elSub.textContent = e.message || String(e);
  }
});

btnSearch.onclick = () => {
  goto(`./qa_search.html?tenant_id=${encodeURIComponent(tenantId)}`);
};

btnBack.onclick = () => {
  if (accountId) {
    goto(`./tenants.html?account_id=${encodeURIComponent(accountId)}`);
  } else {
    goto("./accounts.html");
  }
};
