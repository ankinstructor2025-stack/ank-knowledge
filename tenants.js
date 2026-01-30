import { initFirebase } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const { auth } = initFirebase();

const params = new URLSearchParams(location.search);
const accountId = params.get("account_id");

const debugInfo = document.getElementById("debugInfo");
const btnCreate = document.getElementById("btnCreate");
const btnReload = document.getElementById("btnReload");
const tenantName = document.getElementById("tenantName");

const createStatus = document.getElementById("createStatus");
const listStatus = document.getElementById("listStatus");
const tbody = document.getElementById("rows");

function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = "status " + (type || "");
  el.style.display = msg ? "block" : "none";
}

function yen(n) {
  if (n == null || n === "" || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("ja-JP") + "円";
}

function pill(text, kind) {
  const span = document.createElement("span");
  span.className = "pill " + (kind || "");
  span.textContent = text;
  return span;
}

function gotoTenantAdmin(tenantId, tab) {
  const t = encodeURIComponent(tenantId);
  const a = encodeURIComponent(accountId || "");
  const tb = encodeURIComponent(tab || "contract");
  location.href = `./tenant_admin.html?tenant_id=${t}&account_id=${a}&tab=${tb}`;
}

function renderTenants(list) {
  tbody.innerHTML = "";

  if (!list || list.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "テナントがありません。まずは上のフォームから作成してください。";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const t of list) {
    const tenantId = t.tenant_id;
    const name = t.name || tenantId;

    // ※ここはデータ構造を変えない（内部名はそのまま）
    const contractStatus = (t.contract_status || "draft").toLowerCase();
    const isActive = (contractStatus === "active");
    const paid = !!t.payment_method_configured;

    const seat = (t.seat_limit != null) ? `${t.seat_limit}人` : "-";
    const kc = (t.knowledge_count != null) ? `${t.knowledge_count}` : "-";
    const monthly = (t.monthly_amount_yen != null) ? yen(t.monthly_amount_yen) : "-";

    const tr = document.createElement("tr");

    // テナント
    const tdName = document.createElement("td");
    tdName.dataset.label = "テナント";
    const divName = document.createElement("div");
    divName.className = "name";
    divName.textContent = name;
    const divId = document.createElement("div");
    divId.innerHTML = `<code>${tenantId}</code>`;
    tdName.appendChild(divName);
    tdName.appendChild(divId);

    // 状態
    const tdStatus = document.createElement("td");
    tdStatus.dataset.label = "状態";

    // 表示名だけ分かりやすくする（値は変えない）
    const statusLabel = (contractStatus === "active") ? "active" : "draft";
    const payLabel = paid ? "paid" : "unpaid";

    const p1 = pill(statusLabel, isActive ? "ok" : "warn");
    const p2 = pill(payLabel, paid ? "ok" : "warn");
    tdStatus.appendChild(p1);
    tdStatus.appendChild(document.createTextNode(" "));
    tdStatus.appendChild(p2);

    // プラン
    const tdPlan = document.createElement("td");
    tdPlan.dataset.label = "プラン";
    tdPlan.innerHTML = `
      <div>人数: <strong>${seat}</strong></div>
      <div>ナレッジ: <strong>${kc}</strong></div>
      <div>月額: <strong>${monthly}</strong></div>
    `;

    // 操作
    const tdBtns = document.createElement("td");
    tdBtns.dataset.label = "操作";
    const box = document.createElement("div");
    box.className = "btns";

    const bContract = document.createElement("button");
    bContract.textContent = "プラン";
    bContract.onclick = () => gotoTenantAdmin(tenantId, "contract");
    box.appendChild(bContract);

    const bUsers = document.createElement("button");
    bUsers.textContent = "ユーザー管理";
    bUsers.disabled = !isActive;
    bUsers.title = isActive ? "" : "プランを確定してから利用できます";
    bUsers.onclick = () => gotoTenantAdmin(tenantId, "users");
    box.appendChild(bUsers);

    const bKnow = document.createElement("button");
    bKnow.textContent = "ナレッジ管理";
    bKnow.disabled = !isActive;
    bKnow.title = isActive ? "" : "プランを確定してから利用できます";
    bKnow.onclick = () => gotoTenantAdmin(tenantId, "knowledge");
    box.appendChild(bKnow);

    tdBtns.appendChild(box);

    tr.appendChild(tdName);
    tr.appendChild(tdStatus);
    tr.appendChild(tdPlan);
    tr.appendChild(tdBtns);

    tbody.appendChild(tr);
  }
}

async function loadTenants(user) {
  setStatus(listStatus, "読み込み中…", "ok");
  const res = await apiFetch(
    user,
    `/v1/tenants?account_id=${encodeURIComponent(accountId)}`,
    { method: "GET" }
  );
  const list = res.tenants || [];
  renderTenants(list);
  setStatus(listStatus, `表示件数: ${list.length}`, "ok");
}

debugInfo.textContent = `account_id=${accountId || "(none)"}`;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("./login.html");
    return;
  }
  if (!accountId) {
    setStatus(listStatus, "URLに account_id がありません。tenants.html?account_id=... の形式で開いてください。", "err");
    return;
  }

  try {
    await loadTenants(user);
  } catch (e) {
    console.error(e);
    setStatus(listStatus, e?.message || String(e), "err");
  }
});

btnReload.addEventListener("click", async () => {
  if (!auth.currentUser) return;
  try {
    await loadTenants(auth.currentUser);
  } catch (e) {
    console.error(e);
    setStatus(listStatus, e?.message || String(e), "err");
  }
});

btnCreate.addEventListener("click", async (ev) => {
  ev.preventDefault();
  if (!auth.currentUser) return;

  try {
    setStatus(createStatus, "作成中…", "ok");

    const res = await apiFetch(
      auth.currentUser,
      "/v1/tenant",
      {
        method: "POST",
        body: {
          account_id: accountId,
          name: tenantName.value.trim()
        }
      }
    );

    const tid = res.tenant_id;
    setStatus(createStatus, `作成しました: ${tid}`, "ok");
    tenantName.value = "";

    // 一覧更新
    await loadTenants(auth.currentUser);

    // すぐプラン（旧 contract）タブへ入る
    gotoTenantAdmin(tid, "contract");

  } catch (e) {
    console.error(e);
    setStatus(createStatus, e?.message || String(e), "err");
  }
});
