// transaction page — full detail + receipt for one transaction. Corner actions:
// "Report issue" opens a support ticket about this transaction, "Share PDF"
// links to the printable receipt.

(function () {
  "use strict";

  const { api } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  const page = ui.$("#page");
  const modalBackdrop = ui.$("#issue-modal");
  const issueMessage = ui.$("#issue-message");
  const issueError = ui.$("#issue-error");
  const issueConfirmBtn = ui.$("#issue-confirm");
  const issueCancelBtn = ui.$("#issue-cancel");
  const issueModalText = ui.$("#issue-modal-text");

  if (!id) {
    page.innerHTML = `<div class="error-banner error-banner--show" role="alert">Missing transaction id.</div>`;
    return;
  }

  let current = null; // the current user's wallet (to compute direction)
  let tx = null; // the transaction being viewed

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "transactions");
    current = profile.wallet;

    try {
      const { transaction } = await api(`/transactions/${encodeURIComponent(id)}`);
      tx = transaction;
      const receiptData = ["SUCCESS", "REVERSED"].includes(transaction.status)
        ? await api(`/transactions/${encodeURIComponent(id)}/receipt`).catch(() => null)
        : null;
      render(transaction, receiptData);
    } catch (err) {
      page.innerHTML = `<div class="error-banner error-banner--show" role="alert">${ui.escapeHtml(err.message || "Transaction not found")}</div>`;
    }
  });

  // Account name sits on top, the number underneath — everywhere we show a
  // counterparty.
  function party(name, number) {
    return `<div class="details__val details__val--stack">
      <span class="details__name">${ui.escapeHtml(name || "—")}</span>
      ${number ? `<span class="details__num">${ui.escapeHtml(number)}</span>` : ""}
    </div>`;
  }

  function render(t, receiptData) {
    const dir = ui.txDirection(t, current.id);

    const parties =
      t.type === "FUNDING"
        ? `<div class="details__row"><div class="details__key">To</div>${party(t.sender?.name, t.sender?.phone)}</div>`
        : ["WITHDRAWAL", "BANK"].includes(t.type) && t.bank
          ? `<div class="details__row"><div class="details__key">From</div>${party(t.sender?.name, t.sender?.phone)}</div>
             <div class="details__row"><div class="details__key">To</div>${party(t.bank.accountName || t.bank.bankName, `${t.bank.bankName} ·•• ${String(t.bank.accountNumber || "").slice(-4)}`)}</div>`
          : `
      <div class="details__row"><div class="details__key">From</div>${party(t.sender?.name, t.sender?.phone)}</div>
      <div class="details__row"><div class="details__key">To</div>${party(t.receiver?.name, t.receiver?.phone)}</div>`;

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

      <div class="tx-actions">
        <button class="ghost-btn tx-actions__issue" id="issue-btn" type="button">${ui.icon("alert")} Report issue</button>
        ${
          receiptData
            ? `<a class="ghost-btn tx-actions__receipt" href="receipt.html?id=${encodeURIComponent(t.id)}">${ui.icon("share")} Share PDF</a>`
            : ""
        }
      </div>
    `;

    ui.$("#issue-btn").addEventListener("click", openIssueModal);
  }

  function issueCategory() {
    if (!tx) return "PAYMENT";
    return ["WITHDRAWAL", "BANK"].includes(tx.type) ? "WITHDRAWAL" : "PAYMENT";
  }

  function openIssueModal() {
    issueModalText.textContent = `Tell us what went wrong with ${tx ? tx.reference : "this transaction"} and our team will get back to you.`;
    issueMessage.value = "";
    issueError.style.display = "none";
    issueConfirmBtn.disabled = false;
    issueConfirmBtn.textContent = "Submit";
    modalBackdrop.hidden = false;
    issueMessage.focus();
  }

  function closeIssueModal() {
    modalBackdrop.hidden = true;
  }

  issueCancelBtn.addEventListener("click", closeIssueModal);
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeIssueModal();
  });
  issueMessage.addEventListener("input", () => {
    issueError.style.display = "none";
  });

  issueConfirmBtn.addEventListener("click", async () => {
    const message = issueMessage.value.trim();
    if (!message) {
      issueError.textContent = "Please describe the issue.";
      issueError.style.display = "block";
      return;
    }

    issueConfirmBtn.disabled = true;
    issueConfirmBtn.textContent = "Submitting…";

    try {
      await api("/support/tickets", {
        method: "POST",
        body: {
          category: issueCategory(),
          subject: `Issue with ${tx ? tx.reference : "a transaction"}`.slice(0, 120),
          message,
        },
      });
      ui.toast("Issue reported — our team will review it", "success");
      closeIssueModal();
    } catch (err) {
      issueError.textContent = err.message || "Could not submit your report";
      issueError.style.display = "block";
      issueConfirmBtn.disabled = false;
      issueConfirmBtn.textContent = "Submit";
    }
  });
})();
