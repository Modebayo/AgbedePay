// driver page — the Agbede Driver dashboard.
//
// A driver goes online, watches offers (polled, with a live countdown), accepts
// one, then pumps the trip forward: arrived → start → complete for rides,
// picked up → in transit → deliver for logistics. Completing pays their wallet.
//
// Identity is the same session cookie as every other page; the backend gates
// all of this behind role DRIVER. The page only ever displays server numbers.

(function () {
  "use strict";

  const { api } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const page = ui.$("#page");

  const POLL_MS = 5000;

  const state = {
    account: null,
    profile: null,
    earnings: null,
    offers: [],
    trips: [],
    online: false,
    busy: false,
    pollTimer: null,
    tickTimer: null,
  };

  // ---- Actions per status --------------------------------------------------

  const NEXT_ACTION = {
    DRIVER_ACCEPTED: { action: "arrived", label: "I've arrived", icon: "route" },
    DRIVER_ARRIVING: { action: "start", label: "Start trip", icon: "car" },
    IN_PROGRESS: { action: "complete", label: "Complete trip", icon: "check" },
    RIDER_ASSIGNED: { action: "pickup", label: "Picked up", icon: "box" },
    PICKED_UP: { action: "transit", label: "In transit", icon: "route" },
    IN_TRANSIT: { action: "deliver", label: "Deliver", icon: "check" },
  };

  const ACTIVE_STATUSES = new Set([
    "DRIVER_ACCEPTED", "DRIVER_ARRIVING", "IN_PROGRESS",
    "RIDER_ASSIGNED", "PICKED_UP", "IN_TRANSIT",
  ]);

  ui.requireAuth(async (profile) => {
    state.account = profile;
    ui.renderShell(profile, "driver");

    page.innerHTML = `<div id="driver-body">${ui.loadingCard("Loading your dashboard…")}</div>`;
    await boot();
  });

  async function boot() {
    let me;
    try {
      me = await api("/driver/me");
    } catch (err) {
      // A signed-in customer (or a DRIVER without a profile) is shown the
      // application form; a pending profile never reaches here (it returns 200).
      if (err.status === 403 && err.code !== "DRIVER_NOT_APPROVED") {
        renderApplyForm();
        return;
      }
      renderBlocked(err);
      return;
    }

    state.profile = me.profile;
    state.earnings = me.earnings;
    state.online = me.profile.isOnline;

    // A profile that exists but isn't ACTIVE can't go online, so show its status
    // instead of an empty, unusable dashboard.
    if (state.profile.status !== "ACTIVE") {
      renderPending();
      return;
    }

    render();
    await refresh();
    startTimers();
  }

  function shellCard(title, bodyHtml, actionHtml = "") {
    page.innerHTML = `
      <div class="card">
        <div class="section-head" style="margin:0 0 8px"><h2>${title}</h2></div>
        ${bodyHtml}
        ${actionHtml}
      </div>`;
  }

  function renderBlocked(err) {
    shellCard(
      "Driver dashboard unavailable",
      `<p class="page-sub" style="margin:0">${ui.escapeHtml(err.message || "Please try again later.")}</p>`,
      `<a class="btn btn--ghost" href="dashboard.html" style="margin-top:14px">Back to home</a>`
    );
  }

  function renderPending() {
    const p = state.profile;
    const suspended = p.status === "SUSPENDED";
    shellCard(
      suspended ? "Account suspended" : "Application under review",
      `<p class="page-sub" style="margin:0">
         ${suspended
           ? "Your driver account is suspended. Contact support if you think this is a mistake."
           : "Thanks for applying. An admin is reviewing your details — you'll be able to go online once approved."}
       </p>
       <div class="route-panel" style="margin-top:12px">
         <div class="route-panel__row">${ui.icon("car")}<span>${ui.escapeHtml(p.vehicleLabel)} · ${ui.escapeHtml(p.plate)}</span></div>
       </div>`,
      `<a class="btn btn--ghost" href="dashboard.html" style="margin-top:14px">Back to home</a>`
    );
  }

  function renderApplyForm() {
    page.innerHTML = `
      <div class="card">
        <div class="section-head" style="margin:0 0 8px"><h2>Drive with Agbede</h2></div>
        <p class="page-sub" style="margin:0 0 14px">Earn on your schedule. Apply with your vehicle details and an admin will review your application.</p>
        <form id="drive-apply" novalidate>
          <div class="field">
            <label class="field__label" for="apply-vehicle">Vehicle type</label>
            <select class="input" id="apply-vehicle" name="vehicleType">
              <option value="CAR">Car</option>
              <option value="VAN">Van</option>
              <option value="BIKE">Bike</option>
            </select>
            <p class="field__error"></p>
          </div>
          <div class="field">
            <label class="field__label" for="apply-model">Make &amp; model</label>
            <input class="input" id="apply-model" name="carMakeModel" type="text" maxlength="80" placeholder="e.g. Toyota Corolla" autocomplete="off" />
            <p class="field__error"></p>
          </div>
          <div class="field">
            <label class="field__label" for="apply-color">Colour</label>
            <input class="input" id="apply-color" name="carColor" type="text" maxlength="40" placeholder="e.g. Silver" autocomplete="off" />
            <p class="field__error"></p>
          </div>
          <div class="field">
            <label class="field__label" for="apply-plate">Plate number</label>
            <input class="input" id="apply-plate" name="plateNumber" type="text" maxlength="20" placeholder="e.g. LAG-123-XY" autocomplete="off" />
            <p class="field__error"></p>
          </div>
          <button class="btn btn--green" type="submit">Submit application</button>
        </form>
      </div>`;
    ui.$("#drive-apply").addEventListener("submit", submitApplication);
  }

  async function submitApplication(event) {
    event.preventDefault();
    const form = event.currentTarget;
    ui.resetFormErrors(form);
    const body = {
      vehicleType: form.vehicleType.value,
      carMakeModel: form.carMakeModel.value.trim(),
      carColor: form.carColor.value.trim(),
      plateNumber: form.plateNumber.value.trim(),
    };
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await api("/driver/apply", { method: "POST", body });
      ui.toast("Application submitted — we'll review it shortly.", "success");
      await boot();
    } catch (err) {
      ui.showFormErrors(form, err);
    } finally {
      btn.disabled = false;
    }
  }

  // ---- Render --------------------------------------------------------------

  function render() {
    document.getElementById("driver-body").innerHTML = `
      <div class="card" id="driver-header"></div>
      <div id="driver-active"></div>
      <div class="section-head"><h2>Incoming requests</h2></div>
      <div id="driver-offers"></div>
      <div class="section-head"><h2>Earnings</h2></div>
      <div id="driver-earnings"></div>
      <div class="section-head"><h2>Recent trips</h2></div>
      <div id="driver-history"></div>
    `;
    renderHeader();
    renderActive();
    renderOffers();
    renderEarnings();
    renderHistory();
  }

  function renderHeader() {
    const p = state.profile;
    const el = document.getElementById("driver-header");
    if (!el) return;
    el.innerHTML = `
      <div class="section-head" style="margin:0 0 10px">
        <h2>${ui.escapeHtml(p.name)}</h2>
        <span class="pill">${ui.escapeHtml(p.vehicleLabel)} · ${ui.escapeHtml(p.plate)}</span>
      </div>
      <div class="route-panel">
        <div class="route-panel__row">${ui.icon("star")}<span>${ui.escapeHtml(p.rating)} rating · ${ui.escapeHtml(p.trips)} trips</span></div>
        <div class="route-panel__row">${ui.icon("wallet")}<span>${ui.escapeHtml(state.earnings?.totalNetNgn ?? "₦0.00")} earned</span></div>
      </div>
      <button class="btn ${state.online ? "btn--ghost" : "btn--green"}" id="driver-online" type="button" style="margin-top:12px">
        ${state.online ? "Go offline" : "Go online"}
      </button>
      ${state.profile.status !== "ACTIVE" ? `<p class="hint" style="margin-top:8px">Account status: ${ui.escapeHtml(state.profile.status)}</p>` : ""}
    `;
    const btn = el.querySelector("#driver-online");
    if (btn) btn.addEventListener("click", toggleOnline);
  }

  function renderActive() {
    const el = document.getElementById("driver-active");
    if (!el) return;
    const active = state.trips.filter((t) => t.active);
    if (active.length === 0) { el.innerHTML = ""; return; }

    el.innerHTML = active
      .map((t) => {
        const next = NEXT_ACTION[t.status];
        return `
        <div class="card">
          <div class="section-head" style="margin:0 0 8px">
            <h2>Current ${t.kind === "RIDE" ? "ride" : "delivery"}</h2>
            <span class="pill">${ui.escapeHtml(t.status.replace(/_/g, " ").toLowerCase())}</span>
          </div>
          <div class="route-panel">
            <div class="route-panel__row">${ui.icon("pin")}<span>${ui.escapeHtml(t.pickupAddress)}</span></div>
            <div class="route-panel__row">${ui.icon("route")}<span>${ui.escapeHtml(t.dropoffAddress)} · ${ui.escapeHtml(t.distanceKm)} km</span></div>
          </div>
          ${next
            ? `<button class="btn btn--green" data-advance="${t.kind}:${t.id}:${next.action}" type="button" style="margin-top:12px">
                 ${ui.icon(next.icon)} ${next.label}
               </button>`
            : ""}
        </div>`;
      })
      .join("");
  }

  function renderOffers() {
    const el = document.getElementById("driver-offers");
    if (!el) return;
    if (state.offers.length === 0) {
      el.innerHTML = `<div class="card"><p class="page-sub" style="margin:0">${state.online ? "No requests right now — we'll keep watching." : "Go online to start receiving requests."}</p></div>`;
      return;
    }
    el.innerHTML = state.offers
      .map((o) => `
        <div class="card">
          <div class="section-head" style="margin:0 0 8px">
            <h2>${o.kind === "RIDE" ? ui.escapeHtml(o.label) : ui.escapeHtml(o.label) + " delivery"}</h2>
            <span class="pill">${o.open ? "Open" : "Expires in <span class=\"offer-countdown\" data-expires=\"${ui.escapeHtml(o.expiresAt)}\">${ui.escapeHtml(o.secondsLeft)}</span>s"}</span>
          </div>
          <div class="route-panel">
            <div class="route-panel__row">${ui.icon("pin")}<span>${ui.escapeHtml(o.pickupAddress)}</span></div>
            <div class="route-panel__row">${ui.icon("route")}<span>${ui.escapeHtml(o.dropoffAddress)} · ${ui.escapeHtml(o.distanceKm)} km · ~${ui.escapeHtml(o.etaMin)} min</span></div>
            <div class="route-panel__row">${ui.icon("wallet")}<span>${ui.escapeHtml(o.amountNgn)} fare</span></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:12px">
            <button class="btn btn--green" data-accept="${o.kind}:${o.bookingId}" type="button" style="flex:1">Accept</button>
            <button class="btn btn--ghost" data-decline="${o.kind}:${o.bookingId}" type="button">Decline</button>
          </div>
        </div>`)
      .join("");
  }

  function renderEarnings() {
    const el = document.getElementById("driver-earnings");
    if (!el || !state.earnings) return;
    const e = state.earnings;
    el.innerHTML = `
      <div class="card">
        <div class="quote-total">
          <span>Total earned (net)</span>
          <strong>${ui.escapeHtml(e.totalNetNgn)}</strong>
        </div>
        <p class="hint">${ui.escapeHtml(e.trips)} settled trips</p>
      </div>
    `;
  }

  function renderHistory() {
    const el = document.getElementById("driver-history");
    if (!el) return;
    const rows = state.trips.filter((t) => !t.active);
    if (rows.length === 0) {
      el.innerHTML = `<div class="card"><p class="page-sub" style="margin:0">No completed trips yet.</p></div>`;
      return;
    }
    el.innerHTML = rows
      .slice(0, 20)
      .map((t) => `
        <div class="card">
          <div class="section-head" style="margin:0 0 6px">
            <h2>${ui.escapeHtml(t.pickupAddress)} → ${ui.escapeHtml(t.dropoffAddress)}</h2>
            <span class="pill">${ui.escapeHtml(t.status.toLowerCase())}</span>
          </div>
          <p class="hint">${t.kind === "RIDE" ? "Ride" : "Delivery"} · ${ui.escapeHtml(t.amountNgn)}</p>
        </div>`)
      .join("");
  }

  // ---- Data refresh --------------------------------------------------------

  async function refresh() {
    try {
      const offers = await api("/driver/offers");
      state.offers = offers.items || [];
      renderOffers();
      updateCountdowns();
    } catch (_) {
      /* keep the last view on a transient error */
    }
    try {
      const [me, trips] = await Promise.all([api("/driver/me"), api("/driver/trips")]);
      state.profile = me.profile;
      state.earnings = me.earnings;
      state.online = me.profile.isOnline;
      state.trips = trips.items || [];
      renderHeader();
      renderActive();
      renderEarnings();
      renderHistory();
    } catch (_) {
      /* ignore */
    }
  }

  function startTimers() {
    stopTimers();
    state.pollTimer = setInterval(() => { if (state.online) refresh(); }, POLL_MS);
    state.tickTimer = setInterval(updateCountdowns, 1000);
  }

  function stopTimers() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    if (state.tickTimer) clearInterval(state.tickTimer);
    state.pollTimer = null;
    state.tickTimer = null;
  }

  function updateCountdowns() {
    document.querySelectorAll(".offer-countdown").forEach((el) => {
      const expires = Date.parse(el.getAttribute("data-expires"));
      if (Number.isNaN(expires)) return;
      const left = Math.max(0, Math.round((expires - Date.now()) / 1000));
      el.textContent = String(left);
      if (left === 0 && state.online) refresh();
    });
  }

  // ---- Actions -------------------------------------------------------------

  async function toggleOnline() {
    await guard(async () => {
      const data = await api("/driver/availability", {
        method: "PATCH",
        body: { isOnline: !state.online },
      });
      state.online = data.isOnline;
      ui.toast(state.online ? "You're online — requests will start coming in." : "You're offline.", "success");
      renderHeader();
      if (state.online) refresh();
      else { state.offers = []; renderOffers(); }
    });
  }

  async function accept(kind, id) {
    await guard(async () => {
      await api(`/driver/offers/${kind}/${id}/accept`, { method: "POST" });
      ui.toast("Job accepted — head to the pickup.", "success");
      await refresh();
    });
  }

  async function decline(kind, id) {
    await guard(async () => {
      await api(`/driver/offers/${kind}/${id}/decline`, { method: "POST" });
      await refresh();
    });
  }

  async function advance(kind, id, action) {
    await guard(async () => {
      let body;
      if (action === "deliver") {
        const otp = window.prompt("Enter the recipient's delivery code");
        if (!otp) return;
        body = { otpCode: otp.trim() };
      }
      const data = await api(`/driver/trips/${kind}/${id}/${action}`, { method: "POST", body });
      if (action === "complete" || action === "deliver") {
        ui.toast(`Trip complete — ${data.netNgn} added to your wallet.`, "success");
      } else {
        ui.toast("Trip updated.", "success");
      }
      await refresh();
    });
  }

  // Serialize taps so a double-tap can't fire two requests.
  async function guard(fn) {
    if (state.busy) return;
    state.busy = true;
    try {
      await fn();
    } catch (err) {
      ui.toast(err.message || "Something went wrong.", "error");
    } finally {
      state.busy = false;
    }
  }

  // ---- Event delegation ----------------------------------------------------

  page.addEventListener("click", (event) => {
    const acceptBtn = event.target.closest("[data-accept]");
    if (acceptBtn) {
      const [kind, id] = acceptBtn.getAttribute("data-accept").split(":");
      return accept(kind, id);
    }
    const declineBtn = event.target.closest("[data-decline]");
    if (declineBtn) {
      const [kind, id] = declineBtn.getAttribute("data-decline").split(":");
      return decline(kind, id);
    }
    const advanceBtn = event.target.closest("[data-advance]");
    if (advanceBtn) {
      const [kind, id, action] = advanceBtn.getAttribute("data-advance").split(":");
      return advance(kind, id, action);
    }
  });

  window.addEventListener("beforeunload", stopTimers);
})();
