const el = (id) => document.getElementById(id);
const TOKEN_KEY = 'es30.staffToken';

let token = '';
let data = null;

const money = (cents) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (data?.currency || 'usd').toUpperCase()
  }).format(cents / 100);

// One order is an order, not 1 orders.
const plural = (n) => (n === 1 ? 'order' : 'orders');

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
  watchForChanges();
  return true;
}

/* ---------- keeping the page current ----------
   Orders arrive while the page is open, so the server's stream brings them in
   rather than the counter staff reaching for refresh. A redraw while someone
   is mid-edit would take their typing with it, so it waits for the field. */

const POLL_MS = 15_000;

let stream;
let redrawWanted = false;

const midEdit = () => {
  const here = document.activeElement;
  return Boolean(here && (here.tagName === 'INPUT' || here.tagName === 'TEXTAREA'));
};

let retry;

async function refresh() {
  if (midEdit()) {
    // Come back for it: leaving the field is the usual cue, but a phone that
    // never fires one still gets the new orders a moment later.
    redrawWanted = true;
    clearTimeout(retry);
    retry = setTimeout(refresh, 3_000);
    return;
  }
  redrawWanted = false;
  clearTimeout(retry);
  try { await load(); } catch { /* the next event or the poll will do it */ }
}

document.addEventListener('focusout', () => {
  if (redrawWanted) setTimeout(refresh, 250);
});

let watching = false;

// The stream itself. A phone that sleeps, a tunnel, a Render restart: any of
// them can drop it, so a closed stream is opened again rather than left dead.
function connect() {
  if (stream) return;
  try {
    stream = new EventSource('/api/events');
    stream.addEventListener('menu', refresh);
    stream.addEventListener('open', () => showLive(true));
    stream.onerror = () => {
      showLive(false);
      if (stream && stream.readyState === EventSource.CLOSED) {
        stream = null;
        setTimeout(connect, 3_000);
      }
    };
  } catch {
    showLive(false);                       // the poll below carries it alone
  }
}

function showLive(on) {
  const dot = el('liveDot');
  if (!dot) return;
  dot.textContent = on ? 'updating live' : 'reconnecting…';
  dot.classList.toggle('off', !on);
}

function watchForChanges() {
  connect();
  if (watching) return;                    // the listeners go on once
  watching = true;

  // Backstops, in order of how often they save the day: coming back to the
  // page, a poll while it is open, and the browser restoring it from its cache.
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    connect();
    refresh();
  });
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', () => { connect(); refresh(); });
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

  showSupplies();

  el('takingsToday').textContent = money(data.takings.today);
  el('takingsAll').textContent = money(data.takings.allTime);
  el('ordersToday').textContent = data.takings.ordersToday;
  el('ordersAll').textContent = data.takings.ordersAllTime;
  el('ordersTodayWord').textContent = plural(data.takings.ordersToday);
  el('ordersAllWord').textContent = plural(data.takings.ordersAllTime);

  // Name, price and count are all editable in place; Save sends whatever
  // actually changed.
  el('stockList').innerHTML = data.items.map((item) => `
    <div class="stock-row" data-id="${item.id}">
      <span class="stock-fields">
        <span class="stock-cap">item</span>
        <input class="stock-input-name" type="text" name="name-${item.id}"
               value="${esc(item.name)}" aria-label="Name of this item">
        <span class="stock-where">${esc(item.section)}${item.group ? ' &middot; ' + esc(item.group) : ''} &middot; ${stockNote(item)}</span>
        <span class="stock-cap stock-cap-desc">description</span>
        <input class="stock-input-desc" type="text" name="desc-${item.id}" maxlength="240"
               value="${esc(item.desc || '')}" placeholder="Optional line under the name"
               aria-label="Description of ${esc(item.name)}">
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
        <span class="stock-tools">
          <button type="button" class="nudge" data-move="up" data-id="${item.id}"
                  aria-label="Move ${esc(item.name)} up">&uarr;</button>
          <button type="button" class="nudge" data-move="down" data-id="${item.id}"
                  aria-label="Move ${esc(item.name)} down">&darr;</button>
          <button type="button" class="remove" data-id="${item.id}"
                  data-name="${esc(item.name)}" aria-label="Remove ${esc(item.name)}">&times;</button>
        </span>
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
        <span class="list-right">
          <span class="order-when">${money(order.total)}<br>${at(order.createdAt)}</span>
          <button type="button" class="remove" data-drop="${order.id}"
                  data-number="${order.orderNumber}"
                  aria-label="Delete order ${order.orderNumber}">&times;</button>
        </span>
      </li>`).join('')}`).join('');

  showMax();
  showIdeas();

  const n = data.subscribers.length;
  el('entriesNote').textContent = n ? `${n} ${n === 1 ? 'entry' : 'entries'}, newest first.` : 'No entries yet.';
  el('entryList').innerHTML = data.subscribers.map((entry) => `
    <li>
      <span class="list-main">${esc(entry.email)}</span>
      <span class="list-right">
        ${when(entry.addedAt)}
        <button type="button" class="remove" data-entry="${esc(entry.email)}"
                aria-label="Remove ${esc(entry.email)}">&times;</button>
      </span>
    </li>`).join('');
  el('clearEntries').hidden = !n;
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

// Every day carries its date, today included: a list read a week later says
// when each order was taken without any counting back.
function dayName(key) {
  const date = new Date(key);
  const month = date.toLocaleDateString(undefined, { month: 'long' });
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
  return `${month}, ${weekday} ${date.getDate()}`;
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

/* ---------- supplies, and what is left over ----------
   Takings are not profit until the week's receipts come off them. The week
   runs Monday to Sunday, the same week the server files a cost under. */

// The ledger keeps plain YYYY-MM-DD days, unlike the order list above.
const shortDay = (day) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined,
    { weekday: 'short', month: 'short', day: 'numeric' });

function showSupplies() {
  const takings = data.takings.week || 0;
  const spent = data.supplies.week || 0;
  const profit = takings - spent;

  el('weekTakings').textContent = money(takings);
  el('weekOrders').textContent = data.takings.ordersWeek || 0;
  el('weekOrdersWord').textContent = plural(data.takings.ordersWeek || 0);
  el('weekSpent').textContent = money(spent);
  el('weekProfit').textContent = money(profit);
  el('weekProfit').classList.toggle('down', profit < 0);
  el('weekNote').textContent = `Week of ${shortDay(data.supplies.weekStart)}.`;

  const allProfit = data.takings.allTime - data.supplies.allTime;
  el('allTimeNote').textContent =
    `All time: ${money(data.takings.allTime)} taken, ${money(data.supplies.allTime)} spent, ` +
    `${money(allProfit)} profit.`;

  const entries = data.supplies.entries;
  el('supplyList').innerHTML = entries.length
    ? entries.map((e) => `
      <li>
        <span class="list-main">
          <span>${esc(e.what)}</span>
          <span class="list-sub">${shortDay(e.day)}</span>
        </span>
        <span class="list-right">
          ${money(e.cents)}
          <button type="button" class="remove" data-supply="${e.id}"
                  aria-label="Remove ${esc(e.what)}">&times;</button>
        </span>
      </li>`).join('')
    : '<li><span class="list-main">Nothing bought yet.</span></li>';

  // The date box starts on today, so a receipt typed in at the counter needs
  // one field filled, not three.
  const day = el('supplyDay');
  if (!day.value) day.value = new Date().toLocaleDateString('en-CA');
}

el('supplyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const what = el('supplyWhat').value.trim();
  const amount = Number(el('supplyAmount').value);
  const day = el('supplyDay').value;
  const problem = el('supplyError');

  if (!what) return (problem.textContent = 'Say what you bought.');
  if (!Number.isFinite(amount) || amount <= 0) {
    return (problem.textContent = 'Put the cost in, like 48.75.');
  }
  problem.textContent = '';

  try {
    const res = await fetch('/api/supplies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ what, amount, day })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Could not save that.');
    el('supplyWhat').value = '';
    el('supplyAmount').value = '';
    await load();
    say('Cost added');
  } catch (err) { problem.textContent = err.message; }
});

el('supplyList').addEventListener('click', async (event) => {
  const id = event.target.closest('[data-supply]')?.dataset.supply;
  if (!id) return;
  try {
    const res = await fetch('/api/supplies/' + encodeURIComponent(id), {
      method: 'DELETE', headers: auth()
    });
    if (!res.ok) throw new Error('Could not remove that.');
    await load();
    say('Cost removed');
  } catch (err) { say(err.message, true); }
});

/* ---------- the break clock ---------- */

let breakTimer;

function clockTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// What the schedule does on its own, and whether the till is open right now.
function showBreak() {

  clearInterval(breakTimer);
  const left = el('breakLeft');
  const stop = el('stopBreak');
  const start = el('startBreak');
  const hour = el('startHour');
  const endsAt = data.breakEndsAt;
  const offset = data.now - Date.now();
  const mss = (ms) => {
    const total = Math.ceil(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  // The hour can be started by hand any day; there is nothing to start while
  // the ten minutes are running.
  hour.hidden = data.clock?.mode === 'closing';
  hour.textContent = data.clock?.mode === 'opening'
    ? 'Restart the hour and 15 minutes'
    : 'Start the hour and 15 minutes';

  // Once the till is shut there is nothing left to count, even if the ten
  // minutes had time on them when stop was pressed.
  if (data.stopped) {
    left.textContent = 'closed';
    start.textContent = `Start ${data.breakMinutes} minutes`;
    stop.hidden = true;
    return;
  }

  if (!endsAt) {
    start.textContent = `Start ${data.breakMinutes} minutes`;
    stop.textContent = 'Stop taking orders';
    stop.hidden = !data.ordersOpen;         // the till can be shut before the break
    const target = data.clock?.mode === 'opening' ? data.clock.target : null;

    if (!target) {
      left.textContent = data.ordersOpen ? 'taking orders' : 'not running';
      return;
    }

    const tick = () => {
      const ms = Math.max(0, target - (Date.now() + offset));
      left.textContent = `opens in ${mss(ms)}`;
      if (ms === 0) { clearInterval(breakTimer); load(); }
    };
    tick();
    breakTimer = setInterval(tick, 1000);
    return;
  }

  const paint = () => {
    const ms = Math.max(0, endsAt - (Date.now() + offset));
    left.textContent = `${mss(ms)} left`;
    if (ms === 0) {
      clearInterval(breakTimer);
      left.textContent = data.ordersOpen ? 'ended: still serving' : 'closed';
      stop.textContent = 'Stop taking orders';
      stop.hidden = !data.ordersOpen;
      start.textContent = `Start ${data.breakMinutes} minutes`;
    }
  };

  stop.hidden = false;
  stop.textContent = 'Stop taking orders';
  start.textContent = 'Restart';
  paint();
  breakTimer = setInterval(paint, 1000);
}

el('startHour').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/countdown', { method: 'POST', headers: auth() });
    if (!res.ok) throw new Error('Could not start the hour.');
    await load();
    say('Hour started');
  } catch (err) { say(err.message, true); }
});

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

// Removing an order: a test run of your own, or one rung up twice. It is asked
// for first, because the record cannot be brought back.
el('orderList').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-drop]');
  if (!button) return;

  const number = button.dataset.number;
  if (!confirm(`Delete order #${number}? This cannot be undone.`)) return;

  try {
    const res = await fetch('/api/orders/' + encodeURIComponent(button.dataset.drop), {
      method: 'DELETE', headers: auth()
    });
    if (!res.ok) throw new Error('Could not delete that order.');
    await load();
    say(`Order #${number} deleted`);
  } catch (err) { say(err.message, true); }
});

// Moving an item up or down its group. Saved the moment it is pressed, so the
// arrows need no visit to Save.
el('stockList').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-move]');
  if (!button) return;

  try {
    const res = await fetch(`/api/items/${encodeURIComponent(button.dataset.id)}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ direction: button.dataset.move })
    });
    if (!res.ok) throw new Error('Could not move that.');
    await load();
    say('Order changed');
  } catch (err) { say(err.message, true); }
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

    // Only counts you actually changed are sent. Sending every box would undo
    // any sale made while this page was open: the shelf would go back up to
    // the number shown here before the order came in.
    const qty = Number(row.querySelector('.stock-input-qty').value);
    if (Number.isFinite(qty) && qty !== was.onHand) counts[id] = qty;

    const name = row.querySelector('.stock-input-name').value.trim();
    const price = Number(row.querySelector('.stock-input-price').value);
    const change = {};
    const desc = row.querySelector('.stock-input-desc').value.trim();
    if (name && name !== was.name) change.name = name;
    if (Number.isFinite(price) && Math.round(price * 100) !== was.price) change.price = price;
    if (desc !== (was.desc || '')) change.desc = desc;
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

    if (Object.keys(counts).length) {
      const res = await fetch('/api/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ counts })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not save.');
    }
    await load();
    say(edits.length || Object.keys(counts).length ? 'Saved' : 'Nothing to save');
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

/* ---------- who wants WaiTER MAX ----------
   Signing up is a name on a list; the $50 is taken at the counter, so this is
   who to collect from and hand the free bottle and pack to. */

function showMax() {
  const list = data.waiterMax || [];

  el('maxNote').textContent = list.length
    ? `${list.length} sign-up${list.length === 1 ? '' : 's'}, newest first. ` +
      `$${list.length * 50} to collect.`
    : 'Nobody has signed up yet.';
  el('clearMax').hidden = !list.length;

  el('maxList').innerHTML = list.map((e) => `
    <li>
      <span class="list-main">
        <span>${esc(e.name)}</span>
        <span class="list-sub">from order #${e.orderNumber} &middot; ${when(e.addedAt)}</span>
      </span>
      <span class="list-right">
        <button type="button" class="remove" data-max="${e.id}"
                aria-label="Remove ${esc(e.name)}">&times;</button>
      </span>
    </li>`).join('');
}

async function dropMax(id) {
  const res = await fetch('/api/waiter-max' + (id ? '?id=' + encodeURIComponent(id) : ''), {
    method: 'DELETE', headers: auth()
  });
  if (!res.ok) throw new Error('Could not remove that.');
  await load();
}

el('maxList').addEventListener('click', async (event) => {
  const id = event.target.closest('[data-max]')?.dataset.max;
  if (!id) return;
  try {
    await dropMax(id);
    say('Sign-up removed');
  } catch (err) { say(err.message, true); }
});

el('clearMax').addEventListener('click', async () => {
  const n = data?.waiterMax?.length || 0;
  if (!n) return;
  if (!confirm(`Delete all ${n} sign-up${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
  try {
    await dropMax('');
    say('Sign-ups cleared');
  } catch (err) { say(err.message, true); }
});

/* ---------- what people asked us to stock ---------- */

function showIdeas() {
  const ideas = data.suggestions || [];
  const asked = ideas.reduce((sum, e) => sum + (e.votes || 1), 0);

  el('ideasNote').textContent = ideas.length
    ? `${ideas.length} suggestion${ideas.length === 1 ? '' : 's'}, most asked for first. ` +
      `${asked} ask${asked === 1 ? '' : 's'} in all.`
    : 'No suggestions yet.';
  el('clearIdeas').hidden = !ideas.length;

  el('ideaList').innerHTML = ideas.map((e) => `
    <li>
      <span class="list-main">
        <span>${esc(e.idea)}</span>
        <span class="list-sub">${(e.votes || 1) > 1 ? `asked for ${e.votes} times &middot; ` : ''}${when(e.lastAt || e.addedAt)}</span>
      </span>
      <span class="list-right">
        <button type="button" class="remove" data-idea="${e.id}"
                aria-label="Remove ${esc(e.idea)}">&times;</button>
      </span>
    </li>`).join('');
}

async function dropIdeas(id) {
  const res = await fetch('/api/suggestions' + (id ? '?id=' + encodeURIComponent(id) : ''), {
    method: 'DELETE', headers: auth()
  });
  if (!res.ok) throw new Error('Could not remove that.');
  await load();
}

el('ideaList').addEventListener('click', async (event) => {
  const id = event.target.closest('[data-idea]')?.dataset.idea;
  if (!id) return;
  try {
    await dropIdeas(id);
    say('Suggestion removed');
  } catch (err) { say(err.message, true); }
});

el('clearIdeas').addEventListener('click', async () => {
  const n = data?.suggestions?.length || 0;
  if (!n) return;
  if (!confirm(`Delete all ${n} suggestion${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
  try {
    await dropIdeas('');
    say('Suggestions cleared');
  } catch (err) { say(err.message, true); }
});

async function dropEntries(email) {
  const res = await fetch('/api/subscribers' + (email ? '?email=' + encodeURIComponent(email) : ''), {
    method: 'DELETE', headers: auth()
  });
  if (!res.ok) throw new Error('Could not remove that.');
  await load();
}

el('entryList').addEventListener('click', async (event) => {
  const email = event.target.closest('[data-entry]')?.dataset.entry;
  if (!email) return;
  try {
    await dropEntries(email);
    say('Address removed');
  } catch (err) { say(err.message, true); }
});

el('clearEntries').addEventListener('click', async () => {
  const n = data?.subscribers.length || 0;
  if (!n) return;
  if (!confirm(`Delete all ${n} address${n === 1 ? '' : 'es'}? This cannot be undone.`)) return;
  try {
    await dropEntries('');
    say('Giveaway list cleared');
  } catch (err) { say(err.message, true); }
});

/* ---------- start ---------- */

try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* private window */ }
load().then((ok) => { if (!ok) token = ''; });
