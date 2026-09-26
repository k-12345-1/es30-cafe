// The week, moment by moment, with and without staff starting the break.
import { execFileSync } from 'node:child_process';

const src = (name) => execFileSync('sed', ['-n', `/^function ${name}/,/^}/p`, 'server.js']).toString();

const probe = `
  const BREAK_MINUTES = 10, GRACE_MINUTES = 5, OPENS_LEAD_MINUTES = 60, SOON_HOLD_MINUTES = 120;
  const OPEN_WEEKDAY = 3, OPEN_HOUR = 12, OPEN_MINUTE = 0;
  ${src('cycle')}
  ${src('cafeState')}
  const [iso, brkJson] = process.argv.slice(1);
  const s = cafeState(JSON.parse(brkJson), new Date(iso).getTime());
  const at = new Date(iso).getTime();
  console.log(JSON.stringify({
    mode: s.mode,
    counting: s.target ? Math.round((s.target - at) / 60000) + ' min' : '-',
    orders: s.ordersOpen
  }));
`;

const run = (iso, brk = {}) => JSON.parse(execFileSync('node',
  ['-e', probe, iso, JSON.stringify(brk)], { env: { ...process.env, TZ: 'America/New_York' } }));

const show = (label, r) =>
  console.log(label.padEnd(42), r.mode.padEnd(8), '| counting', String(r.counting).padEnd(8), '| orders', r.orders ? 'OPEN' : 'shut');

console.log('\nNobody has pressed start yet\n');
show('Wed 11:59 (before the hour)', run('2026-09-30T11:59:00'));
show('Wed 12:00 (the hour begins)', run('2026-09-30T12:00:00'));
show('Wed 12:30', run('2026-09-30T12:30:00'));
show('Wed 12:59', run('2026-09-30T12:59:00'));
show('Wed 13:00 (hour up)', run('2026-09-30T13:00:00'));
show('Wed 13:45 (still waiting on staff)', run('2026-09-30T13:45:00'));
show('Wed 16:00 (given up waiting)', run('2026-09-30T16:00:00'));

// Staff press start at 13:02, so the break ends at 13:12.
const started = { endsAt: new Date('2026-09-30T13:12:00').getTime() };
console.log('\nStaff press start at 13:02\n');
show('Wed 13:03 (break running)', run('2026-09-30T13:03:00', started));
show('Wed 13:11 (last minute)', run('2026-09-30T13:11:00', started));
show('Wed 13:12 (clock runs out)', run('2026-09-30T13:12:00', started));
show('Wed 13:16 (grace)', run('2026-09-30T13:16:30', started));
show('Wed 13:17 (till shuts)', run('2026-09-30T13:17:30', started));
show('Thu 12:30 (next day)', run('2026-10-01T12:30:00', started));
show('Next Wed 12:30 (hour again)', run('2026-10-07T12:30:00', started));
