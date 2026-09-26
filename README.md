# ES30 Cafe

A one-page storefront: logo splash, View Menu scrolls to the menu, add items from
the button on the right, checkout with a name through Stripe, then an order number.

## Look

Built to the structure of the reference menu cards: a notched ribbon logo, a
phone-shaped card, handwritten type, big uppercase section headings with
sub-headings under them, dotted leaders running from each item to its price, a
doodle-plus-note block, and an optional footnote.

On a desktop the card sits centered on the blue ground, the way a phone mockup
does. Under 520px wide the card becomes the whole screen and loses its corners
and shadow.

Palette lives at the top of `public/styles.css`:

| Variable  | Value     | Used for                                   |
|-----------|-----------|--------------------------------------------|
| `--blue`  | `#4C9DB0` | the ground behind the card                 |
| `--cream` | `#FFEBAF` | the card itself                            |
| `--ink`   | `#2F6A79` | text, doodles, buttons (the same blue pushed deeper so small handwriting stays readable on yellow) |

Type is Shantell Sans for headings, prices, and buttons, and Architects Daughter
for item names and notes.

### The doodles

They are inline SVG in `index.html` and `success.html`, drawn back to front.
Closed shapes carry `fill="var(--cream)"` so each object hides the lines of
whatever sits behind it, which is what makes the croissant read as solid rather
than as a wire outline over the napkin. If you add one, give it a `width` **and**
an `aspect-ratio` in CSS: an SVG with only a width collapses to zero height
inside a flex column.

## Run it

```bash
npm install
npm start
```

Open http://localhost:4242

With no Stripe key set, the site runs in **demo mode**: checkout skips straight to
the confirmation and nothing is charged. Good for showing the flow.

## Turning on real payments

1. Get your secret key from the Stripe dashboard (Developers, API keys).
2. Put it in `.env`:

```
STRIPE_SECRET_KEY=sk_test_...
PUBLIC_URL=http://localhost:4242
```

3. Restart the server. Demo mode turns itself off.

Test card in Stripe test mode: `4242 4242 4242 4242`, any future expiry, any CVC.

When you go live, swap in the `sk_live_` key and set `PUBLIC_URL` to your real
domain. Stripe needs that to send people back to the confirmation page.

## Shop details and notes

`SITE` at the top of `menu.js` holds the hours, address, email, the handwritten
note beside the doodle, and the footnote. Everything except the note ships blank
and renders nothing when empty, so the page never shows hours, an address, or a
policy you did not actually set.

```js
export const SITE = {
  hours: 'Open daily 8:00 AM to 6:00 PM',
  address: 'Your street, your city',
  email: 'hello@es30.cafe',
  note: { title: 'Before you check out', lines: ['add a name for the order'] },
  footnote: ''   // e.g. an allergen notice; empty means no footnote is shown
};
```

## Stock

Every item has a count. Customers cannot order more than that count, and it
drops as orders are paid for, so twelve Celsius cannot become thirteen orders.

Set the counts at **/admin.html** on the running site. The starting counts come
from the `stock` value on each item in `menu.js`, used only to seed `stock.json`
the first time the server runs; after that `stock.json` is the live record and
the staff page is how you change it.

On the storefront an item that runs out shows "sold out" instead of a plus, the
plus is disabled once the cart holds all that is left, and a line appears under
an item when it is down to the last three.

### How it holds together

- Availability is the on-hand count minus what unpaid checkouts are holding.
- Starting a checkout reserves its items for 30 minutes, matching the Stripe
  session expiry, so two people cannot both buy the last one while the first is
  still paying. The reservation lapses on its own if the payment never lands.
- The count is only actually reduced once the order is paid.
- Every read-modify-write of stock and orders is serialized, so simultaneous
  checkouts cannot read the same count and each think they got the last one.

### Who can change the counts

`ADMIN_TOKEN` in `.env` is the staff code. It is set on this machine already.
With it set, the stock page asks for the code from anywhere, including the till
itself. With it blank, the counts can only be changed from the machine the
server is running on.

The staff page asks for the code and remembers it in that browser.

`.env` is not in git, so the code is not in the public repo. Keep it that way:
anything committed here is readable by anyone.

### The stock page needs the server

`/admin.html` talks to `/api/stock`, so it only works where the Node app is
running. GitHub Pages serves static files and cannot run it, so the Pages URL
has a storefront but no working stock page. Deploy the app to a host that runs
Node, with a disk that persists, to have both at one address.

## Mailing list

On the confirmation screen, under the receipt: "Want $5 on ES30 Cafe? Enter your
email for a chance to win!" It sits there rather than at checkout so it is never
between a customer and paying. An address is saved to `subscribers.json`,
lowercased and de-duplicated, with the date it was added.

`POST /api/subscribe` always answers ok. Someone who has already paid should
never see an error over an optional extra; a malformed address is dropped
quietly and a file error is logged, not raised.

Read the list from the running site at `/api/subscribers`, which is behind the
same staff check as the stock page. `subscribers.json` is not in git.

## Editing the menu

`MENU` in `menu.js` is sections, each holding groups, each holding items:

```js
{
  section: 'Snacks',                     // the big uppercase heading
  groups: [
    { title: 'Sweet', items: [ ... ] },  // the sub-heading; '' for none
    { title: '',      items: [ ... ] }
  ]
}
```

Prices are in cents, so $5.00 is `500`. Each item needs a unique `id`. An
optional `desc` renders as small text under the name, matching the little
descriptions in the reference. Add a section or a group and the headings appear
on their own.

The server prices every cart from this file, so a customer cannot change what
they are charged by editing anything in their browser.

## Order numbers

Sequential per day starting at 1001, reset each morning. They are assigned only
after Stripe confirms payment, and the same checkout session always shows the same
number, so a refresh will not hand out a second one.

Orders are stored in `orders.json` next to the server. That is fine for one
machine. For anything bigger, replace `readOrders` and `writeOrder` in `server.js`
with a real database.

## Files

- `server.js` — Express server, stock, Stripe session creation, order lookup
- `menu.js` — the menu, prices and starting stock
- `stock.json` — the live count per item, written by the server (not in git)
- `subscribers.json` — mailing list signups (not in git)
- `build-static.mjs` — builds `docs/index.html`, the static copy for GitHub Pages
- `public/index.html` — splash and menu
- `public/app.js` — cart, sheet, checkout
- `public/success.html` — order number confirmation
- `public/admin.html` — the staff page for setting stock
- `public/styles.css` — all styling, colors at the top

## The GitHub Pages copy

`docs/index.html` is a standalone build served at the Pages URL. It has no
server, so checkout is simulated, giveaway entries go nowhere and stock resets
on reload. Rebuild it after changing the menu or the design:

```bash
node build-static.mjs
```

Then commit and push; Pages redeploys on its own.

The build writes two shapes from the same source. The preview copy is a fragment,
because the artifact host wraps it in a document of its own. The Pages copy is a
complete page with `<!doctype>`, `<head>` and a viewport meta, because Pages
serves the file exactly as given: without that meta a phone lays the page out at
about 980px and shrinks everything to fit.

## Before taking real money

- Put it behind HTTPS. Stripe Checkout requires it in live mode.
- Add a Stripe webhook for `checkout.session.completed` if you want orders
  recorded even when someone closes the tab before the redirect lands.
- Decide what happens to `orders.json` when the server restarts on a host that
  does not keep disk between deploys.
