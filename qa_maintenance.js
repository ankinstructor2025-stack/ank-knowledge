// qa_maintenance.js（完全版）
// - 左：契約一覧（/v1/contracts の結果をそのまま受け、admin + active だけ表示）
// - 右：対話情報アップロード（機能だけ：署名付きURL方式想定）
// - 認証：ank_firebase.js の requireUser() でログイン必須
// - API：ank_api.js の apiFetch(currentUser, path, ...) を使用
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
  el.textContent = (line + "\n" + el.textContent).slice(0, 20000);
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
// 契約一覧（/v1/contracts の仕様に完全追従）
// ----------------------------
//
// main.py の /v1/contracts は、こういう形の配列を返す：
// [
//   {
//     contract_id,
//     role,
//     user_contract_status,   // 'active' 等
//     contract_status,        // 'active' 等
//     start_at,
//     seat_limit,
//     knowledge_count,
//     monthly_amount_yen,
//     note,
//     payment_method_configured,
//     created_at,
//     current_period_end: null
//   }, ...
// ]
//

function normalizeContractsPayload(payload) {
  // 仕様上は配列だが、念のための保険
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.contracts)) return payload.contracts;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function isAdminActiveContract(c) {
  // 管理画面の左ペインに出す条件
  // - role が admin
  // - user_contract_status が active
  // - contract_status が active
  return (
    (c?.role || "") === "admin" &&
    (c?.user_contract_status || "") === "active" &&
    (c?.contract_status || "") === "active"
  );
}

function contractDisplayName(c) {
  // 左に出す表示名。今のAPI仕様では name が無いので note を使う（なければID）
  // ※ここは後で contracts テーブルに display_name を追加したら差し替え
  const note = (c?.note || "").trim();
  if (note) return note;
  return c?.contract_id || "(no contract_id)";
}

function renderContracts(contracts) {
  const root = $("contracts");
  root.innerHTML = "";

  contracts.forEach((c) => {
    const div = document.createElement("div");
    div.className = "contract-item";
    div.dataset.contractId = c.contract_id;

    const name = contractDisplayName(c);

    div.innerHTML = `
      <div class="row" style="justify-content:space-between;">
        <div style="font-weight:700;">${escapeHtml(name)}</div>
        <span class="badge">admin</span>
      </div>
      <div class="muted">contract_id: ${escapeHtml(c.contract_id)}</div>
      <div class="muted">月額: ${escapeHtml(String(c.monthly_amount_yen ?? ""))}円 / seats: ${escapeHtml(String(c.seat_limit ?? ""))}</div>
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

      logLine("契約を選択", {
        contract_id: c.contract_id,
        display: name,
        role: c.role,
        user_contract_status: c.user_contract_status,
        contract_status: c.contract_status,
      });
    });

    root.appendChild(div);
  });

  $("contractCount").textContent = `${contracts.length} 件`;
}

async function loadContracts() {
  logLine("契約一覧 取得開始");
  try {
    // 仕様どおり：/v1/contracts（クエリなし）
    const payload = await apiFetch(currentUser, "/v1/contracts", { method: "GET" });

    const list = normalizeContractsPayload(payload);

    // デバッグしやすいよう raw 件数だけは残す
    logLine("契約一覧 raw 件数", { raw_count: list.length });

    // 左ペインは「admin かつ active だけ」
    const adminActive = list.filter(isAdminActiveContract);

    renderContracts(adminActive);
    logLine("契約一覧 表示完了（admin+active）", { count: adminActive.length });
  } catch (e) {
    renderContracts([]);
    logLine("契約一覧 取得失敗", { error: String(e) });
  }
}

// ----------------------------
// アップロード（署名付きURL方式想定）
// ----------------------------
//
// 想定API（まだ未実装でOK）
// POST /v1/admin/upload-url
// body: { contract_id, kind, filename, content_type, note }
// res: { upload_url, object_key }
//
// PUT upload_url に file を送る（ブラウザ→GCS）
//
// 任意：完了通知
// POST /v1/admin/upload-finalize
// body: { contract_id, object_key }
//

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

async function finalizeUpload({ contract_id, object_key }) {
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
