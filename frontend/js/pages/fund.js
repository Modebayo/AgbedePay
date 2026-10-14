// fund page — money IN. Four top-up methods (card, bank transfer, USSD, QR).
// CARD uses a real hosted checkout: the browser is sent to the payment gateway
// (Paystack, or its simulated stand-in in development), which redirects back
// here with a reference; we then ask the backend to VERIFY and credit the
// wallet. Card details never touch this page. The transfer/USSD/QR methods
// remain frontend-simulated demo flows (a dedicated account / code / QR that
// credits instantly). Amounts are entered in NAIRA and converted to KOBO for
// the API (which only works in integer kobo).

(function () {
  "use strict";

  const { api, idempotencyKey } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const METHODS = ["card", "transfer", "ussd", "qr"];

  const NOTES = {
    card: "You’ll be redirected to our secure payment partner to complete the top-up. Card details are entered only on their page — never on AgbedePay.",
    transfer: "Open any bank app, send the amount to this account, then tap “I’ve sent it”. The demo credits your wallet instantly.",
    ussd: "Dial the code from your registered phone, confirm, and the demo credits your wallet instantly.",
    qr: "Scan with any bank or wallet app — the demo credits your wallet instantly.",
  };

  const SUBMIT_LABELS = {
    card: (amt) => (amt ? `Pay ${amt} securely` : "Pay securely"),
    transfer: () => "I’ve sent it",
    ussd: () => "I’ve completed it",
    qr: () => "I’ve paid",
  };

  // A representative set of banks shown as colored monogram badges (the shared
  // ui.bankBadge helper maps each name to its brand colour).
  const BANK_NAMES = ["GTBank", "Access Bank", "Zenith Bank", "UBA", "First Bank", "Kuda", "OPay", "Moniepoint"];

  let activeMethod = "card";
  let wallet = null;
  let account = null;

  // A stable demo reference so the QR payload doesn't change on every keystroke.
  const payReference = `AGR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  function nairaLabel(n) {
    return `₦${Number(n).toLocaleString("en-NG")}`;
  }

  // Deterministic per-user digits: a virtual account must not drift between
  // visits. FNV-1a + xorshift, then take the low digits.
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

  function accountFromVirtual(va) {
    const style = ui.bankStyle(va.bankName);
    return { number: va.accountNumber, name: va.accountName, bank: va.bankName, bankShort: style.short, color: style.color };
  }

  function buildAccount(profile) {
    const style = ui.bankStyle("Wema Bank");
    return {
      number: `9${deterministicDigits(`${profile.id}|va`, 9)}`,
      name: (profile.fullName || "AGBEDEPAY USER").toUpperCase(),
      bank: "Wema Bank",
      bankShort: style.short,
      color: style.color,
    };
  }

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "home");

    wallet = profile.wallet;
    if (!wallet || wallet.status !== "ACTIVE") {
      const form = ui.$("#fund-form");
      if (form) form.outerHTML = `<div class="error-banner error-banner--show" role="alert">Your wallet cannot accept a top-up right now. Please contact support.</div>`;
      return;
    }
    account = buildAccount(profile);

    // Prefer the server-persisted dedicated account (stable across devices); the
    // local derivation above is only a fallback if the endpoint is unavailable.
    api("/wallet/virtual-account")
      .then(({ virtualAccount }) => {
        if (!virtualAccount) return;
        account = accountFromVirtual(virtualAccount);
        renderAccount();
        renderUssd();
      })
      .catch(() => {});

    const form = ui.$("#fund-form");
    const submit = ui.$("#fund-submit");
    const cancel = ui.$("#fund-cancel");
    const amountEl = ui.$("#amount");
    const preview = ui.$("#preview");

    fillIcons();
    wireBackAndCancel();
    wireTabs();
    wireCopyButtons();

    function goBack() {
      if (window.history.length > 1) window.history.back();
      else window.location.assign("dashboard.html");
    }
    function wireBackAndCancel() {
      const back = ui.$("#fund-back");
      if (back) back.addEventListener("click", goBack);
      if (cancel) cancel.addEventListener("click", goBack);
    }

    // ---- icons ------------------------------------------------------------
    function fillIcons() {
      ui.$$(".method-tab").forEach((tab) => {
        const box = tab.querySelector(".method-tab__ic");
        if (box) box.innerHTML = ui.icon(tab.dataset.icon);
      });
      const gatewayIc = ui.$("#card-gateway-ic");
      if (gatewayIc) gatewayIc.innerHTML = ui.icon("shield");
      const replacements = { "ic--copy": "copy", "ic--download": "download" };
      Object.entries(replacements).forEach(([cls, name]) => {
        ui.$$(`.${cls}`).forEach((el) => { el.outerHTML = ui.icon(name); });
      });
    }

    // ---- method tabs ------------------------------------------------------
    function wireTabs() {
      ui.$$(".method-tab").forEach((tab) => {
        tab.addEventListener("click", () => setMethod(tab.dataset.method));
      });
    }

    function setMethod(method) {
      if (!METHODS.includes(method)) method = "card";
      activeMethod = method;
      ui.$$(".method-tab").forEach((t) => {
        const on = t.dataset.method === method;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      ui.$$(".method-panel").forEach((p) => { p.hidden = p.dataset.panel !== method; });
      const note = ui.$("#fund-note");
      if (note) note.textContent = NOTES[method];
      refresh();
    }

    // ---- amount -----------------------------------------------------------
    function currentAmount() {
      const v = Number.parseInt(amountEl.value, 10);
      return Number.isSafeInteger(v) && v > 0 ? v : 0;
    }

    ui.moneyInput(amountEl);
    amountEl.addEventListener("input", refresh);

    ui.$$(".amount-chips .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        amountEl.value = chip.dataset.amount;
        refresh();
      });
    });

    function refresh() {
      const v = currentAmount();
      preview.textContent =
        v > 0
          ? `New balance after top-up: ${ui.formatNgn((wallet.balanceMinor + v * 100) / 100)}.`
          : "";
      if (activeMethod === "ussd") renderUssd();
      if (activeMethod === "qr") renderQr();
      updateSubmitLabel(v);
    }

    function updateSubmitLabel(v) {
      const amt = v ? nairaLabel(v) : "";
      submit.textContent = SUBMIT_LABELS[activeMethod](amt);
    }

    // ---- bank transfer ----------------------------------------------------
    function renderBankBadges() {
      const box = ui.$("#bank-badges");
      if (!box) return;
      box.innerHTML = BANK_NAMES.map((name) => ui.bankBadge(name)).join("");
    }

    function renderAccount() {
      if (!account) return;
      const set = (sel, val) => { const el = ui.$(sel); if (el) el.textContent = val; };
      set("#vaccount-number", account.number);
      set("#vaccount-name", account.name);
      set("#vaccount-bank", `${account.bank} · Virtual account`);
      const badge = ui.$("#vaccount-badge");
      if (badge) { badge.textContent = account.bankShort; badge.style.background = account.color; }
    }

    // ---- USSD -------------------------------------------------------------
    function renderUssd() {
      const code = ui.$("#ussd-code");
      if (!code || !account) return;
      const amt = currentAmount();
      code.textContent = amt
        ? `*737*000*${account.number}*${amt}#`
        : `*737*000*${account.number}#`;
      const badge = ui.$("#ussd-badge");
      if (badge) { badge.textContent = account.bankShort; badge.style.background = account.color; }
    }

    // ---- QR ---------------------------------------------------------------
    function qrPayload(amt) {
      const p = new URLSearchParams();
      p.set("to", account.number);
      p.set("name", account.name);
      p.set("bank", account.bank);
      if (amt) p.set("amount", String(amt));
      p.set("ref", payReference);
      return `https://agbedepay.com/pay?${p.toString()}`;
    }

    function renderQr() {
      const box = ui.$("#qr-box");
      const cap = ui.$("#qr-caption");
      if (!box || !account) return;
      const amt = currentAmount();
      if (typeof window.qrcode !== "function") {
        box.innerHTML = `<p class="empty empty--compact">QR renderer unavailable.</p>`;
        return;
      }
      try {
        const qr = window.qrcode(0, "M");
        qr.addData(qrPayload(amt));
        qr.make();
        box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      } catch (_) {
        box.innerHTML = `<p class="empty empty--compact">Couldn’t render the QR code.</p>`;
        return;
      }
      if (cap) {
        cap.textContent = `${account.bank} · ${account.number}${amt ? ` · ${nairaLabel(amt)}` : ""}`;
      }
    }

    function wireQrDownload() {
      const btn = ui.$("#qr-download");
      if (!btn) return;
      btn.addEventListener("click", () => {
        const svg = ui.$("#qr-box svg");
        if (!svg) { ui.toast("QR is not ready yet", "error"); return; }
        const blob = new Blob([svg.outerHTML], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `agbedepay-${account ? account.number : "qr"}.svg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        ui.toast("QR code downloaded", "success");
      });
    }

    // ---- clipboard --------------------------------------------------------
    function wireCopyButtons() {
      ui.$$("[data-copy]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const el = ui.$(`#${btn.dataset.copy}`);
          if (el) copyText(el.textContent.trim(), btn);
        });
      });
    }

    async function copyText(text, btn) {
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch (_) { /* ignore */ }
        ta.remove();
      }
      if (btn) {
        if (!btn.dataset.original) btn.dataset.original = btn.innerHTML;
        btn.innerHTML = "Copied";
        setTimeout(() => {
          if (btn.dataset.original) { btn.innerHTML = btn.dataset.original; delete btn.dataset.original; }
        }, 1200);
      }
      ui.toast("Copied to clipboard", "success");
    }

    // ---- submit -----------------------------------------------------------
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      ui.resetFormErrors(form);

      const nairaAmount = currentAmount();
      if (!nairaAmount) {
        ui.toast("Enter a whole-naira amount of at least ₦1", "error");
        amountEl.focus();
        return;
      }

      // Card goes through the real hosted checkout; the other methods keep the
      // demo "credit instantly" behaviour.
      if (activeMethod === "card") {
        await initiatePayment(nairaAmount);
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
        showSuccess(data);
      } catch (err) {
        ui.showFormErrors(form, err);
      } finally {
        submit.disabled = false;
        refresh();
      }
    });

    function showSuccess(data) {
      const tabs = document.querySelector(".method-tabs");
      if (tabs) tabs.remove();
      const back = ui.$("#fund-back");
      if (back) back.remove();

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
    }

    // ---- hosted card checkout --------------------------------------------
    async function initiatePayment(nairaAmount) {
      submit.disabled = true;
      submit.textContent = "Starting secure checkout…";
      try {
        const data = await api("/payments/initiate", {
          method: "POST",
          body: { amountMinor: nairaAmount * 100 },
        });
        if (!data.authorizationUrl) {
          throw new Error("Payments are unavailable right now. Please try another method.");
        }
        // Leave the page — the gateway will send us back with a reference.
        window.location.assign(data.authorizationUrl);
      } catch (err) {
        ui.toast(err.message || "Could not start checkout", "error");
        submit.disabled = false;
        refresh();
      }
    }

    // On return from the gateway (or the mock stand-in) the URL carries a
    // reference; ask the backend to verify it and settle the wallet.
    function handleReturn() {
      const params = new URLSearchParams(window.location.search);
      const reference = params.get("reference") || params.get("pay");
      if (reference) verifyPayment(reference);
    }

    async function verifyPayment(reference) {
      submit.disabled = true;
      submit.textContent = "Confirming payment…";
      try {
        const data = await api("/payments/verify", {
          method: "POST",
          body: { reference },
        });
        const status = data.status || data.payment?.status;
        if (status === "SUCCESS") {
          showPaymentSuccess(data);
        } else {
          ui.toast("Payment not completed. If you were debited it will reflect shortly.", "error");
          submit.disabled = false;
          refresh();
        }
      } catch (err) {
        ui.toast(err.message || "Could not confirm payment", "error");
        submit.disabled = false;
        refresh();
      }
    }

    function showPaymentSuccess(data) {
      const tabs = document.querySelector(".method-tabs");
      if (tabs) tabs.remove();
      const back = ui.$("#fund-back");
      if (back) back.remove();
      const p = data.payment || {};
      const receipt = p.walletTransactionId
        ? `<a class="btn btn--primary" href="transaction.html?id=${encodeURIComponent(p.walletTransactionId)}">${ui.icon("wallet")} View receipt</a>`
        : "";

      form.outerHTML = `
        <div class="success card" role="status">
          <span class="success__icon" aria-hidden="true">${ui.icon("check")}</span>
          <h2 class="success__title">Money added!</h2>
          <p class="success__text">
            ${ui.escapeHtml(p.amountNgn || "")} has been credited to your wallet.
            ${data.replayed ? "This top-up was already processed." : ""}
          </p>
          <div class="success__meta">
            <span>Reference</span>
            <strong>${ui.escapeHtml(p.reference || "")}</strong>
          </div>
          <div class="success__meta">
            <span>New balance</span>
            <strong>${ui.escapeHtml(data.balanceNgn || "")}</strong>
          </div>
          <div class="success__actions">
            ${receipt}
            <button class="btn btn--ghost" type="button" data-again>${ui.icon("plus")} Add more</button>
          </div>
        </div>`;

      const again = ui.$("[data-again]");
      if (again) again.addEventListener("click", () => window.location.reload());
    }

    // ---- kick-off ---------------------------------------------------------
    renderBankBadges();
    renderAccount();
    renderUssd();
    renderQr();
    wireQrDownload();
    setMethod("card");
    handleReturn();
  });
})();
