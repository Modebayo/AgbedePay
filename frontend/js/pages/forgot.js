// forgot.js — two-step flow: phone → reset-code + newPIN.

(function () {
  "use strict";

  const { api } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const phoneForm = ui.$("#phone-form");
  const resetForm = ui.$("#reset-form");
  const step1 = ui.$("#step-1");
  const step2 = ui.$("#step-2");
  if (!phoneForm || !resetForm || !step1 || !step2) return;

  let phone = "";

  function restrictToNumeric(input) {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, +input.maxLength);
    });
  }
  [phoneForm.phone, resetForm.code, resetForm.pin, resetForm.confirmPin].forEach(restrictToNumeric);

  phoneForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    ui.resetFormErrors(phoneForm);

    const submit = ui.$("#phone-submit");
    submit.disabled = true;
    submit.textContent = "Sending…";

    try {
      phone = phoneForm.phone.value.trim();
      await api("/auth/forgot-pin", { method: "POST", body: { phone } });
      ui.toast("If an account exists, a code has been issued (see server console)", "info");
      step1.hidden = true;
      step2.hidden = false;
    } catch (err) {
      ui.showFormErrors(phoneForm, err);
    } finally {
      submit.disabled = false;
      submit.textContent = "Send reset code";
    }
  });

  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    ui.resetFormErrors(resetForm);

    if (resetForm.pin.value !== resetForm.confirmPin.value) {
      ui.toast("PINs do not match", "error");
      return;
    }

    const submit = ui.$("#reset-submit");
    submit.disabled = true;
    submit.textContent = "Resetting…";

    try {
      await api("/auth/reset-pin", {
        method: "POST",
        body: {
          phone,
          code: resetForm.code.value.trim(),
          pin: resetForm.pin.value,
          confirmPin: resetForm.confirmPin.value,
        },
      });
      ui.toast("PIN reset — you can now log in with your new PIN", "success");
      window.location.replace("login.html");
    } catch (err) {
      ui.showFormErrors(resetForm, err);
    } finally {
      submit.disabled = false;
      submit.textContent = "Reset PIN";
    }
  });
})();