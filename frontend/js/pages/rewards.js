// rewards — bonuses from referrals and live promotions.
// Bonus totals are summed from REAL ledger rows only (never invented here).

(function () {
  "use strict";

  const { api } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const page = ui.$("#page");

  // Cosmetic promo catalogue — surface only; redemption is a stub for now.
  const PROMOS = [
    { icon: "trophy", title: "Airtime cashback", text: "2.5% back on every MTN, Airtel, GLO & 9mobile top-up.", tag: "Auto" },
    { icon: "gift", title: "Refer & earn ₦500", text: "You and the friend you invite each get ₦500 when they top up.", tag: "Once per friend" },
    { icon: "card", title: "Virtual card perks", text: "Free card issuance, instant freeze and 0.5% cashback on card spend.", tag: "Now live" },
    { icon: "percent", title: "Betting cashback", text: "Get up to 5% back on your first three Bet9ja / SportyBet top-ups.", tag: "Limited" },
  ];

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "rewards");

    const [ref, txData] = await Promise.all([
      api("/referrals").catch(() => null),
      api("/transactions?limit=100").catch(() => ({ items: [] })),
    ]);

    render(profile, ref, txData.items || []);
  });

  const CREDIT_TYPES = new Set(["FUNDING", "REVERSAL", "SAVINGS_WITHDRAWAL", "REFERRAL"]);

  function isBonus(t) {
    if (!t || !CREDIT_TYPES.has(t.type)) return false;
    const ref = t.reference || "";
    if (t.type === "REFERRAL" || ref.startsWith("RFL-")) return true;
    return /referral|bonus|cashback|reward/i.test((t.narration || "") + " " + ref);
  }

  function render(profile, ref, txs) {
    const walletId = profile.wallet?.id;
    const walletStatus =
      profile.wallet && profile.wallet.status !== "ACTIVE"
        ? `<div class="notice"><strong>Your wallet is currently ${ui.escapeHtml(profile.wallet.status.toLowerCase())}.</strong> Rewards can't be received until it's active again.</div>`
        : "";

    const bonuses = txs.filter((t) => isBonus(t));

    const totalMinor = bonuses.reduce((sum, t) => sum + (t.amountMinor || 0), 0);
    const refCode = ref?.code || "";
    const referred = Number(ref?.referred ?? 0);
    const credited = Number(ref?.credited ?? 0);

    const bonusList =
      bonuses.length === 0
        ? `<div class="empty">No rewards yet — refer a friend and they'll land here the moment they top up.</div>`
        : `<div class="card"><div class="tx-list">${bonuses
            .map(
              (t) => `
              <a class="tx-item" href="transaction.html?id=${encodeURIComponent(t.id)}">
                <div class="tx-item__icon" aria-hidden="true">${ui.icon("gift")}</div>
                <div class="tx-item__main">
                  <div class="tx-item__title">${ui.escapeHtml(t.narration || "Reward")}</div>
                  <div class="tx-item__meta">
                    <span class="badge badge--${t.type}">${t.type}</span>
                    <span class="badge badge--${t.status}">${t.status}</span>
                    <span>· ${relativeTime(t.createdAt)}</span>
                  </div>
                </div>
                <div class="tx-item__right">
                  <div class="tx-item__amount tx-item__amount--credit">+${t.amountNgn}</div>
                </div>
              </a>`
            )
            .join("")}</div></div>`;

    page.innerHTML = `
      <div class="page-title">Rewards</div>
      <p class="page-sub">Bonuses you've earned, and offers that are live today.</p>
      ${walletStatus}

      <div class="rewards-hero">
        <div class="rewards-hero__icon" aria-hidden="true">${ui.icon("trophy")}</div>
        <div>
          <div class="rewards-hero__label">Total rewards earned</div>
          <div class="rewards-hero__value">${ui.escapeHtml(ui.formatNgn(totalMinor / 100))}</div>
          <div class="rewards-hero__meta">${bonuses.length} bonus ${bonuses.length === 1 ? "payment" : "payments"} · ${referred} friend${referred === 1 ? "" : "s"} invited</div>
        </div>
      </div>

      <div class="section-head">
        <h2>Bonuses</h2>
        <span class="badge badge--SUCCESS">${bonuses.length}</span>
      </div>
      ${bonusList}

      <div class="card" id="referral-card" style="margin-top:16px">
        <div class="section-head" style="margin:0 0 8px"><h2>Refer &amp; earn ₦500</h2></div>
        <p class="page-sub" style="margin:0 0 12px">When a friend registers with your code and tops up, you <strong>both</strong> get ₦500.</p>
        <div class="referral-box">
          <div class="token-box">
            <div class="token-box__label">Your referral code</div>
            <div class="token-box__value" data-refcode>${refCode ? ui.escapeHtml(refCode) : "—"}</div>
          </div>
          <button class="btn btn--green btn--block" id="ref-copy" type="button" ${refCode ? "" : "disabled"}>${ui.icon("copy")} Copy your invite link</button>
        </div>
        <ul class="limits-list referral-stats">
          <li class="limits-list__item"><span>People you've invited</span><strong data-ref-referred>${referred} · ${credited} funded</strong></li>
        </ul>
      </div>

      <div class="section-head">
        <h2>Promotions</h2>
        <span class="badge badge--SYSTEM">Live</span>
      </div>
      <div class="promo-grid">
        ${PROMOS.map(
          (p) => `
          <div class="promo-card">
            <span class="promo-card__icon" aria-hidden="true">${ui.icon(p.icon)}</span>
            <div class="promo-card__title">${ui.escapeHtml(p.title)}</div>
            <div class="promo-card__text">${ui.escapeHtml(p.text)}</div>
            <span class="tag-chip">${ui.escapeHtml(p.tag)}</span>
          </div>`
        ).join("")}
      </div>

      <form class="redeem-box" id="redeem-form" novalidate>
        <div>
          <label class="field__label" for="redeem-code">Have a promo code?</label>
          <p class="page-sub" style="margin:2px 0 0;font-size:.8rem">Enter it below — we'll credit any active offer straight to your wallet.</p>
        </div>
        <div class="redeem-box__row">
          <input class="input" id="redeem-code" name="code" type="text" maxlength="24" placeholder="e.g. AGBEDE500" autocomplete="off" spellcheck="false" />
          <button class="btn btn--primary" type="submit">Redeem</button>
        </div>
      </form>
    `;

    wireCopy(ref);
    wireRedeem();
  }

  function wireCopy(ref) {
    const btn = ui.$("#ref-copy");
    if (!btn) return;
    const card = btn.closest("#referral-card");
    if (ref?.code) card.dataset.link = ref.link || `https://agbedepay.com/register?ref=${ref.code}`;
    btn.addEventListener("click", async () => {
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

  function wireRedeem() {
    const form = ui.$("#redeem-form");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const code = (ui.$("#redeem-code").value || "").trim().toUpperCase();
      if (!code) {
        ui.toast("Enter a promo code first", "error");
        return;
      }
      if (code === "AGBEDE500") {
        ui.toast(`Promo code ${code} redeemed — a ₦500 bonus is on its way.`, "success");
        form.reset();
      } else if (code === "ITEX10") {
        ui.toast(`Promo code ${code} redeemed — 10% off your next airtime purchase.`, "success");
        form.reset();
      } else {
        ui.toast("That promo code isn't active yet. Try AGBEDE500 or ITEX10.", "error");
      }
    });
  }

  function relativeTime(iso) {
    if (!iso) return "";
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 120) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
  }
})();