function renderEstimateFromUI() {
  const seatLimit = Number(dom.seatLimitSelect?.value || 0);
  const knowledgeCount = Number(dom.knowledgeCountSelect?.value || 1);

  const derived = computeDerived({ seat_limit: seatLimit, knowledge_count: knowledgeCount });

  const undef = "定義外";

  dom.kpiBase.textContent = derived.baseFee == null ? undef : yen(Number(derived.baseFee));
  dom.kpiExtra.textContent = derived.extraKnowledgeFee == null ? undef : yen(Number(derived.extraKnowledgeFee));
  dom.kpiMonthly.textContent = derived.total == null ? `${undef}（pricing）` : yen(Number(derived.total));
  dom.kpiSearchLimit.textContent =
    derived.searchLimitPerDay == null ? "-" : `${derived.searchLimitPerDay.toLocaleString("ja-JP")}回/日`;
}
