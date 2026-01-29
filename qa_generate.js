import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

const { auth } = initFirebase();

const qs = new URLSearchParams(location.search);
const tenantId = (qs.get("tenant_id") || "").trim();
const accountId = (qs.get("account_id") || "").trim();

const metaLine = document.getElementById("metaLine");
const backBtn = document.getElementById("backBtn");

const fileInput = document.getElementById("fileInput");
const formatSel = document.getElementById("formatSel");

const btnUploadAndGenerate = document.getElementById("btnUploadAndGenerate");
const btnDownload = document.getElementById("btnDownload");

const kpiState = document.getElementById("kpiState");
const kpiSource = document.getElementById("kpiSource");
const kpiCount = document.getElementById("kpiCount");

const statusEl = document.getElementById("status");

/**
 * ★ここだけあなたの既存APIに合わせて差し替え
 * 1) 署名URLを発行するAPI（あなたが以前作って動かしたやつ）
 *    例: POST /v1/admin/upload-url
 *
 * 2) アップロード済みsource_keyでQA抽出を実行するAPI（既存のQA抽出）
 *    例: POST /v1/knowledge/qa-generate-from-source
 *
 * 返却形式は下のコメントに合わせればOK。
 */
const API_UPLOAD_URL = "/v1/admin/upload-url";
const API_QA_FROM_SOURCE = "/v1/exports/qa-from-source"; // ←無ければあなたの既存QA抽出APIに変える

// 1KB未満NG
const MIN_BYTES = 1024;
// 許可拡張子（最低限）
const ALLOW_EXT = [".txt", ".csv", ".json"];

let lastResult = null;   // ダウンロード用
let lastSourceKey = "";  // 表示用

function setStatus(msg, type = "") {
  statusEl.className = "status " + (type || "");
  statusEl.textContent = msg || "";
  statusEl.style.display = msg ? "block" : "none";
}

function setKpi(state, sourceKey, count) {
  kpiState.textContent = state ?? "-";
  kpiSource.textContent = sourceKey || "-";
  kpiCount.textContent = (count == null ? "-" : String(count));
}

function extOf(name) {
  const n = String(name || "").toLowerCase();
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(i) : "";
}

function dlJson(filename, obj) {
  const text = JSON.stringify(obj, null, 2);
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * 署名URLを発行してもらう
 * 期待する返却（どれか）：
 *   { upload_url, source_key }
 *   { upload_url, object_key }  ← object_keyをsource_keyとして扱う
 */
async function requestUploadUrl(currentUser, file) {
  const body = {
    account_id: accountId,
    tenant_id: tenantId,
    filename: file.name,
    content_type: file.type || "application/octet-stream",
    size_bytes: file.size
  };
  return await apiFetch(currentUser, API_UPLOAD_URL, { method: "POST", body });
}

/**
 * 署名URLへPUT
 */
async function putToSignedUrl(uploadUrl, file) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream"
    },
    body: file
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`upload failed: ${res.status} ${t}`);
  }
}

/**
 * アップロード済みsource_keyでQA抽出を実行する
 * 期待する返却（例）：
 *   { items: [{question,answer}, ...], qa_count: N }
 *   または { qa_count, items } など
 */
async function generateQaFromSource(currentUser, sourceKey, format) {
  const body = {
    account_id: accountId,
    tenant_id: tenantId,
    source_key: sourceKey,
    format: format || "json"
  };
  return await apiFetch(currentUser, API_QA_FROM_SOURCE, { method: "POST", body });
}

function extractSourceKey(uploadResp) {
  const u = uploadResp || {};
  const sk = (u.source_key || u.object_key || "").trim();
  if (!sk) {
    throw new Error("upload-url response missing source_key/object_key");
  }
  const url = (u.upload_url || "").trim();
  if (!url) {
    throw new Error("upload-url response missing upload_url");
  }
  return { uploadUrl: url, sourceKey: sk };
}

function extractItems(resp) {
  if (!resp || typeof resp !== "object") return { items: [], count: 0 };
  const items = Array.isArray(resp.items) ? resp.items : [];
  const count = (resp.qa_count != null) ? Number(resp.qa_count) : items.length;
  return { items, count };
}

async function boot() {
  const currentUser = await requireUser(auth, { loginUrl: "./login.html" });

  metaLine.textContent = `tenant_id=${tenantId} / account_id=${accountId}`;
  backBtn.onclick = () => {
    location.href = `./tenants.html?account_id=${encodeURIComponent(accountId)}`;
  };

  setStatus("", "");
  setKpi("-", "", "-");

  btnDownload.onclick = () => {
    if (!lastResult) return;
    dlJson("qa_result.json", lastResult);
  };

  btnUploadAndGenerate.onclick = async () => {
    setStatus("", "");
    lastResult = null;
    lastSourceKey = "";
    btnDownload.disabled = true;

    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      setStatus("ファイルを選択してください。", "err");
      return;
    }

    // クライアント側の事故防止
    if (file.size < MIN_BYTES) {
      setStatus("1KB未満のファイルは対象外です。", "err");
      return;
    }
    const ext = extOf(file.name);
    if (!ALLOW_EXT.includes(ext)) {
      setStatus(`対象外の拡張子です: ${ext}`, "err");
      return;
    }

    btnUploadAndGenerate.disabled = true;
    setKpi("アップロード準備", "", "-");

    try {
      // 1) 署名URL発行
      const uploadResp = await requestUploadUrl(currentUser, file);
      const { uploadUrl, sourceKey } = extractSourceKey(uploadResp);

      setKpi("アップロード中", sourceKey, "-");

      // 2) PUTアップロード
      await putToSignedUrl(uploadUrl, file);

      setKpi("QA作成中", sourceKey, "-");

      // 3) QA抽出（既存ロジックに接続する）
      const fmt = (formatSel.value || "json").trim();
      const qaResp = await generateQaFromSource(currentUser, sourceKey, fmt);
      const { items, count } = extractItems(qaResp);

      lastResult = qaResp;      // そのままダウンロード
      lastSourceKey = sourceKey;

      setKpi("完了", sourceKey, count);
      setStatus("QAを作成しました。結果をダウンロードできます。", "ok");
      btnDownload.disabled = false;

    } catch (e) {
      console.error(e);
      setKpi("失敗", lastSourceKey, "-");
      setStatus(e?.message || String(e), "err");
    } finally {
      btnUploadAndGenerate.disabled = false;
    }
  };
}

boot().catch(e => {
  console.error(e);
  setStatus(e?.message || String(e), "err");
});
