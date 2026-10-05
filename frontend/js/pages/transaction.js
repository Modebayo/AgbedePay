// transaction page — full detail + receipt for one transaction, and the
// reversal action (sender or receiver, confirmed with PIN, guarded by the
// backend's FOR UPDATE lock against double reversal).

(function () {
  "use strict";

  const { api } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  const page = ui.$("#page");
  const modalBackdrop = ui.$("#reverse-modal");
  const reverseConfirmBtn = ui.$("#reverse-confirm");
  const reverseCancelBtn = ui.$("#reverse-cancel");
  const reversePin = ui.$("#reverse-pin");
  const reversePinError = ui.$("#reverse-pin-error");
  const reverseModalText = ui.$("#reverse-modal-text");

  if (!id) {
    page.innerHTML = `<div class="error-banner error-banner--show" role="alert">Missing transaction id.</div>`;
    return;
  }

  let current = null; // the w wallet (to compute direction)

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "transactions");
    current = profile.wallet;

    try {
      const { transaction } = await api(`/transactions/${encodeURIComponent(id)}`);
      const receiptData = ["SUCCESS", "REVERSED"].includes(transaction.status)
        ? await api(`/transactions/${encodeURIComponent(id)}/receipt`).catch(() => null)
        : null;
      render(transaction, receiptData);
    } catch (err) {
      page.innerHTML = `<div class="error-banner error-banner--show" role="alert">${ui.escapeHtml(err.message || "Transaction not found")}</div>`;
    }
  });

  function render(t, receiptData) {
    const dir =
      t.type === "FUNDING"
        ? { label: "Money in", sign: "+", cls: "credit" }
        : t.receiver?.walletId === current.id
          ? { label: "Money in", sign: "+", cls: "credit" }
          : { label: "Money out", sign: "-", cls: "debit" };

    const parties =
      t.type === "FUNDING"
        ? `<div class="details__row"><div class="details__key">To</div><div class="details__val">${ui.escapeHtml(t.sender?.name || "—")} · own wallet</div></div>`
        : ["WITHDRAWAL", "BANK"].includes(t.type) && t.bank
          ? `<div class="details__row"><div class="details__key">From</div><div class="details__val">${ui.escapeHtml(t.sender?.name || "—")} · ${ui.escapeHtml(t.sender?.phone || "—")}</div></div>
             <div class="details__row"><div class="details__key">To</div><div class="details__val">${ui.escapeHtml(t.bank.bankName)} · ${ui.escapeHtml(t.bank.accountName)} ·•• ${ui.escapeHtml(t.bank.accountNumber.slice(-4))}</div></div>`
        : `
      <div class="details__row"><div class="details__key">From</div><div class="details__val">${ui.escapeHtml(t.sender?.name || "—")} · ${ui.escapeHtml(t.sender?.phone || "—")}</div></div>
      <div class="details__row"><div class="details__key">To</div><div class="details__val">${ui.escapeHtml(t.receiver?.name || "—")} · ${ui.escapeHtml(t.receiver?.phone || "—")}</div></div>`;

    let receipt = "";
    if (receiptData) {
      const r = receiptData.receipt;
      receipt = `
        <div class="section-head"><h2>Receipt</h2></div>
        <div class="receipt">
          <div class="receipt__top">
            <div class="receipt__amount">${r.direction === "DEBIT" ? "−" : "+"}${r.amountNgn}</div>
            <div style="font-size:.82rem;color:var(--muted);margin-top:2px">${ui.escapeHtml(r.sender?.name || "")} → ${ui.escapeHtml(r.receiver?.name || "")}</div>
            <span class="badge badge--${r.status}">${r.status}</span>
          </div>
          <div class="receipt__rows details">
            ${r.reference ? `<div class="details__row"><div class="details__key">Reference</div><div class="details__val">${ui.escapeHtml(r.reference)}</div></div>` : ""}
            ${r.narration ? `<div class="details__row"><div class="details__key">Narration</div><div class="details__val">${ui.escapeHtml(r.narration)}</div></div>` : ""}
            <div class="details__row"><div class="details__key">Type</div><div class="details__val">${ui.escapeHtml(r.type)}</div></div>
            ${r.completedAt ? `<div class="details__row"><div class="details__key">Date</div><div class="details__val">${new Date(r.completedAt).toLocaleString()}</div></div>` : ""}
          </div>
        </div>`;
    }

    const canReverse = t.type === "TRANSFER" && t.status === "SUCCESS";
    const reverse = canReverse
      ? `<button class="ghost-btn" id="reverse-btn" type="button" style="width:100%;color:var(--danger);border-color:rgba(229,72,77,.4)">${ui.icon("reverse")} Reverse transfer</button>`
      : "";

    page.innerHTML = `
      <a class="page-sub" href="transactions.html" style="text-decoration:none;font-size:.85rem">← Back to transactions</a>

      <div class="card" style="margin-top:12px;text-align:center">
        <div class="details__val" style="font-size:2rem">${dir.sign}${t.amountNgn}</div>
        <p class="page-sub" style="margin-top:2px">${dir.label} · ${ui.escapeHtml(t.narration || t.type)}</p>
        <div style="margin-top:10px">
          <span class="badge badge--${t.type}">${t.type}</span>
          <span class="badge badge--${t.status}">${t.status}</span>
        </div>
        ${t.failureReason ? `<p class="error-banner error-banner--show" style="margin-top:12px">Failed: ${ui.escapeHtml(t.failureReason)}</p>` : ""}
      </div>

      <div class="section-head"><h2>Details</h2></div>
      <div class="card details" style="margin-top:0">
        ${parties}
        <div class="details__row"><div class="details__key">Reference</div><div class="details__val">${ui.escapeHtml(t.reference)}</div></div>
        <div class="details__row"><div class="details__key">Status</div><div class="details__val">${ui.escapeHtml(t.status)}</div></div>
        ${t.createdAt ? `<div class="details__row"><div class="details__key">Initiated</div><div class="details__val">${new Date(t.createdAt).toLocaleString()}</div></div>` : ""}
        ${t.completedAt ? `<div class="details__row"><div class="details__key">Completed</div><div class="details__val">${new Date(t.completedAt).toLocaleString()}</div></div>` : ""}
      </div>

      ${receipt}
      ${
        receiptData
          ? `<div style="margin-top:14px"><a class="btn btn--ghost btn--block" href="receipt.html?id=${encodeURIComponent(t.id)}">${ui.icon("doc")} Print / save PDF receipt</a></div>`
          : ""
      }
      ${reverse ? `<div style="margin-top:20px;display:flex;flex-direction:column;gap:10px">${reverse}</div>` : ""}
    `;

    if (canReverse) {
      ui.$("#reverse-btn").addEventListener("click", openModal);
    }
  }

  function openModal() {
    reverseModalText.textContent = "This will send the money back to the original sender and mark the transfer as REVERSED. Are you sure?";
    reversePin.value = "";
    reversePinError.style.display = "none";
    modalBackdrop.hidden = false;
  }

  function closeModal() {
    modalBackdrop.hidden = true;
  }

  reverseCancelBtn.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeModal();
  });
  reversePin.addEventListener("input", () => {
    reversePin.value = reversePin.value.replace(/\D/g, "").slice(0, 6);
    reversePinError.style.display = "none";
  });

  reverseConfirmBtn.addEventListener("click", async () => {
    if (!id || !reversePin.value) {
      reversePinError.textContent = "Enter your 6-digit PIN to confirm.";
      reversePinError.style.display = "block";
      return;
    }

    reverseConfirmBtn.disabled = true;
    reverseConfirmBtn.textContent = "Reversing…";

    try {
      await api(`/transactions/${encodeURIComponent(id)}/reverse`, {
        method: "POST",
        body: { pin: reversePin.value },
      });
      ui.toast("Transfer reversed", "success");
      closeModal();
      window.location.reload();
    } catch (err) {
      reversePinError.textContent = err.message || "Reversal failed";
      reversePinError.style.display = "block";
      reverseConfirmBtn.disabled = false;
      reverseConfirmBtn.textContent = "Yes, reverse";
    }
  });
})();