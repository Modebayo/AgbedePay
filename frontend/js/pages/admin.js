// admin page — the operator console.
//
// ADMIN-only. It opens on a live overview of the whole platform (users, money,
// rides, dispatch, drivers, cargo, payments, support) and then offers the four
// queues that need a human: approve a driver, price a cargo request, answer a
// support ticket, reconcile a pending payment.
//
// Identity is the same session cookie as every other page; the backend gates
// every /admin route behind role ADMIN. This page only ever displays server
// numbers and only sends the field values the operator typed.

(function () {
  "use strict";

  const { api } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const page = ui.$("#page");

  const M = (n) => Number(n || 0).toLocaleString("en-NG");

  const state = {
    profile: null,
    overview: null,
    tab: "drivers",
    queues: { drivers: null, cargo: null, support: null, payments: null },
    busy: false,
  };

  const TABS = [
    ["drivers", "Drivers"],
    ["cargo", "Cargo"],
    ["support", "Support"],
    ["payments", "Payments"],
  ];

  ui.requireAuth(async (profile) => {
    if (profile.role !== "ADMIN") {
      renderForbidden();
      return;
    }
    state.profile = profile;
    ui.renderShell(profile, "admin");

    page.innerHTML = ui.loadingCard("Loading the platform overview…");
    await loadOverview();
  });

  function renderForbidden() {
    page.innerHTML = `
      <div class="card">
        <div class="section-head" style="margin:0 0 8px"><h2>Admins only</h2></div>
        <p class="page-sub" style="margin:0">This console is limited to AgbedePay administrators.</p>
        <a class="btn btn--green" href="dashboard.html" style="margin-top:14px">Back to home</a>
      </div>`;
  }

  // ---- Overview ------------------------------------------------------------

  async function loadOverview() {
    try {
      state.overview = await api("/admin/overview");
    } catch (err) {
      page.innerHTML = `
        <div class="card">
          <p class="page-sub" style="margin:0">${ui.escapeHtml(err.message || "Could not load the overview.")}</p>
        </div>`;
      return;
    }
    renderOverview();
    await loadQueue(state.tab);
  }

  function renderOverview() {
    const o = state.overview;
    page.innerHTML = `
      <div class="admin-stats">
        ${statCard("Total users", M(o.users.total), `${M(o.users.new7d)} new this week`)}
        ${statCard("Wallet balance held", o.wallets.totalBalanceNgn, `${M(o.wallets.total)} wallets · ${M(o.wallets.frozen)} frozen`)}
        ${statCard("Volume (7 days)", o.transactions.volume7dNgn, `${M(o.transactions.today)} transactions today`)}
        ${statCard("Active rides", M(o.rides.active), `${M(o.rides.completed)} completed all-time`)}
        ${statCard("Drivers pending", M(o.drivers.pending), `${M(o.drivers.online)} online now`)}
        ${statCard("Cargo awaiting", M(o.cargo.requested), `${M(o.cargo.quoted)} quoted`)}
        ${statCard("Open tickets", M(o.support.open), `${M(o.support.resolved)} resolved`)}
        ${statCard("Payments pending", M(o.payments.pending), `${o.payments.collectedNgn} collected`)}
      </div>

      <div class="admin-grid">
        ${userBreakdown(o.users)}
        ${txByType(o.transactions)}
        ${rideCard(o.rides, o.dispatch)}
        ${driverCard(o.drivers)}
        ${paymentCard(o.payments)}
        ${supportCard(o.support)}
      </div>

      <div class="section-head"><h2>Recent activity</h2></div>
      ${recentCard(o.recent)}

      <div class="section-head"><h2>Queues</h2></div>
      <div class="tabs" data-admin-tabs>
        ${TABS.map(([key, label]) => `<button class="tab ${state.tab === key ? "is-active" : ""}" type="button" data-admin-tab="${key}">${label}</button>`).join("")}
      </div>
      <div id="admin-panel">${ui.loadingCard("Loading queue…")}</div>
    `;
    wireTabs();
  }

  function statCard(label, value, sub) {
    return `
      <div class="stat-card">
        <div class="stat-card__label">${ui.escapeHtml(label)}</div>
        <div class="stat-card__value">${ui.escapeHtml(value)}</div>
        ${sub ? `<div class="stat-card__sub">${ui.escapeHtml(sub)}</div>` : ""}
      </div>`;
  }

  function kv(label, value) {
    return `<div class="admin-kv"><span>${ui.escapeHtml(label)}</span><strong>${value}</strong></div>`;
  }

  function userBreakdown(u) {
    return `
      <div class="card">
        <div class="section-head" style="margin:0 0 10px"><h2>Users</h2></div>
        ${kv("Total", M(u.total))}
        ${kv("Active", M(u.active))}
        ${kv("Pending verification", M(u.pending))}
        ${kv("Suspended", M(u.suspended))}
        ${kv("Drivers", M(u.drivers))}
        ${kv("Admins", M(u.admins))}
      </div>`;
  }

  function txByType(tx) {
    const rows = tx.byType.length
      ? tx.byType
          .map(
            (r) =>
              `<div class="admin-kv"><span>${ui.escapeHtml(r.type)}</span><strong>${M(r.count)} · ${ui.escapeHtml(r.amountNgn)}</strong></div>`
          )
          .join("")
      : `<p class="hint">No settled transactions yet.</p>`;
    return `
      <div class="card">
        <div class="section-head" style="margin:0 0 10px"><h2>Ledger by type</h2></div>
        ${rows}
        <p class="hint" style="margin-top:10px">${M(tx.success)} success · ${M(tx.failed)} failed · lifetime ${ui.escapeHtml(tx.volumeAllNgn)}</p>
      </div>`;
  }

  function rideCard(rides, dispatch) {
    return `
      <div class="card">
        <div class="section-head" style="margin:0 0 10px"><h2>Rides &amp; dispatch</h2></div>
        ${kv("Rides total", M(rides.total))}
        ${kv("Rides active", M(rides.active))}
        ${kv("Rides completed", M(rides.completed))}
        ${kv("Dispatch total", M(dispatch.total))}
        ${kv("Dispatch active", M(dispatch.active))}
        ${kv("Dispatch delivered", M(dispatch.delivered))}
      </div>`;
  }

  function driverCard(d) {
    return `
      <div class="card">
        <div class="section-head" style="margin:0 0 10px"><h2>Drivers</h2></div>
        ${kv("Total", M(d.total))}
        ${kv("Pending approval", M(d.pending))}
        ${kv("Active", M(d.active))}
        ${kv("Suspended", M(d.suspended))}
        ${kv("Online now", M(d.online))}
      </div>`;
  }

  function paymentCard(p) {
    return `
      <div class="card">
        <div class="section-head" style="margin:0 0 10px"><h2>Payments</h2></div>
        ${kv("Total", M(p.total))}
        ${kv("Pending", M(p.pending))}
        ${kv("Success", M(p.success))}
        ${kv("Failed", M(p.failed))}
        ${kv("Collected", ui.escapeHtml(p.collectedNgn))}
      </div>`;
  }

  function supportCard(s) {
    return `
      <div class="card">
        <div class="section-head" style="margin:0 0 10px"><h2>Support</h2></div>
        ${kv("Total", M(s.total))}
        ${kv("Open", M(s.open))}
        ${kv("In progress", M(s.inProgress))}
        ${kv("Resolved", M(s.resolved))}
      </div>`;
  }

  function recentCard(recent) {
    const tx = recent.transactions.length
      ? recent.transactions
          .map(
            (t) => `
          <div class="admin-kv">
            <span>${ui.escapeHtml(t.userName || "—")} · ${ui.escapeHtml(t.type)}</span>
            <strong>${ui.escapeHtml(t.amountNgn)} <span class="badge badge--${ui.escapeHtml(t.status)}">${ui.escapeHtml(t.status)}</span></strong>
          </div>`
          )
          .join("")
      : `<p class="hint">No activity yet.</p>`;

    const users = recent.users.length
      ? recent.users
          .map(
            (u) => `
          <div class="admin-kv">
            <span>${ui.escapeHtml(u.name)} · ${ui.escapeHtml(u.phone)}</span>
            <strong>${ui.escapeHtml(u.role)}</strong>
          </div>`
          )
          .join("")
      : `<p class="hint">No sign-ups yet.</p>`;

    return `
      <div class="admin-grid">
        <div class="card">
          <div class="section-head" style="margin:0 0 10px"><h2>Latest transactions</h2></div>
          ${tx}
        </div>
        <div class="card">
          <div class="section-head" style="margin:0 0 10px"><h2>Newest accounts</h2></div>
          ${users}
        </div>
      </div>`;
  }

  // ---- Tabs ----------------------------------------------------------------

  function wireTabs() {
    page.querySelectorAll("[data-admin-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.tab = btn.getAttribute("data-admin-tab");
        page.querySelectorAll("[data-admin-tab]").forEach((b) => b.classList.toggle("is-active", b === btn));
        loadQueue(state.tab);
      });
    });
  }

  async function loadQueue(tab) {
    const panel = document.getElementById("admin-panel");
    if (panel) panel.innerHTML = ui.loadingCard("Loading queue…");
    try {
      const data = await api(`/admin/${tab}`);
      state.queues[tab] = data.items || [];
      renderQueue(tab);
    } catch (err) {
      if (panel) panel.innerHTML = `<div class="card"><p class="page-sub" style="margin:0">${ui.escapeHtml(err.message || "Could not load this queue.")}</p></div>`;
    }
  }

  function renderQueue(tab) {
    const panel = document.getElementById("admin-panel");
    if (!panel) return;
    const items = state.queues[tab] || [];
    if (items.length === 0) {
      panel.innerHTML = `<div class="card"><p class="page-sub" style="margin:0">Nothing here right now.</p></div>`;
      return;
    }
    const fn = { drivers: driverRow, cargo: cargoRow, support: supportRow, payments: paymentRow }[tab];
    panel.innerHTML = items.map(fn).join("");
  }

  // ---- Queue rows ----------------------------------------------------------

  function badge(status) {
    return `<span class="badge badge--${ui.escapeHtml(status)}">${ui.escapeHtml(status.replace(/_/g, " "))}</span>`;
  }

  function driverRow(d) {
    const actions =
      d.status === "PENDING"
        ? `<button class="btn btn--green btn--small" data-driver-set="${d.userId}:ACTIVE" type="button">Approve</button>`
        : d.status === "ACTIVE"
          ? `<button class="btn btn--ghost btn--small" data-driver-set="${d.userId}:SUSPENDED" type="button">Suspend</button>`
          : `<button class="btn btn--green btn--small" data-driver-set="${d.userId}:ACTIVE" type="button">Reinstate</button>`;
    return `
      <div class="card admin-row">
        <div class="section-head" style="margin:0 0 6px">
          <h2>${ui.escapeHtml(d.name)}</h2>
          ${badge(d.status)}
        </div>
        <p class="hint">${ui.escapeHtml(d.phone)}${d.email ? ` · ${ui.escapeHtml(d.email)}` : ""}</p>
        <div class="admin-kv"><span>Vehicle</span><strong>${ui.escapeHtml(d.vehicle || d.vehicleType)} · ${ui.escapeHtml(d.plate)}</strong></div>
        <div class="admin-kv"><span>Rating</span><strong>${d.rating === null ? "—" : d.rating} · ${M(d.tripsCompleted)} trips</strong></div>
        <div class="admin-kv"><span>Commission</span><strong>${ui.escapeHtml(d.commissionPct)}</strong></div>
        <div class="admin-actions">${actions}</div>
      </div>`;
  }

  function cargoRow(q) {
    const priced = q.quotedAmountMinor !== null;
    const quoter = `
      <div class="admin-quote">
        <div class="field">
          <label class="field__label">Quote amount (₦)</label>
          <input class="input" type="number" min="1" step="0.01" inputmode="decimal" data-cargo-amount value="${priced ? (q.quotedAmountMinor / 100).toFixed(2) : ""}" />
        </div>
        <div class="field">
          <label class="field__label">Note to customer</label>
          <input class="input" type="text" maxlength="500" data-cargo-note value="${ui.escapeHtml(q.adminNote || "")}" />
        </div>
        <button class="btn btn--primary btn--small" data-cargo-quote="${q.id}" type="button">${priced ? "Update quote" : "Send quote"}</button>
      </div>`;
    const closeActions =
      q.status === "QUOTED" || q.status === "ACCEPTED"
        ? `<button class="btn btn--ghost btn--small" data-cargo-status="${q.id}:CLOSED" type="button">Mark closed</button>`
        : "";
    return `
      <div class="card admin-row">
        <div class="section-head" style="margin:0 0 6px">
          <h2>${ui.escapeHtml(q.reference)}</h2>
          ${badge(q.status)}
        </div>
        <p class="hint">${ui.escapeHtml(q.userName || "")}${q.userPhone ? ` · ${ui.escapeHtml(q.userPhone)}` : ""}</p>
        <div class="admin-kv"><span>Route</span><strong>${ui.escapeHtml(q.pickupAddress)} → ${ui.escapeHtml(q.dropoffAddress)}</strong></div>
        <div class="admin-kv"><span>Cargo</span><strong>${ui.escapeHtml(q.cargoType)}${q.approxWeightKg ? ` · ${q.approxWeightKg}kg` : ""}</strong></div>
        <div class="admin-kv"><span>Collection</span><strong>${ui.escapeHtml(q.collectionDate || "—")}</strong></div>
        ${q.notes ? `<p class="hint" style="margin-top:8px">${ui.escapeHtml(q.notes)}</p>` : ""}
        ${priced ? `<div class="admin-kv"><span>Quoted</span><strong>${ui.escapeHtml(q.quotedAmountNgn)}</strong></div>` : ""}
        ${quoter}
        ${closeActions ? `<div class="admin-actions">${closeActions}</div>` : ""}
      </div>`;
  }

  function supportRow(t) {
    const resolved = t.status === "RESOLVED";
    const replyBox = resolved
      ? ""
      : `
      <div class="admin-quote">
        <div class="field">
          <label class="field__label">Reply</label>
          <textarea class="input" rows="2" maxlength="1000" data-support-reply-text>${ui.escapeHtml(t.agentReply || "")}</textarea>
        </div>
        <div class="admin-actions">
          <button class="btn btn--primary btn--small" data-support-send="${t.id}" type="button">Send reply</button>
          <button class="btn btn--ghost btn--small" data-support-resolve="${t.id}" type="button">Send &amp; resolve</button>
        </div>
      </div>`;
    return `
      <div class="card admin-row">
        <div class="section-head" style="margin:0 0 6px">
          <h2>${ui.escapeHtml(t.subject)}</h2>
          ${badge(t.status)}
        </div>
        <p class="hint">${ui.escapeHtml(t.category)} · ${ui.escapeHtml(t.userName || "")}${t.userPhone ? ` · ${ui.escapeHtml(t.userPhone)}` : ""}</p>
        <p class="admin-message">${ui.escapeHtml(t.message)}</p>
        ${t.agentReply ? `<p class="hint"><strong>You replied:</strong> ${ui.escapeHtml(t.agentReply)}</p>` : ""}
        ${replyBox}
      </div>`;
  }

  function paymentRow(p) {
    const action =
      p.status === "PENDING"
        ? `<div class="admin-actions"><button class="btn btn--ghost btn--small" data-pay-reconcile="${ui.escapeHtml(p.reference)}" type="button">Reconcile</button></div>`
        : "";
    return `
      <div class="card admin-row">
        <div class="section-head" style="margin:0 0 6px">
          <h2>${ui.escapeHtml(p.reference)}</h2>
          ${badge(p.status)}
        </div>
        <p class="hint">${ui.escapeHtml(p.provider)} · ${ui.escapeHtml(p.userName || "")}${p.userPhone ? ` · ${ui.escapeHtml(p.userPhone)}` : ""}</p>
        <div class="admin-kv"><span>Amount</span><strong>${ui.escapeHtml(p.amountNgn)}</strong></div>
        ${action}
      </div>`;
  }

  // ---- Actions -------------------------------------------------------------

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

  async function refreshAll() {
    await loadOverview();
  }

  page.addEventListener("click", (event) => {
    const driverBtn = event.target.closest("[data-driver-set]");
    if (driverBtn) {
      const [userId, status] = driverBtn.getAttribute("data-driver-set").split(":");
      return guard(async () => {
        await api(`/admin/drivers/${userId}`, { method: "PATCH", body: { status } });
        ui.toast(`Driver ${status === "ACTIVE" ? "approved" : "suspended"}.`, "success");
        await refreshAll();
      });
    }

    const quoteBtn = event.target.closest("[data-cargo-quote]");
    if (quoteBtn) {
      const id = quoteBtn.getAttribute("data-cargo-quote");
      const row = quoteBtn.closest(".admin-row");
      const rawAmount = row.querySelector("[data-cargo-amount]").value.trim();
      const note = row.querySelector("[data-cargo-note]").value.trim();
      const body = { adminNote: note || undefined };
      if (rawAmount) {
        const naira = Number(rawAmount);
        if (!Number.isFinite(naira) || naira <= 0) {
          ui.toast("Enter a valid quote amount.", "error");
          return;
        }
        body.quotedAmountMinor = Math.round(naira * 100);
      }
      return guard(async () => {
        await api(`/admin/cargo/${id}`, { method: "PATCH", body });
        ui.toast("Cargo request updated.", "success");
        await refreshAll();
      });
    }

    const cargoStatusBtn = event.target.closest("[data-cargo-status]");
    if (cargoStatusBtn) {
      const [id, status] = cargoStatusBtn.getAttribute("data-cargo-status").split(":");
      return guard(async () => {
        await api(`/admin/cargo/${id}`, { method: "PATCH", body: { status } });
        ui.toast("Cargo request updated.", "success");
        await refreshAll();
      });
    }

    const sendBtn = event.target.closest("[data-support-send]");
    const resolveBtn = event.target.closest("[data-support-resolve]");
    if (sendBtn || resolveBtn) {
      const btn = sendBtn || resolveBtn;
      const id = btn.getAttribute(sendBtn ? "data-support-send" : "data-support-resolve");
      const row = btn.closest(".admin-row");
      const reply = row.querySelector("[data-support-reply-text]").value.trim();
      if (!reply) {
        ui.toast("Type a reply first.", "error");
        return;
      }
      const status = resolveBtn ? "RESOLVED" : "IN_PROGRESS";
      return guard(async () => {
        await api(`/admin/support/${id}/reply`, { method: "POST", body: { reply, status } });
        ui.toast(resolveBtn ? "Ticket resolved." : "Reply sent.", "success");
        await refreshAll();
      });
    }

    const reconcileBtn = event.target.closest("[data-pay-reconcile]");
    if (reconcileBtn) {
      const reference = reconcileBtn.getAttribute("data-pay-reconcile");
      return guard(async () => {
        await api(`/admin/payments/${encodeURIComponent(reference)}/reconcile`, { method: "POST" });
        ui.toast("Payment reconciled.", "success");
        await refreshAll();
      });
    }
  });
})();
