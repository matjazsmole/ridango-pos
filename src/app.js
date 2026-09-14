/**
 * Ridango POS 2.0 — application shell.
 * Screens: sell (catalogue) → add ticket → shopping cart → success.
 * Modals: settings (client, device, card layout), select zone, select client, header menu.
 */
import { buildCatalog } from './fare-model.js';
import { formatPrice, formatClock } from './format.js';

const STORAGE = {
  client: 'ridango-pos.client',
  device: 'ridango-pos.device',
  layout: 'ridango-pos.layout',
  cardView: 'ridango-pos.card-view',
  navigation: 'ridango-pos.navigation',
  zone: (clientId) => `ridango-pos.zone.${clientId}`,
  tab: (clientId) => `ridango-pos.tab.${clientId}`,
};

// Devices the UI can be optimised for. width/height are the landscape viewport in CSS px,
// cssPpi the CSS pixels per physical inch (native ppi ÷ device pixel ratio). The UI is zoomed
// by cssPpi / REF_PPI so controls have the same physical size on every device; on a larger
// window the app is shown inside a frame of the device's size.
const REF_PPI = 132; // iPad Pro 11″ (264 ppi @2x) is the 1:1 reference
const DEVICES = [
  { id: 'auto', name: 'Fit to window', meta: 'no optimisation', width: null, height: null, cssPpi: REF_PPI },
  { id: 'sunmi-d3-mini', name: 'SUNMI D3 Mini', meta: '10.1″ · 1280 × 800', width: 1280, height: 800, cssPpi: 149 },
  { id: 'ipad-pro-11', name: 'iPad Pro 11″ (2018)', meta: '11″ · 1194 × 834', width: 1194, height: 834, cssPpi: 132 },
  { id: 'ipad-pro-12-9', name: 'iPad Pro 12.9″ (2018)', meta: '12.9″ · 1366 × 1024', width: 1366, height: 1024, cssPpi: 132 },
];
const LAYOUTS = [
  { id: '2x3', name: '2 rows × 3 cards', rows: 2, cols: 3 },
  { id: '2x2', name: '2 rows × 2 cards', rows: 2, cols: 2 },
  { id: '2x4', name: '2 rows × 4 cards', rows: 2, cols: 4 },
  { id: '3x2', name: '3 rows × 2 cards', rows: 3, cols: 2 },
  { id: '3x3', name: '3 rows × 3 cards', rows: 3, cols: 3 },
  { id: '3x4', name: '3 rows × 4 cards', rows: 3, cols: 4 },
];
// Card view: 'parameters' shows product, zone and user profile as separate parameters;
// 'derived' shows one derived product name, e.g. "Single ticket - Arboga (ADULT)", and the price.
const CARD_VIEWS = [
  { id: 'parameters', name: 'Parameters' },
  { id: 'derived', name: 'Derived products' },
];
// Navigation: 'pages' splits the catalogue into swipeable pages of rows × columns cards;
// 'scroll' shows every product of the tab in one vertically scrolling grid.
// 'groups' replaces the tabs with breadcrumbs: product types first, then (where a type has more
// than one group) period passes grouped by validity period and multi-trip tickets by number of
// trips, then the products.
const NAVIGATIONS = [
  { id: 'pages', name: 'Swipe & pagination' },
  { id: 'scroll', name: 'Scroll' },
  { id: 'groups', name: 'Groups & breadcrumbs' },
];
const GROUPING = {
  'TypeOfFareProduct@PERIOD_PASS': { key: (o) => o.period?.label || '', order: (o) => o.period?.seconds ?? Infinity },
  'TypeOfFareProduct@MULTI_TRIP': { key: (o) => o.trips?.label || '', order: (o) => o.trips?.count ?? Infinity },
};
const deviceOf = (id) => DEVICES.find((d) => d.id === id) || DEVICES[0];
const layoutOf = (id) => LAYOUTS.find((l) => l.id === id) || LAYOUTS[0];
const cardViewOf = (id) => CARD_VIEWS.find((v) => v.id === id) || CARD_VIEWS[0];
const navigationOf = (id) => NAVIGATIONS.find((n) => n.id === id) || NAVIGATIONS[0];

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
  modal: null,         // 'settings' | 'zone' | 'client' | 'device' | 'layout' | 'card-view' | 'navigation' | 'menu' | 'success'
  modalReturn: null,   // modal to reopen after a pick (settings sub-lists)
  device: 'auto',      // DEVICES id
  layout: '2x3',       // LAYOUTS id
  cardView: 'parameters', // CARD_VIEWS id
  navigation: 'pages', // NAVIGATIONS id
  nav: { type: null, group: null }, // position in the grouped catalogue
};

const deviceEl = document.getElementById('device');
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
  state.nav = { type: null, group: null };
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
  state.nav = { type: null, group: null };
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
      <button class="header__logo" data-action="settings" aria-label="Settings" aria-haspopup="dialog" style="--logo-h:${Number(c?.logoHeight) || 40}px">
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
    let bar, catalog;
    if (state.navigation === 'groups') {
      ({ bar, catalog } = renderGrouped(tabs));
    } else {
      const offers = state.catalog.offersInZone(state.zone).filter((o) => o.typeCode === state.tab);
      const cards = offers.map(renderCard);
      bar = `
        <nav class="tabs" role="tablist">
          ${tabs.map((t) => `<button class="tab t-heading" role="tab" data-action="tab" data-tab="${esc(t.code)}" aria-selected="${t.code === state.tab}">${esc(t.name)}</button>`).join('')}
        </nav>`;
      catalog = state.navigation === 'scroll' ? renderScrolled(cards) : renderPaged(cards);
    }
    body = `<div class="sell">${bar}${catalog}</div>`;
  }
  return `<div class="screen">${renderHeader({ title: 'Sell ticket' })}${body}${renderFooter()}</div>`;
}

const EMPTY = '<p class="empty t-display-s">No products for this zone.</p>';

function renderScrolled(cards) {
  return `
    <section class="catalog catalog--scroll">
      <div class="cards">${cards.length ? cards.join('') : EMPTY}</div>
    </section>`;
}

function renderPaged(cards) {
  const pages = Math.max(1, Math.ceil(cards.length / state.pageSize));
  state.page = Math.min(state.page, pages - 1);
  const pageHtml = Array.from({ length: pages }, (_, i) => {
    const slice = cards.slice(i * state.pageSize, (i + 1) * state.pageSize);
    return `<div class="cards" aria-hidden="${i !== state.page}">${slice.length ? slice.join('') : EMPTY}</div>`;
  }).join('');
  return `
    <section class="catalog">
      <div class="catalog__pages">
        <div class="track" data-swipe style="transform:translate3d(${-state.page * 100}%,0,0)">${pageHtml}</div>
      </div>
      <div class="pager" role="tablist" aria-label="Pages">
        ${pages > 1 ? Array.from({ length: pages }, (_, i) => `<button class="pager__dot" data-action="page" data-page="${i}" aria-current="${i === state.page}" aria-label="Page ${i + 1}"></button>`).join('') : ''}
      </div>
    </section>`;
}

/** Groups of a product type's offers (period passes by validity period, multi-trip by trips); null when the type has at most one group. */
function groupsOf(typeCode, offers) {
  const rule = GROUPING[typeCode];
  if (!rule) return null;
  const map = new Map();
  for (const o of offers) {
    const label = rule.key(o) || 'Other';
    if (!map.has(label)) map.set(label, { label, order: rule.key(o) ? rule.order(o) : Infinity, offers: [] });
    map.get(label).offers.push(o);
  }
  if (map.size <= 1) return null;
  return [...map.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'sv'));
}

function renderGroupCard(action, key, value, label, count) {
  return `
    <button class="card card--group" data-action="${action}" data-${key}="${esc(value)}">
      <div class="card__name t-display-s">${esc(label)}</div>
      <div class="card__zone t-heading">${count} ${count === 1 ? 'product' : 'products'}</div>
    </button>`;
}

function renderGrouped(types) {
  const all = state.catalog.offersInZone(state.zone);
  const crumbs = [{ label: 'Products', level: 0 }];
  let cards;
  const type = types.find((t) => t.code === state.nav.type);
  if (!type) {
    state.nav = { type: null, group: null };
    cards = types.map((t) => renderGroupCard('nav-type', 'type', t.code, t.name, all.filter((o) => o.typeCode === t.code).length));
  } else {
    crumbs.push({ label: type.name, level: 1 });
    const offers = all.filter((o) => o.typeCode === type.code);
    const groups = groupsOf(type.code, offers);
    const group = groups?.find((g) => g.label === state.nav.group);
    if (groups && !group) {
      state.nav.group = null;
      cards = groups.map((g) => renderGroupCard('nav-group', 'group', g.label, g.label, g.offers.length));
    } else {
      if (group) crumbs.push({ label: group.label, level: 2 });
      cards = (group ? group.offers : offers).map(renderCard);
    }
  }
  const last = crumbs.length - 1;
  const bar = `
    <nav class="crumbs" aria-label="Breadcrumb">
      <button class="crumbs__back t-heading" data-action="nav-back" aria-disabled="${last === 0}">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Back
      </button>
      ${crumbs.map((c, i) => `<button class="crumb t-heading" data-action="nav-level" data-level="${c.level}" aria-current="${i === last ? 'page' : 'false'}">${esc(c.label)}</button>`).join('<span class="crumbs__sep t-heading" aria-hidden="true">›</span>')}
    </nav>`;
  return { bar, catalog: renderPaged(cards) };
}

function renderCard(offer) {
  const zoneLabel = offer.coverageName(state.zone);
  if (state.cardView === 'derived') {
    const name = `${offer.title} - ${zoneLabel}${offer.profile ? ` (${offer.profile.name.toUpperCase()})` : ''}`;
    return `
    <button class="card card--derived" data-action="pick" data-offer="${esc(offer.id)}">
      <div class="card__name t-display-s">${esc(name)}</div>
      <div class="card__price t-display-l">${esc(money(offer.price))}</div>
    </button>`;
  }
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
  const option = (action, key, value, text, meta, selected) =>
    `<button class="row-btn t-display-s" role="option" data-action="${action}" data-${key}="${esc(value)}" aria-selected="${selected}"><span class="row-btn__text">${esc(text)}</span>${meta ? `<span class="row-btn__meta">${esc(meta)}</span>` : ''}</button>`;
  const c = state.client;
  const lists = {
    settings: {
      title: 'Settings',
      rows: [
        option('client', 'open', '', 'Client', c ? `${c.name} · ${c.environment}` : '—', false),
        option('device', 'open', '', 'Device', deviceOf(state.device).name, false),
        option('layout', 'open', '', 'Card layout', layoutOf(state.layout).name, false),
        option('card-view', 'open', '', 'Card view', cardViewOf(state.cardView).name, false),
        option('navigation', 'open', '', 'Navigation', navigationOf(state.navigation).name, false),
      ],
    },
    zone: { title: 'Select zone', rows: (state.catalog?.zones || []).map((z) => option('set-zone', 'zone', z.code, z.name, '', z.code === state.zone)) },
    client: { title: 'Select client', rows: state.clients.map((x) => option('set-client', 'client', x.id, x.name, x.environment, x.id === c?.id)) },
    device: { title: 'Select device', rows: DEVICES.map((d) => option('set-device', 'device', d.id, d.name, d.meta, d.id === state.device)) },
    layout: { title: 'Card layout', rows: LAYOUTS.map((l) => option('set-layout', 'layout', l.id, l.name, '', l.id === state.layout)) },
    'card-view': { title: 'Card view', rows: CARD_VIEWS.map((v) => option('set-card-view', 'view', v.id, v.name, '', v.id === state.cardView)) },
    navigation: { title: 'Navigation', rows: NAVIGATIONS.map((n) => option('set-navigation', 'navigation', n.id, n.name, '', n.id === state.navigation)) },
  };
  const { title, rows } = lists[state.modal] || lists.settings;
  modals.innerHTML = `
    <div class="overlay" data-action="close">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal__header">
          <h2 class="modal__title t-display-s">${esc(title)}</h2>
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
// Opens a list modal; lists opened from Settings return there after a pick.
function openModal(name) {
  state.modalReturn = state.modal === 'settings' ? 'settings' : null;
  state.modal = name;
  renderModal();
}
function afterPick() {
  state.modal = state.modalReturn;
  state.modalReturn = null;
}

const actions = {
  settings() { state.modal = 'settings'; state.modalReturn = null; renderModal(); },
  client() { openModal('client'); },
  device() { openModal('device'); },
  layout() { openModal('layout'); },
  'card-view'() { openModal('card-view'); },
  navigation() { openModal('navigation'); },
  zone() { if (state.catalog) openModal('zone'); },
  menu() { state.modal = state.modal === 'menu' ? null : 'menu'; renderModal(); },
  close() { state.modal = null; state.modalReturn = null; renderModal(); },
  reload() { state.modal = null; selectClient(state.client); },
  'set-zone'(el) { setZone(el.dataset.zone); afterPick(); render(); },
  'set-client'(el) {
    const client = state.clients.find((c) => c.id === el.dataset.client);
    afterPick();
    if (client) selectClient(client);
  },
  'set-device'(el) {
    state.device = deviceOf(el.dataset.device).id;
    write(STORAGE.device, state.device);
    afterPick();
    applyDevice();
    updatePageSize();
    render();
  },
  'set-layout'(el) {
    state.layout = layoutOf(el.dataset.layout).id;
    write(STORAGE.layout, state.layout);
    afterPick();
    state.page = 0;
    updatePageSize();
    render();
  },
  'set-card-view'(el) {
    state.cardView = cardViewOf(el.dataset.view).id;
    write(STORAGE.cardView, state.cardView);
    afterPick();
    render();
  },
  'set-navigation'(el) {
    state.navigation = navigationOf(el.dataset.navigation).id;
    write(STORAGE.navigation, state.navigation);
    afterPick();
    state.page = 0;
    state.nav = { type: null, group: null };
    updatePageSize();
    render();
  },
  tab(el) { setTab(el.dataset.tab); render(); },
  page(el) { goToPage(Number(el.dataset.page)); },
  'nav-type'(el) { state.nav = { type: el.dataset.type, group: null }; state.page = 0; render(); },
  'nav-group'(el) { state.nav.group = el.dataset.group; state.page = 0; render(); },
  'nav-level'(el) {
    const level = Number(el.dataset.level);
    if (level === 0) state.nav = { type: null, group: null };
    else if (level === 1) state.nav.group = null;
    state.page = 0;
    render();
  },
  'nav-back'() {
    if (state.nav.group) state.nav.group = null;
    else if (state.nav.type) state.nav.type = null;
    else return;
    state.page = 0;
    render();
  },
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

// Trackpad two-finger swipe (horizontal wheel events): follow the gesture, flip once past the threshold.
const wheel = { acc: 0, timer: null, flipped: false };
const WHEEL_THRESHOLD = 90; // px of horizontal scroll needed to change page
function endWheelGesture() {
  wheel.timer = null;
  if (!wheel.flipped) goToPage(state.page); // snap back
  wheel.acc = 0;
  wheel.flipped = false;
}
document.addEventListener('wheel', (e) => {
  const track = e.target.closest('[data-swipe]');
  if (!track || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  e.preventDefault();
  clearTimeout(wheel.timer);
  wheel.timer = setTimeout(endWheelGesture, 120);
  if (wheel.flipped || drag.active) return; // one page per gesture
  wheel.acc += e.deltaX;
  const pages = pageCount();
  const dir = wheel.acc > 0 ? 1 : -1;
  const next = state.page + dir;
  if (next < 0 || next >= pages) {
    track.style.transition = 'none';
    track.style.transform = `translate3d(calc(${-state.page * 100}% + ${-wheel.acc * 0.3}px), 0, 0)`; // rubber band
    return;
  }
  if (Math.abs(wheel.acc) >= WHEEL_THRESHOLD) {
    wheel.flipped = true;
    goToPage(next);
    return;
  }
  track.style.transition = 'none';
  track.style.transform = `translate3d(calc(${-state.page * 100}% + ${-wheel.acc}px), 0, 0)`;
}, { passive: false });

// Device frame: zoom the UI so controls keep their physical size, and on a window larger than
// the device show the app inside a frame of the device's viewport size.
function applyDevice() {
  const dev = deviceOf(state.device);
  const zoom = dev.width ? dev.cssPpi / REF_PPI : 1;
  const w = dev.width ? Math.min(window.innerWidth, dev.width) : window.innerWidth;
  const h = dev.height ? Math.min(window.innerHeight, dev.height) : window.innerHeight;
  deviceEl.style.setProperty('--ui-scale', String(zoom));
  deviceEl.style.width = `${w / zoom}px`;
  deviceEl.style.height = `${h / zoom}px`;
  document.body.toggleAttribute('data-device-frame', w < window.innerWidth || h < window.innerHeight);
  document.documentElement.dataset.device = dev.id;
}

// Page size: the chosen card layout (rows × columns), reduced on narrow screens. Cards are
// 160px tall but shrink to 120px so the chosen rows fit; if they still don't, rows drop.
const CARD_H = 160, CARD_H_MIN = 120, CARD_GAP = 17;
function updatePageSize() {
  const layout = layoutOf(state.layout);
  const px = (sel, fallback) => document.querySelector(sel)?.offsetHeight || fallback;
  const h = app.clientHeight - px('.header', 80) - px('.tabs, .crumbs', 72) - px('.footer', 50) - 28 - 24; // top padding + pager
  const cols = matchMedia('(max-width: 520px)').matches ? 1 : matchMedia('(max-width: 760px)').matches ? 2 : layout.cols;
  let rows = layout.rows;
  const fit = (r) => Math.floor((h - (r - 1) * CARD_GAP) / r);
  while (rows > 1 && fit(rows) < CARD_H_MIN) rows--;
  const cardH = state.navigation === 'scroll' ? CARD_H : Math.max(CARD_H_MIN, Math.min(CARD_H, fit(rows)));
  document.documentElement.style.setProperty('--card-cols', String(cols));
  document.documentElement.style.setProperty('--card-h', `${cardH}px`);
  const size = cols * rows;
  if (size !== state.pageSize) { state.pageSize = size; state.page = 0; if (state.catalog) render(); }
}
window.addEventListener('resize', () => { applyDevice(); updatePageSize(); });

function updateClock() {
  const el = document.querySelector('[data-clock]');
  if (el) el.textContent = formatClock();
}
setInterval(updateClock, 15000);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  state.device = deviceOf(read(STORAGE.device)).id;
  state.layout = layoutOf(read(STORAGE.layout)).id;
  state.cardView = cardViewOf(read(STORAGE.cardView)).id;
  state.navigation = navigationOf(read(STORAGE.navigation)).id;
  applyDevice();
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
