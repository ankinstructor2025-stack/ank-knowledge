// admin_utils.js
export function showBanner(dom, kind, text) {
  dom.bannerEl.hidden = false;
  dom.bannerEl.className = "banner";
  if (kind === "warn") dom.bannerEl.classList.add("warn");
  if (kind === "bad") dom.bannerEl.classList.add("bad");
  dom.bannerEl.textContent = text;
}
export function hideBanner(dom) {
  dom.bannerEl.hidden = true;
  dom.bannerEl.textContent = "";
}

export function setActiveTab(dom, tabName) {
  const isContract = tabName === "contract";
  dom.tabContract.setAttribute("aria-selected", String(isContract));
  dom.tabUsers.setAttribute("aria-selected", String(!isContract));
  dom.panelContract.hidden = !isContract;
  dom.panelUsers.hidden = isContract;
}

export function yen(n) {
  if (n === null || n === undefined) return "-";
  if (typeof n !== "number" || Number.isNaN(n)) return "-";
  return n.toLocaleString("ja-JP") + "円";
}

export function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function fmtLastLogin(v) {
  if (!v) return "-";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString();
  } catch {
    return String(v);
  }
}
