// qa_generate.js（最新版）
// - ファイルのみ（コピペ/手入力なし）
// - 1KB未満は対象外
// - uploads.py の仕様（contract_id 前提）に合わせる
//   POST /v1/admin/upload-url
//   PUT 署名URLへアップロード
//   POST /v1/admin/upload-finalize（判定・OKならログ保存）
// - OKになったら「結果ダウンロード」を有効化（いまは finalize 結果JSONをDL）
//   ※ 次に「QA抽出API」をつなぐなら、OK時に object_key を渡して呼べばよい

import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

const { auth } = initFirebase();

// URL params
const qs = new URLSearchParams(location.search);
const contractId = (qs.get("contract_id") || "").trim();

// DOM
const metaLine = document.getElementById("metaLine");
const backBtn = document.getElementById("backBtn");

const fileInput = document.getElementById("fileInput");
const formatSel = document.getElementById("formatSel"); // 使わなくてもOK（将来QA抽出で使う）
const btnUploadAndGenerate = document.getElementById("btnUploadAndGenerate");
const btnDownload = document.getElementById("btnDownload");

const kpiState = document.getElementById("kpiState");
const kpiSource = document.getElementById("kpiSource");
const kpiCount = document.getElementById("kpiCount");
const statusEl = document.getElementById("status");

// API endpoints（uploads.py）
const API_UPLOAD_URL = "/v1/admin/upload-url";
const API_UPLOAD_FINALIZE = "/v1/admin/upload-finalize";

// rules
const MIN_BYTES = 1024;
const ALLOW_EXT = [".txt", ".csv", ".json"];

// state
let lastFinalize = null;  // ダウンロード用（finalize応答）
let lastObjectKey = "";   // 表示用

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

// 1) 署名URL発行
// uploads.py の UploadUrlRequest:
//   contract_id, kind, filename, content_type, size_bytes, note?
async function requestUploadUrl(currentUser, file) {
  const body = {
    contract_id: contractId,
    kind: "dialogue",
    filename: file.name,
    content_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    note: ""
  };
  return await apiFetch(currentUser, API_UPLOAD_URL, { method: "POST", body });
}

// 2) PUTアップロード
async function putToSignedUrl(uploadUrl, file) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`upload failed: ${res.status} ${t}`);
  }
}

// 3) finalize（判定・OKならログ保存）
// uploads.py の finalize は概ね：contract_id, upload_id, object_key, filename, content_type, kind
async function finalizeUpload(currentUser, meta, file) {
  const body = {
    contract_id: contractId,
    upload_id: meta.upload_id,
    object_key: meta.object_key,
    filename: file.name,
    content_type: file.type || "",
    kind: "dialogue"
  };
  return await apiFetch(currentUser, API_UPLOAD_FINALIZE, { method: "POST", body });
}

// upload-urlの応答から必要項目を取り出す
function extractUploadMeta(resp) {
  const r = resp || {};
  const uploadUrl = (r.upload_url || "").trim();
  const objectKey = (r.object_key || "").trim();
  const uploadId = (r.upload_id || "").trim();

  if (!uploadUrl) throw new Error("upload-url response missing upload_url");
  if (!objectKey) throw new Error("upload-url response missing object_key");
  if (!uploadId) throw new Error("upload-url response missing upload_id");

  return { upload_url: uploadUrl, object_key: objectKey, upload_id: uploadId };
}

(async function boot() {
  const currentUser = await requireUser(auth, { loginUrl: "./login.html" });

  // 表示
  metaLine.textContent = `contract_id=${contractId || "-"}`
  if (backBtn) {
    backBtn.onclick = () => {
      // 既存導線に合わせて必要なら変更
      location.href = "./index.html";
    };
  }

  // contract_id 必須（uploads.py前提）
  if (!contractId) {
    setKpi("停止", "", "-");
    setStatus("contract_id がありません（URLに ?contract_id=... を付けてください）。", "err");
    btnUploadAndGenerate.disabled = true;
    return;
  }

  setKpi("-", "", "-");
  setStatus("", "");

  btnDownload.disabled = true;
  btnDownload.onclick = () => {
    if (!lastFinalize) return;
    dlJson(`finalize_${Date.now()}.json`, lastFinalize);
  };

  btnUploadAndGenerate.onclick = async () => {
    setStatus("", "");
    lastFinalize = null;
    lastObjectKey = "";
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

    try {
      // 署名URL
      setKpi("署名URL取得", "", "-");
      const metaRaw = await requestUploadUrl(currentUser, file);
      const meta = extractUploadMeta(metaRaw);

      lastObjectKey = meta.object_key;
      setKpi("アップロード中", meta.object_key, "-");

      // PUT
      await putToSignedUrl(meta.upload_url, file);

      // finalize（判定）
      setKpi("判定中", meta.object_key, "-");
      const fin = await finalizeUpload(currentUser, meta, file);

      lastFinalize = fin;

      // uploads.py 側の返却想定：ok, qa_mode, message, reasons 等
      if (!fin?.ok) {
        const reasons = Array.isArray(fin?.reasons) ? fin.reasons.join("\n") : "";
        setKpi("NG", meta.object_key, "-");
        setStatus(
          `QA化NG: ${fin?.message || ""}` + (reasons ? `\n${reasons}` : ""),
          "err"
        );
        return;
      }

      setKpi(`OK（方式=${fin?.qa_mode || "?"}）`, meta.object_key, "-");
      setStatus("アップロードOK。次は object_key を使ってQA抽出へ進めます。", "ok");

      // いまは finalize結果をダウンロードできるようにする
      btnDownload.disabled = false;

      // 将来ここでQA抽出APIに接続するなら：
      // const fmt = (formatSel?.value || "json").trim();
      // const qa = await apiFetch(currentUser, "/v1/xxx/qa-generate", { method:"POST", body:{ contract_id: contractId, object_key: meta.object_key, format: fmt } });
      // dlJson("qa_result.json", qa);

    } catch (e) {
      console.error(e);
      setKpi("失敗", lastObjectKey, "-");
      setStatus(e?.message || String(e), "err");
    } finally {
      btnUploadAndGenerate.disabled = false;
    }
  };
})();
