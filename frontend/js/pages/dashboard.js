// dashboard — the first thing you see after login.
// Loads user+wallet profile, recent transactions, savings goals and LIVE market
// data (real FX + crypto rates from the backend /api/market — never AI-made).
// Balances shown come straight from the backend, never computed here.

(function () {
  "use strict";

  const { api, idempotencyKey } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const page = ui.$("#page");
  const MARKET_POLL_MS = 60000;

  let marketTimer = null;

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "home");

    const [txData, goalsData, walletData] = await Promise.all([
      api("/transactions?page=1&limit=8").catch(() => ({ items: [], total: 0 })),
      api("/savings/goals").catch(() => ({ goals: [] })),
      api("/wallet").catch(() => ({ wallet: null })),
    ]);

    render(profile, txData, goalsData.goals || [], walletData.wallet);
    startMarketFeed();
  });

  function startMarketFeed() {
    refreshMarket(true);
    marketTimer = setInterval(() => {
      if (document.visibilityState !== "hidden") refreshMarket(false);
    }, MARKET_POLL_MS);
  }

  function refreshMarket(initial) {
    api("/market")
      .then((m) => renderMarket(m))
      .catch(() => {
        if (initial) renderMarket({ available: false });
      });
  }

  // ---- Formatting helpers -------------------------------------------------

  function pretty(naira) {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      maximumFractionDigits: 2,
    }).format(naira);
  }

  function compact(naira) {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(naira);
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

  function changeClass(pct) {
    if (pct === null || !Number.isFinite(pct)) return "";
    return pct >= 0 ? "is-up" : "is-down";
  }

  function changeMark(pct) {
    if (pct === null || !Number.isFinite(pct)) return "—";
    return `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(2)}%`;
  }

  // ---- Goals --------------------------------------------------------------

  function goalCard(g) {
    const progress = Math.max(0, Math.min(100, g.progressPercent || 0));
    const remaining = g.remainingMinor > 0 ? g.remainingNgn : "Goal reached";
    return `
      <div class="goal-card">
        <div class="goal-card__head">
          <div class="goal-card__name">${ui.escapeHtml(g.name)}</div>
          <span class="goal-card__pct">${progress}%</span>
        </div>
        <div class="goal-card__amounts">
          <span class="goal-card__current">${g.currentAmountNgn || "₦0.00"}</span>
          <span class="goal-card__target">of ${g.targetAmountNgn}</span>
        </div>
        <div class="progress" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">
          <div class="progress__fill" style="width:${progress}%"></div>
        </div>
        <div class="goal-card__foot">
          <span>${remaining}</span>
          <span class="goal-card__date">${g.targetDate ? "due " + new Date(g.targetDate).toLocaleDateString() : ""}</span>
        </div>
        ${g.status === "ACTIVE" ? `<button class="goal-card__add" type="button" data-deposit="${g.id}">${ui.icon("plus")} Add money</button>` : ""}
      </div>`;
  }

  function goalsHtml(goals) {
    const totalSavedMinor = goals.reduce((sum, g) => sum + (g.currentAmountMinor || 0), 0);
    return `
      <div class="section-head">
        <h2>Savings goals</h2>
        <div class="section-head__actions">
          ${goals.length ? `<span class="badge badge--SUCCESS">${goals.length} active</span>` : ""}
          <a class="link-btn" href="savings.html">${ui.icon("savings")} All goals</a>
          <button class="link-btn" type="button" data-new-goal>${ui.icon("plus")} New goal</button>
        </div>
      </div>
      <div class="goal-new" data-goal-form hidden>
        <form id="goal-form" class="goal-form" novalidate>
          <div class="field">
            <label class="field__label" for="goal-name">What are you saving for?</label>
            <input class="input" id="goal-name" name="name" type="text" maxlength="80" placeholder="e.g. New laptop, Trip to Lagos" required />
          </div>
          <div class="field">
            <label class="field__label" for="goal-target">Target (₦, whole naira)</label>
            <input class="input" id="goal-target" name="targetAmount" type="number" min="100" step="1" inputmode="numeric" placeholder="e.g. 150000" required />
          </div>
          <div class="field">
            <label class="field__label" for="goal-date">Target date <span class="field__hint">— optional</span></label>
            <input class="input" id="goal-date" name="targetDate" type="date" />
          </div>
          <div class="goal-form__actions">
            <button class="btn btn--primary" type="submit">${ui.icon("plus")} Create goal</button>
            <button class="btn btn--ghost" type="button" data-cancel-goal>Cancel</button>
          </div>
        </form>
      </div>
      <div data-goals-list>
        ${goals.length ? `<div class="goals">${goals.map(goalCard).join("")}</div>` : `<div class="empty">No savings goals yet — set one up and watch it grow.</div>`}
      </div>
      <div class="stats-dash" data-savings-stats>
        <div class="stat-card">
          <div class="stat-card__label">Total saved</div>
          <div class="stat-card__value" data-saved>${ui.escapeHtml(ui.formatNgn(totalSavedMinor / 100))}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Savings goals</div>
          <div class="stat-card__value" data-goals-count>${goals.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Transactions</div>
          <div class="stat-card__value"><a class="stat-link" href="transactions.html" data-tx-count></a></div>
        </div>
      </div>`;
  }

  // ---- Dashboard -----------------------------------------------------------

  function render(profile, txData, goals, wallet) {
    const w = profile.wallet;
    if (!w) {
      page.innerHTML = `<p class="error-banner error-banner--show" role="alert">Wallet not found.</p>`;
      return;
    }

    const walletStatus =
      w.status !== "ACTIVE"
        ? `<div class="notice"><strong>Your wallet is currently ${ui.escapeHtml(w.status.toLowerCase())}.</strong>Please contact support.</div>`
        : "";

    const kyc = profile.kyc || {};
    const stepTotal = kyc.steps ? Object.keys(kyc.steps).length : 6;
    const stepsDone = kyc.steps ? Object.values(kyc.steps).filter(Boolean).length : 0;
    const kycNotice =
      kyc.level === "IDENTITY_VERIFIED"
        ? ""
        : `<a class="kyc-card" href="profile.html">
             <span class="kyc-card__icon" aria-hidden="true">${ui.icon("id")}</span>
             <span class="kyc-card__text">
               <strong>
                 ${
                   kyc.level === "BASIC"
                     ? "Verify your identity to unlock your full limits."
                     : "Complete your bio data to start verification."
                 }
               </strong>
               <small>${stepsDone}/${stepTotal} profile steps done · NIN or BVN verification</small>
             </span>
             <span class="kyc-card__cta">Continue →</span>
           </a>`;

    const quickActions = `
      <div class="quick-actions">
        <a class="quick-action" href="send.html"><span class="quick-action__icon" aria-hidden="true">${ui.icon("send")}</span><span>Send</span></a>
        <a class="quick-action" href="airtime.html"><span class="quick-action__icon" aria-hidden="true">${ui.icon("airtime")}</span><span>Airtime</span></a>
        <a class="quick-action" href="bills.html?tab=data"><span class="quick-action__icon" aria-hidden="true">${ui.icon("data")}</span><span>Data</span></a>
        <a class="quick-action" href="bills.html"><span class="quick-action__icon" aria-hidden="true">${ui.icon("bills")}</span><span>Bills</span></a>
        <a class="quick-action" href="betting.html"><span class="quick-action__icon" aria-hidden="true">${ui.icon("betting")}</span><span>Betting</span></a>
        <a class="quick-action" href="savings.html"><span class="quick-action__icon" aria-hidden="true">${ui.icon("savings")}</span><span>Savings</span></a>
        <a class="quick-action" href="withdraw.html"><span class="quick-action__icon" aria-hidden="true">${ui.icon("bank")}</span><span>Cash out</span></a>
        <a class="quick-action" href="logistics.html"><span class="quick-action__icon" aria-hidden="true">${ui.icon("box")}</span><span>Dispatch</span></a>
        <a class="quick-action" href="ride.html"><span class="quick-action__icon" aria-hidden="true">${ui.icon("car")}</span><span>Rides</span></a>
        <a class="quick-action" href="wealth.html"><span class="quick-action__icon" aria-hidden="true">${ui.icon("wealth")}</span><span>Wealth</span></a>
      </div>`;

    const txHtml = txData.items
      .map((t) => {
        const typeIcons = {
          TRANSFER: "send",
          FUNDING: "funding",
          REVERSAL: "reverse",
          SAVINGS_DEPOSIT: "savings",
          AIRTIME: "airtime",
          BILLS: "bills",
          BETTING: "betting",
          WITHDRAWAL: "bank",
          BANK: "bank",
          DISPATCH: "box",
          RIDE: "car",
        };
        const icon = ui.icon(typeIcons[t.type] || "wallet");
        const { dir, sign } = ui.txDirection(t, w.id);
        return `
          <a class="tx-item" href="transaction.html?id=${encodeURIComponent(t.id)}">
            <div class="tx-item__icon" aria-hidden="true">${icon}</div>
            <div class="tx-item__main">
              <div class="tx-item__title">${ui.escapeHtml(t.narration || t.type)}</div>
              <div class="tx-item__meta">
                <span class="badge badge--${t.type}">${t.type}</span>
                <span class="badge badge--${t.status}">${t.status}</span>
              </div>
            </div>
            <div class="tx-item__right">
              <div class="tx-item__amount tx-item__amount--${dir.toLowerCase()}">${sign}${t.amountNgn}</div>
              <div class="tx-item__meta">${relativeTime(t.createdAt)}</div>
            </div>
          </a>`;
      })
      .join("");

    page.innerHTML = `
      <div class="page-title">Hi, ${ui.escapeHtml(profile.fullName?.split(" ")[0] || "there")}</div>
      <p class="page-sub">Here's what's happening with your money.</p>
      ${walletStatus}
      ${kycNotice}

      <div class="dashboard-top">
        <div class="balance-card">
          <div class="balance-card__top">
            <div class="balance-card__label">${ui.escapeHtml(w.currency)} Available balance</div>
            <span class="live-pill"><span class="live-dot"></span>Live</span>
          </div>
          <div class="balance-card__amount" data-balance>${ui.escapeHtml(w.balanceNgn)}</div>
          <div class="balance-card__foot" data-balance-updated>Status: ${ui.escapeHtml(w.status)} · Updated ${wallet?.updatedAt ? relativeTime(wallet.updatedAt) : "just now"}</div>
          <div class="balance-card__actions">
            <a class="btn btn--primary btn--small" href="send.html">${ui.icon("send")} Send money</a>
            <a class="btn btn--green btn--small" href="fund.html">${ui.icon("plus")} Add money</a>
            <button class="btn btn--ghost btn--small" type="button" data-copy-account>${ui.icon("copy")} Copy account</button>
          </div>
        </div>

        <section class="recent-card" aria-label="Recent transactions">
          <div class="recent-card__head">
            <h2>Recent transactions</h2>
            <a href="transactions.html">View all</a>
          </div>
          <div class="recent-card__chips" aria-label="Filter transaction history">
            <a class="chip" href="transactions.html?type=TRANSFER">Transfers</a>
            <a class="chip" href="transactions.html?type=AIRTIME">Airtime</a>
            <a class="chip" href="transactions.html?type=BILLS">Bills</a>
            <a class="chip" href="transactions.html?type=BETTING">Betting</a>
            <a class="chip" href="transactions.html?type=FUNDING">Top-ups</a>
          </div>
          ${txHtml
            ? `<div class="tx-list tx-list--compact">${txHtml}</div>`
            : `<div class="empty">No transactions yet — send some money to get started.</div>`}
        </section>
      </div>

      ${quickActions}

      ${goalsHtml(goals)}

      <div class="section-head">
        <h2>Market rates</h2>
        <button class="link-btn" type="button" data-refresh-market>${ui.icon("refresh")} Refresh</button>
      </div>
      <div id="market" class="market" aria-live="polite"></div>
    `;

    const txCount = page.querySelector("[data-tx-count]");
    if (txCount) txCount.textContent = String(txData.total);

    const copyBtn = page.querySelector("[data-copy-account]");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        navigator.clipboard?.writeText(profile.phone)
          .then(() => ui.toast("Phone number copied", "success"))
          .catch(() => ui.toast("Could not copy", "error"));
      });
    }

    const refreshBtn = page.querySelector("[data-refresh-market]");
    if (refreshBtn) refreshBtn.addEventListener("click", () => refreshMarket(true));

    wireGoalForm();
  }

  // ---- Savings actions -----------------------------------------------------

  function wireGoalForm() {
    const newGoalBtn = page.querySelector("[data-new-goal]");
    const formWrap = page.querySelector("[data-goal-form]");
    if (newGoalBtn && formWrap) {
      newGoalBtn.addEventListener("click", () => {
        formWrap.hidden = !formWrap.hidden;
      });
    }

    const cancelBtn = page.querySelector("[data-cancel-goal]");
    if (cancelBtn && formWrap) {
      cancelBtn.addEventListener("click", () => (formWrap.hidden = true));
    }

    const form = ui.$("#goal-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        ui.resetFormErrors(form);
        const naira = Number.parseInt(ui.$("#goal-target").value, 10);
        if (!Number.isSafeInteger(naira) || naira < 100) {
          ui.toast("Target must be at least ₦100", "error");
          return;
        }
        try {
          await api("/savings/goals", {
            method: "POST",
            body: {
              name: ui.$("#goal-name").value.trim(),
              targetAmountMinor: naira * 100,
              targetDate: ui.$("#goal-date").value || undefined,
            },
          });
          ui.toast("Savings goal created!", "success");
          formWrap.hidden = true;
          form.reset();
          refreshMoney();
        } catch (err) {
          ui.showFormErrors(form, err);
        }
      });
    }

    const listEl = page.querySelector("[data-goals-list]");
    if (listEl) {
      listEl.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-deposit]");
        if (btn) openDepositModal(btn.dataset.deposit);
      });
    }
  }

  async function openDepositModal(goalId) {
    const goalsData = await api("/savings/goals").catch(() => ({ goals: [] }));
    const goal = (goalsData.goals || []).find((g) => g.id === goalId);
    if (!goal) {
      ui.toast("Goal not found", "error");
      return;
    }

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="Add money to goal">
        <div class="modal__head">
          <h3>Add money</h3>
          <button class="modal__close" type="button" data-close aria-label="Close">${ui.icon("copy")}</button>
        </div>
        <p class="modal__sub">${ui.escapeHtml(goal.name)} · <strong>${goal.targetAmountNgn}</strong> target</p>
        <form id="deposit-form" novalidate>
          <div class="error-banner" role="alert"></div>
          <div class="field">
            <label class="field__label" for="dep-amount">Amount (₦, whole naira)</label>
            <input class="input" id="dep-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" maxlength="12" placeholder="e.g. 5000" required />
          </div>
          <div class="field">
            <label class="field__label" for="dep-pin">Confirm with your 6-digit PIN</label>
            <input class="input" id="dep-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="••••••" required />
          </div>
          <button class="btn btn--primary" type="submit">${ui.icon("savings")} Deposit</button>
        </form>
      </div>`;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelector("[data-close]").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });

    const pin = backdrop.querySelector("#dep-pin");
    pin.addEventListener("input", () => {
      pin.value = pin.value.replace(/\D/g, "").slice(0, 6);
    });
    ui.moneyInput(backdrop.querySelector("#dep-amount"));

    backdrop.querySelector("#deposit-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      ui.resetFormErrors(form);
      const naira = Number.parseInt(backdrop.querySelector("#dep-amount").value, 10);
      if (!Number.isSafeInteger(naira) || naira < 1) {
        ui.toast("Enter an amount of at least ₦1", "error");
        return;
      }
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = "Depositing…";
      try {
        await api(`/savings/goals/${goalId}/deposit`, {
          method: "POST",
          body: { amountMinor: naira * 100, pin: pin.value },
          headers: { "Idempotency-Key": idempotencyKey() },
        });
        close();
        ui.toast("Deposited into your goal!", "success");
        refreshMoney();
      } catch (err) {
        ui.showFormErrors(form, err);
        submit.disabled = false;
        submit.textContent = "Deposit";
      }
    });
  }

  // Refresh the money widgets after a savings create/deposit.
  async function refreshMoney() {
    const [goalsData, walletData] = await Promise.all([
      api("/savings/goals").catch(() => ({ goals: [] })),
      api("/wallet").catch(() => ({ wallet: null })),
    ]);
    const goals = goalsData.goals || [];
    const w = walletData.wallet;

    const balance = page.querySelector("[data-balance]");
    if (balance && w) balance.textContent = w.balanceNgn;
    const updated = page.querySelector("[data-balance-updated]");
    if (updated && w) updated.textContent = `Status: ${w.status} · Updated ${relativeTime(w.updatedAt)}`;

    const saved = goals.reduce((sum, g) => sum + (g.currentAmountMinor || 0), 0);
    const savedEl = page.querySelector("[data-saved]");
    if (savedEl) savedEl.textContent = ui.formatNgn(saved / 100);
    const countEl = page.querySelector("[data-goals-count]");
    if (countEl) countEl.textContent = String(goals.length);

    const listEl = page.querySelector("[data-goals-list]");
    if (listEl) {
      listEl.innerHTML = goals.length
        ? `<div class="goals">${goals.map(goalCard).join("")}</div>`
        : `<div class="empty">No savings goals yet — set one up and watch it grow.</div>`;
    }
  }

  // ---- Market widget --------------------------------------------------------

  function renderMarket(m) {
    const el = page.querySelector("#market");
    if (!el) return;

    const rates = m.rates || [];
    const crypto = m.crypto || [];

    if (!m.available && !rates.length && !crypto.length) {
      el.innerHTML = `
        <div class="market__status">
          <span class="live-dot live-dot--off"></span>
          Market feed unavailable — rates will reappear once the data source responds.
        </div>`;
      return;
    }

    const updated = m.updatedAt
      ? `· updated ${relativeTime(m.updatedAt)}`
      : "";
    const stale = m.stale ? `<span class="market__stale">showing cached rates</span>` : "";

    el.innerHTML = `
      <div class="market__head">
        <span class="live-pill live-pill--solid"><span class="live-dot"></span>LIVE</span>
        <span class="market__updated">${updated} ${stale}</span>
      </div>

      <div class="market__groups">
        ${rates.length ? `
          <div class="market__group">
            <div class="market__group-title">${ui.icon("trend", "ic--inline")} FX · Naira</div>
            <div class="rate-list">
              ${rates.map((r) => `
                <div class="rate-row">
                  <div class="rate-row__main">
                    <span class="rate-row__code">${ui.escapeHtml(r.code)}</span>
                    <span class="rate-row__name">${ui.escapeHtml(r.name)}</span>
                  </div>
                  <div class="rate-row__value">${pretty(r.rateNgn)}</div>
                </div>`).join("")}
            </div>
          </div>` : ""}

        ${crypto.length ? `
          <div class="market__group">
            <div class="market__group-title">₿ Crypto in Naira</div>
            <div class="rate-list">
              ${crypto.map((c) => `
                <div class="rate-row">
                  <div class="rate-row__main">
                    <span class="rate-row__code">${ui.escapeHtml(c.code)}</span>
                    <span class="rate-row__name">${ui.escapeHtml(c.name)}</span>
                  </div>
                  <div class="rate-row__right">
                    <div class="rate-row__value">${compact(c.priceNgn)}</div>
                    <div class="rate-row__change ${changeClass(c.change24hPct)}">${changeMark(c.change24hPct)} <span class="rate-row__change-label">24h</span></div>
                  </div>
                </div>`).join("")}
            </div>
          </div>` : ""}
      </div>
    `;
  }
})();