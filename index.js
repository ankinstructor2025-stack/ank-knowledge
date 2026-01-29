import { initFirebase, requireUser } from "./ank_firebase.js";
import { apiFetch } from "./ank_api.js";

const { auth } = initFirebase();

function goto(url) {
  location.href = url;
}

function isTrue(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function getRoleFromSession(sess) {
  // ここは /v1/session の実装により揺れるので「候補を列挙」して吸収する。
  // 優先順位: 明示 role > is_admin > flags
  const role = (sess.role || sess.user_role || "").toString().toLowerCase();
  if (role === "admin" || role === "owner" || role === "manager") return "admin";
  if (role === "member" || role === "user") return "member";

  if (isTrue(sess.is_admin) || isTrue(sess.admin)) return "admin";
  if (isTrue(sess.is_member) || isTrue(sess.member)) return "member";

  // それでも不明なら member 扱いに倒す（権限を広げない）
  return "member";
}

(async function boot() {
  // 1) 未ログインなら login へ（ここだけは固定）
  const user = await requireUser(auth, { loginUrl: "./login.html" });

  // 2) セッション取得（ここが唯一の事実ソース）
  let sess;
  try {
    sess = await apiFetch(user, "/v1/session", { method: "GET" });
  } catch (e) {
    // セッションが取れないなら、入口で止める（変な自動遷移をしない）
    alert(`セッション取得に失敗しました: ${e?.message || e}`);
    return;
  }

  // 3) 未登録 → 新規顧客
  // 既存実装では user_exists を見ていたので、それを優先で使う
  // （もし /v1/session が別キーなら、ここだけ後で合わせればOK）
  if (!isTrue(sess.user_exists)) {
    goto("./account_new.html");
    return;
  }

  // 4) 役割で分岐（図どおり）
  const role = getRoleFromSession(sess);

  if (role === "admin") {
    // 管理者 → テナント一覧
    goto("./tenants.html");
    return;
  }

  // メンバー → QA検索
  // ※あなたの実ファイル名に合わせてここを1行だけ変更
  goto("./qa_generate.html");
})();
