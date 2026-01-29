// tenant_admin.js
import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

const { auth } = initFirebase();

// =========================
// URL params
// =========================
const qs = new URLSearchParams(location.search);
const tenantId = (qs.get("tenant_id") || "").trim();   // 空でも動かす（初回契約で作る想定）
const accountId = (qs.get("account_id") || "").trim();
const tab = (qs.get("tab") || "contract").trim();

// =========================
// DOM
// =========================
const metaLine = document.getElementById("metaLine");
const backBtn = document.getElementById("backBtn");

const tabContract = document.getElementById("tabContract");
const tabUsers = document.getElementById("tabUsers");
const tabKnowledge = document.getElementById("tabKnowledge");

const panelContract = document.getElementById("panelContract");
const panelUsers = document.getElementById("panelUsers");
const panelKnowledge = document.getElementById("panelKnowledge");

const noteEl = document.getElementById("note");

const kpiBase = document.getElementById("kpiBase");
const kpiExtra = document.getElementById("kpiExtra");
const kpiMonthly = document.getElementById("kpiMonthly");

const btnPayDummy = document.getElementById("btnPayDummy");
const statusEl = document.getElementById("status");

const plansGrid = document.getElementById("plansGrid");

// =========================
// UI helpers
// =========================
function showPanel(name) {
  panelContract.style.display = (name === "contract") ? "" : "none";
  panelUsers.style.display = (name === "users") ? "" : "none";
  panelKnowledge.style.display = (name === "knowledge") ? "" : "none";
}

function goTab(next) {
  // tenant_id が空のときは、空のまま遷移（初回契約で tenant_id が返る想定）
  location.href =
    `./tenant_admin.html?tenant_id=${encodeURIComponent(tenantId)}` +
    `&account_id=${encodeURIComponent(accountId)}` +
    `&tab=${encodeURIComponent(next)}`;
}

tabContract.onclick = () => goTab("contract");
tabUsers.onclick = () => goTab("users");
tabKnowledge.onclick = () => goTab("knowledge");

backBtn.onclick = () => {
  location.href = `./tenants.html?account_id=${encodeURIComponent(accountId)}`;
};

function setStatus(msg, type = "") {
  statusEl.className = "status " + (type || "");
  statusEl.textContent = msg || "";
  statusEl.style.display = msg ? "block" : "none";
}

function yen(n) {
  if (n == null || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("ja-JP") + "円";
}

function clampNote(s) {
  const t = (s ?? "").trim();
  return t.length <= 400 ? t : t.slice(0, 400);
}

// =========================
// API
// =========================
async function loadTenant(currentUser) {
  // tenant_id が無いなら読み込めない（初回契約は /v1/contract で作る）
  if (!tenantId) return null;

  return await apiFetch(
    currentUser,
    `/v1/tenant?tenant_id=${encodeURIComponent(tenantId)}&account_id=${encodeURIComponent(accountId)}`,
    { method: "GET" }
  );
}

async function loadPlans(currentUser) {
  // tenants.py に追加した GET /v1/plans を叩く
  return await apiFetch(currentUser, "/v1/plans", { method: "GET" });
}

// =========================
// Render
// =========================
function clearGrid() {
  plansGrid.innerHTML = "";
}

function makeCard(plan, currentPlanId, onSelect) {
  const card = document.createElement("div");
  card.style.background = "#fff";
  card.style.border = "1px solid #e5e7eb";
  card.style.borderRadius = "14px";
  card.style.padding = "14px";
  card.style.display = "flex";
  card.style.flexDirection = "column";
  card.style.gap = "10px";

  // タイトル行
  const head = document.createElement("div");
  head.style.display = "flex";
  head.style.justifyContent = "space-between";
  head.style.alignItems = "center";

  const title = document.createElement("div");
  title.textContent = plan.label;
  title.style.fontWeight = "800";
  title.style.fontSize = "16px";

  const badge = document.createElement("div");
  badge.textContent = plan.plan_id;
  badge.style.fontSize = "11px";
  badge.style.padding = "3px 8px";
  badge.style.borderRadius = "999px";
  badge.style.border = "1px solid #dbe0ea";
  badge.style.background = "#f3f5fb";

  head.appendChild(title);
  head.appendChild(badge);
  card.appendChild(head);

  // 月額
  const price = document.createElement("div");
  if (Number(plan.monthly_price) === 0) {
    price.textContent = "月額 0円（QA生成は都度課金）";
  } else {
    price.textContent = `月額 ${yen(plan.monthly_price)}`;
  }
  price.style.fontSize = "14px";
  card.appendChild(price);

  // 説明文
  (plan.descriptions || []).forEach(t => {
    const d = document.createElement("div");
    d.className = "muted";
    d.textContent = t;
    card.appendChild(d);
  });

  // 箇条書き
  if (Array.isArray(plan.bullets) && plan.bullets.length) {
    const ul = document.createElement("ul");
    ul.style.paddingLeft = "18px";
    ul.style.margin = "6px 0";
    plan.bullets.forEach(t => {
      const li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    });
    card.appendChild(ul);
  }

  // 補足
  (plan.notes || []).forEach(t => {
    const n = document.createElement("div");
    n.className = "muted";
    n.style.fontSize = "12px";
    n.textContent = t;
    card.appendChild(n);
  });

  // 契約ボタン（文言変更）
  const btn = document.createElement("button");
  btn.textContent =
    plan.plan_id === currentPlanId ? "選択中" : "このプランで契約";
  btn.disabled = plan.plan_id === currentPlanId;
  btn.style.marginTop = "auto";
  btn.style.border = "0";
  btn.style.borderRadius = "10px";
  btn.style.padding = "10px 12px";
  btn.style.cursor = btn.disabled ? "not-allowed" : "pointer";
  btn.style.fontWeight = "800";
  btn.style.background = btn.disabled ? "#9db8a5" : "#1f7a39";
  btn.style.color = "#fff";
  btn.onclick = () => onSelect(plan);

  card.appendChild(btn);

  return card;
}

// =========================
// Actions
// =========================
async function createOrUpdateContractAndGoQa(currentUser, plan) {
  try {
    // 既存テナントがあるならチェック（支払い設定済みは変更不可）
    const tenant = await loadTenant(currentUser);
    if (tenant?.payment_method_configured) {
      throw new Error("支払い設定が完了しているため、契約は変更できません。");
    }

    const note = clampNote(noteEl?.value || "");

    // ★ tenant と contract を作る/更新するAPI（サーバ側で実装する想定）
    // 返り値: { tenant_id, contract_id }
    const res = await apiFetch(currentUser, "/v1/contract", {
      method: "POST",
      body: {
        account_id: accountId,
        tenant_id: tenantId || null,                 // 初回は null でOK
        plan_id: plan.plan_id,
        monthly_amount_yen: Number(plan.monthly_price),
        note
      }
    });

    const newTenantId = (res?.tenant_id || "").trim();
    const contractId = (res?.contract_id || "").trim();

    if (!newTenantId || !contractId) {
      throw new Error("契約作成に失敗しました（tenant_id / contract_id が返っていません）。");
    }

    // KPI更新（表示用）
    kpiBase.textContent = yen(plan.monthly_price);
    kpiExtra.textContent = "0円";
    kpiMonthly.textContent = yen(plan.monthly_price);

    setStatus("契約しました。QA作成へ移動します。", "ok");

    // ★ 支払い設定は必須にしない：契約できたらQA作成へ
    // ここは実ファイル名に合わせて変更
    location.href =
      `./qa_generate.html?contract_id=${encodeURIComponent(contractId)}` +
      `&tenant_id=${encodeURIComponent(newTenantId)}` +
      `&account_id=${encodeURIComponent(accountId)}`;
  } catch (e) {
    console.error(e);
    setStatus(e?.message || String(e), "err");
  }
}

async function markPaid(currentUser) {
  btnPayDummy.disabled = true;
  try {
    if (!tenantId) throw new Error("tenant_id がありません。先に契約を作成してください。");

    await apiFetch(currentUser, "/v1/tenant/mark-paid", {
      method: "POST",
      body: { account_id: accountId, tenant_id: tenantId }
    });
    setStatus("支払い設定完了（仮）にしました。以後、契約は変更不可です。", "ok");
  } catch (e) {
    console.error(e);
    setStatus(e?.message || String(e), "err");
  } finally {
    btnPayDummy.disabled = false;
  }
}

// =========================
// Main render
// =========================
async function renderContractTab(currentUser) {
  const tenant = await loadTenant(currentUser); // tenantId空ならnull
  const raw = await loadPlans(currentUser);

  const plans = Array.isArray(raw?.plans) ? raw.plans : [];
  if (!plans.length) {
    setStatus("plans.json が空です", "err");
    return;
  }

  clearGrid();
  plansGrid.style.display = "grid";
  plansGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(240px, 1fr))";
  plansGrid.style.gap = "12px";

  const currentPlanId = (tenant?.plan_id || "").trim();

  plans.forEach(plan => {
    const card = makeCard(plan, currentPlanId, p =>
      createOrUpdateContractAndGoQa(currentUser, p)
    );
    plansGrid.appendChild(card);
  });

  // 既存契約があればKPI反映（tenant保持方式の表示用）
  if (tenant?.monthly_amount_yen != null) {
    kpiBase.textContent = yen(tenant.monthly_amount_yen);
    kpiExtra.textContent = "0円";
    kpiMonthly.textContent = yen(tenant.monthly_amount_yen);
  } else {
    // 初回は "-" のままでもいいが、見た目を揃えるなら 0 表示でも可
    // kpiBase.textContent = "0円";
    // kpiExtra.textContent = "0円";
    // kpiMonthly.textContent = "0円";
  }

  if (tenant?.note && noteEl) {
    noteEl.value = tenant.note;
  }

  // 支払い設定済みなら変更不可（契約変更を止めるだけ）
  if (tenant?.payment_method_configured) {
    setStatus("支払い設定済みのため、プラン変更はできません。", "err");
    plansGrid.querySelectorAll("button").forEach(b => {
      b.disabled = true;
      b.style.background = "#9db8a5";
    });
  } else {
    setStatus("", "");
  }
}

// =========================
// boot
// =========================
(async function boot() {
  const currentUser = await requireUser(auth, { loginUrl: "./login.html" });

  metaLine.textContent =
    `tenant_id=${tenantId || "(new)"} / account_id=${accountId} / tab=${tab}`;

  showPanel(tab);
  if (tab !== "contract") return;

  await renderContractTab(currentUser);

  btnPayDummy.addEventListener("click", () => markPaid(currentUser));
})();
