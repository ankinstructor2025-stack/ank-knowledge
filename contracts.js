import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

const { auth } = initFirebase();

function roleLabel(role) {
  if (role === "admin") return "管理者";
  if (role === "member") return "メンバー";
  return role ?? "-";
}
function yen(n) {
  if (n == null || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("ja-JP") + "円";
}
function safeText(s) {
  const t = (s ?? "").toString().trim();
  return t ? t : "-";
}

function openContractDetail(contractId) {
  location.href = `contract_detail.html?contract_id=${encodeURIComponent(contractId)}`;
}
function editContract(contractId) {
  location.href = `contract_edit.html?contract_id=${encodeURIComponent(contractId)}`;
}
function openMembers(contractId) {
  location.href = `members.html?contract_id=${encodeURIComponent(contractId)}`;
}

async function loadContracts(currentUser) {
  const contracts = await apiFetch(currentUser, "/v1/contracts");

  const tbody = document.querySelector("#contractsTable tbody");
  tbody.innerHTML = "";

  for (const c of contracts) {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => openContractDetail(c.contract_id));

    const actionsHtml = (c.role === "admin")
      ? `<button class="btnEdit">編集</button><button class="btnMembers">メンバー</button>`
      : `-`;

    // note は一覧識別用：長い場合はCSSで省略
    const note = safeText(c.note);

    tr.innerHTML = `
      <td><code>${c.contract_id}</code></td>
      <td class="note" title="${(c.note ?? "").toString().replaceAll('"','&quot;')}">${note}</td>
      <td>${yen(c.monthly_amount_yen)}</td>
      <td>${roleLabel(c.role)}</td>
      <td>${c.contract_status ?? "-"}</td>
      <td>${c.seat_limit ?? "-"}</td>
      <td>${c.knowledge_count ?? "-"}</td>
      <td>${c.payment_method_configured ? "設定済" : "未設定"}</td>
      <td>${actionsHtml}</td>
    `;

    if (c.role === "admin") {
      tr.querySelector(".btnEdit").addEventListener("click", (e) => {
        e.stopPropagation();
        editContract(c.contract_id);
      });
      tr.querySelector(".btnMembers").addEventListener("click", (e) => {
        e.stopPropagation();
        openMembers(c.contract_id);
      });
    }

    tbody.appendChild(tr);
  }

  // 0件のときの表示
  if (!contracts || contracts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted">契約がありません。「新規契約」から作成してください。</td></tr>`;
  }
}

(async function boot() {
  const currentUser = await requireUser(auth, { loginUrl: "./login.html" });

  // 表示（任意）
  const whoami = document.getElementById("whoami");
  if (whoami) whoami.textContent = currentUser.email || "";

  // 新規契約ボタン
  const createBtn = document.getElementById("createContractBtn");
  if (createBtn) {
    createBtn.addEventListener("click", () => {
      location.href = "contract_create.html";
    });
  }

  await loadContracts(currentUser);

})().catch((e) => {
  console.error(e);
  alert("契約情報の取得に失敗しました。ログインし直してください。");
  location.href = "./login.html";
});
