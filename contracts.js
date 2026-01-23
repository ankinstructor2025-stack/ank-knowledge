async function loadContracts() {
  const contracts = await apiFetch("/v1/contracts");

  const tbody = document.querySelector("#contractsTable tbody");
  tbody.innerHTML = "";

  for (const c of contracts) {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${c.contract_id}</td>
      <td>${c.status}</td>
      <td>${c.seat_limit ?? "-"}</td>
      <td>${c.knowledge_count ?? "-"}</td>
      <td>${c.current_period_end ? c.current_period_end.slice(0,10) : "-"}</td>
      <td>${c.payment_method_configured ? "設定済" : "未設定"}</td>
      <td>
        <button onclick="editContract('${c.contract_id}')">編集</button>
      </td>
    `;

    tbody.appendChild(tr);
  }
}
