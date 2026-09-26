const BASE = 'http://localhost:4300';
const AUTH = { Authorization: 'Bearer secretcode', 'Content-Type': 'application/json' };
const J = { 'Content-Type': 'application/json' };
let pass = 0, fail = 0;

async function check(label, fn) {
  try {
    const ok = await fn();
    if (ok) { pass++; console.log('  ✓', label); }
    else { fail++; console.log('  ✗', label); }
  } catch (err) { fail++; console.log('  ✗', label, '→', err.message); }
}
const get = (p, h) => fetch(BASE + p, { headers: h });
const post = (p, body, h = J) => fetch(BASE + p, { method: 'POST', headers: h, body: JSON.stringify(body) });

console.log('\nCustomer journey');
await check('page loads', async () => (await get('/')).status === 200);
await check('menu loads with items', async () => {
  const d = await (await get('/api/menu')).json();
  return d.menu.flatMap((s) => s.groups.flatMap((g) => g.items)).length === 10;
});
await check('stylesheet, script, pictures', async () => {
  const codes = await Promise.all(['/styles.css', '/app.js', '/banner.png', '/drink.png', '/favicon.ico']
    .map((p) => get(p).then((r) => r.status)));
  return codes.every((c) => c === 200);
});

let orderUrl;
await check('checkout takes an order', async () => {
  const r = await post('/api/checkout', { name: 'Regression Test', cart: [{ id: 'celsius', qty: 2 }, { id: 'oreos', qty: 1 }] });
  const d = await r.json();
  orderUrl = d.url;
  return r.ok && typeof d.url === 'string';
});
const sid = orderUrl?.split('session_id=')[1];
await check('order number comes back', async () => {
  const d = await (await get('/api/order?session_id=' + sid)).json();
  return d.orderNumber > 0 && d.lines.length === 2 && d.total === 1100;
});
await check('stock came down by the right amount', async () => {
  const d = await (await get('/api/menu')).json();
  const items = d.menu.flatMap((s) => s.groups.flatMap((g) => g.items));
  return items.find((i) => i.id === 'celsius').available === 10 && items.find((i) => i.id === 'oreos').available === 11;
});
await check('giveaway entry accepted', async () => (await post('/api/subscribe', { email: 'test@college.harvard.edu' })).ok);
await check('success page serves', async () => (await get('/success.html')).status === 200);

console.log('\nStaff');
await check('/admin redirects', async () => (await fetch(BASE + '/admin', { redirect: 'manual' })).status === 302);
await check('admin page serves', async () => (await get('/admin.html')).status === 200);
await check('dashboard needs the code', async () => (await get('/api/admin')).status === 401);
let admin;
await check('dashboard opens with the code', async () => {
  const r = await get('/api/admin', AUTH);
  admin = await r.json();
  return r.ok && admin.items.length === 10 && admin.orders.length >= 1;
});
await check('takings add up', () => admin.takings.today === 1100 && admin.takings.ordersToday === 1);
await check('giveaway entries listed', () => admin.subscribers.some((e) => e.email === 'test@college.harvard.edu'));
await check('order shows customer, items and number', () => {
  const o = admin.orders[0];
  return o.name === 'Regression Test' && o.lines.length === 2 && o.orderNumber === 1 && o.fulfilled === false;
});
await check('ticking an order off sticks', async () => {
  const id = admin.orders[0].id;
  await fetch(BASE + '/api/orders/' + id, { method: 'PATCH', headers: AUTH, body: JSON.stringify({ fulfilled: true }) });
  const again = await (await get('/api/admin', AUTH)).json();
  return again.orders[0].fulfilled === true;
});
await check('editing name and price shows on the menu', async () => {
  await fetch(BASE + '/api/items/lays-classic', { method: 'PATCH', headers: AUTH, body: JSON.stringify({ name: 'Classic Lays XL', price: 3.5 }) });
  const d = await (await get('/api/menu')).json();
  const item = d.menu.flatMap((s) => s.groups.flatMap((g) => g.items)).find((i) => i.id === 'lays-classic');
  return item.name === 'Classic Lays XL' && item.price === 350;
});
await check('setting inventory shows on the menu', async () => {
  await fetch(BASE + '/api/stock', { method: 'POST', headers: AUTH, body: JSON.stringify({ counts: { 'cheetos-crunchy': 4 } }) });
  const d = await (await get('/api/menu')).json();
  return d.menu.flatMap((s) => s.groups.flatMap((g) => g.items)).find((i) => i.id === 'cheetos-crunchy').available === 4;
});
await check('adding an item puts it on the menu', async () => {
  await fetch(BASE + '/api/items', { method: 'POST', headers: AUTH, body: JSON.stringify({ name: 'Test Bar', price: 2, section: 'Snacks', group: 'Sweet', stock: 5 }) });
  const d = await (await get('/api/menu')).json();
  return d.menu.flatMap((s) => s.groups.flatMap((g) => g.items)).some((i) => i.name === 'Test Bar');
});
await check('removing it takes it off, takings untouched', async () => {
  const d0 = await (await get('/api/menu')).json();
  const id = d0.menu.flatMap((s) => s.groups.flatMap((g) => g.items)).find((i) => i.name === 'Test Bar').id;
  await fetch(BASE + '/api/items/' + id, { method: 'DELETE', headers: AUTH });
  const d = await (await get('/api/menu')).json();
  const gone = !d.menu.flatMap((s) => s.groups.flatMap((g) => g.items)).some((i) => i.name === 'Test Bar');
  const t = await (await get('/api/admin', AUTH)).json();
  return gone && t.takings.today === 1100;
});

console.log('\nLive updates');
await check('event stream opens and speaks', async () => {
  const res = await fetch(BASE + '/api/events');
  const reader = res.body.getReader();
  const hello = new TextDecoder().decode((await reader.read()).value);
  const changed = new Promise(async (resolve) => {
    const t = setTimeout(() => resolve(false), 2500);
    while (true) {
      const { value, done } = await reader.read();
      if (done) return resolve(false);
      if (new TextDecoder().decode(value).includes('event: menu')) { clearTimeout(t); return resolve(true); }
    }
  });
  await fetch(BASE + '/api/stock', { method: 'POST', headers: AUTH, body: JSON.stringify({ counts: { oreos: 9 } }) });
  const heard = await changed;
  reader.cancel();
  return hello.includes(': open') && heard;
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
