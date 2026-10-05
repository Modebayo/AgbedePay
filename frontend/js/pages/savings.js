// savings — dedicated page for savings goals.
// Same backend as the Home widgets (GET/POST /savings/goals, POST /goals/:id/deposit),
// presented as its own destination so the Savings nav link has somewhere real to go.
// Balances come from the backend only — nothing money-related is computed here.

(function () {
  "use strict";

  const { api, idempotencyKey } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const page = ui.$("#page");

  let wallet = null;

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "savings");
    wallet = profile.wallet || null;

    const goalsData = await api("/savings/goals").catch(() => ({ goals: [] }));
    render(profile, goalsData.goals || []);
  });

  // ---- Formatting helpers -------------------------------------------------

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
        ${g.status === "ACTIVE" ? `
        <div class="goal-card__actions">
          <button class="goal-card__add" type="button" data-deposit="${g.id}">${ui.icon("plus")} Add money</button>
          ${g.currentAmountMinor > 0 ? `<button class="goal-card__add goal-card__add--ghost" type="button" data-withdraw="${g.id}">${ui.icon("send")} Withdraw</button>` : ""}
        </div>` : ""}
      </div>`;
  }

  function goalsListHtml(goals) {
    return goals.length
      ? `<div class="goals">${goals.map(goalCard).join("")}</div>`
      : `<div class="empty">No savings goals yet — set one up and watch it grow.</div>`;
  }

  function statsHtml(goals) {
    const totalSavedMinor = goals.reduce((sum, g) => sum + (g.currentAmountMinor || 0), 0);
    const activeCount = goals.filter((g) => g.status === "ACTIVE").length;
    return `
      <div class="stats-dash" data-savings-stats>
        <div class="stat-card">
          <div class="stat-card__label">Total saved</div>
          <div class="stat-card__value" data-saved>${ui.escapeHtml(ui.formatNgn(totalSavedMinor))}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Active goals</div>
          <div class="stat-card__value" data-active-count>${activeCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Wallet balance</div>
          <div class="stat-card__value" data-wallet-balance>${ui.escapeHtml(wallet?.balanceNgn || "—")}</div>
        </div>
      </div>`;
  }

  // ---- Page ----------------------------------------------------------------

  function render(profile, goals) {
    page.innerHTML = `
      <div class="page-title">Savings</div>
      <p class="page-sub">Set a goal, feed it, and watch it grow — every naira stays yours.</p>

      <div class="balance-card">
        <div class="balance-card__top">
          <div class="balance-card__label">Total saved across goals</div>
          <span class="live-pill"><span class="live-dot"></span>Live</span>
        </div>
        <div class="balance-card__amount" data-total-saved>${ui.escapeHtml(
          ui.formatNgn(goals.reduce((sum, g) => sum + (g.currentAmountMinor || 0), 0))
        )}</div>
        <div class="balance-card__foot" data-total-foot>${goals.length} goal${goals.length === 1 ? "" : "s"} · ${goals.filter((g) => g.status === "ACTIVE").length} active</div>
        <div class="balance-card__actions">
          <button class="btn btn--green btn--small" type="button" data-new-goal>${ui.icon("plus")} New goal</button>
          <a class="btn btn--primary btn--small" href="send.html">${ui.icon("send")} Move money</a>
        </div>
      </div>

      <div class="notice"><strong>AutoSave is on the way.</strong>Purchases will round up straight into your goals — for now, add money to a goal in one tap below.</div>

      <div class="section-head">
        <h2>Savings goals</h2>
        <div class="section-head__actions">
          ${goals.length ? `<span class="badge badge--SUCCESS">${goals.length} active</span>` : ""}
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
        ${goalsListHtml(goals)}
      </div>

      ${statsHtml(goals)}
    `;

    wireGoalForm();
  }

  // ---- Actions --------------------------------------------------------------

  function wireGoalForm() {
    const formWrap = page.querySelector("[data-goal-form]");
    page.querySelectorAll("[data-new-goal]").forEach((btn) =>
      btn.addEventListener("click", () => {
        formWrap.hidden = !formWrap.hidden;
      })
    );

    const cancelBtn = page.querySelector("[data-cancel-goal]");
    if (cancelBtn) cancelBtn.addEventListener("click", () => (formWrap.hidden = true));

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
          await refresh();
        } catch (err) {
          ui.showFormErrors(form, err);
        }
      });
    }

    const listEl = page.querySelector("[data-goals-list]");
    if (listEl) {
      listEl.addEventListener("click", (e) => {
        const depositBtn = e.target.closest("[data-deposit]");
        if (depositBtn) return openDepositModal(depositBtn.dataset.deposit);
        const withdrawBtn = e.target.closest("[data-withdraw]");
        if (withdrawBtn) return openWithdrawModal(withdrawBtn.dataset.withdraw);
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
            <input class="input" id="dep-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" placeholder="e.g. 5000" required />
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
        await refresh();
      } catch (err) {
        ui.showFormErrors(form, err);
        submit.disabled = false;
        submit.textContent = "Deposit";
      }
    });
  }

  async function openWithdrawModal(goalId) {
    const goalsData = await api("/savings/goals").catch(() => ({ goals: [] }));
    const goal = (goalsData.goals || []).find((g) => g.id === goalId);
    if (!goal) {
      ui.toast("Goal not found", "error");
      return;
    }
    if (goal.currentAmountMinor <= 0) {
      ui.toast("There's nothing saved in this goal yet", "error");
      return;
    }

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="Withdraw from goal">
        <div class="modal__head">
          <h3>Withdraw to your wallet</h3>
          <button class="modal__close" type="button" data-close aria-label="Close">${ui.icon("copy")}</button>
        </div>
        <p class="modal__sub">${ui.escapeHtml(goal.name)} · <strong>${goal.currentAmountNgn}</strong> saved</p>
        <form id="withdraw-form" novalidate>
          <div class="error-banner" role="alert"></div>
          <div class="field">
            <label class="field__label" for="wd-amount">Amount (₦, whole naira)</label>
            <input class="input" id="wd-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" max="${goal.currentAmountMinor / 100}" placeholder="e.g. 3000" required />
            <p class="field__error"></p>
          </div>
          <div class="field">
            <label class="field__label" for="wd-pin">Confirm with your 6-digit PIN</label>
            <input class="input" id="wd-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="••••••" required />
            <p class="field__error"></p>
          </div>
          <button class="btn btn--primary" type="submit">${ui.icon("send")} Withdraw to wallet</button>
        </form>
      </div>`;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelector("[data-close]").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });

    const pin = backdrop.querySelector("#wd-pin");
    pin.addEventListener("input", () => {
      pin.value = pin.value.replace(/\D/g, "").slice(0, 6);
    });

    backdrop.querySelector("#withdraw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      ui.resetFormErrors(form);
      const naira = Number.parseInt(backdrop.querySelector("#wd-amount").value, 10);
      if (!Number.isSafeInteger(naira) || naira < 1) {
        ui.toast("Enter an amount of at least ₦1", "error");
        return;
      }
      if (naira * 100 > goal.currentAmountMinor) {
        ui.toast(`You can withdraw at most ${goal.currentAmountNgn}`, "error");
        return;
      }
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = "Withdrawing…";
      try {
        await api(`/savings/goals/${goalId}/withdraw`, {
          method: "POST",
          body: { amountMinor: naira * 100, pin: pin.value },
          headers: { "Idempotency-Key": idempotencyKey() },
        });
        close();
        ui.toast("Withdrawn to your wallet", "success");
        await refresh();
      } catch (err) {
        ui.showFormErrors(form, err);
        submit.disabled = false;
        submit.textContent = "Withdraw to wallet";
      }
    });
  }

  // Refresh everything on the page after a create/deposit.
  async function refresh() {
    const [goalsData, walletData] = await Promise.all([
      api("/savings/goals").catch(() => ({ goals: [] })),
      api("/wallet").catch(() => ({ wallet: null })),
    ]);
    const goals = goalsData.goals || [];
    if (walletData.wallet) wallet = walletData.wallet;

    const total = goals.reduce((sum, g) => sum + (g.currentAmountMinor || 0), 0);
    const activeCount = goals.filter((g) => g.status === "ACTIVE").length;

    const totalEl = page.querySelector("[data-total-saved]");
    if (totalEl) totalEl.textContent = ui.formatNgn(total);
    const footEl = page.querySelector("[data-total-foot]");
    if (footEl) footEl.textContent = `${goals.length} goal${goals.length === 1 ? "" : "s"} · ${activeCount} active`;

    const listEl = page.querySelector("[data-goals-list]");
    if (listEl) listEl.innerHTML = goalsListHtml(goals);

    const savedEl = page.querySelector("[data-saved]");
    if (savedEl) savedEl.textContent = ui.formatNgn(total);
    const activeEl = page.querySelector("[data-active-count]");
    if (activeEl) activeEl.textContent = String(activeCount);
    const balEl = page.querySelector("[data-wallet-balance]");
    if (balEl && wallet) balEl.textContent = wallet.balanceNgn;
  }
})();