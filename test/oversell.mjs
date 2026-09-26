const BASE = 'http://localhost:4300';
const AUTH = { Authorization: 'Bearer secretcode', 'Content-Type': 'application/json' };

// Put exactly 7 Celsius on the shelf.
await fetch(BASE + '/api/stock', { method: 'POST', headers: AUTH, body: JSON.stringify({ counts: { celsius: 7 } }) });

// 60 people try to buy 1 each at the same instant.
const attempts = await Promise.all(Array.from({ length: 60 }, (_, i) =>
  fetch(BASE + '/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Racer ' + i, cart: [{ id: 'celsius', qty: 1 }] })
  }).then(async (r) => ({ ok: r.ok, body: await r.json() }))
));

const sold = attempts.filter((a) => a.ok).length;
const refused = attempts.length - sold;

const menu = await (await fetch(BASE + '/api/menu')).json();
const left = menu.menu.flatMap((s) => s.groups.flatMap((g) => g.items)).find((i) => i.id === 'celsius').available;

console.log(JSON.stringify({ stockedWith: 7, buyers: 60, sold, refused, leftAfter: left, correct: sold === 7 && left === 0 }, null, 1));
