// transactions page — full history with filter chips (direction + type).
// Type filters hit the backend; direction (in/out) is derived the same way the
// dashboard does it, from who the receiver is.

(function () {
  "use strict";

  const { api } = window.AgbeAPI;
  const ui = window.AgbeUI;

  const PAGE_SIZE = 50;
  const DISPLAY_STEP = 10;

  const state = {
    filter: "ALL",
    sort: "newest",
    walletId: null,
    raw: [], // rows fetched from the backend (server-filtered when a type is set)
    shown: 0, // how many matching rows we want to display
    page: 0, // last backend page fetched
    total: Infinity,
    loading: false,
    done: false,
  };

  const isType = (f) => ["TRANSFER", "AIRTIME", "BILLS", "BETTING", "SAVINGS_DEPOSIT", "FUNDING", "WITHDRAWAL", "BANK"].includes(f);
  const isOut = (t) =>
    ["AIRTIME", "BILLS", "BETTING", "SAVINGS_DEPOSIT", "BANK"].includes(t.type) ||
    (t.type === "TRANSFER" && t.receiver?.walletId !== state.walletId);
  const matches = (t) =>
    state.filter === "ALL" ||
    (state.filter === "IN" && !isOut(t)) ||
    (state.filter === "OUT" && isOut(t)) ||
    (isType(state.filter) && t.type === state.filter);
  const visible = () => state.raw.filter(matches);

  ui.requireAuth(async (profile) => {
    ui.renderShell(profile, "transactions");
    state.walletId = profile.wallet?.id;

    // Honour deep links: transactions.html?type=AIRTIME&sort=oldest
    const query = new URLSearchParams(window.location.search);
    const fromUrl = query.get("type");
    const sortFromUrl = query.get("sort");
    if (fromUrl && ["TRANSFER", "AIRTIME", "BILLS", "BETTING", "SAVINGS_DEPOSIT", "FUNDING", "WITHDRAWAL", "BANK"].includes(fromUrl)) {
      state.filter = fromUrl;
    }
    if (sortFromUrl && ["newest", "oldest", "amount_hi", "amount_lo"].includes(sortFromUrl)) {
      state.sort = sortFromUrl;
    }

    const sortEl = ui.$("#tx-sort");
    sortEl.value = state.sort;
    sortEl.addEventListener("change", () => {
      state.sort = sortEl.value;
      reset();
    });

    ui.$$(".tx-filters .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        ui.$$(".tx-filters .chip").forEach((c) => c.classList.remove("is-selected"));
        chip.classList.add("is-selected");
        state.filter = chip.dataset.filter;
        reset();
      });
    });

    syncChips();
    syncUrl();

    ui.$("#load-more").addEventListener("click", () => {
      state.shown += DISPLAY_STEP;
      topUp();
    });

    state.shown = DISPLAY_STEP;
    topUp();
  });

  function reset() {
    state.raw = [];
    state.shown = 0;
    state.page = 0;
    state.total = Infinity;
    state.done = false;
    syncUrl();
    topUp();
  }

  function syncChips() {
    ui.$$(".tx-filters .chip").forEach((c) =>
      c.classList.toggle("is-selected", c.dataset.filter === state.filter)
    );
  }

  function syncUrl() {
    const url = new URL(window.location.href);
    if (isType(state.filter)) url.searchParams.set("type", state.filter);
    else url.searchParams.delete("type");
    if (state.sort !== "newest") url.searchParams.set("sort", state.sort);
    else url.searchParams.delete("sort");
    window.history.replaceState(null, "", url);
  }

  async function topUp() {
    if (state.loading) return;
    const loadBtn = ui.$("#load-more");
    if (loadBtn) loadBtn.disabled = true;

    let guard = 40;
    while (!state.done && visible().length < state.shown && guard-- > 0) {
      state.loading = true;
      // eslint-disable-next-line no-await-in-loop
      await fetchChunk();
      state.loading = false;
    }

    if (loadBtn) loadBtn.disabled = false;
    renderArea();
  }

  async function fetchChunk() {
    state.page += 1;
    const type = isType(state.filter) ? state.filter : undefined;
    const params = new URLSearchParams({ page: state.page, limit: String(PAGE_SIZE), sort: state.sort });
    if (type) params.set("type", type);

    try {
      const data = await api(`/transactions?${params}`);
      const known = new Set(state.raw.map((t) => t.id));
      state.raw.push(...(data.items || []).filter((t) => !known.has(t.id)));
      state.total = Number(data.total ?? 0);
      if ((data.items || []).length < PAGE_SIZE || state.page * PAGE_SIZE >= state.total) {
        state.done = true;
      }
    } catch (_) {
      state.done = true;
    }
  }

  function renderArea() {
    const area = ui.$("#tx-area");
    if (!area) return;

    const list = visible().slice(0, state.shown);

    if (state.done && state.raw.length === 0) {
      area.innerHTML = `<div class="empty">No transactions here yet.</div>`;
    } else if (state.done && list.length === 0 && state.raw.length > 0) {
      area.innerHTML = `<div class="empty">Nothing matches this filter.</div>`;
    } else {
      const footer =
        list.length > 0
          ? `<div class="tx-area__foot">Showing ${Math.min(list.length, state.total)} of ${state.total}${state.filter === "ALL" || isType(state.filter) ? "" : ` matching "${state.filter.toLowerCase() === "in" ? "money in" : "money out"}"`}</div>`
          : "";
      area.innerHTML = list.map(renderItem).join("") + footer;
    }

    const loadBtn = ui.$("#load-more");
    if (loadBtn) {
      loadBtn.hidden = state.done && list.length >= visible().length;
      loadBtn.disabled = state.loading;
      loadBtn.textContent = state.loading ? "Loading…" : "Load more";
    }
  }

  function renderItem(t) {
    const icons = {
      TRANSFER: "send",
      FUNDING: "funding",
      REVERSAL: "reverse",
      SAVINGS_DEPOSIT: "savings",
      AIRTIME: "airtime",
      BILLS: "bills",
      BETTING: "betting",
      BANK: "bank",
    };
    const credit = !isOut(t);
    const dir = credit ? "credit" : "debit";
    const sign = credit ? "+" : "-";
    return `
      <a class="tx-item" href="transaction.html?id=${encodeURIComponent(t.id)}">
        <div class="tx-item__icon" aria-hidden="true">${ui.icon(icons[t.type] || "wallet")}</div>
        <div class="tx-item__main">
          <div class="tx-item__title">${ui.escapeHtml(t.narration || t.type)}</div>
          <div class="tx-item__meta">
            <span class="badge badge--${t.type}">${t.type}</span>
            <span class="badge badge--${t.status}">${t.status}</span>
          </div>
        </div>
        <div class="tx-item__right">
          <div class="tx-item__amount tx-item__amount--${dir}">${sign}${t.amountNgn}</div>
          <div class="tx-item__meta">${relativeTime(t.createdAt)}</div>
        </div>
      </a>`;
  }

  function relativeTime(iso) {
    if (!iso) return "";
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }
})();