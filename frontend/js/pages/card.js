// card — virtual card management. A polished product UI; the issuing backend is
// coming later, so card state (freeze, PIN, events) lives in localStorage for now.

(function () {
  "use strict";

  const { api } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const page = ui.$("#page");

  let currentProfile = null;

  const CARD_PAN = "4460 0000 0048 2910";
  const CARD_CVV = "389";
  const CARD_PIN = "9910";
  const CARD_EXP = "08 / 29";

  const KEY_FROZEN = "agbe_card_frozen";
  const KEY_EVENTS = "agbe_card_events";
  const SEED_EVENTS = ["Virtual card created", "Card PIN set"];

  function loadEvents() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY_EVENTS) || "null");
      return Array.isArray(raw) && raw.length ? raw : SEED_EVENTS.slice();
    } catch (_) {
      return SEED_EVENTS.slice();
    }
  }
  function saveEvents(events) {
    try {
      localStorage.setItem(KEY_EVENTS, JSON.stringify(events));
    } catch (_) {}
  }
  function isFrozen() {
    return localStorage.getItem(KEY_FROZEN) === "1";
  }
  function setFrozen(frozen) {
    try {
      localStorage.setItem(KEY_FROZEN, frozen ? "1" : "0");
    } catch (_) {}
  }
  function pushEvent(text) {
    const evts = loadEvents();
    evts.unshift(text);
    saveEvents(evts.slice(0, 8));
  }

  function maskedPan() {
    const last4 = CARD_PAN.replace(/\s/g, "").slice(-4);
    return `•••• •••• •••• ${last4}`;
  }

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "card");
    currentProfile = profile;
    render(profile);
  });

  function render(profile) {
    const frozen = isFrozen();
    const firstName = profile.fullName?.split(" ")[0] || "ADA";

    page.innerHTML = `
      <div class="page-title">Virtual card</div>
      <p class="page-sub">The AgbedePay card you can use online — freeze it anytime.</p>

      <div class="vcard-wrap">
        <div class="vcard ${frozen ? "is-frozen" : ""}" aria-live="polite">
          <div class="vcard__glow" aria-hidden="true"></div>
          <div class="vcard__top">
            <span class="vcard__brand"><img src="../brand/symbol.svg" alt="" draggable="false" /><b>AgbedePay</b></span>
            <span class="vcard__type">DEBIT</span>
          </div>
          <div class="vcard__mid">
            <span class="vcard__chip" aria-hidden="true"></span>
            <svg class="vcard__contactless" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8.5 8.5a5 5 0 0 1 0 7"/><path d="M11.5 6a8.5 8.5 0 0 1 0 12"/><path d="M14.5 4a12 12 0 0 1 0 16"/></svg>
          </div>
          <div class="vcard__number" data-card-number>${maskedPan()}</div>
          <div class="vcard__bottom">
            <div class="vcard__holder"><span class="vcard__label">CARD HOLDER</span><b data-card-name>${ui.escapeHtml(profile.fullName || "ADA OBI")}</b></div>
            <div class="vcard__expiry"><span class="vcard__label">EXPIRES</span><b>${CARD_EXP}</b></div>
          </div>
          <div class="vcard__status" data-card-status>${frozen ? "Frozen" : "Active"}</div>
        </div>
      </div>

      ${frozen ? `<div class="notice vcard-notice"><strong>This card is frozen.</strong> Online and contactless payments are blocked until you unfreeze it.</div>` : ""}

      <div class="card" style="margin-top:16px">
        <div class="section-head" style="margin:0 0 10px"><h2>Card controls</h2></div>
        <div class="switch-row">
          <label class="switch">
            <input type="checkbox" id="card-freeze" ${frozen ? "checked" : ""} />
            <span class="switch__slider" aria-hidden="true"></span>
          </label>
          <div>
            <div class="switch__label">${frozen ? "Unfreeze card" : "Freeze card"}</div>
            <p class="page-sub" style="margin:4px 0 0;font-size:.82rem">Freezing blocks all card payments in seconds. You stay signed in, and your wallet is untouched.</p>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn--ghost" type="button" data-copy-number>${ui.icon("copy")} Copy number</button>
          <button class="btn btn--ghost" type="button" data-toggle-cvv>${ui.icon("eye")} <span data-cvv-label>Show CVV</span></button>
          <button class="btn btn--ghost" type="button" data-view-pin>${ui.icon("lock")} View PIN</button>
        </div>
        <div class="cvv-row" data-cvv-row hidden>
          <span class="cvv-row__label">Security code (CVV)</span>
          <b data-cvv-value>•••</b>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="section-head" style="margin:0 0 6px"><h2>Card activity</h2></div>
        <div class="tx-list" data-card-history>${loadEvents()
          .map(
            (e) => `
          <div class="tx-item">
            <div class="tx-item__icon" aria-hidden="true">${ui.icon("card")}</div>
            <div class="tx-item__main">
              <div class="tx-item__title">${ui.escapeHtml(e)}</div>
              <div class="tx-item__meta"><span class="badge badge--SUCCESS">Card</span></div>
            </div>
          </div>`
          )
          .join("")}</div>
      </div>

      <button class="ghost-btn ghost-btn--danger" type="button" data-card-lost>${ui.icon("alert")} Report card lost or stolen</button>
    `;

    wireControl();
  }

  function wireControl() {
    const freeze = ui.$("#card-freeze");
    if (freeze) {
      freeze.addEventListener("change", () => {
        const frozen = freeze.checked;
        setFrozen(frozen);
        pushEvent(frozen ? "Card frozen" : "Card unfrozen");
        ui.toast(frozen ? "Card frozen — payments blocked" : "Card is active again", "success");
        const wrap = page.querySelector(".vcard");
        if (wrap) wrap.classList.toggle("is-frozen", frozen);
        const status = page.querySelector("[data-card-status]");
        if (status) status.textContent = frozen ? "Frozen" : "Active";
        const label = page.querySelector(".switch__label");
        if (label) label.textContent = frozen ? "Unfreeze card" : "Freeze card";
        const notice = page.querySelector(".vcard-notice");
        if (frozen && !notice) {
          const host = page.querySelector(".vcard-wrap");
          host.insertAdjacentHTML(
            "afterend",
            `<div class="notice vcard-notice"><strong>This card is frozen.</strong> Online and contactless payments are blocked until you unfreeze it.</div>`
          );
        } else if (!frozen && notice) {
          notice.remove();
        }
        rerenderHistory();
      });
    }

    const copyBtn = page.querySelector("[data-copy-number]");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        navigator.clipboard
          ?.writeText(CARD_PAN)
          .then(() => ui.toast("Card number copied", "success"))
          .catch(() => ui.toast("Couldn't copy — use the number shown on the card", "info"));
      });
    }

    const cvvBtn = page.querySelector("[data-toggle-cvv]");
    if (cvvBtn) {
      let shown = false;
      cvvBtn.addEventListener("click", () => {
        shown = !shown;
        const val = page.querySelector("[data-cvv-value]");
        const label = page.querySelector("[data-cvv-label]");
        const row = page.querySelector("[data-cvv-row]");
        if (shown) {
          val.textContent = CARD_CVV;
          label.textContent = "Hide CVV";
          row.hidden = false;
          cvvBtn.innerHTML = `${ui.icon("eyeOff")} <span data-cvv-label>Hide CVV</span>`;
        } else {
          val.textContent = "•••";
          label.textContent = "Show CVV";
          row.hidden = true;
          cvvBtn.innerHTML = `${ui.icon("eye")} <span data-cvv-label>Show CVV</span>`;
        }
      });
    }

    const pinBtn = page.querySelector("[data-view-pin]");
    if (pinBtn) {
      pinBtn.addEventListener("click", () => openPinModal());
    }

    const lostBtn = page.querySelector("[data-card-lost]");
    if (lostBtn) {
      lostBtn.addEventListener("click", () => {
        if (!isFrozen()) {
          setFrozen(true);
          pushEvent("Card frozen after loss report");
          const freeze = ui.$("#card-freeze");
          if (freeze) freeze.checked = true;
        }
        ui.toast("Card locked — contact support to order a replacement.", "success");
        render(currentProfile);
      });
    }
  }

  function openPinModal() {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="Card PIN">
        <div class="modal__head">
          <h3>Card PIN</h3>
          <button class="modal__close" type="button" data-close aria-label="Close">${ui.icon("copy")}</button>
        </div>
        <p class="modal__sub">Your 4-digit card PIN — this is not your wallet PIN.</p>
        <div class="pin-reveal">
          <div class="pin-reveal__value" data-pin-value>••••</div>
          <button class="btn btn--ghost" type="button" data-pin-toggle>${ui.icon("eye")} Reveal</button>
        </div>
        <p class="page-sub" style="font-size:.8rem">Never share this PIN or your CVV with anyone.</p>
      </div>`;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelector("[data-close]").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });

    const val = backdrop.querySelector("[data-pin-value]");
    const toggle = backdrop.querySelector("[data-pin-toggle]");
    let shown = false;
    toggle.addEventListener("click", () => {
      shown = !shown;
      val.textContent = shown ? CARD_PIN : "••••";
      toggle.innerHTML = shown ? `${ui.icon("eyeOff")} Hide` : `${ui.icon("eye")} Reveal`;
    });
  }

  function rerenderHistory() {
    const host = page.querySelector("[data-card-history]");
    if (!host) return;
    host.innerHTML = loadEvents()
      .map(
        (e) => `
          <div class="tx-item">
            <div class="tx-item__icon" aria-hidden="true">${ui.icon("card")}</div>
            <div class="tx-item__main">
              <div class="tx-item__title">${ui.escapeHtml(e)}</div>
              <div class="tx-item__meta"><span class="badge badge--SUCCESS">Card</span></div>
            </div>
          </div>`
      )
      .join("");
  }
})();