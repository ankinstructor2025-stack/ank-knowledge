import { apiFetch as apiFetchBase } from "./ank_api.js";

// =====================
// 定数
// =====================
const API_UPLOAD_URL = "/v1/admin/upload-url";
const API_UPLOAD_FINALIZE = "/v1/admin/upload-finalize";
const API_QA_PROMPT = "/v1/admin/qa-prompt";
const API_JUDGE_METHOD = "/v1/admin/dialogues/judge-method";

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
// auth待ち（最少）
// =====================
async function getCurrentUserOrNull(timeoutMs = 5000) {
  // すでにセットされているなら即返す
  if (window.currentUser) return window.currentUser;

  // Firebase互換（firebase.auth() がいる場合は onAuthStateChanged を待つ）
  if (window.firebase && typeof window.firebase.auth === "function") {
    return await new Promise((resolve) => {
      const t = setTimeout(() => resolve(window.firebase.auth().currentUser || null), timeoutMs);
      try {
        window.firebase.auth().onAuthStateChanged((u) => {
          clearTimeout(t);
          window.currentUser = u;
          resolve(u || null);
        });
      } catch (e) {
        clearTimeout(t);
        resolve(null);
      }
    });
  }

  // それ以外は少し待ってから currentUser を見る
  return await new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (window.currentUser) return resolve(window.currentUser);
      if (Date.now() - started > timeoutMs) return resolve(null);
      setTimeout(tick, 100);
    };
    tick();
  });
}

// =====================
// API 呼び出し
// =====================
// tenants.js と同じ apiFetch 実装（ank_api.js）に寄せる。
// 目的：相対パス fetch による 405（静的ホストへPOST）を防ぐ。
async function apiFetch(currentUser, path, { method = "GET", body = null } = {}) {
  if (!currentUser) {
    // throwしない（画面表示で終わらせる）
    setStatus("ログインしていません（not signed in）", "err");
    return null;
  }
  // ank_api.js 側で Authorization 付与・API_BASE 接続・JSON処理を行う
  return await apiFetchBase(currentUser, path, { method, body });
}

// =====================
// アップロード関連
// =====================
async function createUploadUrl(currentUser, file) {
  return await apiFetch(currentUser, API_UPLOAD_URL, {
    method: "POST",
    body: {
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size: file.size,
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

async function finalizeUpload(currentUser, meta, file) {
  return await apiFetch(currentUser, API_UPLOAD_FINALIZE, {
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
async function judgeMethod(currentUser, objectKey, contractId) {
  return await apiFetch(currentUser, API_JUDGE_METHOD, {
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
async function getQaPrompt(currentUser, mode) {
  return await apiFetch(currentUser, `${API_QA_PROMPT}?mode=${encodeURIComponent(mode)}`);
}

// =====================
// ボタン
// =====================
$("btnUploadAndGenerate").onclick = async () => {
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

    // auth確定待ち
    const currentUser = await getCurrentUserOrNull();
    if (!currentUser) {
      setStatus("ログインしていません（not signed in）", "err");
      return;
    }

    const contractId = window.contractId;

    setStatus("アップロードURL取得中…", "ok");
    const meta = await createUploadUrl(currentUser, file);
    if (!meta) return;

    setStatus("アップロード中…", "ok");
    await uploadFileToSignedUrl(meta.upload_url, file);

    setStatus("アップロード確定中…", "ok");
    const fin = await finalizeUpload(currentUser, meta, file);
    if (!fin) return;

    setStatus("QA化チェック中…", "ok");
    setKpi("判定中", meta.object_key, "-");

    const judge = await judgeMethod(currentUser, meta.object_key, contractId);
    if (!judge) return;

    if (!judge.can_extract_qa) {
      setKpi("NG", meta.object_key, "-");
      setStatus(`QA化NG: ${judge?.reasons?.[0] || "QAを生成できません。"}`, "err");
      return;
    }

    const mode = judge.method || fin.qa_mode || "D";
    setKpi(`OK（方式=${mode}）`, meta.object_key, "-");

    setStatus("プロンプト取得中…", "ok");
    const prompt = await getQaPrompt(currentUser, mode);
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
