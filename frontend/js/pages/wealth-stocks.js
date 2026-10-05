// pages/wealth-stocks.js — the investable catalogue.
//
// A thin controller over wealth-kit.js. The one thing worth reading here is the
// class filter: stocks carry a real NGX price, everything else in the catalogue
// is indicative, and the page says so rather than pretending they are equal.

(function () {
  "use strict";

  const w = window.AgbeWealth;
  const ui = window.AgbeUI;

  const HEAD = `<div id="whead"></div>`;
  const FILTERS = `<div id="wfilters"></div><div id="wsearch"></div><div id="wlist"></div>`;

  let className = "STOCK";
  let query = "";
  let all = [];
  let byId = new Map();

  function head() {
    return w.pageHead({
      activeKey: "stocks",
      title: "Stocks",
      sub: "Buy and sell real Nigerian Exchange shares",
    });
  }

  function filters() {
    const counts = new Map();
    for (const i of all) counts.set(i.class, (counts.get(i.class) || 0) + 1);
    // Always offer the live class, even before the catalogue has loaded.
    if (!counts.has("STOCK")) counts.set("STOCK", 0);

    const order = ["STOCK", "FUND", "BOND", "PENSION"];
    const tabs = order
      .filter((c) => counts.has(c))
      .map((c) => {
        const meta = w.CLASS_META[c] || { label: c };
        const active = c === className ? " is-active" : "";
        return `<button class="notif-filter${active}" type="button" data-class="${c}">
          ${ui.escapeHtml(meta.label)} <span>${counts.get(c)}</span>
        </button>`;
      })
      .join("");

    ui.$("#wfilters").innerHTML = `<div class="notif-filters">${tabs}</div>`;
  }

  // Substring match on symbol, name or sector. Case-insensitive. Filtering is a
  // pure view concern, so it stays in the browser and costs no round trip.
  function visible() {
    const q = query.trim().toLowerCase();
    return all
      .filter((i) => i.class === className)
      .filter((i) => !q || i.symbol.toLowerCase().includes(q) || i.name.toLowerCase().includes(q) || (i.sector || "").toLowerCase().includes(q));
  }

  function paintList() {
    const list = visible();

    if (!all.length) {
      ui.$("#wlist").innerHTML = w.empty("We couldn't load the investment catalogue.");
      return;
    }
    if (!list.length) {
      ui.$("#wlist").innerHTML = w.empty(query ? `Nothing matches “${query}”.` : "Nothing in this category yet.");
      return;
    }

    // A live class leads, then biggest gainers, then losers, then the rest.
    // Sorted on the backend's own day-change number, never recomputed here.
    const change = (i) => (Number.isFinite(i.changePct) ? i.changePct : -Infinity);
    list.sort((a, b) => {
      const live = (i) => (i.live ? 0 : 1);
      if (live(a) !== live(b)) return live(a) - live(b);
      const ac = change(a);
      const bc = change(b);
      if (ac !== bc) return bc - ac;
      return a.symbol.localeCompare(b.symbol);
    });

    ui.$("#wlist").innerHTML = `<div class="wlist">${list.map(w.quoteRow).join("")}</div>`;
  }

  function paintSearch() {
    ui.$("#wsearch").innerHTML = `
      <div class="field" style="margin:14px 0">
        <label class="sr-only" for="wq">Search investments</label>
        <input class="input" id="wq" type="search" inputmode="search" placeholder="Search by name, ticker or sector" value="${ui.escapeHtml(query)}" />
      </div>`;

    const input = ui.$("#wq");
    input.addEventListener("input", (e) => {
      query = e.target.value;
      paintList();
    });
  }

  async function refresh() {
    const data = await w.load.instruments();
    all = data.instruments || [];
    byId = new Map(all.map((i) => [i.id, i]));
    filters();
    paintList();
  }

  w.boot("stocks", async () => {
    w.page().innerHTML = HEAD;
    ui.$("#whead").innerHTML = head();
    w.page().insertAdjacentHTML("beforeend", FILTERS);
    ui.$("#wlist").innerHTML = w.loading("Fetching live NGX prices…");
    paintSearch();
    await refresh();

    w.page().addEventListener("click", (e) => {
      const tab = e.target.closest("[data-class]");
      if (tab) {
        className = tab.dataset.class;
        filters();
        paintList();
        return;
      }
      const buy = e.target.closest("[data-buy]");
      if (buy) {
        const instrument = byId.get(buy.dataset.buy);
        if (instrument) w.tradeModal({ mode: "buy", instrument, onDone: refresh });
      }
    });
  });
})();
