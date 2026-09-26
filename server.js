import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { MENU, ITEMS, SITE } from './menu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 4242);
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const CURRENCY = (process.env.CURRENCY || 'usd').toLowerCase();
const SECRET = process.env.STRIPE_SECRET_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// How long an unpaid checkout holds its items before the stock goes back on sale.
const RESERVE_MINUTES = 30;

// Demo mode lets the whole flow run before Stripe keys exist.
// It never charges anything and is refused if a live key is present.
const DEMO = !SECRET || SECRET === 'sk_test_replace_me';
const stripe = DEMO ? null : new Stripe(SECRET);

const ORDERS_FILE = path.join(__dirname, 'orders.json');
const STOCK_FILE = path.join(__dirname, 'stock.json');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- one writer at a time ----------
   Reading a JSON file, changing it and writing it back is several awaits long,
   so two overlapping requests could each read the same counts and undo one
   another. Every read-modify-write of orders or stock goes through this queue. */

let queue = Promise.resolve();

function exclusive(work) {
  const run = queue.then(work, work);
  queue = run.then(() => {}, () => {});
  return run;
}

/* ---------- storage ----------
   JSON files are enough for one cafe on one machine. Swap these four functions
   for a real database when you need more than one server. */

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const readOrders = () => readJson(ORDERS_FILE, {});
const writeOrders = (orders) => fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2));

// stock.json holds the on-hand count per item. Items missing from it are seeded
// from the `stock` value in menu.js, so a newly added item starts stocked.
async function readStock() {
  const stock = await readJson(STOCK_FILE, {});
  let seeded = false;
  for (const [id, item] of Object.entries(ITEMS)) {
    if (!Number.isFinite(stock[id])) {
      stock[id] = Number.isFinite(item.stock) ? item.stock : 0;
      seeded = true;
    }
  }
  if (seeded) await fs.writeFile(STOCK_FILE, JSON.stringify(stock, null, 2));
  return stock;
}

const writeStock = (stock) => fs.writeFile(STOCK_FILE, JSON.stringify(stock, null, 2));

/* ---------- availability ----------
   On-hand count minus whatever unpaid checkouts are still holding. An unpaid
   checkout stops holding its items once it is older than RESERVE_MINUTES. */

function heldByUnpaidOrders(orders) {
  const cutoff = Date.now() - RESERVE_MINUTES * 60_000;
  const held = {};
  for (const order of Object.values(orders)) {
    if (order.paid) continue;
    if (!order.createdAt || order.createdAt < cutoff) continue;
    for (const line of order.lines) {
      held[line.id] = (held[line.id] || 0) + line.qty;
    }
  }
  return held;
}

function availability(stock, orders) {
  const held = heldByUnpaidOrders(orders);
  const available = {};
  for (const id of Object.keys(ITEMS)) {
    available[id] = Math.max(0, (stock[id] || 0) - (held[id] || 0));
  }
  return available;
}

// Take the items off the shelf for good. Called once an order is actually paid.
function commitStock(stock, lines) {
  for (const line of lines) {
    stock[line.id] = Math.max(0, (stock[line.id] || 0) - line.qty);
  }
}

// Order numbers are sequential per day: 1, 2, and so on, reset each morning.
function nextOrderNumber(orders) {
  const today = new Date().toISOString().slice(0, 10);
  const todays = Object.values(orders).filter((o) => o.day === today);
  return { number: 1 + todays.length, day: today };
}

/* ---------- cart pricing ----------
   The client sends ids and quantities only. Every price comes from menu.js and
   every quantity is checked against what is actually on the shelf, so neither a
   tampered cart nor a stale page can buy more than exists. */

function priceCart(rawCart, available) {
  if (!Array.isArray(rawCart) || rawCart.length === 0) {
    throw new Error('Your cart is empty.');
  }
  const lines = [];
  for (const entry of rawCart) {
    const item = ITEMS[entry?.id];
    if (!item) throw new Error(`Unknown item: ${entry?.id}`);

    const qty = Math.floor(Number(entry.qty));
    if (!Number.isFinite(qty) || qty < 1) {
      throw new Error(`Invalid quantity for ${item.name}.`);
    }

    const left = available[item.id] ?? 0;
    if (left <= 0) throw new Error(`${item.name} is sold out.`);
    if (qty > left) {
      throw new Error(`Only ${left} ${item.name} left, and your order asks for ${qty}.`);
    }

    lines.push({ id: item.id, name: item.name, unit: item.price, qty, total: item.price * qty });
  }
  return { lines, total: lines.reduce((sum, l) => sum + l.total, 0) };
}

/* ---------- the menu, with what is left of each item ---------- */

app.get('/api/menu', async (_req, res) => {
  const [stock, orders] = await Promise.all([readStock(), readOrders()]);
  const available = availability(stock, orders);

  const menu = MENU.map((section) => ({
    ...section,
    groups: section.groups.map((group) => ({
      ...group,
      items: group.items.map(({ stock: _seed, ...item }) => ({
        ...item,
        available: available[item.id] ?? 0
      }))
    }))
  }));

  res.json({ menu, site: SITE, currency: CURRENCY, demo: DEMO });
});

/* ---------- checkout ---------- */

app.post('/api/checkout', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (name.length < 1 || name.length > 60) {
      return res.status(400).json({ error: 'Please enter the name for the order.' });
    }

    const result = await exclusive(async () => {
      const [stock, orders] = await Promise.all([readStock(), readOrders()]);
      const { lines, total } = priceCart(req.body?.cart, availability(stock, orders));

      if (DEMO) {
        // No Stripe key configured. Record the order, take the stock, and skip
        // straight to the confirmation so the flow can be demonstrated.
        const key = `demo_${Date.now().toString(36)}`;
        const { number, day } = nextOrderNumber(orders);
        orders[key] = {
          orderNumber: number, day, name, lines, total,
          currency: CURRENCY, demo: true, paid: true, createdAt: Date.now()
        };
        commitStock(stock, lines);
        await Promise.all([writeOrders(orders), writeStock(stock)]);
        return { demo: true, url: `${PUBLIC_URL}/success.html?session_id=${key}` };
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: lines.map((l) => ({
          quantity: l.qty,
          price_data: {
            currency: CURRENCY,
            unit_amount: l.unit,
            product_data: { name: l.name }
          }
        })),
        metadata: { customer_name: name },
        expires_at: Math.floor(Date.now() / 1000) + RESERVE_MINUTES * 60,
        success_url: `${PUBLIC_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${PUBLIC_URL}/`
      });

      // Recorded unpaid, which holds the stock until it is paid or expires.
      orders[session.id] = {
        orderNumber: null, day: null, name, lines, total,
        currency: CURRENCY, paid: false, createdAt: Date.now()
      };
      await writeOrders(orders);
      return { url: session.url };
    });

    res.json(result);
  } catch (err) {
    console.error('checkout failed:', err);
    res.status(400).json({ error: err.message || 'Could not start checkout.' });
  }
});

/* ---------- confirmation ----------
   The order number is assigned, and the stock taken, only once payment is
   confirmed. The same session always returns the same number. */

app.get('/api/order', async (req, res) => {
  const sessionId = String(req.query.session_id || '');
  if (!sessionId) return res.status(400).json({ error: 'Missing session.' });

  const existing = (await readOrders())[sessionId];
  if (!existing) return res.status(404).json({ error: 'Order not found.' });
  if (existing.orderNumber) return res.json(publicOrder(existing));
  if (DEMO) return res.status(404).json({ error: 'Order not found.' });

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== 'paid') {
    return res.status(402).json({ error: 'Payment is not complete yet.' });
  }

  const finished = await exclusive(async () => {
    const [stock, orders] = await Promise.all([readStock(), readOrders()]);
    const order = orders[sessionId];
    if (order.orderNumber) return order;           // another request got here first

    const { number, day } = nextOrderNumber(orders);
    orders[sessionId] = { ...order, orderNumber: number, day, paid: true };
    commitStock(stock, order.lines);
    await Promise.all([writeOrders(orders), writeStock(stock)]);
    return orders[sessionId];
  });

  res.json(publicOrder(finished));
});

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

/* ---------- staff: setting the counts ----------
   Guarded by ADMIN_TOKEN. With no token set, the counts can only be changed
   from the machine the server runs on, which suits a till behind the counter.
   Set ADMIN_TOKEN before putting this on the internet. */

function isLocal(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function staffOnly(req, res, next) {
  if (ADMIN_TOKEN) {
    const sent = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (sent && sent === ADMIN_TOKEN) return next();
    return res.status(401).json({ error: 'Wrong or missing staff code.' });
  }
  if (isLocal(req)) return next();
  return res.status(401).json({
    error: 'Set ADMIN_TOKEN in .env to change stock from another machine.'
  });
}

app.get('/api/stock', staffOnly, async (_req, res) => {
  const [stock, orders] = await Promise.all([readStock(), readOrders()]);
  const available = availability(stock, orders);
  res.json({
    needsToken: Boolean(ADMIN_TOKEN),
    items: Object.values(ITEMS).map((item) => ({
      id: item.id,
      name: item.name,
      onHand: stock[item.id] ?? 0,
      available: available[item.id] ?? 0
    }))
  });
});

app.post('/api/stock', staffOnly, async (req, res) => {
  const counts = req.body?.counts;
  if (!counts || typeof counts !== 'object') {
    return res.status(400).json({ error: 'Send the new counts.' });
  }

  try {
    const saved = await exclusive(async () => {
      const [stock, orders] = await Promise.all([readStock(), readOrders()]);
      for (const [id, raw] of Object.entries(counts)) {
        if (!ITEMS[id]) throw new Error(`Unknown item: ${id}`);
        const qty = Math.floor(Number(raw));
        if (!Number.isFinite(qty) || qty < 0 || qty > 9999) {
          throw new Error(`${ITEMS[id].name} needs a whole number from 0 to 9999.`);
        }
        stock[id] = qty;
      }
      await writeStock(stock);
      return availability(stock, orders);
    });
    res.json({ ok: true, available: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`ES30 Cafe running at ${PUBLIC_URL}`);
  console.log(`Stock page at ${PUBLIC_URL}/admin.html`);
  if (DEMO) console.log('DEMO MODE: no STRIPE_SECRET_KEY set, payments are simulated.');
  if (!ADMIN_TOKEN) console.log('No ADMIN_TOKEN set: stock can only be changed from this machine.');
});
