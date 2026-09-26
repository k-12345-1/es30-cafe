// The week, moment by moment, with and without staff starting the break.
import { execFileSync } from 'node:child_process';

const src = (name) => execFileSync('sed', ['-n', `/^function ${name}/,/^}/p`, 'server.js']).toString();

// The schedule's own numbers, read from the server rather than copied here,
// so changing one there cannot leave this walk describing last month's cafe.
const constant = (name) => {
  const found = execFileSync('grep', ['-m1', `^const ${name} = `, 'server.js']).toString();
  return Number(found.match(/= *(\d+)/)[1]);
};

const probe = `
  const BREAK_MINUTES = ${constant('BREAK_MINUTES')};
  const OPENS_LEAD_MINUTES = ${constant('OPENS_LEAD_MINUTES')};
  const SERVING_LIMIT_MINUTES = ${constant('SERVING_LIMIT_MINUTES')};
  const SOON_HOLD_MINUTES = ${constant('SOON_HOLD_MINUTES')};
  const CLOSED_SIGN_MINUTES = ${constant('CLOSED_SIGN_MINUTES')};
  const OPEN_WEEKDAY = 3, OPEN_HOUR = 12, OPEN_MINUTE = 0;
  ${src('cycle')}
  ${src('cafeState')}
  const [iso, brkJson] = process.argv.slice(1);
  const s = cafeState(JSON.parse(brkJson), new Date(iso).getTime());
  const at = new Date(iso).getTime();
  console.log(JSON.stringify({
    mode: s.mode,
    counting: s.target ? Math.round((s.target - at) / 60000) + ' min' : '-',
    orders: s.ordersOpen,
    clock: s.show
  }));
`;

const run = (iso, brk = {}) => JSON.parse(execFileSync('node',
  ['-e', probe, iso, JSON.stringify(brk)], { env: { ...process.env, TZ: 'America/New_York' } }));

const show = (label, r) =>
  console.log(label.padEnd(42), r.mode.padEnd(8), '| counting', String(r.counting).padEnd(8),
    '| clock', r.clock ? 'on ' : 'off', '| orders', r.orders ? 'OPEN' : 'shut');

console.log('\nNobody has pressed start yet\n');
show('Wed 11:59 (before the hour)', run('2026-09-30T11:59:00'));
show('Wed 12:00 (the hour begins)', run('2026-09-30T12:00:00'));
show('Wed 12:30', run('2026-09-30T12:30:00'));
show('Wed 12:59', run('2026-09-30T12:59:00'));
show('Wed 13:00 (hour up)', run('2026-09-30T13:00:00'));
show('Wed 13:45 (still waiting on staff)', run('2026-09-30T13:45:00'));
show('Wed 13:59 (last minute of the wait)', run('2026-09-30T13:59:00'));
show('Wed 14:00 (the cycle is over)', run('2026-09-30T14:00:00'));
show('Wed 16:00 (given up waiting)', run('2026-09-30T16:00:00'));

// Staff press start at 13:02, so the break ends at 13:12.
const started = { endsAt: new Date('2026-09-30T13:12:00').getTime() };
console.log('\nStaff press start at 13:02\n');
show('Wed 13:03 (break running)', run('2026-09-30T13:03:00', started));
show('Wed 13:11 (last minute)', run('2026-09-30T13:11:00', started));
show('Wed 13:12 (clock runs out)', run('2026-09-30T13:12:00', started));
show('Wed 13:20 (still serving)', run('2026-09-30T13:20:00', started));

const stoppedToo = { ...started, closedAt: new Date('2026-09-30T13:21:00').getTime() };
show('Wed 13:22 (after staff press stop)', run('2026-09-30T13:22:00', stoppedToo));
show('Wed 13:59 (sign still up)', run('2026-09-30T13:59:00', stoppedToo));
show('Wed 14:30 (later that afternoon)', run('2026-09-30T14:30:00', stoppedToo));
show('Thu 12:30 (next day)', run('2026-10-01T12:30:00', started));

console.log('\nStaff try the hour by hand on a Saturday, at 13:00\n');
const byHand = { countdownAt: new Date('2026-10-03T13:00:00').getTime() };
show('Sat 13:30 (hour running)', run('2026-10-03T13:30:00', byHand));
show('Sat 14:15 (hour up)', run('2026-10-03T14:15:00', byHand));
const handStopped = { ...byHand, closedAt: new Date('2026-10-03T14:20:00').getTime() };
show('Sat 14:21 (after stop)', run('2026-10-03T14:21:00', handStopped));
show('Sun 10:00 (next morning)', run('2026-10-04T10:00:00', handStopped));

show('Next Wed 12:30 (hour again)', run('2026-10-07T12:30:00', started));
