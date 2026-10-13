// withdraw page — manage linked bank accounts and cash out to them.
// Money leaves the wallet only with a PIN + idempotency key (single debit,
// replay-safe). Amounts typed in naira, sent as kobo.

(function () {
  "use strict";

  const { api, idempotencyKey } = window.AgbeAPI;
  const ui = window.AgbeUI;
  const page = ui.$("#page");
  const state = { wallet: null, accounts: [], banks: [] };

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "withdraw");
    state.wallet = profile.wallet;
    state.banks = (await api("/withdraw/bases").catch(() => ({ banks: [] }))).banks;
    await loadAccounts();
    render();

    // Cash-out unlocks with bio data and its ceiling comes from the KYC tier.
    api("/kyc/limits")
      .then(({ limits }) => {
        const form = ui.$("#withdraw-form");
        if (!form || !form.parentNode) return;
        const hint = document.createElement("div");
        hint.className = "limit-hint";
        hint.innerHTML = limits.withdrawAllowed
          ? `<span class="limit-hint__tier">${ui.escapeHtml(limits.tier)}</span>
             <span>${ui.escapeHtml(limits.usedToday.withdrawRemainingNgn)} left of ${ui.escapeHtml(limits.withdrawDailyNgn)} cash-out today</span>`
          : `<span class="limit-hint__tier">${ui.escapeHtml(limits.tier)}</span>
             <span>Cash-out is locked — ${ui.escapeHtml(limits.nextLabel.toLowerCase())} to unlock it.</span>`;
        form.parentNode.insertBefore(hint, form);
      })
      .catch(() => {});
  });

  async function loadAccounts() {
    state.accounts = (await api("/withdraw/accounts").catch(() => ({ accounts: [] }))).accounts;
    render();
  }

  function masked(a) {
    return `${a.bankName} ·••${a.accountNumber.slice(-4)}`;
  }

  function render() {
    if (!state.wallet || state.wallet.status !== "ACTIVE") {
      page.innerHTML = `<div class="error-banner error-banner--show" role="alert">Your wallet cannot cash out right now.</div>`;
      return;
    }

    const w = state.wallet;
    const bankOptions = state.banks
      .map((b) => `<option value="${ui.escapeHtml(b)}">${ui.escapeHtml(b)}</option>`)
      .join("");
    const accountOptions = state.accounts
      .map((a) => `<option value="${ui.escapeHtml(a.id)}">${ui.escapeHtml(masked(a))}</option>`)
      .join("");

    page.innerHTML = `
      <div class="section-head"><h2>Cash out to your bank</h2></div>
      <p class="page-sub">Withdraw from your AgbedePay wallet to a linked bank account.</p>

      <div class="balance-card" style="margin-top:0;margin-bottom:18px">
        <div class="balance-card__top">
          <div class="balance-card__label">Available balance</div>
          <span class="live-pill"><span class="live-dot"></span>Live</span>
        </div>
        <div class="balance-card__amount" data-balance>${ui.escapeHtml(w.balanceNgn)}</div>
      </div>

      <form class="form card" id="withdraw-form" novalidate>
        <div class="error-banner" role="alert"></div>

        <div class="field">
          <label class="field__label" for="wd-account">Sent to</label>
          ${
            state.accounts.length
              ? `<select class="input" id="wd-account" name="accountId" required>
                   <option value="">Select a bank account…</option>
                   ${accountOptions}
                 </select>`
              : `<div class="empty empty--compact">Link a bank account below first so you have somewhere to cash out to.</div>`
          }
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="wd-amount">Amount (₦, whole naira)</label>
          <input class="input" id="wd-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" maxlength="12" placeholder="e.g. 5000" required />
          <p class="field__error"></p>
        </div>
        <p class="field__hint" data-preview style="display:none"></p>

        <div class="field">
          <label class="field__label" for="wd-pin">Confirm with your 6-digit PIN</label>
          <input class="input" id="wd-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="••••••" required />
          <p class="field__error"></p>
        </div>

        <button class="btn btn--green" id="withdraw-submit" type="submit" ${state.accounts.length ? "" : "disabled"}>${ui.icon("bank")} Cash out</button>
      </form>

      ${
        state.accounts.length
          ? `<div class="card" style="margin-top:18px;padding:14px 16px">
               <div class="section-head" style="margin:0 0 6px"><h2>Your linked accounts</h2></div>
               <ul class="account-list">
                 ${state.accounts
                   .map(
                     (a) => `
                       <li class="account-chip">
                         <span class="account-chip__icon" aria-hidden="true">${ui.icon("bank")}</span>
                         <span class="account-chip__main">
                           <span class="account-chip__name">${ui.escapeHtml(a.accountName)}</span>
                           <span class="account-chip__num">${ui.escapeHtml(masked(a))}</span>
                         </span>
                         <button class="link-btn account-chip__remove" type="button" data-remove="${ui.escapeHtml(a.id)}" style="color:var(--danger)">Remove</button>
                       </li>`
                   )
                   .join("")}
               </ul>
             </div>`
          : ""
      }

      ${state.accounts.length >= 5 ? "" : `
      <form class="form card" id="account-form" style="margin-top:18px" novalidate>
        <div class="section-head"><h2>Link a bank account</h2></div>
        <div class="error-banner" role="alert"></div>

        <div class="field">
          <label class="field__label" for="ba-bank">Bank</label>
          <select class="input" id="ba-bank" name="bankName" required>${bankOptions}</select>
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="ba-number">Account number</label>
          <input class="input" id="ba-number" name="accountNumber" type="tel" inputmode="numeric" maxlength="10" placeholder="10 digits" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="ba-name">Account name</label>
          <input class="input" id="ba-name" name="accountName" type="text" maxlength="120" placeholder="Name on the account" required />
          <p class="field__error"></p>
        </div>

        <button class="btn btn--primary" id="account-submit" type="submit">${ui.icon("plus")} Link account</button>
      </form>`}
    `;

    wireWithdrawForm();
    wireAccountForm();
    wireRemovals();
    if (state.accounts.length) wirePreview();
  }

  function wirePreview() {
    const amount = ui.$("#wd-amount");
    const preview = ui.$("[data-preview]");
    if (!amount || !preview) return;
    ui.moneyInput(amount);
    amount.addEventListener("input", () => {
      const v = Number.parseInt(amount.value, 10);
      if (v > 0) {
        preview.style.display = "block";
        preview.textContent = `You'll receive ${ui.formatNgn(v)}. Your new balance: ${ui.formatNgn((state.wallet.balanceMinor - v * 100) / 100)}.`;
        preview.style.color = v * 100 > state.wallet.balanceMinor ? "var(--danger)" : "var(--muted)";
      } else {
        preview.style.display = "none";
      }
    });
  }

  function wireWithdrawForm() {
    const form = ui.$("#withdraw-form");
    if (!form || !state.accounts.length) return;
    const submit = ui.$("#withdraw-submit");
    const pin = ui.$("#wd-pin");
    pin.addEventListener("input", () => (pin.value = pin.value.replace(/\D/g, "").slice(0, 6)));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      ui.resetFormErrors(form);

      const naira = Number.parseInt(ui.$("#wd-amount").value, 10);
      const accountId = ui.$("#wd-account").value;
      if (!Number.isSafeInteger(naira) || naira < 1) {
        ui.toast("Enter a whole-naira amount of at least ₦1", "error");
        return;
      }
      if (naira * 100 > state.wallet.balanceMinor) {
        ui.toast("You don't have enough balance for this cash-out", "error");
        return;
      }

      submit.disabled = true;
      submit.textContent = "Processing…";

      try {
        const { withdrawal, balanceNgn } = await api("/withdraw", {
          method: "POST",
          body: { accountId, amountMinor: naira * 100, pin: pin.value },
          headers: { "Idempotency-Key": idempotencyKey() },
        });
        ui.toast("Cash-out sent for processing", "success");
        state.wallet.balanceMinor = Number(withdrawal.amountMinor) > 0 ? state.wallet.balanceMinor - naira * 100 : state.wallet.balanceMinor;
        const bal = document.querySelector("[data-balance]");
        if (bal) bal.textContent = ui.escapeHtml(balanceNgn || state.wallet.balanceNgn);
        form.outerHTML = `
          <div class="success-card card">
            <div class="success-card__icon" aria-hidden="true">${ui.icon("check")}</div>
            <h3>Cash-out initiated</h3>
            <p>${ui.escapeHtml(withdrawal.reference)} — ${ui.escapeHtml(balanceNgn)}</p>
            <a class="btn btn--green btn--block" href="transaction.html?id=${encodeURIComponent(withdrawal.id)}">View transaction</a>
            <button class="btn btn--ghost btn--block" type="button" data-more style="margin-top:8px">Cash out again</button>
          </div>`;
        form.querySelector("[data-more]").addEventListener("click", () => window.location.reload());
      } catch (err) {
        ui.showFormErrors(form, err);
        submit.disabled = false;
        submit.textContent = "Cash out";
      }
    });
  }

  function wireAccountForm() {
    const form = ui.$("#account-form");
    if (!form) return;
    const number = ui.$("#ba-number");
    number.addEventListener("input", () => (number.value = number.value.replace(/\D/g, "").slice(0, 10)));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      ui.resetFormErrors(form);
      const payload = {
        bankName: ui.$("#ba-bank").value,
        accountNumber: number.value,
        accountName: ui.$("#ba-name").value.trim(),
      };
      try {
        await api("/withdraw/accounts", { method: "POST", body: payload });
        ui.toast("Bank account linked", "success");
        await loadAccounts();
      } catch (err) {
        ui.showFormErrors(form, err);
      }
    });
  }

  function wireRemovals() {
    page.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this bank account?")) return;
        await api(`/withdraw/accounts/${btn.dataset.remove}`, { method: "DELETE" }).catch((err) => ui.toast(err.message, "error"));
        await loadAccounts();
      });
    });
  }
})();