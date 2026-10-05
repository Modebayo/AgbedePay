// pages/wealth.js — the Wealth hub. "My Wealth".
//
// One of four thin controllers over wealth-kit.js. This file describes only
// this page's layout; every formatter, badge, row and the buy/sell modal come
// from the kit.

(function () {
  "use strict";

  const w = window.AgbeWealth;

  // Held onto by id so the Sell buttons can reopen a holding without refetching.
  let byId = new Map();

  const HEAD = `<div id="whead"></div>`;

  function head() {
    return w.pageHead({
      activeKey: "overview",
      title: "My Wealth",
      sub: "Everything you hold with AgbedePay",
      actions: `<a class="btn btn--ghost btn--small" href="wealth-history.html">History</a>`,
    });
  }

  function section(title, link, body) {
    const linkHtml = link
      ? `<a class="wsection__link" href="${link.href}">${ui_text(link.label)}</a>`
      : "";
    return `
      <section class="wsection">
        <div class="wsection__head">
          <h2 class="wsection__title">${ui_text(title)}</h2>
          ${linkHtml}
        </div>
        ${body}
      </section>`;
  }

  // The kit escapes for us, but section titles/labels are literals we control.
  function ui_text(s) {
    return window.AgbeUI.escapeHtml(s);
  }

  // The sibling pages, as navigation rather than as a "coming soon" list.
  //
  // This used to filter `!s.live` and grey out what had not shipped, which was
  // the right thing to do while Funds, Bonds, Pension and Retirement were
  // plans. Now that all eight are live that filter returns nothing, so the hub
  // would have rendered an empty box — and an empty box on a section's front
  // page is worse than no box. Everything now ships, so this is a plain list
  // of where else you can go.
  function navCards() {
    return w.SECTIONS.filter((s) => s.key !== "overview")
      .map(
        (s) => `
        <a class="wsoon" href="${ui_text(s.href)}">
          <span class="wsoon__icon" aria-hidden="true">${window.AgbeUI.icon(s.icon)}</span>
          <div>
            <div class="wsoon__title">${ui_text(s.label)}</div>
            <div class="wsoon__sub">${ui_text(s.blurb)}</div>
          </div>
        </a>`
      )
      .join("");
  }

  // The retirement strip.
  //
  // Present on the hub because the goal is the one piece of Wealth information
  // that is time-critical — someone is either on track or quietly falling
  // behind, and they should not have to go looking for that. The progress bar
  // is a real bar, not a decorative one: it is `progressPct` from the server.
  //
  // When the projection only works because of the assumed return, the strip
  // says so here too. Hiding that behind a link to the full page would mean
  // the one warning that matters only appears to people who went looking.
  function retirementStrip(ret) {
    if (!ret || !ret.goal || !ret.projection) {
      return section(
        "Retirement",
        null,
        `<div class="wlist">
          <a class="wsoon" href="wealth-retirement.html">
            <span class="wsoon__icon" aria-hidden="true">${window.AgbeUI.icon("target")}</span>
            <div>
              <div class="wsoon__title">Set a retirement goal</div>
              <div class="wsoon__sub">Two numbers and you'll know if you're on track</div>
            </div>
          </a>
        </div>`
      );
    }

    const p = ret.projection;
    const pct = Math.max(0, Math.min(100, Number(p.progressPct) || 0));
    const gapWarning = p.statusNeedsGrowth
      ? `<p class="wretstrip__warn">On savings alone you'd fall short by ${ui_text(p.gapNgn.replace("-", ""))}. This plan leans on ${p.expectedAnnualReturnPct}% a year.</p>`
      : "";
    const behind = p.statusAtZeroReturn === "BEHIND" && !p.statusNeedsGrowth
      ? `<p class="wretstrip__warn">Behind target on savings alone. You need ${ui_text(p.requiredMonthlyAtZeroReturnNgn || "—")} a month.</p>`
      : "";

    return section(
      "Retirement",
      { href: "wealth-retirement.html", label: "Full projection" },
      `<div class="wretstrip">
        <div class="wretstrip__head">
          <span class="wretstrip__goal">${ui_text(ret.goal.name)}</span>
          <span class="wretstrip__target">${ui_text(p.targetNgn)} at ${ret.goal.targetAge}</span>
        </div>
        <div class="progress" role="progressbar" aria-valuenow="${pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress toward your retirement target">
          <div class="progress__fill" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <div class="wretstrip__nums">
          <span><strong>${ui_text(p.potNgn)}</strong> saved</span>
          <span><strong>${ui_text(p.monthlyNgn)}</strong> a month</span>
          <span><strong>${ui_text(p.projectedNgn)}</strong> projected</span>
        </div>
        ${gapWarning}
        ${behind}
      </div>`
    );
  }

  function paint(data, ret) {
    const el = w.page();
    el.innerHTML = HEAD;
    window.AgbeUI.$("#whead").innerHTML = head();

    if (!data.totals) {
      el.insertAdjacentHTML(
        "beforeend",
        w.empty("We couldn't load your portfolio. Pull to refresh and try again.")
      );
      return;
    }

    byId = new Map((data.holdings || []).map((h) => [h.id, h]));

    const holdings = data.holdings || [];
    const recents = data.recentOrders || [];
    const hasAny = data.holdingCount > 0;

    const holdingsBody = hasAny
      ? `<div class="wlist">${holdings
          .slice(0, 4)
          .map(w.holdingRow)
          .join("")}</div>`
      : w.empty(
          "You have not invested yet.",
          `<a class="btn btn--primary" href="wealth-stocks.html">Browse stocks</a>`
        );

    const recentsBody = recents.length
      ? `<div class="wlist">${recents.map(w.orderRow).join("")}</div>`
      : w.empty("No investments yet.");

    el.insertAdjacentHTML(
      "beforeend",
      [
        w.totalsGrid(data.totals),

        // The goal sits high, above the allocation chart. Position on this page
        // is a prioritisation: "am I going to be okay" outranks "what fraction
        // of my portfolio is in equities" for most people most of the time.
        retirementStrip(ret),

        data.allocation && data.allocation.length
          ? section("Where your money is", null, w.allocation(data.allocation))
          : "",

        section(
          "Your holdings",
          holdings.length > 4 ? { href: "wealth-portfolio.html", label: `All ${data.holdingCount}` } : null,
          holdingsBody
        ),

        section(
          "Recent activity",
          data.orderCount > 4 ? { href: "wealth-history.html", label: "See all" } : null,
          recentsBody
        ),

        section("Also in Wealth", null, `<div class="wlist">${navCards()}</div>`),
      ].join("")
    );

    wireSells(el);
  }

  // One delegated listener per paint, scoped to the holdings block, so the hub
  // and the portfolio page behave identically.
  function wireSells(scope) {
    scope.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-sell]");
      if (!btn) return;
      const holding = byId.get(btn.dataset.sell);
      if (!holding) return;
      w.tradeModal({ mode: "sell", holding, onDone: refresh });
    });
  }

  // Both requests at once. The retirement summary is a projection over the
  // same portfolio, so the two are independent reads and serialising them would
  // double the time to paint the hub for no reason. `load.retirement` already
  // swallows its own failure and returns an empty shape, so a retirement outage
  // costs the strip and nothing else.
  async function refresh() {
    const [overview, retirement] = await Promise.all([
      w.load.overview(),
      w.load.retirement(),
    ]);
    paint(overview, retirement);
  }

  w.boot("overview", async () => {
    w.page().innerHTML = HEAD;
    window.AgbeUI.$("#whead").innerHTML = head();
    w.page().insertAdjacentHTML("beforeend", w.loading("Loading your portfolio…"));
    await refresh();
  });
})();
