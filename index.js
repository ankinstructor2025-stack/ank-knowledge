// index.js
import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

initFirebase();

/**
 * 画面遷移の“唯一の司令塔”。
 * - login.js はログイン成功後に必ず "./"（この index.html）へ戻すだけ
 * - ここで /v1/session を見て行き先を決める
 */

function goto(url) {
  // 戻るボタンでループしにくいので replace 推奨
  location.replace(url);
}

function isTrue(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function pickTenantId(t) {
  return t?.tenant_id || t?.id || t?.tenantId || "";
}

(async () => {
  // 1) 未ログインなら login へ（戻り先を付与）
  const user = await requireUser({ redirect: false }).catch(() => null);
  if (!user) {
    goto(`./login.html?return_to=${encodeURIComponent("./")}`);
    return;
  }

  // 2) セッション取得
  let sess;
  try {
    sess = await apiFetch("/v1/session");
  } catch (e) {
    console.error(e);
    // 401なら再ログインへ
    goto(`./login.html?return_to=${encodeURIComponent("./")}`);
    return;
  }

  // 3) user_exists が false なら初回登録（UI上のアカウント作成画面へ）
  if (!isTrue(sess?.user_exists)) {
    goto("./account_new.html");
    return;
  }

  // 4) tenants が無い/空なら tenants へ（テナント作成・選択）
  const tenants = Array.isArray(sess?.tenants) ? sess.tenants : [];
  if (tenants.length === 0) {
    goto("./tenants.html");
    return;
  }

  // 5) 契約ありテナントを探す（キーの揺れを吸収）
  const contracted = tenants.find(
    (t) => isTrue(t?.has_contract) || isTrue(t?.has_active_contract) || isTrue(t?.contract_active)
  );

  if (!contracted) {
    // テナントはあるが契約なし → tenants（契約導線）
    goto("./tenants.html");
    return;
  }

  // 6) QA作成へ
  const tenantId = pickTenantId(contracted);
  if (!tenantId) {
    // tenant_id が取れないなら tenants へ戻す（データ不整合）
    goto("./tenants.html");
    return;
  }

  goto(`./qa_generate.html?tenant_id=${encodeURIComponent(tenantId)}`);
})();
