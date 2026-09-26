const BASE = process.env.BASE || 'http://localhost:4300';
const N = Number(process.env.N || 300);

const pct = (arr, p) => arr.length ? arr.sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;

async function burst(label, make, n = N) {
  const times = [];
  let failed = 0;
  const started = Date.now();
  await Promise.all(Array.from({ length: n }, async (_, i) => {
    const t0 = Date.now();
    try {
      const res = await make(i);
      if (!res.ok) failed++;
      await res.arrayBuffer();
    } catch { failed++; }
    times.push(Date.now() - t0);
  }));
  const wall = Date.now() - started;
  console.log(
    `${label.padEnd(34)} n=${n}  wall=${String(wall).padStart(5)}ms  ` +
    `p50=${String(pct(times, 0.5)).padStart(5)}ms  p95=${String(pct(times, 0.95)).padStart(5)}ms  ` +
    `max=${String(Math.max(...times)).padStart(5)}ms  failed=${failed}`
  );
  return { wall, failed };
}

// A visit is the page, its two pictures, the stylesheet, the script and the menu.
async function visit() {
  const paths = ['/', '/styles.css', '/app.js', '/banner.png', '/drink.png', '/api/menu'];
  await Promise.all(paths.map((p) => fetch(BASE + p).then((r) => r.arrayBuffer())));
}

console.log(`\nAgainst ${BASE}, ${N} at once\n`);

await burst('menu only', () => fetch(BASE + '/api/menu'));
await burst('full page load (6 requests each)', async () => { await visit(); return { ok: true, arrayBuffer: async () => {} }; });
await burst('cold menu again', () => fetch(BASE + '/api/menu'));

// Everyone checks out at once.
await fetch(BASE + '/api/stock', {
  method: 'POST',
  headers: { Authorization: 'Bearer secretcode', 'Content-Type': 'application/json' },
  body: JSON.stringify({ counts: { celsius: 9999 } })
});
await burst('checkout', (i) => fetch(BASE + '/api/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Load ' + i, cart: [{ id: 'celsius', qty: 1 }] })
}));
