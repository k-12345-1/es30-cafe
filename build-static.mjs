// Builds the standalone copy of the storefront used for GitHub Pages and for
// sharing a preview link. Same CSS, markup and app code as the real site, with
// the menu inlined and checkout simulated, because a static host cannot run the
// server or talk to Stripe.

import fs from 'node:fs';
import { MENU as SEED_MENU, SITE } from './menu.js';

// menu.json is the live menu once staff have edited it; menu.js is the seed.
const MENU = fs.existsSync('menu.json')
  ? JSON.parse(fs.readFileSync('menu.json', 'utf8'))
  : SEED_MENU;

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

// The artwork rides along as a data URI: one file to publish, and nothing to
// go missing on a host that only serves the page itself.
// Where the Pages copy lives, for its link-preview tags.
const PAGES_URL = 'https://k-12345-1.github.io/es30-cafe';

for (const name of ['banner.png', 'drink.png']) {
  const data = fs.readFileSync(`public/${name}`).toString('base64');
  body = body.replace(`src="${name}"`, `src="data:image/png;base64,${data}"`);
}

// The tab icon travels the same way.
const favicon = fs.readFileSync('public/favicon.png').toString('base64');

// The static build never takes a payment, so Stripe.js is not carried into it.
body = body.replace(/\n?\s*<script src="https:\/\/js\.stripe\.com[^>]*><\/script>/g, '');
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
    <div class="ticket-total"><span>Total</span><span>\${money(order.total)}</span></div>
    <form class="signup" id="signup" novalidate>
      <label class="signup-line" for="email">Want $5 on ES30 Cafe? Enter your email for a chance to win!</label>
      <div class="signup-row">
        <input type="email" id="email" name="email" autocomplete="email" placeholder="name@college.harvard.edu">
        <button type="submit" class="signup-go">Enter</button>
      </div>
      <p class="field-note" id="emailNote"></p>
    </form>\`;

  // No server in this build, so the entry is acknowledged and goes no further.
  el('confirmScreen').querySelector('#signup').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = el('email').value.trim();
    const note = el('emailNote');
    note.textContent = '';
    if (!email) { note.textContent = 'Pop your email in first.'; return; }
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(email)) {
      note.textContent = 'That does not look like an email address.';
      return;
    }
    e.target.innerHTML =
      '<p class="signup-line">Good luck! Check your email next Wednesday at 10am to see if you are the lucky winner!</p>';
  });

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

// The artifact host wraps its file in a document of its own. GitHub Pages
// serves the file as given, so the Pages copy has to be a complete page: no
// viewport meta means a phone lays it out at ~980px and shrinks everything.
const pagesDoc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#FFEBAF">
<meta name="description" content="Order snacks and drinks from ES30 Cafe.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ES30 Cafe">
<meta property="og:title" content="ES30 Cafe">
<meta property="og:description" content="Snacks and drinks for ES30.">
<meta property="og:url" content="${PAGES_URL}/">
<meta property="og:image" content="${PAGES_URL}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="ES30 Cafe: a cookie and a can of Celsius">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="data:image/png;base64,${favicon}">
<!--
  Static build of the storefront, served by GitHub Pages.
  Checkout is simulated, the giveaway entry goes nowhere and stock resets on
  reload, because a static host cannot run the Node server.
  For real payments, real entries and real stock, run the app:
  npm install && npm start   (see README.md)
-->
${page.replace(/\n?<script>/, '\n</head>\n<body>\n<script>')}
</body>
</html>
`;

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/index.html', pagesDoc);
// A preview card has to be a real file at a real address; a data URI will not do.
fs.copyFileSync('public/og.png', 'docs/og.png');

const out = process.argv[2];
if (out) fs.writeFileSync(out, page);

console.log(`built docs/index.html${out ? ` and ${out}` : ''}`);
