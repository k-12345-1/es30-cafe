/* A rehearsal that costs nothing.

   Getting Stripe's card form to appear is itself the proof: the server can only
   hand one over if it created a real Checkout Session with the live secret key.
   So this asks for one, checks the stock went on hold, backs out again, and
   checks the stock came back. No card is entered and no money moves.

   Run it while the cafe is open (press Start the hour in the admin first):

     BASE=https://es30-cafe.onrender.com node test/stripe-check.mjs
*/

const BASE = process.env.BASE || 'http://localhost:4300';
const J = { 'Content-Type': 'application/json' };
let failures = 0;

const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

const menu = async () => {
  const d = await (await fetch(BASE + '/api/menu')).json();
  return { d, items: d.menu.flatMap((s) => s.groups.flatMap((g) => g.items)) };
};

console.log(`\nStripe rehearsal against ${BASE}\n`);

const first = await menu();
check('the cafe is taking orders', first.d.ordersOpen,
  first.d.ordersOpen ? '' : '← press Start the hour in the admin, then run this again');
if (!first.d.ordersOpen) process.exit(1);

check('not in demo mode', first.d.demo === false,
  first.d.demo ? '← STRIPE_SECRET_KEY is missing on the server' : '');
if (first.d.demo) {
  // Nothing below can mean anything: demo orders never reach Stripe at all.
  console.log('\nStopping here: this server is not talking to Stripe.\n');
  process.exit(1);
}
check('the browser key is a live key', String(first.d.stripeKey || '').startsWith('pk_live'),
  String(first.d.stripeKey || '').slice(0, 8));

// The cheapest thing with something left, so the hold is as small as possible.
const pick = first.items
  .filter((i) => i.available > 0)
  .sort((a, b) => a.price - b.price)[0];
check('something is in stock to try with', Boolean(pick), pick ? `${pick.name}, ${pick.available} left` : '');
if (!pick) process.exit(1);

const res = await fetch(BASE + '/api/checkout', {
  method: 'POST', headers: J,
  body: JSON.stringify({ name: 'Stripe rehearsal', cart: [{ id: pick.id, qty: 1 }] })
});
const started = await res.json();

check('Stripe gave us a card form', Boolean(started.clientSecret),
  started.clientSecret ? 'live session created' : JSON.stringify(started).slice(0, 120));
check('nothing was charged', !started.paid && !started.orderNumber);

const held = await menu();
const heldNow = held.items.find((i) => i.id === pick.id).available;
check('the item went on hold while paying', heldNow === pick.available - 1,
  `${pick.available} → ${heldNow}`);

// Back out, exactly as closing the card form does.
await fetch(BASE + '/api/checkout/abandon', {
  method: 'POST', headers: J, body: JSON.stringify({ sessionId: started.sessionId })
});

const after = await menu();
const backNow = after.items.find((i) => i.id === pick.id).available;
check('backing out put it straight back', backNow === pick.available, `${heldNow} → ${backNow}`);

console.log(`\n${failures ? failures + ' to look at' : 'All good: the live key works and no money moved.'}\n`);
process.exit(failures ? 1 : 0);
