// transfer page — send to another AgbedePay account (by phone OR by their
// 10-digit AgbedePay account number) instantly, or to any bank account
// (searchable bank picker, NUBAN-style name enquiry first, then an immediate
// transfer). Amounts are entered in NAIRA but converted to KOBO before reaching
// the backend (which validates kobo as an integer; money is never computed from
// floats here).

(function () {
  "use strict";

  const { api, idempotencyKey } = window.AgbeAPI;
  const ui = window.AgbeUI;

  let activeMethod = "wallet";
  let banksLoaded = false;
  let bankList = [];
  let wallet = null;

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "send");

    wallet = profile.wallet;
    if (!wallet || wallet.status !== "ACTIVE") {
      const form = ui.$("#send-form");
      if (form) form.outerHTML = `<div class="error-banner error-banner--show" role="alert">Your wallet ${wallet ? "(" + ui.escapeHtml(wallet.status) + ")" : ""} cannot send money right now.</div>`;
      return;
    }

    // The KYC-gated send limit, shown right where the money leaves.
    api("/kyc/limits")
      .then(({ limits }) => {
        const form = ui.$("#send-form");
        if (!form || !form.parentNode) return;
        const hint = document.createElement("div");
        hint.className = "limit-hint";
        hint.innerHTML = `
          <span class="limit-hint__tier">${ui.escapeHtml(limits.tier)}</span>
          <span>${ui.escapeHtml(limits.usedToday.sendRemainingNgn)} left of ${ui.escapeHtml(limits.sendDailyNgn)} today · up to ${ui.escapeHtml(limits.sendPerTransactionNgn)} per transfer</span>`;
        form.parentNode.insertBefore(hint, form);
      })
      .catch(() => {});

    // ---- method tabs (wallet ⇄ bank) --------------------------------------
    const tabs = ui.$$(".send-method");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => {
          t.classList.toggle("is-active", t === tab);
          t.setAttribute("aria-selected", t === tab ? "true" : "false");
        });
        activeMethod = tab.dataset.method;
        ui.$$("[data-field]", document).forEach((f) => {
          const show = f.dataset.field === activeMethod;
          f.hidden = !show;
          const input = f.querySelector("input, select");
          if (input) {
            if (show) input.setAttribute("required", "");
            else input.removeAttribute("required");
          }
        });
        ui.resetFormErrors(document.querySelector("#send-form"));
        if (activeMethod === "bank") loadBanks().then(() => renderBankMenu(bankSearch.value));
        refreshPreview();
      });
    });

    const bankNameEl = ui.$("#bank-name"); // hidden input holding the chosen bank
    const bankSearch = ui.$("#bank-search");
    const bankMenu = ui.$("#bank-menu");
    const bankClear = ui.$("#bank-clear");
    const accountNumber = ui.$("#account-number");
    const verifiedName = ui.$("#bank-verified-name");

    const [recipientEl, amountEl, narrationEl, pinEl] = ["#recipient", "#amount", "#narration", "#pin"].map((s) => ui.$(s));
    const previewEl = ui.$("#preview");

    // Monogram badge follows the chosen bank so the picker reads visually.
    function updateBankBadge() {
      const badge = ui.$("#bank-name-badge");
      if (!badge) return;
      const style = ui.bankStyle(bankNameEl.value);
      badge.textContent = style.short;
      badge.style.background = style.color;
    }
    updateBankBadge();

    // ---- Searchable bank picker -------------------------------------------
    let currentMatches = [];
    let activeIndex = -1;

    function renderBankMenu(query) {
      const q = (query || "").trim().toLowerCase();
      currentMatches = [];
      bankList.forEach((name, idx) => {
        if (!q || name.toLowerCase().includes(q)) currentMatches.push({ name, idx });
      });
      activeIndex = -1;
      if (!currentMatches.length) {
        bankMenu.innerHTML = `<div class="combobox__empty">${bankList.length ? "No bank matches that search." : "Loading banks…"}</div>`;
      } else {
        bankMenu.innerHTML = currentMatches
          .map(({ name }, i) => {
            const style = ui.bankStyle(name);
            return `<div class="combobox__option" role="option" id="bank-opt-${i}" data-i="${i}">
              <span class="bank-badge bank-badge--sm" style="background:${style.color}" aria-hidden="true">${ui.escapeHtml(style.short)}</span>
              <span class="combobox__option-name">${ui.escapeHtml(name)}</span>
            </div>`;
          })
          .join("");
      }
      bankMenu.hidden = false;
      bankSearch.setAttribute("aria-expanded", "true");
    }

    function setActive(i) {
      const opts = bankMenu.querySelectorAll(".combobox__option");
      if (!opts.length) return;
      activeIndex = (i + opts.length) % opts.length;
      opts.forEach((o, k) => o.classList.toggle("is-active", k === activeIndex));
      const active = opts[activeIndex];
      bankSearch.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    }

    function closeBankMenu() {
      bankMenu.hidden = true;
      bankSearch.setAttribute("aria-expanded", "false");
      bankSearch.removeAttribute("aria-activedescendant");
    }

    function selectBank(name) {
      bankNameEl.value = name;
      bankSearch.value = name;
      bankClear.hidden = !name;
      updateBankBadge();
      closeBankMenu();
      ui.resetFormErrors(document.querySelector("#send-form"));
      runBankLookup();
    }

    bankMenu.addEventListener("click", (e) => {
      const opt = e.target.closest(".combobox__option[data-i]");
      if (!opt) return;
      const match = currentMatches[Number(opt.dataset.i)];
      if (match) selectBank(match.name);
    });

    bankSearch.addEventListener("input", () => {
      if (bankNameEl.value && bankSearch.value !== bankNameEl.value) bankNameEl.value = "";
      bankClear.hidden = !bankSearch.value;
      renderBankMenu(bankSearch.value);
      runBankLookup();
    });
    bankSearch.addEventListener("focus", () => {
      loadBanks().then(() => renderBankMenu(bankSearch.value));
    });
    bankSearch.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (bankMenu.hidden) renderBankMenu(bankSearch.value);
        setActive(activeIndex + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive(activeIndex - 1);
      } else if (e.key === "Enter") {
        if (activeIndex >= 0 && currentMatches[activeIndex]) {
          e.preventDefault();
          selectBank(currentMatches[activeIndex].name);
        }
      } else if (e.key === "Escape") {
        closeBankMenu();
      }
    });
    bankClear.addEventListener("click", () => {
      bankNameEl.value = "";
      bankSearch.value = "";
      bankClear.hidden = true;
      updateBankBadge();
      ui.$("#bank-verified").hidden = true;
      bankSearch.focus();
    });
    document.addEventListener("click", (e) => {
      const box = ui.$("#bank-combobox");
      if (box && !box.contains(e.target)) closeBankMenu();
    });

    // Live name enquiry for the bank account — once a full account number is
    // typed and a bank picked, resolve the holder so the user *sees* who they're
    // paying before confirming. The backend re-verifies on submit.
    let bankLookupTimer = null;
    async function runBankLookup() {
      const bankName = bankNameEl.value;
      const number = accountNumber.value.replace(/\D/g, "");
      const verifiedBox = ui.$("#bank-verified");
      if (!bankName || number.length !== 10) {
        verifiedBox.hidden = true;
        accountNumber.closest(".field").classList.remove("field--invalid");
        return;
      }
      try {
        const res = await api("/transactions/account/verify", {
          method: "POST",
          body: { bankName, accountNumber: number },
        });
        verifiedName.textContent = `${res.accountName} · ${res.bankName}`;
        verifiedBox.hidden = false;
        accountNumber.closest(".field").classList.remove("field--invalid");
      } catch (_) {
        verifiedBox.hidden = true;
        accountNumber.closest(".field").classList.add("field--invalid");
      }
    }
    accountNumber.addEventListener("input", () => {
      accountNumber.value = accountNumber.value.replace(/\D/g, "").slice(0, 10);
      clearTimeout(bankLookupTimer);
      bankLookupTimer = setTimeout(runBankLookup, 450);
    });

    // Live name enquiry for the AgbedePay wallet — the recipient may be given by
    // phone (11 digits) or by their 10-digit AgbedePay account number.
    const walletVerifiedBox = ui.$("#wallet-verified");
    const walletVerifiedName = ui.$("#wallet-verified-name");
    let walletLookupTimer = null;
    async function runWalletLookup() {
      const raw = recipientEl.value.replace(/\D/g, "");
      const field = recipientEl.closest(".field");
      if (raw.length !== 10 && raw.length !== 11) {
        walletVerifiedBox.hidden = true;
        field.classList.remove("field--invalid");
        return;
      }
      const body = raw.length === 10 ? { accountNumber: raw } : { phone: raw };
      try {
        const res = await api("/transactions/account/verify/agbede", { method: "POST", body });
        walletVerifiedName.textContent = res.accountName;
        walletVerifiedBox.hidden = false;
        field.classList.remove("field--invalid");
      } catch (_) {
        walletVerifiedBox.hidden = true;
        field.classList.add("field--invalid");
      }
    }
    recipientEl.addEventListener("input", () => {
      recipientEl.value = recipientEl.value.replace(/\D/g, "").slice(0, 11);
      clearTimeout(walletLookupTimer);
      walletLookupTimer = setTimeout(runWalletLookup, 450);
    });

    async function loadBanks() {
      if (banksLoaded) return;
      try {
        const res = await api("/transactions/banks");
        // The API returns plain bank-name strings; tolerate {name} objects too.
        bankList = (res.banks || [])
          .map((b) => (typeof b === "string" ? b : b && b.name))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
        banksLoaded = true;
      } catch (_) {
        /* banks list stays empty; backend still validates on submit */
      }
    }

    function refreshPreview() {
      if (!previewEl) return;
      const v = Number.parseInt(amountEl.value, 10);
      if (v > 0) {
        const costMinor = v * 100;
        if (costMinor > wallet.balanceMinor) {
          previewEl.textContent = `You don't have enough balance for this amount.`;
          previewEl.style.color = "var(--danger)";
        } else {
          previewEl.textContent = `You'll send ${ui.formatNgn(v)}. New balance: ${ui.formatNgn((wallet.balanceMinor - costMinor) / 100)}.`;
          previewEl.style.color = "var(--muted)";
        }
      } else {
        previewEl.textContent = "";
      }
    }
    ui.moneyInput(amountEl);
    amountEl.addEventListener("input", refreshPreview);

    const form = ui.$("#send-form");
    const submit = ui.$("#send-submit");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      ui.resetFormErrors(form);

      const nairaAmount = Number.parseInt(amountEl.value, 10);
      if (!Number.isSafeInteger(nairaAmount) || nairaAmount < 1) {
        ui.toast("Enter a whole-naira amount of at least ₦1", "error");
        return;
      }
      const amountMinor = nairaAmount * 100; // kobo
      if (amountMinor > wallet.balanceMinor) {
        ui.toast("You don't have enough balance for this transfer", "error");
        return;
      }

      const narration = narrationEl.value.trim() || undefined;

      let payload = {};
      let endpoint = "/transactions/send";
      if (activeMethod === "wallet") {
        const raw = recipientEl.value.replace(/\D/g, "");
        if (raw.length === 11) {
          payload = { recipientPhone: raw, amountMinor, narration, pin: pinEl.value };
        } else if (raw.length === 10) {
          payload = { recipientAccount: raw, amountMinor, narration, pin: pinEl.value };
        } else {
          ui.toast("Enter a valid 11-digit phone number or 10-digit AgbedePay account number", "error");
          return;
        }
      } else {
        payload = {
          bankName: bankNameEl.value,
          accountNumber: accountNumber.value.replace(/\D/g, ""),
          amountMinor,
          narration,
          pin: pinEl.value,
        };
        if (!payload.bankName || payload.accountNumber.length !== 10) {
          ui.toast("Pick a bank and enter the full 10-digit account number", "error");
          return;
        }
        endpoint = "/transactions/send/bank";
      }

      submit.disabled = true;
      submit.textContent = "Sending…";

      try {
        const data = await api(endpoint, {
          method: "POST",
          body: payload,
          headers: { "Idempotency-Key": idempotencyKey() },
        });

        ui.toast("Money sent!", "success");
        window.location.replace(`transaction.html?id=${encodeURIComponent(data.transaction.id)}`);
      } catch (err) {
        ui.showFormErrors(form, err);
      } finally {
        submit.disabled = false;
        submit.textContent = "Send now";
      }
    });

    pinEl.addEventListener("input", (event) => {
      event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
    });
  });
})();
