import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

const { auth } = initFirebase();

const qs = new URLSearchParams(location.search);
const tenantId = (qs.get("tenant_id") || "").trim();
const accountId = (qs.get("account_id") || "").trim();

const metaLine = document.getElementById("metaLine");
const backBtn = document.getElementById("backBtn");

const inputText = document.getElementById("inputText");
const formatSel = document.getElementById("formatSel");
const titleInput = document.getElementById("titleInput");

const btnGenerate = document.getElementById("btnGenerate");
const btnReload = document.getElementById("btnReload");

const kpiState = document.getElementById("kpiState");
const kpiCount = document.getElementById("kpiCount");
const kpiJob = document.getElementById("kpiJob");

const statusEl = document.getElementById("status");
const historyBody = document.getElementById("historyBody");

function setStatus(msg, type = "") {
  statusEl.className = "status " + (type || "");
  statusEl.textContent = msg || "";
  statusEl.style.display = msg ? "block" : "none";
}

function setKpi(state, count, job) {
  kpiState.textContent = state ?? "-";
  kpiCount.textContent = (count == null ? "-" : String(count));
  kpiJob.textContent = job ?? "-";
}

function dlText(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function getTenant(currentUser) {
  return await apiFetch(
    currentUser,
    `/v1/tenant?tenant_id=${encodeURIComponent(tenantId)}&account_id=${encodeURIComponent(accountId)}`,
    { method: "GET" }
  );
}

// 生成：GCSに保存して job_id を返す想定
async function generateExport(currentUser, payload) {
  return await apiFetch(currentUser, "/v1/exports/qa-generate", {
    method: "POST",
    body: payload
  });
}

async function listExports(currentUser) {
  return await apiFetch(
    currentUser,
    `/v1/exports?account_id=${encodeURIComponent(accountId)}&tenant_id=${encodeURIComponent(tenantId)}`,
    { method: "GET" }
  );
}

async function getExport(currentUser, jobId) {
  return await apiFetch(
    currentUser,
    `/v1/exports/${encodeURIComponent(jobId)}?account_id=${encodeURIComponent(accountId)}&tenant_id=${encodeURIComponent(tenantId)}`,
    { method: "GET" }
  );
}

function fmtTs(s) {
  if (!s) return "-";
  // ISOっぽいならそのまま表示（厳密変換はしない）
  return String(s).replace("T", " ").replace("Z", "");
}

function clearHistory(msg = "読み込み中...") {
  historyBody.innerHTML = "";
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = 4;
  td.className = "muted";
  td.textContent = msg;
  tr.appendChild(td);
  historyBody.appendChild(tr);
}

function renderHistoryRows(currentUser, exportsList) {
  historyBody.innerHTML = "";
  if (!exportsList.length) {
    clearHistory("履歴はありません。");
    return;
  }

  for (const x of exportsList) {
    const tr = document.createElement("tr");

    const tdTime = document.createElement("td");
    tdTime.textContent = fmtTs(x.created_at);
    tr.appendChild(tdTime);

    const tdCount = document.createElement("td");
    tdCount.textContent = (x.qa_count == null ? "-" : String(x.qa_count));
    tr.appendChild(tdCount);

    const tdJob = document.createElement("td");
    tdJob.textContent = x.job_id || "-";
    tr.appendChild(tdJob);

    const tdAct = document.createElement("td");
    tdAct.style.display = "flex";
    tdAct.style.gap = "8px";
    tdAct.style.flexWrap = "wrap";

    const btnJson = document.createElement("button");
    btnJson.textContent = "JSONを取得";
    btnJson.onclick = async () => {
      try {
        setStatus("", "");
        const res = await getExport(currentUser, x.job_id);
        const text = JSON.stringify(res, null, 2);
        dlText(`qa_${x.job_id}.json`, text, "application/json");
      } catch (e) {
        console.error(e);
        setStatus(e?.message || String(e), "err");
      }
    };

    const btnCopy = document.createElement("button");
    btnCopy.textContent = "job_idをコピー";
    btnCopy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(String(x.job_id || ""));
        setStatus("コピーしました。", "ok");
      } catch {
        setStatus("コピーに失敗しました。", "err");
      }
    };

    tdAct.appendChild(btnJson);
    tdAct.appendChild(btnCopy);
    tr.appendChild(tdAct);

    historyBody.appendChild(tr);
  }
}

async function reloadHistory(currentUser) {
  try {
    clearHistory("読み込み中...");
    const res = await listExports(currentUser);
    const arr = Array.isArray(res?.exports) ? res.exports : [];
    renderHistoryRows(currentUser, arr);
  } catch (e) {
    console.error(e);
    clearHistory("履歴の取得に失敗しました。");
    setStatus(e?.message || String(e), "err");
  }
}

async function boot() {
  const currentUser = await requireUser(auth, { loginUrl: "./login.html" });

  metaLine.textContent = `tenant_id=${tenantId} / account_id=${accountId}`;

  backBtn.onclick = () => {
    location.href = `./tenants.html?account_id=${encodeURIComponent(accountId)}`;
  };

  // プランチェック（QAのみ以外で来た場合のガード）
  try {
    const tenant = await getTenant(currentUser);
    const planId = (tenant?.plan_id || "").trim();
    if (planId && planId !== "basic") {
      setStatus("この画面はQA作成のみプラン向けです。契約画面へ戻ります。", "err");
      // 迷子防止：数秒後に戻す
      setTimeout(() => {
        location.href =
          `./tenant_admin.html?tenant_id=${encodeURIComponent(tenantId)}` +
          `&account_id=${encodeURIComponent(accountId)}` +
          `&tab=contract`;
      }, 1200);
      return;
    }
  } catch (e) {
    // tenant取得できない場合は動けない
    setStatus(e?.message || String(e), "err");
    return;
  }

  setKpi("-", "-", "-");
  await reloadHistory(currentUser);

  btnReload.onclick = () => reloadHistory(currentUser);

  btnGenerate.onclick = async () => {
    setStatus("", "");
    const text = (inputText.value || "").trim();
    const fmt = (formatSel.value || "json").trim();
    const title = (titleInput.value || "").trim();

    if (!text) {
      setStatus("入力テキストが空です。", "err");
      return;
    }

    // 連打防止
    btnGenerate.disabled = true;
    setKpi("実行中", "-", "-");

    try {
      const res = await generateExport(currentUser, {
        account_id: accountId,
        tenant_id: tenantId,
        input_text: text,
        format: fmt,
        title: title
      });

      const jobId = res?.job_id || "";
      const count = res?.qa_count;

      setKpi("完了", count ?? "-", jobId || "-");
      setStatus("保存しました。履歴から再ダウンロードできます。", "ok");

      // 履歴再取得
      await reloadHistory(currentUser);
    } catch (e) {
      console.error(e);
      setKpi("失敗", "-", "-");
      setStatus(e?.message || String(e), "err");
    } finally {
      btnGenerate.disabled = false;
    }
  };
}

boot().catch(e => {
  console.error(e);
  setStatus(e?.message || String(e), "err");
});
