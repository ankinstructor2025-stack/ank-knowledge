// admin_contract.js
import { showBanner, hideBanner } from "./admin_utils.js";

export function createContractModule({ state, dom, api, pricingModule }) {
  function renderCommon() {
    pricingModule.renderEstimateFromUI();
    // 未契約でも押せる（pricingが読めていれば作成可能）
    dom.saveContractBtn.disabled = !state.pricing;
  }

  function renderContract() {
    dom.contractBadge.textContent = `contract: ${state.contract?.contract_id ?? "-"}`;
    dom.statusBadge.textContent = `status: ${state.contract?.status ?? "-"}`;

    dom.contractIdEl.textContent = state.contract?.contract_id ?? "-";
    dom.contractStatusEl.textContent = state.contract?.status ?? "-";
    dom.paymentMethodEl.textContent = state.contract?.payment_method_configured ? "設定済み" : "未設定";
    dom.paidUntilEl.textContent = state.contract?.paid_until ?? "-";

    if (state.contract?.seat_limit && dom.seatLimitSelect.options.length) {
      dom.seatLimitSelect.value = String(state.contract.seat_limit);
    }
    if (state.contract?.knowledge_count != null && dom.knowledgeCountSelect.options.length) {
      const v = String(state.contract.knowledge_count);
      const has = Array.from(dom.knowledgeCountSelect.options).some((o) => o.value === v);
      dom.knowledgeCountSelect.value = has ? v : dom.knowledgeCountSelect.options[0].value;
    }

    hideBanner(dom);
    if (state.contract?.status === "grace") {
      showBanner(dom, "warn", "支払い確認が取れていません（猶予期間）。検索画面に警告を表示します。");
    }
    if (state.contract?.status === "suspended" || state.contract?.status === "cancelled") {
      showBanner(dom, "bad", "契約が停止しています。検索は停止（または強い警告）対象です。");
    }

    renderCommon();
  }

  function renderNoContract() {
    dom.contractBadge.textContent = `contract: -`;
    dom.statusBadge.textContent = `status: -`;

    dom.contractIdEl.textContent = "-";
    dom.contractStatusEl.textContent = "-";
    dom.paymentMethodEl.textContent = "-";
    dom.paidUntilEl.textContent = "-";

    hideBanner(dom);
    renderCommon();
  }

  async function loadContract() {
    const uid = state.currentUser.uid;
    const email = state.currentUser.email || "";

    const res = await api.apiFetch(
      `/v1/contract?user_id=${encodeURIComponent(uid)}&email=${encodeURIComponent(email)}`,
      { method: "GET" }
    );

    if (!res.contract) {
      state.contract = null;
      renderNoContract();
    } else {
      state.contract = res.contract;
      renderContract();
    }
  }

  function bindContractEvents() {
    dom.saveContractBtn.addEventListener("click", async () => {
      dom.saveContractBtn.disabled = true;
      try {
        const seat_limit = Number(dom.seatLimitSelect.value);
        const knowledge_count = Number(dom.knowledgeCountSelect.value);

        await api.apiFetch(`/v1/contract`, {
          method: "POST",
          body: {
            user_id: state.currentUser.uid,
            email: state.currentUser.email,
            display_name: state.currentUser.displayName || "",
            seat_limit,
            knowledge_count,
          },
        });

        await loadContract();
      } catch (e) {
        alert(`契約作成に失敗しました: ${e.message}`);
      } finally {
        dom.saveContractBtn.disabled = false;
      }
    });
  }

  return { loadContract, bindContractEvents };
}
