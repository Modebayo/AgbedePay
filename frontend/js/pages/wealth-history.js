// pages/wealth-history.js — every buy and sell you have made.
//
// A thin controller over wealth-kit.js. Paginates server-side and appends, so
// the list stays responsive on an account with a long history.

(function () {
  "use strict";

  const w = window.AgbeWealth;
  const ui = window.AgbeUI;

  const HEAD = `<div id="whead"></div>`;
  const FILTERS = `<div id="wfilters"></div>`;
  const LIST = `<div id="wlist"></div>`;
  const MORE = `<div id="wmore"></div>`;

  const PAGE_SIZE = 20;

  let type = "";
  let page = 1;
  let total = 0;
  let loaded = [];
  let busy = false;

  function head() {
    return w.pageHead({
      activeKey: "history",
      title: "Investment History",
      sub: "Every buy and sell you have made",
      actions: `<a class="btn btn--ghost btn--small" href="wealth-stocks.html">Invest</a>`,
    });
  }

  function filters() {
    const tabs = [
      { value: "", label: "All" },
      { value: "BUY", label: "Buys" },
      { value: "SELL", label: "Sells" },
    ]
      .map(
        (t) => `<button class="notif-filter${t.value === type ? " is-active" : ""}" type="button" data-type="${t.value}">
          ${ui.escapeHtml(t.label)}
        </button>`
      )
      .join("");
    ui.$("#wfilters").innerHTML = `<div class="notif-filters">${tabs}</div>`;
  }

  function paintList() {
    ui.$("#wlist").innerHTML = loaded.length
      ? `<div class="wlist">${loaded.map(w.orderRow).join("")}</div>`
      : w.empty(type === "BUY" ? "No buys yet." : type === "SELL" ? "No sales yet." : "No investment activity yet.");

    // Only offer more when the server says there is more; never guess from the
    // length of the page we happen to be holding.
    ui.$("#wmore").innerHTML =
      loaded.length && loaded.length < total
        ? `<button class="btn btn--ghost" type="button" id="wmore-btn" style="width:100%">Load more</button>`
        : "";
  }

  async function fetchPage(next) {
    if (busy) return;
    busy = true;
    ui.$("#wmore").innerHTML = w.loading("Loading…");
    try {
      const data = await w.load.history({ type, page: next, limit: PAGE_SIZE });
      total = data.total || 0;
      loaded = next === 1 ? data.items || [] : loaded.concat(data.items || []);
      page = next;
      paintList();
    } catch {
      ui.$("#wmore").innerHTML = w.empty("Couldn't load more. Tap to retry.");
    } finally {
      busy = false;
    }
  }

  w.boot("history", async () => {
    w.page().innerHTML = HEAD;
    ui.$("#whead").innerHTML = head();
    w.page().insertAdjacentHTML("beforeend", FILTERS + LIST + MORE);
    filters();
    ui.$("#wlist").innerHTML = w.loading("Loading your investment history…");
    await fetchPage(1);

    w.page().addEventListener("click", (e) => {
      const tab = e.target.closest("[data-type]");
      if (tab) {
        type = tab.dataset.type;
        page = 1;
        loaded = [];
        filters();
        ui.$("#wlist").innerHTML = w.loading("Loading…");
        fetchPage(1);
        return;
      }
      if (e.target.id === "wmore-btn") fetchPage(page + 1);
    });
  });
})();
