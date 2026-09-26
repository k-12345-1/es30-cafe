const state = { cart: new Map(), items: {}, currency: 'usd', demo: false };

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
   A long item name eats the row, leaving a stub of dots that reads as a typo
   rather than a leader. Measure each row and step the name down just far
   enough to leave a real run of dots, holding a floor so nothing turns tiny.
   Below that floor the name is allowed to wrap, as it did before. */

const LEADER_MIN = 44;
const NAME_FLOOR = 12;

function fitLeaders() {
  for (const main of document.querySelectorAll('.row-main')) {
    const name = main.querySelector('.row-name');
    const leader = main.querySelector('.leader');
    if (!name || !leader) continue;

    name.style.fontSize = '';
    name.style.whiteSpace = 'nowrap';

    const base = parseFloat(getComputedStyle(name).fontSize);
    const natural = name.scrollWidth;
    const room = name.getBoundingClientRect().width + leader.getBoundingClientRect().width;
    if (!natural || !room) continue;

    const scale = (room - LEADER_MIN) / natural;
    if (scale >= 1) continue;

    const size = base * scale;
    if (size < NAME_FLOOR) {
      // Not enough room at a readable size: take the floor and let it wrap.
      name.style.fontSize = NAME_FLOOR + 'px';
      name.style.whiteSpace = '';
    } else {
      name.style.fontSize = size.toFixed(2) + 'px';
    }
  }
}

let fitPending;
window.addEventListener('resize', () => {
  clearTimeout(fitPending);
  fitPending = setTimeout(fitLeaders, 120);
});

/* ---------- menu ---------- */

async function loadMenu() {
  const res = await fetch('/api/menu');
  const data = await res.json();

  state.currency = data.currency;
  state.demo = data.demo;

  state.items = Object.fromEntries(
    data.menu.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => [i.id, i])))
  );

  el('menuBody').innerHTML = data.menu.map((section) => `
    <h2 class="section-title">${section.section}</h2>
    ${section.groups.map((group) => `
      ${group.title ? `<h3 class="group-title">${group.title}</h3>` : ''}
      ${group.items.map((item) => `
        <div class="row">
          <div class="row-line">
            <div class="row-main">
              <p class="row-name">${item.name}</p>
              <span class="leader" aria-hidden="true"></span>
              <span class="row-price">${money(item.price)}</span>
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

  el('menuBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-delta]');
    if (!btn) return;
    const id = btn.closest('.row-ctl').dataset.id;
    setQty(id, (state.cart.get(id) || 0) + Number(btn.dataset.delta));
  });
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

    // key includes the limit so a row redraws when stock changes under it
    const key = `${qty}/${left}`;
    if (ctl.dataset.key === key) continue;
    const isNew = qty > 0 && (ctl.dataset.key || '').startsWith('0/');
    ctl.dataset.key = key;

    if (left <= 0 && qty === 0) {
      ctl.innerHTML = '<span class="sold-out">sold out</span>';
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
    else if (left > 0 && left < 10) note = `only ${left} left`;

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
  const showing = cartCount() > 0 && onMenuScreen();
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
    const res = await fetch('/api/menu');
    if (!res.ok) return;
    const data = await res.json();
    for (const section of data.menu) {
      for (const group of section.groups) {
        for (const item of group.items) {
          if (state.items[item.id]) state.items[item.id].available = item.available;
        }
      }
    }
    for (const [id, qty] of [...state.cart]) {
      const left = state.items[id]?.available ?? 0;
      if (qty > left) {
        if (left > 0) state.cart.set(id, left);
        else state.cart.delete(id);
      }
    }
    persist();
    renderCart();
  } catch { /* offline; leave the page as it is */ }
}

/* ---------- checkout ---------- */

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
    window.location.href = data.url;
  } catch (err) {
    el('err').textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Checkout';
  }
});

buildRibbons();
loadMenu().then(() => { restore(); renderCart(); });
