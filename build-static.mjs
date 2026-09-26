// Builds the standalone copy of the storefront used for GitHub Pages and for
// sharing a preview link. Same CSS, markup and app code as the real site, with
// the menu inlined and checkout simulated, because a static host cannot run the
// server or talk to Stripe.

import fs from 'node:fs';
import { MENU, SITE } from './menu.js';

const css  = fs.readFileSync('public/styles.css', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
let   app  = fs.readFileSync('public/app.js', 'utf8');

// Stock lives in stock.json on the server. A static build has no server, so the
// starting counts from menu.js become the availability for the session.
const menu = MENU.map((section) => ({
  ...section,
  groups: section.groups.map((group) => ({
    ...group,
    items: group.items.map(({ stock, ...item }) => ({
      ...item,
      available: Number.isFinite(stock) ? stock : 0
    }))
  }))
}));

let body = html.split('<body>')[1].split('<script src="app.js">')[0].trim();
body = body.replace('  </div>\n</div>',
  '\n    <div class="confirm" id="confirmScreen" hidden></div>\n  </div>\n</div>');

app = app.replace(
  `async function loadMenu() {
  const res = await fetch('/api/menu');
  const data = await res.json();
`,
  `async function loadMenu() {
  const data = PREVIEW_DATA;
`);
app = app.slice(0, app.indexOf("el('checkoutForm').addEventListener"));

const tail = `
/* ---------- checkout, simulated ----------
   The real site posts the cart to the server, which re-checks stock, prices the
   order and hands off to Stripe. This build does it in the page. */

let previewOrders = 0;

const esc = (str) => String(str).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const arcSize = (text) => Math.max(13, Math.min(30, Math.round(368 / (text.length * 0.56))));

const greetingArc = (name) => {
  const text = \`Thank you, \${esc(name)}!\`;
  return \`
    <svg class="ticket-arc" viewBox="0 0 400 92" role="img" aria-label="\${text}">
      <path id="greetArc" d="M18 84 Q200 24 382 84" fill="none"/>
      <text text-anchor="middle" font-size="\${arcSize(text)}">
        <textPath href="#greetArc" startOffset="50%">\${text}</textPath>
      </text>
    </svg>\`;
};

el('checkoutForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = el('name').value.trim();
  el('err').textContent = '';
  if (!name) { el('err').textContent = 'Please enter a name for the order.'; return; }

  const lines = [...state.cart].map(([id, qty]) => {
    const item = state.items[id];
    return { id, name: item.name, qty, total: item.price * qty };
  });

  // Take the stock, the way the server would once the order is paid.
  for (const line of lines) {
    state.items[line.id].available = Math.max(0, state.items[line.id].available - line.qty);
  }

  showTicket({ orderNumber: ++previewOrders, name, lines, total: cartTotal() });
});

function showTicket(order) {
  el('confirmScreen').innerHTML = \`
    \${greetingArc(order.name)}
    <p class="ticket-label">order</p>
    <p class="order-number"><span class="hash">#</span>\${order.orderNumber}</p>
    <p class="ticket-note">We will call this number when it is ready. Please have this screen visible to confirm your order.</p>
    <ul class="ticket-items">
      \${order.lines.map((l) => \`<li><span>\${l.qty} &times; \${esc(l.name)}</span><span>\${money(l.total)}</span></li>\`).join('')}
    </ul>
    <div class="ticket-total"><span>Total</span><span>\${money(order.total)}</span></div>\`;
  el('confirmScreen').hidden = false;
}

buildRibbons();
loadMenu().then(() => { restore(); renderCart(); });
`;

const extraCss = `
#confirmScreen {
  position: absolute;
  inset: 0;
  background: var(--cream);
  z-index: 70;
}

/* .confirm sets display:flex, which outranks the browser default for [hidden]. */
#confirmScreen[hidden] { display: none; }

:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .card-scroll { scroll-behavior: auto; }
}
`;

const page = `<title>ES30 Cafe</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Architects+Daughter&family=Archivo+Narrow:wght@700&display=swap" rel="stylesheet">
<style>
${css}
${extraCss}
</style>

${body}

<script>
const PREVIEW_DATA = ${JSON.stringify({ menu, site: SITE, currency: 'usd', demo: true })};

${app}${tail}
</script>
`;

const pagesNote = `<title>ES30 Cafe</title>
<!--
  Static build of the storefront, served by GitHub Pages.
  Checkout is simulated in the page and stock resets on reload, because a static
  host cannot run the Node server. For real payments and real stock, run the app:
  npm install && npm start   (see README.md)
-->`;

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/index.html', page.replace('<title>ES30 Cafe</title>', pagesNote));

const out = process.argv[2];
if (out) fs.writeFileSync(out, page);

console.log(`built docs/index.html${out ? ` and ${out}` : ''}`);
