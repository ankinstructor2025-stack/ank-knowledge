import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

const { auth } = initFirebase();

const qs = new URLSearchParams(location.search);
const contractId = (qs.get("contract_id") || "").trim();

const fileInput = document.getElementById("fileInput");
const btnUploadAndGenerate = document.getElementById("btnUploadAndGenerate");
const btnDownload = document.getElementById("btnDownload");

const kpiState = document.getElementById("kpiState");
const kpiSource = document.getElementById("kpiSource");
const kpiCount = document.getElementById("kpiCount");
const statusEl = document.getElementById("status");

const API_UPLOAD_URL = "/v1/admin/upload-url";
const API_UPLOAD_FINALIZE = "/v1/admin/upload-finalize";

const MIN_BYTES = 1024;

let lastFinalize = null;

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

async function requestUploadUrl(currentUser, file) {
  return await apiFetch(currentUser, API_UPLOAD_URL, {
    method: "POST",
    body: {
      contract_id: contractId,
      kind: "dialogue",
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      note: ""
    }
  });
}

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

async function finalizeUpload(currentUser, meta, file) {
  return await apiFetch(currentUser, API_UPLOAD_FINALIZE, {
    method: "POST",
    body: {
      contract_id: contractId,
      upload_id: meta.upload_id,
      object_key: meta.object_key,
      filename: file.name,
      content_type: file.type || "",
      kind: "dialogue"
    }
  });
}

btnDownload.onclick = () => {
  if (!lastFinalize) return;
  const blob = new Blob([JSON.stringify(lastFinalize, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "upload_finalize_result.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

(async function boot(){
  const currentUser = await requireUser(auth, { loginUrl: "./login.html" });

  if (!contractId) {
    setStatus("contract_id がありません（URLに ?contract_id=... を付けてください）。", "err");
    btnUploadAndGenerate.disabled = true;
    return;
  }

  setKpi("-", "-", "-");
  setStatus("", "");

  btnUploadAndGenerate.onclick = async () => {
    setStatus("", "");
    lastFinalize = null;
    btnDownload.disabled = true;

    const file = fileInput.files && fileInput.files[0];
    if (!file) { setStatus("ファイルを選択してください。", "err"); return; }
    if (file.size < MIN_BYTES) { setStatus("1KB未満のファイルは対象外です。", "err"); return; }

    btnUploadAndGenerate.disabled = true;
    try {
      setKpi("署名URL取得", "-", "-");
      const meta = await requestUploadUrl(currentUser, file); // {upload_id, object_key, upload_url,...}
      setKpi("アップロード中", meta.object_key, "-");

      await putToSignedUrl(meta.upload_url, file);

      setKpi("判定中", meta.object_key, "-");
      const fin = await finalizeUpload(currentUser, meta, file);
      lastFinalize = fin;

      if (!fin.ok) {
        setKpi("NG", meta.object_key, "-");
        setStatus(`QA化NG: ${fin.message || ""}\n${(fin.reasons||[]).join("\n")}`, "err");
        return;
      }

      setKpi(`OK（方式=${fin.qa_mode}）`, meta.object_key, "-");
      setStatus("アップロードOK。次はこのobject_keyを使ってQA抽出に進めます。", "ok");
      btnDownload.disabled = false;

    } catch(e) {
      console.error(e);
      setStatus(e?.message || String(e), "err");
      setKpi("失敗", "-", "-");
    } finally {
      btnUploadAndGenerate.disabled = false;
    }
  };
})();
