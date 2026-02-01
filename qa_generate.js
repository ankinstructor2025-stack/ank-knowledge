import { initFirebase } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import { context } from "./shared/context.js";

// =====================
// Firebase
// =====================
const { auth } = initFirebase();

// =====================
// 定数
// =====================
const API_UPLOAD_URL = "/v1/admin/upload-url";
const API_UPLOAD_FINALIZE = "/v1/admin/upload-finalize";
const API_QA_PROMPT = "/v1/admin/qa-prompt";
const API_JUDGE_METHOD = "/v1/admin/dialogues/judge-method";

// =====================
// URL params（必要なら使う）
// =====================
const params = new URLSearchParams(location.search);
const tenantId = params.get("tenant_id");     // 画面によっては使わない
const contractIdParam = params.get("contract_id");

// =====================
// DOMユーティリティ（null安全）
// =====================
function $(id) {
  return document.getElementById(id);
}

function setStatus(text, type = "ok") {
  const el = $("status");
  if (!el) return;
  el.textContent = text;
  el.className = `status ${type}`;
}

function setKpi(state, sourceKey, count) {
  if ($("kpiState")) $("kpiState").textContent = state || "-";
  if ($("kpiSource")) $("kpiSource").textContent = sourceKey || "-";
  if ($("kpiCount")) $("kpiCount").textContent = (count ?? "-");
}

function setPromptBox(obj) {
  const el = $("promptBox");
  if (!el) return;
  el.value = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

// =====================
// tenants.js と同じ：auth確定待ち
// =====================
async function waitForAuthUser(timeoutMs = 8000) {
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { unsub?.(); } catch {}
      resolve(null);
    }, timeoutMs);

    const unsub = onAuthStateChanged(auth, (u) => {
      clearTimeout(timer);
      try { unsub(); } catch {}
      resolve(u || null);
    });
  });
}

function redirectToLogin() {
  // return_to は「今のURL（クエリ含む）」を丸ごと返す
  const rt = encodeURIComponent(location.pathname + location.search);
  location.replace(`./login.html?return_to=${rt}`);
}

// =====================
// API 呼び出し（ank_api.js に統一）
// =====================
async function apiCall(user, path, { method = "GET", body = null } = {}) {
  if (!user) {
    setStatus("ログインしていません（not signed in）", "err");
    return null;
  }
  return await apiFetch(user, path, { method, body });
}

// =====================
// アップロード関連
// =====================
async function createUploadUrl(user, file) {
  return await apiCall(user, API_UPLOAD_URL, {
    method: "POST",
    body: {
      tenant_id: context.requireTenantId(),
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size_bytes: file.size,
    },
  });
}

async function uploadFileToSignedUrl(signedUrl, file) {
  const res = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
}

async function finalizeUpload(user, meta, file) {
  return await apiCall(user, API_UPLOAD_FINALIZE, {
    method: "POST",
    body: {
      object_key: meta.object_key,
      filename: file.name,
      size: file.size,
    },
  });
}

// =====================
// QA化チェック（judge-method）
// =====================
async function judgeMethod(user, objectKey, contractId) {
  return await apiCall(user, API_JUDGE_METHOD, {
    method: "POST",
    body: {
      contract_id: contractId,
      object_key: objectKey,
    },
  });
}

// =====================
// プロンプト取得
// =====================
async function getQaPrompt(user, mode) {
  return await apiCall(user, `${API_QA_PROMPT}?mode=${encodeURIComponent(mode)}`);
}

// =====================
// 初期：認証だけ先に確定させる（未ログインならloginへ）
// =====================
(async () => {
  setStatus("認証確認中…", "ok");
  const user = await waitForAuthUser(8000);

  if (!user) {
    // 画面に残すより、tenants.js と同様にloginへ戻す
    redirectToLogin();
    return;
  }

  setStatus("準備完了", "ok");
})();

// =====================
// ボタン
// =====================
const btn = $("btnUploadAndGenerate");
if (btn) {
  btn.onclick = async () => {
    try {
      setStatus("処理開始", "ok");
      setKpi("-", "-", "-");
      setPromptBox("");

      const fileInput = $("fileInput");
      const file = fileInput?.files?.[0];
      if (!file) {
        setStatus("ファイルを選択してください", "err");
        return;
      }
      if (file.size < 1024) {
        setStatus("1KB未満のファイルは対象外です", "err");
        return;
      }

      // tenants.js と同様：auth.currentUser を信用せず「確定待ち」も踏む
      const user = auth.currentUser || await waitForAuthUser(8000);
      if (!user) {
        setStatus("ログインしていません（not signed in）", "err");
        redirectToLogin();
        return;
      }

      // contract_id の取り方：param → window → 空（空ならサーバ側で弾く想定）
      const contractId = contractIdParam || window.contractId || "";

      setStatus("アップロードURL取得中…", "ok");
      const meta = await createUploadUrl(user, file);
      if (!meta) return;

      setStatus("アップロード中…", "ok");
      await uploadFileToSignedUrl(meta.upload_url, file);

      setStatus("アップロード確定中…", "ok");
      const fin = await finalizeUpload(user, meta, file);
      if (!fin) return;

      setStatus("QA化チェック中…", "ok");
      setKpi("判定中", meta.object_key, "-");

      const judge = await judgeMethod(user, meta.object_key, contractId);
      if (!judge) return;

      if (!judge.can_extract_qa) {
        setKpi("NG", meta.object_key, "-");
        setStatus(`QA化NG: ${judge?.reasons?.[0] || "QAを生成できません。"}`, "err");
        return;
      }

      const mode = judge.method || fin.qa_mode || "D";
      setKpi(`OK（方式=${mode}）`, meta.object_key, "-");

      setStatus("プロンプト取得中…", "ok");
      const prompt = await getQaPrompt(user, mode);
      if (!prompt) return;

      setPromptBox(prompt);

      if ($("btnCopyPrompt")) $("btnCopyPrompt").disabled = false;
      if ($("btnDownloadPrompt")) $("btnDownloadPrompt").disabled = false;
      if ($("promptMeta")) $("promptMeta").textContent = `mode=${mode}`;

      setStatus("完了", "ok");
    } catch (e) {
      console.error(e);
      setStatus(String(e?.message || e), "err");
    }
  };
}

// =====================
// コピー／ダウンロード
// =====================
$("btnCopyPrompt")?.addEventListener("click", async () => {
  try {
    const text = $("promptBox")?.value || "";
    await navigator.clipboard.writeText(text);
    setStatus("コピーしました", "ok");
  } catch {
    setStatus("コピーに失敗しました", "err");
  }
});

$("btnDownloadPrompt")?.addEventListener("click", () => {
  const text = $("promptBox")?.value || "";
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "prompt.json";
  a.click();
  URL.revokeObjectURL(url);
});
