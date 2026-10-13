// send page — send to another AgbedePay wallet instantly, or to a bank
// account (NUBAN-style name enquiry first, then an immediate transfer).
// Amounts are entered in NAIRA but converted to KOBO before reaching the
// backend (which validates kobo as an integer; money is never computed from
// floats here).

(function () {
  "use strict";

  const { api, idempotencyKey } = window.AgbeAPI;
  const ui = window.AgbeUI;

  let activeMethod = "wallet";
  let banksLoaded = false;
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
          if (show) {
            const input = f.querySelector("input, select");
            if (input) input.setAttribute("required", "");
          } else {
            const input = f.querySelector("input, select");
            if (input) input.removeAttribute("required");
          }
        });
        ui.resetFormErrors(document.querySelector("#send-form"));
        if (activeMethod === "bank") loadBanks();
        refreshPreview();
      });
    });

    const bankSelect = ui.$("#bank-name");
    const accountNumber = ui.$("#account-number");
    const verifiedName = ui.$("#bank-verified-name");

    // Live name enquiry — once a full account number is typed and a bank
    // picked, resolve the account holder so the user *sees* who they're
    // paying before confirming. The backend re-verifies on submit.
    const [recipientEl, amountEl, narrationEl, pinEl] = ["#recipient", "#amount", "#narration", "#pin"].map((s) => ui.$(s));
    const previewEl = ui.$("#preview");

    let lookupTimer = null;
    async function runLookup() {
      const bankName = bankSelect.value;
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
    bankSelect.addEventListener("change", () => {
      ui.resetFormErrors(document.querySelector("#send-form"));
      runLookup();
    });
    accountNumber.addEventListener("input", () => {
      accountNumber.value = accountNumber.value.replace(/\D/g, "").slice(0, 10);
      clearTimeout(lookupTimer);
      lookupTimer = setTimeout(runLookup, 450);
    });

    async function loadBanks() {
      if (banksLoaded) return;
      try {
        const res = await api("/transactions/banks");
        // The API returns plain bank-name strings; tolerate {name} objects too.
        (res.banks || [])
          .map((b) => (typeof b === "string" ? b : b && b.name))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
          .forEach((name) => {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            bankSelect.appendChild(opt);
          });
        banksLoaded = true;
      } catch (_) {
        /* banks list stays empty; backend still validates on submit */
      }
    }

    function refreshPreview() {
      if (!previewEl) return;
      const v = Number.parseInt(amountEl.value, 10);
      if (v > 0) {
        const costMinor = activeMethod === "bank" ? v * 100 : v * 100;
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
        const recipientPhone = recipientEl.value.trim();
        if (!/^0[789][01]?\d{8}$/.test(recipientPhone.replace(/\s/g, "")) && !/^\d{11}$/.test(recipientPhone)) {
          ui.toast("Enter a valid 11-digit phone number", "error");
          return;
        }
        payload = { recipientPhone, amountMinor, narration, pin: pinEl.value };
      } else {
        payload = {
          bankName: bankSelect.value,
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