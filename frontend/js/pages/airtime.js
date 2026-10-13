// airtime page — pick a network, pick an amount, pay with PIN. A fresh
// Idempotency-Key per submission means double-clicks can never double-charge.

(function () {
  "use strict";

  const { api, idempotencyKey } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const page = ui.$("#page");
  let selectedNetwork = null;
  let wallet = null;

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "airtime");
    wallet = profile.wallet;

    if (!wallet || wallet.status !== "ACTIVE") {
      page.innerHTML = `<div class="error-banner error-banner--show" role="alert">Your wallet cannot buy airtime right now.</div>`;
      return;
    }

    try {
      const { networks } = await api("/airtime/providers");
      render(networks);
    } catch (err) {
      page.innerHTML = `<div class="error-banner error-banner--show" role="alert">${ui.escapeHtml(err.message)}</div>`;
    }
  });

  function render(networks) {
    page.innerHTML = `
      <form class="form card" id="airtime-form" novalidate>
        <div class="error-banner" role="alert"></div>

        <div class="field">
          <label class="field__label">Network</label>
          <div class="chip-grid" id="network-grid">
            ${networks
              .map(
                (n) =>
                  `<button class="chip" type="button" data-network="${ui.escapeHtml(n.network)}">${ui.escapeHtml(n.label)}</button>`
              )
              .join("")}
          </div>
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="air-phone">Phone number to top up</label>
          <input class="input" id="air-phone" name="phone" type="tel" inputmode="numeric" maxlength="11" placeholder="e.g. 08098765432" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="air-amount">Amount (₦)</label>
          <input class="input" id="air-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" maxlength="12" placeholder="e.g. 1000" required />
          <p class="field__error"></p>
          <p class="balance-hint" id="air-hint"></p>
        </div>

        <div class="field">
          <label class="field__label" for="air-pin">Confirm with your 6-digit PIN</label>
          <input class="input" id="air-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="••••••" required />
          <p class="field__error"></p>
        </div>

        <button class="btn btn--green" id="air-submit" type="submit">Buy airtime</button>
      </form>

      <div id="air-success" hidden></div>

      <div class="section-head"><h2>Recent airtime</h2></div>
      <div data-recent-airtime></div>
    `;

    ui.$("#network-grid").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-network]");
      if (!btn) return;
      ui.$$("#network-grid .chip").forEach((c) => c.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      selectedNetwork = btn.dataset.network;
    });

    const amount = ui.$("#air-amount");
    ui.moneyInput(amount);
    amount.addEventListener("input", () => {
      ui.balanceHint(ui.$("#air-hint"), wallet.balanceMinor, Number.parseInt(amount.value, 10));
    });

    const pin = ui.$("#air-pin");
    pin.addEventListener("input", () => {
      pin.value = pin.value.replace(/\D/g, "").slice(0, 6);
    });

    ui.$("#airtime-form").addEventListener("submit", onSubmit);

    ui.loadRecentPurchases("AIRTIME", ui.$("#page [data-recent-airtime]"));
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = ui.$("#airtime-form");
    ui.resetFormErrors(form);

    if (!selectedNetwork) {
      ui.toast("Select a network first", "error");
      return;
    }

    const nairaAmount = Number.parseInt(ui.$("#air-amount").value, 10);
    const phone = ui.$("#air-phone").value.replace(/\D/g, "");
    const pin = ui.$("#air-pin").value;

    if (!Number.isSafeInteger(nairaAmount) || nairaAmount < 1) {
      ui.toast("Enter a whole-naira amount of at least ₦1", "error");
      return;
    }
    if (!/^0?[789][01]\d{8}$/.test(phone)) {
      ui.toast("Enter a valid Nigerian phone number", "error");
      return;
    }
    if (nairaAmount * 100 > wallet.balanceMinor) {
      ui.toast("You don't have enough balance for this top-up", "error");
      return;
    }

    const submit = ui.$("#air-submit");
    submit.disabled = true;
    submit.textContent = "Purchasing…";

    try {
      const data = await api("/airtime/purchase", {
        method: "POST",
        body: {
          network: selectedNetwork,
          phone,
          amountMinor: nairaAmount * 100,
          pin,
        },
        headers: { "Idempotency-Key": idempotencyKey() },
      });

      ui.toast("Airtime purchased", "success");
      showSuccess(data);
    } catch (err) {
      ui.showFormErrors(form, err);
    } finally {
      submit.disabled = false;
      submit.textContent = "Buy airtime";
    }
  }

  function showSuccess(data) {
    ui.$("#airtime-form").hidden = true;
    const s = ui.$("#air-success");
    s.hidden = false;
    s.innerHTML = `
      <div class="card">
        <div class="success-card">
          <div class="success-card__icon">${ui.icon("check")}</div>
          <div class="success-card__title">Top-up complete</div>
          <div class="success-card__amount">${ui.escapeHtml(data.amountNgn)} ${ui.escapeHtml(data.purchase.network)}</div>
          <p class="success-card__sub">Sent to ${ui.escapeHtml(data.purchase.phone)}</p>
          <div class="token-box">
            <div class="token-box__label">Provider reference</div>
            <div class="token-box__value">${ui.escapeHtml(data.purchase.provider)}</div>
          </div>
          <p class="success-card__meta">New balance: ${ui.escapeHtml(data.balanceNgn)}</p>
          <a class="btn btn--primary btn--small" href="transaction.html?id=${encodeURIComponent(data.transactionId)}">View transaction</a>
          <button class="ghost-btn" type="button" onclick="location.reload()">Buy again</button>
        </div>
      </div>
      <div class="notice" style="margin-top:12px">
        <strong>Demo provider:</strong> this top-up is simulated — no airtime reaches the number. The wallet debit is real.
      </div>
    `;
    ui.loadRecentPurchases("AIRTIME", ui.$("#page [data-recent-airtime]"));
  }
})();