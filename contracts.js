import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

const { auth } = initFirebase();

function roleLabel(role) {
  if (role === "admin") return "管理者";
  if (role === "member") return "メンバー";
  return role ?? "-";
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

    tr.innerHTML = `
      <td>${c.contract_id}</td>
      <td>${roleLabel(c.role)}</td>
      <td>${c.contract_status ?? "-"}</td>
      <td>${c.seat_limit ?? "-"}</td>
      <td>${c.knowledge_count ?? "-"}</td>
      <td>${c.current_period_end ? c.current_period_end.slice(0,10) : "-"}</td>
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

  // 一覧をロード
  await loadContracts(currentUser);

})().catch((e) => {
  console.error(e);
  alert("契約情報の取得に失敗しました。ログインし直してください。");
  location.href = "./login.html";
});
