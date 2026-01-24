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

function openContractEdit(contractId) {
  location.href = `contract_edit.html?contract_id=${encodeURIComponent(contractId)}`;
}

function openMembers(contractId, paymentConfigured) {
  if (!paymentConfigured) {
    alert("支払い設定が未完了です。先に「支払い設定へ」を実行してください。");
    return;
  }
  location.href = `members.html?contract_id=${encodeURIComponent(contractId)}`;
}

async function loadContracts(currentUser) {
  const tbody = document.querySelector("#contractsTable tbody");
  tbody.innerHTML = `<tr><td colspan="9" class="muted">読み込み中...</td></tr>`;

  const contracts = await apiFetch(currentUser, "/v1/contracts");

  tbody.innerHTML = "";
  if (!contracts || contracts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted">契約がありません。「新規契約」から作成してください。</td></tr>`;
    return;
  }

  for (const c of contracts) {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => openContractEdit(c.contract_id));

    const actionsHtml =
      c.role === "admin"
        ? `<button class="btnEdit">編集</button><button class="btnMembers">メンバー</button>`
        : `-`;

    const note = safeText(c.note);

    tr.innerHTML = `
      <td><code>${c.contract_id}</code></td>
      <td class="note" title="${(c.note ?? "").toString().replaceAll('"', "&quot;")}">${note}</td>
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
        openContractEdit(c.contract_id);
      });
      tr.querySelector(".btnMembers").addEventListener("click", (e) => {
        e.stopPropagation();
        openMembers(c.contract_id, !!c.payment_method_configured);
      });
    }

    tbody.appendChild(tr);
  }
}

(async function boot() {
  const currentUser = await requireUser(auth, { loginUrl: "./login.html" });

  const whoami = document.getElementById("whoami");
  if (whoami) whoami.textContent = currentUser.email || "";

  const createBtn = document.getElementById("createContractBtn");
  if (createBtn) {
    createBtn.addEventListener("click", () => {
      location.href = "contract_create.html";
    });
  }

  await loadContracts(currentUser);
})().catch((e) => {
  console.error(e);
  alert(`契約情報の取得に失敗しました:\n${e.message}`);
  location.href = "./login.html";
});
