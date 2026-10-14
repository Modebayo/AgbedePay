// cargo page — Agbede Cargo quotation requests.
//
// Cargo is larger, non-instant freight: the user describes the move, we record
// a request and an admin prices it offline. Nothing is charged here, so there
// is no PIN step and no money logic — only the request form and its history.

(function () {
  "use strict";

  const { api } = window.AgbeAPI;
  const ui = window.AgbeUI;
  const page = ui.$("#page");

  const CARGO_TYPES = [
    "Furniture & household",
    "Appliances & electronics",
    "Building materials",
    "Business goods & stock",
    "Machinery & equipment",
    "Agricultural produce",
    "General goods",
    "Other",
  ];

  const status = {
    REQUESTED: "badge--PENDING",
    QUOTED: "badge--SUCCESS",
    ACCEPTED: "badge--SUCCESS",
    CLOSED: "badge--PENDING",
    CANCELLED: "badge--CANCELLED",
  };

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "services");

    page.innerHTML = `
      <div class="card" id="cargo-form-card"></div>
      <div class="section-head"><h2>My requests</h2></div>
      <div id="cargo-list"></div>
    `;

    renderForm(profile);
    await loadList();

    const wanted = new URLSearchParams(window.location.search).get("request");
    if (wanted) ui.$("#cargo-list").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  function renderForm(profile) {
    ui.$("#cargo-form-card").innerHTML = `
      <div class="section-head" style="margin:0 0 10px"><h2>Request a quote</h2></div>
      <form id="cargo-form" novalidate>
        <div class="error-banner" role="alert"></div>

        <div class="field">
          <label class="field__label" for="cargo-pickup">Pickup address</label>
          <input class="input" id="cargo-pickup" name="pickupAddress" type="text" maxlength="180" placeholder="Where should we collect from?" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="cargo-dropoff">Destination address</label>
          <input class="input" id="cargo-dropoff" name="dropoffAddress" type="text" maxlength="180" placeholder="Where is it going?" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="cargo-type">Cargo type</label>
          <select class="input" id="cargo-type" name="cargoType" required>
            <option value="">Select…</option>
            ${CARGO_TYPES.map((t) => `<option value="${ui.escapeHtml(t)}">${ui.escapeHtml(t)}</option>`).join("")}
          </select>
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="cargo-weight">Approx. weight (kg) — optional</label>
          <input class="input" id="cargo-weight" name="approxWeightKg" type="number" min="0" step="0.1" inputmode="decimal" />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="cargo-dims">Dimensions — optional</label>
          <input class="input" id="cargo-dims" name="dimensions" type="text" maxlength="80" placeholder="e.g. 2m x 1.2m x 1m" />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="cargo-vehicle">Vehicle requirements — optional</label>
          <input class="input" id="cargo-vehicle" name="vehicleRequirements" type="text" maxlength="120" placeholder="e.g. covered van, tail-lift" />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="cargo-date">Preferred collection date — optional</label>
          <input class="input" id="cargo-date" name="collectionDate" type="date" />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="cargo-contact-name">Contact name</label>
          <input class="input" id="cargo-contact-name" name="contactName" type="text" maxlength="120" value="${ui.escapeHtml(profile.fullName || "")}" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="cargo-contact-phone">Contact phone</label>
          <input class="input" id="cargo-contact-phone" name="contactPhone" type="tel" maxlength="11" inputmode="numeric" value="${ui.escapeHtml(profile.phone || "")}" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="cargo-notes">Notes — optional</label>
          <textarea class="input" id="cargo-notes" name="notes" maxlength="500" rows="3" placeholder="Anything the driver should know?"></textarea>
          <p class="field__error"></p>
        </div>

        <button class="btn btn--green" id="cargo-submit" type="submit">Request quote</button>
        <p class="fund-note">We'll review your request and send a price. No money is taken now.</p>
      </form>`;

    ui.$("#cargo-form").addEventListener("submit", onSubmit);
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    ui.resetFormErrors(form);
    const submit = ui.$("#cargo-submit");

    const weightRaw = ui.$("#cargo-weight").value.trim();
    const body = {
      pickupAddress: ui.$("#cargo-pickup").value.trim(),
      dropoffAddress: ui.$("#cargo-dropoff").value.trim(),
      cargoType: ui.$("#cargo-type").value,
      approxWeightKg: weightRaw ? Number(weightRaw) : undefined,
      dimensions: ui.$("#cargo-dims").value.trim() || undefined,
      vehicleRequirements: ui.$("#cargo-vehicle").value.trim() || undefined,
      collectionDate: ui.$("#cargo-date").value || undefined,
      contactName: ui.$("#cargo-contact-name").value.trim(),
      contactPhone: ui.$("#cargo-contact-phone").value.replace(/\D/g, ""),
      notes: ui.$("#cargo-notes").value.trim() || undefined,
    };

    if (!body.pickupAddress || !body.dropoffAddress || !body.cargoType || !body.contactName || !body.contactPhone) {
      ui.toast("Please fill in the required fields.", "error");
      return;
    }

    submit.disabled = true;
    submit.textContent = "Sending…";
    try {
      const { quote } = await api("/cargo/requests", { method: "POST", body });
      ui.toast(`Request ${quote.reference} sent — we'll be in touch.`, "success");
      form.reset();
      await loadList();
      ui.$("#cargo-list").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      ui.showFormErrors(form, err);
    } finally {
      submit.disabled = false;
      submit.textContent = "Request quote";
    }
  }

  async function loadList() {
    const el = ui.$("#cargo-list");
    el.innerHTML = ui.loadingCard("Loading your requests…");
    let data;
    try {
      data = await api("/cargo/requests");
    } catch (err) {
      el.innerHTML = `<div class="error-banner error-banner--show" role="alert">${ui.escapeHtml(err.message)}</div>`;
      return;
    }

    if (!data.items.length) {
      el.innerHTML = `<div class="card"><p class="page-sub" style="margin:0">No cargo requests yet. Submit one above and our team will send a quote.</p></div>`;
      return;
    }

    el.innerHTML = data.items.map(card).join("");

    el.querySelectorAll("[data-cancel]").forEach((btn) => {
      btn.addEventListener("click", () => cancelRequest(btn.getAttribute("data-cancel")));
    });
  }

  function card(q) {
    const badge = status[q.status] || "badge--PENDING";
    const quoteLine = q.quotedAmountNgn
      ? `<div class="route-panel__row">${ui.icon("wallet")}<span>Quote: <strong>${ui.escapeHtml(q.quotedAmountNgn)}</strong></span></div>`
      : "";
    const adminNote = q.adminNote
      ? `<p class="fund-note">Note from our team: ${ui.escapeHtml(q.adminNote)}</p>`
      : "";
    const cancelBtn =
      q.status === "REQUESTED"
        ? `<button class="btn btn--ghost btn--small" data-cancel="${ui.escapeHtml(q.id)}" type="button" style="margin-top:10px">Cancel request</button>`
        : "";

    return `
      <div class="card">
        <div class="section-head" style="margin:0 0 8px">
          <h2>${ui.escapeHtml(q.cargoType)}</h2>
          <span class="badge ${badge}">${ui.escapeHtml(q.statusLabel)}</span>
        </div>
        <div class="route-panel">
          <div class="route-panel__row">${ui.icon("pin")}<span>${ui.escapeHtml(q.pickupAddress)}</span></div>
          <div class="route-panel__row">${ui.icon("route")}<span>${ui.escapeHtml(q.dropoffAddress)}</span></div>
          ${quoteLine}
        </div>
        ${adminNote}
        <p class="hint">Ref ${ui.escapeHtml(q.reference)}${q.collectionDate ? ` · collect ${ui.escapeHtml(q.collectionDate)}` : ""}</p>
        ${cancelBtn}
      </div>`;
  }

  async function cancelRequest(id) {
    if (!window.confirm("Cancel this cargo request?")) return;
    try {
      await api(`/cargo/requests/${id}/cancel`, { method: "POST" });
      ui.toast("Request cancelled.", "success");
      await loadList();
    } catch (err) {
      ui.toast(err.message, "error");
    }
  }
})();
