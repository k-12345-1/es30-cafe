const el = (id) => document.getElementById(id);
const TOKEN_KEY = 'es30.staffToken';

let token = '';
let data = null;

const money = (cents) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (data?.currency || 'usd').toUpperCase()
  }).format(cents / 100);

const esc = (str) => String(str).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const auth = () => (token ? { Authorization: 'Bearer ' + token } : {});

function say(text, bad) {
  el('msg').textContent = text;
  el('msg').classList.toggle('bad', Boolean(bad));
}

/* ---------- getting in ----------
   The code box is only for signing in. Once the server accepts it, it is gone
   and the dashboard takes its place. */

async function load() {
  const res = await fetch('/api/admin', { headers: auth() });

  if (res.status === 401) {
    el('signin').hidden = false;
    el('dash').hidden = true;
    // With nothing else on the page, the code box sits in the middle of it.
    document.body.classList.add('signed-out');
    return false;
  }

  data = await res.json();
  document.body.classList.remove('signed-out');
  el('signin').hidden = true;
  el('dash').hidden = false;
  render();
  return true;
}

el('signin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const entered = el('token').value.trim();
  el('signinError').textContent = '';

  if (!entered) {
    el('signinError').textContent = 'Enter the staff code.';
    return;
  }

  token = entered;
  if (await load()) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private window */ }
  } else {
    token = '';
    el('signinError').textContent = 'That code was not accepted.';
  }
});

// The code is typed from a phone as often as a keyboard, so it can be checked
// before it is sent.
el('showCode').addEventListener('click', () => {
  const field = el('token');
  const showing = field.type === 'text';
  field.type = showing ? 'password' : 'text';
  el('showCode').setAttribute('aria-pressed', String(!showing));
  el('showCode').setAttribute('aria-label', showing ? 'Show the code' : 'Hide the code');
  field.focus();
});

/* ---------- drawing the dashboard ---------- */

function render() {
  showBreak();

  el('takingsToday').textContent = money(data.takings.today);
  el('takingsAll').textContent = money(data.takings.allTime);
  el('ordersToday').textContent = data.takings.ordersToday;
  el('ordersAll').textContent = data.takings.ordersAllTime;

  // Name, price and count are all editable in place; Save sends whatever
  // actually changed.
  el('stockList').innerHTML = data.items.map((item) => `
    <div class="stock-row" data-id="${item.id}">
      <span class="stock-fields">
        <span class="stock-cap">item</span>
        <input class="stock-input-name" type="text" name="name-${item.id}"
               value="${esc(item.name)}" aria-label="Name of this item">
        <span class="stock-where">${esc(item.section)}${item.group ? ' &middot; ' + esc(item.group) : ''} &middot; ${stockNote(item)}</span>
      </span>
      <span class="stock-money">
        <span class="stock-cap">price</span>
        <input class="stock-input-price" type="text" name="price-${item.id}" inputmode="decimal"
               value="${(item.price / 100).toFixed(2)}" aria-label="Price of ${esc(item.name)} in dollars">
      </span>
      <span class="stock-money">
        <span class="stock-cap">inventory</span>
        <input class="stock-input-qty" type="text" name="${item.id}" inputmode="numeric"
               value="${item.onHand}" aria-label="How many ${esc(item.name)}">
      </span>
      <span class="stock-money">
        <span class="stock-cap" aria-hidden="true">&nbsp;</span>
        <button type="button" class="remove" data-id="${item.id}"
                data-name="${esc(item.name)}" aria-label="Remove ${esc(item.name)}">&times;</button>
      </span>
    </div>`).join('');

  el('sectionList').innerHTML = data.sections
    .map((s) => `<option value="${esc(s.section)}"></option>`).join('');
  el('groupList').innerHTML = [...new Set(
    data.sections.flatMap((s) => s.groups.map((g) => g.title).filter(Boolean))
  )].map((t) => `<option value="${esc(t)}"></option>`).join('');

  const waiting = data.orders.filter((o) => !o.fulfilled).length;
  el('ordersNote').textContent = data.orders.length
    ? `${data.orders.length} order${data.orders.length === 1 ? '' : 's'}, newest first. ${waiting ? `${waiting} still to hand over.` : 'All handed over.'}`
    : 'No orders yet.';

  // One heading per day, with that day's takings beside it, so a sale can be
  // counted without adding the rows up by hand.
  const days = [];
  for (const order of data.orders) {
    const key = new Date(order.createdAt).toDateString();
    const day = days.find((d) => d.key === key);
    if (day) day.orders.push(order);
    else days.push({ key, orders: [order] });
  }

  el('orderList').innerHTML = days.map((day) => `
    <li class="day">
      <span class="day-name">${dayName(day.key)}</span>
      <span class="day-sum">${day.orders.length} order${day.orders.length === 1 ? '' : 's'} &middot; ${money(day.orders.reduce((sum, o) => sum + o.total, 0))}</span>
    </li>
    ${day.orders.map((order) => `
      <li class="order${order.fulfilled ? ' done' : ''}">
        <label class="tick">
          <input type="checkbox" data-order="${order.id}" ${order.fulfilled ? 'checked' : ''}
                 aria-label="Order ${order.orderNumber} handed over">
          <span class="tick-box" aria-hidden="true"></span>
        </label>
        <span class="list-main">
          <span class="order-who"><strong>#${order.orderNumber}</strong> ${esc(order.name)}</span>
          <span class="list-sub">${order.lines.map((l) => `${l.qty} &times; ${esc(l.name)}`).join(', ')}</span>
        </span>
        <span class="list-right">${money(order.total)}<br>${at(order.createdAt)}</span>
      </li>`).join('')}`).join('');

  const n = data.subscribers.length;
  el('entriesNote').textContent = n ? `${n} ${n === 1 ? 'entry' : 'entries'}, newest first.` : 'No entries yet.';
  el('entryList').innerHTML = data.subscribers.map((entry) => `
    <li>
      <span class="list-main">${esc(entry.email)}</span>
      <span class="list-right">${when(entry.addedAt)}</span>
    </li>`).join('');
}

// What a customer can actually add right now, and why it differs from the
// count on the shelf when it does.
function stockNote(item) {
  const held = item.onHand - item.available;
  if (held > 0) {
    return `${item.available} on sale, ${held} held by checkouts in progress`;
  }
  return `${item.available} on sale`;
}

// Today and yesterday by name; anything older by its date.
function dayName(key) {
  const date = new Date(key);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

// Inside a day the date is already on the heading, so the row carries the time.
function at(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function when(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* ---------- the break clock ---------- */

let breakTimer;

function showBreak() {
  clearInterval(breakTimer);
  const left = el('breakLeft');
  const stop = el('stopBreak');
  const start = el('startBreak');
  const endsAt = data.breakEndsAt;

  if (!endsAt) {
    left.textContent = 'not running';
    stop.hidden = true;
    start.textContent = `Start ${data.breakMinutes} minutes`;
    return;
  }

  const offset = data.now - Date.now();
  const paint = () => {
    const ms = Math.max(0, endsAt - (Date.now() + offset));
    const total = Math.ceil(ms / 1000);
    left.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} left`;
    if (ms === 0) {
      clearInterval(breakTimer);
      // The customers' menu is showing the closed sign until this is cleared.
      left.textContent = 'ended: the menu says closed';
      stop.textContent = 'Clear';
      stop.hidden = false;
      start.textContent = `Start ${data.breakMinutes} minutes`;
    }
  };

  stop.hidden = false;
  stop.textContent = 'Stop';
  start.textContent = 'Restart';
  paint();
  breakTimer = setInterval(paint, 1000);
}

el('startBreak').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/break', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ minutes: data.breakMinutes })
    });
    if (!res.ok) throw new Error('Could not start the break.');
    await load();
    say('Break started');
  } catch (err) { say(err.message, true); }
});

el('stopBreak').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/break', { method: 'DELETE', headers: auth() });
    if (!res.ok) throw new Error('Could not stop the break.');
    await load();
    say('Break stopped');
  } catch (err) { say(err.message, true); }
});

/* ---------- handing orders over ----------
   The tick is saved as it is clicked, so two people working the counter see
   the same list. */

el('orderList').addEventListener('change', async (e) => {
  const box = e.target.closest('input[type="checkbox"][data-order]');
  if (!box) return;

  const row = box.closest('li');
  const fulfilled = box.checked;
  row.classList.toggle('done', fulfilled);

  try {
    const res = await fetch(`/api/orders/${box.dataset.order}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ fulfilled })
    });
    if (!res.ok) throw new Error('Could not save that.');

    const order = data.orders.find((o) => o.id === box.dataset.order);
    if (order) order.fulfilled = fulfilled;
    const waiting = data.orders.filter((o) => !o.fulfilled).length;
    el('ordersNote').textContent =
      `${data.orders.length} order${data.orders.length === 1 ? '' : 's'}, newest first. ${waiting ? `${waiting} still to hand over.` : 'All handed over.'}`;
  } catch (err) {
    // Put it back the way it was rather than showing a tick that did not save.
    box.checked = !fulfilled;
    row.classList.toggle('done', !fulfilled);
    say(err.message, true);
  }
});

/* ---------- stock ---------- */

el('stockForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const counts = {};
  const edits = [];

  for (const row of el('stockList').querySelectorAll('.stock-row')) {
    const id = row.dataset.id;
    const was = data.items.find((i) => i.id === id);
    if (!was) continue;

    counts[id] = Number(row.querySelector('.stock-input-qty').value);

    const name = row.querySelector('.stock-input-name').value.trim();
    const price = Number(row.querySelector('.stock-input-price').value);
    const change = {};
    if (name && name !== was.name) change.name = name;
    if (Number.isFinite(price) && Math.round(price * 100) !== was.price) change.price = price;
    if (Object.keys(change).length) edits.push([id, change]);
  }

  el('saveBtn').disabled = true;
  say('Saving');
  try {
    // Names and prices first, so a rename and a new count land together.
    for (const [id, change] of edits) {
      const res = await fetch(`/api/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify(change)
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not save that item.');
    }

    const res = await fetch('/api/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ counts })
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not save.');
    await load();
    say('Saved');
  } catch (err) {
    say(err.message, true);
  } finally {
    el('saveBtn').disabled = false;
  }
});

/* ---------- adding and removing menu items ---------- */

el('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('addError').textContent = '';

  const name = el('newName').value.trim();
  const price = el('newPrice').value.trim();
  const section = el('newSection').value.trim();

  if (!name) return fail('Give the item a name.');
  if (!price || Number.isNaN(Number(price))) return fail('Price needs to be a number, like 3 or 3.50.');
  if (!section) return fail('Say which section it belongs in.');

  el('addBtn').disabled = true;
  try {
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({
        name,
        price: Number(price),
        section,
        group: el('newGroup').value.trim(),
        desc: el('newDesc').value.trim(),
        stock: Number(el('newStock').value.trim() || 0)
      })
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not add that.');

    for (const id of ['newName', 'newPrice', 'newStock', 'newDesc']) el(id).value = '';
    await load();
    say(`${name} added to the menu`);
  } catch (err) {
    fail(err.message);
  } finally {
    el('addBtn').disabled = false;
  }

  function fail(message) {
    el('addError').textContent = message;
    el('addBtn').disabled = false;
  }
});

el('stockList').addEventListener('click', async (e) => {
  const btn = e.target.closest('.remove');
  if (!btn) return;

  const name = btn.dataset.name;
  if (!window.confirm(`Remove ${name} from the menu? Past orders keep it.`)) return;

  try {
    const res = await fetch('/api/items/' + encodeURIComponent(btn.dataset.id), {
      method: 'DELETE',
      headers: auth()
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not remove that.');
    await load();
    say(`${name} removed`);
  } catch (err) {
    say(err.message, true);
  }
});

/* ---------- entries ---------- */

el('copyBtn').addEventListener('click', async () => {
  if (!data?.subscribers.length) return;
  const text = data.subscribers.map((entry) => entry.email).join(', ');
  try {
    await navigator.clipboard.writeText(text);
    el('copyBtn').textContent = 'Copied';
  } catch {
    window.prompt('Copy the addresses:', text);
  }
  setTimeout(() => { el('copyBtn').textContent = 'Copy all'; }, 1600);
});

/* ---------- start ---------- */

try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* private window */ }
load().then((ok) => { if (!ok) token = ''; });
