// The single source of truth for the ES30 Cafe menu.
// Prices are in cents so nothing ever rounds badly.
// Edit this file to change the menu; the storefront and Stripe both read from it.

// Shop details. Leave a field as an empty string and it renders nothing, so the
// page never shows hours, an address, or a policy you did not actually set.
export const SITE = {
  hours: '',        // e.g. 'Open daily 8:00 AM to 6:00 PM'
  address: '',      // e.g. 'KK Nagar, Madurai 625007'
  email: '',        // e.g. 'hello@es30.cafe'

  // The asterisked note at the foot of the menu. Empty means no note is shown.
  // Put an allergen or sourcing notice here if you need one.
  footnote: ''
};

// Sections hold groups, groups hold items. A group with an empty title just
// renders its items with no sub-heading above them.
export const MENU = [
  {
    section: 'Drinks',
    groups: [
      {
        title: '',
        items: [
          { id: 'celsius', name: 'Celsius',          price: 500 },
          {
            id: 'waiter',
            name: 'Bottle of WAiTER',
            price: 1000,
            desc: 'A bottle of water with AI in it to give you the perfect level of hydration.'
          }
        ]
      }
    ]
  },
  {
    section: 'Snacks',
    groups: [
      {
        title: 'Sweet',
        items: [
          { id: 'cookies-2', name: '2 Chocolate Chip Cookies', price: 500 },
          { id: 'oreos',     name: 'Oreos',     price: 100 }
        ]
      },
      {
        title: 'Savory',
        items: [
          { id: 'doritos-cool-ranch', name: 'Cool Ranch Doritos',        price: 300 },
          { id: 'doritos-nacho',      name: 'Nacho Cheese Doritos',      price: 300 },
          { id: 'cheetos-crunchy',    name: 'Cheetos Crunchy',           price: 300 },
          { id: 'popcorn-white-ched', name: 'White Cheddar Popcorn',     price: 300 },
          { id: 'lays-classic',       name: 'Classic Lays',              price: 300 },
          { id: 'sunchips-harvest',   name: 'Harvest Cheddar Sun Chips', price: 300 }
        ]
      }
    ]
  }
];

// Flat lookup so the server can price a cart without trusting the client.
export const ITEMS = Object.fromEntries(
  MENU.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => [i.id, i])))
);
