// admin_users.js
import { escapeHtml, fmtLastLogin } from "./admin_utils.js";

export function createUsersModule({ state, dom, api }) {
  function setRole(role) {
    state.myRole = role || "member";
    dom.roleBadge.textContent = `role: ${state.myRole}`;
    dom.userOps.hidden = state.myRole !== "admin";
  }

  // user-check は「存在確認＋自分のrole」を返す想定（roleが無い場合もある）
  async function checkUser() {
    const email = state.currentUser.email;
    const result = await api.apiFetch(`/v1/user-check?email=${encodeURIComponent(email)}`, { method: "GET" });

    const role = result.role || null;
    if (role) setRole(role);

    return {
      isContracted: !!result.exists,
      user_id: result.user_id ?? null,
      role,
    };
  }

  function countActiveAdmins() {
    return state.users.filter((u) => u.status !== "disabled" && u.role === "admin").length;
  }

  function renderUsers() {
    dom.usersTbody.innerHTML = "";

    if (!state.users.length) {
      dom.usersTbody.innerHTML =
        `<tr><td colspan="5" class="muted">ユーザー一覧は未実装です（/v1/users を用意したら表示します）</td></tr>`;
      return;
    }

    const activeAdminCount = countActiveAdmins();

    for (const u of state.users) {
      const tr = document.createElement("tr");

      const email = u.email ?? "-";
      const role = u.role ?? "member";
      const status = u.status ?? "active";
      const lastLogin = fmtLastLogin(u.last_login_at);

      tr.innerHTML = `
        <td>${escapeHtml(email)}</td>
        <td>${escapeHtml(role)}</td>
        <td>${escapeHtml(status)}</td>
        <td>${escapeHtml(lastLogin)}</td>
        <td></td>
      `;

      const opsTd = tr.querySelector("td:last-child");

      if (state.myRole === "admin") {
        const roleBtn = document.createElement("button");
        roleBtn.textContent = role === "admin" ? "memberにする" : "adminにする";
        roleBtn.style.marginRight = "6px";

        const isLastAdmin = role === "admin" && status !== "disabled" && activeAdminCount <= 1;
        roleBtn.disabled = isLastAdmin;

        roleBtn.addEventListener("click", async () => {
          const newRole = role === "admin" ? "member" : "admin";
          await updateUser(email, { role: newRole });
          await loadUsers();
        });

        const disableBtn = document.createElement("button");
        disableBtn.className = status === "disabled" ? "" : "danger";
        disableBtn.textContent = status === "disabled" ? "有効化" : "無効化";
        disableBtn.disabled = role === "admin" && status !== "disabled" && activeAdminCount <= 1;

        disableBtn.addEventListener("click", async () => {
          const newStatus = status === "disabled" ? "active" : "disabled";
          await updateUser(email, { status: newStatus });
          await loadUsers();
        });

        opsTd.appendChild(roleBtn);
        opsTd.appendChild(disableBtn);
      } else {
        opsTd.textContent = "-";
      }

      dom.usersTbody.appendChild(tr);
    }
  }

  // 将来 /v1/users ができたらここを有効化する
  async function loadUsers() {
    // const res = await api.apiFetch("/v1/users", { method: "GET" });
    // state.users = res.users ?? [];
    // renderUsers();
    renderUsers();
  }

  // 新パス優先 → ダメなら旧パスへ（後方互換）
  async function apiTry(paths, options) {
    let lastErr = null;
    for (const p of paths) {
      try {
        return await api.apiFetch(p, options);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  async function addUser(email, role) {
    return apiTry(
      ["/v1/users", "/users"],
      { method: "POST", body: { email, role } }
    );
  }

  async function updateUser(email, patch) {
    return apiTry(
      ["/v1/users/update", "/users/update"],
      { method: "POST", body: { email, patch } }
    );
  }

  async function inviteUser(selectedContractId, email) {
    return api.apiFetch("/v1/invites", {
      method: "POST",
      body: { contract_id: selectedContractId, email },
    });
  }

  function bindUserEvents() {
    dom.addUserBtn.addEventListener("click", async () => {
      const email = (dom.newUserEmail.value || "").trim().toLowerCase();
      const role = dom.newUserRole.value;

      if (!email) return alert("メールアドレスを入力してください。");
      if (!email.includes("@")) return alert("メールアドレスの形式が正しくありません。");

      dom.addUserBtn.disabled = true;
      try {
        await addUser(email, role);
        dom.newUserEmail.value = "";
        await loadUsers();
      } catch (e) {
        console.error(e);
        alert(`追加に失敗: ${e.message}`);
      } finally {
        dom.addUserBtn.disabled = false;
      }
    });
  }

  return { checkUser, loadUsers, bindUserEvents, setRole, inviteUser };
}
