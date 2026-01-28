import { initFirebase } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const { auth } = initFirebase();

const qs = new URLSearchParams(location.search);
const tenantId = (qs.get("tenant_id") || "").trim();
const accountId = (qs.get("account_id") || "").trim();
const tab = (qs.get("tab") || "contract").trim();

const elTitle = document.getElementById("title");
const elMeta = document.getElementById("meta");
const elPill = document.getElementById("pillTab");
const elBox = document.getElementById("contentBox");
const btnBack = document.getElementById("btnBack");

const btnTabContract = document.getElementById("btnTabContract");
const btnTabUsers = document.getElementById("btnTabUsers");
const btnTabKnowledge = document.getElementById("btnTabKnowledge");

btnBack?.addEventListener("click", () => {
  const a = encodeURIComponent(accountId || "");
  location.href = `./tenants.html?account_id=${a}`;
});

function goTab(nextTab) {
  const t = encodeURIComponent(tenantId);
  const a = encodeURIComponent(accountId || "");
  const tb = encodeURIComponent(nextTab || "contract");
  location.href = `./tenant_admin.html?tenant_id=${t}&account_id=${a}&tab=${tb}`;
}

btnTabContract?.addEventListener("click", () => goTab("contract"));
btnTabUsers?.addEventListener("click", () => goTab("users"));
btnTabKnowledge?.addEventListener("click", () => goTab("knowledge"));

function tabLabel(t) {
  if (t === "knowledge") return "ナレッジ管理";
  if (t === "users") return "ユーザー管理";
  return "契約";
}

function yen(n) {
  if (n == null || n === "" || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("ja-JP") + "円";
}

function pill(text, kind) {
  const cls = kind === "ok" ? "ok" : "warn";
  return `<span class="pill ${cls}">${escapeHtml(text)}</span>`;
}

function setBox(html) {
  elBox.innerHTML = html;
}

async function loadTenantSummary(user) {
  // 既存の tenants.html と同じデータソースを使う（新APIを増やさない）
  const res = await apiFetch(
    user,
    `/v1/tenants?account_id=${encodeURIComponent(accountId)}`,
    { method: "GET" }
  );

  const list = res.tenants || [];
  const hit = list.find(x => (x.tenant_id || "") === tenantId);
  return hit || null;
}

function renderContractTab(t) {
  const contractStatus = ((t?.contract_status || "draft") + "").toLowerCase();
  const isActive = (contractStatus === "active");
  const paid = !!t?.payment_method_configured;

  const seat = (t?.seat_limit != null) ? `${t.seat_limit}人` : "-";
  const kc = (t?.knowledge_count != null) ? `${t.knowledge_count}` : "-";
  const monthly = (t?.monthly_amount_yen != null) ? yen(t.monthly_amount_yen) : "-";

  setBox(`
    <div style="font-weight:700;">契約</div>
    <div class="muted" style="margin-top:6px;">状態とプランの表示（tenants一覧と同等）</div>

    <div style="margin-top:12px;">
      ${pill(contractStatus, isActive ? "ok" : "warn")}
      ${pill(paid ? "paid" : "unpaid", paid ? "ok" : "warn")}
    </div>

    <div style="margin-top:12px; line-height:1.8;">
      <div>人数: <strong>${escapeHtml(seat)}</strong></div>
      <div>ナレッジ: <strong>${escapeHtml(kc)}</strong></div>
      <div>月額: <strong>${escapeHtml(monthly)}</strong></div>
    </div>

    <div class="muted" style="margin-top:12px;">
      ※ プラン確定・支払い設定などの「操作UI」は、ここに後で追加します。
    </div>
  `);
}

function renderUsersTab(t) {
  const contractStatus = ((t?.contract_status || "draft") + "").toLowerCase();
  const isActive = (contractStatus === "active");
  setBox(`
    <div style="font-weight:700;">ユーザー管理</div>
    <div class="muted" style="margin-top:6px;">
      契約が active のときのみ利用可（現状の一覧画面と同じルール）。
    </div>
    <div style="margin-top:12px;">
      ${isActive ? "準備中（ここに実装）" : "契約が未確定（draft）のため利用できません。"}
    </div>
  `);
}

function renderKnowledgeTab(t) {
  const contractStatus = ((t?.contract_status || "draft") + "").toLowerCase();
  const isActive = (contractStatus === "active");
  setBox(`
    <div style="font-weight:700;">ナレッジ管理</div>
    <div class="muted" style="margin-top:6px;">
      契約が active のときのみ利用可（現状の一覧画面と同じルール）。
    </div>
    <div style="margin-top:12px;">
      ${isActive ? "準備中（ここに実装）" : "契約が未確定（draft）のため利用できません。"}
    </div>
  `);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // 未ログイン阻止（方針どおり）
    location.replace("./login.html?return_to=" + encodeURIComponent(location.pathname + location.search));
    return;
  }

  elTitle.textContent = tabLabel(tab);
  elPill.textContent = `tab=${tab}`;
  elMeta.innerHTML = `tenant_id=<code>${escapeHtml(tenantId || "(none)")}</code> / account_id=<code>${escapeHtml(accountId || "(none)")}</code>`;

  if (!tenantId || !accountId) {
    setBox(`<div class="muted">tenant_id / account_id がありません。tenants.html から入り直してください。</div>`);
    return;
  }

  try {
    setBox("読み込み中…");
    const t = await loadTenantSummary(user);
    if (!t) {
      setBox(`<div class="muted">対象の契約が見つかりません（tenant_id=${escapeHtml(tenantId)}）。</div>`);
      return;
    }

    if (tab === "users") {
      renderUsersTab(t);
      return;
    }
    if (tab === "knowledge") {
      renderKnowledgeTab(t);
      return;
    }
    renderContractTab(t);

  } catch (e) {
    console.error(e);
    setBox(`<div class="muted">読み込みに失敗しました: ${escapeHtml(e?.message || String(e))}</div>`);
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
