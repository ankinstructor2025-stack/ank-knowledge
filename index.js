// index.js
import { initFirebase } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const { auth } = initFirebase();

function goto(url) {
  // 履歴を汚さない（戻るでループしにくい）
  location.replace(url);
}

function isTrue(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function pickTenantId(t) {
  return t?.tenant_id || t?.id || t?.tenantId || "";
}

/**
 * tenants.html は account_id 必須なので、ここで必ず付与する
 */
function gotoTenants(sess) {
  const accountId =
    sess?.account_id ||
    sess?.account?.account_id ||
    sess?.account?.id ||
    sess?.accounts?.[0]?.account_id ||
    sess?.accounts?.[0]?.id;

  if (!accountId) {
    console.error("account_id not found in /v1/session:", sess);
    // ここで止める（勝手にloginへ戻さない）
    // ＝無限ループを防ぐ
    return;
  }

  goto(`./tenants.html?account_id=${encodeURIComponent(accountId)}`);
}

async function waitForAuthUser(timeoutMs = 3000) {
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { unsub?.(); } catch {}
      resolve(null);
    }, timeoutMs);

    const unsub = onAuthStateChanged(auth, (u) => {
      clearTimeout(timer);
      try { unsub(); } catch {}
      resolve(u || null);
    });
  });
}

(async () => {
  // 1) 認証状態が確定するまで待つ（重要）
  const user = await waitForAuthUser(5000);

  // 2) 未ログインなら login へ
  if (!user) {
    goto(`./login.html?return_to=${encodeURIComponent("./")}`);
    return;
  }

  // 3) session 取得（★修正：user を渡して統一）
  let sess;
  try {
    sess = await apiFetch(user, "/v1/session", { method: "GET" });
  } catch (e) {
    console.error("session error:", e);
    goto(`./login.html?return_to=${encodeURIComponent("./")}`);
    return;
  }

  // 4) users未登録ならアカウント作成へ
  if (!isTrue(sess?.user_exists)) {
    goto("./account_new.html");
    return;
  }

  // 5) tenants が無い/空なら tenants へ
  const tenants = Array.isArray(sess?.tenants) ? sess.tenants : [];
  if (tenants.length === 0) {
    gotoTenants(sess);
    return;
  }

  // 6) 契約ありテナントを探す
  const contracted = tenants.find(
    (t) =>
      isTrue(t?.has_contract) ||
      isTrue(t?.has_active_contract) ||
      isTrue(t?.contract_active)
  );

  if (!contracted) {
    gotoTenants(sess);
    return;
  }

  const tenantId = pickTenantId(contracted);
  if (!tenantId) {
    gotoTenants(sess);
    return;
  }

  // 7) QA作成へ
  goto(`./qa_generate.html?tenant_id=${encodeURIComponent(tenantId)}`);
})();
