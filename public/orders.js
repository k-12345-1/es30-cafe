/* The counter's page: the orders, and a box to tick when one is handed over.
   Nothing else about the cafe is here, and the code that opens it is not the
   staff code. */

const el = (id) => document.getElementById(id);
const TOKEN_KEY = 'es30.counterToken';

let token = '';
let data = null;

const esc = (str) => String(str).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const auth = () => (token ? { Authorization: 'Bearer ' + token } : {});

function say(text, bad) {
  el('msg').textContent = text;
  el('msg').classList.toggle('bad', Boolean(bad));
}

/* ---------- getting in ---------- */

async function load() {
  const res = await fetch('/api/counter', { headers: auth() });

  if (res.status === 401) {
    el('signin').hidden = false;
    el('dash').hidden = true;
    document.body.classList.add('signed-out');
    return false;
  }

  data = await res.json();
  document.body.classList.remove('signed-out');
  el('signin').hidden = true;
  el('dash').hidden = false;
  render();
  watchForChanges();
  return true;
}

el('signin').addEventListener('submit', async (event) => {
  event.preventDefault();
  const entered = el('token').value.trim();
  el('signinError').textContent = '';

  if (!entered) {
    el('signinError').textContent = 'Enter the code.';
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

el('showCode').addEventListener('click', () => {
  const field = el('token');
  const showing = field.type === 'text';
  field.type = showing ? 'password' : 'text';
  el('showCode').setAttribute('aria-pressed', String(!showing));
  field.focus();
});

/* ---------- the list ---------- */

function dayName(key) {
  const date = new Date(key);
  const month = date.toLocaleDateString(undefined, { month: 'long' });
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
  return `${month}, ${weekday} ${date.getDate()}`;
}

const at = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

function render() {
  const waiting = data.orders.filter((o) => !o.fulfilled).length;
  el('ordersNote').textContent = data.orders.length
    ? `${data.orders.length} order${data.orders.length === 1 ? '' : 's'}, newest first. ` +
      `${waiting ? `${waiting} still to hand over.` : 'All handed over.'}`
    : 'No orders yet.';

  // A heading for each day, as on the staff page.
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
      <span class="day-sum">${day.orders.length} order${day.orders.length === 1 ? '' : 's'}</span>
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
        <span class="list-right"><span class="order-when">${at(order.createdAt)}</span></span>
      </li>`).join('')}`).join('');
}

el('orderList').addEventListener('change', async (event) => {
  const box = event.target.closest('input[type="checkbox"][data-order]');
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
    say(fulfilled ? `Order ${row.querySelector('strong').textContent} handed over` : '');
  } catch (err) {
    box.checked = !fulfilled;
    row.classList.toggle('done', !fulfilled);
    say(err.message, true);
  }
});

/* ---------- keeping it current ----------
   Orders arrive while the page is open, so the server's stream brings them in
   rather than anyone reaching for refresh. */

const POLL_MS = 15_000;

let stream;
let watching = false;

function showLive(on) {
  const dot = el('liveDot');
  if (!dot) return;
  dot.textContent = on ? 'updating live' : 'reconnecting…';
  dot.classList.toggle('off', !on);
}

function connect() {
  if (stream) return;
  try {
    stream = new EventSource('/api/events');
    stream.addEventListener('menu', () => load().catch(() => {}));
    stream.addEventListener('open', () => showLive(true));
    stream.onerror = () => {
      showLive(false);
      if (stream && stream.readyState === EventSource.CLOSED) {
        stream = null;
        setTimeout(connect, 3_000);
      }
    };
  } catch {
    showLive(false);
  }
}

function watchForChanges() {
  connect();
  if (watching) return;
  watching = true;

  setInterval(() => {
    if (document.visibilityState === 'visible') load().catch(() => {});
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    connect();
    load().catch(() => {});
  });
  window.addEventListener('focus', () => load().catch(() => {}));
  window.addEventListener('pageshow', () => { connect(); load().catch(() => {}); });
}

/* ---------- start ---------- */

try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* private window */ }
load().then((ok) => { if (!ok) token = ''; });
