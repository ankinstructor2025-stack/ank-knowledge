import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

const { auth } = initFirebase();

function goto(url) {
  location.href = url;
}

(async function boot() {
  const user = await requireUser(auth, { loginUrl: "./login.html" });

  // セッション取得（あなたの既存API）
  const sess = await apiFetch(user, "/v1/session", { method: "GET" });

  // 1) サービス未登録
  if (!sess.user_exists) {
    goto("./account_new.html");
    return;
  }

  const accounts = Array.isArray(sess.accounts) ? sess.accounts : [];

  // 2) Accountなし
  if (accounts.length === 0) {
    goto("./account_new.html");
    return;
  }

  // 3) Accountが1つ
  if (accounts.length === 1) {
    const account = accounts[0];
    const accountId = account.account_id;

    // tenant は1つ前提（今は）
    const tenants = Array.isArray(account.tenants) ? account.tenants : [];
    if (tenants.length !== 1) {
      // ここは将来 tenants.html
      goto(`./tenants.html?account_id=${encodeURIComponent(accountId)}`);
      return;
    }

    const tenant = tenants[0];

    // contract は必ず1つ
    const contracts = Array.isArray(tenant.contracts) ? tenant.contracts : [];
    if (contracts.length !== 1) {
      // 将来 contract 選択画面
      goto(`./tenants.html?account_id=${encodeURIComponent(accountId)}`);
      return;
    }

    const contract = contracts[0];
    const contractId = contract.contract_id;
    const planId = contract.plan_id;

    // ★ ここで分岐（入口でやる）
    if (planId === "qa_only") {
      goto(
        `./qa_generate.html?` +
        `account_id=${encodeURIComponent(accountId)}` +
        `&tenant_id=${encodeURIComponent(tenant.tenant_id)}` +
        `&contract_id=${encodeURIComponent(contractId)}`
      );
      return;
    }

    // 通常プラン
    goto(
      `./tenant_admin.html?` +
      `account_id=${encodeURIComponent(accountId)}` +
      `&tenant_id=${encodeURIComponent(tenant.tenant_id)}`
    );
    return;
  }

  // 4) Accountが複数（将来）
  goto("./accounts.html");
})();
