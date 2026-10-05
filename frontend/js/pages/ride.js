// ride page — book an Economy/Comfort/Bargain trip, pay with wallet PIN.
// Flow: quote → PIN → escrow hold → radar/searching → driver card → trip
// progress → rating. Bargain offers are decided before any debit.

(function () {
  "use strict";

  const { api, idempotencyKey } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const page = ui.$("#page");

  const STEP_LABELS = ["Searching", "Driver accepted", "Driver arriving", "In progress", "Completed"];
  const STATUS_STEP = { SEARCHING: 0, DRIVER_ACCEPTED: 1, DRIVER_ARRIVING: 2, IN_PROGRESS: 3, COMPLETED: 4 };
  const NEXT_ACTION = { SEARCHING: "ACCEPT", DRIVER_ACCEPTED: "ARRIVE", DRIVER_ARRIVING: "START", IN_PROGRESS: "COMPLETE" };

  const TIER_CAPS = { ECONOMY: 4, COMFORT: 4, BARGAIN: 1 };

  const RIDE_ISSUES = [
    ["ITEM_LEFT_IN_CAR", "I left something in the car"],
    ["INCORRECT_FARE", "The fare was wrong"],
    ["DRIVER_CANCELLED", "Driver cancelled on me"],
    ["UNPROFESSIONAL", "Driver behaviour"],
    ["LONG_ROUTE", "Driver took a long route"],
  ];

  const RATE_TAGS = ["CLEAN_CAR", "POLITE", "SMOOTH_DRIVING", "FAST"];

  const TIP_CHOICES = [
    { label: "No tip", minor: 0 },
    { label: "₦200", minor: 20000 },
    { label: "₦500", minor: 50000 },
    { label: "Custom", minor: "custom" },
  ];

  const state = {
    meta: null,
    profilePhone: "",
    favorites: [],
    tier: "ECONOMY",
    passengers: 1,
    pickup: "",
    pickupContact: "",
    dropoff: "",
    bargainMinor: null,
    tipMinor: 0,
    quote: null,
    booking: null,
    auto: true,
    timer: null,
    focus: "pickup",
  };

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "ride");
    state.profilePhone = profile.phone || "";
    state.pickupContact = state.profilePhone;

    try {
      const [meta, places] = await Promise.all([api("/ride/meta"), api("/places")]);
      state.meta = meta;
      state.favorites = places.places || [];
    } catch (err) {
      page.innerHTML = `<div class="error-banner error-banner--show" role="alert">${ui.escapeHtml(err.message)}</div>`;
      return;
    }

    renderForm(true);
    renderHistory();

    // Deep link: ride.html?booking=<id> opens that trip's tracking view, so a
    // tapped notification or a shared URL lands on the real thing.
    const wanted = new URLSearchParams(window.location.search).get("booking");
    if (wanted) await openBooking(wanted, { quiet: true });
  });

  // Open one trip in the tracking view (also used by the history list).
  async function openBooking(id, { quiet = false } = {}) {
    try {
      const data = await api(`/ride/bookings/${id}`);
      state.booking = data.booking;
      ui.$("#ride-book-card").hidden = true;
      const track = ui.$("#ride-track");
      track.hidden = false;
      state.auto = false;
      stopAuto();
      renderTracking();
      if (data.booking.status === "COMPLETED" && !data.booking.rating) renderSuccess();
      track.scrollIntoView({ behavior: "smooth", block: "start" });
      // Keep the URL shareable, and in sync with what is on screen.
      const url = new URL(window.location.href);
      url.searchParams.set("booking", id);
      window.history.replaceState({}, "", url);
    } catch (err) {
      if (quiet) {
        ui.toast("That trip could not be opened.", "error");
        const url = new URL(window.location.href);
        url.searchParams.delete("booking");
        window.history.replaceState({}, "", url);
      } else {
        ui.toast(err.message, "error");
      }
    }
  }

  // ---- Form view ----------------------------------------------------------

  function renderForm(firstBoot) {
    const tiers = state.meta.tiers;

    if (firstBoot) {
      page.innerHTML = `
        <div class="card" id="ride-book-card"></div>
        <div id="ride-quote"></div>
        <div id="ride-track" hidden></div>
        <div class="section-head"><h2>Recent rides</h2></div>
        <div id="ride-history"></div>
      `;
    }

    const card = page.querySelector("#ride-book-card");
    card.innerHTML = `
        <div class="error-banner" role="alert"></div>

        <div class="field">
          <label class="field__label">Tier</label>
          <div class="tier-grid">
            ${tiers
              .map((t) => {
                const sel = state.tier === t.key;
                return `
                <button class="tier-card ${sel ? "is-selected" : ""}" type="button" data-tier="${ui.escapeHtml(t.key)}">
                  <span class="tier-card__top">
                    <strong>${ui.escapeHtml(t.label)}</strong>
                    ${ui.icon(t.key === "ECONOMY" ? "car" : t.key === "COMFORT" ? "van" : "tag")}
                  </span>
                  <span class="tier-card__rate">₦${ui.escapeHtml(t.ratePerKm)}/km</span>
                  <span class="tier-card__pax">Up to ${ui.escapeHtml(t.maxPassengers)} passenger${t.maxPassengers === 1 ? "" : "s"}</span>
                </button>`;
              })
              .join("")}
          </div>
        </div>

        <div class="field">
          <label class="field__label">Passengers</label>
          <div class="stepper-row">
            <button class="chip" type="button" data-pax-minus aria-label="Fewer passengers">${ui.icon("minus")}</button>
            <span class="stepper-row__value" data-pax-value>${state.passengers}</span>
            <button class="chip" type="button" data-pax-plus aria-label="More passengers">+</button>
            <span class="stepper-row__hint">max ${state.tier === "BARGAIN" ? 1 : 4}</span>
          </div>
        </div>

        ${state.tier === "BARGAIN" ? bargainField() : ""}

        <div class="field">
          <label class="field__label">Pickup</label>
          <div class="place-row" data-ride-places>${placeRow()}</div>
          <input class="input" data-field="pickup" type="text" maxlength="180" value="${ui.escapeHtml(state.pickup)}" placeholder="Pickup location — e.g. Lekki Phase 1" />
        </div>
        <div class="field">
          <label class="field__label">Drop-off</label>
          <div class="place-row" data-ride-places>${placeRow()}</div>
          <input class="input" data-field="dropoff" type="text" maxlength="180" value="${ui.escapeHtml(state.dropoff)}" placeholder="Where to go — e.g. Victoria Island" />
        </div>

        <div class="field">
          <label class="field__label">Tip the driver (optional, pre-paid)</label>
          <div class="chip-grid">${tipChips()}</div>
        </div>

        <button class="btn btn--green" id="ride-estimate" type="button">Estimate fare</button>
    `;

    card.querySelector(".tier-grid").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tier]");
      if (!btn) return;
      state.tier = btn.dataset.tier;
      if (state.passengers > TIER_CAPS[state.tier]) state.passengers = TIER_CAPS[state.tier];
      if (state.tier !== "BARGAIN") state.bargainMinor = null;
      renderForm();
      clearQuote();
    });

    card.querySelector("[data-pax-minus]").addEventListener("click", () => {
      if (state.passengers > 1) {
        state.passengers -= 1;
        renderForm();
        clearQuote();
      }
    });
    card.querySelector("[data-pax-plus]").addEventListener("click", () => {
      const cap = TIER_CAPS[state.tier];
      if (state.passengers < cap) {
        state.passengers += 1;
        renderForm();
        clearQuote();
      }
    });

    const bargain = card.querySelector("[data-bargain]");
    if (bargain) {
      bargain.addEventListener("input", () => {
        bargain.value = bargain.value.replace(/\D/g, "").slice(0, 7);
        state.bargainMinor = bargain.value ? Number(bargain.value) * 100 : null;
        clearQuote();
      });
      card.querySelector("[data-bargain-tip]").addEventListener("click", () => {
        if (state.quote) bargain.value = Math.round(state.quote.totalMinor / 100);
      });
    }

    card.querySelectorAll("[data-tip]").forEach((b) =>
      b.addEventListener("click", () => {
        const minor = b.dataset.tip === "custom" ? "custom" : Number(b.dataset.tip);
        state.tipMinor = minor;
        const row = b.closest(".chip-grid");
        card.querySelectorAll("[data-tip]").forEach((x) => x.classList.toggle("is-selected", x === b));
        const custom = row.querySelector("[data-tip-custom]");
        if (custom) custom.style.display = minor === "custom" ? "block" : "none";
        if (minor !== "custom") {
          clearQuote();
        }
      })
    );
    const tipCustom = card.querySelector("[data-tip-custom] input");
    if (tipCustom) {
      tipCustom.addEventListener("input", () => {
        tipCustom.value = tipCustom.value.replace(/\D/g, "").slice(0, 5);
        state.tipMinor = tipCustom.value ? Number(tipCustom.value) * 100 : 0;
        clearQuote();
      });
    }

    card.querySelectorAll("[data-field]").forEach((input) => {
      input.addEventListener("input", () => {
        state[input.dataset.field] = input.value;
        state.focus = input.dataset.field;
        clearQuote();
      });
    });

    card.querySelector("[data-save-place]").addEventListener("click", onSavePlace);
    card.querySelectorAll("[data-place]").forEach((b) => b.addEventListener("click", onPickPlace));

    card.querySelector("#ride-estimate").addEventListener("click", onEstimate);
  }

  function bargainField() {
    return `
      <div class="notice" style="margin:0 0 16px">
        <strong>Bargain rides</strong>
        Propose a fare and nearby drivers snap it up when it's fair. Offers below ~80% of our estimate are usually declined — and nothing is charged on a decline.
      </div>
      <div class="field">
        <label class="field__label">Your offer</label>
        <div class="bargain-row">
          <span class="bargain-row__prefix">₦</span>
          <input class="input bargain-row__input" type="text" inputmode="numeric" data-bargain placeholder="Offer amount (e.g. 2500)" />
        </div>
        <p class="field__hint"><button class="link-btn" type="button" data-bargain-tip>Use our estimate</button> when available.</p>
        <p class="bargain-error" role="alert"></p>
      </div>`;
  }

  function tipChips() {
    const sel = (m) => state.tipMinor === m || (m === "custom" && state.tipMinor === "custom");
    return TIP_CHOICES.map((c) => {
      const isCustomSel = c.minor === "custom" && state.tipMinor === "custom";
      const isNumSel = c.minor !== "custom" && state.tipMinor === c.minor;
      const amount = c.label === "Custom" ? 0 : c.minor;
      const label = c.minor === "custom" ? "Custom" : c.label;
      return `<button class="chip ${isNumSel || isCustomSel ? "is-selected" : ""}" type="button" data-tip="${ui.escapeHtml(String(c.minor))}">${ui.escapeHtml(label)}</button>`;
    })
      .join("") + `
      <div class="custom-tip" data-tip-custom style="display:${state.tipMinor === "custom" ? "block" : "none"}">
        <span class="bargain-row__prefix">₦</span>
        <input class="input bargain-row__input" type="text" inputmode="numeric" maxlength="5" placeholder="Tip amount" />
      </div>`;
  }

function placeRow() {
  const favs = state.favorites.map((p) => ({ address: p.address, phone: p.contactPhone }));
  return [
    `<span class="place-row__label">Pick</span>`,
    ...favs.map(
      (p) => `<button class="chip chip--mini" type="button" data-place data-place-address="${ui.escapeHtml(p.address)}" data-place-phone="${ui.escapeHtml(p.phone || "")}">${ui.escapeHtml(p.label)}</button>`
    ),
    `<button class="link-btn" type="button" data-save-place>Save current</button>`,
  ].join("");
}

function onPickPlace(e) {
  const btn = e.target.closest("[data-place]");
  if (!btn) return;
  const field = state.focus;
  state[field] = btn.dataset.placeAddress;
  if (btn.dataset.placePhone && field === "pickup") state.pickupContact = btn.dataset.placePhone;
  renderForm();
  clearQuote();
}

async function onSavePlace() {
  const field = state.focus;
  const address = state[field];
  const label = window.prompt("Label for this place (e.g. Home, Office, Market):", "Home");
  if (!label) return;
  try {
    await api("/places", {
      method: "POST",
      body: {
        label: String(label).slice(0, 24),
        address,
        contactPhone: field === "pickup" ? state.pickupContact : "",
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
    const q = ui.$("#ride-quote");
    if (q) q.innerHTML = "";
  }

  function fareLines(quote) {
    return (quote.fareBreakdown || [])
      .map((l) => `<div class="details__row"><span class="details__key">${ui.escapeHtml(l.label)}</span><span class="details__val">${ui.escapeHtml(l.ngn)}</span></div>`)
      .join("");
  }

  async function onEstimate() {
    if (state.pickup.trim().length < 3 || state.dropoff.trim().length < 3) {
      ui.toast("Enter a pickup and a drop-off location (min 3 characters)", "error");
      return;
    }
    if (state.tier === "BARGAIN" && (!state.bargainMinor || state.bargainMinor < 100)) {
      ui.toast("Enter your bargain offer above ₦1", "error");
      return;
    }
    try {
      const quote = await api("/ride/quote", {
        method: "POST",
        body: {
          tier: state.tier,
          passengers: state.passengers,
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

  function renderQuote() {
    const q = ui.$("#ride-quote");
    const tipMinor = typeof state.tipMinor === "number" ? state.tipMinor : 0;
    const tipNgn = tipMinor ? (tipMinor / 100).toLocaleString("en-NG", { style: "currency", currency: "NGN" }) : "";
    const totalPreview = ((state.quote.totalMinor + tipMinor) / 100).toLocaleString("en-NG", { style: "currency", currency: "NGN" });
    q.innerHTML = `
      <div class="card">
        <div class="section-head" style="margin:0 0 4px"><h2>Fare estimate — ${ui.escapeHtml(state.quote.surge > 1 ? "higher demand pricing" : "standard pricing")}</h2></div>
        <div class="route-panel">
          <div class="route-panel__row">${ui.icon("pin")}<span>${ui.escapeHtml(state.pickup.trim())}</span></div>
          <div class="route-panel__row">${ui.icon("route")}<span>${ui.escapeHtml(state.quote.distanceKm)} km · ~${ui.escapeHtml(state.quote.etaMin)} min</span></div>
          <div class="route-panel__row">${ui.icon("car")}<span>${ui.escapeHtml(state.passengers)} passenger${state.passengers === 1 ? "" : "s"} to ${ui.escapeHtml(state.dropoff.trim())}</span></div>
        </div>
        <div class="details">
          ${fareLines(state.quote)}
          ${tipMinor ? `<div class="details__row"><span class="details__key">Driver tip</span><span class="details__val">${ui.escapeHtml(tipNgn)}</span></div>` : ""}
        </div>
        <div class="quote-total">
          <span><small>Fare</small>${ui.escapeHtml(state.quote.totalNgn)}${tipMinor ? `<br><small>+ tip</small>${ui.escapeHtml(tipNgn)}` : ""}</span>
          <strong>${ui.escapeHtml(totalPreview)}</strong>
        </div>
        ${state.tier === "BARGAIN" ? `<p class="fund-note">Your offer of ${ui.escapeHtml(((state.bargainMinor || 0) / 100).toLocaleString("en-NG", { style: "currency", currency: "NGN" }))} will be sent to nearby drivers. It is held only if accepted.</p>` : ""}
        <button class="btn btn--green" id="ride-book" type="button">Request ride · ${ui.escapeHtml(totalPreview)}</button>
        <p class="fund-note">The fare is held in escrow and released to the driver after the trip. Tipping is per your selection.</p>
      </div>
    `;
    q.querySelector("#ride-book").addEventListener("click", onBook);
  }

  async function onBook() {
    const q = state.quote;
    if (!q) return;
    const totalPreview = ((q.totalMinor + (typeof state.tipMinor === "number" ? state.tipMinor : 0)) / 100).toLocaleString("en-NG", { style: "currency", currency: "NGN" });
    const pin = await ui.promptPin({
      title: "Request ride",
      subtitle: `Pay ${totalPreview} with your wallet PIN.`,
      button: "Request",
    });
    if (!pin) return;

    const btn = ui.$("#ride-book");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Requesting…";
    }

    const body = {
      tier: state.tier,
      passengers: state.passengers,
      pickup: state.pickup.trim(),
      pickupContact: state.pickupContact || state.profilePhone,
      dropoff: state.dropoff.trim(),
      tipMinor: typeof state.tipMinor === "number" ? state.tipMinor : 0,
      pin,
    };
    if (state.tier === "BARGAIN") body.bargainOfferMinor = state.bargainMinor;

    try {
      const data = await api("/ride/bookings", {
        method: "POST",
        body,
        headers: { "Idempotency-Key": idempotencyKey() },
      });
      if (data.declined) {
        ui.toast(data.notice || "Your offer was declined", "error");
        const errEl = page.querySelector("[data-bargain]")?.closest(".field")?.querySelector(".bargain-error");
        if (errEl) {
          errEl.textContent = data.notice || "Offer declined — try a higher amount.";
        }
        return;
      }
      ui.toast(data.replayed ? "This ride was already booked" : "Looking for a nearby driver…", "success");
      state.booking = data.booking;
      startTracking();
    } catch (err) {
      ui.toast(err.message, "error");
    } finally {
      const b2 = ui.$("#ride-book");
      if (b2) {
        b2.disabled = false;
        b2.textContent = `Request ride · ${totalPreview}`;
      }
    }
  }

  // ---- Tracking view ------------------------------------------------------

  function stepIndexOf() {
    return STATUS_STEP[state.booking.status] ?? -1;
  }

  function startTracking() {
    stopAuto();
    ui.$("#ride-book-card").hidden = true;
    const track = ui.$("#ride-track");
    track.hidden = false;
    track.innerHTML = `<div class="card">${ui.loadingCard("Finding your driver…")}</div>`;
    renderTracking();
    if (state.auto) startAuto();
  }

  function renderTracking() {
    const b = state.booking;
    const step = stepIndexOf();
    const done = step === 4 || b.status === "CANCELLED";
    const track = ui.$("#ride-track");
    track.innerHTML = `
      <div class="card">
        ${ui.stepper(STEP_LABELS, step)}
        ${step === 0 ? renderSearching() : renderMap(step)}
        <div class="info-card">
          <div class="route-panel">
            <div class="route-panel__row">${ui.icon("pin")}<span>${ui.escapeHtml(b.pickupAddress)}</span></div>
            <div class="route-panel__row">${ui.icon("car")}<span>To ${ui.escapeHtml(b.dropoffAddress)}</span></div>
          </div>
          <div class="details">
            <div class="details__row"><span class="details__key">Reference</span><span class="details__val">${ui.escapeHtml(b.reference)}</span></div>
            <div class="details__row"><span class="details__key">Tier</span><span class="details__val">${ui.escapeHtml(b.tierLabel)} · ${ui.escapeHtml(b.distanceKm)} km</span></div>
            <div class="details__row"><span class="details__key">Total</span><span class="details__val">${ui.escapeHtml(b.totalNgn)}${b.tipMinor ? " + tip " + ui.escapeHtml(b.tipNgn) : ""}</span></div>
            <div class="details__row"><span class="details__key">Status</span><span class="details__val"><span class="badge badge--${ui.escapeHtml(b.status)}">${ui.escapeHtml(b.statusLabel)}</span></span></div>
          </div>
        </div>
        ${renderDriver()}
        ${b.driver && step >= 1 && step < 4 ? renderSafety() : ""}
        ${b.status === "CANCELLED" ? `<div class="notice" style="margin:14px 0 0"><strong>Trip cancelled</strong>The escrowed amount was refunded to your wallet.</div>` : ""}
        ${done && b.status === "COMPLETED" ? "" : renderControls(done)}
      </div>
    `;
    bindTracking();
    renderHistory();
  }

  function renderSearching() {
    return `
      <div class="matching">
        <div class="radar">${ui.icon("radar")}</div>
        <p class="matching__title">Looking for a nearby driver…</p>
        <p class="matching__text">Broadcasting to ${ui.escapeHtml(state.booking.tierLabel)} drivers in your area.</p>
      </div>`;
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
          <span class="route-map__pin route-map__pin--b">${ui.icon("car")}</span>
          <span class="route-map__carpin" style="top:${pct}%">${ui.icon("car")}</span>
        </div>
      </div>`;
  }

  function renderDriver() {
    const d = state.booking.driver;
    if (!d) return "";
    return `
      <div class="driver-card">
        <div class="driver-card__left">
          <span class="driver-card__avatar">${d.name.trim().slice(0, 1)}</span>
          <div class="driver-card__info">
            <strong>${ui.escapeHtml(d.name)}</strong>
            <small>${ui.escapeHtml(d.color)} ${ui.escapeHtml(d.car)} · ${ui.escapeHtml(d.plate)}</small>
            <span class="driver-card__meta">${ui.stars(d.rating)} ${ui.escapeHtml(d.trips)} trips</span>
          </div>
        </div>
        <div class="driver-card__actions">
          <button class="chip chip--mini" type="button" data-call>${ui.icon("phone")}Call</button>
          <button class="chip chip--mini" type="button" data-chat>${ui.icon("chat")}Chat</button>
        </div>
      </div>`;
  }

  function renderSafety() {
    return `
      <div class="safety-row">
        <button class="chip chip--mini" type="button" data-share>${ui.icon("share")} Share live trip</button>
        <button class="chip chip--mini chip--danger" type="button" data-sos>${ui.icon("alert")} SOS</button>
      </div>`;
  }

  function renderControls(done) {
    if (done) return "";
    return `
      <div class="control-bar">
        <button type="button" class="chip" data-pause>${state.auto ? "Pause" : "Resume"}</button>
        <span class="control-bar__state">${state.auto ? "Auto-advancing every 6s" : "Paused"}</span>
        <button type="button" class="btn btn--small" data-step>Next step</button>
      </div>
      <button class="ghost-btn ghost-btn--danger" type="button" data-cancel>${ui.icon("ban")} Cancel ride</button>`;
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
      b.addEventListener("click", () => ui.toast(`Calling ${state.booking.driver.phone} (simulated)`))
    );
    page.querySelectorAll("[data-chat]").forEach((b) =>
      b.addEventListener("click", () => ui.toast("Chat with your driver is simulated"))
    );

    const share = page.querySelector("[data-share]");
    if (share) {
      share.addEventListener("click", () => {
        const contact = window.prompt("Share your live trip with a contact phone:", state.profilePhone);
        api(`/ride/bookings/${state.booking.id}/share-live`, {
          method: "POST",
          body: { contact: contact || undefined },
        })
          .then(() => ui.toast("Live trip shared", "success"))
          .catch((err) => ui.toast(err.message, "error"));
      });
    }

    const sos = page.querySelector("[data-sos]");
    if (sos) {
      sos.addEventListener("click", () =>
        ui.toast("SOS simulated: a safety notice was dispatched to our team")
      );
    }
  }

  function manualAdvance() {
    const b = state.booking;
    const action = NEXT_ACTION[b.status];
    if (!action) return;
    runAdvance(action);
  }

  function runAdvance(action) {
    return api(`/ride/bookings/${state.booking.id}/advance`, {
      method: "POST",
      body: { action },
    })
      .then((data) => {
        state.booking = data.booking;
        renderTracking();
        if (data.booking.status === "COMPLETED") renderSuccess();
      })
      .catch((err) => ui.toast(err.message, "error"));
  }

  function startAuto() {
    stopAuto();
    state.timer = window.setInterval(() => {
      const b = state.booking;
      if (!b) return;
      if (b.status === "COMPLETED" || b.status === "CANCELLED") {
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
      title: "Cancel this ride?",
      subtitle: "The escrowed fare is refunded to your wallet in full.",
      button: "Cancel ride",
    });
    if (!r) return;
    try {
      const data = await api(`/ride/bookings/${state.booking.id}/cancel`, { method: "POST" });
      state.booking = data.booking;
      ui.toast(`Refunded ${data.refundedNgn}`, "success");
      stopAuto();
      renderTracking();
    } catch (err) {
      ui.toast(err.message, "error");
    }
  }

  // ---- Post-trip rating & issues ------------------------------------------

  function renderSuccess() {
    const sec = document.createElement("div");
    sec.className = "card";
    sec.id = "ride-post";
    sec.innerHTML = `
      <div class="success-card">
        <div class="success-card__icon">${ui.icon("check")}</div>
        <div class="success-card__title">Trip completed</div>
        <div class="success-card__sub">${ui.escapeHtml(state.booking.totalNgn)} released to ${ui.escapeHtml(state.booking.driver ? state.booking.driver.name : "the driver")}.${state.booking.tipMinor ? ` Tip ${ui.escapeHtml(state.booking.tipNgn)} paid.` : ""}</div>
        <p class="success-card__meta">Reference: ${ui.escapeHtml(state.booking.reference)}</p>
        <a class="btn btn--primary btn--small" href="transaction.html?id=${encodeURIComponent(state.booking.transactionId)}">View transaction</a>
      </div>
      <div class="divider"></div>
      ${state.booking.rating ? "" : renderRating(state.booking.id)}
      <div class="divider"></div>
      ${renderIssue(state.booking.id)}
    `;
    const before = ui.$("#ride-track");
    before.parentNode.insertBefore(sec, before.nextSibling);
    bindPost(sec);
  }

  function renderRating(id) {
    return `
      <div class="rate-block">
        <h3 class="rate-block__title">Rate your driver</h3>
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
          ${RIDE_ISSUES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}
        </select>
        <textarea class="input" data-issue-note maxlength="300" placeholder="Anything we should know (optional)"></textarea>
        <button class="btn btn--small" type="button" data-issue-submit>Report issue</button>
      </div>`;
  }

  function bindPost(sec) {
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
        const data = await api(`/ride/bookings/${state.booking.id}/rate`, {
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
        await api(`/ride/bookings/${state.booking.id}/issue`, {
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
    const el = ui.$("#ride-history");
    try {
      const { items } = await api("/ride/bookings");
      if (!items.length) {
        el.innerHTML = `<div class="empty">No rides yet — book one above.</div>`;
        return;
      }
      el.innerHTML = items
        .map((b) => {
          const active = b.status !== "COMPLETED" && b.status !== "CANCELLED";
          const label = active ? "Resume" : "View";
          return `
            <a class="tx-item" href="#" data-open="${b.id}">
              <div class="tx-item__icon" aria-hidden="true">${ui.icon("car")}</div>
              <div class="tx-item__main">
                <div class="tx-item__title">${ui.escapeHtml(b.pickupAddress)} → ${ui.escapeHtml(b.dropoffAddress)}</div>
                <div class="tx-item__meta">
                  <span class="badge badge--${b.status}">${b.status}</span>
                  <span>${ui.escapeHtml(b.totalNgn)}${b.tipMinor ? " + tip" : ""}</span>
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