// login page — phone + PIN first, then a second-factor security code when the
// account has Log-in security enabled. The code is issued by the backend but no
// session is created until it's proved via /auth/login/otp.

(function () {
  "use strict";

  const { api } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const params = new URLSearchParams(window.location.search);
  const next = params.get("next") || "dashboard.html";

  const form = ui.$("#login-form");
  if (!form) return;

  const submit = ui.$("#login-submit");
  const idpStep = ui.$("#idp-step");
  const otpStep = ui.$("#otp-step");
  const otpCode = ui.$("#otp-code");
  const otpSubmit = ui.$("#otp-submit");
  const otpResend = ui.$("#otp-resend");

  let pendingPhone = null;
  let pendingPin = null;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    ui.resetFormErrors(form);

    submit.disabled = true;
    submit.textContent = "Logging in…";

    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: {
          phone: form.phone.value.trim(),
          pin: form.pin.value,
        },
      });
      if (data.requiresOtp) {
        pendingPhone = data.phone;
        pendingPin = form.pin.value;
        idpStep.hidden = true;
        otpStep.hidden = false;
        otpCode.value = "";
        ui.toast("Security code required", "info");
        otpCode.focus();
        return;
      }
      ui.toast("Logged in", "success");
      window.location.replace(next);
    } catch (err) {
      ui.showFormErrors(form, err);
    } finally {
      submit.disabled = false;
      submit.textContent = "Log in";
    }
  });

  async function completeOtp() {
    if (otpCode.value.length !== 6) {
      ui.toast("Enter the 6-digit security code", "error");
      return;
    }
    otpSubmit.disabled = true;
    otpSubmit.textContent = "Verifying…";
    try {
      await api("/auth/login/otp", {
        method: "POST",
        body: { phone: pendingPhone, code: otpCode.value },
      });
      ui.toast("Logged in", "success");
      window.location.replace(next);
    } catch (err) {
      ui.showFormErrors(form, err);
    } finally {
      otpSubmit.disabled = false;
      otpSubmit.textContent = "Verify & log in";
    }
  }
  otpSubmit.addEventListener("click", completeOtp);
  otpCode.addEventListener("keydown", (e) => {
    if (e.key === "Enter") completeOtp();
  });

  // Re-issue the code by re-running the credential step (issues a fresh LOGIN
  // security code without creating a session).
  otpResend.addEventListener("click", async () => {
    otpResend.disabled = true;
    try {
      await api("/auth/login", {
        method: "POST",
        body: { phone: pendingPhone, pin: pendingPin },
      });
      ui.toast("Code re-sent — check the server console", "success");
    } catch (err) {
      ui.showFormErrors(form, err);
    } finally {
      otpResend.disabled = false;
    }
  });

  // Only allow digits in phone/PIN/code.
  const restrict = (input) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, +input.maxLength);
    });
  };
  restrict(form.phone);
  restrict(form.pin);
  restrict(otpCode);
})();