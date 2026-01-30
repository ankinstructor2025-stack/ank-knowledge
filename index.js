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

  // 3) session 取得（401なら login に戻す）
  let sess;
  try {
    sess = await apiFetch("/v1/session");
  } catch (e) {
    console.error("session error:", e);
    goto(`./login.html?return_to=${encodeURIComponent("./")}`);
    return;
  }

  // 4) users未登録ならアカウント作成へ（あなたの導線に合わせて変更してOK）
  if (!isTrue(sess?.user_exists)) {
    goto("./account_new.html");
    return;
  }

  // 5) tenants が無い/空なら tenants へ
  const tenants = Array.isArray(sess?.tenants) ? sess.tenants : [];
  if (tenants.length === 0) {
    goto("./tenants.html");
    return;
  }

  // 6) 契約ありテナントを探す（キー揺れ吸収）
  const contracted = tenants.find(
    (t) => isTrue(t?.has_contract) || isTrue(t?.has_active_contract) || isTrue(t?.contract_active)
  );

  if (!contracted) {
    goto("./tenants.html");
    return;
  }

  const tenantId = pickTenantId(contracted);
  if (!tenantId) {
    goto("./tenants.html");
    return;
  }

  goto(`./qa_generate.html?tenant_id=${encodeURIComponent(tenantId)}`);
})();
