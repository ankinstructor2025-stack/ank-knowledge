import { initFirebase } from "./ank_firebase.js";
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

btnBack.addEventListener("click", () => {
  // tenants.html へ戻す（account_id を保持）
  const a = encodeURIComponent(accountId || "");
  location.href = `./tenants.html?account_id=${a}`;
});

function setBox(html) {
  elBox.innerHTML = html;
}

function tabLabel(t) {
  if (t === "knowledge") return "ナレッジ管理";
  if (t === "users") return "ユーザー管理";
  return "契約";
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    // 未ログインは阻止（今までの方針どおり）
    location.replace("./login.html?return_to=" + encodeURIComponent(location.pathname + location.search));
    return;
  }

  elTitle.textContent = tabLabel(tab);
  elPill.textContent = `tab=${tab}`;
  elMeta.innerHTML = `tenant_id=<code>${escapeHtml(tenantId || "(none)")}</code> / account_id=<code>${escapeHtml(accountId || "(none)")}</code>`;

  if (!tenantId) {
    setBox(`<div class="muted">tenant_id がありません。tenants.html から入り直してください。</div>`);
    return;
  }

  // いまは「画面がまだない」前提なので、tabごとにプレースホルダだけ出す
  if (tab === "knowledge") {
    setBox(`
      <div style="font-weight:700;">ナレッジ管理（準備中）</div>
      <div class="muted" style="margin-top:6px;">
        ここに「アップロード」「ビルド」「検索DBへ反映（publish）」を実装します。<br>
        いまは遷移だけ成立させる段階です。
      </div>
    `);
    return;
  }

  if (tab === "users") {
    setBox(`
      <div style="font-weight:700;">ユーザー管理（準備中）</div>
      <div class="muted" style="margin-top:6px;">ここに招待・一覧などを実装します。</div>
    `);
    return;
  }

  // contract
  setBox(`
    <div style="font-weight:700;">契約（準備中）</div>
    <div class="muted" style="margin-top:6px;">ここにプラン確定・状態表示などを実装します。</div>
  `);
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
