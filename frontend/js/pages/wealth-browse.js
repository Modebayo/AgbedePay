// pages/wealth-browse.js — Funds, Bonds and Pension, in one file.
//
// These three pages are the same page. Not similar, not "following the same
// pattern" — the same page. Each one lists a class of instrument from
// /wealth/instruments?class=X, lets you buy into one, and says how much you
// already hold. What differs is the copy and the shape of the headline number,
// and both differences are in CLASS_PAGES in wealth-kit.js where the three can
// be read side by side.
//
// So this controller does not need to know which page it is on. It reads the
// class off <body data-wealth-class> and looks up its persona. The payoff: a
// fix to the buy flow, the empty state or the search lands on all three at
// once, and there is no way for the three copies to drift apart over a year of
// maintenance. When the new Pension ETF class ships, it is one more entry in
// CLASS_PAGES and a new shell file — no new controller.
//
// The day-change column from the Stocks page is deliberately NOT reused. A
// fund's NAV moves once a day and a treasury bill's indicative price does not
// move at all, so a percentage change would sit at 0.00% and read as broken.
// See classQuoteRow in wealth-kit.js.

(function () {
  "use strict";

  const w = window.AgbeWealth;
  const ui = window.AgbeUI;

  // Which page am I? The body carries it so the three shells stay dumb.
  const CLASS = document.body.dataset.wealthClass || "FUND";
  const META = w.CLASS_PAGES[CLASS];
  const KEY = META ? META.key : "funds";

  let all = [];
  let byId = new Map();
  let query = "";

  function head() {
    return w.pageHead({ activeKey: KEY, title: META.title, sub: META.sub });
  }

  // Substring match on symbol, name, issuer or sector. Client-side, because
  // filtering a list this size is not worth a round trip.
  function visible() {
    const q = query.trim().toLowerCase();
    return all
      .filter((i) => !q)
      .filter(
        (i) =>
          i.symbol.toLowerCase().includes(q) ||
          i.name.toLowerCase().includes(q) ||
          (i.issuer || "").toLowerCase().includes(q) ||
          (i.sector || "").toLowerCase().includes(q)
      );
  }

  // The caveat line. Printed once, above the list, in the class's own words —
  // not on every row, where a customer would learn to ignore it. The point of
  // putting it in the same place on all three pages is that it is a real
  // disclosure rather than fine print a page happens to have.
  function note() {
    const liveCount = all.filter((i) => i.live).length;
    const banner = liveCount === 0
      ? `<p class="wcaveat">Prices here are indicative. This service has no live feed for this class, so the figures are the rates we last received, not today's market.</p>`
      : "";
    return `${banner}<p class="wcaveat wcaveat--muted">${ui.escapeHtml(META.note)}</p>`;
  }

  function paint() {
    const list = visible();

    if (!all.length) {
      ui.$("#wlist").innerHTML = w.empty(META.empty);
      return;
    }
    if (!list.length) {
      ui.$("#wlist").innerHTML = w.empty(query ? `Nothing matches “${query}”.` : META.empty);
      return;
    }

    // The API already orders by popularity, then (for bonds) by soonest
    // maturity. Re-sorting here by yield would put the money market fund at
    // the top of the equity fund's page, which is a worse lie than no order.
    ui.$("#wlist").innerHTML = `<div class="wlist">${list.map(w.classQuoteRow).join("")}</div>`;
  }

  function paintSearch() {
    ui.$("#wsearch").innerHTML = `
      <div class="field" style="margin:14px 0">
        <label class="sr-only" for="wq">Search ${ui.escapeHtml(META.title.toLowerCase())}</label>
        <input class="input" id="wq" type="search" inputmode="search"
               placeholder="Search by name, ticker or issuer" value="${ui.escapeHtml(query)}" />
      </div>`;

    ui.$("#wq").addEventListener("input", (e) => {
      query = e.target.value;
      paint();
    });
  }

  async function refresh() {
    const data = await w.load.instruments(CLASS);
    all = data.instruments || [];
    byId = new Map(all.map((i) => [i.id, i]));
    const noteEl = ui.$("#wnote");
    if (noteEl) noteEl.innerHTML = note();
    paint();
  }

  w.boot(KEY, async () => {
    w.page().innerHTML = `<div id="whead"></div><div id="wnote"></div><div id="wsearch"></div><div id="wlist"></div>`;
    ui.$("#whead").innerHTML = head();
    paintSearch();
    ui.$("#wlist").innerHTML = w.loading(`Loading ${META.title.toLowerCase()}…`);
    ui.$("#wnote").innerHTML = note();
    await refresh();

    w.page().addEventListener("click", (e) => {
      const buy = e.target.closest("[data-buy]");
      if (!buy) return;
      const instrument = byId.get(buy.dataset.buy);
      if (!instrument) return;

      // Pension is not a wallet. Contributing is locked to the long term, so
      // say so in the modal before the amount box, not after the purchase.
      w.tradeModal({
        mode: "buy",
        instrument,
        cta: META.cta,
        note: CLASS === "PENSION" ? "Pension money is locked until you reach retirement age." : "",
        onDone: refresh,
      });
    });
  });
})();
