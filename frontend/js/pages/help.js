// help page — Help & Support: searchable FAQ, live contact channels, and a
// real support-ticket desk backed by /api/support/tickets. Tickets are NOT
// cosmetic: the POST writes a row, gets a TKT reference, and lands in the
// notification tray so the thread can be found again.

(function () {
  "use strict";

  const { api } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const FAQ = [
    {
      topic: "Money & payments",
      items: [
        {
          q: "My money hasn't arrived yet",
          a: "Bank sends usually settle within 5 minutes. If it is over 30 minutes, open a PAYMENT ticket and we'll chase the transfer for you.",
        },
        {
          q: "I was charged twice",
          a: "AgbedePay is replay-safe, so a double tap can never debit you twice. If a duplicate landed, open a PAYMENT ticket and our refunds team reverses it — usually within a day.",
        },
        {
          q: "How do I check a transaction?",
          a: "Open Transactions from the menu, tap any row and you'll see the reference, status and full history for that payment.",
        },
      ],
    },
    {
      topic: "Cash out & limits",
      items: [
        {
          q: "Why is cash-out locked?",
          a: "Cash-out opens once your bio data is saved. Complete your date of birth, address, city and state on Profile to unlock it.",
        },
        {
          q: "How do I raise my send and cash-out limits?",
          a: "Verify your NIN or BVN on Profile. Verified accounts get the highest tier: up to ₦500,000 per transfer and ₦1,000,000 a day.",
        },
        {
          q: "When does my daily limit reset?",
          a: "Daily limits reset at midnight (WAT). Whatever you haven't used is available again the next day.",
        },
      ],
    },
    {
      topic: "Verification & security",
      items: [
        {
          q: "Do you store my NIN or BVN?",
          a: "Never. We verify it with our provider and keep only a one-way hash plus the type, so we can prove it was verified without holding the number.",
        },
        {
          q: "AgbedePay asked for my PIN",
          a: "We never ask for your PIN — not by call, SMS or chat. Report it on a KYC ticket and block the number. It is a scammer.",
        },
        {
          q: "I logged in on a phone I don't recognise",
          a: "Change your PIN immediately from Profile, then turn on login OTP. We'll also sign the new device in via an OTP code.",
        },
      ],
    },
    {
      topic: "Deliveries & rides",
      items: [
        {
          q: "My rider or rider-driver cancelled",
          a: "Cancelled bookings are refunded automatically to your wallet — you'll see a Reversal on your statement. No action needed.",
        },
        {
          q: "Can I get a refund after a trip?",
          a: "Only while a trip is still active or if a rider-driver no-shows. Open a RIDE ticket with the trip reference and we'll sort it.",
        },
        {
          q: "How is the fare worked out?",
          a: "Upfront quote, then locked: the price can't change after you confirm the booking or the ride.",
        },
      ],
    },
  ];

  const CHANNELS = [
    { icon: "phone", label: "Call us", value: "0800 000 1000", hint: "24 hours, every day" },
    { icon: "chat", label: "WhatsApp", value: "0800 000 1000", hint: "Typical reply in 2 minutes" },
    { icon: "mail", label: "Email", value: "help@agbedepay.ng", hint: "Replies within 24 hours" },
  ];

  const CATEGORIES = [
    ["PAYMENT", "A payment didn't go through or landed wrong"],
    ["WITHDRAWAL", "A cash-out is stuck or reversed"],
    ["KYC", "Verification, limits or my identity"],
    ["DISPATCH", "A delivery or errand"],
    ["RIDE", "A trip, fare or rider"],
    ["CARD", "My AgbedePay card"],
    ["OTHER", "Something else"],
  ];

  const state = { query: "", open: new Set(), tickets: [], firstName: "there" };

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "help");
    state.firstName = (profile.fullName || "there").split(" ")[0];
    render();
    await loadTickets();
  });

  // Same pattern the other forms use: mark the field and write under it.
  function fieldError(form, name, message) {
    const field = form.elements[name];
    if (!field) return;
    const wrap = field.closest(".field");
    if (!wrap) return;
    wrap.classList.add("field--invalid");
    const slot = ui.$(".field__error", wrap);
    if (slot) slot.textContent = message;
  }

  function render() {
    const page = ui.$("#page");
    const firstName = state.firstName;

    page.innerHTML = `
      <header class="page-head">
        <h1>Help &amp; Support</h1>
        <p class="page-sub">Hi ${ui.escapeHtml(firstName)} — find a quick answer below, or send our desk a message and we'll reply within 24 hours.</p>
      </header>

      <div class="search-box">
        <span class="search-box__icon" aria-hidden="true">${ui.icon("search")}</span>
        <input class="input" id="faq-search" type="search" placeholder="Search: cash out, PIN, refund, rider…" aria-label="Search help articles" value="${ui.escapeHtml(state.query)}" />
      </div>

      <section class="help-channels" aria-label="Contact channels">
        ${CHANNELS.map(
          (c) => `
          <a class="help-channel" href="${ui.escapeHtml(channelHref(c))}">
            <span class="help-channel__icon" aria-hidden="true">${ui.icon(c.icon)}</span>
            <span class="help-channel__label">${ui.escapeHtml(c.label)}</span>
            <span class="help-channel__value">${ui.escapeHtml(c.value)}</span>
            <span class="help-channel__hint">${ui.escapeHtml(c.hint)}</span>
          </a>`
        ).join("")}
      </section>

      <section class="card" style="margin-top:18px">
        <div class="section-head"><h2>Frequently asked</h2><span class="badge badge--SYSTEM" data-faq-count></span></div>
        <div class="faq" data-faq>
          ${faqHtml()}
        </div>
        <p class="empty empty--compact" data-faq-empty hidden>No articles match “${ui.escapeHtml(state.query)}”. Try the ticket form below and we'll help.</p>
      </section>

      <form class="form card" id="ticket-form" style="margin-top:18px" novalidate>
        <div class="section-head"><h2>Send us a message</h2></div>
        <p class="page-sub" style="margin:0 0 12px">One open ticket per topic — if you've already asked about this, we reply in the same thread.</p>
        <div class="error-banner" role="alert"></div>

        <div class="field">
          <label class="field__label" for="t-category">What is it about?</label>
          <select class="input" id="t-category" name="category" required>
            <option value="">Select a topic…</option>
            ${CATEGORIES.map(([v, l]) => `<option value="${v}">${ui.escapeHtml(l)}</option>`).join("")}
          </select>
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="t-subject">Subject</label>
          <input class="input" id="t-subject" name="subject" type="text" maxlength="120" placeholder="Short summary" required />
          <p class="field__error"></p>
        </div>

        <div class="field">
          <label class="field__label" for="t-message">Message</label>
          <textarea class="input" id="t-message" name="message" rows="4" maxlength="1000" placeholder="What happened? Include the reference if you have one." required></textarea>
          <p class="field__error"></p>
        </div>

        <button class="btn btn--primary" id="ticket-submit" type="submit">Send message</button>
      </form>

      <section class="card" style="margin-top:18px">
        <div class="section-head"><h2>Your tickets</h2></div>
        <div data-tickets>${ui.loadingCard("Loading your tickets…")}</div>
      </section>`;

    wire();
  }

  function channelHref(c) {
    if (c.label === "Call us") return "tel:08000001000";
    if (c.label === "WhatsApp") return "https://wa.me/2348000001000";
    return "mailto:help@agbedepay.ng";
  }

  let firstNameCache = null;
  function profileName() {
    if (firstNameCache) return firstNameCache;
    try {
      firstNameCache = JSON.parse(sessionStorage.getItem("agbe_profile") || "{}").fullName || "";
    } catch (_) {
      firstNameCache = "";
    }
    return firstNameCache;
  }

  function faqHtml() {
    const q = state.query.trim().toLowerCase();
    return FAQ.map((group) => {
      const items = group.items.filter(
        (i) => !q || i.q.toLowerCase().includes(q) || i.a.toLowerCase().includes(q) || group.topic.toLowerCase().includes(q)
      );
      if (!items.length) return "";
      return `
        <div class="faq__group">
          <h3 class="faq__topic">${ui.escapeHtml(group.topic)}</h3>
          ${items
            .map((i) => {
              const key = q ? "q" : `${group.topic}|${i.q}`;
              const open = state.open.has(key) || !!q;
              return `
              <div class="faq__item ${open ? "is-open" : ""}">
                <button class="faq__q" type="button" aria-expanded="${open}">${ui.escapeHtml(i.q)}<span class="faq__chev" aria-hidden="true">${ui.icon("chevron")}</span></button>
                <div class="faq__a" ${open ? "" : "hidden"}><p>${ui.escapeHtml(i.a)}</p></div>
              </div>`;
            })
            .join("")}
        </div>`;
    }).join("");
  }

  function wire() {
    const search = ui.$("#faq-search");
    let timer = null;
    search.addEventListener("input", () => {
      state.query = search.value;
      clearTimeout(timer);
      timer = setTimeout(() => {
        ui.$("[data-faq]").innerHTML = faqHtml();
        const shown = ui.$$(".faq__item").length;
        const count = ui.$("[data-faq-count]");
        if (count) count.textContent = shown ? `${shown} ${shown === 1 ? "article" : "articles"}` : "";
        const empty = ui.$("[data-faq-empty]");
        if (empty) empty.hidden = shown > 0;
        wireFaq();
      }, 120);
    });

    wireFaq();
    ui.$("#ticket-form").addEventListener("submit", onSubmit);
  }

  function wireFaq() {
    ui.$$(".faq__q").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = btn.closest(".faq__item");
        const open = item.classList.toggle("is-open");
        btn.setAttribute("aria-expanded", String(open));
        ui.$(".faq__a", item).hidden = !open;
      });
    });
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = ui.$("#ticket-submit");
    ui.resetFormErrors(form);
    ui.$(".error-banner", form).classList.remove("error-banner--show");

    const category = ui.$("#t-category").value;
    const subject = ui.$("#t-subject").value.trim();
    const message = ui.$("#t-message").value.trim();

    let bad = false;
    if (!category) {
      fieldError(form, "category", "Choose a topic so we route your message correctly");
      bad = true;
    }
    if (subject.length < 4) {
      fieldError(form, "subject", "Give your message a short subject");
      bad = true;
    }
    if (message.length < 10) {
      fieldError(form, "message", "Tell us a little more — at least 10 characters");
      bad = true;
    }
    if (bad) return;

    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      const { ticket } = await api("/support/tickets", {
        method: "POST",
        body: { category, subject, message },
      });
      form.reset();
      ui.toast(`Ticket ${ticket.reference} sent — we reply within 24 hours`);
      await loadTickets();
      ui.$("[data-tickets]").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      const banner = ui.$(".error-banner", form);
      banner.textContent = err.message || "We couldn't send that. Try again in a moment.";
      banner.classList.add("error-banner--show");
    } finally {
      btn.disabled = false;
      btn.textContent = "Send message";
    }
  }

  async function loadTickets() {
    const host = ui.$("[data-tickets]");
    if (!host) return;
    try {
      const { tickets = [] } = await api("/support/tickets");
      state.tickets = tickets;
      host.innerHTML = tickets.length ? tickets.map(ticketHtml).join("") : `<p class="empty empty--compact">No tickets yet — you're all good.</p>`;
    } catch (_) {
      host.innerHTML = `<p class="empty empty--compact">We couldn't load your tickets. Pull to refresh and try again.</p>`;
    }
  }

  function ticketHtml(t) {
    const cls = t.status === "RESOLVED" ? "RESOLVED" : t.status === "IN_PROGRESS" ? "PENDING" : "OPEN";
    return `
      <article class="ticket">
        <div class="ticket__head">
          <span class="ticket__ref">${ui.escapeHtml(t.reference)}</span>
          <span class="badge badge--${cls}">${ui.escapeHtml(t.status.replace("_", " "))}</span>
        </div>
        <p class="ticket__subject">${ui.escapeHtml(t.subject)}</p>
        <p class="ticket__body">${ui.escapeHtml(t.message)}</p>
        ${
          t.agentReply
            ? `<div class="ticket__reply">
                 <span class="ticket__reply-label">${ui.icon("chat")} AgbedePay support</span>
                 <p>${ui.escapeHtml(t.agentReply)}</p>
               </div>`
            : `<p class="ticket__waiting">No agent reply yet — we answer within 24 hours.</p>`
        }
        <span class="ticket__time">Raised ${new Date(t.createdAt).toLocaleString()}</span>
      </article>`;
  }
})();
