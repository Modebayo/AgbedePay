// register page — creates the account and signs the user straight in.
// There is no OTP / verification step: new accounts are active immediately.

(function () {
  "use strict";

  const { api, idempotencyKey } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const form = ui.$("#register-form");
  if (!form) return;

  // Pre-fill the referral code from a shared link: register.html?ref=CODE
  const refFromUrl = new URLSearchParams(window.location.search).get("ref");
  const referralInput = ui.$("#referralCode");
  if (refFromUrl && referralInput) referralInput.value = refFromUrl.trim().toUpperCase().slice(0, 12);

  const submit = ui.$("#register-submit");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    ui.resetFormErrors(form);

    const payload = {
      fullName: form.fullName.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim() || undefined,
      pin: form.pin.value,
      confirmPin: form.confirmPin.value,
      referralCode: referralInput.value.trim().toUpperCase() || undefined,
    };

    // Quick client-side sanity check (real enforcement is server-side).
    if (payload.pin !== payload.confirmPin) {
      ui.toast("PINs do not match", "error");
      return;
    }

    submit.disabled = true;
    submit.textContent = "Creating…";

    try {
      await api("/auth/register", {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": idempotencyKey() },
      });
      ui.toast("Account created — welcome!", "success");
      window.location.replace("dashboard.html");
    } catch (err) {
      ui.showFormErrors(form, err);
    } finally {
      submit.disabled = false;
      submit.textContent = "Create account";
    }
  });

  // Live field validation so errors appear as you type (UX only — backend
  // validation is the real gate).
  const NUMERIC = /^[0-9]*$/;
  form.phone.addEventListener("input", () => {
    if (!NUMERIC.test(form.phone.value)) form.phone.value = form.phone.value.replace(/\D/g, "");
  });
  form.pin.addEventListener("input", () => {
    if (!NUMERIC.test(form.pin.value)) form.pin.value = form.pin.value.replace(/\D/g, "");
    if (form.pin.value.length > 6) form.pin.value = form.pin.value.slice(0, 6);
  });
  form.confirmPin.addEventListener("input", () => {
    if (!NUMERIC.test(form.confirmPin.value)) form.confirmPin.value = form.confirmPin.value.replace(/\D/g, "");
    if (form.confirmPin.value.length > 6) form.confirmPin.value = form.confirmPin.value.slice(0, 6);
  });
})();