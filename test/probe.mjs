const BASE = 'http://localhost:4300';
const TOKEN = 'secretcode';
const results = [];

async function call(name, path, opts = {}, expect) {
  try {
    const res = await fetch(BASE + path, opts);
    let body = '';
    try { body = (await res.text()).slice(0, 160); } catch {}
    const pass = expect ? expect(res.status, body) : null;
    results.push({ name, status: res.status, body: body.replace(/\s+/g, ' ').slice(0, 110), pass });
  } catch (err) {
    results.push({ name, status: 'ERR', body: err.message, pass: false });
  }
}

const json = (obj, headers = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(obj)
});

// The cafe has to be open for any of the cart checks to mean anything.
await fetch(BASE + '/api/break', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes: 10 }) });

// --- cart and pricing (open the cafe first) ---------------------------
await call('cart: negative qty', '/api/checkout', json({ name: 'x', cart: [{ id: 'celsius', qty: -5 }] }), (s) => s === 400);
await call('cart: zero qty', '/api/checkout', json({ name: 'x', cart: [{ id: 'celsius', qty: 0 }] }), (s) => s === 400);
await call('cart: float qty', '/api/checkout', json({ name: 'x', cart: [{ id: 'celsius', qty: 1.9 }] }), (s) => s === 200);
await call('cart: string qty', '/api/checkout', json({ name: 'x', cart: [{ id: 'celsius', qty: '3' }] }), (s) => s === 200);
await call('cart: NaN qty', '/api/checkout', json({ name: 'x', cart: [{ id: 'celsius', qty: 'abc' }] }), (s) => s === 400);
await call('cart: Infinity qty', '/api/checkout', json({ name: 'x', cart: [{ id: 'celsius', qty: 1e308 }] }), (s) => s === 400);
await call('cart: unknown item', '/api/checkout', json({ name: 'x', cart: [{ id: 'nope', qty: 1 }] }), (s) => s === 400);
await call('cart: __proto__ id', '/api/checkout', json({ name: 'x', cart: [{ id: '__proto__', qty: 1 }] }), (s) => s === 400);
await call('cart: constructor id', '/api/checkout', json({ name: 'x', cart: [{ id: 'constructor', qty: 1 }] }), (s) => s === 400);
await call('cart: price tampering', '/api/checkout', json({ name: 'x', cart: [{ id: 'celsius', qty: 1, unit: 1, price: 1, total: 1 }] }), (s) => s === 200);
await call('cart: not an array', '/api/checkout', json({ name: 'x', cart: { celsius: 1 } }), (s) => s === 400);
await call('cart: 5000 lines', '/api/checkout', json({ name: 'x', cart: Array.from({ length: 5000 }, () => ({ id: 'celsius', qty: 1 })) }), (s) => s === 400 || s === 413);
await call('name: empty', '/api/checkout', json({ name: '', cart: [{ id: 'celsius', qty: 1 }] }), (s) => s === 400);
await call('name: 5000 chars', '/api/checkout', json({ name: 'a'.repeat(5000), cart: [{ id: 'celsius', qty: 1 }] }), (s) => s === 400);
await call('name: script tag', '/api/checkout', json({ name: '<script>alert(1)</script>', cart: [{ id: 'celsius', qty: 1 }] }), (s) => s === 200);

// --- staff endpoints without the code ---------------------------------
await call('admin: no token', '/api/admin', {}, (s) => s === 401);
await call('admin: wrong token', '/api/admin', { headers: { Authorization: 'Bearer wrong' } }, (s) => s === 401);
await call('admin: empty bearer', '/api/admin', { headers: { Authorization: 'Bearer ' } }, (s) => s === 401);
await call('stock: no token', '/api/stock', json({ counts: { celsius: 999 } }), (s) => s === 401);
await call('items add: no token', '/api/items', json({ name: 'Free', price: 0, section: 'Snacks' }), (s) => s === 401);
await call('items edit: no token', '/api/items/celsius', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"price":0}' }, (s) => s === 401);
await call('items delete: no token', '/api/items/celsius', { method: 'DELETE' }, (s) => s === 401);
await call('orders tick: no token', '/api/orders/anything', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"fulfilled":true}' }, (s) => s === 401);

// --- staff endpoints with the code, hostile input ---------------------
const auth = { Authorization: 'Bearer ' + TOKEN };
await call('stock: negative', '/api/stock', json({ counts: { celsius: -5 } }, auth), (s) => s === 400);
await call('stock: huge', '/api/stock', json({ counts: { celsius: 1e9 } }, auth), (s) => s === 400);
await call('stock: __proto__ key', '/api/stock', json({ counts: { __proto__: 5 } }, auth), (s) => s === 400);
await call('stock: unknown item', '/api/stock', json({ counts: { nope: 5 } }, auth), (s) => s === 400);
await call('item add: negative price', '/api/items', json({ name: 'Bad', price: -3, section: 'Snacks' }, auth), (s) => s === 400);
await call('item add: huge price', '/api/items', json({ name: 'Bad', price: 1e9, section: 'Snacks' }, auth), (s) => s === 400);
await call('item add: 5000-char name', '/api/items', json({ name: 'a'.repeat(5000), price: 1, section: 'Snacks' }, auth), (s) => s === 400);

// --- order lookup -----------------------------------------------------
await call('order: unknown id', '/api/order?session_id=nope', {}, (s) => s === 404);
await call('order: traversal id', '/api/order?session_id=../../etc/passwd', {}, (s) => s === 404);
await call('order: missing id', '/api/order', {}, (s) => s === 400);
await call('abandon: arbitrary id', '/api/checkout/abandon', json({ sessionId: 'cs_made_up' }), (s) => s === 200);

// --- mailing list -----------------------------------------------------
await call('subscribe: junk', '/api/subscribe', json({ email: 'not-an-email' }), (s) => s === 200);
await call('subscribe: 10k chars', '/api/subscribe', json({ email: 'a'.repeat(10000) + '@x.com' }), (s) => s === 200);
await call('subscribe: object', '/api/subscribe', json({ email: { a: 1 } }), (s) => s === 200);

// --- static files -----------------------------------------------------
await call('static: traversal', '/../server.js', {}, (s) => s === 404 || s === 400);
await call('static: encoded traversal', '/%2e%2e%2fserver.js', {}, (s) => s === 404 || s === 400);
await call('static: dotenv', '/.env', {}, (s) => s === 404);
await call('static: orders.json', '/orders.json', {}, (s) => s === 404);
await call('static: menu.js', '/menu.js', {}, (s) => s === 404);

// --- body size --------------------------------------------------------
await call('body: 2MB json', '/api/checkout', json({ name: 'x'.repeat(2_000_000), cart: [] }), (s) => s === 413 || s === 400);

console.log(JSON.stringify(results, null, 1));
const failed = results.filter((r) => r.pass === false);
console.log('\n--- failures:', failed.length, '---');
for (const f of failed) console.log(' ✗', f.name, '→', f.status, f.body);
