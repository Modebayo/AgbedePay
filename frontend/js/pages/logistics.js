// logistics page — book a courier or errand runner, pay with wallet PIN.
// Booking flow: quote → PIN → escrow hold → simulated tracking with OTP gate.

(function () {
  "use strict";

  const { api, idempotencyKey } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const page = ui.$("#page");

  const STEP_LABELS = ["Order placed", "Rider assigned", "Picked up", "In transit", "Delivered"];
  const STATUS_STEP = { BOOKED: 0, RIDER_ASSIGNED: 1, PICKED_UP: 2, IN_TRANSIT: 3, DELIVERED: 4 };
  const NEXT_ACTION = { BOOKED: "ASSIGN", RIDER_ASSIGNED: "PICKUP", PICKED_UP: "TRANSIT", IN_TRANSIT: "DELIVER" };

  const VEHICLE_HANDLES = {
    DOCUMENT: ["BIKE", "CAR", "VAN"],
    SMALL: ["BIKE", "CAR", "VAN"],
    MEDIUM: ["CAR", "VAN"],
    FRAGILE: ["VAN"],
    HEAVY: ["VAN"],
  };

  const DISPATCH_ISSUES = [
    ["ITEM_DAMAGED", "Item arrived damaged"],
    ["RIDER_LATE", "Rider was late"],
    ["WRONG_ADDRESS", "Wrong address on delivery"],
    ["ITEM_LOST", "Item was lost"],
    ["DELIVERY_ISSUE", "Other delivery issue"],
  ];

  const RATE_TAGS = ["FAST", "POLITE", "CAREFUL"];

  const state = {
    meta: null,
    profilePhone: "",
    favorites: [],
    serviceType: "PACKAGE",
    itemType: "SMALL",
    vehicleType: "CAR",
    pickup: "",
    pickupContact: "",
    dropoff: "",
    dropoffContact: "",
    quote: null,
    booking: null,
    auto: true,
    timer: null,
    focus: "pickup",
  };

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "logistics");
    state.profilePhone = profile.phone || "";
    state.pickupContact = state.profilePhone;
    state.dropoffContact = state.profilePhone;

    try {
      const [meta, places] = await Promise.all([api("/dispatch/meta"), api("/places")]);
      state.meta = meta;
      state.favorites = places.places || [];
    } catch (err) {
      page.innerHTML = `<div class="error-banner error-banner--show" role="alert">${ui.escapeHtml(err.message)}</div>`;
      return;
    }

    renderForm(true);
    renderHistory();

    // Deep link: logistics.html?booking=<id> opens that delivery's tracking
    // view, so a shared or tapped notification lands on the real thing.
    const wanted = new URLSearchParams(window.location.search).get("booking");
    if (wanted) await openBooking(wanted, { quiet: true });
  });

  // ---- Form view ----------------------------------------------------------

  function renderForm(firstBoot) {
    const items = state.meta.itemTypes;
    const vehicles = state.meta.vehicles;

    if (firstBoot) {
      page.innerHTML = `
        <div class="card" id="logi-book-card"></div>
        <div id="logi-quote"></div>
        <div id="logi-track" hidden></div>
        <div class="section-head"><h2>Recent deliveries</h2></div>
        <div id="logi-history"></div>
      `;
    }

    const card = page.querySelector("#logi-book-card");
    card.innerHTML = `
        <div class="error-banner" role="alert"></div>

        <div class="field">
          <label class="field__label">Service</label>
          <div class="chip-grid">
            <button class="chip ${state.serviceType === "PACKAGE" ? "is-selected" : ""}" type="button" data-svc="PACKAGE">Package delivery</button>
            <button class="chip ${state.serviceType === "ERRAND" ? "is-selected" : ""}" type="button" data-svc="ERRAND">Errand</button>
          </div>
        </div>

        <div class="field">
          <label class="field__label">Item</label>
          <div class="chip-grid" id="logi-item-grid">
            ${items
              .map(
                (t) =>
                  `<button class="chip ${state.itemType === t.key ? "is-selected" : ""}" type="button" data-item="${ui.escapeHtml(t.key)}">${ui.escapeHtml(t.label)}</button>`
              )
              .join("")}
          </div>
        </div>

        <div class="field">
          <label class="field__label">Vehicle</label>
          <div class="chip-grid" id="logi-vehicle-grid">${vehicleChips()}</div>
        </div>

        <div class="field">
          <label class="field__label">From a saved place</label>
          <div class="place-row" data-pickup-places>${placeRow()}</div>
        </div>
        <div class="field">
          <label class="field__label">Pickup location</label>
          <input class="input" id="logi-pickup" data-field="pickup" type="text" maxlength="180" value="${ui.escapeHtml(state.pickup)}" placeholder="Where to pick up — e.g. 12 Adeola Odeku, VI" />
          <label class="field__label field__label--sub">Pickup contact</label>
          <input class="input" id="logi-pickup-contact" data-field="pickupContact" type="tel" inputmode="numeric" maxlength="11" value="${ui.escapeHtml(state.pickupContact)}" placeholder="Recipient phone at pickup" />
        </div>

        <div class="field">
          <label class="field__label">To a saved place</label>
          <div class="place-row" data-dropoff-places>${placeRow()}</div>
        </div>
        <div class="field">
          <label class="field__label">Drop-off location</label>
          <input class="input" id="logi-dropoff" data-field="dropoff" type="text" maxlength="180" value="${ui.escapeHtml(state.dropoff)}" placeholder="Where to deliver — e.g. 3 Marina, Lagos Island" />
          <label class="field__label field__label--sub">Drop-off contact</label>
          <input class="input" id="logi-dropoff-contact" data-field="dropoffContact" type="tel" inputmode="numeric" maxlength="11" value="${ui.escapeHtml(state.dropoffContact)}" placeholder="Recipient phone at drop-off" />
        </div>

        <button class="btn btn--green" id="logi-estimate" type="button">Estimate fare</button>
    `;

    card.querySelector(".chip-grid [data-svc]").closest(".chip-grid").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-svc]");
      if (!btn) return;
      state.serviceType = btn.dataset.svc;
      card.querySelectorAll("[data-svc]").forEach((b) => b.classList.toggle("is-selected", b === btn));
      clearQuote();
    });

    card.querySelector("#logi-item-grid").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-item]");
      if (!btn) return;
      state.itemType = btn.dataset.item;
      state.vehicleType = (VEHICLE_HANDLES[state.itemType] || ["CAR"])[0];
      card.querySelectorAll("#logi-item-grid .chip").forEach((b) => b.classList.toggle("is-selected", b === btn));
      card.querySelector("#logi-vehicle-grid").innerHTML = vehicleChips();
      bindVehicleGrid(card);
      clearQuote();
    });

    bindVehicleGrid(card);

    card.querySelectorAll("[data-field]").forEach((input) => {
      input.addEventListener("input", () => {
        state[input.dataset.field] = input.value;
        if (input.dataset.field === "pickup") state.focus = "pickup";
        if (input.dataset.field === "dropoff") state.focus = "dropoff";
        clearQuote();
      });
    });

    card.querySelector("#logi-estimate").addEventListener("click", onEstimate);
    card.querySelectorAll("[data-save-place]").forEach((b) => b.addEventListener("click", onSavePlace));
    card.querySelectorAll("[data-place]").forEach((b) => b.addEventListener("click", onPickPlace));
  }

  function vehicleChips() {
    const allowed = VEHICLE_HANDLES[state.itemType] || ["CAR"];
    return state.meta.vehicles
      .filter((v) => allowed.includes(v.key))
      .map(
        (v) =>
          `<button class="chip ${state.vehicleType === v.key ? "is-selected" : ""}" type="button" data-vehicle="${ui.escapeHtml(v.key)}">${ui.escapeHtml(v.label)} · ₦${ui.escapeHtml(v.ratePerKm)}/km</button>`
      )
      .join("");
  }

  function bindVehicleGrid(card) {
    const grid = card ? card.querySelector("#logi-vehicle-grid") : page.querySelector("#logi-vehicle-grid");
    if (!grid) return;
    grid.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-vehicle]");
      if (!btn) return;
      state.vehicleType = btn.dataset.vehicle;
      grid.querySelectorAll(".chip").forEach((b) => b.classList.toggle("is-selected", b === btn));
      clearQuote();
    });
  }

  function placeRow() {
    return [
      `<span class="place-row__label">Pick</span>`,
      ...state.favorites.map(
        (p) => `<button class="chip chip--mini" type="button" data-place data-place-address="${ui.escapeHtml(p.address)}" data-place-phone="${ui.escapeHtml(p.contactPhone || "")}">${ui.escapeHtml(p.label)}</button>`
      ),
      `<button class="link-btn" type="button" data-save-place>Save current</button>`,
    ].join("");
  }

  function onPickPlace(e) {
    const btn = e.target.closest("[data-place]");
    if (!btn) return;
    const target = state.focus;
    state[target] = btn.dataset.placeAddress;
    if (btn.dataset.placePhone) {
      state[target === "pickup" ? "pickupContact" : "dropoffContact"] = btn.dataset.placePhone;
    }
    renderForm();
    clearQuote();
  }

  async function onSavePlace() {
    const target = state.focus;
    const address = state[target];
    const label = window.prompt("Label for this place (e.g. Home, Office, Market):", target === "pickup" ? "Home" : "Office");
    if (!label) return;
    try {
      await api("/places", {
        method: "POST",
        body: {
          label: String(label).slice(0, 24),
          address,
          contactPhone: state[target === "pickup" ? "pickupContact" : "dropoffContact"],
        },
      });
      ui.toast("Place saved", "success");
      const { places } = await api("/places");
      state.favorites = places.places || [];
      renderForm();
    } catch (err) {
      ui.toast(err.message, "error");
    }
  }

  function clearQuote() {
    state.quote = null;
    const q = ui.$("#logi-quote");
    if (q) q.innerHTML = "";
  }

  async function onEstimate() {
    if (!state.pickup || state.pickup.trim().length < 3 || !state.dropoff || state.dropoff.trim().length < 3) {
      ui.toast("Enter a pickup and drop-off location (min 3 characters)", "error");
      return;
    }
    try {
      const quote = await api("/dispatch/quote", {
        method: "POST",
        body: {
          serviceType: state.serviceType,
          itemType: state.itemType,
          vehicleType: state.vehicleType,
          pickup: state.pickup.trim(),
          dropoff: state.dropoff.trim(),
        },
      });
      state.quote = quote;
      renderQuote();
    } catch (err) {
      ui.toast(err.message, "error");
    }
  }

  function fareLines(quote) {
    return (quote.fareBreakdown || [])
      .map((l) => `<div class="details__row"><span class="details__key">${ui.escapeHtml(l.label)}</span><span class="details__val">${ui.escapeHtml(l.ngn)}</span></div>`)
      .join("");
  }

  function renderQuote() {
    const q = ui.$("#logi-quote");
    q.innerHTML = `
      <div class="card">
        <div class="section-head" style="margin:0 0 4px"><h2>Fare estimate</h2></div>
        <div class="route-panel">
          <div class="route-panel__row">${ui.icon("pin")}<span>${ui.escapeHtml(state.pickup.trim())}</span></div>
          <div class="route-panel__row">${ui.icon("route")}<span>${ui.escapeHtml(q.distanceKm)} km · ~${ui.escapeHtml(q.etaMin)} min</span></div>
          <div class="route-panel__row">${ui.icon("box")}<span>Deliver to ${ui.escapeHtml(state.dropoff.trim())}</span></div>
        </div>
        <div class="details">${fareLines(q)}</div>
        <div class="quote-total">
          <span>To hold in escrow</span>
          <strong>${ui.escapeHtml(q.totalNgn)}</strong>
        </div>
        <button class="btn btn--green" id="logi-book" type="button">Book &amp; pay ${ui.escapeHtml(q.totalNgn)}</button>
        <p class="fund-note">The amount is held in escrow and only released to the rider on delivery. Cancelling anytime refunds it in full.</p>
      </div>
    `;
    q.querySelector("#logi-book").addEventListener("click", onBook);
  }

  async function onBook() {
    if (!state.quote) return;
    const pin = await ui.promptPin({
      title: "Confirm request",
      subtitle: `Pay ${state.quote.totalNgn} with your wallet PIN.`,
      button: "Book",
    });
    if (!pin) return;

    const btn = ui.$("#logi-book");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Booking…";
    }
    try {
      const data = await api("/dispatch/bookings", {
        method: "POST",
        body: {
          serviceType: state.serviceType,
          itemType: state.itemType,
          vehicleType: state.vehicleType,
          pickup: state.pickup.trim(),
          pickupContact: state.pickupContact || state.profilePhone,
          dropoff: state.dropoff.trim(),
          dropoffContact: state.dropoffContact || state.profilePhone,
          pin,
        },
        headers: { "Idempotency-Key": idempotencyKey() },
      });
      ui.toast(data.replayed ? "Already booked" : "Rider will be assigned shortly", "success");
      state.booking = data.booking;
      startTracking();
    } catch (err) {
      ui.toast(err.message, "error");
    } finally {
      const b2 = ui.$("#logi-book");
      if (b2) {
        b2.disabled = false;
        b2.textContent = `Book & pay ${state.quote ? state.quote.totalNgn : ""}`;
      }
    }
  }

  // Open one booking in the tracking view. `quiet` is for the boot deep-link,
  // where a bad id should not shout a toast at someone who just clicked a link.
  async function openBooking(id, { quiet = false } = {}) {
    try {
      const data = await api(`/dispatch/bookings/${id}`);
      state.booking = data.booking;
      ui.$("#logi-book-card").hidden = true;
      const track = ui.$("#logi-track");
      track.hidden = false;
      state.auto = false;
      stopAuto();
      renderTracking();
      if (state.booking.status === "DELIVERED" && !state.booking.rating) renderSuccess();
      track.scrollIntoView({ behavior: "smooth", block: "start" });
      // Keep the URL shareable: copy the deep link, and keep it in sync.
      const url = new URL(window.location.href);
      url.searchParams.set("booking", id);
      window.history.replaceState({}, "", url);
    } catch (err) {
      if (!quiet) ui.toast(err.message, "error");
      if (quiet) {
        ui.toast("That delivery could not be opened.", "error");
        const url = new URL(window.location.href);
        url.searchParams.delete("booking");
        window.history.replaceState({}, "", url);
      }
    }
  }

  // ---- Tracking view ------------------------------------------------------

  function stepIndexOf() {
    return STATUS_STEP[state.booking.status] ?? -1;
  }

  function startTracking() {
    stopAuto();
    ui.$("#logi-book-card").hidden = true;
    const track = ui.$("#logi-track");
    track.hidden = false;
    track.innerHTML = "<div class=\"card\">" + ui.loadingCard("Loading your booking…") + "</div>";
    renderTracking();
    if (state.auto) startAuto();
  }

  function renderTracking() {
    const b = state.booking;
    const step = stepIndexOf();
    const readOnly = step === -1 || step === 4 || b.status === "CANCELLED";
    const card = ui.$("#logi-track");
    card.innerHTML = `
      <div class="card">
        ${ui.stepper(STEP_LABELS, step)}
        ${renderMap(step === -1 ? 0 : step)}
        <div class="info-card">
          <div class="route-panel">
            <div class="route-panel__row">${ui.icon("pin")}<span>${ui.escapeHtml(b.pickupAddress)}</span></div>
            <div class="route-panel__row">${ui.icon("box")}<span>Deliver to ${ui.escapeHtml(b.dropoffAddress)}</span></div>
          </div>
          <div class="details">
            <div class="details__row"><span class="details__key">Reference</span><span class="details__val">${ui.escapeHtml(b.reference)}</span></div>
            <div class="details__row"><span class="details__key">Item</span><span class="details__val">${ui.escapeHtml(b.itemType)} via ${ui.escapeHtml(b.vehicleType)}</span></div>
            <div class="details__row"><span class="details__key">Distance</span><span class="details__val">${ui.escapeHtml(b.distanceKm)} km · ~${ui.escapeHtml(b.etaMin)} min</span></div>
            <div class="details__row"><span class="details__key">Status</span><span class="details__val"><span class="badge badge--${ui.escapeHtml(b.status)}">${ui.escapeHtml(b.statusLabel)}</span></span></div>
          </div>
        </div>
        ${renderRider()}
        ${b.status === "IN_TRANSIT" ? renderOtpGate() : ""}
        ${renderControls(readOnly)}
      </div>
    `;
    bindTracking();
    renderHistory();
  }

  function renderMap(step) {
    const pct = Math.min(100, Math.max(0, Math.round((step / Math.max(1, STEP_LABELS.length - 1)) * 100)));
    return `
      <div class="route-map" aria-hidden="true">
        <div class="route-map__rail">
          <span class="route-map__pin route-map__pin--a">${ui.icon("pin")}</span>
          <span class="route-map__line">
            <span class="route-map__fill" style="height:${pct}%"></span>
          </span>
          <span class="route-map__pin route-map__pin--b">${ui.icon("box")}</span>
          <span class="route-map__carpin" style="top:${pct}%">${ui.icon(step >= 4 ? "box" : "bike")}</span>
        </div>
      </div>`;
  }

  function renderRider() {
    const r = state.booking.rider;
    if (!r) return "";
    return `
      <div class="driver-card">
        <div class="driver-card__left">
          <span class="driver-card__avatar">${r.name.trim().slice(0, 1)}</span>
          <div class="driver-card__info">
            <strong>${ui.escapeHtml(r.name)}</strong>
            <small>${ui.escapeHtml(r.vehicle)} · ${ui.escapeHtml(r.plate)}</small>
            <span class="driver-card__meta">${ui.stars(r.rating)} ${ui.escapeHtml(r.trips)} trips</span>
          </div>
        </div>
        <div class="driver-card__actions">
          <button class="chip chip--mini" type="button" data-call>${ui.icon("phone")}Call</button>
          <button class="chip chip--mini" type="button" data-chat>${ui.icon("chat")}Chat</button>
        </div>
      </div>`;
  }

  function renderOtpGate() {
    return `
      <div class="otp-gate">
        <div class="otp-gate__title">${ui.icon("shield")} Delivery code</div>
        <p class="otp-gate__text">Ask the recipient for the 4-digit delivery code, then enter it below to release the fare.</p>
        <div class="token-box" style="margin:6px 0 12px">
          <div class="token-box__label">DEV/MOCK recipient code</div>
          <div class="token-box__value">${ui.escapeHtml(state.booking.devMock.deliveryCode)}</div>
        </div>
        <div class="field">
          <input class="input input--otp" type="text" inputmode="numeric" maxlength="4" placeholder="4-digit code from the recipient" aria-label="Delivery code" />
          <p class="field__error"></p>
        </div>
        <button class="btn btn--green" type="button" data-deliver>Confirm delivery</button>
      </div>`;
  }

  function renderControls(readOnly) {
    if (readOnly) {
      if (state.booking.status === "CANCELLED") {
        return `<div class="notice" style="margin:14px 0 0"><strong>Booking cancelled</strong>The escrowed amount was refunded to your wallet.</div>`;
      }
      return "";
    }
    return `
      <div class="control-bar">
        <button type="button" class="chip" data-pause>${state.auto ? "Pause" : "Resume"}</button>
        <span class="control-bar__state">${state.auto ? "Auto-advancing every 6s" : "Paused"}</span>
        <button type="button" class="btn btn--small" data-step>Next step</button>
      </div>
      <button class="ghost-btn ghost-btn--danger" type="button" data-cancel>${ui.icon("ban")} Cancel &amp; refund</button>`;
  }

  function bindTracking() {
    const pause = page.querySelector("[data-pause]");
    if (pause) {
      pause.addEventListener("click", () => {
        state.auto = !state.auto;
        if (state.auto) startAuto();
        else stopAuto();
        renderTracking();
      });
    }

    const stepBtn = page.querySelector("[data-step]");
    if (stepBtn) stepBtn.addEventListener("click", manualAdvance);

    const cancelBtn = page.querySelector("[data-cancel]");
    if (cancelBtn) cancelBtn.addEventListener("click", onCancel);

    page.querySelectorAll("[data-call]").forEach((b) =>
      b.addEventListener("click", () => ui.toast(`Calling ${state.booking.rider.phone} (simulated)`))
    );
    page.querySelectorAll("[data-chat]").forEach((b) =>
      b.addEventListener("click", () => ui.toast("Chat with your rider is simulated"))
    );

    const deliver = page.querySelector("[data-deliver]");
    if (deliver) {
      deliver.addEventListener("click", async () => {
        const input = page.querySelector(".input--otp");
        const otp = (input.value || "").replace(/\D/g, "");
        if (otp.length !== 4) {
          input.closest(".field").classList.add("field--invalid");
          input.closest(".field").querySelector(".field__error").textContent = "Enter the 4-digit delivery code.";
          return;
        }
        deliver.disabled = true;
        deliver.textContent = "Confirming…";
        try {
          const data = await api(`/dispatch/bookings/${state.booking.id}/advance`, {
            method: "POST",
            body: { action: "DELIVER", otp },
          });
          state.booking = data.booking;
          ui.toast("Delivery confirmed — fare released to the rider", "success");
          renderTracking();
          renderSuccess();
        } catch (err) {
          input.closest(".field").classList.add("field--invalid");
          input.closest(".field").querySelector(".field__error").textContent = err.message;
        } finally {
          deliver.disabled = false;
          deliver.textContent = "Confirm delivery";
        }
      });
    }
  }

  function manualAdvance() {
    const b = state.booking;
    const action = NEXT_ACTION[b.status];
    if (!action) return;
    if (action === "DELIVER") {
      ui.toast("Enter the delivery code from the recipient to finish", "error");
      return;
    }
    runAdvance(action);
  }

  function runAdvance(action) {
    return api(`/dispatch/bookings/${state.booking.id}/advance`, {
      method: "POST",
      body: { action },
    })
      .then((data) => {
        state.booking = data.booking;
        renderTracking();
      })
      .catch((err) => ui.toast(err.message, "error"));
  }

  function startAuto() {
    stopAuto();
    state.timer = window.setInterval(() => {
      const b = state.booking;
      if (!b) return;
      if (b.status === "IN_TRANSIT" || b.status === "DELIVERED" || b.status === "CANCELLED") {
        stopAuto();
        return;
      }
      const action = NEXT_ACTION[b.status];
      if (action) runAdvance(action);
    }, 6000);
  }

  function stopAuto() {
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
  }

  async function onCancel() {
    const r = await ui.promptPin({
      title: "Cancel this booking?",
      subtitle: "The escrowed amount is refunded to your wallet in full.",
      button: "Cancel booking",
    });
    if (!r) return;
    try {
      const data = await api(`/dispatch/bookings/${state.booking.id}/cancel`, { method: "POST" });
      state.booking = data.booking;
      ui.toast(`Refunded ${data.refundedNgn}`, "success");
      stopAuto();
      renderTracking();
    } catch (err) {
      ui.toast(err.message, "error");
    }
  }

  // ---- Post-delivery rating & issues --------------------------------------

  function renderSuccess() {
    if (state.booking.status !== "DELIVERED") return;
    const id = state.booking.id;
    if (state.booking.rating) {
      return;
    }
    const sec = document.createElement("div");
    sec.className = "card";
    sec.id = "logi-post";
    sec.innerHTML = `
      <div class="success-card">
        <div class="success-card__icon">${ui.icon("check")}</div>
        <div class="success-card__title">Delivered</div>
        <div class="success-card__sub">${ui.escapeHtml(state.booking.totalNgn)} released to ${ui.escapeHtml(state.booking.rider ? state.booking.rider.name : "the rider")}.</div>
        <p class="success-card__meta">Reference: ${ui.escapeHtml(state.booking.reference)}</p>
        <a class="btn btn--primary btn--small" href="transaction.html?id=${encodeURIComponent(state.booking.transactionId)}">View transaction</a>
      </div>
      <div class="divider"></div>
      ${renderRating(id)}
      <div class="divider"></div>
      ${renderIssue(id)}
    `;
    const before = ui.$("#logi-track");
    before.parentNode.insertBefore(sec, before.nextSibling);
    bindPost(id, sec);
  }

  function renderRating(id) {
    return `
      <div class="rate-block">
        <h3 class="rate-block__title">Rate your rider</h3>
        <div class="star-input" data-rating>${Array.from({ length: 5 }, (_, i) => `<button type="button" class="star-btn" data-n="${i + 1}" aria-label="${i + 1} star">${ui.icon("star")}</button>`).join("")}</div>
        <div class="rate-block__tags">${ui.tagChips(RATE_TAGS)}</div>
        <button class="btn btn--primary btn--small" type="button" data-rate-submit>Submit rating</button>
      </div>`;
  }

  function renderIssue(id) {
    return `
      <div class="rate-block">
        <h3 class="rate-block__title">Something wrong? Report an issue</h3>
        <select class="input" data-issue-type>
          ${DISPATCH_ISSUES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}
        </select>
        <textarea class="input" data-issue-note maxlength="300" placeholder="Anything we should know (optional)"></textarea>
        <button class="btn btn--small" type="button" data-issue-submit>Report issue</button>
      </div>`;
  }

  function bindPost(id, sec) {
    const stars = sec.querySelectorAll(".star-btn");
    let rating = 0;
    let tags = [];
    stars.forEach((s) =>
      s.addEventListener("click", () => {
        rating = Number(s.dataset.n);
        stars.forEach((x) => x.classList.toggle("is-filled", Number(x.dataset.n) <= rating));
      })
    );
    sec.querySelectorAll(".tag-chip").forEach((c) =>
      c.addEventListener("click", () => {
        c.classList.toggle("is-selected");
        tags = Array.from(sec.querySelectorAll(".tag-chip.is-selected")).map((x) => x.dataset.tag);
      })
    );
    sec.querySelector("[data-rate-submit]").addEventListener("click", async () => {
      if (!rating) return ui.toast("Tap a star to rate", "error");
      try {
        const data = await api(`/dispatch/bookings/${id}/rate`, {
          method: "POST",
          body: { rating, tags: tags.join(",") },
        });
        state.booking = data.booking;
        sec.remove();
        ui.toast("Thanks for your rating", "success");
      } catch (err) {
        ui.toast(err.message, "error");
      }
    });
    sec.querySelector("[data-issue-submit]").addEventListener("click", async () => {
      const st = sec.querySelector("[data-issue-type]");
      const note = sec.querySelector("[data-issue-note]");
      try {
        await api(`/dispatch/bookings/${id}/issue`, {
          method: "POST",
          body: { issueType: st.value, note: note.value.trim() },
        });
        st.disabled = true;
        note.disabled = true;
        ui.toast("Issue reported — our team will review it", "success");
      } catch (err) {
        ui.toast(err.message, "error");
      }
    });
  }

  // ---- History -------------------------------------------------------------

  async function renderHistory() {
    const el = ui.$("#logi-history");
    try {
      const { items } = await api("/dispatch/bookings");
      if (!items.length) {
        el.innerHTML = `<div class="empty">No deliveries yet — book one above.</div>`;
        return;
      }
      el.innerHTML = items
        .map((b) => {
          const active = b.status !== "DELIVERED" && b.status !== "CANCELLED";
          const label = active ? "Resume" : "View";
          return `
            <a class="tx-item" href="#" data-open="${b.id}">
              <div class="tx-item__icon" aria-hidden="true">${ui.icon("box")}</div>
              <div class="tx-item__main">
                <div class="tx-item__title">${ui.escapeHtml(b.pickupAddress)} → ${ui.escapeHtml(b.dropoffAddress)}</div>
                <div class="tx-item__meta">
                  <span class="badge badge--${b.status}">${b.status}</span>
                  <span>${ui.escapeHtml(b.totalNgn)}</span>
                </div>
              </div>
              <div class="tx-item__right"><button class="btn btn--small" type="button">${label}</button></div>
            </a>`;
        })
        .join("");
      el.querySelectorAll("[data-open]").forEach((row) =>
        row.addEventListener("click", async (e) => {
          e.preventDefault();
          await openBooking(row.dataset.open);
        })
      );
    } catch (err) {
      el.innerHTML = `<div class="error-banner error-banner--show">${ui.escapeHtml(err.message)}</div>`;
    }
  }
})();