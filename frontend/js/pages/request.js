// request page — ask anyone by phone number to pay you (the request reaches
// their Request page), and pay requests addressed to you with a single PIN +
// idempotency key (double-taps settle exactly once).

(function () {
  "use strict";

  const { api, idempotencyKey } = window.AgbeAPI;
  const ui = window.AgbeUI;

  let currentUser = null;
  let activeRequestId = null; // the id we're about to pay

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "transactions");
    currentUser = profile;

    wireForm();
    wirePayModal();
    await refresh();
  });

  function statusBadge(status) {
    const cls = status === "PAID" ? "SUCCESS" : status === "CANCELLED" ? "CANCELLED" : "PENDING";
    return `<span class="badge badge--${cls}">${ui.escapeHtml(status)}</span>`;
  }

  function requestTime(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString();
  }

  async function refresh() {
    try {
      const { outgoing = [], incoming = [] } = await api("/transactions/requests");
      renderOutgoing(outgoing);
      renderIncoming(incoming);
    } catch (_) {
      ui.toast("Couldn't load your requests", "error");
    }
  }

  function renderOutgoing(items) {
    const el = ui.$("#req-outgoing");
    if (!el) return;
    if (!items.length) {
      el.innerHTML = `<div class="empty empty--compact">You haven't requested money yet.</div>`;
      return;
    }
    el.innerHTML = items
      .map(
        (r) => `
          <div class="req-item">
            <span class="req-item__icon" aria-hidden="true">${ui.icon("trend")}</span>
            <span class="req-item__main">
              <span class="req-item__title">${ui.escapeHtml(r.payerPhone)}${r.note ? ` · ${ui.escapeHtml(r.note)}` : ""}</span>
              <span class="req-item__meta">${statusBadge(r.status)}${r.status === "PAID" ? ` <span class="req-item__meta">${ui.escapeHtml(r.paidAt ? requestTime(r.paidAt) : "")}</span>` : ""}</span>
            </span>
            <span class="req-item__right">
              <span class="req-item__amount">${ui.escapeHtml(r.amountNgn)}</span>
              ${r.status === "PENDING" ? `<button class="link-btn" type="button" data-cancel="${ui.escapeHtml(r.id)}" style="color:var(--danger)">Cancel</button>` : ""}
            </span>
          </div>`
      )
      .join("");
    el.querySelectorAll("[data-cancel]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Cancel this request?")) return;
        btn.disabled = true;
        try {
          await api(`/transactions/requests/${encodeURIComponent(btn.dataset.cancel)}/cancel`, { method: "POST" });
          ui.toast("Request cancelled", "success");
          await refresh();
        } catch (err) {
          ui.toast(err.message || "Couldn't cancel this request", "error");
          btn.disabled = false;
        }
      });
    });
  }

  function renderIncoming(items) {
    const el = ui.$("#req-incoming");
    if (!el) return;
    if (!items.length) {
      el.innerHTML = `<div class="empty empty--compact">Nobody has asked you for money.</div>`;
      return;
    }
    el.innerHTML = items
      .map(
        (r) => `
          <div class="req-item">
            <span class="req-item__icon" aria-hidden="true">${ui.icon("trend")}</span>
            <span class="req-item__main">
              <span class="req-item__title">${ui.escapeHtml(r.requesterName || r.requesterPhone)}${r.note ? ` · ${ui.escapeHtml(r.note)}` : ""}</span>
              <span class="req-item__meta">${statusBadge(r.status)}${r.createdAt ? ` <span class="req-item__meta">${requestTime(r.createdAt)}</span>` : ""}</span>
            </span>
            <span class="req-item__right">
              <span class="req-item__amount">${ui.escapeHtml(r.amountNgn)}</span>
              ${r.status === "PENDING" ? `<button class="btn btn--green btn--small" type="button" data-pay="${ui.escapeHtml(r.id)}">Pay</button>` : ""}
            </span>
          </div>`
      )
      .join("");
    el.querySelectorAll("[data-pay]").forEach((btn) => {
      btn.addEventListener("click", () => openPayModal(btn.dataset.pay, items.find((r) => r.id === btn.dataset.pay)));
    });
  }

  function wireForm() {
    const form = ui.$("#request-form");
    if (!form) return;
    const phone = ui.$("#req-phone");
    const amount = ui.$("#req-amount");
    const note = ui.$("#req-note");
    const submit = ui.$("#request-submit");

    phone.addEventListener("input", () => (phone.value = phone.value.replace(/\D/g, "").slice(0, 11)));
    ui.moneyInput(amount);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      ui.resetFormErrors(form);

      const naira = Number.parseInt(amount.value, 10);
      if (!Number.isSafeInteger(naira) || naira < 1) {
        ui.toast("Enter a whole-naira amount of at least ₦1", "error");
        return;
      }

      submit.disabled = true;
      submit.textContent = "Sending request…";
      try {
        await api("/transactions/request", {
          method: "POST",
          body: {
            payerPhone: phone.value.trim(),
            amountMinor: naira * 100,
            note: note.value.trim() || undefined,
          },
        });
        ui.toast("Request sent", "success");
        form.reset();
        await refresh();
      } catch (err) {
        ui.showFormErrors(form, err);
      } finally {
        submit.disabled = false;
        submit.textContent = "Request";
      }
    });
  }

  function openPayModal(id, item) {
    activeRequestId = id;
    ui.$("#pay-title").textContent = "Pay this request";
    ui.$("#pay-text").textContent = `${item?.amountNgn || ""} to ${item?.requesterName || item?.requesterPhone || "this person"}. This leaves your AgbedePay wallet instantly.`;
    const pin = ui.$("#pay-pin");
    pin.value = "";
    ui.$("#pay-pin-error").style.display = "none";
    ui.$("#pay-modal").hidden = false;
    setTimeout(() => pin.focus(), 50);
  }

  function closePayModal() {
    ui.$("#pay-modal").hidden = true;
    activeRequestId = null;
  }

  function wirePayModal() {
    const backdrop = ui.$("#pay-modal");
    const pin = ui.$("#pay-pin");
    const errorEl = ui.$("#pay-pin-error");
    const confirmBtn = ui.$("#pay-confirm");
    const cancelBtn = ui.$("#pay-cancel");

    pin.addEventListener("input", () => (pin.value = pin.value.replace(/\D/g, "").slice(0, 6)));

    cancelBtn.addEventListener("click", closePayModal);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closePayModal();
    });

    confirmBtn.addEventListener("click", async () => {
      if (!activeRequestId) return;
      if (pin.value.length !== 6) {
        errorEl.textContent = "Enter your 6-digit PIN to confirm.";
        errorEl.style.display = "block";
        return;
      }
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Paying…";
      try {
        await api(`/transactions/requests/${encodeURIComponent(activeRequestId)}/pay`, {
          method: "POST",
          body: { pin: pin.value },
          headers: { "Idempotency-Key": idempotencyKey() },
        });
        ui.toast("Request paid", "success");
        closePayModal();
        await refresh();
        window.location.reload();
      } catch (err) {
        errorEl.textContent = err.message || "Payment failed";
        errorEl.style.display = "block";
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Pay now";
      }
    });
  }
})();