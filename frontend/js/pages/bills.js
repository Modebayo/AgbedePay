// bills page — tabbed biller payments: electricity (token), mobile data (fixed
// server-side plan prices), cable TV (decoder lookup + subscription). Every
// purchase uses a fresh Idempotency-Key so double-clicks charge once.

(function () {
  "use strict";

  const { api, idempotencyKey } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const page = ui.$("#page");
  let wallet = null;
  let catalog = null;

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "bills");
    wallet = profile.wallet;

    if (!wallet || wallet.status !== "ACTIVE") {
      page.innerHTML = `<div class="error-banner error-banner--show" role="alert">Your wallet cannot pay bills right now.</div>`;
      return;
    }

    try {
      catalog = await api("/bills/providers");
      renderTabs();
      showTab("electricity");
    } catch (err) {
      page.innerHTML = `<div class="error-banner error-banner--show" role="alert">${ui.escapeHtml(err.message)}</div>`;
    }
  });

  const TABS = [
    ["electricity", "bills", "Electricity"],
    ["data", "wifi", "Mobile data"],
    ["cable", "tv", "Cable TV"],
  ];

  function renderTabs() {
    page.innerHTML = `
      <div class="tabs" role="tablist">
        ${TABS.map(
          ([key, ic, label]) =>
            `<button class="tab" type="button" role="tab" data-tab="${key}">${ui.icon(ic)}${label}</button>`
        ).join("")}
      </div>
      <div id="tab-body" style="margin-top:16px"></div>
      <div class="section-head"><h2>Recent bills</h2></div>
      <div data-recent-bills></div>
    `;
    ui.$$(".tab").forEach((t) =>
      t.addEventListener("click", () => showTab(t.dataset.tab))
    );
    ui.loadRecentPurchases("BILLS", ui.$("#page [data-recent-bills]"));
  }

  function showTab(key) {
    ui.$$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === key));
    ui.$("#tab-body").innerHTML = "";
    if (key === "electricity") renderElectricity();
    else if (key === "data") renderData();
    else renderCable();
  }

  // ---- Electricity ----------------------------------------------------------

  function renderElectricity() {
    const disCos = catalog.electricity.disCos;
    const body = ui.$("#tab-body");
    body.innerHTML = `
      <form class="form card" id="elec-form" novalidate>
        <div class="error-banner" role="alert"></div>

        <div class="field">
          <label class="field__label" for="elec-disco">Electricity provider</label>
          <select class="input" id="elec-disco" name="disCo" required>
            <option value="">Select…</option>
            ${disCos
              .map((d) => `<option value="${ui.escapeHtml(d.disCo)}">${ui.escapeHtml(d.label)} (${ui.escapeHtml(d.disCo)})</option>`)
              .join("")}
          </select>
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="elec-meter-type">Meter type</label>
          <select class="input" id="elec-meter-type" name="meterType" required>
            <option value="PREPAID">Prepaid</option>
            <option value="POSTPAID">Postpaid</option>
          </select>
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="elec-meter">Meter number</label>
          <input class="input" id="elec-meter" name="meterNo" type="tel" inputmode="numeric" maxlength="12" placeholder="e.g. 112233445566" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="elec-amount">Amount (₦)</label>
          <input class="input" id="elec-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" placeholder="e.g. 5000" required />
          <p class="field__error"></p>
          <p class="balance-hint" id="elec-hint" hidden></p>
        </div>

        <div class="field">
          <label class="field__label" for="elec-phone">Notification phone <span style="font-weight:400;color:var(--muted)">— optional</span></label>
          <input class="input" id="elec-phone" name="phone" type="tel" inputmode="numeric" maxlength="11" placeholder="e.g. 08012345678" />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="elec-pin">Confirm with your 6-digit PIN</label>
          <input class="input" id="elec-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="••••••" required />
          <p class="field__error"></p>
        </div>

        <button class="btn btn--green" id="elec-submit" type="submit">Buy electricity token</button>
      </form>
      <div id="elec-success" hidden></div>
    `;

    ui.$$("#elec-form input[type='number'], #elec-form input[type='tel']").forEach((i) => {
      i.addEventListener("input", () => {
        i.value = i.value.replace(/\D/g, "");
      });
    });

    const amount = ui.$("#elec-amount");
    amount.addEventListener("input", () => {
      const v = Number.parseInt(amount.value, 10);
      const hint = ui.$("#elec-hint");
      if (v > 0) {
        hint.textContent = `New balance: ${ui.formatNgn((wallet.balanceMinor - v * 100) / 100)}`;
        hint.style.color = v * 100 > wallet.balanceMinor ? "var(--danger)" : "";
        hint.hidden = false;
      } else hint.hidden = true;
    });

    const pin = ui.$("#elec-pin");
    pin.addEventListener("input", () => {
      pin.value = pin.value.replace(/\D/g, "").slice(0, 6);
    });

    ui.$("#elec-form").addEventListener("submit", onElectricity);
  }

  async function onElectricity(e) {
    e.preventDefault();
    const form = ui.$("#elec-form");
    ui.resetFormErrors(form);

    const nairaAmount = Number.parseInt(ui.$("#elec-amount").value, 10);
    if (!Number.isSafeInteger(nairaAmount) || nairaAmount < 1) {
      ui.toast("Enter a whole-naira amount of at least ₦1", "error");
      return;
    }
    if (nairaAmount * 100 > wallet.balanceMinor) {
      ui.toast("You don't have enough balance for this purchase", "error");
      return;
    }

    pin(form, ui.$("#elec-submit"), "Purchasing…", "Buy electricity token", async () => {
      const data = await api("/bills/electricity", {
        method: "POST",
        body: {
          disCo: ui.$("#elec-disco").value,
          meterType: ui.$("#elec-meter-type").value,
          meterNo: ui.$("#elec-meter").value,
          amountMinor: nairaAmount * 100,
          phone: ui.$("#elec-phone").value.replace(/\D/g, "") || undefined,
          pin: ui.$("#elec-pin").value,
        },
        headers: { "Idempotency-Key": idempotencyKey() },
      });
      showElectricitySuccess(data);
    }, form);
  }

  function refreshRecent() {
    ui.loadRecentPurchases("BILLS", ui.$("#page [data-recent-bills]"));
  }

  function showElectricitySuccess(data) {
    ui.$("#elec-form").hidden = true;
    const s = ui.$("#elec-success");
    s.hidden = false;
    s.innerHTML = `
      <div class="card">
        <div class="success-card">
          <div class="success-card__icon">${ui.icon("bills")}</div>
          <div class="success-card__title">Token generated</div>
          <div class="success-card__amount">${ui.escapeHtml(data.purchase.disCo)} · ${ui.escapeHtml(data.purchase.meterType.toLowerCase())}</div>
          <div class="token-box">
            <div class="token-box__label">Units token (20 digits)</div>
            <div class="token-box__value">${ui.escapeHtml(data.purchase.token)}</div>
            <button class="ghost-btn" type="button" data-copy-token>${ui.icon("copy")} Copy token</button>
          </div>
          <p class="success-card__meta">Meter ${ui.escapeHtml(data.purchase.meterNo)} · ${ui.escapeHtml(data.amountNgn)} · New balance ${ui.escapeHtml(data.balanceNgn)}</p>
          <a class="btn btn--primary btn--small" href="transaction.html?id=${encodeURIComponent(data.transactionId)}">View transaction</a>
          <button class="ghost-btn" type="button" onclick="location.reload()">Buy again</button>
        </div>
      </div>
      <div class="notice" style="margin-top:12px"><strong>Demo provider:</strong> this token is simulated and is NOT real power.</div>
    `;
    ui.$("[data-copy-token]").addEventListener("click", () => {
      navigator.clipboard?.writeText(data.purchase.token)
        .then(() => ui.toast("Token copied", "success"))
        .catch(() => ui.toast("Could not copy", "error"));
    });
    refreshRecent();
  }

  // ---- Mobile data ----------------------------------------------------------

  function renderData() {
    const networks = catalog.data.networks;
    const body = ui.$("#tab-body");
    body.innerHTML = `
      <form class="form card" id="data-form" novalidate>
        <div class="error-banner" role="alert"></div>

        <div class="field">
          <label class="field__label">Network</label>
          <div class="chip-grid" id="data-network-grid">
            ${networks
              .map(
                (n) =>
                  `<button class="chip" type="button" data-network="${ui.escapeHtml(n.network)}">${ui.escapeHtml(n.network)}</button>`
              )
              .join("")}
          </div>
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label">Data plan</label>
          <div class="plan-list" id="data-plan-list">
            <p class="page-sub">Choose a network first.</p>
          </div>
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="data-phone">Phone number</label>
          <input class="input" id="data-phone" name="phone" type="tel" inputmode="numeric" maxlength="11" placeholder="e.g. 08098765432" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="data-pin">Confirm with your 6-digit PIN</label>
          <input class="input" id="data-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="••••••" required />
          <p class="field__error"></p>
        </div>

        <button class="btn btn--green" id="data-submit" type="submit">Buy data</button>
      </form>
      <div id="data-success" hidden></div>
    `;

    ui.$("#data-network-grid").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-network]");
      if (!btn) return;
      ui.$$("#data-network-grid .chip").forEach((c) => c.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      const net = networks.find((n) => n.network === btn.dataset.network);
      ui.$("#data-plan-list").innerHTML = net.plans
        .map(
          (p) => `
            <label class="plan">
              <input class="plan__radio" type="radio" name="planId" value="${ui.escapeHtml(p.planId)}" />
              <span class="plan__main">${ui.escapeHtml(p.label)}</span>
              <span class="plan__price">${ui.escapeHtml(p.amountNgn)}</span>
            </label>`
        )
        .join("");
    });

    const pin = ui.$("#data-pin");
    pin.addEventListener("input", () => {
      pin.value = pin.value.replace(/\D/g, "").slice(0, 6);
    });

    ui.$("#data-form").addEventListener("submit", onData);
  }

  async function onData(e) {
    e.preventDefault();
    const form = ui.$("#data-form");
    ui.resetFormErrors(form);

    const network = ui.$("#data-network-grid .chip.is-selected")?.dataset.network;
    const planEl = form.elements.planId;
    const planId = planEl ? planEl.value : null;

    if (!network) {
      ui.toast("Select a network first", "error");
      return;
    }
    if (!planId) {
      ui.toast("Select a data plan", "error");
      return;
    }

    const phone = ui.$("#data-phone").value.replace(/\D/g, "");
    if (phone.length < 11) {
      ui.toast("Enter a valid Nigerian phone number", "error");
      return;
    }

    pin(form, ui.$("#data-submit"), "Purchasing…", "Buy data", async () => {
      const data = await api("/bills/data", {
        method: "POST",
        body: { network, planId, phone, pin: ui.$("#data-pin").value },
        headers: { "Idempotency-Key": idempotencyKey() },
      });
      ui.toast("Data purchased", "success");
      ui.$("#data-form").hidden = true;
      ui.$("#data-success").innerHTML = `
        <div class="card">
          <div class="success-card">
            <div class="success-card__icon">${ui.icon("wifi")}</div>
            <div class="success-card__title">Data top-up complete</div>
            <div class="success-card__amount">${ui.escapeHtml(data.purchase.plan)}</div>
            <p class="success-card__sub">${ui.escapeHtml(data.purchase.network)} · ${ui.escapeHtml(data.amountNgn)} to ${ui.escapeHtml(data.purchase.phone)}</p>
            <div class="token-box">
              <div class="token-box__label">Provider reference</div>
              <div class="token-box__value">${ui.escapeHtml(data.purchase.provider)}</div>
            </div>
            <p class="success-card__meta">New balance: ${ui.escapeHtml(data.balanceNgn)}</p>
            <a class="btn btn--primary btn--small" href="transaction.html?id=${encodeURIComponent(data.transactionId)}">View transaction</a>
            <button class="ghost-btn" type="button" onclick="location.reload()">Buy again</button>
          </div>
        </div>`;
      ui.$("#data-success").hidden = false;
      refreshRecent();
    }, form);
  }

  // ---- Cable TV --------------------------------------------------------------

  function renderCable() {
    const providers = catalog.cable.providers;
    const body = ui.$("#tab-body");
    body.innerHTML = `
      <form class="form card" id="cable-form" novalidate>
        <div class="error-banner" role="alert"></div>

        <div class="field">
          <label class="field__label" for="cable-provider">Provider</label>
          <select class="input" id="cable-provider" name="provider" required>
            <option value="">Select…</option>
            ${providers.map((p) => `<option value="${ui.escapeHtml(p.provider)}">${ui.escapeHtml(p.provider)}</option>`).join("")}
          </select>
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="cable-decoder">Decoder / IUC number</label>
          <input class="input" id="cable-decoder" name="decoderNo" type="tel" inputmode="numeric" maxlength="16" placeholder="e.g. 12345678" required />
          <p class="field__error"></p>
        </div>

        <button class="btn btn--primary" id="cable-lookup" type="button">Look up account</button>
        <div id="cable-account"></div>

        <div class="field">
          <label class="field__label">Subscription package</label>
          <div class="plan-list" id="cable-plan-list">
            <p class="page-sub">Look up your decoder, then pick a package.</p>
          </div>
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="cable-phone">Notification phone <span style="font-weight:400;color:var(--muted)">— optional</span></label>
          <input class="input" id="cable-phone" name="phone" type="tel" inputmode="numeric" maxlength="11" />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="cable-pin">Confirm with your 6-digit PIN</label>
          <input class="input" id="cable-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="••••••" required />
          <p class="field__error"></p>
        </div>

        <button class="btn btn--green" id="cable-submit" type="submit">Subscribe</button>
      </form>
      <div id="cable-success" hidden></div>
    `;

    const decoder = ui.$("#cable-decoder");
    decoder.addEventListener("input", () => {
      decoder.value = decoder.value.replace(/\D/g, "");
    });

    ui.$("#cable-lookup").addEventListener("click", async () => {
      const provider = ui.$("#cable-provider").value;
      const decoderNo = decoder.value;
      if (!provider || decoderNo.length < 6) {
        ui.toast("Select a provider and enter a valid decoder number", "error");
        return;
      }
      const btn = ui.$("#cable-lookup");
      btn.disabled = true;
      btn.textContent = "Looking up…";
      try {
        const { name } = await api("/bills/cable/lookup", {
          method: "POST",
          body: { provider, decoderNo },
        });
        ui.$("#cable-account").innerHTML = `
          <div class="account-hit">
            <span class="account-hit__dot" aria-hidden="true"></span>
            <div><strong>${ui.escapeHtml(name)}</strong><div class="account-hit__meta">${ui.escapeHtml(provider)} · ${ui.escapeHtml(decoderNo)}</div></div>
          </div>`;
        const providerData = catalog.cable.providers.find((p) => p.provider === provider);
        ui.$("#cable-plan-list").innerHTML = providerData.plans
          .map(
            (p) => `
              <label class="plan">
                <input class="plan__radio" type="radio" name="planId" value="${ui.escapeHtml(p.planId)}" />
                <span class="plan__main">${ui.escapeHtml(p.label)}</span>
                <span class="plan__price">${ui.escapeHtml(p.amountNgn)}</span>
              </label>`
          )
          .join("");
      } catch (err) {
        ui.toast(err.message || "Lookup failed", "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Look up account";
      }
    });

    const pin = ui.$("#cable-pin");
    pin.addEventListener("input", () => {
      pin.value = pin.value.replace(/\D/g, "").slice(0, 6);
    });

    ui.$("#cable-form").addEventListener("submit", onCable);
  }

  async function onCable(e) {
    e.preventDefault();
    const form = ui.$("#cable-form");
    ui.resetFormErrors(form);

    const planEl = form.elements.planId;
    if (!planEl || !planEl.value) {
      ui.toast("Look up your decoder and choose a package first", "error");
      return;
    }

    pin(form, ui.$("#cable-submit"), "Subscribing…", "Subscribe", async () => {
      const data = await api("/bills/cable", {
        method: "POST",
        body: {
          provider: ui.$("#cable-provider").value,
          decoderNo: ui.$("#cable-decoder").value,
          planId: planEl.value,
          phone: ui.$("#cable-phone").value.replace(/\D/g, "") || undefined,
          pin: ui.$("#cable-pin").value,
        },
        headers: { "Idempotency-Key": idempotencyKey() },
      });
      ui.toast("Subscription active", "success");
      ui.$("#cable-form").hidden = true;
      ui.$("#cable-success").innerHTML = `
        <div class="card">
          <div class="success-card">
            <div class="success-card__icon">${ui.icon("tv")}</div>
            <div class="success-card__title">Subscribed</div>
            <div class="success-card__amount">${ui.escapeHtml(data.purchase.plan)}</div>
            <p class="success-card__sub">${ui.escapeHtml(data.purchase.provider)} · ${ui.escapeHtml(data.purchase.decoderNo)} · ${ui.escapeHtml(data.amountNgn)}</p>
            <div class="token-box">
              <div class="token-box__label">Provider reference</div>
              <div class="token-box__value">${ui.escapeHtml(data.purchase.providerRef)}</div>
            </div>
            <p class="success-card__meta">New balance: ${ui.escapeHtml(data.balanceNgn)}</p>
            <a class="btn btn--primary btn--small" href="transaction.html?id=${encodeURIComponent(data.transactionId)}">View transaction</a>
            <button class="ghost-btn" type="button" onclick="location.reload()">Subscribe again</button>
          </div>
        </div>`;
      ui.$("#cable-success").hidden = false;
      refreshRecent();
    }, form);
  }

  // --- shared "confirm with PIN" submit wrapper ------------

  function pin(form, submit, busyLabel, idleLabel, action) {
    submit.disabled = true;
    submit.textContent = busyLabel;
    action()
      .catch((err) => {
        ui.showFormErrors(form, err);
        submit.disabled = false;
        submit.textContent = idleLabel;
      });
  }
})();