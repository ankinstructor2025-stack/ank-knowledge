export function bindDom() {
  const requireEl = (id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`admin.html: element not found: #${id}`);
    return el;
  };

  dom.bannerEl = requireEl("banner");
  dom.contractBadge = requireEl("contractBadge");
  dom.statusBadge = requireEl("statusBadge");
  dom.roleBadge = requireEl("roleBadge");
  dom.userEmailEl = requireEl("userEmail");

  dom.tabContract = requireEl("tab-contract");
  dom.tabUsers = requireEl("tab-users");
  dom.panelContract = requireEl("panel-contract");
  dom.panelUsers = requireEl("panel-users");

  dom.logoutBtn = requireEl("logoutBtn");

  dom.contractIdEl = requireEl("contractId");
  dom.contractStatusEl = requireEl("contractStatus");
  dom.paymentMethodEl = requireEl("paymentMethod");
  dom.paidUntilEl = requireEl("paidUntil");

  dom.seatLimitSelect = requireEl("seatLimitSelect");
  dom.knowledgeCountSelect = requireEl("knowledgeCountSelect");
  dom.saveContractBtn = requireEl("saveContractBtn");

  dom.kpiMonthly = requireEl("kpiMonthly");
  dom.kpiBase = requireEl("kpiBase");
  dom.kpiExtra = requireEl("kpiExtra");
  dom.kpiSearchLimit = requireEl("kpiSearchLimit");

  dom.pricingSeatsTbody = requireEl("pricingSeatsTbody");
  dom.pricingKnowledge = requireEl("pricingKnowledge");
  dom.pricingSearchLimit = requireEl("pricingSearchLimit");
  dom.pricingPoc = requireEl("pricingPoc");

  dom.userOps = requireEl("userOps");
  dom.newUserEmail = requireEl("newUserEmail");
  dom.newUserRole = requireEl("newUserRole");
  dom.addUserBtn = requireEl("addUserBtn");
  dom.usersTbody = requireEl("usersTbody");
}
