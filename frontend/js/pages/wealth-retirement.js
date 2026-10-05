// pages/wealth-retirement.js — "will I be okay when I stop working?"
//
// This is the one Wealth page that could actually mislead someone, because the
// answer it gives is a NUMBER and a number feels like a fact. So the shape of
// this page is dictated by one rule: the assumption is never allowed to be
// invisible, and it is never allowed to be the only number on screen.
//
// Three commitments hold the page together:
//
//   1. Every verdict is shown twice — once assuming the return, once assuming
//      zero growth. When they disagree the page says so in words and shows the
//      money the assumption is responsible for. A customer who only ever sees
//      the optimistic figure has been shown a sales pitch, not a plan.
//
//   2. The return rate is a visible, user-controlled assumption, defaulted to a
//      modest 12% and never presented as a forecast. Moving the slider
//      re-runs the maths on the SERVER, so the browser cannot quietly disagree
//      with the API about what the answer is.
//
//   3. The gap is always shown against the no-growth number, even when it is
//      unflattering and even when the optimistic number says you are on track.
//      Closing a gap you can only close by guessing well is how people end up
//      retiring short.
//
// The maths itself lives in backend/src/services/retirementService.js. Nothing
// in this file computes a projection; it renders one. If a number appears here
// that is not in the API response, that is a bug in this file.

(function () {
  "use strict";

  const w = window.AgbeWealth;
  const ui = window.AgbeUI;
  const { api } = window.AgbeAPI;

  const HEAD = `<div id="whead"></div>`;
  const BODY = `<div id="wbody"></div>`;

  let returnPct = null; // null = "use the server's default"
  let data = null;

  // ---- Formatting -----------------------------------------------------------

  const naira = (v) => (v === null || v === undefined ? "—" : v);

  // The verdict badge. Two axes, never one: the assumed answer is the headline
  // because that is the plan, and the zero-growth answer sits underneath it
  // because that is the risk. When the two agree, the extra line is hidden —
  // there is nothing to disclose.
  const STATUS_COPY = {
    ACHIEVED: { label: "On track", cls: "ok" },
    AHEAD: { label: "Ahead of target", cls: "ok" },
    ON_TRACK: { label: "On track", cls: "ok" },
    BEHIND: { label: "Behind target", cls: "warn" },
  };

  function statusBadge(p) {
    const s = STATUS_COPY[p.status] || { label: p.status, cls: "warn" };
    return `<span class="wstatus wstatus--${s.cls}">${ui.escapeHtml(s.label)}</span>`;
  }

  // ---- The chart ------------------------------------------------------------

  // Two lines, because one line is the lie. The solid line is the projection
  // with the assumed return; the dashed line is the same pot with no growth at
  // all. When the gap between them widens, the customer is looking directly at
  // the part of the projection that depends on their assumption holding.
  //
  // Drawn as inline SVG rather than a chart library: it is one polyline pair
  // with two reference lines, and a 200kB dependency to render it would cost
  // more on the page than the whole retirement feature does.
  function chart(p) {
    const series = p.series || [];
    if (series.length < 2) return "";

    const W = 640;
    const H = 220;
    const PAD = { top: 16, right: 16, bottom: 28, left: 16 };

    // Scale to the largest of target, both projections, so the target line is
    // always on screen and the two lines are never clipped by a pot that
    // outgrows the goal.
    const peak = Math.max(p.targetMinor, p.projectedMinor, p.projectedAtZeroReturnMinor, 1);
    const x = (i) => PAD.left + (i * (W - PAD.left - PAD.right)) / (series.length - 1);
    const y = (v) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / peak);

    const line = (key) => series.map((pt, i) => `${x(i).toFixed(1)},${y(pt[key]).toFixed(1)}`).join(" ");

    // Fill under the optimistic line only — a second fill would muddy which
    // area is the "real" projection.
    const area = `M ${x(0).toFixed(1)} ${y(0).toFixed(1)} L ${series
      .map((pt, i) => `${x(i).toFixed(1)} ${y(pt.projectedMinor).toFixed(1)}`)
      .join(" L ")} L ${x(series.length - 1).toFixed(1)} ${(H - PAD.bottom).toFixed(1)} L ${x(0).toFixed(1)} ${(H - PAD.bottom).toFixed(1)} Z`;

    const last = series[series.length - 1];
    const first = series[0];
    const yearTicks = series
      .map((pt, i) => (pt.year !== null && i % Math.max(1, Math.round(series.length / 6)) === 0 ? `<text class="wchart__tick" x="${x(i).toFixed(1)}" y="${H - 8}">${pt.year ?? ""}</text>` : ""))
      .join("");

    return `
      <div class="wchart">
        <svg viewBox="0 0 ${W} ${H}" role="img"
             aria-label="Projected retirement savings. With an assumed ${p.expectedAnnualReturnPct}% annual return you reach about ${ui.escapeHtml(p.projectedNgn)} by ${last.year}. With no growth you reach ${ui.escapeHtml(p.projectedAtZeroReturnNgn)}.">
          <defs>
            <linearGradient id="wproj-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--green)" stop-opacity="0.22" />
              <stop offset="100%" stop-color="var(--green)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path d="${area}" fill="url(#wproj-fill)" />
          <line class="wchart__target" x1="${PAD.left}" y1="${y(p.targetMinor).toFixed(1)}" x2="${W - PAD.right}" y2="${y(p.targetMinor).toFixed(1)}" />
          <text class="wchart__targetlabel" x="${W - PAD.right}" y="${(y(p.targetMinor) - 6).toFixed(1)}" text-anchor="end">Target ${ui.escapeHtml(p.targetNgn)}</text>
          <polyline class="wchart__zero" points="${line("projectedAtZeroReturnMinor")}" />
          <polyline class="wchart__line" points="${line("projectedMinor")}" />
          <circle class="wchart__dot" cx="${x(series.length - 1).toFixed(1)}" cy="${y(p.projectedMinor).toFixed(1)}" r="4" />
          ${yearTicks}
        </svg>
        <div class="wchart__key">
          <span><i class="wchart__swatch wchart__swatch--line"></i>At ${p.expectedAnnualReturnPct}% p.a.</span>
          <span><i class="wchart__swatch wchart__swatch--zero"></i>No growth</span>
          <span class="wchart__from">from ${ui.escapeHtml(p.asOf)}</span>
        </div>
      </div>`;
  }

  // ---- Pieces ---------------------------------------------------------------

  // The assumption control. A slider, not a hidden constant, because the whole
  // point is that this number is the customer's judgement and not ours. The
  // default is stated; the range is bounded server-side; and moving it refetches
  // so the displayed projection is always the server's answer, never a
  // client-side approximation of it.
  function assumptionControl(assumptions, shown) {
    const max = assumptions ? assumptions.maxReturnPct : 30;
    const def = assumptions ? assumptions.defaultReturnPct : 12;
    return `
      <div class="wassume">
        <div class="wassume__row">
          <label class="field__label" for="wret">Assumed annual return</label>
          <output class="wassume__value" for="wret">${Number(shown).toFixed(1)}% p.a.</output>
        </div>
        <input class="wassume__slider" id="wret" type="range" min="0" max="${max}" step="0.5" value="${Number(shown)}"
               aria-describedby="wret-help" />
        <p class="wassume__help" id="wret-help">
          A guess, not a forecast. The default is ${def}% and the page assumes nothing above ${max}%.
          We also show you the same plan with <strong>no growth at all</strong>, because that is what
          happens if the market disagrees with you.
        </p>
      </div>`;
  }

  // The four numbers that matter, in the order someone actually asks for them:
  // what I have, what I need, what I'll have, and what I must add monthly.
  function numbers(p) {
    const rows = [
      ["Where you are today", p.potNgn, `Saved so far${p.potSource === "PORTFOLIO" ? " — your live Wealth holdings" : ""}`],
      ["What you'll need", p.targetNgn, `At age ${p.ageAtTarget}, in ${p.yearsRemaining} years`],
      ["What you'll have", p.projectedNgn, `If you save ${p.monthlyNgn} a month at ${p.expectedAnnualReturnPct}% p.a.`],
      ["What you need to save", p.requiredMonthlyNgn, "A month, to reach the target"],
    ];
    return `
      <div class="wstats">
        ${rows
          .map(
            ([label, value, hint]) => `
          <div class="wstat">
            <div class="wstat__label">${ui.escapeHtml(label)}</div>
            <div class="wstat__value">${ui.escapeHtml(naira(value))}</div>
            <div class="wstat__hint">${ui.escapeHtml(hint)}</div>
          </div>`
          )
          .join("")}
      </div>`;
  }

  // The honesty block. The most important element on the page.
  //
  // When the two statuses agree there is nothing to say, and the block is
  // hidden rather than filled with reassurance. When they disagree, it states
  // the disagreement in money, not adjectives — "₦4,200,000 of this depends on
  // the 12% holding" is a fact a customer can act on; "market conditions may
  // vary" is not.
  function honesty(p) {
    if (!p.statusNeedsGrowth) return "";
    return `
      <div class="whonest" role="note">
        <h3>This plan works only if the return holds</h3>
        <p>
          At ${p.expectedAnnualReturnPct}% a year you'd reach ${ui.escapeHtml(p.projectedNgn)} and this goal is on track.
          With no growth at all your money simply adds up: you'd reach ${ui.escapeHtml(p.projectedAtZeroReturnNgn)}.
        </p>
        <p class="whonest__gap">
          <strong>${ui.escapeHtml(p.assumedGrowthNgn)}</strong> of that outcome is growth, not savings.
        </p>
        <p class="whonest__act">
          To reach ${ui.escapeHtml(p.targetNgn)} on savings alone you'd need
          <strong>${ui.escapeHtml(p.requiredMonthlyAtZeroReturnNgn || "—")}</strong> a month,
          not ${ui.escapeHtml(p.monthlyNgn)}.
        </p>
      </div>`;
  }

  // The verdict, written out. Not a percentage, not a coloured pill alone — a
  // sentence, because that is the form a person can repeat to their family.
  function verdictBlock(p) {
    return `
      <div class="wverdict">
        ${statusBadge(p)}
        <p>${ui.escapeHtml(p.verdict || "")}</p>
        ${p.statusAtZeroReturn !== p.status ? `<p class="wverdict__alt">On savings alone (no market growth): ${ui.escapeHtml(
          (STATUS_COPY[p.statusAtZeroReturn] || { label: p.statusAtZeroReturn }).label
        )}.</p>` : ""}
      </div>`;
  }

  function progressBlock(p) {
    const pct = Math.max(0, Math.min(100, Number(p.progressPct) || 0));
    return `
      <div class="wprog">
        <div class="wprog__head">
          <span>${pct.toFixed(0)}% of your target, already saved</span>
        </div>
        <div class="progress" role="progressbar" aria-valuenow="${pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress toward retirement target">
          <div class="progress__fill" style="width:${pct.toFixed(1)}%"></div>
        </div>
      </div>`;
  }

  // ---- The two states -------------------------------------------------------

  function paint() {
    const el = ui.$("#wbody");
    if (!el) return;

    if (!data) {
      el.innerHTML = w.loading("Working out your numbers…");
      return;
    }

    if (!data.goal) {
      el.innerHTML = createState();
      bindCreate(el);
      return;
    }

    const p = data.projection;
    el.innerHTML = `
      <section class="wpanel">
        ${progressBlock(p)}
        ${verdictBlock(p)}
        ${chart(p)}
      </section>

      <section class="wpanel">
        <h3 class="wpanel__title">The numbers</h3>
        ${numbers(p)}
      </section>

      ${honesty(p)}

      <section class="wpanel">
        <h3 class="wpanel__title">Change the assumption</h3>
        ${assumptionControl(data.assumptions, p.expectedAnnualReturnPct)}
      </section>

      <section class="wpanel wpanel--muted">
        <h3 class="wpanel__title">Your goal</h3>
        <dl class="wdl">
          <div><dt>Name</dt><dd>${ui.escapeHtml(data.goal.name)}</dd></div>
          <div><dt>Target age</dt><dd>${data.goal.targetAge}</dd></div>
          <div><dt>Target amount</dt><dd>${ui.escapeHtml(data.goal.targetAmountNgn)}</dd></div>
          <div><dt>Monthly saving</dt><dd>${ui.escapeHtml(data.goal.monthlyContributionNgn)}</dd></div>
          <div><dt>Status</dt><dd>${ui.escapeHtml(data.goal.status)}</dd></div>
        </dl>
        <p class="wmuted-note">
          Age is ${ui.escapeHtml(
            data.ageSource === "DATE_OF_BIRTH" ? "taken from your date of birth" : "the age you told us — add your date of birth in Settings for a more accurate projection"
          )}.
          ${p.potSource === "MANUAL" ? "Your starting amount is entered manually, because you hold no Wealth positions yet." : "Your starting amount is your live Wealth portfolio."}
        </p>
        <div class="wrow">
          <button class="btn" type="button" data-edit>Edit goal</button>
          <button class="btn btn--ghost" type="button" data-close>Close this goal</button>
        </div>
      </section>`;

    bindLive(el, p);
  }

  // No goal yet. The form opens pre-filled with the age we already know and the
  // portfolio value we can already see, so the customer is adjusting something
  // real rather than typing from scratch.
  function createState() {
    const suggested = data.portfolioValueNgn || "₦0";
    return `
      <section class="wpanel">
        <h3 class="wpanel__title">Set a retirement goal</h3>
        <p class="wmuted-note">
          Answer two numbers and this page will tell you whether you're on track — and tell you
          honestly when the answer depends on the market.
        </p>
        <form id="wgoal-form" novalidate>
          <div class="error-banner" role="alert"></div>
          <div class="field">
            <label class="field__label" for="gname">What do you want to save for?</label>
            <input class="input" id="gname" name="name" type="text" maxlength="80" value="Retirement" required />
          </div>
          <div class="field">
            <label class="field__label" for="gage">Your age</label>
            <input class="input" id="gage" name="currentAge" type="number" min="18" max="100" inputmode="numeric"
                   value="${data.currentAge || ""}" ${data.hasDateOfBirth ? "readonly" : "required"} />
            <span class="field__hint">${data.hasDateOfBirth ? "From your date of birth." : "We don't have your date of birth, so this has to come from you."}</span>
          </div>
          <div class="field">
            <label class="field__label" for="gtage">Age you want to stop working</label>
            <input class="input" id="gtage" name="targetAge" type="number" min="30" max="90" inputmode="numeric" value="65" required />
          </div>
          <div class="field">
            <label class="field__label" for="gtarget">How much you'll need then (₦)</label>
            <input class="input" id="gtarget" name="targetAmount" type="number" min="1000" step="1000" inputmode="numeric" placeholder="e.g. 30000000" required />
          </div>
          <div class="field">
            <label class="field__label" for="gnow">What you've already saved (₦)</label>
            <input class="input" id="gnow" name="currentAmount" type="number" min="0" step="1000" inputmode="numeric" value="${Number(data.portfolioValueMinor || 0) / 100}" />
            <span class="field__hint">We pre-filled this from your Wealth portfolio (${ui.escapeHtml(suggested)}). We only use it if you hold nothing.</span>
          </div>
          <div class="field">
            <label class="field__label" for="gmonthly">What you can add each month (₦)</label>
            <input class="input" id="gmonthly" name="monthly" type="number" min="0" step="1000" inputmode="numeric" value="0" required />
          </div>
          <button class="btn btn--primary" type="submit">Show me the plan</button>
        </form>
      </section>`;
  }

  // ---- Wiring ---------------------------------------------------------------

  // Reads the create form into the shape the API wants. Naira strings become
  // integer kobo, because the API is in kobo and a float here would be a
  // rounding bug waiting to happen.
  function readForm(form) {
    const n = (sel) => {
      const raw = form.querySelector(sel).value;
      return raw === "" ? 0 : Math.round(Number(raw) * 100);
    };
    const age = form.querySelector("#gage").value;
    return {
      name: form.querySelector("#gname").value.trim(),
      currentAge: Number(age),
      targetAge: Number(form.querySelector("#gtage").value),
      targetAmountMinor: n("#gtarget"),
      currentAmountMinor: n("#gnow"),
      monthlyContributionMinor: n("#gmonthly"),
    };
  }

  function bindCreate(el) {
    const form = el.querySelector("#wgoal-form");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = form.querySelector(".error-banner");
      const btn = form.querySelector("button[type=submit]");
      err.textContent = "";
      btn.disabled = true;
      try {
        await api("/wealth/retirement", { method: "POST", body: readForm(form) });
        returnPct = null;
        await refresh();
      } catch (ex) {
        err.textContent = ex.message || "Could not save that.";
        btn.disabled = false;
      }
    });
  }

  // The slider. `change` rather than `input` so the maths is not re-run on
  // every pixel of the drag — one request when the customer lets go.
  function bindLive(el, p) {
    const slider = el.querySelector("#wret");
    if (slider) {
      const out = el.querySelector(".wassume__value");
      slider.addEventListener("input", () => {
        out.textContent = `${Number(slider.value).toFixed(1)}% p.a.`;
      });
      slider.addEventListener("change", async (e) => {
        returnPct = e.target.value;
        slider.disabled = true;
        await refresh();
      });
    }

    el.querySelector("[data-edit]")?.addEventListener("click", async () => {
      const name = window.prompt("What do you want to call this goal?", data.goal.name);
      if (name === null) return;
      const target = window.prompt("Target amount in naira", String(Math.round(data.goal.targetAmountMinor / 100)));
      if (target === null) return;
      const monthly = window.prompt("Monthly saving in naira", String(Math.round(data.goal.monthlyContributionMinor / 100)));
      if (monthly === null) return;
      try {
        await api(`/wealth/retirement/${data.goal.id}`, {
          method: "PATCH",
          body: {
            name: name.trim() || data.goal.name,
            targetAmountMinor: Math.round(Number(target) * 100),
            monthlyContributionMinor: Math.round(Number(monthly) * 100),
          },
        });
        returnPct = null;
        await refresh();
      } catch (ex) {
        window.alert(ex.message || "Could not update that goal.");
      }
    });

    el.querySelector("[data-close]")?.addEventListener("click", async () => {
      if (!window.confirm("Close this goal? It stays in your history but stops being projected.")) return;
      try {
        await api(`/wealth/retirement/${data.goal.id}`, { method: "DELETE" });
        returnPct = null;
        await refresh();
      } catch (ex) {
        window.alert(ex.message || "Could not close that goal.");
      }
    });
  }

  async function refresh() {
    const params = returnPct === null ? {} : { returnPct };
    data = await w.load.retirement(params);
    paint();
  }

  w.boot("retirement", async () => {
    w.page().innerHTML = HEAD + BODY;
    ui.$("#whead").innerHTML = w.pageHead({
      activeKey: "retirement",
      title: "Retirement Goal",
      sub: "Where you are, where you need to be, and how much of the difference is a guess",
    });
    await refresh();
  });
})();
