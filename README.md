# ES30 Cafe

## Go live

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/k-12345-1/es30-cafe-admin)

One click, then set `ADMIN_TOKEN` (the staff code for `/admin.html`) when Render
asks. Everything else comes from `render.yaml`: the disk that keeps the menu,
stock, orders and giveaway entries, and the address Stripe returns customers to.
Leave `STRIPE_SECRET_KEY` unset to run in demo mode; add it when you are ready
to take real payments.

A one-page storefront: logo splash, View Menu scrolls to the menu, add items from
the button on the right, checkout with a name through Stripe, then an order number.

## Opening hours

At **noon Eastern every Wednesday** the clock at the top of the menu starts
counting down the hour before the cafe opens. When it reaches zero the menu
says **opening soon** and waits: the ten-minute break itself starts when staff
press the button, not before.

Orders are taken from the moment that hour begins, so people can get one in
before the rush, and keep being taken through the break and past the end of it
until staff press **stop**. That is what closes the till: the server refuses
checkouts from then on, so a stale tab cannot order after the counter has
packed up. If nobody presses it, the till closes itself an hour after the
break rather than selling all afternoon.

Change the schedule with environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `OPEN_WEEKDAY` | `3` | 0 Sunday to 6 Saturday, so 3 is Wednesday |
| `OPEN_TIME` | `12:00` | wall-clock time at the cafe |
| `TZ` | `America/New_York` | what "noon" means |

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
the admin page is how you change it.

On the storefront an item that runs out shows "sold out" instead of a plus, the
plus is disabled once the cart holds all that is left, and a countdown appears
under an item once it is into single figures.

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

## The admin page

`/admin.html` is the staff side. It shows takings for today and all time, the
stock counts, recent orders, and the giveaway entries with a Copy all button.
Items can be added and removed there, and the storefront picks the change up on
its next load.

Removing an item takes it off the menu only. Past orders keep their own copy of
the name and price, so receipts and takings are unaffected by a later change.

## Editing the menu

The live menu is `menu.json`, written the first time the server runs and edited
from the admin page after that. `menu.js` is only the seed, and is still the
place to change the starting menu before a first run. Its shape is sections,
each holding groups, each holding items:

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
- `menu.json` — the live menu, written by the server (not in git)
- `stock.json` — the live count per item, written by the server (not in git)
- `subscribers.json` — mailing list signups (not in git)
- `build-static.mjs` — builds `docs/index.html`, the static copy for GitHub Pages
- `public/index.html` — splash and menu
- `public/app.js` — cart, sheet, checkout
- `public/success.html` — order number confirmation
- `public/admin.html`, `admin.css`, `admin.js` — the staff side
- `public/styles.css` — all styling, colors at the top

## Deploying the real thing

`k-12345-1/es30-cafe-admin` is this same app, set up to run on a host. The
storefront, the admin page, stock, orders and the giveaway list all work there,
which GitHub Pages cannot do because it only serves static files.

`render.yaml` is a Render blueprint. From the Render dashboard, New → Blueprint,
pick the `es30-cafe-admin` repo, and it reads that file. Two things to set in
the dashboard rather than the repo:

- `ADMIN_TOKEN` — the staff code for the admin page
- `PUBLIC_URL` — `https://es30-cafe-admin.onrender.com` once the name is taken

Leave `STRIPE_SECRET_KEY` unset to run in demo mode, or set it for real payments.

The blueprint mounts a 1GB disk and points `DATA_DIR` at it. That matters: the
menu, stock, orders and entries are JSON files, and a host with an ephemeral
filesystem would wipe them on every deploy.

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
