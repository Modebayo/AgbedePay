// fund page — money IN. Amount is entered in NAIRA and converted to KOBO for
// the backend (which only ever works in integer kobo). Success replaces the
// form with a receipt; the balance shown comes fresh from the API.

(function () {
  "use strict";

  const { api, idempotencyKey } = window.AgbeAPI;
  const ui = window.AgbeUI;

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "home");

    const w = profile.wallet;
    if (!w || w.status !== "ACTIVE") {
      const form = ui.$("#fund-form");
      if (form) form.outerHTML = `<div class="error-banner error-banner--show" role="alert">Your wallet cannot accept a top-up right now. Please contact support.</div>`;
      return;
    }

    const amount = ui.$("#amount");
    const preview = ui.$("#preview");
    const form = ui.$("#fund-form");
    const submit = ui.$("#fund-submit");

    ui.moneyInput(amount);
    const refreshAmount = () => {
      const v = Number.parseInt(amount.value, 10);
      preview.textContent =
        v > 0
          ? `New balance after top-up: ${ui.formatNgn((w.balanceMinor + v * 100) / 100)}.`
          : "";
    };
    amount.addEventListener("input", refreshAmount);

    ui.$$(".amount-chips .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        amount.value = chip.dataset.amount;
        refreshAmount();
      });
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      ui.resetFormErrors(form);

      const nairaAmount = Number.parseInt(amount.value, 10);
      if (!Number.isSafeInteger(nairaAmount) || nairaAmount < 1) {
        ui.toast("Enter a whole-naira amount of at least ₦1", "error");
        return;
      }

      submit.disabled = true;
      submit.textContent = "Processing…";
      const key = idempotencyKey();

      try {
        const data = await api("/wallet/fund", {
          method: "POST",
          body: { amountMinor: nairaAmount * 100 },
          headers: { "Idempotency-Key": key },
        });

        form.outerHTML = `
          <div class="success card" role="status">
            <span class="success__icon" aria-hidden="true">${ui.icon("check")}</span>
            <h2 class="success__title">Money added!</h2>
            <p class="success__text">
              ${ui.escapeHtml(data.funding.amountNgn)} has been credited to your wallet.
              ${data.replayed ? "This top-up was already processed." : ""}
            </p>
            <div class="success__meta">
              <span>Reference</span>
              <strong>${ui.escapeHtml(data.funding.reference)}</strong>
            </div>
            <div class="success__meta">
              <span>New balance</span>
              <strong>${ui.escapeHtml(data.balanceNgn)}</strong>
            </div>
            <div class="success__actions">
              <a class="btn btn--primary" href="transaction.html?id=${encodeURIComponent(data.transaction.id)}">${ui.icon("wallet")} View receipt</a>
              <button class="btn btn--ghost" type="button" data-again>${ui.icon("plus")} Add more</button>
            </div>
          </div>`;

        const again = ui.$("[data-again]");
        if (again) again.addEventListener("click", () => window.location.reload());
      } catch (err) {
        ui.showFormErrors(form, err);
      } finally {
        submit.disabled = false;
        submit.textContent = "Add money";
      }
    });
  });
})();