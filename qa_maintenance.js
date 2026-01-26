// qa_maintenance.js（完全版：サイズチェックOKなら "Hi" を ank-knowledge-api /v1/echo に送って戻りを表示）
//
// 注意：
// - 既存の apiFetch() は admin系API（/v1/contracts, /v1/admin/*）を叩く前提
// - echo は ank-knowledge-api に行かせたいので、別BASEで叩く関数をこのファイル内に用意する

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
  $("echoTestBtn").disabled = !enabled; // ★追加
  $("judgeMethodBtn").disabled = !enabled; // ★追加
  $("reloadDialoguesBtn").disabled = !enabled;
  $("notSelectedMsg").style.visibility = enabled ? "hidden" : "visible";
}

function setActivateEnabled(enabled) { $("activateDialogueBtn").disabled = !enabled; }
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
function setJudgeLabel(text) {
  const el = $("judgeMethodLabel");
  if (!el) return;
  el.textContent = text || "";
}

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
  const okExt = [".txt", ".json", ".csv", ".md", ".log"];
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
    return { ok: false, message: "テキスト以外のファイルはアップロードできません（.txt / .json / .csv など）" };
  }
  return { ok: true };
}

// ----------------------------
// ★追加：ank-knowledge-api にだけ飛ばすための BASE
// ここをあなたの Cloud Run URL に合わせて設定する
// ----------------------------
const KNOWLEDGE_API_BASE = "https://ank-knowledge-api-986862757498.asia-northeast1.run.app";

// Bearer token 付きで任意BASEへPOST/GETする（echo専用に使う）
async function apiFetchToBase(user, baseUrl, path, { method = "GET", body = null } = {}) {
  if (!user) throw new Error("not signed in");

  const token = await user.getIdToken(true);

  const headers = {
    "Authorization": `Bearer ${token}`,
  };
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${text}`);
  }

  // echoはjson想定
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ----------------------------
// 状態
// ----------------------------
let currentUser = null;
let selectedContract = null;

let dialogues = [];
let selectedDialogueKey = null;
let activeDialogueKey = null;

// 方式判定結果（最後の判定）
let lastJudge = null; // {can_extract_qa, method, confidence, reasons, stats}

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
      setJudgeLabel("");
      lastJudge = null;

      dialogues = [];
      selectedDialogueKey = null;
      activeDialogueKey = null;
      renderDialogues();
      setActivateEnabled(false);
      setBuildEnabled(false);
      $("activeDialogueLabel").textContent = "";

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

    await loadDialogues();

  } catch (e) {
    showFileError(String(e));
    logLine("アップロード失敗", { error: String(e) });
  }
}

// ----------------------------
// ★追加：OpenAI echo テスト（ファイルチェックOKなら "Hi" を送る）
// ----------------------------
async function onEchoTest() {
  if (!selectedContract) return;

  const file = $("fileInput").files?.[0];
  const pre = validateBeforeUpload(file);
  if (!pre.ok) {
    showFileError(pre.message);
    logLine("OpenAI Echoテスト中止（事前チェックNG）", {
      reason: pre.message,
      filename: file?.name,
      content_type: file?.type || "",
      size_bytes: Number(file?.size || 0),
    });
    return;
  }

  clearFileError();

  // ここで入力は不要。常にHi。
  const message = "Hi";

  try {
    logLine("OpenAI Echoテスト 開始（ank-knowledge-api）", { message });

    const res = await apiFetchToBase(currentUser, KNOWLEDGE_API_BASE, "/v1/echo", {
      method: "POST",
      body: { message },
    });

    logLine("OpenAI Echoテスト 成功", res);

  } catch (e) {
    showFileError(String(e));
    logLine("OpenAI Echoテスト 失敗", { error: String(e) });
  }
}


// ----------------------------
// ★追加：方式判定（/v1/admin/dialogues/judge-method）
// - selectedDialogueKey があればそれを優先、なければ activeDialogueKey
// - contract_id は必須
// ----------------------------
async function onJudgeMethod() {
  if (!selectedContract) return;

  const file = $("fileInput").files?.[0];
  const pre = validateBeforeUpload(file);
  if (!pre.ok) {
    showFileError(pre.message);
    logLine("方式判定 中止（事前チェックNG）", {
      reason: pre.message,
      filename: file?.name,
      content_type: file?.type || "",
      size_bytes: Number(file?.size || 0),
    });
    return;
  }

  clearFileError();

  const contract_id = selectedContract.contract_id;
  const object_key = selectedDialogueKey || activeDialogueKey || null;

  try {
    logLine("方式判定 開始", { contract_id, object_key });

    const body = object_key ? { contract_id, object_key } : { contract_id };
    const res = await apiFetch(currentUser, "/v1/admin/dialogues/judge-method", {
      method: "POST",
      body,
    });

    lastJudge = res;
    const method = res?.method ? String(res.method) : "-";
    const conf = (typeof res?.confidence === "number") ? res.confidence.toFixed(2) : "";
    const ok = !!res?.can_extract_qa;

    setJudgeLabel(ok ? `判定: ${method}（conf ${conf}）` : "判定: QA抽出不可");
    logLine("方式判定 完了", res);

    if (!ok) {
      const reasons = Array.isArray(res?.reasons) ? res.reasons.join(" / ") : "";
      showFileError(reasons ? `QA抽出できません: ${reasons}` : "QA抽出できません");
    }
  } catch (e) {
    setJudgeLabel("判定: 失敗");
    showFileError(String(e));
    logLine("方式判定 失敗", { error: String(e) });
  }
}

// ----------------------------
// ② 対話データ一覧
// ----------------------------
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
    setJudgeLabel("");
    lastJudge = null;
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
  $("echoTestBtn").addEventListener("click", onEchoTest); // ★追加
  $("judgeMethodBtn").addEventListener("click", onJudgeMethod); // ★追加
  $("reloadDialoguesBtn").addEventListener("click", loadDialogues);
  $("activateDialogueBtn").addEventListener("click", onActivateDialogue);
  $("buildQaBtn").addEventListener("click", onBuildQa);

  $("fileInput").addEventListener("change", () => {
    clearFileError();
  });

  $("selectedContractName").textContent = "未選択";
  $("selectedContractId").textContent = "";
  $("activeDialogueLabel").textContent = "";
  setJudgeLabel("");
  clearFileError();
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
