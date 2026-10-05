// receipt page — a clean, branded receipt you can print or save as PDF
// (browser "Print → Save as PDF"). Reads the same receipt endpoint the
// transaction detail page uses.

(function () {
  "use strict";

  const { api } = window.AgbeAPI;
  const ui = window.AgbeUI;
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const page = ui.$("#page");

  if (!id) {
    page.innerHTML = `<div class="error-banner error-banner--show" role="alert">Missing transaction id.</div>`;
    return;
  }

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "transactions");
    try {
      const { receipt } = await api(`/transactions/${encodeURIComponent(id)}/receipt`);
      render(receipt);
    } catch (err) {
      page.innerHTML = `<div class="error-banner error-banner--show" role="alert">${ui.escapeHtml(err.message || "Receipt not available")}</div>`;
    }
  });

  function accountLine(r) {
    if (r.type === "WITHDRAWAL" && r.bank) {
      return `
        <div class="details__row"><div class="details__key">To</div><div class="details__val">${ui.escapeHtml(r.bank.bankName)} ·${ui.escapeHtml(r.bank.accountName)} ·••${ui.escapeHtml(r.bank.accountNumber.slice(-4))}</div></div>`;
    }
    if (r.type === "FUNDING") {
      return `<div class="details__row"><div class="details__key">To</div><div class="details__val">Your wallet</div></div>`;
    }
    const mineFirst = r.direction === "DEBIT";
    const from = r.sender ? `${r.sender.name || "—"}${r.sender.phone ? " · " + r.sender.phone : ""}` : "AgbedePay";
    const to = r.receiver ? `${r.receiver.name || "—"}${r.receiver.phone ? " · " + r.receiver.phone : ""}` : "—";
    return `
      <div class="details__row"><div class="details__key">From</div><div class="details__val">${ui.escapeHtml(from)}</div></div>
      <div class="details__row"><div class="details__key">To</div><div class="details__val">${ui.escapeHtml(to)}</div></div>`;
  }

  function render(r) {
    const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    page.innerHTML = `
      <div class="receipt-doc" id="receipt-doc">
        <div class="receipt-doc__brand">
          <img src="../brand/symbol.svg" alt="" draggable="false" width="34" height="34" />
          <div>
            <div class="receipt-doc__name">AgbedePay</div>
            <div class="receipt-doc__tagline">Pay. Save. Grow.</div>
          </div>
          <span class="badge badge--SUCCESS">Official receipt</span>
        </div>

        <div class="receipt-doc__amount">
          <div class="receipt-doc__dir">${r.direction === "DEBIT" ? "MONEY OUT" : "MONEY IN"}</div>
          <div class="receipt-doc__value">${r.direction === "DEBIT" ? "−" : "+"}${r.amountNgn}</div>
          ${r.narration ? `<div class="receipt-doc__narration">${ui.escapeHtml(r.narration)}</div>` : ""}
        </div>

        <div class="details receipt-doc__rows">
          <div class="details__row"><div class="details__key">Status</div><div class="details__val"><span class="badge badge--${r.status}">${ui.escapeHtml(r.status)}</span></div></div>
          <div class="details__row"><div class="details__key">Reference</div><div class="details__val">${ui.escapeHtml(r.reference)}</div></div>
          <div class="details__row"><div class="details__key">Type</div><div class="details__val">${ui.escapeHtml(r.type.replaceAll("_", " "))}</div></div>
          ${accountLine(r)}
          ${r.completedAt ? `<div class="details__row"><div class="details__key">Date</div><div class="details__val">${new Date(r.completedAt).toLocaleString()}</div></div>` : ""}
          <div class="details__row"><div class="details__key">Printed</div><div class="details__val">${today}</div></div>
        </div>

        <div class="receipt-doc__foot">This is a system-generated receipt from AgbedePay. For help, contact support.</div>
      </div>
    `;

    const btn = document.querySelector(".print-toolbar button");
    if (btn) btn.addEventListener("click", () => window.print());
  }
})();