/* A page that throws on load shows nothing, and a syntax check will not catch
   it: `const f = (x) = …` parses. So the browser scripts are run here, with
   the browser's own globals faked, and any throw fails the run. */

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

// Enough of a browser for a script to reach the bottom of the file.
function fakeWindow() {
  const node = () => new Proxy({
    style: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    dataset: {}, children: [], hidden: false, value: '', textContent: '', innerHTML: '',
    addEventListener() {}, removeEventListener() {}, appendChild() {}, setAttribute() {},
    getAttribute: () => null, closest: () => null, querySelector: () => null,
    querySelectorAll: () => [], focus() {}, blur() {}, scrollIntoView() {}, requestSubmit() {}
  }, { get: (t, k) => (k in t ? t[k] : undefined) });

  const doc = {
    getElementById: () => node(), querySelector: () => node(), querySelectorAll: () => [],
    createElement: () => node(), addEventListener() {}, body: node(),
    documentElement: node(), visibilityState: 'visible', fonts: { ready: Promise.resolve() },
    scripts: []
  };

  const win = {
    document: doc, addEventListener() {}, setTimeout, clearTimeout, setInterval: () => 0,
    clearInterval() {}, fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    EventSource: class { addEventListener() {} close() {} },
    location: { href: '/', search: '', hash: '' }, navigator: { clipboard: { writeText: async () => {} } },
    Intl, JSON, Math, Date, console, alert() {}, confirm: () => true, prompt: () => '',
    requestAnimationFrame: (fn) => setTimeout(fn, 0), matchMedia: () => ({ matches: false, addEventListener() {} })
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  return win;
}

for (const file of ['public/admin.js', 'public/app.js', 'public/orders.js']) {
  const source = readFileSync(file, 'utf8');
  const context = vm.createContext(fakeWindow());
  try {
    new vm.Script(source, { filename: file }).runInContext(context);
    check(`${file} loads without throwing`, true);
  } catch (err) {
    check(`${file} loads without throwing`, false, err.message);
  }
}

console.log(`\n${failures ? failures + ' failed' : 'Both scripts run.'}\n`);
process.exit(failures ? 1 : 0);
