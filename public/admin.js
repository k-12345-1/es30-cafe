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
    return false;
  }

  data = await res.json();
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

/* ---------- drawing the dashboard ---------- */

function render() {
  el('takingsToday').textContent = money(data.takings.today);
  el('takingsAll').textContent = money(data.takings.allTime);
  el('ordersToday').textContent = data.takings.ordersToday;
  el('ordersAll').textContent = data.takings.ordersAllTime;

  // Name, price and count are all editable in place; Save sends whatever
  // actually changed.
  el('stockList').innerHTML = data.items.map((item) => `
    <div class="stock-row" data-id="${item.id}">
      <span class="stock-fields">
        <input class="stock-input-name" type="text" name="name-${item.id}"
               value="${esc(item.name)}" aria-label="Name of this item">
        <span class="stock-where">${esc(item.section)}${item.group ? ' &middot; ' + esc(item.group) : ''} &middot; ${item.available} on sale</span>
      </span>
      <span class="stock-money">
        <span class="stock-cap">price</span>
        <input class="stock-input-price" type="text" name="price-${item.id}" inputmode="decimal"
               value="${(item.price / 100).toFixed(2)}" aria-label="Price of ${esc(item.name)} in dollars">
      </span>
      <span class="stock-money">
        <span class="stock-cap">have</span>
        <input class="stock-input-qty" type="text" name="${item.id}" inputmode="numeric"
               value="${item.onHand}" aria-label="How many ${esc(item.name)}">
      </span>
      <button type="button" class="remove" data-id="${item.id}"
              data-name="${esc(item.name)}" aria-label="Remove ${esc(item.name)}">&times;</button>
    </div>`).join('');

  el('sectionList').innerHTML = data.sections
    .map((s) => `<option value="${esc(s.section)}"></option>`).join('');
  el('groupList').innerHTML = [...new Set(
    data.sections.flatMap((s) => s.groups.map((g) => g.title).filter(Boolean))
  )].map((t) => `<option value="${esc(t)}"></option>`).join('');

  el('ordersNote').textContent = data.orders.length
    ? `${data.orders.length} order${data.orders.length === 1 ? '' : 's'}, newest first.`
    : 'No orders yet.';

  el('orderList').innerHTML = data.orders.map((order) => `
    <li>
      <span class="list-main">
        <strong>#${order.orderNumber}</strong> ${esc(order.name)}
        <span class="list-sub">${order.lines.map((l) => `${l.qty} &times; ${esc(l.name)}`).join(', ')}</span>
      </span>
      <span class="list-right">${money(order.total)}<br>${when(order.createdAt)}</span>
    </li>`).join('');

  const n = data.subscribers.length;
  el('entriesNote').textContent = n ? `${n} ${n === 1 ? 'entry' : 'entries'}, newest first.` : 'No entries yet.';
  el('entryList').innerHTML = data.subscribers.map((entry) => `
    <li>
      <span class="list-main">${esc(entry.email)}</span>
      <span class="list-right">${when(entry.addedAt)}</span>
    </li>`).join('');
}

function when(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

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
