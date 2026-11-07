const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const checks = [
  ['nodeIntegration disabled', /nodeIntegration:\s*false/.test(main)],
  ['context isolation enabled', /contextIsolation:\s*true/.test(main)],
  ['sandbox enabled', /sandbox:\s*true/.test(main)],
  ['web security enabled', /webSecurity:\s*true/.test(main)],
  ['production DevTools disabled', /devTools:\s*!app\.isPackaged/.test(main)],
  ['CSP configured', /Content-Security-Policy/.test(main)],
  ['IPC sender validation', /event\.sender\s*!==\s*mainWindow\.webContents/.test(main)],
  ['save size limit', /MAX_SAVE_BYTES/.test(main)],
  ['HTTPS external URL check', /parsed\.protocol\s*===\s*'https:'/.test(main)],
];

const failed = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) process.exitCode = 1;
