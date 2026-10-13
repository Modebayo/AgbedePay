// withdraw page — cash OUT of the wallet. Two methods share one real debit:
//   • Bank account — cash out to a linked bank (PAYOUT account).
//   • Cash agent   — a demo agent-pickup rail. The app links a per-user agent
//     destination on first use (kind = AGENT, so it never clutters the saved
//     bank list) and then performs the SAME real wallet debit, returning a
//     collection code to show at the agent outlet.
// Money always leaves the wallet with a PIN + idempotency key (single debit,
// replay-safe). Amounts typed in naira, sent as kobo.

(function () {
  "use strict";

  const { api, idempotencyKey } = window.AgbeAPI;
  const ui = window.AgbeUI;
  const page = ui.$("#page");
  const state = { profile: null, wallet: null, accounts: [], banks: [], agents: [], activeMethod: "bank", agent: null };

  // Deterministic per-user digits: an agent destination must not drift between
  // visits, or each cash-out would link a brand-new account. FNV-1a + xorshift.
  function deterministicDigits(seed, length) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let out = "";
    for (let i = 0; i < length; i += 1) {
      h ^= h << 13; h >>>= 0;
      h ^= h >>> 17;
      h ^= h << 5; h >>>= 0;
      out += String(h % 10);
    }
    return out;
  }

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "withdraw");
    state.profile = profile;
    state.wallet = profile.wallet;

    const bases = await api("/withdraw/bases").catch(() => ({ banks: [], agentNetworks: [] }));
    state.banks = bases.banks || [];
    state.agents = bases.agentNetworks || [];
    await loadAccounts();

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
      <div class="section-head"><h2>Cash out</h2></div>
      <p class="page-sub">Move money out to your bank, or collect cash from an agent.</p>

      <div class="balance-card" style="margin-top:0;margin-bottom:18px">
        <div class="balance-card__top">
          <div class="balance-card__label">Available balance</div>
          <span class="live-pill"><span class="live-dot"></span>Live</span>
        </div>
        <div class="balance-card__amount" data-balance>${ui.escapeHtml(w.balanceNgn)}</div>
      </div>

      <div class="method-tabs method-tabs--two" role="tablist" aria-label="Cash-out method">
        <button class="method-tab is-active" type="button" role="tab" aria-selected="true" data-method="bank" data-icon="bank">
          <span class="method-tab__ic" aria-hidden="true"></span><span class="method-tab__txt">Bank account</span>
        </button>
        <button class="method-tab" type="button" role="tab" aria-selected="false" data-method="agent" data-icon="headset">
          <span class="method-tab__ic" aria-hidden="true"></span><span class="method-tab__txt">Cash agent</span>
        </button>
      </div>

      <form class="form card" id="withdraw-form" novalidate>
        <div class="error-banner" role="alert"></div>

        <div class="method-panel" data-panel="bank">
          <div class="field">
            <label class="field__label" for="wd-account">Sent to</label>
            ${
              state.accounts.length
                ? `<div class="bank-pick">
                     ${ui.bankBadge(state.accounts[0].bankName, { id: "wd-account-badge", className: "bank-badge--lg" })}
                     <select class="input" id="wd-account" name="accountId" required>
                       <option value="">Select a bank account…</option>
                       ${accountOptions}
                     </select>
                   </div>`
                : `<div class="empty empty--compact">Link a bank account below first so you have somewhere to cash out to.</div>`
            }
            <p class="field__error"></p>
          </div>
        </div>

        <div class="method-panel" data-panel="agent" hidden>
          <p class="field__label method-panel__lead">Choose a cash agent near you</p>
          <div class="agent-grid" id="agent-networks"></div>
          <p class="fund-note">
            Demo cash pickup: your wallet is debited for real and you get a collection
            code to show at any <strong id="agent-network-name">agent</strong> outlet.
          </p>
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

        <button class="btn btn--green" id="withdraw-submit" type="submit">${ui.icon("withdraw")} Cash out</button>
      </form>

      <div class="method-panel" data-panel="bank">
        ${
          state.accounts.length
            ? `<div class="card" style="margin-top:18px;padding:14px 16px">
                 <div class="section-head" style="margin:0 0 6px"><h2>Your linked accounts</h2></div>
                 <ul class="account-list">
                   ${state.accounts
                     .map(
                       (a) => `
                         <li class="account-chip">
                           ${ui.bankBadge(a.bankName, { className: "bank-badge--lg" })}
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
            <div class="bank-pick">
              ${ui.bankBadge(state.banks[0] || "Bank", { id: "ba-bank-badge", className: "bank-badge--lg" })}
              <select class="input" id="ba-bank" name="bankName" required>${bankOptions}</select>
            </div>
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
      </div>
    `;

    fillIcons();
    renderAgentGrid();
    wireWithdrawForm();
    wireAccountForm();
    wireRemovals();
    wirePreview();
  }

  function fillIcons() {
    ui.$$(".method-tab").forEach((tab) => {
      const box = tab.querySelector(".method-tab__ic");
      if (box) box.innerHTML = ui.icon(tab.dataset.icon);
    });
  }

  // ---- method tabs -------------------------------------------------------

  function setMethod(method) {
    if (method !== "bank" && method !== "agent") method = "bank";
    state.activeMethod = method;
    ui.$$(".method-tab").forEach((t) => {
      const on = t.dataset.method === method;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    ui.$$("[data-panel]", page).forEach((p) => { p.hidden = p.dataset.panel !== method; });
    const submit = ui.$("#withdraw-submit");
    if (submit) submit.innerHTML = method === "agent" ? `${ui.icon("headset")} Collect cash` : `${ui.icon("withdraw")} Cash out`;
  }

  function bindTabs() {
    ui.$$(".method-tab").forEach((tab) => {
      tab.addEventListener("click", () => setMethod(tab.dataset.method));
    });
  }

  // ---- cash agent grid ---------------------------------------------------

  function renderAgentGrid() {
    const box = ui.$("#agent-networks");
    if (!box) return;
    if (!state.agents.length) {
      box.innerHTML = `<div class="empty empty--compact">Agent payouts are unavailable right now.</div>`;
      return;
    }
    if (!state.agent) state.agent = state.agents[0];
    box.innerHTML = state.agents
      .map(
        (name) => `
          <button class="agent-chip${name === state.agent ? " is-active" : ""}" type="button" data-agent="${ui.escapeHtml(name)}" aria-pressed="${name === state.agent}">
            ${ui.bankBadge(name, { className: "bank-badge--lg" })}
            <span class="agent-chip__name">${ui.escapeHtml(name)}</span>
          </button>`
      )
      .join("");
    const label = ui.$("#agent-network-name");
    if (label) label.textContent = state.agent;
    box.querySelectorAll("[data-agent]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.agent = btn.dataset.agent;
        box.querySelectorAll("[data-agent]").forEach((b) => {
          const on = b.dataset.agent === state.agent;
          b.classList.toggle("is-active", on);
          b.setAttribute("aria-pressed", String(on));
        });
        if (label) label.textContent = state.agent;
      });
    });
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
    if (!form) return;
    bindTabs();
    setMethod(state.activeMethod);
    const submit = ui.$("#withdraw-submit");
    const pin = ui.$("#wd-pin");
    const accountSelect = ui.$("#wd-account");
    pin.addEventListener("input", () => (pin.value = pin.value.replace(/\D/g, "").slice(0, 6)));

    if (accountSelect) {
      accountSelect.addEventListener("change", () => {
        const chosen = state.accounts.find((a) => a.id === accountSelect.value);
        const badge = ui.$("#wd-account-badge");
        if (badge && chosen) {
          const style = ui.bankStyle(chosen.bankName);
          badge.textContent = style.short;
          badge.style.background = style.color;
        }
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      ui.resetFormErrors(form);

      const naira = Number.parseInt(ui.$("#wd-amount").value, 10);
      if (!Number.isSafeInteger(naira) || naira < 1) {
        ui.toast("Enter a whole-naira amount of at least ₦1", "error");
        return;
      }
      if (naira * 100 > state.wallet.balanceMinor) {
        ui.toast("You don't have enough balance for this cash-out", "error");
        return;
      }

      const method = state.activeMethod;
      if (method === "bank") {
        const accountId = accountSelect ? accountSelect.value : "";
        if (!accountId) {
          ui.toast("Choose a bank account to cash out to", "error");
          return;
        }
      } else if (!state.agent) {
        ui.toast("Choose a cash agent", "error");
        return;
      }

      submit.disabled = true;
      submit.textContent = "Processing…";

      try {
        let accountId;
        if (method === "bank") {
          accountId = accountSelect.value;
        } else {
          // Link (or reuse) this user's agent destination, then cash out to it.
          submit.textContent = "Preparing…";
          const { account } = await api("/withdraw/accounts", {
            method: "POST",
            body: {
              bankName: state.agent,
              accountName: `${state.agent} agent · ${state.profile.fullName || "AgbedePay user"}`.slice(0, 120),
              accountNumber: `9${deterministicDigits(`${state.profile.id}|agent|${state.agent}`, 9)}`,
              kind: "AGENT",
            },
          });
          accountId = account.id;
          submit.textContent = "Processing…";
        }

        const { withdrawal, balanceNgn } = await api("/withdraw", {
          method: "POST",
          body: { accountId, amountMinor: naira * 100, pin: pin.value },
          headers: { "Idempotency-Key": idempotencyKey() },
        });
        state.wallet.balanceMinor = state.wallet.balanceMinor - naira * 100;
        const bal = document.querySelector("[data-balance]");
        if (bal) bal.textContent = ui.escapeHtml(balanceNgn || state.wallet.balanceNgn);
        ui.toast(method === "agent" ? "Collection code ready" : "Cash-out sent for processing", "success");
        showSuccess(withdrawal, balanceNgn, method);
      } catch (err) {
        ui.showFormErrors(form, err);
        submit.disabled = false;
        submit.textContent = method === "agent" ? "Collect cash" : "Cash out";
      }
    });
  }

  function showSuccess(withdrawal, balanceNgn, method) {
    const form = ui.$("#withdraw-form");
    if (!form) return;
    const isAgent = method === "agent";
    const code = deterministicDigits(String(withdrawal.id || withdrawal.reference || ""), 6);
    form.outerHTML = `
      <div class="success-card card">
        <div class="success-card__icon" aria-hidden="true">${ui.icon("check")}</div>
        <h3>${isAgent ? "Collect your cash" : "Cash-out initiated"}</h3>
        <p>${ui.escapeHtml(withdrawal.reference)} — ${ui.escapeHtml(balanceNgn)}</p>
        ${
          isAgent
            ? `<div class="pickup">
                 <span class="pickup__label">Collection code</span>
                 <strong class="pickup__code">${code.slice(0, 3)} ${code.slice(3)}</strong>
                 <span class="pickup__hint">Show this at any ${ui.escapeHtml(state.agent)} outlet to collect ${ui.escapeHtml(ui.formatNgn(Number(withdrawal.amountMinor) / 100))}</span>
               </div>`
            : ""
        }
        <a class="btn btn--green btn--block" href="transaction.html?id=${encodeURIComponent(withdrawal.id)}">View transaction</a>
        <button class="ghost-btn btn--block" type="button" data-more style="margin-top:8px">Cash out again</button>
      </div>`;
    const more = document.querySelector("[data-more]");
    if (more) more.addEventListener("click", () => window.location.reload());
  }

  function wireAccountForm() {
    const form = ui.$("#account-form");
    if (!form) return;
    const number = ui.$("#ba-number");
    const bankSelect = ui.$("#ba-bank");
    number.addEventListener("input", () => (number.value = number.value.replace(/\D/g, "").slice(0, 10)));
    bankSelect.addEventListener("change", () => {
      const badge = ui.$("#ba-bank-badge");
      if (!badge) return;
      const style = ui.bankStyle(bankSelect.value);
      badge.textContent = style.short;
      badge.style.background = style.color;
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      ui.resetFormErrors(form);
      const payload = {
        bankName: bankSelect.value,
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
