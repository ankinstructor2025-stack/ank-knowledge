// shared/context.js
// グローバルな「ログイン後コンテキスト」を一元管理する
// ・URLパラメータ非依存
// ・tenant は optional
// ・contract / plan を基準に状態判断できる

const STORAGE_KEY = "ank_context_v1";

const _state = {
  bootstrapped: false,

  account_id: null,
  contract_id: null,
  plan_id: null,

  tenant_id: null,

  raw_session: null,
};

// ==========================
// internal
// ==========================
function save() {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
}

function load() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    Object.assign(_state, obj);
  } catch (e) {
    console.warn("context load failed:", e);
  }
}

function clear() {
  sessionStorage.removeItem(STORAGE_KEY);
  Object.keys(_state).forEach(k => (_state[k] = null));
  _state.bootstrapped = false;
}

// 初期ロード
load();

// ==========================
// public API
// ==========================
export const context = {
  /**
   * セッションAPIから状態を確定させる
   * tenant_id が無くても失敗しない
   */
  async bootstrap(apiCall, { endpoint = "/v1/session" } = {}) {
    const sess = await apiCall(endpoint, { method: "GET" });

    _state.raw_session = sess || null;

    _state.account_id =
      sess?.account_id ??
      sess?.context?.account_id ??
      null;

    _state.contract_id =
      sess?.contract_id ??
      sess?.context?.contract_id ??
      null;

    _state.plan_id =
      sess?.plan_id ??
      sess?.context?.plan_id ??
      null;

    _state.tenant_id =
      sess?.tenant_id ??
      sess?.context?.tenant_id ??
      null;

    _state.bootstrapped = true;
    save();

    return this.snapshot();
  },

  /**
   * 状態のスナップショット（readonly）
   */
  snapshot() {
    return {
      bootstrapped: _state.bootstrapped,
      account_id: _state.account_id,
      contract_id: _state.contract_id,
      plan_id: _state.plan_id,
      tenant_id: _state.tenant_id,
    };
  },

  // ==========================
  // getters
  // ==========================
  getAccountId() {
    return _state.account_id;
  },

  getContractId() {
    return _state.contract_id;
  },

  getPlanId() {
    return _state.plan_id;
  },

  getTenantId() {
    return _state.tenant_id;
  },

  // ==========================
  // require 系（用途別）
  // ==========================
  requireContractId() {
    if (!_state.contract_id) {
      throw new Error("contract_id is required");
    }
    return _state.contract_id;
  },

  requireTenantId() {
    if (!_state.tenant_id) {
      throw new Error("tenant_id is required");
    }
    return _state.tenant_id;
  },

  // ==========================
  // setters（画面遷移時に使用）
  // ==========================
  setTenantId(tenantId) {
    _state.tenant_id = tenantId || null;
    save();
  },

  clearTenant() {
    _state.tenant_id = null;
    save();
  },

  // ==========================
  // 判定ユーティリティ
  // ==========================
  isBootstrapped() {
    return _state.bootstrapped === true;
  },

  isQaOnlyPlan() {
    return _state.plan_id === "qa_only";
  },

  hasContract() {
    return !!_state.contract_id;
  },

  hasTenant() {
    return !!_state.tenant_id;
  },

  // ==========================
  // 完全リセット（logout 等）
  // ==========================
  reset() {
    clear();
  },
};
