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

// Demo mode lets the whole flow run before Stripe keys exist.
// It never charges anything and is refused if a live key is present.
const DEMO = !SECRET || SECRET === 'sk_test_replace_me';
const stripe = DEMO ? null : new Stripe(SECRET);

const ORDERS_FILE = path.join(__dirname, 'orders.json');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- order storage ----------
   A JSON file is enough for one cafe on one machine. Swap readOrders and
   writeOrder for a real database when you need more than one server. */

async function readOrders() {
  try {
    return JSON.parse(await fs.readFile(ORDERS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function writeOrder(key, order) {
  const orders = await readOrders();
  orders[key] = order;
  await fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2));
  return order;
}

// Order numbers are sequential per day: 1, 2, and so on, reset each morning.
async function nextOrderNumber() {
  const orders = await readOrders();
  const today = new Date().toISOString().slice(0, 10);
  const todays = Object.values(orders).filter((o) => o.day === today);
  return { number: 1 + todays.length, day: today };
}

/* ---------- cart pricing ----------
   The client sends ids and quantities only. Every price comes from menu.js,
   so a tampered cart cannot change what someone is charged. */

function priceCart(rawCart) {
  if (!Array.isArray(rawCart) || rawCart.length === 0) {
    throw new Error('Your cart is empty.');
  }
  const lines = [];
  for (const entry of rawCart) {
    const item = ITEMS[entry?.id];
    if (!item) throw new Error(`Unknown item: ${entry?.id}`);
    const qty = Math.floor(Number(entry.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 20) {
      throw new Error(`Invalid quantity for ${item.name}.`);
    }
    lines.push({ id: item.id, name: item.name, unit: item.price, qty, total: item.price * qty });
  }
  return { lines, total: lines.reduce((sum, l) => sum + l.total, 0) };
}

/* ---------- routes ---------- */

app.get('/api/menu', (_req, res) => {
  res.json({ menu: MENU, site: SITE, currency: CURRENCY, demo: DEMO });
});

app.post('/api/checkout', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (name.length < 1 || name.length > 60) {
      return res.status(400).json({ error: 'Please enter the name for the order.' });
    }

    const { lines, total } = priceCart(req.body?.cart);

    if (DEMO) {
      // No Stripe key configured. Record the order and skip straight to the
      // confirmation so the flow can be demonstrated end to end.
      const key = `demo_${Date.now().toString(36)}`;
      const { number, day } = await nextOrderNumber();
      await writeOrder(key, { orderNumber: number, day, name, lines, total, currency: CURRENCY, demo: true });
      return res.json({ demo: true, url: `${PUBLIC_URL}/success.html?session_id=${key}` });
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
      success_url: `${PUBLIC_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_URL}/#menu`
    });

    // Hold the priced cart against the session so the confirmation page does
    // not have to trust anything the browser sends back.
    await writeOrder(session.id, {
      orderNumber: null, day: null, name, lines, total, currency: CURRENCY, paid: false
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('checkout failed:', err);
    res.status(400).json({ error: err.message || 'Could not start checkout.' });
  }
});

// Called by the confirmation page. The order number is assigned only once
// payment is confirmed, and the same session always returns the same number.
app.get('/api/order', async (req, res) => {
  const sessionId = String(req.query.session_id || '');
  if (!sessionId) return res.status(400).json({ error: 'Missing session.' });

  const orders = await readOrders();
  const order = orders[sessionId];
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  if (order.orderNumber) {
    return res.json(publicOrder(order));
  }

  if (DEMO) return res.status(404).json({ error: 'Order not found.' });

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== 'paid') {
    return res.status(402).json({ error: 'Payment is not complete yet.' });
  }

  const { number, day } = await nextOrderNumber();
  const finished = { ...order, orderNumber: number, day, paid: true };
  await writeOrder(sessionId, finished);
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

app.listen(PORT, () => {
  console.log(`ES30 Cafe running at ${PUBLIC_URL}`);
  if (DEMO) console.log('DEMO MODE: no STRIPE_SECRET_KEY set, payments are simulated.');
});
