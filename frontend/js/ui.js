// ui.js — shared UI helpers for every page.
// Keeps markup out of page scripts and error display consistent everywhere.

(function () {
  "use strict";

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // First letters of the first two words — the fallback shown when a user has
  // not set a picture, so the topbar is never an empty circle.
  function initialsOf(fullName) {
    return (fullName || "U")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  // Renders the user's picture, or their initials when there is no picture.
  //
  // The <img> is always rendered, even when there is no avatarUrl, and the
  // initials sit behind it. A picture that fails to load (the file was deleted
  // server-side, the session expired) then reveals the initials underneath
  // instead of leaving a broken-image icon, because the onerror handler removes
  // the image rather than the browser replacing it with its placeholder.
  //
  // ?v=<timestamp> defeats the browser cache after a new picture is saved.
  // Without it the shell would keep showing the old image for as long as the
  // cache allowed, which reads as "my upload did not work".
  //
  // @param {object} profile  the /users/me profile
  // @param {string} [extraClass]  additional class for the wrapper, e.g. "avatar--lg"
  function avatarHtml(profile, extraClass = "") {
    const initials = initialsOf(profile.fullName);
    const title = escapeHtml(profile.fullName);
    const url = profile.avatarUrl
      ? `${profile.avatarUrl}?v=${encodeURIComponent(profile.avatarUpdatedAt || 0)}`
      : "";
    return `
      <div class="avatar ${extraClass}" title="${title}" data-avatar>
        <span class="avatar__initials">${escapeHtml(initials)}</span>
        <img class="avatar__img" src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer"
             onerror="this.remove()" ${url ? "" : "hidden"} />
      </div>`;
  }

  // Hand-drawn line-icon set (24px grid, 2px strokes) — the same quiet
  // geometric language as the Flowband symbol. No emoji, no stock art.
  const ICONS = {
    home: '<path d="M4 11.5 12 4.5l8 7"/><path d="M6 10.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8.5"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    airtime: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M10 18.5h4"/>',
    bills: '<path d="M13 2 3 14h8l-2 8 9-12h-7l2-8Z"/>',
    profile: '<path d="M19 21a7 7 0 0 0-14 0"/><circle cx="12" cy="7" r="4"/>',
    wallet: '<path d="M19 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"/><circle cx="16" cy="12" r="1.6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15.5V5a2 2 0 0 1 2-2h10.5"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    id: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><circle cx="8.5" cy="10.5" r="1.7"/><path d="M6.5 15.5s.6-2 2-2 2 2 2 2"/><path d="M14 10h5M14 13.5h3"/>',
    trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h6v6"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    reverse: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
    transfer: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
    funding: '<path d="M17 7 7 17"/><path d="M8 17h9V8"/>',
    withdraw: '<path d="M7 7l10 10"/><path d="M16 7H7v9"/>',
    savings: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    wifi: '<path d="M4 10.5a11 11 0 0 1 16 0"/><path d="M7 13.5a7 7 0 0 1 10 0"/><path d="M10 16.5a3 3 0 0 1 4 0"/><circle cx="12" cy="19.3" r="1.3"/>',
    data: '<rect x="6" y="3" width="12" height="18" rx="2.5"/><path d="M9.5 3v4.5h5V3"/><path d="M9.5 12.5h5v4h-5z"/>',
    tv: '<rect x="3" y="6.5" width="18" height="12" rx="2"/><path d="m8 2.5 4 4 4-4"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8Z"/>',
    bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    bank: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v6M9.5 12v6M14.5 12v6M19 12v6"/><path d="M3 10 12 4l9 6M4 20h16"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/>',
    betting: '<path d="M4 5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2V8a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2v0a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2v2.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V16a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2v0a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2V5.5Z"/><path d="M9 12h6"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    // ---- Logistics & Dispatch + Ride-Hailing line icons ----
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
    bike: '<circle cx="18.5" cy="17.5" r="3.2"/><circle cx="5.5" cy="17.5" r="3.2"/><circle cx="15" cy="5" r="1.1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
    car: '<path d="M19 17h2a1 1 0 0 0 1-1v-3a2 2 0 0 0-.4-1.2l-1.6-2.4-1.8-1A2 2 0 0 0 17 8H8a2 2 0 0 0-1.4.6L4.4 10 2 13v3a1 1 0 0 0 1 1h2"/>' +
      '<circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 17h6"/><path d="M5 13h6"/>',
    van: '<path d="M14 18V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.6a1 1 0 0 0-.2-.6l-3.4-4.4a1 1 0 0 0-.8-.4H14"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.5-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2Z"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
    radar: '<circle cx="12" cy="12" r="2"/><path d="M6.4 6.9a7.5 7.5 0 0 1 11.2 0"/><path d="M3.7 3.7a12 12 0 0 1 16.6 0"/><path d="M6.4 17.1a7.5 7.5 0 0 0 11.2 0"/><path d="M3.7 20.3a12 12 0 0 1 16.6 0"/><path d="M13.4 10.6 19 5"/>',
    route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H12"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    flag: '<path d="M4 22V4a2 2 0 0 1 2-2h9l-2 5 2 5H6"/><path d="M16 6h4"/>',
    headset: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3Z"/>',
    alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/>',
    share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
    tag: '<path d="m12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4Z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
minus: '<path d="M5 12h14"/>',
     ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
     // ---- Rewards + virtual card line icons ----
     gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/><path d="M12 8v13"/><path d="M12 8c-4 0-5-1.5-5-3s1.5-2.5 3-1.5C11.4 4.5 12 8 12 8Z"/><path d="M12 8c4 0 5-1.5 5-3s-1.5-2.5-3-1.5C12.6 4.5 12 8 12 8Z"/>',
     rewards: '<path d="M3 9h18l-2 4v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7Z"/><path d="M12 9c0-4 1.2-6 4-6s3 1.6 3 3.5c0 .8-.6 1.5-1.4 1.6C15 8.3 13.3 8.8 12 9Z"/><path d="M12 9c0-4-1.2-6-4-6S5 4.6 5 6.5C5 7.3 5.6 8 6.4 8.1 9 8.3 10.7 8.8 12 9Z"/><path d="M4.8 13h14.4"/>',
     card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>',
     lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
     unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2A4 4 0 0 1 19 8.5"/>',
     eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
     eyeOff: '<path d="m3 3 18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 5.5c6.5 0 10 6.5 10 6.5a17.6 17.6 0 0 1-3.4 4.2M6.3 6.9A16.5 16.5 0 0 0 2 12s3.5 6.5 10 6.5c1 0 2.1-.2 3-.4"/>',
     percent: '<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
    trophy: '<path d="M7 4h10v4.5a5 5 0 0 1-10 0Z"/><path d="M7 6H4.2A2.2 2.2 0 0 0 6.8 9.3M17 6h2.8a2.2 2.2 0 0 1-2.6 3.3"/><path d="M12 13.5V18M8 22h8M10 15.5c0 1 1 2.5 2 2.5s2-1.5 2-2.5"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M15.5 3.1a4 4 0 0 1 0 7.8"/>',
     // ---- Wealth / investment line icons ----
    wealth: '<path d="M3 20h18"/><path d="M6 20V10"/><path d="M11 20V4"/><path d="M16 20v-7"/><path d="M21 20v-4"/>',
    stock: '<path d="M4 19V9"/><path d="M9.5 19V4"/><path d="M15 19v-7"/><path d="M20.5 19v-4"/><path d="M2.5 21h19"/>',
    fund: '<path d="M3 10.5 12 4l9 6.5"/><path d="M5 10v9.5a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5V10"/><path d="M10 20v-5.5h4V20"/>',
    pension: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 3v4.5M12 16.5V21M3 12h4.5M16.5 12H21"/>',
    bond: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10v4M9.8 10v4M13.2 10v4M16.5 10v4"/><path d="M19.5 10v4"/>',
    pie: '<path d="M12 3a9 9 0 1 0 9 9h-9Z"/><path d="M14.5 2.5A7.5 7.5 0 0 1 21.5 9.5h-7Z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
    clock2: '<path d="M12 7v5l3.5 2"/><path d="M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Z"/>',
     close: '<path d="M6 6 18 18"/><path d="M18 6 6 18"/>',
     logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
     };

  function icon(name, extraClass = "") {
    const body = ICONS[name];
    if (!body) return "";
    return `<svg class="ic ${extraClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  function formatNgn(nairaNumber) {
    // NOTE: this only FORMATS values already served by the backend (we never
    // compute a balance here). Use it for amounts the API already returned.
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 2,
    }).format(nairaNumber);
  }

  // Money amounts are whole naira typed by the user. Force digits-only so
  // decimals ("12.9"), signs and exponent notation can never reach parseInt and
  // silently round the amount down to something the user didn't type.
  const MONEY_MAX_DIGITS = 12;
  function moneyInput(el) {
    if (!el) return;
    el.addEventListener("input", () => {
      const digits = el.value.replace(/\D/g, "").slice(0, MONEY_MAX_DIGITS);
      if (digits !== el.value) el.value = digits;
    });
  }

  // One safe balance hint for every "amount (₦)" field. When the amount exceeds
  // the wallet we say so instead of rendering a giant negative "new balance".
  function balanceHint(hintEl, balanceMinor, nairaAmount) {
    if (!hintEl) return;
    if (!Number.isInteger(nairaAmount) || nairaAmount <= 0) {
      hintEl.hidden = true;
      return;
    }
    hintEl.hidden = false;
    if (nairaAmount * 100 > balanceMinor) {
      hintEl.textContent = `Insufficient balance — you have ${formatNgn(balanceMinor / 100)}.`;
      hintEl.style.color = "var(--danger)";
    } else {
      hintEl.textContent = `New balance: ${formatNgn((balanceMinor - nairaAmount * 100) / 100)}`;
      hintEl.style.color = "";
    }
  }

  // Direction of a money movement for the CURRENT user. The canonical rule
  // mirrors the backend: the wallet is debited unless it is the receiver (or the
  // movement is a top-up / savings payout, which credit the wallet even though
  // their ledger row records the wallet as the sender).
  const CREDIT_TYPES = new Set(["FUNDING", "SAVINGS_WITHDRAWAL"]);
  function txDirection(t, walletId) {
    const credit =
      CREDIT_TYPES.has(t.type) ||
      (t.sender ? t.sender.walletId !== walletId : true);
    return {
      credit,
      dir: credit ? "credit" : "debit",
      sign: credit ? "+" : "-",
      label: credit ? "Money in" : "Money out",
    };
  }

  function toast(message, type = "info") {
    let wrap = $(".toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "toast-wrap";
      document.body.appendChild(wrap);
    }
    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  // Attach backend validation details to form fields, and surface a fallback.
  function showFormErrors(form, err) {
    let count = 0;
    if (err.details && Array.isArray(err.details)) {
      for (const d of err.details) {
        const field = form.elements[d.field];
        if (!field) continue;
        field.closest(".field")?.classList.add("field--invalid");
        count += 1;
      }
    }
    if (count === 0 && err.message) {
      const banner = $(".error-banner", form);
      if (banner) {
        banner.textContent = err.message;
        banner.classList.add("error-banner--show");
      } else {
        toast(err.message, "error");
      }
    } else if (err.message) {
      toast(err.message, "error");
    }
  }

  // Clear all .field--invalid markers on a form and hide error banners.
  function resetFormErrors(form) {
    $$(".field--invalid", form).forEach((f) => f.classList.remove("field--invalid"));
    const banner = $(".error-banner", form);
    if (banner) banner.classList.remove("error-banner--show");
  }

  // The app shell (top nav + profile). profile comes from /users/me.
  function renderShell(profile, activePage) {
    // The old pill row under the content (Home / Savings / Profile) is gone:
    // the fixed bottom nav covers Home and Profile, so the element is removed
    // outright rather than left as an empty bar.
    document.querySelectorAll("[data-topnav]").forEach((el) => el.remove());

    renderBottomNav(activePage);

    renderAdTicker();

    const topbarRight = document.querySelector("[data-topbar-right]");
    if (topbarRight) {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      topbarRight.innerHTML = `
        <button class="theme-toggle" type="button" data-theme-toggle title="Toggle dark mode" aria-label="Toggle dark mode">
          ${icon(isDark ? "sun" : "moon")}
        </button>
        <div class="bell" data-bell>
          <button class="bell__btn" type="button" data-bell-toggle aria-label="Notifications" title="Notifications">
            ${icon("bell")}<span class="bell__badge" data-bell-badge hidden></span>
          </button>
          <div class="notif-tray" data-notif-tray hidden>
            <div class="notif-tray__head">
              <button class="notif-filter" type="button" data-notif-filter aria-pressed="false">Unread<span data-notif-filter-count></span></button>
              <span class="notif-tray__title">Notifications</span>
              <button class="link-btn" type="button" data-notif-all>Mark all read</button>
            </div>
            <div class="notif-tray__list" data-notif-list></div>
          </div>
        </div>
        <div class="topbar__person">
          <div class="topbar__name">${escapeHtml(profile.fullName)}</div>
          <div class="topbar__phone">${escapeHtml(profile.phone)}</div>
        </div>
        <button class="topbar__logout" type="button" data-logout title="Log out" aria-label="Log out">
          ${icon("logout")}
        </button>
        ${avatarHtml(profile)}`;
      const toggle = topbarRight.querySelector("[data-theme-toggle]");
      if (toggle) {
        toggle.addEventListener("click", () => {
          const nowDark = document.documentElement.getAttribute("data-theme") === "dark";
          const next = nowDark ? "light" : "dark";
          document.documentElement.setAttribute("data-theme", next);
          toggle.innerHTML = icon(next === "dark" ? "sun" : "moon");
          try {
            localStorage.setItem("agbe_theme", next);
          } catch (_) {}
        });
      }
      const logoutBtn = topbarRight.querySelector("[data-logout]");
      if (logoutBtn) logoutBtn.addEventListener("click", confirmLogout);
      wireNotifications(topbarRight);
    }
  }

  // ---- Bottom "tab" navigation ----------------------------------------------

  const BOTTOM_NAV = [
    ["home", "Home", "dashboard.html", "home"],
    ["wealth", "Wealth", "wealth.html", "wealth"],
    ["rewards", "Rewards", "rewards.html", "rewards"],
    ["card", "Card", "card.html", "card"],
    ["profile", "Profile", "profile.html", "profile"],
    ["headset", "Help", "help.html", "help"],
  ];

  function renderBottomNav(activePage) {
    let nav = document.querySelector("[data-bottomnav]");
    if (!nav) {
      nav = document.createElement("nav");
      nav.className = "bottomnav";
      nav.setAttribute("data-bottomnav", "");
      nav.setAttribute("aria-label", "Primary navigation");
      const app = document.querySelector(".app");
      if (!app) return;
      app.appendChild(nav);
    }
    // The grid is hardcoded to 5 columns in CSS, so keep the two in step here.
    // Adding a sixth nav item without this pushes "Profile" into a phantom
    // seventh column, off the right edge of the screen on a phone.
    nav.style.gridTemplateColumns = `repeat(${BOTTOM_NAV.length}, 1fr)`;
    nav.innerHTML = BOTTOM_NAV.map(
      ([name, label, href, key]) =>
        `<a class="bottomnav__item ${activePage === key ? "is-active" : ""}" href="${href}" ${activePage === key ? 'aria-current="page"' : ""}>
          <span class="bottomnav__icon" aria-hidden="true">${icon(name)}</span>
          <span class="bottomnav__label">${label}</span>
        </a>`
    ).join("");

    // Publish the nav's real rendered height so the fixed ad ticker sits exactly
    // on top of it and the page reserves enough space below. A hard-coded offset
    // drifts when the nav grows (safe-area insets, larger fonts, an extra tab).
    const syncNavHeight = (el) =>
      document.documentElement.style.setProperty("--bottomnav-h", `${(el || nav).offsetHeight}px`);
    syncNavHeight(nav);
    if (!window.__agbeNavResizeBound) {
      window.__agbeNavResizeBound = true;
      window.addEventListener("resize", () => syncNavHeight(document.querySelector("[data-bottomnav]")));
    }
  }

  // ---- Notifications bell + tray -------------------------------------------

  const NOTIF_ICONS = {
    TRANSACTION: "transfer",
    SAVINGS: "savings",
    SECURITY: "shield",
    KYC: "id",
    PROMO: "gift",
    SYSTEM: "bell",
    DISPATCH: "box",
    RIDE: "car",
    WITHDRAW: "withdraw",
    SUPPORT: "headset",
    WEALTH: "wealth",
  };

  function wireNotifications(root) {
    const bellBtn = root.querySelector("[data-bell-toggle]");
    const tray = root.querySelector("[data-notif-tray]");
    const badge = root.querySelector("[data-bell-badge]");
    const listEl = root.querySelector("[data-notif-list]");
    if (!bellBtn || !tray) return;

    const filterBtn = root.querySelector("[data-notif-filter]");
    const filterCount = root.querySelector("[data-notif-filter-count]");

    let loaded = false;
    let pollTimer = null;
    let unreadOnly = false;

    async function refreshBadge() {
      try {
        const { items = [], unread } = await window.AgbeAPI.request(
          `/notifications?limit=10${unreadOnly ? "&unreadOnly=true" : ""}`
        );
        badge.hidden = !unread;
        badge.textContent = unread > 9 ? "9+" : String(unread);
        if (filterCount) filterCount.textContent = unread ? String(unread) : "";
        if (!tray.hidden && listEl) renderList(items, unread);
        return unread;
      } catch (_) {
        return 0;
      }
    }

    function renderList(items, unread) {
      if (!items.length) {
        listEl.innerHTML = `<p class="empty empty--compact" style="padding:14px 10px">${
          unreadOnly ? "Nothing unread — you are all caught up." : "No notifications yet."
        }</p>`;
        return;
      }
      listEl.innerHTML = items
        .map(
          (n) => `
          <button class="notif ${n.read ? "is-read" : ""} ${n.link ? "has-link" : ""}" type="button" data-notif-id="${n.id}" data-goto="${escapeHtml(n.link || "")}">
            <span class="notif__icon" aria-hidden="true">${icon(NOTIF_ICONS[n.type] || "bell")}</span>
            <span class="notif__body">
              <span class="notif__title">${escapeHtml(n.title)}</span>
              ${n.body ? `<span class="notif__text">${escapeHtml(n.body)}</span>` : ""}
              <span class="notif__time">${timeAgo(n.createdAt)}</span>
            </span>
            ${n.link ? `<span class="notif__go" aria-hidden="true">${icon("chevron")}</span>` : ""}
            ${n.read ? `<span class="notif__dot is-read" aria-hidden="true"></span>` : `<span class="notif__dot" aria-hidden="true"></span>`}
          </button>`
        )
        .join("");
      listEl.querySelectorAll("[data-notif-id]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.notifId;
          const goto = btn.dataset.goto;
          await window.AgbeAPI.request(`/notifications/${id}/read`, { method: "POST" }).catch(() => {});
          if (goto) {
            window.location.href = goto;
            return;
          }
          btn.classList.add("is-read");
          btn.querySelector(".notif__dot")?.classList.add("is-read");
          if (unreadOnly) {
            btn.remove();
            if (!listEl.querySelector(".notif")) {
              listEl.innerHTML = `<p class="empty empty--compact" style="padding:14px 10px">Nothing unread — you are all caught up.</p>`;
            }
          }
          refreshBadge();
        });
      });
    }

    function timeAgo(iso) {
      const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 60) return "just now";
      if (s < 3600) return `${Math.floor(s / 60)}m ago`;
      if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
      return new Date(iso).toLocaleDateString();
    }

    bellBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      tray.hidden = !tray.hidden;
      if (!tray.hidden) {
        loaded = true;
        tray.querySelector("[data-notif-list]").innerHTML = "Loading…";
        await refreshBadge();
      }
    });

    if (filterBtn) {
      filterBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        unreadOnly = !unreadOnly;
        filterBtn.setAttribute("aria-pressed", String(unreadOnly));
        filterBtn.classList.toggle("is-active", unreadOnly);
        listEl.innerHTML = "Loading…";
        await refreshBadge();
      });
    }

    root.querySelectorAll("[data-notif-all]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await window.AgbeAPI.request("/notifications/read-all", { method: "POST" }).catch(() => {});
        loaded = false;
        listEl.innerHTML = "Loading…";
        await refreshBadge();
      })
    );

    // Click elsewhere closes the tray.
    document.addEventListener("click", (e) => {
      if (!root.contains(e.target)) tray.hidden = true;
    });

    refreshBadge();
    pollTimer = setInterval(refreshBadge, 30000);
    window.addEventListener("beforeunload", () => clearInterval(pollTimer));
  }

  // A guarded page: require a session before doing anything else.
  async function requireAuth(render) {
    try {
      const { profile } = await window.AgbeAPI.request("/users/me");
      render(profile);
    } catch (err) {
      if (err.status !== 401) {
        window.location.replace("login.html");
      }
    }
  }

  function logout() {
    window.AgbeAPI.request("/auth/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        window.location.replace("login.html");
      });
  }

  // Ask before dropping the session — a stray tap on the topbar icon should not
  // silently sign the user out of a page mid-task.
  function confirmLogout() {
    if (window.confirm("Log out of AgbedePay?")) logout();
  }

  // Compact "recent purchases" strip used by the airtime and bills pages.
  // Shows the last 5 ledger rows of a given type, linking to their details.
  const RECENT_ICONS = {
    AIRTIME: "airtime",
    BILLS: "bills",
    BETTING: "betting",
    BANK: "bank",
    DISPATCH: "box",
    RIDE: "car",
    WEALTH_BUY: "wealth",
    WEALTH_SELL: "wealth",
  };
  function recentLabel(type) {
    if (type === "AIRTIME") return "airtime";
    if (type === "BETTING") return "betting";
    if (type === "BANK") return "bank transfers";
    if (type === "DISPATCH") return "deliveries";
    if (type === "RIDE") return "rides";
    if (type === "WEALTH_BUY") return "investments";
    if (type === "WEALTH_SELL") return "investment sales";
    return "bills";
  }
  async function loadRecentPurchases(type, el) {
    if (!el) return;
    try {
      const { items = [], total } = await window.AgbeAPI.request(`/transactions?type=${type}&limit=5`);
      if (!items.length) {
        el.innerHTML = `<p class="empty empty--compact">No ${recentLabel(type)} purchases here yet.</p>`;
        return;
      }
      el.innerHTML = items
        .map((t) => {
          const credit = CREDIT_TYPES.has(type);
          return `
          <a class="tx-item" href="transaction.html?id=${encodeURIComponent(t.id)}">
            <div class="tx-item__icon" aria-hidden="true">${icon(RECENT_ICONS[type] || "wallet")}</div>
            <div class="tx-item__main">
              <div class="tx-item__title">${escapeHtml(t.narration || t.type)}</div>
              <div class="tx-item__meta">
                <span class="badge badge--${type}">${type}</span>
                <span class="badge badge--${t.status}">${t.status}</span>
              </div>
            </div>
            <div class="tx-item__right">
              <div class="tx-item__amount tx-item__amount--${credit ? "credit" : "debit"}">${credit ? "+" : "-"}${t.amountNgn}</div>
            </div>
          </a>`;
        })
        .join("");
      if (total > 5) {
        el.insertAdjacentHTML(
          "beforeend",
          `<a class="link-btn" href="transactions.html">See all →</a>`
        );
      }
    } catch (_) {
      el.innerHTML = "";
    }
  }

  // Continuous advert ticker pinned to the bottom of every app page.
  // The track content is duplicated so the CSS translateX(-50%) loop is seamless.
  const AD_ITEMS = [
    "AutoSave is here — round up every purchase into your savings goals. Tap any goal on Home.",
    "Airtime & data at the best rates: buy in under ten seconds from Airtime or Bills.",
    "Refer a friend and you both earn ₦500. Share your code from Profile.",
    "Business loans up to ₦5,000,000 for verified customers — eligibility checks apply.",
    "Stay safe: AgbedePay will never ask for your PIN or password. Report anything suspicious.",
    "Send straight to any bank account in Nigeria — Kuda, Opay, GTBank & more, on the fly.",
    "Request money from anyone by phone number and get paid instantly into your wallet.",
    "Electricity tokens, instantly — preloaded metre numbers are remembered automatically.",
    "Bet smart, win big — fund Bet9ja, SportyBet, 1xBet & more straight from Betting.",
    "Grow your money with Wealth — buy real NGX stocks, FGN treasury bills and pension funds.",
  ];
  function renderAdTicker() {
    const el = document.querySelector("[data-ad-ticker]");
    if (!el) return;
    const group = (copy) =>
      copy
        .map(
          (text) =>
            `<span class="ad-ticker__item"><span class="ad-ticker__badge">Ad</span>${escapeHtml(text)}</span>`
        )
        .join("");
    el.innerHTML = `
      <div class="ad-ticker__track">
        <div class="ad-ticker__group">${group(AD_ITEMS)}</div>
        <div class="ad-ticker__group">${group(AD_ITEMS)}</div>
      </div>`;
  }

  // Progress stepper for dispatch/ride tracking. active = index of the current step.
  function stepper(steps, active) {
    const done = Math.max(0, Math.min(active, steps.length - 1));
    return `<ol class="stepper">${steps
      .map((label, i) => {
        const cls = i < done ? "is-done" : i === done ? "is-active" : "";
        const dot = i < done ? icon("check") : `<b>${i + 1}</b>`;
        return `<li class="stepper__step ${cls}" aria-label="Step ${i + 1}: ${escapeHtml(label)}">
          <span class="stepper__dot">${dot}</span>
          <span class="stepper__label">${escapeHtml(label)}</span>
        </li>`;
      })
      .join("")}</ol>`;
  }

  // Read-only star rating display (1–5).
  function stars(value) {
    const full = Math.round(value);
    return `<span class="stars" role="img" aria-label="${full} of 5 stars">${Array.from(
      { length: 5 },
      (_, i) => `<span class="star${i < full ? " is-filled" : ""}">${icon("star")}</span>`
    ).join("")}</span>`;
  }

  // One-tap "quick tag" chips (locking). Returns an html string of buttons.
  function tagChips(tags) {
    return `<div class="tag-row">${tags
      .map(
        (t) =>
          `<button type="button" class="tag-chip" data-tag="${escapeHtml(t)}">${escapeHtml(
            t.split("_").join(" ")
          )}</button>`
      )
      .join("")}</div>`;
  }

  // Standalone loading card used by page renderers.
  function loadingCard(text) {
    return `<div class="empty">${escapeHtml(text || "Loading…")}</div>`;
  }

  // Full-screen wallet PIN modal; resolves with the 6-digit PIN.
  async function promptPin({ title, subtitle, button, amount }) {
    return await new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.innerHTML = `
        <div class="modal-backdrop">
          <div class="modal" role="dialog" aria-modal="true">
            <div class="modal__title">${escapeHtml(title || "Enter wallet PIN")}</div>
            <div class="modal__text">${escapeHtml(subtitle || "")}${
          amount ? `<div class="modal__amount">${escapeHtml(amount)}</div>` : ""
        }</div>
            <div class="field">
              <input class="input input--pin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" placeholder="6-digit PIN" aria-label="Wallet PIN" />
            </div>
            <div class="modal__actions">
              <button class="ghost-btn" type="button" data-cancel>Cancel</button>
              <button class="btn btn--green" type="button" data-ok disabled>${escapeHtml(button || "Confirm")}</button>
            </div>
          </div>
        </div>`;
      const $m = wrap.firstElementChild;
      const $input = $m.querySelector(".input--pin");
      const $ok = $m.querySelector("[data-ok]");
      const close = (val) => {
        $m.remove();
        resolve(val);
      };
      $m.querySelector("[data-cancel]").onclick = () => close(null);
      $m.onclick = (e) => {
        if (e.target === $m) close(null);
      };
      $input.addEventListener("input", () => {
        const v = $input.value.replace(/\D/g, "").slice(0, 6);
        $input.value = v;
        $ok.disabled = v.length !== 6;
      });
      $ok.onclick = () => close($input.value);
      setTimeout(() => $input.focus(), 0);
      window.AgbeUI.$("body").append($m);
    });
  }

  window.AgbeUI = {
    $,
    $$,
    escapeHtml,
    initialsOf,
    avatarHtml,
    formatNgn,
    moneyInput,
    balanceHint,
    txDirection,
    icon,
    toast,
    showFormErrors,
    resetFormErrors,
    renderShell,
    requireAuth,
    logout,
    confirmLogout,
    loadRecentPurchases,
    renderAdTicker,
    stepper,
    stars,
    tagChips,
    loadingCard,
    promptPin,
  };
})();