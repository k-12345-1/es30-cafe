const state = { cart: new Map(), items: {}, currency: 'usd', demo: false, stripeKey: '', ordersOpen: true };

const el = (id) => document.getElementById(id);

const money = (cents) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: state.currency.toUpperCase() })
    .format(cents / 100);

/* ---------- ribbon ----------
   The notched banner is four nested clipped layers: ink, cream, ink, cream.
   That gives the double outline without any images. */

function buildRibbons() {
  for (const node of document.querySelectorAll('.ribbon[data-label]')) {
    node.innerHTML =
      `<span class="r2"><span class="r3"><span class="r4">${node.dataset.label}</span></span></span>`;
  }
}

/* ---------- dotted leaders ----------
   The dots have to run from the end of the name to the price on every screen,
   so the name is laid out word by word inside the row. The row wraps between
   words, which leaves the leader and the price on the final line with the dots
   filling whatever is left of it, however narrow the phone.

   On top of that, a name that would only just wrap is stepped down in size so
   it stays on one line. That only happens while the name stays above a floor;
   a name that would have to go smaller than that wraps instead. */

const LEADER_MIN = 44;
const NAME_FLOOR = 12;

// The name is split into words so the row can wrap between them; each word
// carries its own trailing space, since a flex row drops the whitespace
// between its items. The last word, the dots and the price travel together in
// one unbreakable tail, so the price can never be left stranded on a line of
// its own, and the dots always run between the two.
function nameRow(name, price) {
  const words = name.split(/\s+/);
  const last = words.pop();
  return `${words.map((word) => `<span class="w">${word}</span>`).join('')}<span class="tail"><span class="w">${last}</span><span class="leader" aria-hidden="true"></span><span class="row-price">${price}</span></span>`;
}

function fitLeaders() {
  for (const main of document.querySelectorAll('.row-main')) {
    const name = main.querySelector('.row-name');
    const price = main.querySelector('.row-price');
    const tail = main.querySelector('.tail');
    const words = main.querySelectorAll('.w');
    if (!name || !price || !tail || !words.length) continue;

    name.style.fontSize = '';
    tail.style.minWidth = '';

    const base = parseFloat(getComputedStyle(name).fontSize);
    const style = getComputedStyle(words[0]);
    const space = parseFloat(style.marginRight) || 0;

    // Word widths do not depend on where the row happens to wrap, so this is
    // the width the name would need on a single line.
    let natural = 0;
    for (const word of words) natural += word.getBoundingClientRect().width + space;

    const room = main.clientWidth - price.getBoundingClientRect().width - LEADER_MIN;
    if (!natural || room <= 0) continue;

    const scale = room / natural;
    if (scale >= 1) continue;

    // Shrink only as far as the floor. Past that, leave the name at full size
    // and let the row wrap: a second line with a proper run of dots reads
    // better than one line with three dots squeezed into it.
    const size = base * scale;
    if (size >= NAME_FLOOR) {
      name.style.fontSize = size.toFixed(2) + 'px';
    } else if (words.length > 1) {
      // Give the tail a width the line cannot satisfy, so it wraps down to a
      // line of its own and the dots have room to run.
      const lastWord = words[words.length - 1].getBoundingClientRect().width;
      tail.style.minWidth =
        Math.round(lastWord + LEADER_MIN + price.getBoundingClientRect().width) + 'px';
    }
  }
}

let fitPending;
window.addEventListener('resize', () => {
  clearTimeout(fitPending);
  fitPending = setTimeout(fitLeaders, 120);
});

/* ---------- the break clock ----------
   Four split-flap cards counting down to the moment the server named, not to
   ten minutes from whenever this page happened to load. The offset keeps a
   phone with a wandering clock in step with the room. */

let clockOffset = 0;        // server time minus this device's time
let breakEndsAt = null;
let opensAt = null;
let openingLeadMs = 60 * 60_000;
let clockTimer;

let clockDrawn = false;

function setDigit(flip, value) {
  const top = flip.querySelector('.top');
  const bottom = flip.querySelector('.bottom');
  const leafTop = flip.querySelector('.leaf-top');
  const leafBottom = flip.querySelector('.leaf-bottom');

  const current = top.textContent;
  if (current === value) return;

  // The first paint is just the clock appearing, not a second passing.
  if (!clockDrawn) {
    top.textContent = value;
    bottom.dataset.value = value;
    return;
  }

  // The leaf that falls carries the old digit; the one that lands carries the
  // new. The resting halves are set so the card reads correctly either side of
  // the turn.
  leafTop.textContent = current;
  leafBottom.dataset.value = value;
  top.textContent = value;
  bottom.dataset.value = current;

  flip.classList.remove('turning');
  void flip.offsetWidth;                 // let the animation start again
  flip.classList.add('turning');

  clearTimeout(flip._settle);
  flip._settle = setTimeout(() => {
    flip.classList.remove('turning');
    bottom.dataset.value = value;
  }, 540);
}

function paintClock(msLeft, mode) {
  const clock = el('breakClock');
  const left = Math.max(0, msLeft);
  const total = Math.ceil(left / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  const digits = String(Math.min(99, mins)).padStart(2, '0') + String(secs).padStart(2, '0');

  clock.querySelectorAll('.flip').forEach((flip, i) => setDigit(flip, digits[i]));
  clockDrawn = true;

  clock.classList.toggle('resting', mode === 'waiting' || mode === 'soon');
  clock.classList.toggle('last-minute', mode === 'closing' && left > 0 && left <= 60_000);
  clock.classList.toggle('over', mode === 'closed');

  const labels = {
    waiting: '10-Minute Break Countdown',
    opening: 'ES30 Cafe opens in',
    soon: 'ES30 Cafe opening soon',
    closing: 'ES30 Cafe closes in',
    closed: 'ES30 Cafe is closed!'
  };
  clock.querySelector('.flip-label').textContent = labels[mode];

  const note = el('clockNote');
  if (note) {
    note.textContent = state.ordersOpen
      ? ''
      : 'The counter is closed. Come back at the next break.';
    note.hidden = state.ordersOpen;
  }
}

const BREAK_LENGTH_MS = 10 * 60_000;

/* The one clock, through the day:
     opens in     counting down the hour before the cafe opens
     opening soon that moment has come and staff have not started the break
     closes in    the break is running
     closed       it has run out
     waiting      nothing is set, so it rests at the length of a break */

function runClock() {
  clearInterval(clockTimer);
  const clock = el('breakClock');
  clock.hidden = false;

  const tick = () => {
    const now = Date.now() + clockOffset;

    // Running: counting down to closing time.
    if (breakEndsAt && breakEndsAt > now) {
      paintClock(breakEndsAt - now, 'closing');
      return;
    }

    // Not running: either the next break is close enough to count down to, or
    // the cafe is simply shut.
    if (opensAt) {
      const until = opensAt - now;
      if (until <= 0) {
        paintClock(0, 'soon');
        return;
      }
      if (until <= openingLeadMs) {
        paintClock(until, 'opening');
        return;
      }
    }

    paintClock(0, 'closed');
    clearInterval(clockTimer);
    // Keep a slow pulse so the hour before the next break still arrives.
    clockTimer = setInterval(tick, 5000);
  };

  tick();
  clockTimer = setInterval(tick, 250);
}

/* ---------- menu ---------- */

// What the menu looks like, boiled down. If this is unchanged, the rows on
// screen are still right and only the counts need refreshing.
function menuShape(menu) {
  return JSON.stringify(menu.map((s) => [
    s.section,
    s.groups.map((g) => [g.title, g.items.map((i) => [i.id, i.name, i.price, i.desc || ''])])
  ]));
}

let drawnShape = '';

function drawMenu(data) {
  el('menuBody').innerHTML = data.menu.map((section) => `
    <h2 class="section-title">${section.section}</h2>
    ${section.groups.map((group) => `
      ${group.title ? `<h3 class="group-title">${group.title}</h3>` : ''}
      ${group.items.map((item) => `
        <div class="row">
          <div class="row-line">
            <div class="row-main">
              <p class="row-name">${nameRow(item.name, money(item.price))}</p>
            </div>
            <div class="row-ctl" data-id="${item.id}"></div>
          </div>
          ${item.desc ? `<p class="row-desc">${item.desc}</p>` : ''}
        </div>
      `).join('')}
    `).join('')}
  `).join('');

  renderSite(data.site || {});
  fitLeaders();
}

// Reads the menu and brings the page into line with it: the rows are redrawn
// only if the menu itself changed, so a passing count update never disturbs a
// cart someone is in the middle of filling.
async function syncMenu() {
  const res = await fetch('/api/menu');
  if (!res.ok) return;
  const data = await res.json();

  state.currency = data.currency;
  state.demo = data.demo;
  state.stripeKey = data.stripeKey || '';

  state.ordersOpen = data.ordersOpen !== false;
  document.body.classList.toggle('shut', !state.ordersOpen);

  if (Number.isFinite(data.now)) clockOffset = data.now - Date.now();
  if (Number.isFinite(data.opensLeadMinutes)) openingLeadMs = data.opensLeadMinutes * 60_000;

  if (data.breakEndsAt !== breakEndsAt || data.opensAt !== opensAt || !clockTimer) {
    breakEndsAt = data.breakEndsAt || null;
    opensAt = data.opensAt || null;
    runClock();
  }
  state.items = Object.fromEntries(
    data.menu.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => [i.id, i])))
  );

  const shape = menuShape(data.menu);
  if (shape !== drawnShape) {
    drawnShape = shape;
    drawMenu(data);
  }

  // An item can leave the menu, or sell down, while a cart is open.
  for (const [id, qty] of [...state.cart]) {
    const item = state.items[id];
    const left = item?.available ?? 0;
    if (!item || left <= 0) state.cart.delete(id);
    else if (qty > left) state.cart.set(id, left);
  }

  persist();
  renderCart();
}

async function loadMenu() {
  await syncMenu();

  el('menuBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-delta]');
    if (!btn) return;
    const id = btn.closest('.row-ctl').dataset.id;
    setQty(id, (state.cart.get(id) || 0) + Number(btn.dataset.delta));
  });

  watchForChanges();
}

/* ---------- staying current ----------
   The server holds a stream open and says when the menu or the counts change,
   so an edit on the staff page lands here at once. The poll is the belt to
   that brace: it covers a dropped stream, a sleeping phone, or a network that
   will not carry events. */

function watchForChanges() {
  try {
    const stream = new EventSource('/api/events');
    // Everyone hears at once, so each page waits a random fraction of a second
    // before asking: three hundred refreshes spread over half a second rather
    // than arriving together.
    stream.addEventListener('menu', () => {
      setTimeout(() => syncMenu(), Math.random() * 600);
    });
  } catch { /* no EventSource; the poll below carries it */ }

  setInterval(() => { if (!document.hidden) syncMenu(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncMenu(); });
  window.addEventListener('focus', () => syncMenu());
}

// Each menu row shows a plus until the item is in the cart, then a stepper with
// the quantity. Called on every cart change so the two stay in step.
function renderMenuQuantities() {
  for (const ctl of document.querySelectorAll('.row-ctl')) {
    const id = ctl.dataset.id;
    const item = state.items[id];
    const qty = state.cart.get(id) || 0;
    const left = item.available ?? 0;
    const name = item.name;

    // key includes the limit, and whether the counter is open, so a row redraws
    // when either changes under it
    const key = `${qty}/${left}/${state.ordersOpen ? 'open' : 'shut'}`;
    if (ctl.dataset.key === key) continue;
    const isNew = qty > 0 && (ctl.dataset.key || '').startsWith('0/');
    ctl.dataset.key = key;

    if (!state.ordersOpen) {
      ctl.innerHTML = '';
      ctl.dataset.key = 'shut';
      continue;
    }

    if (left <= 0 && qty === 0) {
      ctl.innerHTML = '<span class="sold-out">sold out :(</span>';
      continue;
    }

    if (qty === 0) {
      ctl.innerHTML = `<button class="add" data-delta="1" aria-label="Add ${name} to cart">+</button>`;
      continue;
    }

    const atLimit = qty >= left;
    ctl.innerHTML = `
      <div class="row-qty${isNew ? ' pop' : ''}">
        <button data-delta="-1" aria-label="Remove one ${name}">&minus;</button>
        <span aria-live="polite" aria-label="${qty} of ${left} in cart">${qty}</span>
        <button data-delta="1" aria-label="Add one ${name}"${atLimit ? ' disabled aria-disabled="true"' : ''}>+</button>
      </div>`;
  }

  renderStockNotes();
  fitLeaders();
}

// A quiet line under an item once it is into single figures, or all of them are
// in the cart already, so the disabled plus is never a mystery.
function renderStockNotes() {
  for (const row of document.querySelectorAll('.row')) {
    const id = row.querySelector('.row-ctl').dataset.id;
    const item = state.items[id];
    const left = item.available ?? 0;
    const qty = state.cart.get(id) || 0;
    let note = '';

    if (left > 0 && qty >= left) note = `that is all ${left} we have`;
    else if (left > 0 && left < 10) note = `only ${left} left!`;

    let el = row.querySelector('.row-stock');
    if (!note) { if (el) el.remove(); continue; }
    if (!el) {
      el = document.createElement('p');
      el.className = 'row-stock';
      row.appendChild(el);
    }
    if (el.textContent !== note) el.textContent = note;
  }
}

// Shop details come from SITE in menu.js. Anything left blank renders nothing,
// so the page never shows hours or a policy that were never filled in.
function renderSite(site) {
  const put = (id, text) => { el(id).textContent = text || ''; };
  put('footHours', site.hours);
  put('footAddress', site.address);
  put('footEmail', site.email);

  el('footnote').hidden = !site.footnote;
  if (site.footnote) el('footnote').textContent = `* ${site.footnote}`;
}

/* ---------- cart ---------- */

function setQty(id, qty) {
  const left = state.items[id]?.available ?? 0;
  const capped = Math.min(qty, left);
  if (capped <= 0) state.cart.delete(id);
  else state.cart.set(id, capped);
  persist();
  renderCart();
}

function cartTotal() {
  let sum = 0;
  for (const [id, qty] of state.cart) sum += state.items[id].price * qty;
  return sum;
}

function cartCount() {
  let n = 0;
  for (const qty of state.cart.values()) n += qty;
  return n;
}

function renderCart() {
  renderMenuQuantities();

  const count = cartCount();
  const total = cartTotal();

  el('cartCount').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  el('cartTotal').textContent = money(total);
  el('sheetTotal').textContent = money(total);
  el('payBtn').disabled = count === 0;
  updatePayState();
  updateCartBar();

  if (count === 0) {
    el('cartList').innerHTML = '<p class="empty">nothing here yet</p>';
    return;
  }

  el('cartList').innerHTML = [...state.cart].map(([id, qty]) => {
    const item = state.items[id];
    return `
      <div class="cart-line">
        <div>
          <div class="cart-line-name">${item.name}</div>
          <div class="cart-line-sub">${money(item.price)} each &middot; ${money(item.price * qty)}</div>
        </div>
        <div class="qty">
          <button data-id="${id}" data-delta="-1" aria-label="Remove one ${item.name}">&minus;</button>
          <span>${qty}</span>
          <button data-id="${id}" data-delta="1" aria-label="Add one ${item.name}">+</button>
        </div>
      </div>`;
  }).join('');
}

el('cartList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-delta]');
  if (!btn) return;
  const id = btn.dataset.id;
  setQty(id, (state.cart.get(id) || 0) + Number(btn.dataset.delta));
});

function persist() {
  try {
    localStorage.setItem('es30.cart', JSON.stringify([...state.cart]));
  } catch { /* private browsing, carry on without saving */ }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem('es30.cart') || '[]');
    for (const [id, qty] of saved) {
      // stock may have moved since this cart was saved
      const left = state.items[id]?.available ?? 0;
      const keep = Math.min(qty, left);
      if (keep > 0) state.cart.set(id, keep);
    }
  } catch { /* nothing saved */ }
}

// The cart pill belongs to the menu screen only.
function onMenuScreen() {
  return document.querySelector('.splash').classList.contains('gone');
}

function updateCartBar() {
  const showing = cartCount() > 0 && onMenuScreen() && state.ordersOpen;
  el('cartBar').classList.toggle('show', showing);
  // Only hold room at the foot of the menu while the pill is there to clear.
  el('menu').classList.toggle('has-cart', showing);
}

// The Checkout button only takes its solid colour once the order has a name.
function updatePayState() {
  el('payBtn').classList.toggle('ready', el('name').value.trim().length > 0);
}

el('name').addEventListener('input', updatePayState);

/* ---------- sheet ---------- */

function openSheet() {
  el('sheet').classList.add('open');
  el('scrim').classList.add('open');
}

function closeSheet() {
  el('sheet').classList.remove('open');
  el('scrim').classList.remove('open');
}

el('cartBar').addEventListener('click', openSheet);
el('closeSheet').addEventListener('click', closeSheet);
el('scrim').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// Swap the opening screen out for the menu. The menu rises into place, so it
// still reads as moving down the card without leaving the splash behind it.
el('viewMenu').addEventListener('click', () => {
  document.querySelector('.splash').classList.add('gone');
  el('menu').classList.add('enter');
  el('scroller').scrollTop = 0;
  updateCartBar();
});

// Pull the current counts without redrawing the whole menu.
async function refreshAvailability() {
  try {
    await syncMenu();
  } catch { /* offline; leave the page as it is */ }
}

/* ---------- checkout ---------- */

/* ---------- paying, without leaving the cafe ----------
   Stripe draws its card form into the card itself. Stripe sends the customer
   to the order-number screen when the payment is done, so the only page that
   changes is the one at the end. */

let checkoutWidget;
let paySession;

async function openPayScreen(clientSecret, sessionId) {
  paySession = sessionId;
  const screen = el('payScreen');
  el('payTotal').textContent = `Total ${el('sheetTotal').textContent}`;

  const stripe = Stripe(state.stripeKey);
  checkoutWidget = await stripe.initEmbeddedCheckout({ clientSecret });

  screen.hidden = false;
  checkoutWidget.mount('#stripeMount');
}

// Leaving the payment screen destroys the form: Stripe only allows one mounted
// at a time, and the next attempt needs a fresh session anyway.
function closePayScreen() {
  if (checkoutWidget) {
    checkoutWidget.destroy();
    checkoutWidget = undefined;
  }

  // Hand the stock back straight away instead of leaving it held until the
  // session lapses. The server checks with Stripe before letting it go.
  if (paySession) {
    fetch('/api/checkout/abandon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: paySession })
    }).then(() => syncMenu()).catch(() => {});
    paySession = undefined;
  }
  el('payScreen').hidden = true;
  el('payBtn').disabled = false;
  el('payBtn').textContent = 'Checkout';
}

el('closePay').addEventListener('click', () => {
  closePayScreen();
  // The cart was cleared when the session opened; rebuild it from the order
  // that is still on screen so nothing is lost by backing out.
  renderCart();
});

el('checkoutForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = el('name').value.trim();
  const btn = el('payBtn');
  el('err').textContent = '';

  if (!name) {
    el('err').textContent = 'Please enter a name for the order.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Opening checkout';

  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        cart: [...state.cart].map(([id, qty]) => ({ id, qty }))
      })
    });
    const data = await res.json();
    if (!res.ok) {
      // Someone else may have taken the last one while this cart sat open.
      await refreshAvailability();
      throw new Error(data.error || 'Checkout failed.');
    }

    // The cart has been handed to Stripe. Clear it so a back button does not
    // leave a stale order sitting in the sheet.
    localStorage.removeItem('es30.cart');

    if (data.clientSecret) {
      await openPayScreen(data.clientSecret, data.sessionId);
      return;
    }
    window.location.href = data.url;
  } catch (err) {
    el('err').textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Checkout';
  }
});

buildRibbons();
loadMenu().then(() => { restore(); renderCart(); });
