/**
 * Ridango POS 2.0 — application shell.
 * Screens: sell (catalogue) → add ticket → shopping cart → success.
 * Modals: select zone, select client, header menu.
 */
import { buildCatalog } from './fare-model.js';
import { formatPrice, formatClock } from './format.js';

const STORAGE = {
  client: 'ridango-pos.client',
  zone: (clientId) => `ridango-pos.zone.${clientId}`,
  tab: (clientId) => `ridango-pos.tab.${clientId}`,
};

const state = {
  clients: [],
  client: null,        // selected client config
  catalog: null,       // built fare catalogue
  loadError: null,
  zone: null,          // FareZone code
  tab: null,           // TypeOfFareProduct code
  page: 0,
  pageSize: 6,
  screen: 'sell',      // 'sell' | 'add' | 'cart'
  draft: null,         // { offer, quantity } on the add-ticket screen
  cart: [],            // [{ offer, zoneCode, zoneName, quantity, price }]
  separateTickets: true,
  printReceipt: false,
  modal: null,         // 'zone' | 'client' | 'menu' | 'success'
};

const app = document.getElementById('app');
const modals = document.getElementById('modals');

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* ignore */ } };
const money = (price) => (price ? formatPrice(price.amount, price.currency, state.client?.locale) : '');
const icon = (n) => `assets/icons/${n}.svg`;

function cartTotal() {
  const items = state.cart.filter((i) => i.price);
  if (!items.length) return null;
  return { amount: items.reduce((s, i) => s + i.price.amount * i.quantity, 0), currency: items[0].price.currency };
}
function cartCount() {
  return state.cart.reduce((s, i) => s + i.quantity, 0);
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
async function loadClients() {
  const res = await fetch('clients.json', { cache: 'no-cache' });
  const json = await res.json();
  state.clients = json.clients || [];
}

async function selectClient(client) {
  state.client = client;
  state.catalog = null;
  state.loadError = null;
  state.cart = [];
  state.draft = null;
  state.screen = 'sell';
  state.page = 0;
  write(STORAGE.client, client.id);
  render();
  if (!client.dataFile) {
    state.loadError = `No fare data configured for ${client.name} (${client.environment}). Add a fullset file to data/${client.id}/ and reference it in clients.json.`;
    render();
    return;
  }
  try {
    const res = await fetch(client.dataFile);
    if (!res.ok) throw new Error(`HTTP ${res.status} while loading ${client.dataFile}`);
    const fullset = await res.json();
    state.catalog = buildCatalog(fullset, { distributionChannel: client.distributionChannel, language: client.language });
    const savedZone = read(STORAGE.zone(client.id));
    state.zone = state.catalog.zones.some((z) => z.code === savedZone) ? savedZone : state.catalog.zones[0]?.code || null;
    const savedTab = read(STORAGE.tab(client.id));
    const tabs = state.zone ? state.catalog.typesInZone(state.zone) : [];
    state.tab = tabs.some((t) => t.code === savedTab) ? savedTab : tabs[0]?.code || null;
  } catch (err) {
    console.error(err);
    state.loadError = `Could not load fare data for ${client.name}: ${err.message}`;
  }
  render();
}

function setZone(code) {
  state.zone = code;
  state.page = 0;
  write(STORAGE.zone(state.client.id), code);
  const tabs = state.catalog.typesInZone(code);
  if (!tabs.some((t) => t.code === state.tab)) state.tab = tabs[0]?.code || null;
}

function setTab(code) {
  state.tab = code;
  state.page = 0;
  write(STORAGE.tab(state.client.id), code);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  const screen = { sell: renderSell, add: renderAddTicket, cart: renderCart }[state.screen] || renderSell;
  app.innerHTML = screen();
  renderModal();
  updateClock();
}

function renderHeader({ title, showZone = true, showActions = true, extra = '' }) {
  const c = state.client;
  const zoneName = state.catalog && state.zone ? state.catalog.zoneName(state.zone) : '';
  const count = cartCount();
  return `
    <header class="header">
      <button class="header__logo" data-action="client" aria-label="Change client" style="--logo-h:${Number(c?.logoHeight) || 40}px">
        ${c ? `<img src="${esc(c.logo)}" alt="${esc(c.name)}">` : ''}
      </button>
      <span class="header__sep" aria-hidden="true"></span>
      <h1 class="header__title t-display-l">${esc(title)}</h1>
      ${showZone && state.catalog ? `
        <span class="header__label t-heading">Select zone:</span>
        <button class="dropdown t-heading" data-action="zone" aria-haspopup="dialog">
          <span class="dropdown__label">${esc(zoneName)}</span>
          <img class="dropdown__icon" src="${icon('dropdown')}" alt="">
        </button>
        <span class="header__sep" aria-hidden="true"></span>` : ''}
      ${extra}
      ${showActions ? `
        <div class="header__actions">
          <button class="hbtn t-heading" data-action="menu" aria-haspopup="menu"><img src="${icon('menu')}" alt="">Menu</button>
          <button class="hbtn hbtn--icon" data-action="open-cart" aria-label="Shopping cart, ${count} items">
            <img src="${icon('cart')}" alt="">
            ${count ? `<span class="badge">${count}</span>` : ''}
          </button>
        </div>` : ''}
    </header>`;
}

function renderFooter() {
  return `
    <footer class="footer">
      <img src="${icon('print')}" alt="Printer ready" title="Printer">
      <img src="${icon('status-online')}" alt="Online" title="Connection">
      <span class="footer__clock t-button" data-clock></span>
    </footer>`;
}

function renderSell() {
  let body;
  if (state.loadError) {
    body = `<div class="sell"><div class="tabs"></div><div class="catalog"><div class="notice notice--error">${esc(state.loadError)}</div></div></div>`;
  } else if (!state.catalog) {
    body = `<div class="sell"><div class="tabs"></div><div class="catalog"><div class="notice">Loading fare data…</div></div></div>`;
  } else {
    const tabs = state.catalog.typesInZone(state.zone);
    const offers = state.catalog.offersInZone(state.zone).filter((o) => o.typeCode === state.tab);
    const pages = Math.max(1, Math.ceil(offers.length / state.pageSize));
    state.page = Math.min(state.page, pages - 1);
    const pageHtml = Array.from({ length: pages }, (_, i) => {
      const slice = offers.slice(i * state.pageSize, (i + 1) * state.pageSize);
      return `<div class="cards" aria-hidden="${i !== state.page}">${slice.length ? slice.map(renderCard).join('') : '<p class="empty t-display-s">No products for this zone.</p>'}</div>`;
    }).join('');
    body = `
      <div class="sell">
        <nav class="tabs" role="tablist">
          ${tabs.map((t) => `<button class="tab t-heading" role="tab" data-action="tab" data-tab="${esc(t.code)}" aria-selected="${t.code === state.tab}">${esc(t.name)}</button>`).join('')}
        </nav>
        <section class="catalog">
          <div class="catalog__pages">
            <div class="track" data-swipe style="transform:translate3d(${-state.page * 100}%,0,0)">${pageHtml}</div>
          </div>
          <div class="pager" role="tablist" aria-label="Pages">
            ${pages > 1 ? Array.from({ length: pages }, (_, i) => `<button class="pager__dot" data-action="page" data-page="${i}" aria-current="${i === state.page}" aria-label="Page ${i + 1}"></button>`).join('') : ''}
          </div>
        </section>
      </div>`;
  }
  return `<div class="screen">${renderHeader({ title: 'Sell ticket' })}${body}${renderFooter()}</div>`;
}

function renderCard(offer) {
  const zoneLabel = offer.coverageName(state.zone);
  return `
    <button class="card" data-action="pick" data-offer="${esc(offer.id)}">
      <div class="card__row">
        <span class="card__title t-display-s">${esc(offer.title)}</span>
        ${offer.profile ? `<span class="chip t-heading" data-profile="${esc(offer.profile.slug)}">${esc(offer.profile.name)}</span>` : ''}
      </div>
      <div class="card__zone t-heading">${esc(zoneLabel)}</div>
      <div class="card__price t-display-l">${esc(money(offer.price))}</div>
    </button>`;
}

function renderAddTicket() {
  const d = state.draft;
  const total = d.offer.price ? { amount: d.offer.price.amount * d.quantity, currency: d.offer.price.currency } : null;
  const body = `
    <section class="detail">
      <div class="detail__body">
        <div class="kv t-display-s">
          <div class="kv__row"><span class="kv__label">Card Number</span><span class="kv__value">N/A</span></div>
          <div class="kv__row"><span class="kv__label">Product</span><span class="kv__value">${esc(d.offer.title)}</span></div>
          <div class="kv__row"><span class="kv__label">Zone</span><span class="kv__value">${esc(d.offer.coverageName(state.zone))}</span></div>
          <div class="kv__row"><span class="kv__label">User profile</span><span class="kv__value">${esc(d.offer.profile?.name || '—')}</span></div>
        </div>
        <div class="rule"></div>
        <div class="quantity">
          <span class="quantity__label t-display-s">Quantity</span>
          <div class="stepper">
            <button class="stepper__btn" data-action="qty" data-delta="-1" aria-label="Decrease quantity" ${d.quantity <= 1 ? 'disabled' : ''}><img src="${icon('minus')}" alt=""></button>
            <span class="stepper__value t-display-s" aria-live="polite">${d.quantity}</span>
            <button class="stepper__btn" data-action="qty" data-delta="1" aria-label="Increase quantity" ${d.quantity >= 99 ? 'disabled' : ''}><img src="${icon('plus-red')}" alt=""></button>
          </div>
        </div>
        <div class="total t-display-l">
          <span class="total__label">Total</span>
          <span class="total__value">${esc(money(total))}</span>
        </div>
      </div>
      <div class="actions">
        <button class="btn-l btn-l--secondary t-display-m" data-action="cancel-add"><img src="${icon('x')}" alt="">Cancel</button>
        <button class="btn-l btn-l--primary t-display-m" data-action="confirm-add"><img src="${icon('check')}" alt="">Add ticket</button>
      </div>
    </section>`;
  return `<div class="screen">${renderHeader({ title: 'Add ticket to cart', showZone: false, showActions: false })}${body}${renderFooter()}</div>`;
}

function renderCart() {
  const total = cartTotal();
  const rows = state.cart.map((item, i) => `
    <div class="cart__row">
      <div class="cart__name">
        <span class="t-display-s">${esc(item.offer.title)}${item.offer.profile ? ` (${esc(item.offer.profile.name)})` : ''}</span>
        <span class="t-heading">${esc(item.zoneName)}</span>
      </div>
      <div class="cart__qty t-display-s">${item.quantity}x</div>
      <div class="cart__price t-display-s">${esc(money(item.price ? { amount: item.price.amount * item.quantity, currency: item.price.currency } : null))}</div>
      <div class="cart__action"><button class="cart__delete" data-action="remove" data-index="${i}" aria-label="Remove ${esc(item.offer.title)}"><img src="${icon('delete')}" alt=""></button></div>
    </div>`).join('');
  const extra = `<button class="btn-a t-heading" data-action="add-more"><img src="${icon('plus-white')}" alt="">Add more</button>`;
  const body = `
    <section class="cart">
      <div class="cart__head t-heading"><span>Name</span><span>Quantity</span><span>Price</span></div>
      <div class="cart__body">
        <div class="cart__rows">${rows || '<p class="cart__empty t-display-s">The cart is empty.</p>'}</div>
        <div class="cart__summary">
          <div class="cart__options">
            <button class="checkbox t-display-s" role="checkbox" aria-checked="${state.separateTickets}" data-action="toggle" data-key="separateTickets">
              <span class="checkbox__box"><svg class="checkbox__mark" viewBox="0 0 11 8" fill="none"><path d="M1 4l3 3 6-6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Separate tickets
            </button>
            <button class="checkbox t-display-s" role="checkbox" aria-checked="${state.printReceipt}" data-action="toggle" data-key="printReceipt">
              <span class="checkbox__box"><svg class="checkbox__mark" viewBox="0 0 11 8" fill="none"><path d="M1 4l3 3 6-6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Print receipt
            </button>
          </div>
          <div class="total t-display-l">
            <span class="total__label">Total</span>
            <span class="total__value">${esc(money(total) || money({ amount: 0, currency: 'SEK' }))}</span>
          </div>
        </div>
      </div>
      <div class="actions">
        <button class="btn-l btn-l--secondary t-display-m" data-action="cancel-cart"><img src="${icon('x')}" alt="">Cancel</button>
        <button class="btn-l btn-l--primary t-display-m" data-action="confirm-cart" ${state.cart.length ? '' : 'disabled'}><img src="${icon('check')}" alt="">Confirm</button>
      </div>
    </section>`;
  return `<div class="screen">${renderHeader({ title: 'Shopping Cart', showZone: false, showActions: false, extra })}${body}${renderFooter()}</div>`;
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
function renderModal() {
  if (!state.modal) { modals.innerHTML = ''; return; }
  if (state.modal === 'menu') {
    modals.innerHTML = `
      <div class="overlay" style="background:transparent" data-action="close"></div>
      <div class="menu" role="menu">
        <button class="menu__item t-heading" role="menuitem" data-action="client">Change client…</button>
        <button class="menu__item t-heading" role="menuitem" data-action="zone">Select zone…</button>
        <button class="menu__item t-heading" role="menuitem" data-action="reload">Reload fare data</button>
      </div>`;
    return;
  }
  if (state.modal === 'success') {
    modals.innerHTML = `
      <div class="overlay" role="status">
        <div class="toast"><img src="${icon('success-check')}" alt=""><span class="toast__text t-display-m">Ticket purchase completed</span></div>
      </div>`;
    return;
  }
  const isZone = state.modal === 'zone';
  const rows = isZone
    ? state.catalog.zones.map((z) => `<button class="row-btn t-display-s" role="option" data-action="set-zone" data-zone="${esc(z.code)}" aria-selected="${z.code === state.zone}"><span class="row-btn__text">${esc(z.name)}</span></button>`)
    : state.clients.map((c) => `<button class="row-btn t-display-s" role="option" data-action="set-client" data-client="${esc(c.id)}" aria-selected="${c.id === state.client?.id}"><span class="row-btn__text">${esc(c.name)}</span><span class="row-btn__meta">${esc(c.environment)}</span></button>`);
  modals.innerHTML = `
    <div class="overlay" data-action="close">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${isZone ? 'Select zone' : 'Select client'}">
        <div class="modal__header">
          <h2 class="modal__title t-display-s">${isZone ? 'Select zone' : 'Select client'}</h2>
          <button class="modal__close" data-action="close" aria-label="Close"><img src="${icon('x')}" alt=""></button>
        </div>
        <div class="modal__list" role="listbox">${rows.join('')}</div>
      </div>
    </div>`;
  const selected = modals.querySelector('[aria-selected="true"]');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const actions = {
  client() { state.modal = 'client'; renderModal(); },
  zone() { if (state.catalog) { state.modal = 'zone'; renderModal(); } },
  menu() { state.modal = state.modal === 'menu' ? null : 'menu'; renderModal(); },
  close() { state.modal = null; renderModal(); },
  reload() { state.modal = null; selectClient(state.client); },
  'set-zone'(el) { setZone(el.dataset.zone); state.modal = null; render(); },
  'set-client'(el) {
    const client = state.clients.find((c) => c.id === el.dataset.client);
    state.modal = null;
    if (client) selectClient(client);
  },
  tab(el) { setTab(el.dataset.tab); render(); },
  page(el) { goToPage(Number(el.dataset.page)); },
  pick(el) {
    const offer = state.catalog.offersInZone(state.zone).find((o) => o.id === el.dataset.offer);
    if (!offer) return;
    state.draft = { offer, quantity: 1 };
    state.screen = 'add';
    render();
  },
  qty(el) {
    state.draft.quantity = Math.min(99, Math.max(1, state.draft.quantity + Number(el.dataset.delta)));
    render();
  },
  'cancel-add'() { state.draft = null; state.screen = 'sell'; render(); },
  'confirm-add'() {
    const { offer, quantity } = state.draft;
    const zoneName = offer.coverageName(state.zone);
    const existing = state.cart.find((i) => i.offer.id === offer.id && i.zoneCode === state.zone);
    if (existing) existing.quantity = Math.min(99, existing.quantity + quantity);
    else state.cart.push({ offer, zoneCode: state.zone, zoneName, quantity, price: offer.price });
    state.draft = null;
    state.screen = 'cart';
    render();
  },
  'open-cart'() { state.screen = 'cart'; render(); },
  'add-more'() { state.screen = 'sell'; render(); },
  remove(el) { state.cart.splice(Number(el.dataset.index), 1); render(); },
  toggle(el) { state[el.dataset.key] = !state[el.dataset.key]; render(); },
  'cancel-cart'() { state.cart = []; state.screen = 'sell'; render(); },
  'confirm-cart'() {
    if (!state.cart.length) return;
    const sale = {
      client: state.client.id,
      channel: state.catalog.channels.map((c) => c.code),
      soldAt: new Date().toISOString(),
      separateTickets: state.separateTickets,
      printReceipt: state.printReceipt,
      items: state.cart.map((i) => ({ package: i.offer.packageCode, product: i.offer.productCode, profile: i.offer.profile?.code || null, zone: i.zoneCode, quantity: i.quantity, unitPrice: i.price })),
      total: cartTotal(),
    };
    console.info('Sale confirmed', sale); // Hook point for the ticketing backend.
    state.cart = [];
    state.modal = 'success';
    renderModal();
    setTimeout(() => { state.modal = null; state.screen = 'sell'; render(); }, 1800);
  },
};

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  if (target.classList.contains('overlay') && event.target !== target) return;
  const handler = actions[target.dataset.action];
  if (handler) handler(target);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.modal && state.modal !== 'success') actions.close();
  if (state.screen === 'sell' && !state.modal && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) goToPage(state.page + (event.key === 'ArrowRight' ? 1 : -1));
});

// Sliding pages: the track follows the finger, rubber-bands at the ends and eases into place.
const EASE = 'transform 360ms cubic-bezier(0.22, 0.61, 0.36, 1)';
function pageCount() { return document.querySelectorAll('.track > .cards').length; }
function goToPage(page, { animate = true } = {}) {
  const track = document.querySelector('.track');
  if (!track) return;
  const pages = pageCount();
  page = Math.max(0, Math.min(pages - 1, page));
  state.page = page;
  track.style.transition = animate ? EASE : 'none';
  track.style.transform = `translate3d(${-page * 100}%, 0, 0)`;
  track.querySelectorAll(':scope > .cards').forEach((el, i) => el.setAttribute('aria-hidden', String(i !== page)));
  document.querySelectorAll('.pager__dot').forEach((dot, i) => dot.setAttribute('aria-current', String(i === page)));
}

const drag = { active: false, moved: false, id: null, startX: 0, startY: 0, dx: 0, lastX: 0, lastT: 0, velocity: 0, width: 1 };
document.addEventListener('pointerdown', (e) => {
  const track = e.target.closest('[data-swipe]');
  if (!track || e.button !== 0) return;
  Object.assign(drag, { active: true, moved: false, id: e.pointerId, startX: e.clientX, startY: e.clientY, dx: 0, lastX: e.clientX, lastT: e.timeStamp, velocity: 0, width: track.clientWidth || 1 });
});
document.addEventListener('pointermove', (e) => {
  if (!drag.active || e.pointerId !== drag.id) return;
  const track = document.querySelector('.track');
  if (!track) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (!drag.moved) {
    if (Math.abs(dx) < 8 || Math.abs(dy) > Math.abs(dx)) { if (Math.abs(dy) >= 8) drag.active = false; return; }
    drag.moved = true;
    track.setPointerCapture?.(e.pointerId);
    track.style.transition = 'none';
  }
  const pages = pageCount();
  let offset = dx;
  const atEdge = (state.page === 0 && dx > 0) || (state.page === pages - 1 && dx < 0);
  if (atEdge) offset = dx * 0.3; // rubber band
  drag.dx = offset;
  const dt = Math.max(1, e.timeStamp - drag.lastT);
  drag.velocity = (e.clientX - drag.lastX) / dt; // px per ms
  drag.lastX = e.clientX; drag.lastT = e.timeStamp;
  track.style.transform = `translate3d(calc(${-state.page * 100}% + ${offset}px), 0, 0)`;
});
function endDrag(e) {
  if (!drag.active || e.pointerId !== drag.id) return;
  drag.active = false;
  if (!drag.moved) return;
  const flick = Math.abs(drag.velocity) > 0.4;
  const far = Math.abs(drag.dx) > drag.width / 4;
  let next = state.page;
  if (flick) next += drag.velocity < 0 ? 1 : -1;
  else if (far) next += drag.dx < 0 ? 1 : -1;
  goToPage(next);
  suppressClickUntil = performance.now() + 400;
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);
let suppressClickUntil = 0;
document.addEventListener('click', (e) => { if (performance.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); } }, true);

// Page size follows the available height: 3 columns × as many 160px rows as fit.
function updatePageSize() {
  const px = (sel, fallback) => document.querySelector(sel)?.offsetHeight || fallback;
  const h = window.innerHeight - px('.header', 80) - px('.tabs', 72) - px('.footer', 50) - 28 - 24; // top padding + pager
  const cols = window.innerWidth <= 520 ? 1 : window.innerWidth <= 760 ? 2 : 3;
  const rows = Math.max(1, Math.floor((h + 17) / 177));
  const size = cols * rows;
  if (size !== state.pageSize) { state.pageSize = size; state.page = 0; if (state.catalog) render(); }
}
window.addEventListener('resize', updatePageSize);

function updateClock() {
  const el = document.querySelector('[data-clock]');
  if (el) el.textContent = formatClock();
}
setInterval(updateClock, 15000);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  updatePageSize();
  try {
    await loadClients();
  } catch (err) {
    state.loadError = `Could not load clients.json: ${err.message}`;
    render();
    return;
  }
  const savedId = read(STORAGE.client);
  const client = state.clients.find((c) => c.id === savedId) || state.clients[0];
  if (!client) { state.loadError = 'No clients configured in clients.json.'; render(); return; }
  await selectClient(client);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered', err));
  }
})();
