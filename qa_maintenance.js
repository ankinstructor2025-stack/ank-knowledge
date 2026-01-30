// qa_maintenance.js（修正版）
// - 対話データの「有効/無効」概念を廃止
// - 一覧から「QA作成に使う対話データ」を1つ選ぶだけ
// - /v1/admin/dialogues/activate は呼ばない
// - /v1/admin/dialogues/build-qa は object_key を送る（サーバ側も合わせる前提）

import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

function $(id) { return document.getElementById(id); }

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
  const line = obj ? `${now} ${msg}\n${JSON.stringify(obj, null, 2)}\n` : `${now} ${msg}\n`;
  el.textContent = (line + "\n" + el.textContent).slice(0, 20000);
}

function setMainEnabled(enabled) {
  $("uploadKind").disabled = !enabled;
  $("uploadNote").disabled = !enabled;
  $("fileInput").disabled = !enabled;
  $("uploadBtn").disabled = !enabled;
  $("dryRunBtn").disabled = !enabled;
  $("reloadDialoguesBtn").disabled = !enabled;
  $("notSelectedMsg").style.visibility = enabled ? "hidden" : "visible";
}

function setBuildEnabled(enabled) { $("buildQaBtn").disabled = !enabled; }

// ----------------------------
// 画面内（ファイル欄付近）エラー表示
// ----------------------------
function showFileError(message) {
  const el = $("fileError");
  if (!el) return;
  el.textContent = String(message || "");
  el.style.display = "block";
}
function clearFileError() {
  const el = $("fileError");
  if (!el) return;
  el.textContent = "";
  el.style.display = "none";
}

// ----------------------------
// アップロード前チェック（1KB〜100MB / テキスト）
// ----------------------------
const MIN_BYTES = 1024;              // 1KB
const MAX_BYTES = 100 * 1024 * 1024; // 100MB

function isTextFile(file) {
  const ct = (file?.type || "").toLowerCase();
  if (ct.startsWith("text/")) return true;

  const name = (file?.name || "").toLowerCase();
  const okExt = [".txt", ".json", ".csv"];
  return okExt.some((ext) => name.endsWith(ext));
}

function validateBeforeUpload(file) {
  if (!file) return { ok: false, message: "ファイルが選択されていません" };

  const size = Number(file.size || 0);

  if (size < MIN_BYTES) {
    return { ok: false, message: "ファイルサイズが小さすぎます（1KB以上のテキストが必要です）" };
  }
  if (size > MAX_BYTES) {
    return { ok: false, message: "ファイルサイズが大きすぎます（上限は100MBです）" };
  }
  if (!isTextFile(file)) {
    return { ok: false, message: "テキスト以外のファイルはアップロードできません（.txt / .json / .csv）" };
  }
  return { ok: true };
}

// ----------------------------
// 状態
// ----------------------------
let currentUser = null;
let selectedContract = null;

let dialogues = [];
let selectedDialogueKey = null; // object_key

function setSelectedDialogueLabel() {
  const el = $("selectedDialogueLabel");
  if (!el) return;
  el.textContent = selectedDialogueKey ? `選択: ${selectedDialogueKey}` : "選択: 未選択";
}

// ----------------------------
// 契約一覧（/v1/contracts 仕様）
// ----------------------------
function normalizeContractsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.contracts)) return payload.contracts;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function isAdminActiveContract(c) {
  return (
    (c?.role || "") === "admin" &&
    (c?.user_contract_status || "") === "active" &&
    (c?.contract_status || "") === "active"
  );
}

function contractDisplayName(c) {
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

    div.addEventListener("click", async () => {
      selectedContract = c;

      [...root.querySelectorAll(".contract-item")].forEach((x) => x.classList.remove("selected"));
      div.classList.add("selected");

      $("selectedContractName").textContent = name;
      $("selectedContractId").textContent = c.contract_id || "";

      setMainEnabled(true);
      clearFileError();

      dialogues = [];
      selectedDialogueKey = null;
      renderDialogues();
      setBuildEnabled(false);
      setSelectedDialogueLabel();

      logLine("契約を選択", { contract_id: c.contract_id, display: name });

      await loadDialogues();
    });

    root.appendChild(div);
  });

  $("contractCount").textContent = `${contracts.length} 件`;
}

async function loadContracts() {
  logLine("契約一覧 取得開始");
  try {
    // tenant_id は URL or session から取得
    const payload = await apiFetch(
      currentUser,
      `/v1/tenants/${tenantId}/contract`,
      { method: "GET" }
    );
    const adminActive = list.filter(isAdminActiveContract);
    renderContracts(adminActive);
    logLine("契約一覧 表示完了（admin+active）", { count: adminActive.length });
  } catch (e) {
    renderContracts([]);
    logLine("契約一覧 取得失敗", { error: String(e) });
  }
}

// ----------------------------
// ① 対話データアップロード（署名URL方式）
// ----------------------------
async function requestUploadUrl({ contract_id, kind, file, note }) {
  const body = {
    contract_id,
    kind,
    filename: file.name,
    content_type: file.type || "application/octet-stream",
    size_bytes: Number(file.size || 0),
    note: note || "",
  };
  return await apiFetch(currentUser, "/v1/admin/upload-url", { method: "POST", body });
}

async function uploadToSignedUrl(uploadUrl, file) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GCS PUT ${res.status}: ${text}`);
  }
}

async function finalizeUpload({ contract_id, object_key, upload_id }) {
  return await apiFetch(currentUser, "/v1/admin/upload-finalize", {
    method: "POST",
    body: { contract_id, object_key, upload_id },
  });
}

async function onDryRun() {
  if (!selectedContract) return;

  const file = $("fileInput").files?.[0];
  const kind = $("uploadKind").value;
  const note = $("uploadNote").value;

  const precheck = validateBeforeUpload(file);

  logLine("ドライラン: /v1/admin/upload-url に渡す想定", {
    contract_id: selectedContract.contract_id,
    kind,
    filename: file ? file.name : "(no file)",
    content_type: file ? (file.type || "application/octet-stream") : "(no file)",
    size_bytes: file ? Number(file.size || 0) : 0,
    note,
    precheck,
  });

  if (!precheck.ok) showFileError(precheck.message);
  else clearFileError();
}

async function onUpload() {
  if (!selectedContract) return;

  const file = $("fileInput").files?.[0];

  const pre = validateBeforeUpload(file);
  if (!pre.ok) {
    showFileError(pre.message);
    logLine("アップロード中止（事前チェックNG）", {
      reason: pre.message,
      filename: file?.name,
      content_type: file?.type || "",
      size_bytes: Number(file?.size || 0),
    });
    return;
  }

  clearFileError();

  const kind = $("uploadKind").value;
  const note = $("uploadNote").value;

  try {
    logLine("署名付きURLを要求", {
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size_bytes: Number(file.size || 0),
    });

    const { upload_url, object_key, upload_id } = await requestUploadUrl({
      contract_id: selectedContract.contract_id,
      kind,
      file,
      note,
    });

    if (!upload_url || !object_key || !upload_id) {
      throw new Error("upload_url / object_key / upload_id が不足しています");
    }

    logLine("GCSへアップロード開始", { object_key });
    await uploadToSignedUrl(upload_url, file);
    logLine("GCSへアップロード完了", { object_key });

    const fin = await finalizeUpload({
      contract_id: selectedContract.contract_id,
      object_key,
      upload_id,
    });

    // finalize が ok:false のときは NG
    if (fin && fin.ok === false) {
      showFileError("QA化できない形式です");
      logLine("アップロード失敗（判定NG）", fin);
      return;
    }

    logLine("アップロード成功（DB記録）", fin);

    // 一覧の再読込＋「最新を自動選択」
    await loadDialogues();

    // 最新の object_key を選ぶ（返ってきたものを優先）
    if (fin?.object_key) {
      selectedDialogueKey = fin.object_key;
    } else if (object_key) {
      selectedDialogueKey = object_key;
    }
    setSelectedDialogueLabel();
    setBuildEnabled(!!selectedDialogueKey);

  } catch (e) {
    showFileError(String(e));
    logLine("アップロード失敗", { error: String(e) });
  }
}

// ----------------------------
// ② 対話データ一覧（選択のみ）
// ----------------------------
function renderDialogues() {
  const listEl = $("dialogues");
  const emptyEl = $("dialoguesEmpty");

  listEl.innerHTML = "";

  if (!selectedContract) {
    emptyEl.textContent = "（契約を選択してください）";
    emptyEl.style.display = "block";
    setBuildEnabled(false);
    return;
  }

  if (!dialogues || dialogues.length === 0) {
    emptyEl.textContent = "（対話データがありません）";
    emptyEl.style.display = "block";
    setBuildEnabled(false);
    return;
  }

  emptyEl.style.display = "none";

  dialogues.forEach((d) => {
    const key = d.object_key;
    const isSelected = selectedDialogueKey && key === selectedDialogueKey;

    const div = document.createElement("div");
    div.className = "item" + (isSelected ? " selected" : "");

    const created = d.created_at ? String(d.created_at) : "";
    const monthKey = d.month_key ? String(d.month_key) : "";
    const fileLabel = d.original_filename || key?.split("/").slice(-1)[0] || key;

    div.innerHTML = `
      <div class="item-top">
        <div class="radio">
          <input type="radio" name="dialoguePick" ${isSelected ? "checked" : ""} />
          <div>
            <div>${escapeHtml(fileLabel)}</div>
            <div class="small">month: ${escapeHtml(monthKey)} / created: ${escapeHtml(created)}</div>
          </div>
        </div>
        <div class="small mono">${escapeHtml(key)}</div>
      </div>
    `;

    div.querySelector("input[type=radio]").addEventListener("change", () => {
      selectedDialogueKey = key;
      setSelectedDialogueLabel();
      setBuildEnabled(true);
      logLine("対話データを選択", { object_key: key });
      renderDialogues();
    });

    listEl.appendChild(div);
  });

  setSelectedDialogueLabel();
  setBuildEnabled(!!selectedDialogueKey);
}

async function loadDialogues() {
  if (!selectedContract) return;

  const contract_id = selectedContract.contract_id;

  logLine("対話データ一覧 取得開始", { contract_id });

  try {
    const res = await apiFetch(
      currentUser,
      `/v1/admin/dialogues?contract_id=${encodeURIComponent(contract_id)}`,
      { method: "GET" }
    );

    const items = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
    dialogues = items;

    logLine("対話データ一覧 取得完了", { count: dialogues.length });

    // 何も選ばれていなければ先頭を選ぶ（任意：不要なら消してOK）
    if (!selectedDialogueKey && dialogues.length > 0) {
      selectedDialogueKey = dialogues[0].object_key;
    }

    renderDialogues();

  } catch (e) {
    dialogues = [];
    selectedDialogueKey = null;
    setBuildEnabled(false);
    renderDialogues();
    logLine("対話データ一覧 取得失敗", { error: String(e) });
  }
}

// ----------------------------
// ③ QA作成（選択中 object_key を送る）
// ----------------------------
async function onBuildQa() {
  if (!selectedContract) return;
  if (!selectedDialogueKey) {
    logLine("QA作成: 対話データが未選択");
    return;
  }

  const contract_id = selectedContract.contract_id;
  const object_key = selectedDialogueKey;

  try {
    logLine("QA作成 開始", { contract_id, object_key });

    // ★変更：object_key を送る
    const res = await apiFetch(currentUser, "/v1/qa/build", {
      method: "POST",
      body: { contract_id, object_key },
    });

    logLine("QA作成 要求完了", res);

  } catch (e) {
    logLine("QA作成 失敗", { error: String(e) });
  }
}

// ----------------------------
// 初期化
// ----------------------------
async function init() {
  $("reloadContractsBtn").addEventListener("click", loadContracts);
  $("uploadBtn").addEventListener("click", onUpload);
  $("dryRunBtn").addEventListener("click", onDryRun);
  $("reloadDialoguesBtn").addEventListener("click", loadDialogues);
  $("buildQaBtn").addEventListener("click", onBuildQa);

  $("fileInput").addEventListener("change", () => {
    clearFileError();
  });

  $("selectedContractName").textContent = "未選択";
  $("selectedContractId").textContent = "";
  setSelectedDialogueLabel();
  clearFileError();
  setMainEnabled(false);
  setBuildEnabled(false);
  renderDialogues();

  logLine("画面初期化開始");

  const { auth } = initFirebase();
  currentUser = await requireUser(auth, { loginUrl: "./login.html", waitMs: 5000 });

  logLine("ログイン確認OK", { uid: currentUser.uid, email: currentUser.email });

  await loadContracts();

  logLine("画面初期化完了");
}

await init();
