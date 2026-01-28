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
const elErr = document.getElementById("errBox");

const btnBack = document.getElementById("btnBack");
const btnTabContract = document.getElementById("btnTabContract");
const btnTabUsers = document.getElementById("btnTabUsers");
const btnTabKnowledge = document.getElementById("btnTabKnowledge");

btnBack.addEventListener("click", () => {
  location.href = `./tenants.html?account_id=${encodeURIComponent(accountId || "")}`;
});

function goTab(nextTab) {
  const t = encodeURIComponent(tenantId);
  const a = encodeURIComponent(accountId || "");
  const tb = encodeURIComponent(nextTab || "contract");
  location.href = `./tenant_admin.html?tenant_id=${t}&account_id=${a}&tab=${tb}`;
}

btnTabContract.addEventListener("click", () => goTab("contract"));
btnTabUsers.addEventListener("click", () => goTab("users"));
btnTabKnowledge.addEventListener("click", () => goTab("knowledge"));

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
  return `<span class="pill ${kind || ""}">${escapeHtml(text)}</span>`;
}

function setErr(msg) {
  elErr.textContent = msg || "";
}

async function loadTenant(user) {
  // tenants.js と同じAPI（＝新API増やさない）
  const res = await apiFetch(
    user,
    `/v1/tenants?account_id=${encodeURIComponent(accountId)}`,
    { method: "GET" }
  );
  const list = res.tenants || [];
  return list.find(x => (x.tenant_id || "") === tenantId) || null;
}

function renderContract(t) {
  const contractStatus = ((t?.contract_status || "draft") + "").toLowerCase();
  const isActive = contractStatus === "active";
  const paid = !!t?.payment_method_configured;

  const seat = (t?.seat_limit != null) ? `${t.seat_limit}人` : "-";
  const kc = (t?.knowledge_count != null) ? `${t.knowledge_count}` : "-";
  const monthly = (t?.monthly_amount_yen != null) ? yen(t.monthly_amount_yen) : "-";

  elBox.innerHTML = `
    <div style="font-weight:700;">契約</div>
    <div class="muted" style="margin-top:6px;">状態とプランの表示（編集は後で）</div>

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
      今日の目的は「Cloud SQLを捨ててQA作成まで戻す」なので、契約編集UIは後回しにします。
    </div>
  `;
}

function renderUsers(t) {
  const contractStatus = ((t?.contract_status || "draft") + "").toLowerCase();
  const isActive = contractStatus === "active";

  elBox.innerHTML = `
    <div style="font-weight:700;">ユーザー管理</div>
    <div class="muted" style="margin-top:6px;">準備中</div>
    <div style="margin-top:12px;">
      ${isActive ? "（後で実装）" : "契約がdraftのため利用できません。"}
    </div>
  `;
}

function renderKnowledge(t) {
  const contractStatus = ((t?.contract_status || "draft") + "").toLowerCase();
  const isActive = contractStatus === "active";

  elBox.innerHTML = `
    <div style="font-weight:700;">ナレッジ管理</div>
    <div class="muted" style="margin-top:6px;">準備中</div>
    <div style="margin-top:12px;">
      ${isActive ? "（後で実装）" : "契約がdraftのため利用できません。"}
    </div>
  `;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // tenants.js は未ログインで login へ飛ぶ（同じ方針） :contentReference[oaicite:7]{index=7}
    location.replace("./login.html");
    return;
  }

  elTitle.textContent = tabLabel(tab);
  elPill.textContent = `tab=${tab}`;
  elMeta.innerHTML = `tenant_id=<code>${escapeHtml(tenantId || "(none)")}</code> / account_id=<code>${escapeHtml(accountId || "(none)")}</code>`;

  if (!tenantId || !accountId) {
    setErr("tenant_id / account_id がありません。tenants.html から入り直してください。");
    elBox.textContent = "";
    return;
  }

  try {
    setErr("");
    elBox.textContent = "読み込み中…";

    const t = await loadTenant(user);
    if (!t) {
      setErr(`対象の契約が見つかりません（tenant_id=${tenantId}）`);
      elBox.textContent = "";
      return;
    }

    if (tab === "users") return renderUsers(t);
    if (tab === "knowledge") return renderKnowledge(t);
    return renderContract(t);

  } catch (e) {
    console.error(e);
    setErr(e?.message || String(e));
    elBox.textContent = "";
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
