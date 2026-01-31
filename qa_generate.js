// qa_generate.js（最新版・導線統一版 + プロンプト表示）
// - ファイルのみ（コピペ/手入力なし）
// - 1KB未満は対象外
// - uploads.py の仕様（contract_id 前提）に合わせる
//   POST /v1/admin/upload-url
//   PUT 署名URLへアップロード
//   POST /v1/admin/upload-finalize（判定・OKならログ保存）
// - OKになったら「結果ダウンロード」を有効化（いまは finalize 結果JSONをDL）
// - ★ 追加：qa_mode に応じて GCS の qa_prompts を読み、messages(JSON) を画面に表示

import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

const { auth } = initFirebase();

// URL params
const qs = new URLSearchParams(location.search);
const contractId = (qs.get("contract_id") || "").trim();
const tenantId = (qs.get("tenant_id") || "").trim();
const accountId = (qs.get("account_id") || "").trim();

// DOM（既存）
const metaLine = document.getElementById("metaLine");
const backBtn = document.getElementById("backBtn");

const fileInput = document.getElementById("fileInput");
const formatSel = document.getElementById("formatSel"); // 将来QA抽出で使う
const btnUploadAndGenerate = document.getElementById("btnUploadAndGenerate");
const btnDownload = document.getElementById("btnDownload");

const kpiState = document.getElementById("kpiState");
const kpiSource = document.getElementById("kpiSource");
const kpiCount = document.getElementById("kpiCount");
const statusEl = document.getElementById("status");

// DOM（★追加）
const promptBox = document.getElementById("promptBox");
const promptMeta = document.getElementById("promptMeta");
const btnCopyPrompt = document.getElementById("btnCopyPrompt");
const btnDownloadPrompt = document.getElementById("btnDownloadPrompt");

// API endpoints（uploads.py）
const API_UPLOAD_URL = "/v1/admin/upload-url";
const API_UPLOAD_FINALIZE = "/v1/admin/upload-finalize";

// ★プロンプト定義を取得するAPI（サーバ側で GCS settings/qa_prompts/{mode}.json を読む想定）
const API_QA_PROMPT = "/v1/admin/qa-prompt"; // GET ?mode=A
const API_JUDGE_METHOD = "/v1/admin/dialogues/judge-method";

// rules
const MIN_BYTES = 1024;
const ALLOW_EXT = [".txt", ".csv", ".json"];

// state
let lastFinalize = null;  // ダウンロード用（finalize応答）
let lastObjectKey = "";   // 表示用
let lastPromptMessages = null; // ★表示/コピー用

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

function setPromptUI(messages, metaText) {
  lastPromptMessages = messages || null;
  promptMeta.textContent = metaText || "-";
  promptBox.value = messages ? JSON.stringify(messages, null, 2) : "";
  btnCopyPrompt.disabled = !messages;
  btnDownloadPrompt.disabled = !messages;
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

// 1) 署名URL発行
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

async function judgeMethod(currentUser, objectKey) {
  const body = {
    contract_id: contractId,
    object_key: objectKey
  };
  return await apiFetch(currentUser, API_JUDGE_METHOD, { method: "POST", body });
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

// ★ファイル内容を読み込む（TEXT化）
async function readFileAsText(file) {
  // 文字コード問題は将来やる。まずは utf-8 前提。
  return await file.text();
}

// ★プロンプト定義を取得（推奨：サーバAPI経由）
async function fetchPromptDef(currentUser, mode) {
  const m = String(mode || "").trim();
  if (!m) throw new Error("qa_mode is empty");
  // GET /v1/admin/qa-prompt?mode=A を想定
  const path = `${API_QA_PROMPT}?mode=${encodeURIComponent(m)}`;
  return await apiFetch(currentUser, path, { method: "GET" });
}

// ★ messages(JSON) を作る
function buildMessages(promptDef, text) {
  const pd = promptDef || {};
  const system = String(pd.system_prompt || "").trim();

  // テンプレに {TEXT} を埋め込み（添付例に合わせる）
  const tpl = String(pd.user_prompt_template || "");
  const user = tpl.replaceAll("{TEXT}", text ?? "");

  // ここは「messages」だけ作る。model等は別レイヤーで扱える。
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });
  return messages;
}

(async function boot() {
  const currentUser = await requireUser(auth, { loginUrl: "./login.html" });

  // 表示
  metaLine.textContent =
    `contract_id=${contractId || "-"} / tenant_id=${tenantId || "-"} / account_id=${accountId || "-"}`;

  if (backBtn) {
    backBtn.onclick = () => {
      if (accountId) {
        location.href = `./tenants.html?account_id=${encodeURIComponent(accountId)}`;
      } else {
        location.href = "./tenants.html";
      }
    };
  }

  // prompt UI init
  setPromptUI(null, "-");
  btnCopyPrompt.onclick = async () => {
    if (!lastPromptMessages) return;
    await copyText(JSON.stringify(lastPromptMessages, null, 2));
    setStatus("プロンプトをコピーしました。", "ok");
  };
  btnDownloadPrompt.onclick = () => {
    if (!lastPromptMessages) return;
    dlJson(`prompt_messages_${Date.now()}.json`, lastPromptMessages);
  };

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

    // ★プロンプト表示もリセット
    setPromptUI(null, "-");

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

      // ★ QA化チェック（judge-method）
      setKpi("QA化チェック中", meta.object_key, "-");
      const j = await judgeMethod(currentUser, meta.object_key);

      if (!j?.can_extract_qa) {
        const reasons = Array.isArray(j?.reasons) ? j.reasons.join("\n") : "";
        setKpi("NG", meta.object_key, "-");
        setStatus(
          `QA化NG: ${j?.reasons?.[0] || j?.message || "QAを生成できません。"}`
            + (reasons ? `\n${reasons}` : ""),
          "err"
        );
        return;
      }

      // judgeの方式を優先（無ければfinalizeのqa_mode）
      const modeFromJudge = String(j?.method || "").trim();
      const mode = modeFromJudge || String(fin?.qa_mode || "").trim();

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

      const mode = String(fin?.qa_mode || "").trim();
      setKpi(`OK（方式=${mode || "?"}）`, meta.object_key, "-");
      setStatus("アップロードOK。プロンプトを組み立てて表示します。", "ok");

      // finalize結果のDL
      btnDownload.disabled = false;

      // ★ここから：プロンプト定義を取得 → ファイルTEXTを埋め込み → messages表示
      if (!mode) {
        setPromptUI(null, "qa_mode が空です（finalizeの返却を確認）。");
        return;
      }

      // 1) プロンプト定義JSON（GCS）を取得
      setKpi(`OK（方式=${mode}）/ prompt取得`, meta.object_key, "-");
      const promptDef = await fetchPromptDef(currentUser, mode);

      // 2) ファイルTEXTを読み込む（ここでやる。アップロード済みでもローカルから読める）
      setKpi(`OK（方式=${mode}）/ TEXT読込`, meta.object_key, "-");
      const text = await readFileAsText(file);

      // 3) messages を構築して表示
      const messages = buildMessages(promptDef, text);

      setPromptUI(
        messages,
        `mode=${mode} / label=${promptDef?.label || "-"} / bytes=${file.size}`
      );

      setKpi(`OK（方式=${mode}）/ 表示完了`, meta.object_key, "-");
      setStatus("プロンプトを表示しました（コピー可能）。", "ok");

      // ※ この次の段階（OpenAIに投げる）は別ボタンにしてもいいし、
      //    まずは「表示して確認できる」を優先するならここで止めるのが安全。

    } catch (e) {
      console.error(e);
      setKpi("失敗", lastObjectKey, "-");
      setStatus(e?.message || String(e), "err");
    } finally {
      btnUploadAndGenerate.disabled = false;
    }
  };
})();
