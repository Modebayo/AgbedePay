// pages/wealth-portfolio.js — every position you hold.
//
// A thin controller over wealth-kit.js: totals, allocation, then holdings
// grouped by instrument class so a portfolio of NGX shares and FGN bills does
// not read as one undifferentiated list.

(function () {
  "use strict";

  const w = window.AgbeWealth;
  const ui = window.AgbeUI;

  let byId = new Map();

  const HEAD = `<div id="whead"></div>`;

  function head() {
    return w.pageHead({
      activeKey: "portfolio",
      title: "My Portfolio",
      sub: "Your positions and what they are worth now",
      actions: `<a class="btn btn--primary btn--small" href="wealth-stocks.html">Invest</a>`,
    });
  }

  // Fixed order, most familiar first. Unknown classes sort last rather than
  // disappearing, so a future instrument type is never silently invisible.
  const ORDER = ["STOCK", "BOND", "FUND", "PENSION"];

  function group(holdings) {
    const buckets = new Map();
    for (const h of holdings) {
      if (!buckets.has(h.class)) buckets.set(h.class, []);
      buckets.get(h.class).push(h);
    }
    const keys = [...buckets.keys()].sort((a, b) => {
      const ia = ORDER.indexOf(a);
      const ib = ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    // Biggest position first inside each class.
    for (const list of buckets.values()) list.sort((a, b) => b.valueMinor - a.valueMinor);
    return keys.map((k) => [k, buckets.get(k)]);
  }

  function paint(data) {
    const el = w.page();
    el.innerHTML = HEAD;
    ui.$("#whead").innerHTML = head();

    if (!data.totals) {
      el.insertAdjacentHTML("beforeend", w.empty("We couldn't load your portfolio."));
      return;
    }

    byId = new Map((data.holdings || []).map((h) => [h.id, h]));

    if (!data.holdings.length) {
      el.insertAdjacentHTML(
        "beforeend",
        w.empty(
          "You have not invested yet.",
          `<a class="btn btn--primary" href="wealth-stocks.html">Browse stocks</a>`
        )
      );
      return;
    }

    const groups = group(data.holdings)
      .map(([cls, list]) => {
        const meta = w.CLASS_META[cls] || { label: cls };
        return `
          <section class="wsection">
            <div class="wsection__head">
              <h2 class="wsection__title">${ui.escapeHtml(meta.label)} · ${list.length}</h2>
            </div>
            <div class="wlist">${list.map(w.holdingRow).join("")}</div>
          </section>`;
      })
      .join("");

    el.insertAdjacentHTML(
      "beforeend",
      [
        w.totalsGrid(data.totals),
        data.allocation && data.allocation.length
          ? `<section class="wsection">
               <div class="wsection__head"><h2 class="wsection__title">Allocation</h2></div>
               ${w.allocation(data.allocation)}
             </section>`
          : "",
        groups,
      ].join("")
    );

    el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-sell]");
      if (!btn) return;
      const holding = byId.get(btn.dataset.sell);
      if (holding) w.tradeModal({ mode: "sell", holding, onDone: refresh });
    });
  }

  async function refresh() {
    paint(await w.load.portfolio());
  }

  w.boot("portfolio", async () => {
    w.page().innerHTML = HEAD;
    ui.$("#whead").innerHTML = head();
    w.page().insertAdjacentHTML("beforeend", w.loading("Valuing your holdings…"));
    paint(await w.load.portfolio());
  });
})();
