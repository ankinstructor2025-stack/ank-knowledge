// qa_maintenance.js
// - 左：契約一覧（admin / active を想定）
// - 右：ファイルアップロード（機能だけ）
// - 実装は「API_BASE」と「apiFetch()」に寄せる（あなたの既存流儀に合わせやすい）

const API_BASE = window.API_BASE || ""; // 例: "https://xxxx-uc.a.run.app"
let selectedContract = null;

/**
 * 既存の admin.js / common.js 側に apiFetch があるなら、ここはそちらに寄せる想定。
 * いったん素の fetch 版を置く。
 * - Authorization は Firebase の ID Token を付ける想定（ここではダミー）。
 */
async function apiFetch(path, { method = "GET", body = null, headers = {} } = {}) {
  const url = `${API_BASE}${path}`;
  const h = { ...headers };

  // TODO: ここを既存の currentUser.getIdToken() に置き換える
  // h["Authorization"] = `Bearer ${token}`;

  if (body && !(body instanceof FormData)) {
    h["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers: h,
    body: body
      ? (body instanceof FormData ? body : JSON.stringify(body))
      : null
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json();
  return await res.text();
}

function $(id) { return document.getElementById(id); }

function logLine(msg, obj = null) {
  const el = $("log");
  const now = new Date().toISOString();
  const line = obj ? `${now} ${msg}\n${JSON.stringify(obj, null, 2)}\n` : `${now} ${msg}\n`;
  el.textContent = (line + "\n" + el.textContent).slice(0, 12000);
}

function setUploadEnabled(enabled) {
  $("uploadKind").disabled = !enabled;
  $("uploadNote").disabled = !enabled;
  $("fileInput").disabled = !enabled;
  $("uploadBtn").disabled = !enabled;
  $("dryRunBtn").disabled = !enabled;
  $("notSelectedMsg").style.visibility = enabled ? "hidden" : "visible";
}

function renderContracts(contracts) {
  const root = $("contracts");
  root.innerHTML = "";

  contracts.forEach(c => {
    const div = document.createElement("div");
    div.className = "contract-item";
    div.dataset.contractId = c.contract_id;

    div.innerHTML = `
      <div class="row" style="justify-content:space-between;">
        <div style="font-weight:700;">${escapeHtml(c.name || c.contract_name || c.contract_id)}</div>
        <span class="badge">${c.active ? "active" : "inactive"}</span>
      </div>
      <div class="muted">contract_id: ${escapeHtml(c.contract_id)}</div>
    `;

    div.addEventListener("click", () => {
      selectedContract = c;
      [...root.querySelectorAll(".contract-item")].forEach(x => x.classList.remove("selected"));
      div.classList.add("selected");
      $("selectedContractName").textContent = c.name || c.contract_name || c.contract_id;
      $("selectedContractId").textContent = c.contract_id;
      setUploadEnabled(true);
      logLine("契約を選択", { contract_id: c.contract_id, name: c.name || c.contract_name });
    });

    root.appendChild(div);
  });

  $("contractCount").textContent = `${contracts.length} 件`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * 契約一覧の取得
 * 想定API:
 *   GET /v1/contracts?active=true
 * 返却例:
 *   { contracts: [{contract_id, name, active}, ...] }
 */
async function loadContracts() {
  logLine("契約一覧 取得開始");
  try {
    // TODO: あなたの既存APIに合わせる
    const data = await apiFetch(`/v1/contracts?active=true`, { method: "GET" });
    const list = Array.isArray(data) ? data : (data.contracts || []);
    // active のみを強制（API側でもやる想定）
    const activeOnly = list.filter(x => x.active === true || x.active === 1 || x.active === "true");
    renderContracts(activeOnly);
    logLine("契約一覧 取得完了", { count: activeOnly.length });
  } catch (e) {
    logLine("契約一覧 取得失敗", { error: String(e) });
    renderContracts([]);
  }
}

/**
 * アップロードの基本方針（推奨）
 * 方式A: 署名付きURL（GCS Signed URL）をAPIが返し、ブラウザがGCSへ直接PUT
 * 方式B: multipart/form-data をAPIに投げ、APIがGCSへ保存
 *
 * 今日は UI だけなので、方式Aの形に寄せる（あとで拡張しやすい）
 *
 * 想定API:
 *   POST /v1/admin/upload-url
 *   body: { contract_id, kind, filename, content_type, note }
 *   res: { upload_url, object_key }
 */
async function requestUploadUrl({ contract_id, kind, file, note }) {
  const body = {
    contract_id,
    kind,
    filename: file.name,
    content_type: file.type || "application/octet-stream",
    note: note || ""
  };
  return await apiFetch(`/v1/admin/upload-url`, { method: "POST", body });
}

async function uploadToSignedUrl(uploadUrl, file) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream"
    },
    body: file
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GCS PUT ${res.status}: ${text}`);
  }
}

async function finalizeUpload({ contract_id, object_key }) {
  // 任意：DBに「アップロード済み」の記録を残す用途
  // 想定API:
  //   POST /v1/admin/upload-finalize
  //   body: { contract_id, object_key }
  return await apiFetch(`/v1/admin/upload-finalize`, { method: "POST", body: { contract_id, object_key } });
}

async function onDryRun() {
  if (!selectedContract) return;
  const file = $("fileInput").files?.[0];
  const kind = $("uploadKind").value;
  const note = $("uploadNote").value;

  const payload = {
    contract_id: selectedContract.contract_id,
    kind,
    filename: file ? file.name : "(no file)",
    content_type: file ? (file.type || "application/octet-stream") : "(no file)",
    note
  };
  logLine("ドライラン: /v1/admin/upload-url に渡す想定", payload);
}

async function onUpload() {
  if (!selectedContract) return;
  const file = $("fileInput").files?.[0];
  if (!file) {
    logLine("アップロード失敗: ファイル未選択");
    return;
  }

  const kind = $("uploadKind").value;
  const note = $("uploadNote").value;

  try {
    logLine("署名付きURLを要求");
    const { upload_url, object_key } = await requestUploadUrl({
      contract_id: selectedContract.contract_id,
      kind,
      file,
      note
    });

    logLine("GCSへアップロード開始", { object_key });
    await uploadToSignedUrl(upload_url, file);
    logLine("GCSへアップロード完了", { object_key });

    // 任意：完了通知
    try {
      const fin = await finalizeUpload({ contract_id: selectedContract.contract_id, object_key });
      logLine("アップロード確定（DB記録）", fin);
    } catch (e) {
      logLine("アップロード確定は未実装でも進行可", { error: String(e) });
    }

  } catch (e) {
    logLine("アップロード失敗", { error: String(e) });
  }
}

function init() {
  $("reloadContractsBtn").addEventListener("click", loadContracts);
  $("uploadBtn").addEventListener("click", onUpload);
  $("dryRunBtn").addEventListener("click", onDryRun);

  // 初期状態
  $("selectedContractName").textContent = "未選択";
  $("selectedContractId").textContent = "";
  setUploadEnabled(false);
  logLine("画面初期化完了");
  loadContracts();
}

init();
