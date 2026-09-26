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

- `server.js` — Express server, Stripe session creation, order lookup
- `menu.js` — the menu and its prices
- `public/index.html` — splash and menu
- `public/app.js` — cart, sheet, checkout
- `public/success.html` — order number confirmation
- `public/styles.css` — all styling, colors at the top

## Before taking real money

- Put it behind HTTPS. Stripe Checkout requires it in live mode.
- Add a Stripe webhook for `checkout.session.completed` if you want orders
  recorded even when someone closes the tab before the redirect lands.
- Decide what happens to `orders.json` when the server restarts on a host that
  does not keep disk between deploys.
