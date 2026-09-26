// 300 browsers sitting on the menu, then a staff edit, and how long the news
// takes to reach them.
import http from 'node:http';

const N = 300;
const clients = [];
let connected = 0;
let got = 0;
let firstAt = 0, lastAt = 0;

await new Promise((done) => {
  for (let i = 0; i < N; i++) {
    const req = http.get({ host: 'localhost', port: 4300, path: '/api/events' }, (res) => {
      connected++;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (chunk.includes('event: menu')) {
          const now = Date.now();
          if (!firstAt) firstAt = now;
          lastAt = now;
          got++;
        }
      });
      if (connected === N) done();
    });
    req.on('error', () => {});
    clients.push(req);
  }
});

console.log('connected streams:', connected);
const mem0 = await (await fetch('http://localhost:4300/api/menu')).json() && process.memoryUsage().rss;

const sentAt = Date.now();
await fetch('http://localhost:4300/api/stock', {
  method: 'POST',
  headers: { Authorization: 'Bearer secretcode', 'Content-Type': 'application/json' },
  body: JSON.stringify({ counts: { celsius: 11 } })
});

await new Promise((r) => setTimeout(r, 1500));
console.log(JSON.stringify({
  streams: connected,
  received: got,
  firstAfterMs: firstAt - sentAt,
  lastAfterMs: lastAt - sentAt
}, null, 1));

for (const c of clients) c.destroy();
