// wealth-kit.js — the shared UI kit for the whole Wealth section.
//
// WHY THIS FILE EXISTS
// The rest of the app is one page per feature, each script self-contained, and
// that is the right call for a page that does one thing. Wealth is different:
// eight sub-pages that all need the same sub-navigation, the same gain/loss
// formatters, the same "is this price live?" badge and — most importantly — the
// SAME buy/sell confirmation flow. Written as eight independent scripts that
// would be four copies of a PIN modal and four copies of a price badge, and
// they would drift apart the first time the badge wording changed.
//
// So: one kit, four thin controllers. Every Wealth page loads this, then its
// own small file that only describes its own layout.
//
// Rules obeyed here, same as everywhere else in this app:
//   - Balances and values are FORMATTED by the backend and only formatted here.
//     Nothing computes a portfolio value in the browser.
//   - Every interpolated value goes through ui.escapeHtml.
//   - Every money-moving action carries a fresh Idempotency-Key and a PIN.

(function () {
  "use strict";

  const api = window.AgbeAPI;
  const ui = window.AgbeUI;

  // ---- The information architecture ----------------------------------------

  // `live: false` means the page exists in the plan but has not shipped yet.
  // The hub shows those greyed out rather than hiding them, so the shape of the
  // section is visible before it is built.
  //
  // All eight are live. Funds, Bonds, Pension and Retirement are not separate
  // implementations: the first three are the SAME browse-and-buy page wearing
  // different copy, served by pages/wealth-browse.js against a different class,
  // and Retirement is a projection over a live portfolio. That is why the kit
  // exists — see pages/wealth-browse.js for the three-in-one argument.
  const SECTIONS = [
    { key: "overview", label: "My Wealth", icon: "wealth", href: "wealth.html", blurb: "Everything you hold, in one place", live: true },
    { key: "stocks", label: "Stocks", icon: "stock", href: "wealth-stocks.html", blurb: "Buy and sell real NGX shares", live: true },
    { key: "funds", label: "Funds", icon: "fund", href: "wealth-funds.html", blurb: "Money market, balanced and equity funds", live: true },
    { key: "bonds", label: "Bonds", icon: "bond", href: "wealth-bonds.html", blurb: "FGN treasury bills and bonds", live: true },
    { key: "pension", label: "Pension", icon: "pension", href: "wealth-pension.html", blurb: "Your retirement savings", live: true },
    { key: "retirement", label: "Retirement Goal", icon: "target", href: "wealth-retirement.html", blurb: "See if you're on track to stop working", live: true },
    { key: "portfolio", label: "Portfolio", icon: "pie", href: "wealth-portfolio.html", blurb: "Positions, value and gain", live: true },
    { key: "history", label: "Investment History", icon: "doc", href: "wealth-history.html", blurb: "Every buy and sell you've made", live: true },
  ];

  // The three class pages, in one place so the copy that differs between them
  // is visible as a set rather than scattered across three near-identical
  // scripts. Consumed by pages/wealth-browse.js, which reads the class off
  // <body data-wealth-class> and looks it up here.
  const CLASS_PAGES = {
    FUND: {
      key: "funds",
      className: "FUND",
      title: "Funds & Investments",
      sub: "Pooled funds managed for you. You pick the risk, we show the yield.",
      cta: "Invest",
      empty: "No funds available right now.",
      // What a fund page leads with. A fund has no day-change — its NAV moves
      // once a day — so the yield is the headline and the day move is noise.
      lead: "yield",
      note: "Fund yields are the trailing twelve months, not a promise of what you will earn.",
    },
    BOND: {
      key: "bonds",
      className: "BOND",
      title: "Bonds & Treasury",
      sub: "Lend to the Federal Government. Fixed return, known maturity date.",
      cta: "Invest",
      empty: "No treasury paper available right now.",
      lead: "maturity",
      note: "Treasury yields are indicative rates. Auctions set the price on the day.",
    },
    PENSION: {
      key: "pension",
      className: "PENSION",
      title: "Pension",
      sub: "Long-term savings for when you stop working.",
      cta: "Contribute",
      empty: "No pension funds open right now.",
      lead: "yield",
      note: "Pension withdrawals are restricted before your retirement age. This is a long-term pot, not a wallet.",
    },
  };

  const CLASS_META = {
    STOCK: { label: "Stocks", icon: "stock" },
    FUND: { label: "Funds", icon: "fund" },
    PENSION: { label: "Pension", icon: "pension" },
    BOND: { label: "Bonds", icon: "bond" },
  };

  const RISK_LABEL = { LOW: "Low risk", MEDIUM: "Medium risk", HIGH: "High risk" };

  // ---- Small formatters -----------------------------------------------------

  function changeClass(pct) {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return "";
    return pct >= 0 ? "is-up" : "is-down";
  }

  function changeMark(pct) {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
    return `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(2)}%`;
  }

  function gainClass(minor) {
    if (minor === null || minor === undefined) return "";
    return Number(minor) >= 0 ? "is-up" : "is-down";
  }

  function relativeTime(iso) {
    if (!iso) return "";
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  // ---- The honesty badge ---------------------------------------------------

  // This is the most important widget in the section. A price is either live
  // from NGX (30 minutes delayed, which NGX publishes free) or it is a stored
  // indicative rate. The user is told which, every time, on every price.
  function priceBadge(item) {
    if (item.live) {
      const delay = item.delayedMinutes;
      return `<span class="wbadge wbadge--live" title="Live NGX price${delay ? `, delayed ${delay} minutes` : ""}">
        ${ui.icon("radar")} LIVE${delay ? `<span class="wbadge__note">${delay}m delay</span>` : ""}
      </span>`;
    }
    if (item.priceSource === "INDICATIVE") {
      return `<span class="wbadge wbadge--indicative" title="Indicative rate — no live feed is published for this instrument">${ui.icon("alert")} Indicative</span>`;
    }
    return `<span class="wbadge wbadge--cached" title="Last known price — the live feed did not answer">${ui.icon("clock")} Last known</span>`;
  }

  // A line under a price: the yield, or the delay note, or nothing.
  function priceNote(item) {
    if (item.yieldPct !== null && item.yieldPct !== undefined) {
      return `<span class="wprice__yield">${Number(item.yieldPct).toFixed(2)}% p.a.</span>`;
    }
    if (item.live && item.delayedMinutes) {
      return `<span class="wprice__delay">NGX, ${item.delayedMinutes} min delayed</span>`;
    }
    return "";
  }

  // ---- Maturity, for the classes that have one ----

  // A bond without a date is a bond without the only fact that matters, so the
  // line is always printed for BOND rows. A matured instrument is called out
  // rather than hidden: quietly dropping the worst rows off the list is how a
  // product ends up looking better than it is.
  //
  // The day count is rendered in the unit a Nigerian saver actually thinks in —
  // days for a treasury bill, then years, then months. "1842 days" is true and
  // useless.
  function maturityLine(item) {
    if (!item.maturityDate) return "";
    const days = item.daysToMaturity;

    if (days === null || days === undefined) {
      return `<span class="wmature">Matures ${ui.escapeHtml(item.maturityDate)}</span>`;
    }
    if (days < 0) {
      return `<span class="wmature wmature--passed">Matured ${ui.escapeHtml(item.maturityDate)}</span>`;
    }
    if (days === 0) {
      return `<span class="wmature wmature--soon">Matures today</span>`;
    }
    if (days < 400) {
      return `<span class="wmature wmature--soon">${days} day${days === 1 ? "" : "s"} to go</span>`;
    }
    const years = Math.floor(days / 365);
    const months = Math.round((days - years * 365) / 30.44);
    const span =
      years > 0
        ? `${years} year${years === 1 ? "" : "s"}${months > 0 ? ` ${months} month${months === 1 ? "" : "s"}` : ""}`
        : `${months} month${months === 1 ? "" : "s"}`;
    return `<span class="wmature">Matures ${ui.escapeHtml(item.maturityDate)} · ${span} left</span>`;
  }

  // The yield, as the thing it is: an annualised rate that is not a promise.
  // A fund's yield is trailing, a bond's is a coupon-equivalent — neither is
  // "what you will earn", and the page says so once, in the class note, rather
  // than putting a disclaimer on every single row.
  function yieldChip(item) {
    if (item.yieldPct === null || item.yieldPct === undefined) return "";
    const level = item.riskLevel === "LOW" ? "low" : item.riskLevel === "HIGH" ? "high" : "mid";
    return `<span class="wyield wyield--${level}">${Number(item.yieldPct).toFixed(2)}% p.a.</span>`;
  }

  // ---- Sub-navigation ------------------------------------------------------

  // A horizontally scrolling strip. Eight sections do not fit on a phone, and
  // the existing .tabs block (overflow-x: auto) already handles that, so we
  // reuse it rather than inventing a second nav primitive.
  function subNav(activeKey) {
    const tabs = SECTIONS.map((s) => {
      const active = s.key === activeKey ? " is-active" : "";
      const soon = s.live ? "" : " is-soon";
      return `<a class="tab${active}${soon}" href="${s.href}"${s.key === activeKey ? ' aria-current="page"' : ""}>
        ${ui.icon(s.icon)}${ui.escapeHtml(s.label)}${s.live ? "" : '<span class="tab__soon">soon</span>'}
      </a>`;
    }).join("");

    return `
      <a class="wback" href="wealth.html">${ui.icon("chevron")} Wealth</a>
      <div class="tabs" role="tablist" aria-label="Wealth sections">${tabs}</div>`;
  }

  // ---- Shared page header --------------------------------------------------

  function pageHead({ activeKey, title, sub, actions = "" }) {
    return `
      <div class="whead">
        <div class="whead__main">
          <div class="page-title">${ui.escapeHtml(title)}</div>
          <p class="page-sub">${ui.escapeHtml(sub)}</p>
        </div>
        ${actions ? `<div class="whead__actions">${actions}</div>` : ""}
      </div>
      ${subNav(activeKey)}`;
  }

  // ---- Allocation ----------------------------------------------------------

  // Horizontal bars rather than a pie: a pie needs colours that stay
  // distinguishable when there are four slices on a small screen, and bars
  // also let us print the naira value next to the percentage.
  function allocation(allocation) {
    if (!allocation || !allocation.length) return "";
    const rows = allocation
      .map((a) => {
        const meta = CLASS_META[a.class] || { label: a.class, icon: "wallet" };
        const pct = a.sharePct === null ? 0 : a.sharePct;
        return `
          <div class="walloc__row">
            <div class="walloc__label">
              <span class="walloc__icon" aria-hidden="true">${ui.icon(meta.icon)}</span>
              <span>${ui.escapeHtml(meta.label)}</span>
              <span class="walloc__pct">${pct.toFixed(1)}%</span>
            </div>
            <div class="walloc__bar"><div class="walloc__fill walloc__fill--${a.class.toLowerCase()}" style="width:${pct}%"></div></div>
            <div class="walloc__value">${ui.escapeHtml(a.valueNgn)}</div>
          </div>`;
      })
      .join("");

    return `<div class="walloc">${rows}</div>`;
  }

  // ---- Totals strip --------------------------------------------------------

  function totalsGrid(t) {
    return `
      <div class="stats-dash">
        <div class="stat-card">
          <div class="stat-card__label">Value</div>
          <div class="stat-card__value">${ui.escapeHtml(t.valueNgn)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Cost</div>
          <div class="stat-card__value">${ui.escapeHtml(t.costNgn)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Gain</div>
          <div class="stat-card__value ${gainClass(t.gainMinor)}">${ui.escapeHtml(t.gainNgn)}</div>
          <div class="stat-card__sub ${gainClass(t.gainMinor)}">${t.gainPct === null ? "—" : `${t.gainPct >= 0 ? "+" : ""}${t.gainPct.toFixed(2)}%`}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Today</div>
          <div class="stat-card__value ${gainClass(t.dayChangeMinor)}">${ui.escapeHtml(t.dayChangeNgn)}</div>
          <div class="stat-card__sub ${gainClass(t.dayChangeMinor)}">${t.dayChangePct === null ? "—" : `${t.dayChangePct >= 0 ? "+" : ""}${t.dayChangePct.toFixed(2)}%`}</div>
        </div>
      </div>`;
  }

  // ---- Rows ----------------------------------------------------------------

  function holdingRow(h) {
    const gainPct = h.gainPct === null ? "" : `<span class="whold__gainpct ${gainClass(h.gainMinor)}">${h.gainPct >= 0 ? "+" : ""}${h.gainPct.toFixed(2)}%</span>`;
    return `
      <div class="whold" data-holding="${h.id}">
        <div class="whold__main">
          <div class="whold__sym">${ui.escapeHtml(h.symbol)} ${priceBadge(h)}</div>
          <div class="whold__name">${ui.escapeHtml(h.name)}</div>
          <div class="whold__meta">
            <span class="badge">${ui.escapeHtml(h.class)}</span>
            ${h.sector ? `<span class="badge">${ui.escapeHtml(h.sector)}</span>` : ""}
            <span class="whold__units">${ui.escapeHtml(h.units)} unit${h.units === "1" ? "" : "s"} @ ${ui.escapeHtml(h.avgCostNgn)}</span>
          </div>
        </div>
        <div class="whold__right">
          <div class="whold__value">${ui.escapeHtml(h.valueNgn)}</div>
          <div class="whold__gain ${gainClass(h.gainMinor)}">${ui.escapeHtml(h.gainNgn)} ${gainPct}</div>
          ${priceNote(h)}
          <button class="btn btn--ghost btn--small" type="button" data-sell="${h.id}">Sell</button>
        </div>
      </div>`;
  }

  function quoteRow(i) {
    const held = i.heldUnitsMinor > 0
      ? `<span class="wquote__held">${ui.escapeHtml(i.heldUnits)} held</span>`
      : "";
    return `
      <div class="wquote" data-instrument="${i.id}">
        <div class="wquote__main">
          <div class="wquote__sym">${ui.escapeHtml(i.symbol)} ${priceBadge(i)}</div>
          <div class="wquote__name">${ui.escapeHtml(i.name)}</div>
          <div class="wquote__meta">
            ${i.sector ? `<span class="badge">${ui.escapeHtml(i.sector)}</span>` : ""}
            <span class="badge badge--RISK">${ui.escapeHtml(RISK_LABEL[i.riskLevel] || i.riskLevel)}</span>
            ${held}
          </div>
        </div>
        <div class="wquote__right">
          <div class="wquote__price">${ui.escapeHtml(i.priceNgn)}</div>
          <div class="wquote__change ${changeClass(i.changePct)}">${changeMark(i.changePct)}</div>
          ${priceNote(i)}
          <button class="btn btn--primary btn--small" type="button" data-buy="${i.id}">Buy</button>
        </div>
      </div>`;
  }

  // The row used by the Funds, Bonds and Pension pages.
  //
  // Deliberately NOT `quoteRow`. That one is built around a DAY CHANGE, which is
  // the whole point on the Stocks page and actively misleading on the other
  // three: a fund's NAV moves once a day and a treasury bill's indicative price
  // does not move at all, so printing a percentage change that is always ~0.00%
  // teaches the customer that this product is broken. Here the yield leads, the
  // maturity is printed when there is one, and the day change is shown only
  // where it means something.
  function classQuoteRow(i) {
    const held = i.heldUnitsMinor > 0
      ? `<span class="wquote__held">${ui.escapeHtml(i.heldUnits)} held</span>`
      : "";
    return `
      <div class="wquote wquote--${i.class.toLowerCase()}" data-instrument="${i.id}">
        <div class="wquote__main">
          <div class="wquote__sym">${ui.escapeHtml(i.symbol)} ${priceBadge(i)}</div>
          <div class="wquote__name">${ui.escapeHtml(i.name)}</div>
          <div class="wquote__meta">
            ${i.issuer ? `<span class="badge">${ui.escapeHtml(i.issuer)}</span>` : ""}
            ${i.sector ? `<span class="badge">${ui.escapeHtml(i.sector)}</span>` : ""}
            <span class="badge badge--RISK">${ui.escapeHtml(RISK_LABEL[i.riskLevel] || i.riskLevel)}</span>
            ${held}
          </div>
          ${maturityLine(i)}
        </div>
        <div class="wquote__right">
          ${yieldChip(i)}
          <div class="wquote__price">${ui.escapeHtml(i.priceNgn)}</div>
          <div class="wquote__sub">per unit</div>
          <button class="btn btn--primary btn--small" type="button" data-buy="${i.id}">Buy</button>
        </div>
      </div>`;
  }

  function orderRow(o) {
    const isBuy = o.type === "BUY";
    const href = o.transactionId
      ? `transaction.html?id=${encodeURIComponent(o.transactionId)}`
      : `transaction.html?reference=${encodeURIComponent(o.reference)}`;
    return `
      <a class="worder" href="${href}">
        <div class="worder__icon ${isBuy ? "is-buy" : "is-sell"}" aria-hidden="true">${ui.icon(isBuy ? "plus" : "minus")}</div>
        <div class="worder__main">
          <div class="worder__title">${isBuy ? "Bought" : "Sold"} ${ui.escapeHtml(o.symbol)}</div>
          <div class="worder__meta">
            <span class="badge badge--${o.type}">${o.type}</span>
            <span class="badge">${ui.escapeHtml(o.class)}</span>
            <span class="worder__ref">${ui.escapeHtml(o.reference)}</span>
          </div>
        </div>
        <div class="worder__right">
          <div class="worder__amount worder__amount--${isBuy ? "debit" : "credit"}">${isBuy ? "−" : "+"}${ui.escapeHtml(o.amountNgn)}</div>
          <div class="worder__units">${ui.escapeHtml(o.units)} unit${o.units === "1" ? "" : "s"} @ ${ui.escapeHtml(o.unitPriceNgn)}</div>
          <div class="worder__when">${relativeTime(o.createdAt)}</div>
        </div>
      </a>`;
  }

  // ---- Buy / sell modal ----------------------------------------------------

  // ONE implementation, used by every page. This is the piece that would have
  // been copied four times without the kit.
  //
  // Sizing is offered in both directions but submitted as exactly one number:
  // `amountMinor` for "spend this much", `unitsMinor` for "give me this many".
  // The backend rejects a request carrying both, so the two inputs here are
  // mutually exclusive by construction.
  // `cta` overrides the button and heading word for a class that is not really
  // a trade — Pension says "Contribute", not "Invest". `note` is a line of
  // class-specific warning shown above the amount box, so a restriction the
  // customer must know about appears before they type a figure, not after the
  // money has moved.
  function tradeModal({ mode, instrument, holding, cta, note, onDone }) {
    const isBuy = mode === "buy";
    const action = isBuy ? cta || "Invest" : "Sell";
    const price = isBuy ? instrument.priceMinor : holding.priceMinor;
    const heldUnits = isBuy ? instrument.heldUnitsMinor : holding.unitsMinor;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${ui.escapeHtml(action)}">
        <div class="modal__head">
          <h3>${ui.escapeHtml(action)} ${ui.escapeHtml(isBuy ? instrument.symbol : holding.symbol)}</h3>
          <button class="modal__close" type="button" data-close aria-label="Close">${ui.icon("close")}</button>
        </div>
        <p class="modal__sub">
          ${ui.escapeHtml(isBuy ? instrument.name : holding.name)}<br />
          Price ${ui.escapeHtml(ui.formatNgn(price))} each
          ${priceNote(isBuy ? instrument : holding)}
        </p>
        ${note ? `<p class="wcaveat wcaveat--modal">${ui.escapeHtml(note)}</p>` : ""}
        <form id="trade-form" novalidate>
          <div class="error-banner" role="alert"></div>
          <div class="field">
            <label class="field__label" for="trade-amount">Amount (₦, whole naira)</label>
            <input class="input" id="trade-amount" name="amount" type="number" min="100" step="1" inputmode="numeric" placeholder="e.g. 5000" ${isBuy ? "" : "hidden"} />
            <span class="field__hint" data-amount-hint ${isBuy ? "" : "hidden"}>Cheapest units you can get at this price.</span>
          </div>
          <div class="field">
            <label class="field__label" for="trade-units">Units</label>
            <input class="input" id="trade-units" name="units" type="number" min="0.0001" step="0.0001" inputmode="decimal" placeholder="e.g. 5.795" />
            <span class="field__hint">You hold <strong data-held>${ui.escapeHtml((heldUnits / 100000).toFixed(4).replace(/0+$/, "").replace(/\.$/, ""))}</strong> units.</span>
          </div>
          <div class="field">
            <label class="field__label" for="trade-pin">Confirm with your 6-digit PIN</label>
            <input class="input input--pin" id="trade-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="••••••" required />
          </div>
          <button class="btn ${isBuy ? "btn--primary" : "btn--green"}" type="submit">${ui.escapeHtml(action)}</button>
        </form>
      </div>`;
    document.body.appendChild(backdrop);

    const amountEl = backdrop.querySelector("#trade-amount");
    const unitsEl = backdrop.querySelector("#trade-units");
    const submit = backdrop.querySelector('button[type="submit"]');
    const originalLabel = submit.textContent;

    // Live "that is about N units" hint, computed in the browser for
    // reassurance only. The authoritative fill is whatever the backend prices.
    const syncHint = () => {
      if (!isBuy) return;
      const naira = Number.parseInt(amountEl.value, 10);
      const hint = backdrop.querySelector("[data-amount-hint]");
      if (!hint) return;
      hint.textContent =
        Number.isSafeInteger(naira) && naira >= 100 && price > 0
          ? `About ${(naira * 100 * 100000) / price / 100000} units at ${ui.formatNgn(price)} each.`
          : "Cheapest units you can get at this price.";
    };
    amountEl?.addEventListener("input", syncHint);

    // Selling only ever sends units: there is no "amount" box on a sell, because
    // picking a quantity for someone at an unknown price is not a decision we
    // should make for them.
    if (!isBuy) {
      unitsEl.max = String(heldUnits / 100000);
      unitsEl.value = "";
    }

    const close = () => backdrop.remove();
    backdrop.querySelector("[data-close]").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });

    const pin = backdrop.querySelector("#trade-pin");
    pin.addEventListener("input", () => {
      pin.value = pin.value.replace(/\D/g, "").slice(0, 6);
    });

    backdrop.querySelector("#trade-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      ui.resetFormErrors(form);

      // Exactly one of the two sizing fields may be filled.
      const naira = Number.parseInt(amountEl.value, 10);
      const units = Number.parseFloat(unitsEl.value);
      const hasAmount = Number.isSafeInteger(naira) && naira > 0;
      const hasUnits = Number.isFinite(units) && units > 0;
      if (hasAmount === hasUnits) {
        ui.toast("Enter an amount or a number of units — not both", "error");
        return;
      }

      // Kobo and hundred-thousandths respectively. The +0.5/-0.5 is a ROUND, not
      // a float price: fractional units cannot be sent as a fraction.
      const body = isBuy
        ? hasAmount
          ? { instrumentId: instrument.id, amountMinor: naira * 100, pin: pin.value }
          : { instrumentId: instrument.id, unitsMinor: Math.floor(units * 100000 + 0.5), pin: pin.value }
        : { holdingId: holding.id, unitsMinor: Math.floor(units * 100000 + 0.5), pin: pin.value };

      submit.disabled = true;
      submit.textContent = isBuy ? "Investing…" : "Selling…";

      try {
        const result = await api(isBuy ? "/wealth/orders/buy" : "/wealth/orders/sell", {
          method: "POST",
          body,
          headers: { "Idempotency-Key": api.idempotencyKey() },
        });
        close();
        if (result.replayed) {
          ui.toast(result.notice || "Already processed", "info");
        } else {
          const verb = isBuy ? "invested" : "received";
          ui.toast(`${ui.formatNgn(result.amountMinor)} ${verb}. New balance ${ui.formatNgn(result.balanceMinor)}`, "success");
        }
        onDone?.();
      } catch (err) {
        ui.showFormErrors(form, err);
        submit.disabled = false;
        submit.textContent = originalLabel;
      }
    });

    amountEl?.focus();
  }

  // ---- Data access ---------------------------------------------------------

  const load = {
    overview: () => api("/wealth/overview").catch(() => ({ totals: null, allocation: [], holdings: [], holdingCount: 0, orderCount: 0, recentOrders: [] })),
    portfolio: () => api("/wealth/portfolio").catch(() => ({ holdings: [], totals: null, allocation: [] })),
    instruments: (className) => api(`/wealth/instruments${className ? `?class=${className}` : ""}`).catch(() => ({ instruments: [] })),
    history: (params = {}) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
      return api(`/wealth/history${qs.toString() ? `?${qs}` : ""}`).catch(() => ({ items: [], page: 1, limit: 20, total: 0 }));
    },
    // The retirement goal, its projection, and the assumptions behind them.
    // `returnPct` is passed straight through so the slider on the page changes
    // the maths server-side rather than pretending to in the browser.
    retirement: (params = {}) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) qs.set(k, v);
      return api(`/wealth/retirement${qs.toString() ? `?${qs}` : ""}`).catch(() => ({ goal: null, projection: null }));
    },
  };

  // Standard page boot: guard the session, paint the shell, then hand over.
  function boot(activeKey, render) {
    ui.requireAuth(async (profile) => {
      ui.renderShell(profile, "wealth");
      render(page(), profile);
    });
  }

  const page = () => ui.$("#page");

  function loading(message) {
    return ui.loadingCard(message);
  }

  function empty(message, action = "") {
    return `<div class="empty">${ui.escapeHtml(message)}${action}</div>`;
  }

  window.AgbeWealth = {
    SECTIONS,
    CLASS_META,
    CLASS_PAGES,
    RISK_LABEL,
    // formatters
    changeClass,
    changeMark,
    gainClass,
    relativeTime,
    priceBadge,
    priceNote,
    maturityLine,
    yieldChip,
    // layout
    subNav,
    pageHead,
    allocation,
    totalsGrid,
    holdingRow,
    quoteRow,
    classQuoteRow,
    orderRow,
    // actions
    tradeModal,
    // data
    load,
    boot,
    page,
    loading,
    empty,
  };
})();
