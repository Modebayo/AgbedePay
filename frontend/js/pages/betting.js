// betting page — pick a platform, fund an account with PIN. A fresh
// Idempotency-Key per submission means double-clicks can never double-charge.
// The optional "Verify" lookup shows whose account is being topped up.

(function () {
  "use strict";

  const { api, idempotencyKey } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const page = ui.$("#page");
  let selectedPlatform = null;
  let wallet = null;

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "betting");
    wallet = profile.wallet;

    if (!wallet || wallet.status !== "ACTIVE") {
      page.innerHTML = `<div class="error-banner error-banner--show" role="alert">Your wallet cannot fund betting accounts right now.</div>`;
      return;
    }

    try {
      const { platforms } = await api("/betting/providers");
      render(platforms);
    } catch (err) {
      page.innerHTML = `<div class="error-banner error-banner--show" role="alert">${ui.escapeHtml(err.message)}</div>`;
    }
  });

  function render(platforms) {
    page.innerHTML = `
      <form class="form card" id="betting-form" novalidate>
        <div class="error-banner" role="alert"></div>

        <div class="field">
          <label class="field__label">Betting platform</label>
          <div class="chip-grid" id="platform-grid">
            ${platforms
              .map(
                (p) =>
                  `<button class="chip" type="button" data-platform="${ui.escapeHtml(p.platform)}">
                     <span class="chip__dot" style="background:${ui.escapeHtml(p.accent)}" aria-hidden="true"></span>
                     ${ui.escapeHtml(p.label)}
                   </button>`
              )
              .join("")}
          </div>
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="bet-customer">Customer ID / username</label>
          <div class="field__row">
            <input class="input" id="bet-customer" name="customerId" type="text" autocomplete="off" maxlength="40" placeholder="e.g. Ade2391, 5001234567" required />
            <button class="btn btn--ghost" id="bet-lookup" type="button">Verify</button>
          </div>
          <p class="field__error"></p>
          <p class="betting-verified" data-verified hidden></p>
        </div>

        <div class="field">
          <label class="field__label" for="bet-amount">Amount (₦)</label>
          <input class="input" id="bet-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" maxlength="12" placeholder="e.g. 2000" required />
          <p class="field__error"></p>
          <p class="balance-hint" id="bet-hint"></p>
        </div>

        <div class="field">
          <label class="field__label" for="bet-pin">Confirm with your 6-digit PIN</label>
          <input class="input" id="bet-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="••••••" required />
          <p class="field__error"></p>
        </div>

        <button class="btn btn--green" id="bet-submit" type="submit">Fund account</button>
      </form>

      <div id="bet-success" hidden></div>

      <div class="section-head"><h2>Recent betting top-ups</h2></div>
      <div data-recent-betting></div>
    `;

    ui.$("#platform-grid").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-platform]");
      if (!btn) return;
      ui.$$("#platform-grid .chip").forEach((c) => c.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      selectedPlatform = JSON.parse(btn.dataset.platform);
      const cs = ui.$("#bet-customer");
      if (cs) cs.placeholder = `Your ${selectedPlatform.label} username`;
    });

    // data-platform holds the whole object so label/accent survive selection.
    ui.$$("#platform-grid .chip").forEach((btn) => {
      btn.dataset.platform = JSON.stringify(
        platforms.find((p) => p.platform === btn.dataset.platform)
      );
    });

    const amount = ui.$("#bet-amount");
    ui.moneyInput(amount);
    amount.addEventListener("input", () => {
      ui.balanceHint(ui.$("#bet-hint"), wallet.balanceMinor, Number.parseInt(amount.value, 10));
    });

    const pin = ui.$("#bet-pin");
    pin.addEventListener("input", () => {
      pin.value = pin.value.replace(/\D/g, "").slice(0, 6);
    });

    const lookupBtn = ui.$("#bet-lookup");
    lookupBtn.addEventListener("click", verifyAccount);
    ui.$("#bet-customer").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        verifyAccount();
      }
    });

    ui.$("#betting-form").addEventListener("submit", onSubmit);

    ui.loadRecentPurchases("BETTING", ui.$("#page [data-recent-betting]"));
  }

  async function verifyAccount() {
    const platform = platformCode();
    const customerId = customerIdValue();
    if (!platform) {
      ui.toast("Select a betting platform first", "error");
      return;
    }
    if (!customerId) {
      ui.toast("Enter your customer ID or username", "error");
      return;
    }
    const btn = ui.$("#bet-lookup");
    btn.disabled = true;
    btn.textContent = "Checking…";
    try {
      const data = await api("/betting/lookup", { method: "POST", body: { platform, customerId } });
      const v = ui.$("[data-verified]");
      v.hidden = false;
      v.innerHTML = `<strong>${ui.icon("check", "ic--inline")}</strong> ${ui.escapeHtml(data.name)} — ready to top up.`;
    } catch (err) {
      ui.toast(err.message || "Could not verify account", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Verify";
    }
  }

  function platformCode() {
    return selectedPlatform ? selectedPlatform.platform : null;
  }

  function customerIdValue() {
    return ui.$("#bet-customer").value.trim();
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = ui.$("#betting-form");
    ui.resetFormErrors(form);

    const platform = platformCode();
    if (!platform) {
      ui.toast("Select a betting platform first", "error");
      return;
    }

    const customerId = customerIdValue();
    const nairaAmount = Number.parseInt(ui.$("#bet-amount").value, 10);
    const pin = ui.$("#bet-pin").value;

    if (customerId.length < 2) {
      ui.toast("Enter your customer ID or username", "error");
      return;
    }
    if (!Number.isSafeInteger(nairaAmount) || nairaAmount < 1) {
      ui.toast("Enter a whole-naira amount of at least ₦1", "error");
      return;
    }
    if (nairaAmount * 100 > wallet.balanceMinor) {
      ui.toast("You don't have enough balance for this top-up", "error");
      return;
    }

    const submit = ui.$("#bet-submit");
    submit.disabled = true;
    submit.textContent = "Funding…";

    try {
      const data = await api("/betting/purchase", {
        method: "POST",
        body: {
          platform,
          customerId,
          amountMinor: nairaAmount * 100,
          pin,
        },
        headers: { "Idempotency-Key": idempotencyKey() },
      });

      ui.toast("Betting account funded", "success");
      showSuccess(data);
    } catch (err) {
      ui.showFormErrors(form, err);
    } finally {
      submit.disabled = false;
      submit.textContent = "Fund account";
    }
  }

  function showSuccess(data) {
    ui.$("#betting-form").hidden = true;
    const s = ui.$("#bet-success");
    s.hidden = false;
    s.innerHTML = `
      <div class="card">
        <div class="success-card">
          <div class="success-card__icon">${ui.icon("check")}</div>
          <div class="success-card__title">Top-up complete</div>
          <div class="success-card__amount">${ui.escapeHtml(data.amountNgn)} ${ui.escapeHtml(data.purchase.platform)}</div>
          <p class="success-card__sub">Funded ${ui.escapeHtml(data.purchase.customerId)}</p>
          <div class="token-box">
            <div class="token-box__label">Provider reference</div>
            <div class="token-box__value">${ui.escapeHtml(data.purchase.provider)}</div>
          </div>
          <p class="success-card__meta">New balance: ${ui.escapeHtml(data.balanceNgn)}</p>
          <a class="btn btn--primary btn--small" href="transaction.html?id=${encodeURIComponent(data.transactionId)}">View transaction</a>
          <button class="ghost-btn" type="button" onclick="location.reload()">Fund again</button>
        </div>
      </div>
      <div class="notice" style="margin-top:12px">
        <strong>Demo provider:</strong> this top-up is simulated — no account is credited. The wallet debit is real.
      </div>
    `;
    ui.loadRecentPurchases("BETTING", ui.$("#page [data-recent-betting]"));
  }
})();