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

function pickContractId(sess) {
  return (
    sess?.contract_id ||
    sess?.context?.contract_id ||
    ""
  );
}

function pickPlanId(sess) {
  return (
    sess?.plan_id ||
    sess?.context?.plan_id ||
    ""
  );
}

(async () => {
  // 1) 認証状態が確定するまで待つ（重要）
  const user = await waitForAuthUser(5000);

  // 2) 未ログインなら login へ
  if (!user) {
    goto(`./login.html?return_to=${encodeURIComponent("./")}`);
    return;
  }

  // 3) session 取得（user を渡して統一）
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

  // 5) 契約/プランで分岐（あなたの整理どおり）
  const contractId = String(pickContractId(sess) || "").trim();
  const planId = String(pickPlanId(sess) || "").trim();

  // 契約が無い → テナント一覧（※パラメータ無し）
  if (!contractId) {
    goto("./tenants.html");
    return;
  }

  // プランがQAのみ → QA作成
  if (planId === "qa_only") {
    goto("./qa_generate.html");
    return;
  }

  // それ以外：現状維持（まずはQA作成へ）
  goto("./qa_generate.html");
})();
