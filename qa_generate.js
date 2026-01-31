// =====================
// 定数
// =====================
const API_UPLOAD_URL = "/v1/admin/upload-url";
const API_UPLOAD_FINALIZE = "/v1/admin/upload-finalize";
const API_QA_PROMPT = "/v1/admin/qa-prompt";
const API_JUDGE_METHOD = "/v1/admin/dialogues/judge-method";

// =====================
// ユーティリティ
// =====================
function setStatus(text, type = "info") {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = type;
}

function setKpi(status, sourceKey, count) {
  document.getElementById("kpi-status").textContent = status || "-";
  document.getElementById("kpi-source-key").textContent = sourceKey || "-";
  document.getElementById("kpi-count").textContent = count ?? "-";
}

// =====================
// API 呼び出し
// =====================
async function apiFetch(currentUser, path, { method = "GET", body = null } = {}) {
  if (!currentUser) throw new Error("not signed in");

  const token = await currentUser.getIdToken(true);
  const headers = {
    "Authorization": `Bearer ${token}`,
  };
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return await res.json();
  }
  return await res.text();
}

// =====================
// アップロード関連
// =====================
async function createUploadUrl(currentUser, file) {
  return await apiFetch(currentUser, API_UPLOAD_URL, {
    method: "POST",
    body: {
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size: file.size,
    },
  });
}

async function uploadFileToSignedUrl(signedUrl, file) {
  const res = await fetch(signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`upload failed: ${res.status}`);
  }
}

async function finalizeUpload(currentUser, meta, file) {
  return await apiFetch(currentUser, API_UPLOAD_FINALIZE, {
    method: "POST",
    body: {
      object_key: meta.object_key,
      filename: file.name,
      size: file.size,
    },
  });
}

// =====================
// ★ QA化チェック（judge-method）
// =====================
async function judgeMethod(currentUser, objectKey, contractId) {
  return await apiFetch(currentUser, API_JUDGE_METHOD, {
    method: "POST",
    body: {
      contract_id: contractId,
      object_key: objectKey,
    },
  });
}

// =====================
// プロンプト取得
// =====================
async function getQaPrompt(currentUser, mode) {
  return await apiFetch(
    currentUser,
    `${API_QA_PROMPT}?mode=${encodeURIComponent(mode)}`
  );
}

// =====================
// メイン処理
// =====================
document.getElementById("btnUploadAndGenerate").onclick = async () => {
  try {
    setStatus("処理開始");
    setKpi("-", "-", "-");

    const fileInput = document.getElementById("fileInput");
    const file = fileInput.files[0];
    if (!file) {
      setStatus("ファイルを選択してください", "err");
      return;
    }

    const currentUser = window.currentUser;
    const contractId = window.contractId;

    // 1) upload-url
    setStatus("アップロードURL取得中…");
    const meta = await createUploadUrl(currentUser, file);

    // 2) PUT upload
    setStatus("アップロード中…");
    await uploadFileToSignedUrl(meta.upload_url, file);

    // 3) finalize
    setStatus("アップロード確定中…");
    const fin = await finalizeUpload(currentUser, meta, file);

    // ★ 4) QA化チェック（ここが追加ポイント）
    setStatus("QA化チェック中…");
    setKpi("判定中", meta.object_key, "-");

    const judge = await judgeMethod(
      currentUser,
      meta.object_key,
      contractId
    );

    if (!judge?.can_extract_qa) {
      setKpi("NG", meta.object_key, "-");
      setStatus(
        `QA化NG: ${judge?.reasons?.[0] || "QAを生成できません。"}`,
        "err"
      );
      return;
    }

    // judge の方式を最優先
    const mode = judge.method || fin.qa_mode;
    setKpi(`OK（方式=${mode}）`, meta.object_key, "-");

    // 5) プロンプト表示
    setStatus("プロンプト取得中…");
    const prompt = await getQaPrompt(currentUser, mode);

    document.getElementById("promptArea").textContent =
      JSON.stringify(prompt, null, 2);

    setStatus("完了");
  } catch (e) {
    console.error(e);
    setStatus(String(e.message || e), "err");
  }
};
