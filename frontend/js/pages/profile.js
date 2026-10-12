// profile page — bio data (KYC) form + NIN/BVN identity verification.
// The backend is the source of truth for verification_level; this page only
// renders it and submits explicit user input.

(function () {
  "use strict";

  const { api } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT - Abuja", "Gombe",
    "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
    "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
    "Taraba", "Yobe", "Zamfara",
  ];

  const page = ui.$("#page");
  let currentProfile = null;

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "profile");
    currentProfile = profile;
    try {
      const { kyc } = await api("/kyc");
      render(kyc);
    } catch (err) {
      page.innerHTML = `<div class="error-banner error-banner--show" role="alert">${ui.escapeHtml(err.message)}</div>`;
    }
  });

  function isoDate(dateOfBirth) {
    // Backend stores DATE and pg returns a UTC-midnight timestamp; normalise to
    // a local YYYY-MM-DD so <input type="date"> fills correctly.
    if (!dateOfBirth) return "";
    return new Date(dateOfBirth).toLocaleDateString("en-CA");
  }

  function levelBadge(kyc) {
    if (kyc.level === "IDENTITY_VERIFIED")
      return `<span class="badge badge--SUCCESS">Verified — ${ui.escapeHtml(kyc.identityType)}</span>`;
    if (kyc.level === "BASIC")
      return `<span class="badge badge--WITHDRAWAL">Bio complete — not verified</span>`;
    return `<span class="badge badge--FAILED">Not verified</span>`;
  }

  function render(kyc) {
    const b = kyc.bio || {};
    const steps = kyc.steps || {};
    const stepKeys = [
      ["fullName", "Full name"],
      ["dateOfBirth", "Date of birth"],
      ["gender", "Gender"],
      ["address", "Address"],
      ["city", "City"],
      ["state", "State"],
      ["occupation", "Occupation"],
      ["nextOfKin", "Next of kin"],
    ];
    const done = stepKeys.filter(([k]) => steps[k]).length;
    const stateOptions = STATES.map(
      (s) => `<option value="${ui.escapeHtml(s)}" ${b.state === s ? "selected" : ""}>${ui.escapeHtml(s)}</option>`
    ).join("");
    const relationOptions = ["Spouse", "Parent", "Sibling", "Child", "Friend", "Other"]
      .map(
        (r) => `<option value="${r}" ${b.nextOfKinRelation === r ? "selected" : ""}>${r}</option>`
      )
      .join("");

    page.innerHTML = `
      <div class="card card--picture">
        ${ui.avatarHtml(currentProfile, "avatar--lg")}
        <div class="card--picture__text">
          <h2 class="card--picture__name">${ui.escapeHtml(currentProfile.fullName)}</h2>
          <p class="card--picture__sub">${ui.escapeHtml(currentProfile.phone)}</p>
        </div>
        <div class="card--picture__actions">
          <button class="btn btn--ghost" type="button" data-pic-remove ${currentProfile.avatarUrl ? "" : "hidden"}>Remove</button>
          <button class="btn btn--primary" type="button" data-pic-trigger>${currentProfile.avatarUrl ? "Change" : "Add"} picture</button>
          <!-- The real file input is kept in the DOM and driven by the button
               above, because a styled <label> is unreliable for keyboard and
               screen-reader users, while a visually hidden native input keeps
               native drag-and-drop and file-type validation behaviour. -->
          <input type="file" accept="image/jpeg,image/png,image/webp" data-pic-input hidden />
        </div>
        <p class="card--picture__hint">JPEG, PNG or WebP, up to 2&nbsp;MB. Your picture is stored privately and shown only inside your account.</p>
      </div>

      <div class="card" style="margin-bottom:18px">
        <div class="kyc-status">
          <div class="kyc-status__badges">${levelBadge(kyc)}</div>
          <div class="progress" role="progressbar" aria-valuenow="${done}" aria-valuemin="0" aria-valuemax="${stepKeys.length}">
            <div class="progress__fill" style="width:${Math.round((done / stepKeys.length) * 100)}%"></div>
          </div>
          <ul class="steps-list">
            ${stepKeys
              .map(
                ([k, label]) =>
                  `<li class="steps-list__item ${steps[k] ? "is-done" : ""}"><span class="steps-list__check">${steps[k] ? "✓" : "○"}</span>${ui.escapeHtml(label)}</li>`
              )
              .join("")}
            <li class="steps-list__item ${kyc.identityVerified ? "is-done" : ""}"><span class="steps-list__check">${kyc.identityVerified ? "✓" : "○"}</span>Identity (NIN / BVN)</li>
          </ul>
        </div>
      </div>

      <form class="form card" id="bio-form" novalidate>
        <div class="section-head"><h2>Bio data</h2></div>
        <div class="error-banner" role="alert"></div>

        <div class="field">
          <label class="field__label" for="bio-fullname">Full name</label>
          <input class="input" id="bio-fullname" name="fullName" type="text" maxlength="120" value="${ui.escapeHtml(b.fullName || "")}" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="bio-email">Email <span style="font-weight:400;color:var(--muted)">— optional</span></label>
          <input class="input" id="bio-email" name="email" type="email" maxlength="120" value="${ui.escapeHtml(b.email || "")}" />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="bio-dob">Date of birth</label>
          <input class="input" id="bio-dob" name="dateOfBirth" type="date" value="${isoDate(b.dateOfBirth)}" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="bio-gender">Gender</label>
          <select class="input" id="bio-gender" name="gender" required>
            <option value="">Select…</option>
            <option value="M" ${b.gender === "M" ? "selected" : ""}>Male</option>
            <option value="F" ${b.gender === "F" ? "selected" : ""}>Female</option>
          </select>
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="bio-address">Residential address</label>
          <input class="input" id="bio-address" name="address" type="text" maxlength="200" value="${ui.escapeHtml(b.address || "")}" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="bio-city">City</label>
          <input class="input" id="bio-city" name="city" type="text" maxlength="80" value="${ui.escapeHtml(b.city || "")}" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="bio-state">State</label>
          <select class="input" id="bio-state" name="state" required>
            <option value="">Select…</option>
            ${stateOptions}
          </select>
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="bio-occupation">Occupation</label>
          <input class="input" id="bio-occupation" name="occupation" type="text" maxlength="120" value="${ui.escapeHtml(b.occupation || "")}" placeholder="e.g. Software Engineer" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="bio-nextkin-name">Next of kin — full name</label>
          <input class="input" id="bio-nextkin-name" name="nextOfKinName" type="text" maxlength="120" value="${ui.escapeHtml(b.nextOfKinName || "")}" placeholder="e.g. Ngozi Nwosu" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="bio-nextkin-phone">Next of kin — phone number</label>
          <input class="input" id="bio-nextkin-phone" name="nextOfKinPhone" type="tel" inputmode="numeric" maxlength="20" value="${ui.escapeHtml(b.nextOfKinPhone || "")}" placeholder="e.g. 08012345678" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="bio-nextkin-relation">Next of kin — relationship</label>
          <select class="input" id="bio-nextkin-relation" name="nextOfKinRelation" required>
            <option value="">Select…</option>
            ${relationOptions}
          </select>
          <p class="field__error"></p>
        </div>

        <button class="btn btn--green" id="bio-submit" type="submit">Save bio data</button>
      </form>

      <form class="form card" id="verify-form" style="margin-top:18px" novalidate>
        <div class="section-head"><h2>Identity verification</h2></div>        <p class="page-sub" style="margin:0 0 12px">${
          kyc.identityVerified
            ? `Your identity is verified via <strong>${ui.escapeHtml(kyc.identityType)}</strong>${kyc.verifiedAt ? " on " + new Date(kyc.verifiedAt).toLocaleDateString() : ""}.`
            : "Verify your National Identification Number (NIN) or Bank Verification Number (BVN). The number is never stored — only a secure hash is kept."
        }</p>
        <div class="error-banner" role="alert"></div>

        ${
          kyc.identityVerified
            ? ""
            : `
          <div class="field">
            <label class="field__label" for="id-type">Identity type</label>
            <select class="input" id="id-type" name="identityType" required>
              <option value="">Select…</option>
              <option value="NIN">NIN</option>
              <option value="BVN">BVN</option>
            </select>
            <p class="field__error"></p>
          </div>

          <div class="field">
            <label class="field__label" for="id-number">Identity number</label>
            <input class="input" id="id-number" name="identityNumber" type="tel" inputmode="numeric" maxlength="11" placeholder="11 digits" required />
            <p class="field__error"></p>
          </div>

          <div class="field">
            <label class="field__label" for="id-pin">Confirm with your 6-digit PIN</label>
            <input class="input" id="id-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="••••••" required />
            <p class="field__error"></p>
          </div>

          <button class="btn btn--primary" id="verify-submit" type="submit">Verify my identity</button>`
        }
      </form>

      ${limitsHtml(kyc)}

      <form class="form card" id="pin-form" style="margin-top:18px" novalidate>
        <div class="section-head"><h2>Change PIN</h2></div>
        <p class="page-sub" style="margin:0 0 12px">Keep your money safe — change your 6-digit PIN anytime.</p>
        <div class="error-banner" role="alert"></div>

        <div class="field">
          <label class="field__label" for="pin-current">Current PIN</label>
          <input class="input" id="pin-current" name="currentPin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="••••••" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="pin-new">New PIN</label>
          <input class="input" id="pin-new" name="newPin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" placeholder="••••••" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="pin-confirm">Confirm new PIN</label>
          <input class="input" id="pin-confirm" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" placeholder="••••••" required />
          <p class="field__error"></p>
        </div>

        <button class="btn btn--primary" id="pin-submit" type="submit">Update PIN</button>
      </form>

      <div class="card" style="margin-top:18px">
        <div class="section-head" style="margin:0 0 10px"><h2>Log-in security</h2></div>
        <div class="switch-row">
          <label class="switch">
            <input type="checkbox" id="sec-toggle" ${currentProfile?.loginOtpEnabled ? "checked" : ""} />
            <span class="switch__slider" aria-hidden="true"></span>
          </label>
          <div>
            <div class="switch__label">Ask for a security code when I log in</div>
            <p class="page-sub" style="margin:4px 0 0;font-size:.82rem">After your PIN, a one-time 6-digit code is sent to verify the log-in. No code is needed to send money.</p>
          </div>
        </div>
        <div class="switch-row" style="margin-top:14px">
          <label class="switch">
            <input type="checkbox" id="alert-toggle" ${currentProfile?.securityAlertEnabled ? "checked" : ""} />
            <span class="switch__slider" aria-hidden="true"></span>
          </label>
          <div>
            <div class="switch__label">Alert me when a new device signs in</div>
            <p class="page-sub" style="margin:4px 0 0;font-size:.82rem">You'll get a security notice with the device and IP. If it isn't you, sign out on that device.</p>
          </div>
        </div>
      </div>

      <div class="card" id="referral-card" style="margin-top:18px">
        <div class="section-head" style="margin:0 0 8px"><h2>Refer &amp; earn ₦500</h2></div>
        <p class="page-sub" style="margin:0 0 12px">Share your code — when a friend registers with it and tops up, you <strong>both</strong> get a ₦500 bonus.</p>
        <div class="referral-box">
          <div class="token-box">
            <div class="token-box__label">Your referral code</div>
            <div class="token-box__value" data-refcode>—</div>
          </div>
          <button class="btn btn--green btn--block" id="ref-copy" type="button">${ui.icon("copy")} Copy your invite link</button>
        </div>
        <ul class="limits-list referral-stats">
          <li class="limits-list__item"><span>People you've invited</span><strong data-ref-referred>—</strong></li>
          <li class="limits-list__item"><span>Bonuses earned</span><strong data-ref-bonus>—</strong></li>
        </ul>
      </div>

      <div class="card" style="margin-top:18px">
        <div class="section-head" style="margin:0 0 8px"><h2>Account</h2></div>
        <p class="page-sub" style="margin:0 0 14px">You are signed in as <strong>${ui.escapeHtml(currentProfile.phone)}</strong>.</p>
        <button class="btn btn--danger" id="logout-btn" type="button">${ui.icon("logout")} Log out</button>
      </div>
    `;

    wireSecurity();
    wireReferral();
    wireBio();
    wireIdentity(kyc);
    wirePinChange();
    wirePicture();
    ui.$("#logout-btn")?.addEventListener("click", ui.confirmLogout);
  }

  // ---- Profile picture -------------------------------------------------------

  // Client-side guard, mirroring the server's MAX_AVATAR_BYTES so the common
  // case fails instantly with a clear message instead of round-tripping a file
  // the server is going to reject anyway. The server still enforces it: this is
  // convenience, not security.
  const MAX_BYTES = 2 * 1024 * 1024;
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

  // The avatar is only ever displayed at 96px, so there is no reason to upload
  // a 12-megapixel original. Downscaling in the browser with a canvas both keeps
  // most uploads under the limit and strips EXIF data — including the GPS
  // coordinates phones embed by default — before it ever leaves the device.
  // The server cannot do this without a native image library (sharp).
  const MAX_EDGE = 512;

  function wirePicture() {
    const input = ui.$("[data-pic-input]");
    const trigger = ui.$("[data-pic-trigger]");
    const remove = ui.$("[data-pic-remove]");
    const card = ui.$(".card--picture");
    if (!input || !trigger) return;

    trigger.addEventListener("click", () => input.click());

    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      // Reset immediately so re-picking the SAME file fires change again,
      // otherwise choosing a picture twice in a row silently does nothing.
      input.value = "";
      if (!file) return;

      if (!ALLOWED_TYPES.includes(file.type)) {
        ui.toast("Choose a JPEG, PNG or WebP image", "error");
        return;
      }
      if (file.size > MAX_BYTES) {
        ui.toast(
          `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB — try a smaller photo.`,
          "error"
        );
        return;
      }

      trigger.disabled = true;
      trigger.textContent = "Uploading…";
      try {
        const blob = await downscale(file);
        const form = new FormData();
        // The field name MUST match avatarUpload's .single("avatar").
        form.append("avatar", blob, blob.name || "avatar.jpg");
        const { profile } = await api("/users/avatar", { method: "POST", body: form });
        applyPicture(profile);
        ui.toast("Profile picture updated", "success");
      } catch (err) {
        ui.toast(err.message || "Could not upload that picture", "error");
      } finally {
        trigger.disabled = false;
        trigger.textContent = currentProfile.avatarUrl ? "Change" : "Add picture";
      }
    });

    if (remove) {
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          const { profile } = await api("/users/avatar", { method: "DELETE" });
          applyPicture(profile);
          ui.toast("Profile picture removed", "success");
        } catch (err) {
          ui.toast(err.message || "Could not remove that picture", "error");
        } finally {
          remove.disabled = false;
        }
      });
    }
  }

  // Replaces the picture in both the page preview and the topbar shell, and
  // keeps currentProfile in step so a later re-render shows the new image.
  function applyPicture(profile) {
    currentProfile = profile;
    const card = ui.$(".card--picture");
    if (card) {
      const existing = ui.$("[data-avatar]", card);
      if (existing) existing.outerHTML = ui.avatarHtml(profile, "avatar--lg");
    }
    const shell = document.querySelector("[data-topbar-right]");
    if (shell) {
      const existing = ui.$("[data-avatar]", shell);
      if (existing) existing.outerHTML = ui.avatarHtml(profile);
    }
    const removeBtn = ui.$("[data-pic-remove]");
    if (removeBtn) removeBtn.hidden = !profile.avatarUrl;
    const triggerBtn = ui.$("[data-pic-trigger]");
    if (triggerBtn) triggerBtn.textContent = profile.avatarUrl ? "Change" : "Add picture";
  }

  // Re-encodes an image to at most MAX_EDGE on its longest side.
  //
  // Falls back to the ORIGINAL file on any failure — an unsupported format, a
  // corrupt image, a browser that refuses to decode it. Degrading to "try the
  // original anyway" is correct here: the server validates the bytes regardless
  // of what the client did, so a fallback is safe, it just may be rejected for
  // being too large.
  function downscale(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      // Always released, or the blob is pinned in memory for the page's life.
      const done = (result) => {
        URL.revokeObjectURL(url);
        resolve(result);
      };
      img.onload = () => {
        try {
          const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          // Re-encoding to JPEG is what actually drops the EXIF block; a canvas
          // toBlob of a PNG would carry nothing over either, but JPEG keeps the
          // bytes small for the common case.
          canvas.toBlob(
            (blob) => done(blob || file),
            "image/jpeg",
            0.85
          );
        } catch (_) {
          done(file);
        }
      };
      img.onerror = () => done(file);
      img.src = url;
    });
  }

  function wireSecurity() {
    const pairs = [
      {
        toggle: ui.$("#sec-toggle"),
        endpoint: "/auth/login-otp",
        onLabel: "Security code enabled",
        offLabel: "Security code disabled",
      },
      {
        toggle: ui.$("#alert-toggle"),
        endpoint: "/auth/security-alert",
        onLabel: "New-device alerts on",
        offLabel: "New-device alerts off",
      },
    ];
    pairs.forEach(({ toggle, endpoint, onLabel, offLabel }) => {
      if (!toggle) return;
      toggle.addEventListener("change", async () => {
        toggle.disabled = true;
        try {
          await api(endpoint, { retry: 1, method: "POST", body: { enabled: toggle.checked } });
          ui.toast(toggle.checked ? onLabel : offLabel, "success");
          currentProfile = (await api("/users/me", { retry: 1 })).profile;
        } catch (err) {
          toggle.checked = !toggle.checked;
          ui.toast(err.message || "Couldn't update security setting", "error");
        } finally {
          toggle.disabled = false;
        }
      });
    });
  }

  function wireReferral() {
    const card = ui.$("#referral-card");
    if (!card) return;
    api("/referrals", { retry: 1 })
      .then((ref) => {
        if (ref.code) {
          ui.$("[data-refcode]").textContent = ref.code;
          card.dataset.link = ref.link || `https://agbedepay.com/register?ref=${ref.code}`;
        }
        const referred = Number(ref.referred ?? 0);
        const credited = Number(ref.credited ?? 0);
        ui.$("[data-ref-referred]").textContent = `${referred} · ${credited} funded`;
        ui.$("[data-ref-bonus]").textContent = ref.bonusNgn || "₦500.00";
      })
      .catch(() => {});

    ui.$("#ref-copy").addEventListener("click", async () => {
      const link = card.dataset.link;
      if (!link) {
        ui.toast("No referral code yet", "error");
        return;
      }
      try {
        await navigator.clipboard.writeText(link);
        ui.toast("Invite link copied — share it with a friend", "success");
      } catch (_) {
        ui.toast(link, "info");
      }
    });
  }

  // Limits come from the backend (derived from the stored verification level).
function limitsHtml(kyc) {
    const l = kyc.limits;
    if (!l) return "";
    const pct = l.sendDailyMinor > 0 ? Math.min(100, Math.round((l.usedToday.sendMinor / l.sendDailyMinor) * 100)) : 0;
    const rows = [
      ["Send money", l.sendDailyNgn],
      ["Per transfer", l.sendPerTransactionNgn],
      ["Cash out", l.withdrawAllowed ? l.withdrawDailyNgn : "Locked"],
      [
        "Left to send today",
        l.usedToday.sendRemainingNgn,
      ],
    ];
    return `
      <div class="card" style="margin-top:18px">
        <div class="section-head" style="margin:0 0 8px">
          <h2>Account limits</h2>
          <span class="badge badge--${l.level === "IDENTITY_VERIFIED" ? "SUCCESS" : "SYSTEM"}">${ui.escapeHtml(l.tier)}</span>
        </div>
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="progress__fill" style="width:${pct}%"></div>
        </div>
        <p class="page-sub" style="margin:6px 0 12px;font-size:.82rem">${ui.escapeHtml(l.usedToday.sendNgn)} of ${ui.escapeHtml(l.sendDailyNgn)} used today · resets at midnight</p>
        <ul class="limits-list">
          ${rows
            .map(
              ([label, value]) =>
                `<li class="limits-list__item"><span>${ui.escapeHtml(label)}</span><strong>${ui.escapeHtml(value)}</strong></li>`
            )
            .join("")}
        </ul>
        ${
          l.nextTier
            ? `<div class="notice" style="margin-top:12px">
                 <strong>Raise your limit to ${ui.escapeHtml(l.nextTier.sendDailyNgn)} a day.</strong>
                 ${ui.escapeHtml(l.nextLabel)} to move up a tier instantly.
               </div>
               <a class="btn btn--primary btn--block" style="margin-top:10px" href="#verify-form">${ui.icon("id")} ${ui.escapeHtml(l.nextLabel)}</a>`
            : `<p class="page-sub" style="margin:8px 0 0;font-size:.82rem">You're on our highest tier — no limits to raise.</p>`
        }
      </div>`;
  }

  function wirePinChange() {
    const form = ui.$("#pin-form");
    const pinNew = ui.$("#pin-new");
    const pinConfirm = ui.$("#pin-confirm");

    [pinNew, pinConfirm].forEach((el) =>
      el.addEventListener("input", () => {
        el.value = el.value.replace(/\D/g, "").slice(0, 6);
        ui.resetFormErrors(form);
      })
    );

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      ui.resetFormErrors(form);

      const currentPin = ui.$("#pin-current").value.replace(/\D/g, "");
      const newPin = pinNew.value;
      if (newPin.length !== 6 || currentPin.length !== 6) {
        ui.toast("Your PIN must be 6 digits", "error");
        return;
      }
      if (currentPin === newPin) {
        ui.toast("New PIN must be different from the current PIN", "error");
        return;
      }
      if (newPin !== pinConfirm.value) {
        ui.toast("New PINs do not match", "error");
        return;
      }

      const submit = ui.$("#pin-submit");
      submit.disabled = true;
      submit.textContent = "Updating…";

      try {
        await api("/auth/pin", { retry: 1, method: "POST", body: { currentPin, newPin } });
        ui.toast("Your PIN was changed", "success");
        form.reset();
      } catch (err) {
        ui.showFormErrors(form, err);
      } finally {
        submit.disabled = false;
        submit.textContent = "Update PIN";
      }
    });
  }

  function wireBio() {
    const form = ui.$("#bio-form");
    const submit = ui.$("#bio-submit");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      ui.resetFormErrors(form);

      const fullName = ui.$("#bio-fullname").value.trim();
      const email = ui.$("#bio-email").value.trim();
      const dateOfBirth = ui.$("#bio-dob").value;
      const gender = ui.$("#bio-gender").value;
      const address = ui.$("#bio-address").value.trim();
      const city = ui.$("#bio-city").value.trim();
      const state = ui.$("#bio-state").value;
      const occupation = ui.$("#bio-occupation").value.trim();
      const nextOfKinName = ui.$("#bio-nextkin-name").value.trim();
      const nextOfKinPhone = ui.$("#bio-nextkin-phone").value.replace(/\D/g, "");
      const nextOfKinRelation = ui.$("#bio-nextkin-relation").value;

      if (!fullName || !dateOfBirth || !gender || !address || !city || !state || !occupation || !nextOfKinName || !nextOfKinPhone || !nextOfKinRelation) {
        ui.toast("All bio fields are required except email", "error");
        return;
      }

      submit.disabled = true;
      submit.textContent = "Saving…";

      try {
        await api("/kyc/bio", {
          retry: 1,
          method: "PUT",
          body: {
            fullName,
            email: email || undefined,
            dateOfBirth,
            gender,
            address,
            city,
            state,
            occupation,
            nextOfKinName,
            nextOfKinPhone,
            nextOfKinRelation,
          },
        });
ui.toast("Bio data saved", "success");
        const { kyc } = await api("/kyc", { retry: 1 });
        render(kyc);
      } catch (err) {
        ui.showFormErrors(form, err);
        submit.disabled = false;
        submit.textContent = "Save bio data";
      }
    });
  }

  function wireIdentity(kyc) {
    if (kyc.identityVerified) return;

    const form = ui.$("#verify-form");
    const submit = ui.$("#verify-submit");
    const pin = ui.$("#id-pin");

    pin.addEventListener("input", () => {
      pin.value = pin.value.replace(/\D/g, "").slice(0, 6);
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      ui.resetFormErrors(form);

      const identityNumber = ui.$("#id-number").value.replace(/\D/g, "");
      const payload = {
        identityType: ui.$("#id-type").value,
        identityNumber,
        pin: pin.value,
      };

      if (identityNumber.length !== 11) {
        ui.toast("NIN and BVN numbers are 11 digits", "error");
        return;
      }

      submit.disabled = true;
      submit.textContent = "Verifying…";

      try {
        const { verification } = await api("/kyc/verify-identity", { retry: 1, method: "POST", body: payload });
        ui.toast(`Verified as ${verification.name}`, "success");
        const { kyc: fresh } = await api("/kyc", { retry: 1 });
        render(fresh);
      } catch (err) {
        ui.showFormErrors(form, err);
        submit.disabled = false;
        submit.textContent = "Verify my identity";
      }
    });
  }
})();