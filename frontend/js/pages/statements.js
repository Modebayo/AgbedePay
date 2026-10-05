// statements page — download a CSV statement for any date range. The backend
// builds the file (BOM for Excel, quoted cells, masked/never-masked account
// numbers); this page only triggers the authenticated blob download.

(function () {
  "use strict";

  const ui = window.AgbeUI;
  const page = ui.$("#page");

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "transactions");

    const form = ui.$("#statement-form");
    const fromEl = ui.$("#st-from");
    const toEl = ui.$("#st-to");
    const submit = ui.$("#statement-submit");
    submit.textContent = "Download statement";

    // Default to the current month.
    const now = new Date();
    fromEl.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    toEl.value = now.toISOString().slice(0, 10);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      ui.resetFormErrors(form);

      const from = fromEl.value;
      const to = toEl.value;
      if (!from || !to) {
        ui.toast("Pick a date range", "error");
        return;
      }
      if (new Date(from) > new Date(to)) {
        ui.toast("The 'From' date can't be after the 'To' date", "error");
        return;
      }

      submit.disabled = true;
      submit.textContent = "Downloading…";
      try {
        const { blob, filename } = await window.AgbeAPI.download(
          `/transactions/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        ui.toast(`Statement downloaded (${filename})`, "success");
      } catch (err) {
        ui.showFormErrors(form, err);
      } finally {
        submit.disabled = false;
        submit.textContent = "Download statement";
      }
    });
  });
})();