// qa_maintenance.js（100MB / テキスト以外を即エラーで止める版）
//
// - 左：契約一覧（/v1/contracts の結果から admin+active のみ表示）
// - 右：
//    ① 対話データアップロード（署名付きURL方式）
//       ★アップロード前に「テキスト以外」「100MB以上」をエラーにする
//    ② 対話データ一覧（upload_logs kind='dialogue'）から 1つ有効化
//    ③ 有効な対話データに対して QA作成ボタン
//
// 前提：同じフォルダに
//   ./ank_firebase.js
//   ./ank_api.js

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

// 「有効化」「QA作成」ボタンは、別の条件で制御
function setActivateEnabled(enabled) {
  $("activateDialogueBtn").disabled = !enabled;
}
function setBuildEnabled(enabled) {
  $("buildQaBtn").disabled = !enabled;
}

// ----------------------------
// ここが今回の追加：アップロード前チェック
// ----------------------------
const MAX_BYTES = 100 * 1024 * 1024; // 100MB

function isTextFile(file) {
  // 1) MIME が取れるなら text/* を許可（ブラウザによって空のことがある）
  const ct = (file?.type || "").toLowerCase();
  if (ct.startsWith("text/")) return true;

  // 2) 拡張子で許可（最低限）
  const name = (file?.name || "").toLowerCase();
  const okExt = [".txt", ".json", ".csv", ".md", ".log"];
  return okExt.some((ext) => name.endsWith(ext));
}

function validateBeforeUpload(file) {
  if (!file) return { ok: false, message: "ファイルが選択されていません" };

  // サイズ
  const size = Number(file.size || 0);
  if (size > MAX_BYTES) {
    return { ok: false, message: "100MB以上のファイルは非対応です" };
  }

  // テキスト判定（MIME or 拡張子）
  if (!isTextFile(file)) {
    return { ok: false, message: "テキスト以外のファイルは非対応です（.txt/.json/.csv など）" };
  }

  return { ok: true, message: "OK" };
}

// ----------------------------
// 状態
// ----------------------------
let currentUser = null;
let selectedContract = null;

// 対話データ一覧
let dialogues = [];              // [{upload_id, object_key, created_at, ...}]
let selectedDialogueKey = null;  // object_key
let activeDialogueKey = null;    // object_key（現在有効）

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

      // 右側を有効化
      setMainEnabled(true);

      // 対話データ状態はリセット
      dialogues = [];
      selectedDialogueKey = null;
      activeDialogueKey = null;
      renderDialogues();
      setActivateEnabled(false);
      setBuildEnabled(false);
      $("activeDialogueLabel").textContent = "";

      logLine("契約を選択", { contract_id: c.contract_id, display: name });

      // 契約を選んだら一覧を読み込む
      await loadDialogues();
    });

    root.appendChild(div);
  });

  $("contractCount").textContent = `${contracts.length} 件`;
}

async function loadContracts() {
  logLine("契約一覧 取得開始");
  try {
    const payload = await apiFetch(currentUser, "/v1/contracts", { method: "GET" });
    const list = normalizeContractsPayload(payload);
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
  // ★今回：size_bytes を送る（サーバ側でも同じチェックを入れられる）
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

  // ★今回：事前チェック結果も表示
  const check = validateBeforeUpload(file);

  logLine("ドライラン: /v1/admin/upload-url に渡す想定", {
    contract_id: selectedContract.contract_id,
    kind,
    filename: file ? file.name : "(no file)",
    content_type: file ? (file.type || "application/octet-stream") : "(no file)",
    size_bytes: file ? Number(file.size || 0) : 0,
    note,
    precheck: check,
  });
}

async function onUpload() {
  if (!selectedContract) return;

  const file = $("fileInput").files?.[0];

  // ★今回：アップロード前に即チェックして止める
  const pre = validateBeforeUpload(file);
  if (!pre.ok) {
    logLine("アップロード中止（事前チェックNG）", {
      reason: pre.message,
      filename: file?.name,
      content_type: file?.type || "",
      size_bytes: Number(file?.size || 0),
    });
    return;
  }

  const kind = $("uploadKind").value;  // dialogue
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

    try {
      const fin = await finalizeUpload({
        contract_id: selectedContract.contract_id,
        object_key,
        upload_id,
      });
      logLine("アップロード確定（DB記録）", fin);
    } catch (e) {
      logLine("アップロード確定は未実装でも進行可", { error: String(e) });
    }

    // アップロード後に一覧を再読込
    await loadDialogues();

  } catch (e) {
    logLine("アップロード失敗", { error: String(e) });
  }
}

// ----------------------------
// ② 対話データ一覧（upload_logs kind='dialogue'）
// ----------------------------
//
// 想定API（未実装でもUIは動く）
// GET /v1/admin/dialogues?contract_id=...
// -> {
//      active_object_key: "tenants/.../....txt" | null,
//      items: [
//        { upload_id, object_key, created_at, kind, month_key, original_filename? }
//      ]
//    }
//

function renderDialogues() {
  const listEl = $("dialogues");
  const emptyEl = $("dialoguesEmpty");

  listEl.innerHTML = "";

  if (!selectedContract) {
    emptyEl.textContent = "（契約を選択してください）";
    emptyEl.style.display = "block";
    setActivateEnabled(false);
    setBuildEnabled(false);
    return;
  }

  if (!dialogues || dialogues.length === 0) {
    emptyEl.textContent = "（対話データがありません）";
    emptyEl.style.display = "block";
    setActivateEnabled(false);
    setBuildEnabled(false);
    return;
  }

  emptyEl.style.display = "none";

  dialogues.forEach((d) => {
    const key = d.object_key;
    const isActive = activeDialogueKey && key === activeDialogueKey;
    const isSelected = selectedDialogueKey && key === selectedDialogueKey;

    const div = document.createElement("div");
    div.className = "item" + (isActive ? " active" : "");

    const created = d.created_at ? String(d.created_at) : "";
    const monthKey = d.month_key ? String(d.month_key) : "";
    const fileLabel = d.original_filename || key?.split("/").slice(-1)[0] || key;

    div.innerHTML = `
      <div class="item-top">
        <div class="radio">
          <input type="radio" name="dialoguePick" ${isSelected ? "checked" : ""} />
          <div>
            <div><span class="badge">${isActive ? "有効" : "保管"}</span> ${escapeHtml(fileLabel)}</div>
            <div class="small">month: ${escapeHtml(monthKey)} / created: ${escapeHtml(created)}</div>
          </div>
        </div>
        <div class="small mono">${escapeHtml(key)}</div>
      </div>
    `;

    div.querySelector("input[type=radio]").addEventListener("change", () => {
      selectedDialogueKey = key;
      setActivateEnabled(true);
      logLine("対話データを選択", { object_key: key });
      renderDialogues();
    });

    listEl.appendChild(div);
  });

  setBuildEnabled(!!activeDialogueKey);
  $("activeDialogueLabel").textContent = activeDialogueKey ? `有効: ${activeDialogueKey}` : "有効: 未選択";
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

    activeDialogueKey = res?.active_object_key || null;

    if (!selectedDialogueKey && activeDialogueKey) {
      selectedDialogueKey = activeDialogueKey;
      setActivateEnabled(true);
    } else if (!selectedDialogueKey) {
      setActivateEnabled(false);
    }

    logLine("対話データ一覧 取得完了", { count: dialogues.length, active: activeDialogueKey });

    renderDialogues();

  } catch (e) {
    dialogues = [];
    activeDialogueKey = null;
    selectedDialogueKey = null;
    setActivateEnabled(false);
    setBuildEnabled(false);
    $("activeDialogueLabel").textContent = "";
    renderDialogues();
    logLine("対話データ一覧 取得失敗", { error: String(e) });
  }
}

// 有効化
async function onActivateDialogue() {
  if (!selectedContract) return;
  if (!selectedDialogueKey) return;

  const contract_id = selectedContract.contract_id;
  const object_key = selectedDialogueKey;

  try {
    logLine("対話データ 有効化開始", { contract_id, object_key });

    const res = await apiFetch(currentUser, "/v1/admin/dialogues/activate", {
      method: "POST",
      body: { contract_id, object_key },
    });

    logLine("対話データ 有効化完了", res);

    await loadDialogues();

  } catch (e) {
    logLine("対話データ 有効化失敗", { error: String(e) });
  }
}

// ----------------------------
// ③ QA作成
// ----------------------------
//
// 想定：POST /v1/admin/dialogues/build-qa { contract_id }
// API側で contracts.active_dialogue_object_key を見て開始
//
async function onBuildQa() {
  if (!selectedContract) return;
  if (!activeDialogueKey) {
    logLine("QA作成: 有効な対話データが未選択");
    return;
  }

  const contract_id = selectedContract.contract_id;

  try {
    logLine("QA作成 開始", { contract_id });

    const res = await apiFetch(currentUser, "/v1/admin/dialogues/build-qa", {
      method: "POST",
      body: { contract_id },
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
  $("activateDialogueBtn").addEventListener("click", onActivateDialogue);
  $("buildQaBtn").addEventListener("click", onBuildQa);

  // 初期状態
  $("selectedContractName").textContent = "未選択";
  $("selectedContractId").textContent = "";
  $("activeDialogueLabel").textContent = "";
  setMainEnabled(false);
  setActivateEnabled(false);
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
