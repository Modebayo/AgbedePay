// verify page — confirms a REGISTRATION OTP, then sends the user to log in.

(function () {
  "use strict";

  const { api } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const form = ui.$("#verify-form");
  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  const phone = params.get("phone") || "";
  const display = ui.$("#verify-phone-display");
  if (display && phone) display.textContent = phone;
  if (!phone) {
    ui.toast("Missing phone — start again from registration", "error");
  }

  const submit = ui.$("#verify-submit");
  const resendBtn = ui.$("#resend-btn");
  let resendCooldown = 0;

  function startResendCooldown(seconds) {
    resendCooldown = seconds;
    const tick = () => {
      if (resendCooldown <= 0) {
        resendBtn.disabled = false;
        resendBtn.textContent = "Resend code";
        return;
      }
      resendBtn.disabled = true;
      resendBtn.textContent = `Resend in ${resendCooldown}s`;
      resendCooldown -= 1;
      setTimeout(tick, 1000);
    };
    tick();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    ui.resetFormErrors(form);

    if (!phone) return;

    submit.disabled = true;
    submit.textContent = "Verifying…";
    try {
      await api("/auth/verify-otp", {
        method: "POST",
        body: { phone, code: form.code.value.trim() },
      });
      ui.toast("Phone verified — you can now log in", "success");
      window.location.replace("login.html");
    } catch (err) {
      ui.showFormErrors(form, err);
    } finally {
      submit.disabled = false;
      submit.textContent = "Verify phone";
    }
  });

  form.code.addEventListener("input", () => {
    form.code.value = form.code.value.replace(/\D/g, "").slice(0, 6);
  });

  resendBtn.addEventListener("click", async () => {
    if (!phone || resendCooldown > 0) return;
    resendBtn.disabled = true;
    try {
      await api("/auth/resend-otp", {
        method: "POST",
        body: { phone, purpose: "REGISTRATION" },
      });
      ui.toast("New code issued — see the server console", "info");
      startResendCooldown(60);
    } catch (err) {
      ui.toast(err.message || "Could not resend code", "error");
      resendBtn.disabled = false;
    }
  });

  startResendCooldown(0);
})();