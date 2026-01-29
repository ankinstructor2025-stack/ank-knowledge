import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

const { auth } = initFirebase();

const qs = new URLSearchParams(location.search);
const tenantId = (qs.get("tenant_id") || "").trim();
const accountId = (qs.get("account_id") || "").trim();
const tab = (qs.get("tab") || "contract").trim();

const metaLine = document.getElementById("metaLine");
const backBtn = document.getElementById("backBtn");

const tabContract = document.getElementById("tabContract");
const tabUsers = document.getElementById("tabUsers");
const tabKnowledge = document.getElementById("tabKnowledge");

const panelContract = document.getElementById("panelContract");
const panelUsers = document.getElementById("panelUsers");
const panelKnowledge = document.getElementById("panelKnowledge");

// 旧UI（pricing前提）- 存在しても使わない（壊さないために残す）
const seatSel = document.getElementById("seatLimitSelect");
const knowSel = document.getElementById("knowledgeCountSelect");

const noteEl = document.getElementById("note");

const kpiBase = document.getElementById("kpiBase");
const kpiExtra = document.getElementById("kpiExtra");
const kpiMonthly = document.getElementById("kpiMonthly");

const btnSave = document.getElementById("btnSave");       // 旧保存ボタン（あれば無効化）
const btnPayDummy = document.getElementById("btnPayDummy");
const statusEl = document.getElementById("status");

// ★ 新UI：plans.json表示先
const plansGrid = document.getElementById("plansGrid");

function showPanel(name) {
  panelContract.style.display = (name === "contract") ? "" : "none";
  panelUsers.style.display = (name === "users") ? "" : "none";
  panelKnowledge.style.display = (name === "knowledge") ? "" : "none";
}

function goTab(next) {
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

async function loadTenant(currentUser) {
  return await apiFetch(
    currentUser,
    `/v1/tenant?tenant_id=${encodeURIComponent(tenantId)}&account_id=${encodeURIComponent(accountId)}`,
    { method: "GET" }
  );
}

// plans.json を /v1/plans から取得する（あなたのAPIで /v1/pricing を plans.json に変えてるなら、ここを /v1/pricing にしてもOK）
async function loadPlans(currentUser) {
  return await apiFetch(currentUser, "/v1/plans", { method: "GET" });
}

// JSONの安全化
function normalizePlans(raw) {
  const currency = String(raw?.currency || "JPY");
  const plans = Array.isArray(raw?.plans) ? raw.plans : [];
  const limits = raw?.limits || {};
  const dedup = raw?.dedup_thresholds || {};
  return { currency, plans, limits, dedup };
}

// featuresの表示（UI用）
function planFeatureLines(p) {
  const f = p?.features || {};
  const lines = [];

  // QA生成回数（プランに含む回数）
  const inc = Number(p?.included_qa_generations || 0);
  if (inc > 0) lines.push(`QA生成：月${inc}回まで含む（超過は都度課金）`);
  else lines.push("QA生成：都度課金");

  if (f.qa_manage) lines.push("QAセット管理");
  if (f.dedup) lines.push("重複整理（候補0.7 / 確定0.9）");
  if (f.qa_search) lines.push("QA検索（一覧・類似）");
  if (f.qa_summarize) lines.push("QA要約（TOP5を要点としてまとめる）");

  return lines;
}

function setLegacyUiDisabled() {
  // 旧pricing UIは使わないので、あれば無効化/非表示
  if (seatSel) seatSel.style.display = "none";
  if (knowSel) knowSel.style.display = "none";
  if (btnSave) btnSave.style.display = "none";

  // KPIは「月額表示」に流用できるので残す（表示だけ更新する）
}

function ensurePlansGrid() {
  if (!plansGrid) {
    throw new Error("tenant_admin.html に <div id=\"plansGrid\"></div> を追加してください。");
  }
}

function clearGrid() {
  plansGrid.innerHTML = "";
}

function makeCard(plan, currentPlanId, onSelect) {
  const div = document.createElement("div");
  div.style.background = "#fff";
  div.style.border = "1px solid #e6e8ef";
  div.style.borderRadius = "14px";
  div.style.padding = "14px";
  div.style.boxShadow = "0 1px 2px rgba(0,0,0,.04)";
  div.style.display = "flex";
  div.style.flexDirection = "column";
  div.style.gap = "10px";

  const top = document.createElement("div");
  top.style.display = "flex";
  top.style.justifyContent = "space-between";
  top.style.alignItems = "center";
  const label = document.createElement("div");
  label.textContent = plan.label || plan.plan_id;
  label.style.fontWeight = "800";
  label.style.fontSize = "16px";
  const pill = document.createElement("div");
  pill.textContent = plan.plan_id;
  pill.style.fontSize = "11px";
  pill.style.padding = "3px 8px";
  pill.style.borderRadius = "999px";
  pill.style.border = "1px solid #dbe0ea";
  pill.style.background = "#f3f5fb";
  top.appendChild(label);
  top.appendChild(pill);

  const price = document.createElement("div");
  const monthly = Number(plan.monthly_price || 0);
  if (monthly === 0) {
    // 誤解防止：0円でも“生成は都度課金”を明示
    price.textContent = `月額 ¥0（QA生成は都度課金）`;
  } else {
    price.textContent = `月額 ${yen(monthly)}`;
  }
  price.style.fontSize = "14px";
  price.style.color = "#333";

  const ul = document.createElement("ul");
  ul.style.margin = "0";
  ul.style.paddingLeft = "18px";
  ul.style.fontSize = "13px";
  for (const s of planFeatureLines(plan)) {
    const li = document.createElement("li");
    li.textContent = s;
    li.style.margin = "6px 0";
    ul.appendChild(li);
  }

  if (Array.isArray(plan.notes) && plan.notes.length) {
    const note = document.createElement("div");
    note.textContent = plan.notes.join(" / ");
    note.style.fontSize = "12px";
    note.style.color = "#666";
    note.style.lineHeight = "1.5";
    div.appendChild(note);
  }

  const btn = document.createElement("button");
  btn.textContent = (plan.plan_id === currentPlanId) ? "選択中" : "このプランで保存";
  btn.disabled = (plan.plan_id === currentPlanId);
  btn.style.border = "0";
  btn.style.borderRadius = "10px";
  btn.style.padding = "10px 12px";
  btn.style.cursor = btn.disabled ? "not-allowed" : "pointer";
  btn.style.fontWeight = "800";
  btn.style.background = btn.disabled ? "#9db8a5" : "#1f7a39";
  btn.style.color = "#fff";
  btn.onclick = () => onSelect(plan);

  div.appendChild(top);
  div.appendChild(price);
  div.appendChild(ul);
  div.appendChild(btn);

  return div;
}

async function saveContractWithPlan(currentUser, plan) {
  try {
    const tenant = await loadTenant(currentUser);
    if (tenant?.payment_method_configured) {
      throw new Error("支払い設定が完了しているため、契約は変更できません。");
    }

    const note = clampNote(noteEl?.value || "");

    await apiFetch(currentUser, "/v1/tenant/contract", {
      method: "POST",
      body: {
        account_id: accountId,
        tenant_id: tenantId,
        // ★ ここが主：plan_idで決める
        plan_id: plan.plan_id,
        // 互換のために残す（API側が参照しているなら）
        monthly_amount_yen: Number(plan.monthly_price || 0),
        note
      }
    });

    // KPI表示（あれば）
    if (kpiMonthly) kpiMonthly.textContent = yen(plan.monthly_price || 0);
    if (kpiBase) kpiBase.textContent = yen(plan.monthly_price || 0);
    if (kpiExtra) kpiExtra.textContent = "0円";

    setStatus("保存しました。", "ok");
  } catch (e) {
    console.error(e);
    setStatus(e?.message || String(e), "err");
  }
}

async function markPaid(currentUser) {
  btnPayDummy.disabled = true;
  try {
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

async function renderContractTab(currentUser) {
  ensurePlansGrid();
  setLegacyUiDisabled();

  // tenant の現在契約
  let tenant;
  try {
    tenant = await loadTenant(currentUser);
  } catch (e) {
    setStatus("tenant取得に失敗: " + (e?.message || String(e)), "err");
    return;
  }

  // plans.json 取得
  let raw;
  try {
    raw = await loadPlans(currentUser);
  } catch (e) {
    setStatus("plans取得に失敗: " + (e?.message || String(e)), "err");
    return;
  }

  const { plans, limits, dedup } = normalizePlans(raw);

  if (!plans.length) {
    setStatus("plans.json の形式が不正です: " + JSON.stringify(raw), "err");
    return;
  }

  // 上部に軽く情報を出す（必要なら）
  const keepMax = limits?.qa_sets_keep_max ?? 5;
  const activeMax = limits?.qa_set_active_max ?? 1;
  const c = dedup?.candidate_cosine ?? 0.7;
  const q = dedup?.confirm_cosine ?? 0.9;

  setStatus(`保持QAセット=${keepMax} / 使用中=${activeMax} / 重複整理=${c}/${q}`, "ok");

  // 既存のnote反映
  if (tenant?.note && noteEl) noteEl.value = tenant.note;

  // 現在の plan_id
  const currentPlanId = (tenant?.plan_id || "").trim();

  // KPI反映（あれば）
  if (currentPlanId) {
    const nowPlan = plans.find(p => p.plan_id === currentPlanId);
    if (nowPlan) {
      if (kpiMonthly) kpiMonthly.textContent = yen(nowPlan.monthly_price || 0);
      if (kpiBase) kpiBase.textContent = yen(nowPlan.monthly_price || 0);
      if (kpiExtra) kpiExtra.textContent = "0円";
    }
  }

  // 表示
  clearGrid();

  // 簡易グリッド
  plansGrid.style.display = "grid";
  plansGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(240px, 1fr))";
  plansGrid.style.gap = "12px";

  for (const plan of plans) {
    if (!plan.plan_id) continue;
    const card = makeCard(plan, currentPlanId, async (p) => {
      await saveContractWithPlan(currentUser, p);
      // 保存後に再描画（選択中表示を更新）
      await renderContractTab(currentUser);
    });
    plansGrid.appendChild(card);
  }

  // 支払い設定済みならボタン押せない（UIで抑止）
  if (tenant?.payment_method_configured) {
    setStatus("支払い設定済みのため、プラン変更はできません。", "err");
    // 全ボタン無効化
    plansGrid.querySelectorAll("button").forEach(b => { b.disabled = true; b.style.background = "#9db8a5"; });
  }
}

(async function boot() {
  const currentUser = await requireUser(auth, { loginUrl: "./login.html" });

  metaLine.textContent = `tenant_id=${tenantId} / account_id=${accountId} / tab=${tab}`;
  showPanel(tab);

  if (tab !== "contract") return;

  await renderContractTab(currentUser);

  // 既存の支払い（仮）ボタンは残す
  if (btnPayDummy) btnPayDummy.addEventListener("click", () => markPaid(currentUser));
})();
