// context.js
// 方針（あなたの条件に合わせて固定）
// - QAのみ：ログイン時（/v1/session or /v1/bootstrap）で作業に必要な情報が決まる
// - 以後、各画面は context から読むだけ（URL/画面ごとの推測は禁止）
// - tenant_id / plan_id / role は session で維持（sessionStorage）
// - user_id は保持しない（Firebase token が真実）
// - account_id は「保持しない」が基本（必要なら“メモリ上のみ”で保持）
// - return_to はログイン制御専用（1回使ったら消す）

const NS = "ank_ctx:";

// ===== storage keys (固定: 勝手に変えない) =====
const KEY = {
  boot: NS + "bootstrapped",
  bootAt: NS + "bootstrapped_at",

  tenant: NS + "tenant_id",
  plan: NS + "plan_id",
  role: NS + "role",

  // login navigation only
  returnTo: NS + "return_to",
};

// ===== in-memory only (ページを閉じると消える) =====
let _mem = {
  account_id: "", // サーバが返しても「保存」はしない
  // 必要なら他もここに足す
};

// ===== helpers =====
function nowIso() {
  return new Date().toISOString();
}

function ssGet(k) {
  try {
    return (sessionStorage.getItem(k) || "").trim();
  } catch {
    return "";
  }
}
function ssSet(k, v) {
  try {
    const s = (v ?? "").toString().trim();
    if (!s) {
      sessionStorage.removeItem(k);
      return;
    }
    sessionStorage.setItem(k, s);
  } catch {
    // ignore
  }
}
function ssBoolGet(k) {
  return ssGet(k) === "1";
}
function ssBoolSet(k, b) {
  ssSet(k, b ? "1" : "");
}

function isProbablySafeReturnTo(path) {
  const p = (path || "").trim();
  if (!p) return false;
  // login.html 自身へ戻すとループしやすいので禁止
  if (p.includes("login.html")) return false;
  // 絶対URLは禁止（オープンリダイレクト対策）
  if (/^https?:\/\//i.test(p)) return false;
  return true;
}

/**
 * サーバレスポンスから context を確定する。
 * 期待フォーマット（例）:
 * {
 *   "user": { "user_id": "...", "email": "..." },
 *   "context": { "tenant_id": "...", "plan_id": "...", "role": "...", "account_id": "..." }
 * }
 * または legacy で直下に tenant_id 等がある場合も拾う（壊さないため）
 */
function applyBootstrapPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("bootstrap payload is empty");
  }

  const ctx = payload.context && typeof payload.context === "object" ? payload.context : payload;

  const tenantId = (ctx.tenant_id || ctx.tenantId || "").toString().trim();
  const planId = (ctx.plan_id || ctx.planId || "").toString().trim();
  const role = (ctx.role || "").toString().trim();
  const accountId = (ctx.account_id || ctx.accountId || "").toString().trim();

  if (!tenantId) throw new Error("tenant_id is missing in session/bootstrap response");
  // plan_id / role は環境により未確定もあり得るので必須にはしない（必要ならここを必須化してOK）

  // ここで “セッション維持” を確定
  ssSet(KEY.tenant, tenantId);
  if (planId) ssSet(KEY.plan, planId);
  if (role) ssSet(KEY.role, role);

  // account_id は永続化しない（メモリのみ）
  _mem.account_id = accountId;

  ssBoolSet(KEY.boot, true);
  ssSet(KEY.bootAt, nowIso());

  return {
    tenant_id: tenantId,
    plan_id: planId,
    role,
    account_id: accountId,
  };
}

// ===== public API =====
export const context = {
  // ----- bootstrap -----
  isBootstrapped() {
    return ssBoolGet(KEY.boot) && !!ssGet(KEY.tenant);
  },

  /**
   * ログイン直後に必ず1回呼ぶ想定（QAのみ：ここで全部決まる）
   * - apiFetch は既存の共通関数を想定（Authorization: Bearer を付けるやつ）
   * - 既に bootstrap 済みなら何もしない（壊さない）
   */
  async bootstrap(apiFetch, { endpoint = "/v1/session", force = false } = {}) {
    if (!force && context.isBootstrapped()) {
      return context.snapshot();
    }
    if (typeof apiFetch !== "function") {
      throw new Error("bootstrap requires apiFetch(path, {method, body})");
    }

    // /v1/session か /v1/bootstrap のどちらでもOK。サーバ側に合わせる
    const payload = await apiFetch(endpoint, { method: "GET" });

    applyBootstrapPayload(payload);
    return context.snapshot();
  },

  /**
   * tenant 必須ページで使う：無ければ例外
   * 例外をUI側で捕まえて「ボタン無効化」「テナント未選択表示」で止める（無限ループ防止）
   */
  requireTenantId() {
    const t = ssGet(KEY.tenant);
    if (!t) throw new Error("tenant_id is required (not bootstrapped)");
    return t;
  },

  getTenantId() {
    return ssGet(KEY.tenant);
  },

  getPlanId() {
    return ssGet(KEY.plan);
  },

  getRole() {
    return ssGet(KEY.role);
  },

  // account_id は保存しない（必要ならこの getter だけで参照）
  getAccountId() {
    return (_mem.account_id || "").trim();
  },

  // 画面表示・デバッグ用
  snapshot() {
    return {
      bootstrapped: context.isBootstrapped(),
      bootstrapped_at: ssGet(KEY.bootAt),

      tenant_id: ssGet(KEY.tenant),
      plan_id: ssGet(KEY.plan),
      role: ssGet(KEY.role),

      // memory only
      account_id: (_mem.account_id || "").trim(),
    };
  },

  // ----- return_to (login navigation only) -----
  setReturnTo(pathWithQuery) {
    const v = (pathWithQuery || "").toString().trim();
    if (!isProbablySafeReturnTo(v)) return;
    ssSet(KEY.returnTo, v);
  },

  getReturnTo() {
    return ssGet(KEY.returnTo);
  },

  /**
   * ログイン成功後に使う：
   * - return_to を1回だけ使って消す（ループ防止）
   */
  consumeReturnTo() {
    const rt = ssGet(KEY.returnTo);
    ssSet(KEY.returnTo, ""); // 必ず消す
    return rt;
  },

  // ----- reset (デバッグ用) -----
  clearAppContext() {
    // これは “ログイン状態” は消さず、アプリ状態だけ消す
    ssSet(KEY.tenant, "");
    ssSet(KEY.plan, "");
    ssSet(KEY.role, "");
    ssBoolSet(KEY.boot, false);
    ssSet(KEY.bootAt, "");
    _mem.account_id = "";
  },
};

/*
使い方（例）

// 1) tenant必須ページ（qa_generate.js の先頭など）
import { context } from "./context.js";

async function init() {
  try {
    // ログイン済み前提なら、ここで bootstrap（/v1/session）を叩いて確定
    await context.bootstrap(apiFetch, { endpoint: "/v1/session" });

    const tenantId = context.requireTenantId();
    // 以後 tenantId を payload に必ず入れる
  } catch (e) {
    // tenantが無い/未ログイン等 → ここでUIを止める（サーバへ投げない）
    // disableUploadButton(String(e));
  }
}

// 2) 未ログイン時に login へ飛ばす直前
context.setReturnTo(location.pathname + location.search);
location.replace("./login.html");

// 3) login 成功後
const rt = context.consumeReturnTo();
location.replace(rt || "./");
*/
