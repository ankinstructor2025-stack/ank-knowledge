// qa_maintenance.js
// - 左：契約一覧（admin / active）
// - 右：対話情報アップロード（機能だけ：署名付きURL方式想定）
//
// 前提：同じフォルダにこの2ファイルがある
//   ./ank_firebase.js
//   ./ank_api.js
//
// qa_maintenance.html 側は <script type="module" src="./qa_maintenance.js"></script> で読み込む

import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function logLine(msg, obj = null) {
  const el = $("log");
  const now = new Date().toISOString();
  const line = obj
    ? `${now} ${msg}\n${JSON.stringify(obj, null, 2)}\n`
    : `${now} ${msg}\n`;
  // 新しいログを先頭に積む（上限は適当に）
  el.textContent = (line + "\n" + el.textContent).slice(0, 16000);
}

function setUploadEnabled(enabled) {
  $("uploadKind").disabled = !enabled;
  $("uploadNote").disabled = !enabled;
  $("fileInput").disabled = !enabled;
  $("uploadBtn").disabled = !enabled;
  $("dryRunBtn").disabled = !enabled;
  $("notSelectedMsg").style.visibility = enabled ? "hidden" : "visible";
}

// ----------------------------
// 状態
// ----------------------------
let currentUser = null;
let selectedContract = null;

// ----------------------------
// 契約一覧
// ----------------------------

function normalizeContractsPayload(payload) {
  // 返却形を吸収する
  // - 配列そのまま
  // - { contracts: [...] }
  // - { rows: [...] } など、将来の揺れも最低限吸収
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.contracts)) return payload.contracts;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function isActiveContract(c) {
  // active の表現ゆれ吸収
  return c?.active === true || c?.active === 1 || c?.active === "true" || c?.active === "1";
}

function renderContracts(contracts) {
  const root = $("contracts");
  root.innerHTML = "";

  contracts.forEach((c) => {
    const div = document.createElement("div");
    div.className = "contract-item";
    div.dataset.contractId = c.contract_id;

    const name = c.name || c.contract_name || c.contract_id;
    const active = isActiveContract(c);

    div.innerHTML = `
      <div class="row" style="justify-content:space-between;">
        <div style="font-weight:700;">${escapeHtml(name)}</div>
        <span class="badge">${active ? "active" : "inactive"}</span>
      </div>
      <div class="muted">contract_id: ${escapeHtml(c.contract_id)}</div>
    `;

    div.addEventListener("click", () => {
      selectedContract = c;

      [...root.querySelectorAll(".contract-item")].forEach((x) =>
        x.classList.remove("selected")
      );
      div.classList.add("selected");

      $("selectedContractName").textContent = name;
      $("selectedContractId").textContent = c.contract_id || "";
      setUploadEnabled(true);

      logLine("契約を選択", { contract_id: c.contract_id, name });
    });

    root.appendChild(div);
  });

  $("contractCount").textContent = `${contracts.length} 件`;
}

async function loadContracts() {
  logLine("契約一覧 取得開始");
  try {
    // あなたの既存APIに合わせる：
    // - 例：GET /v1/contracts?active=true
    const payload = await apiFetch(currentUser, "/v1/contracts?active=true", {
      method: "GET",
    });

    const list = normalizeContractsPayload(payload);
    const activeOnly = list.filter(isActiveContract);

    renderContracts(activeOnly);
    logLine("契約一覧 取得完了", { count: activeOnly.length });
  } catch (e) {
    renderContracts([]);
    logLine("契約一覧 取得失敗", { error: String(e) });
  }
}

// ----------------------------
// アップロード（署名付きURL方式想定）
// ----------------------------

// 想定API
// POST /v1/admin/upload-url
// body: { contract_id, kind, filename, content_type, note }
// res: { upload_url, object_key }
async function requestUploadUrl({ contract_id, kind, file, note }) {
  const body = {
    contract_id,
    kind,
    filename: file.name,
    content_type: file.type || "application/octet-stream",
    note: note || "",
  };

  return await apiFetch(currentUser, "/v1/admin/upload-url", {
    method: "POST",
    body,
  });
}

// ブラウザ → GCS PUT（upload_url へ）
async function uploadToSignedUrl(uploadUrl, file) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GCS PUT ${res.status}: ${text}`);
  }
}

// 任意：完了通知（DB記録など）
async function finalizeUpload({ contract_id, object_key }) {
  // 想定API
  // POST /v1/admin/upload-finalize
  // body: { contract_id, object_key }
  return await apiFetch(currentUser, "/v1/admin/upload-finalize", {
    method: "POST",
    body: { contract_id, object_key },
  });
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
    content_type: file ? file.type || "application/octet-stream" : "(no file)",
    note,
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
      note,
    });

    if (!upload_url || !object_key) {
      throw new Error("upload_url / object_key が不足しています");
    }

    logLine("GCSへアップロード開始", { object_key });
    await uploadToSignedUrl(upload_url, file);
    logLine("GCSへアップロード完了", { object_key });

    // finalize は「あるなら呼ぶ」。未実装でも画面は成立する想定
    try {
      const fin = await finalizeUpload({
        contract_id: selectedContract.contract_id,
        object_key,
      });
      logLine("アップロード確定（DB記録）", fin);
    } catch (e) {
      logLine("アップロード確定は未実装でも進行可", { error: String(e) });
    }
  } catch (e) {
    logLine("アップロード失敗", { error: String(e) });
  }
}

// ----------------------------
// 初期化
// ----------------------------
async function init() {
  $("reloadContractsBtn").addEventListener("click", loadContracts);
  $("uploadBtn").addEventListener("click", onUpload);
  $("dryRunBtn").addEventListener("click", onDryRun);

  // 初期状態
  $("selectedContractName").textContent = "未選択";
  $("selectedContractId").textContent = "";
  setUploadEnabled(false);

  logLine("画面初期化開始");

  // Firebase / ログイン必須（未ログインなら login.html へ）
  const { auth } = initFirebase();
  currentUser = await requireUser(auth, { loginUrl: "./login.html", waitMs: 5000 });

  logLine("ログイン確認OK", {
    uid: currentUser.uid,
    email: currentUser.email,
  });

  await loadContracts();

  logLine("画面初期化完了");
}

// module なので top-level await でOK
await init();
