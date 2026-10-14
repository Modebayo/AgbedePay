// services page — the AgbedePay service directory.
//
// One grouped index of everything the app offers, so no feature is reachable
// from only a single dashboard tile. Each tile is a plain in-app link; the
// filter box narrows by name as you type. No data is fetched — this is pure
// navigation.

(function () {
  "use strict";

  const ui = window.AgbeUI;
  const page = ui.$("#page");

  const GROUPS = [
    {
      title: "Move money",
      items: [
        { href: "send.html", icon: "send", label: "Transfer", desc: "Send to any AgbedePay account or bank, instantly." },
        { href: "fund.html", icon: "funding", label: "Add money", desc: "Card, bank transfer, USSD or a cash agent." },
        { href: "withdraw.html", icon: "bank", label: "Cash out", desc: "Withdraw to your linked bank account." },
        { href: "request.html", icon: "transfer", label: "Request money", desc: "Ask anyone to pay you." },
      ],
    },
    {
      title: "Pay & top up",
      items: [
        { href: "airtime.html", icon: "airtime", label: "Airtime", desc: "Recharge any network." },
        { href: "bills.html?tab=data", icon: "data", label: "Data", desc: "Mobile data bundles." },
        { href: "bills.html", icon: "bills", label: "Utility Bills", desc: "Electricity, TV, water and more." },
        { href: "betting.html", icon: "betting", label: "Betting", desc: "Fund your betting wallet." },
      ],
    },
    {
      title: "Grow & earn",
      items: [
        { href: "savings.html", icon: "savings", label: "Savings", desc: "Set goals and save automatically." },
        { href: "wealth.html", icon: "wealth", label: "Wealth", desc: "Funds, bonds, stocks and pension." },
        { href: "rewards.html", icon: "rewards", label: "Rewards", desc: "Earn points and referral bonuses." },
      ],
    },
    {
      title: "Agbede services",
      items: [
        { href: "ride.html", icon: "car", label: "Ride", desc: "Book a car and pay from your wallet." },
        { href: "logistics.html", icon: "box", label: "Dispatch", desc: "Same-day bike and van delivery." },
        { href: "cargo.html", icon: "van", label: "Agbede Cargo", desc: "Quote bulky or long-haul freight." },
        { href: "driver.html", icon: "route", label: "Drive with Agbede", desc: "Apply to drive and earn on your schedule." },
      ],
    },
    {
      title: "Account",
      items: [
        { href: "card.html", icon: "card", label: "Virtual card", desc: "Spend online with a virtual card." },
        { href: "statements.html", icon: "doc", label: "Statements", desc: "Download your transaction history." },
        { href: "profile.html", icon: "profile", label: "Profile & KYC", desc: "Verify your identity and limits." },
        { href: "help.html", icon: "headset", label: "Help & support", desc: "Chat with support about anything." },
      ],
    },
  ];

  ui.requireAuth((profile) => {
    ui.renderShell(profile, "services");
    render();
  });

  function render() {
    page.innerHTML = `
      <div class="field" style="margin-bottom:14px">
        <label class="field__label" for="services-search">Search services</label>
        <input class="input" id="services-search" type="search" placeholder="e.g. airtime, cargo, ride" autocomplete="off" />
      </div>
      <div id="services-groups"></div>
    `;

    ui.$("#services-search").addEventListener("input", (e) => filter(e.target.value));

    const wrap = ui.$("#services-groups");
    wrap.innerHTML = GROUPS.map(
      (g) => `
        <div class="section-head" data-group-head><h2>${ui.escapeHtml(g.title)}</h2></div>
        <div class="quick-actions" data-group>
          ${g.items.map(tile).join("")}
        </div>`
    ).join("");
  }

  function tile(item) {
    return `
      <a class="quick-action" href="${ui.escapeHtml(item.href)}" data-service data-search="${ui.escapeHtml((item.label + " " + item.desc).toLowerCase())}">
        <span class="quick-action__icon" aria-hidden="true">${ui.icon(item.icon)}</span>
        <span>${ui.escapeHtml(item.label)}</span>
      </a>`;
  }

  function filter(query) {
    const q = query.trim().toLowerCase();
    const groups = page.querySelectorAll("[data-group]");
    groups.forEach((group, index) => {
      const head = page.querySelectorAll("[data-group-head]")[index];
      let visible = 0;
      group.querySelectorAll("[data-service]").forEach((el) => {
        const match = !q || (el.getAttribute("data-search") || "").includes(q);
        el.style.display = match ? "" : "none";
        if (match) visible += 1;
      });
      group.style.display = visible ? "" : "none";
      if (head) head.style.display = visible ? "" : "none";
    });
  }
})();
