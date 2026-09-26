import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import Stripe from 'stripe';
import { MENU as SEED_MENU, SITE } from './menu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 4242);
// Render sets RENDER_EXTERNAL_URL to the live address of the service, so a
// deploy there needs no PUBLIC_URL of its own for Stripe to return the
// customer to the right place.
const PUBLIC_URL =
  process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const CURRENCY = (process.env.CURRENCY || 'usd').toLowerCase();
const SECRET = process.env.STRIPE_SECRET_KEY;
// The publishable key is safe in the page: it is what Stripe.js needs to draw
// the card form inside the cafe. With it set, checkout happens on the order
// screen; without it, Stripe's own hosted page is used instead.
const PUBLISHABLE = process.env.STRIPE_PUBLISHABLE_KEY || '';
// Trimmed: a dashboard field can pick up a trailing newline or space when the
// code is pasted, and a staff member has no way to see why the code they typed
// correctly is being refused.
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim();

// How long an unpaid checkout holds its items before the stock goes back on sale.
const RESERVE_MINUTES = 30;

// Demo mode lets the whole flow run before Stripe keys exist.
const DEMO = !SECRET || SECRET === 'sk_test_replace_me';
const stripe = DEMO ? null : new Stripe(SECRET);

// On a host with a mounted disk, point DATA_DIR at it so the menu, stock,
// orders and entries survive restarts and deploys.
const DATA_DIR = process.env.DATA_DIR || __dirname;

const MENU_FILE = path.join(DATA_DIR, 'menu.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const STOCK_FILE = path.join(DATA_DIR, 'stock.json');
const EMAILS_FILE = path.join(DATA_DIR, 'subscribers.json');
const BREAK_FILE = path.join(DATA_DIR, 'break.json');

/* ---------- when the cafe is open ----------
   ES30 meets on Wednesdays, so the cafe opens by itself at noon Eastern and
   runs for ten minutes. Orders keep going through for five minutes after the
   clock runs out, for the person who was already at the counter, and then the
   till closes. The server runs on the cafe's timezone (TZ in the blueprint),
   so these are wall-clock times here. */

const BREAK_MINUTES = 10;
const OPENS_LEAD_MINUTES = 60;
// If the till is never closed by hand, it closes itself this long after the
// break ends rather than selling all afternoon.
const SERVING_LIMIT_MINUTES = 60;

const OPEN_WEEKDAY = Number(process.env.OPEN_WEEKDAY ?? 3);   // 0 Sunday … 3 Wednesday
const [OPEN_HOUR, OPEN_MINUTE] = (process.env.OPEN_TIME || '12:00').split(':').map(Number);

// The scheduled break either side of a moment: the last one to have started,
// and the next one due.
/* The weekly cycle: at the scheduled hour the countdown to opening begins and
   runs for OPENS_LEAD_MINUTES. When it reaches zero the cafe is about to open
   and the menu says so; the break itself starts when staff press the button,
   not before. */

function cycle(at) {
  const countdownFrom = new Date(at);
  countdownFrom.setHours(OPEN_HOUR, OPEN_MINUTE, 0, 0);
  while (countdownFrom.getDay() !== OPEN_WEEKDAY || countdownFrom.getTime() > at) {
    countdownFrom.setDate(countdownFrom.getDate() - 1);
  }

  const nextCountdown = new Date(countdownFrom);
  do { nextCountdown.setDate(nextCountdown.getDate() + 1); }
  while (nextCountdown.getDay() !== OPEN_WEEKDAY);

  return {
    countdownFrom: countdownFrom.getTime(),
    opensAt: countdownFrom.getTime() + OPENS_LEAD_MINUTES * 60_000,
    nextCountdown: nextCountdown.getTime()
  };
}

/* What the clock says and whether the till is open.

     opening   the hour before the cafe opens, counting down
     soon      that hour is up; waiting on staff to start the break
     closing   the break is running
     closed    everything else

   Orders are taken from the moment the hour begins, through the break, and on
   past the end of it until staff press stop. */

const SOON_HOLD_MINUTES = 120;
// How long the closed sign stays up after a break, before the clock leaves the
// menu altogether until the next one.
const CLOSED_SIGN_MINUTES = 120;

function cafeState(brk = {}, at = Date.now()) {
  const scheduled = cycle(at);
  const { nextCountdown } = scheduled;
  const endsAt = brk.endsAt || null;
  const closedAt = brk.closedAt || null;

  // Staff can start the hour by hand, on any day. A hand-started hour that is
  // more recent than the scheduled one takes its place, so everything below
  // reads the same whether the cycle began by clock or by button.
  const byHand = brk.countdownAt || null;
  const manual = Boolean(byHand && byHand <= at && byHand > scheduled.countdownFrom);
  const countdownFrom = manual ? byHand : scheduled.countdownFrom;
  const opensAt = manual
    ? byHand + OPENS_LEAD_MINUTES * 60_000
    : scheduled.opensAt;

  // Anything staff did belongs to this cycle only; last week's does not count.
  const stopped = Boolean(closedAt && closedAt >= countdownFrom);
  const breakThisCycle = Boolean(endsAt && endsAt >= countdownFrom);
  const running = !stopped && Boolean(endsAt && endsAt > at);

  let mode = 'closed';
  let target = null;
  let ordersOpen = false;

  if (stopped) {
    mode = 'closed';                       // staff shut the till
  } else if (running) {
    mode = 'closing';
    target = endsAt;
    ordersOpen = true;
  } else if (breakThisCycle) {
    // The ten minutes are up. The sign says closed, but the queue is still
    // being served until staff press stop, or until the guard below.
    mode = 'closed';
    ordersOpen = at < endsAt + SERVING_LIMIT_MINUTES * 60_000;
  } else if (at < opensAt) {
    mode = 'opening';
    target = opensAt;
    ordersOpen = true;
  } else if (at < opensAt + SOON_HOLD_MINUTES * 60_000) {
    mode = 'soon';
    ordersOpen = true;
  }

  // On any other day there is nothing to count, so the clock is not on the menu
  // at all: it arrives with the hour before opening and leaves once the cycle
  // is well and truly over.
  const lastMark = Math.max(closedAt || 0, endsAt || 0);
  const show =
    mode !== 'closed' || Boolean(lastMark && at < lastMark + CLOSED_SIGN_MINUTES * 60_000);

  // The next time the doors are due, and the next time the till opens, which
  // is when the hour begins rather than when the break does.
  const nextOpensAt = at < opensAt
    ? opensAt
    : nextCountdown + OPENS_LEAD_MINUTES * 60_000;
  const nextOrdersAt = at < countdownFrom ? countdownFrom : nextCountdown;

  return {
    mode,
    target,
    show,
    nextOpensAt,
    nextOrdersAt,
    running,
    ordersOpen,
    stopped,
    countdownFrom,
    opensAt,
    nextCountdown
  };
}

const app = express();

// Render terminates TLS in front of the app, so the client's address arrives in
// a header. Without this every visitor looks like the proxy and the rate limits
// below would count them as one person.
app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');   // nobody frames the staff page
  next();
});

app.use(express.json({ limit: '64kb' }));

/* ---------- who is who ----------
   Campus wifi puts a whole building behind one address, so the address is a
   poor way to tell customers apart: one person's checkout would cancel
   another's hold, and one busy queue would trip a rate limit meant for a
   script. Each browser gets an id of its own instead, and the address is only
   the backstop for anything without one. */

function visitor(req, res) {
  if (req._who) return req._who;               // once per request, whoever asks

  const jar = req.headers.cookie || '';
  const found = /(?:^|;\s*)es30=([A-Za-z0-9-]{8,64})/.exec(jar);
  if (found) return (req._who = found[1]);

  const id = req._who = randomUUID();
  res.cookie?.('es30', id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: PUBLIC_URL.startsWith('https'),
    maxAge: 365 * 24 * 60 * 60_000
  });
  return id;
}

/* ---------- rate limits ----------
   A counter per address per minute. Enough to stop one script hammering
   checkout or filling the mailing list, light enough that a lecture hall
   emptying into the cafe never notices. */

const hits = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) if (entry.until < now) hits.delete(key);
}, 60_000).unref();

// Off only for load testing from a single machine, where every request would
// otherwise look like one very busy customer.
const LIMITS_ON = process.env.RATE_LIMIT !== 'off';

function limit(name, max, windowMs = 60_000) {
  return (req, res, next) => {
    if (!LIMITS_ON) return next();

    const key = `${name}:${visitor(req, res)}`;
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.until < now) {
      hits.set(key, { count: 1, until: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.until - now) / 1000)));
      return res.status(429).json({ error: 'That is a lot of requests. Give it a minute.' });
    }
    next();
  };
}

/* ---------- pages ----------
   Two things happen to a page on its way out: the link-preview tags get this
   site's real address, which is only known at run time, and every asset it
   asks for gets a stamp.

   The stamp is what stops a browser holding yesterday's script. Assets are
   cached hard so a crowd is cheap to serve, and the stamp changes whenever the
   file does, so a deploy reaches everyone at once instead of an hour later. */

const PUBLIC_DIR = path.join(__dirname, 'public');
const STAMPED = ['app.js', 'styles.css', 'admin.js', 'admin.css', 'banner.png', 'drink.png'];

const assetHash = createHash('sha1');
for (const name of STAMPED) {
  assetHash.update(await fs.readFile(path.join(PUBLIC_DIR, name)).catch(() => Buffer.alloc(0)));
}
const ASSET_V = assetHash.digest('hex').slice(0, 8);

function page(html) {
  let out = html.replaceAll('%PUBLIC_URL%', PUBLIC_URL);
  for (const name of STAMPED) {
    out = out.replaceAll(`"${name}"`, `"${name}?v=${ASSET_V}"`);
  }
  return out;
}

const indexPage = page(await fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8'));
const adminPage = page(await fs.readFile(path.join(PUBLIC_DIR, 'admin.html'), 'utf8'));
const successPage = page(await fs.readFile(path.join(PUBLIC_DIR, 'success.html'), 'utf8'));

// The pages themselves are never cached; only what they point at is.
const sendPage = (body) => (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(body);
};

app.get(['/', '/index.html'], sendPage(indexPage));
app.get('/admin.html', sendPage(adminPage));
app.get('/success.html', sendPage(successPage));

// Apple's domain-verification file lives in a dot-folder, which the static
// middleware hides by default. Wallets on your own domain need it served.
app.use('/.well-known', express.static(path.join(__dirname, 'public', '.well-known'), {
  dotfiles: 'allow',
  setHeaders: (res) => res.type('text/plain')
}));

app.use(express.static(path.join(__dirname, 'public'), {
  // The pictures, the stylesheet and the script are the bulk of a visit and
  // they rarely change; letting the browser keep them saves the server from
  // sending them again to every person in the queue.
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (/\.(png|ico|woff2?)$/.test(filePath)) res.set('Cache-Control', 'public, max-age=86400');
  }
}));

// The menu as JSON, built once and handed to everyone who asks until something
// changes. Rebuilt at least every second so a lapsing hold shows up promptly.
let menuPayload = null;
let menuPayloadAt = 0;

/* ---------- one writer at a time ----------
   Reading a JSON file, changing it and writing it back is several awaits long,
   so two overlapping requests could each read the same counts and undo one
   another. Every read-modify-write goes through this queue. */

let queue = Promise.resolve();

function exclusive(work) {
  const run = queue.then(work, work);
  queue = run.then(() => {}, () => {});
  return run;
}

/* The files are small and this is the only process that writes them, so they
   are read from disk once and kept in memory. Three hundred people refreshing
   the menu then costs nothing but the JSON they are sent. */

const store = new Map();

async function readJson(file, fallback) {
  if (store.has(file)) return store.get(file);
  let value = fallback;
  try {
    value = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch { /* first run, or a file that is not there yet */ }
  store.set(file, value);
  return value;
}

async function writeJson(file, value) {
  store.set(file, value);
  menuPayload = null;           // anything written can change what customers see
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

/* ---------- the menu ----------
   Lives in menu.json so staff can add and remove items while the cafe is open.
   menu.js is only the starting point, used to write that file the first time. */

async function readMenu() {
  const menu = await readJson(MENU_FILE, null);
  if (menu) return menu;

  const seeded = SEED_MENU.map((section) => ({
    section: section.section,
    groups: section.groups.map((group) => ({
      title: group.title,
      items: group.items.map((item) => ({ ...item }))
    }))
  }));
  await writeJson(MENU_FILE, seeded);
  return seeded;
}

// No prototype, so a cart or a form sending "__proto__" or "constructor" as an
// item id finds nothing rather than finding something inherited from Object.
const itemsOf = (menu) =>
  Object.assign(
    Object.create(null),
    Object.fromEntries(menu.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => [i.id, i]))))
  );

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const slug = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'item';

/* ---------- stock ---------- */

async function readStock(items) {
  const stock = await readJson(STOCK_FILE, {});
  let changed = false;
  for (const [id, item] of Object.entries(items)) {
    if (!Number.isFinite(stock[id])) {
      stock[id] = Number.isFinite(item.stock) ? item.stock : 0;
      changed = true;
    }
  }
  if (changed) await writeJson(STOCK_FILE, stock);
  return stock;
}

/* ---------- mailing list ----------
   Optional, and kept apart from the order. A bad address, or a failure writing
   the file, must never stop someone paying for their snack. */

const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function rememberEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (!email || email.length > 254 || !LOOKS_LIKE_EMAIL.test(email)) return;
  try {
    await exclusive(async () => {
      const list = await readJson(EMAILS_FILE, []);
      if (list.some((entry) => entry.email === email)) return;
      list.push({ email, addedAt: new Date().toISOString() });
      await writeJson(EMAILS_FILE, list);
    });
  } catch (err) {
    console.error('could not save email:', err);
  }
}

/* ---------- availability ----------
   On-hand count minus whatever unpaid checkouts are still holding. */

function heldByUnpaidOrders(orders) {
  const cutoff = Date.now() - RESERVE_MINUTES * 60_000;
  const held = Object.create(null);
  for (const order of Object.values(orders)) {
    if (order.paid) continue;
    if (!order.createdAt || order.createdAt < cutoff) continue;
    for (const line of order.lines) held[line.id] = (held[line.id] || 0) + line.qty;
  }
  return held;
}

function availability(items, stock, orders) {
  const held = heldByUnpaidOrders(orders);
  const available = Object.create(null);
  for (const id of Object.keys(items)) {
    available[id] = Math.max(0, (stock[id] || 0) - (held[id] || 0));
  }
  return available;
}

function commitStock(stock, lines) {
  for (const line of lines) stock[line.id] = Math.max(0, (stock[line.id] || 0) - line.qty);
}

// Order numbers are sequential per day: 1, 2, and so on, reset each morning.
// The cafe's own day, not UTC's. Order numbers restart and takings roll over
// at midnight where the cafe is, which on a host in another timezone is not
// the same moment. TZ is set in the blueprint.
function localDay(at = Date.now()) {
  return new Date(at).toLocaleDateString('en-CA');
}

function nextOrderNumber(orders) {
  const today = localDay();
  const todays = Object.values(orders).filter((o) => o.day === today);
  return { number: 1 + todays.length, day: today };
}

/* ---------- cart pricing ----------
   The client sends ids and quantities only. Prices come from the menu and every
   quantity is checked against the shelf, so neither a tampered cart nor a stale
   page can buy more than exists. */

const MAX_LINES = 40;
const MAX_PER_ITEM = 99;

function priceCart(rawCart, items, available) {
  if (!Array.isArray(rawCart) || rawCart.length === 0) throw new Error('Your cart is empty.');
  if (rawCart.length > MAX_LINES) throw new Error('That is more things than the cafe sells.');

  const lines = [];
  const seen = new Set();

  for (const entry of rawCart) {
    const id = String(entry?.id ?? '');
    if (!own(items, id)) throw new Error('Something in your cart is no longer on the menu.');
    if (seen.has(id)) throw new Error('That item is in the cart twice.');
    seen.add(id);
    const item = items[id];

    const qty = Math.floor(Number(entry.qty));
    if (!Number.isFinite(qty) || qty < 1) throw new Error(`Invalid quantity for ${item.name}.`);
    if (qty > MAX_PER_ITEM) throw new Error(`That is more ${item.name} than anyone needs.`);

    const left = available[id] ?? 0;
    if (left <= 0) throw new Error(`${item.name} is sold out.`);
    if (qty > left) throw new Error(`Only ${left} ${item.name} left, and your order asks for ${qty}.`);

    lines.push({ id, name: item.name, unit: item.price, qty, total: item.price * qty });
  }
  return { lines, total: lines.reduce((sum, l) => sum + l.total, 0) };
}

/* ---------- the menu, with what is left of each item ---------- */

app.get('/api/menu', async (_req, res) => {
  if (menuPayload && Date.now() - menuPayloadAt < 1000) {
    return res.type('json').send(menuPayload);
  }

  const menu = await readMenu();
  const items = itemsOf(menu);
  const [stock, orders, brk] = await Promise.all([
    readStock(items), readJson(ORDERS_FILE, {}), readJson(BREAK_FILE, {})
  ]);
  const available = availability(items, stock, orders);

  menuPayload = JSON.stringify({
    // The clock everyone counts down from, and the time here right now: a phone
    // whose own clock is a minute out still shows the same seconds as the rest
    // of the room.
    now: Date.now(),
    ...(() => {
      const state = cafeState(brk);
      return {
        clock: { mode: state.mode, target: state.target, show: state.show },
        nextOpensAt: state.nextOpensAt,
        nextOrdersAt: state.nextOrdersAt,
        ordersOpen: state.ordersOpen
      };
    })(),
    opensLeadMinutes: OPENS_LEAD_MINUTES,
    menu: menu.map((section) => ({
      ...section,
      groups: section.groups.map((group) => ({
        ...group,
        items: group.items.map(({ stock: _seed, ...item }) => ({
          ...item,
          available: available[item.id] ?? 0
        }))
      }))
    })),
    site: SITE,
    currency: CURRENCY,
    demo: DEMO,
    stripeKey: DEMO ? '' : PUBLISHABLE
  });
  menuPayloadAt = Date.now();

  res.type('json').send(menuPayload);
});

/* ---------- checkout ---------- */

/* One live hold at a time from any one address. Checkouts hold their stock for
   half an hour, so without this a single script could open carts in a loop and
   have the whole shelf show as sold out without paying a penny. Starting a new
   checkout lets go of that address's previous one. */

async function dropEarlierHold(who) {
  if (DEMO || !who) return;

  const orders = await readJson(ORDERS_FILE, {});
  const stale = Object.entries(orders)
    .filter(([, o]) => !o.paid && !o.orderNumber && o.from === who)
    .map(([id]) => id);

  for (const id of stale) {
    try {
      const session = await stripe.checkout.sessions.retrieve(id);
      if (session.payment_status === 'paid') {
        await bookOrder(id);          // they did pay; keep it
        continue;
      }
      if (session.status === 'open') await stripe.checkout.sessions.expire(id);
    } catch { /* gone from Stripe: drop it below anyway */ }

    await exclusive(async () => {
      const current = await readJson(ORDERS_FILE, {});
      if (current[id] && !current[id].paid) {
        delete current[id];
        await writeJson(ORDERS_FILE, current);
      }
    });
  }
}

app.post('/api/checkout', limit('checkout', 12), async (req, res) => {
  try {
    await dropEarlierHold(visitor(req, res)).catch(() => {});

    // Shut for the day: refused here, not only hidden in the page, so a stale
    // tab or a script cannot order after the counter has packed up.
    const open = cafeState(await readJson(BREAK_FILE, {}));
    if (!open.ordersOpen) {
      return res.status(409).json({ error: 'ES30 Cafe is closed. See you at the next break!' });
    }

    const name = String(req.body?.name || '').trim();
    if (name.length < 1 || name.length > 60) {
      return res.status(400).json({ error: 'Please enter the name for the order.' });
    }

    // Step one, under the lock and nothing else: price the cart against what is
    // actually left and write the hold. Whoever gets here first gets the stock.
    const held = await exclusive(async () => {
      const menu = await readMenu();
      const items = itemsOf(menu);
      const [stock, orders] = await Promise.all([readStock(items), readJson(ORDERS_FILE, {})]);
      const { lines, total } = priceCart(req.body?.cart, items, availability(items, stock, orders));

      if (DEMO) {
        const key = `demo_${randomUUID()}`;
        const { number, day } = nextOrderNumber(orders);
        orders[key] = {
          orderNumber: number, day, name, lines, total,
          currency: CURRENCY, demo: true, paid: true, createdAt: Date.now()
        };
        commitStock(stock, lines);
        await Promise.all([writeJson(ORDERS_FILE, orders), writeJson(STOCK_FILE, stock)]);
        return { demo: true, key };
      }

      const key = `hold_${randomUUID()}`;
      orders[key] = {
        orderNumber: null, day: null, name, lines, total,
        currency: CURRENCY, paid: false, createdAt: Date.now(), from: visitor(req, res)
      };
      await writeJson(ORDERS_FILE, orders);
      return { key, lines, total };
    });

    announce();

    if (held.demo) {
      return res.json({ demo: true, url: `${PUBLIC_URL}/success.html?session_id=${held.key}` });
    }

    // Step two, outside the lock: Stripe. A round trip to another company has no
    // business holding up the next customer's cart, which is what happened when
    // this sat inside the queue.
    const embedded = Boolean(PUBLISHABLE);
    let session;

    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        // Cards only. Wallets like Apple Pay and Google Pay still appear, but
        // pay-later methods such as Klarna do not: the cafe hands the snack
        // over at the counter and wants the money then, not in instalments.
        payment_method_types: ['card'],
        line_items: held.lines.map((l) => ({
          quantity: l.qty,
          price_data: { currency: CURRENCY, unit_amount: l.unit, product_data: { name: l.name } }
        })),
        metadata: { customer_name: name },
        expires_at: Math.floor(Date.now() / 1000) + RESERVE_MINUTES * 60,
        // Embedded: the card form is drawn inside the cafe and Stripe sends the
        // customer to the return_url when it is done. Hosted: Stripe's own page.
        ...(embedded
          ? {
              ui_mode: 'embedded',
              return_url: `${PUBLIC_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`
            }
          : {
              success_url: `${PUBLIC_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `${PUBLIC_URL}/`
            })
      });
    } catch (err) {
      // Stripe said no, so the hold goes back rather than sitting on stock for
      // half an hour for an order that can never be paid.
      await exclusive(async () => {
        const orders = await readJson(ORDERS_FILE, {});
        delete orders[held.key];
        await writeJson(ORDERS_FILE, orders);
      });
      announce();
      throw err;
    }

    // Step three: file the hold under the session it belongs to.
    await exclusive(async () => {
      const orders = await readJson(ORDERS_FILE, {});
      const order = orders[held.key];
      if (!order) return;                     // abandoned while Stripe was thinking
      delete orders[held.key];
      orders[session.id] = order;
      await writeJson(ORDERS_FILE, orders);
    });

    res.json(embedded
      ? { clientSecret: session.client_secret, sessionId: session.id }
      : { url: session.url });
  } catch (err) {
    console.error('checkout failed:', err);
    res.status(400).json({ error: err.message || 'Could not start checkout.' });
  }
});

app.post('/api/subscribe', limit('subscribe', 8), async (req, res) => {
  await rememberEmail(req.body?.email);
  res.json({ ok: true });
});

/* ---------- the break ----------
   One clock for the room: staff start it, and every phone counts down to the
   same moment rather than to its own idea of ten minutes. */

// Start the hour now, whatever the day. A fresh cycle: any break or stop from
// the last one is cleared, the clock counts down from an hour, and the till
// opens straight away.
app.post('/api/countdown', staffOnly, async (_req, res) => {
  const countdownAt = Date.now();
  await exclusive(() => writeJson(BREAK_FILE, { countdownAt }));
  announce();
  res.json({ ok: true, countdownAt, opensAt: countdownAt + OPENS_LEAD_MINUTES * 60_000 });
});

app.post('/api/break', staffOnly, async (req, res) => {
  const minutes = Number(req.body?.minutes ?? BREAK_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 120) {
    return res.status(400).json({ error: 'A break is between a minute and two hours.' });
  }

  const endsAt = Date.now() + Math.round(minutes * 60_000);

  await exclusive(async () => {
    const brk = await readJson(BREAK_FILE, {});
    // Keeps a hand-started hour, drops any earlier stop.
    await writeJson(BREAK_FILE, { countdownAt: brk.countdownAt || null, endsAt });
  });

  announce();
  res.json({ ok: true, endsAt });
});

// Stop: the till closes. The clock holds its closed sign, and nothing else
// can be ordered until the next cycle comes round.
app.delete('/api/break', staffOnly, async (_req, res) => {
  await exclusive(async () => {
    const brk = await readJson(BREAK_FILE, {});
    await writeJson(BREAK_FILE, { ...brk, closedAt: Date.now() });
  });
  announce();
  res.json({ ok: true });
});

// A tidier way in for staff than typing the file name.
app.get('/admin', (req, res) => res.redirect('/admin.html'));

// Ticking an order off. Nothing else about the order can be changed here: the
// name, the lines and the total are what was paid for.
app.patch('/api/orders/:id', staffOnly, async (req, res) => {
  try {
    const done = Boolean(req.body?.fulfilled);

    await exclusive(async () => {
      const orders = await readJson(ORDERS_FILE, {});
      const order = orders[req.params.id];
      if (!order) throw new Error('No such order.');

      order.fulfilled = done;
      if (done) order.fulfilledAt = Date.now();
      else delete order.fulfilledAt;

      await writeJson(ORDERS_FILE, orders);
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Backing out of the card form. The held stock goes back on the shelf at once
// rather than sitting out of reach until the session lapses.
app.post('/api/checkout/abandon', limit('abandon', 30), async (req, res) => {
  const sessionId = String(req.body?.sessionId || '');
  if (!sessionId || DEMO) return res.json({ ok: true });

  try {
    const orders = await readJson(ORDERS_FILE, {});
    const order = orders[sessionId];
    if (!order || order.paid || order.orderNumber) return res.json({ ok: true });

    // Ask Stripe rather than trust the caller: a payment may have gone through
    // in the moment between the customer paying and closing the screen.
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === 'paid') {
      await bookOrder(sessionId);
      announce();
      return res.json({ ok: true, paid: true });
    }

    if (session.status === 'open') await stripe.checkout.sessions.expire(sessionId);

    await exclusive(async () => {
      const current = await readJson(ORDERS_FILE, {});
      if (current[sessionId] && !current[sessionId].paid) {
        delete current[sessionId];
        await writeJson(ORDERS_FILE, current);
      }
    });

    announce();
    res.json({ ok: true });
  } catch (err) {
    console.warn('could not release', sessionId, err.message);
    res.json({ ok: true });   // the hold lapses on its own soon enough
  }
});

/* ---------- live updates ----------
   Open browsers hold a stream, so a change made on the staff page reaches the
   customers already looking at the menu without them reloading. */

const watchers = new Set();

app.get('/api/events', limit('events', 60), (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'   // stop any proxy holding the stream in a buffer
  });
  res.flushHeaders?.();
  res.write(': open\n\n');
  watchers.add(res);

  // Proxies drop a silent connection, so say something every 25 seconds.
  const beat = setInterval(() => res.write(': beat\n\n'), 25000);

  req.on('close', () => {
    clearInterval(beat);
    watchers.delete(res);
  });
});

function announce() {
  for (const res of watchers) {
    try { res.write('event: menu\ndata: changed\n\n'); } catch { watchers.delete(res); }
  }
}

/* ---------- confirmation ---------- */

app.get('/api/order', async (req, res) => {
  const sessionId = String(req.query.session_id || '');
  if (!sessionId) return res.status(400).json({ error: 'Missing session.' });

  const existing = (await readJson(ORDERS_FILE, {}))[sessionId];
  if (!existing) return res.status(404).json({ error: 'Order not found.' });
  if (existing.orderNumber) return res.json(publicOrder(existing));
  if (DEMO) return res.status(404).json({ error: 'Order not found.' });

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== 'paid') {
    return res.status(402).json({ error: 'Payment is not complete yet.' });
  }

  const finished = await bookOrder(sessionId);
  announce();
  res.json(publicOrder(finished));
});

// Turning a paid session into an order: a number, and the stock actually spent.
// Runs under the lock and is safe to call twice on the same session.
async function bookOrder(sessionId) {
  return exclusive(async () => {
    const items = itemsOf(await readMenu());
    const [stock, orders] = await Promise.all([readStock(items), readJson(ORDERS_FILE, {})]);
    const order = orders[sessionId];
    if (!order) throw new Error('Order not found.');
    if (order.orderNumber) return order;

    const { number, day } = nextOrderNumber(orders);
    orders[sessionId] = { ...order, orderNumber: number, day, paid: true };
    commitStock(stock, order.lines);
    await Promise.all([writeJson(ORDERS_FILE, orders), writeJson(STOCK_FILE, stock)]);
    return orders[sessionId];
  });
}

/* ---------- catching up with Stripe ----------
   An order is normally booked when the customer lands back on the order-number
   screen. If they close the tab at the wrong moment, the money is taken and
   nothing here knows: the order never appears on the staff list and the stock
   never comes down. This asks Stripe about anything still unpaid and books
   whatever was in fact paid for. */

async function reconcile() {
  if (DEMO) return 0;

  const orders = await readJson(ORDERS_FILE, {});
  const dayAgo = Date.now() - 24 * 60 * 60_000;
  const pending = Object.entries(orders)
    .filter(([id, o]) => !o.orderNumber && !o.paid && id.startsWith('cs_') && (o.createdAt || 0) > dayAgo)
    .map(([id]) => id);

  let booked = 0;
  for (const id of pending) {
    try {
      const session = await stripe.checkout.sessions.retrieve(id);
      if (session.payment_status === 'paid') {
        await bookOrder(id);
        booked += 1;
      }
    } catch (err) {
      console.warn('could not check session', id, err.message);
    }
  }

  if (booked) announce();
  return booked;
}

// Often enough that a stray payment surfaces while the customer is still at the
// counter, rarely enough to be no load at all.
if (!DEMO) setInterval(() => { reconcile().catch(() => {}); }, 90_000);

function publicOrder(o) {
  return {
    orderNumber: o.orderNumber,
    name: o.name,
    lines: o.lines,
    total: o.total,
    currency: o.currency,
    demo: Boolean(o.demo)
  };
}

/* ---------- staff ----------
   Guarded by ADMIN_TOKEN. With no token set, only from the machine the server
   runs on, which suits a till behind the counter. */

function isLocal(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// Compared byte for byte in constant time, so the time a refusal takes says
// nothing about how much of the code was right.
function sameSecret(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const guessLimit = limit('staff', 15);

function staffOnly(req, res, next) {
  if (ADMIN_TOKEN) {
    const sent = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (sent && sameSecret(sent, ADMIN_TOKEN)) return next();

    // Wrong code: count it, and stop a script working through the alphabet.
    return guessLimit(req, res, () => {
      // Lengths only: enough to spot a stray character in the log, never the code.
      if (sent) {
        console.warn(`staff sign-in refused: sent ${sent.length} characters, expected ${ADMIN_TOKEN.length}`);
      }
      res.status(401).json({ error: 'Wrong or missing staff code.' });
    });
  }
  if (isLocal(req)) return next();
  return res.status(401).json({ error: 'Set ADMIN_TOKEN in .env to manage from another machine.' });
}

// Everything the admin screen shows, in one call.
app.get('/api/admin', staffOnly, async (_req, res) => {
  // Cheap, and it means the list is right the moment it is opened.
  await reconcile().catch(() => {});

  const menu = await readMenu();
  const items = itemsOf(menu);
  const [stock, orders, subscribers, brk] = await Promise.all([
    readStock(items), readJson(ORDERS_FILE, {}), readJson(EMAILS_FILE, []), readJson(BREAK_FILE, {})
  ]);
  const available = availability(items, stock, orders);

  const paid = Object.entries(orders)
    .filter(([, o]) => o.paid && o.orderNumber)
    .map(([id, o]) => ({ ...o, id }));
  const today = localDay();

  res.json({
    needsToken: Boolean(ADMIN_TOKEN),
    currency: CURRENCY,
    now: Date.now(),
    ...(() => {
      const state = cafeState(brk);
      return {
        clock: { mode: state.mode, target: state.target, show: state.show },
        running: state.running,
        breakEndsAt: brk.endsAt || null,
        countdownAt: brk.countdownAt || null,
        opensAt: state.opensAt,
        countdownFrom: state.countdownFrom,
        nextCountdown: state.nextCountdown,
        nextOrdersAt: state.nextOrdersAt,
        ordersOpen: state.ordersOpen,
        stopped: state.stopped
      };
    })(),
    breakMinutes: BREAK_MINUTES,
    schedule: {
      weekday: OPEN_WEEKDAY,
      time: `${String(OPEN_HOUR).padStart(2, '0')}:${String(OPEN_MINUTE).padStart(2, '0')}`
    },
    sections: menu.map((s) => ({
      section: s.section,
      groups: s.groups.map((g) => ({ title: g.title }))
    })),
    items: menu.flatMap((section) =>
      section.groups.flatMap((group) =>
        group.items.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          section: section.section,
          group: group.title,
          onHand: stock[item.id] ?? 0,
          available: available[item.id] ?? 0
        }))
      )
    ),
    takings: {
      today: paid.filter((o) => o.day === today).reduce((sum, o) => sum + o.total, 0),
      allTime: paid.reduce((sum, o) => sum + o.total, 0),
      ordersToday: paid.filter((o) => o.day === today).length,
      ordersAllTime: paid.length
    },
    orders: paid
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 100)
      .map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        day: o.day,
        name: o.name,
        total: o.total,
        createdAt: o.createdAt,
        fulfilled: Boolean(o.fulfilled),
        lines: o.lines.map((l) => ({ name: l.name, qty: l.qty }))
      })),
    subscribers: subscribers.slice().reverse()
  });
});

app.post('/api/stock', staffOnly, async (req, res) => {
  const counts = req.body?.counts;
  if (!counts || typeof counts !== 'object') {
    return res.status(400).json({ error: 'Send the new counts.' });
  }
  try {
    await exclusive(async () => {
      const items = itemsOf(await readMenu());
      const stock = await readStock(items);
      for (const [id, raw] of Object.entries(counts)) {
        if (!own(items, id)) throw new Error('That item is no longer on the menu.');
        const qty = Math.floor(Number(raw));
        if (!Number.isFinite(qty) || qty < 0 || qty > 9999) {
          throw new Error(`${items[id].name} needs a whole number from 0 to 9999.`);
        }
        stock[id] = qty;
      }
      await writeJson(STOCK_FILE, stock);
    });
    announce();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Add an item. It shows up on the storefront straight away.
app.post('/api/items', staffOnly, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const priceRaw = Number(req.body?.price);
    const sectionName = String(req.body?.section || '').trim();
    const groupTitle = String(req.body?.group ?? '').trim();
    const desc = String(req.body?.desc || '').trim();
    const stockRaw = Math.floor(Number(req.body?.stock));

    if (name.length < 1 || name.length > 60) throw new Error('Give the item a name.');
    if (!Number.isFinite(priceRaw) || priceRaw < 0 || priceRaw > 9999) {
      throw new Error('Price needs to be a number of dollars, like 3 or 3.50.');
    }
    const price = Math.round(priceRaw * 100);
    const stockStart = Number.isFinite(stockRaw) && stockRaw >= 0 ? Math.min(stockRaw, 9999) : 0;

    const added = await exclusive(async () => {
      const menu = await readMenu();
      const items = itemsOf(menu);

      let id = slug(name);
      while (items[id]) id = `${slug(name)}-${Math.random().toString(36).slice(2, 6)}`;

      let section = menu.find((s) => s.section === sectionName);
      if (!section) {
        section = { section: sectionName || 'Menu', groups: [] };
        menu.push(section);
      }
      let group = section.groups.find((g) => (g.title || '') === groupTitle);
      if (!group) {
        group = { title: groupTitle, items: [] };
        section.groups.push(group);
      }

      const item = { id, name, price };
      if (desc) item.desc = desc;
      group.items.push(item);

      const stock = await readStock(items);
      stock[id] = stockStart;

      await Promise.all([writeJson(MENU_FILE, menu), writeJson(STOCK_FILE, stock)]);
      return item;
    });

    announce();
    res.json({ ok: true, item: added });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Edit an item in place. The id never changes, so a rename or a new price
// leaves the stock count and any order in flight pointing at the same thing.
app.patch('/api/items/:id', staffOnly, async (req, res) => {
  try {
    const updated = await exclusive(async () => {
      const menu = await readMenu();
      const target = itemsOf(menu)[req.params.id];
      if (!target) throw new Error('That item is no longer on the menu.');

      if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim();
        if (name.length < 1 || name.length > 60) throw new Error('Give the item a name.');
        target.name = name;
      }

      if (req.body?.price !== undefined) {
        const price = Number(req.body.price);
        if (!Number.isFinite(price) || price < 0 || price > 9999) {
          throw new Error('Price needs to be a number of dollars, like 3 or 3.50.');
        }
        target.price = Math.round(price * 100);
      }

      if (req.body?.desc !== undefined) {
        const desc = String(req.body.desc).trim();
        if (desc) target.desc = desc;
        else delete target.desc;
      }

      await writeJson(MENU_FILE, menu);
      return target;
    });

    announce();
    res.json({ ok: true, item: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Remove an item. Past orders keep their own copy of the name and price, so
// the receipts and the takings are unaffected.
app.delete('/api/items/:id', staffOnly, async (req, res) => {
  try {
    await exclusive(async () => {
      const menu = await readMenu();
      const id = req.params.id;
      let found = false;

      for (const section of menu) {
        for (const group of section.groups) {
          const at = group.items.findIndex((i) => i.id === id);
          if (at !== -1) { group.items.splice(at, 1); found = true; }
        }
        section.groups = section.groups.filter((g) => g.items.length > 0);
      }
      if (!found) throw new Error('That item is already gone.');

      const trimmed = menu.filter((s) => s.groups.length > 0);
      const stock = await readJson(STOCK_FILE, {});
      delete stock[id];

      await Promise.all([writeJson(MENU_FILE, trimmed), writeJson(STOCK_FILE, stock)]);
    });
    announce();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});

app.listen(PORT, () => {
  console.log(`ES30 Cafe running at ${PUBLIC_URL}`);
  console.log(`Admin at ${PUBLIC_URL}/admin.html`);
  if (DEMO) console.log('DEMO MODE: no STRIPE_SECRET_KEY set, payments are simulated.');
  if (!ADMIN_TOKEN) console.log('No ADMIN_TOKEN set: admin only from this machine.');
  if (!LIMITS_ON) console.log('RATE LIMITS OFF: for load testing only, never in front of customers.');
});
