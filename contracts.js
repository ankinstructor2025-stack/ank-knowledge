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

async function loadContracts() {
  const contracts = await apiFetch("/v1/contracts");

  const tbody = document.querySelector("#contractsTable tbody");
  tbody.innerHTML = "";

  for (const c of contracts) {
    const tr = document.createElement("tr");

    // 行クリック：詳細へ
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => openContractDetail(c.contract_id));

    // ボタン押下で行クリックが発火しないように止める
    const stopRowClick = (e) => e.stopPropagation();

    // 操作列（adminのみ編集・メンバー一覧）
    const actionsHtml = (c.role === "admin")
      ? `
        <button class="btnEdit">編集</button>
        <button class="btnMembers">メンバー</button>
      `
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

    // admin のときだけボタンにハンドラを付ける
    if (c.role === "admin") {
      const btnEdit = tr.querySelector(".btnEdit");
      const btnMembers = tr.querySelector(".btnMembers");

      btnEdit.addEventListener("click", (e) => {
        stopRowClick(e);
        editContract(c.contract_id);
      });

      btnMembers.addEventListener("click", (e) => {
        stopRowClick(e);
        openMembers(c.contract_id);
      });
    }

    tbody.appendChild(tr);
  }
}

async function initContractsPage() {
  // まず「契約があるか」を確認（/v1/contract は token の uid を使う）
  const res = await apiFetch("/v1/contract");

  if (!res.contract) {
    location.href = "contract_create.html";
    return;
  }

  await loadContracts();
}

document.addEventListener("DOMContentLoaded", () => {
  initContractsPage().catch((e) => {
    console.error(e);
    alert("契約情報の取得に失敗しました。ログインし直してください。");
    location.href = "admin.html";
  });
});
