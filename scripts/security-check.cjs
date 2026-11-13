const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const { getSafeExternalUrl } = require(path.join(root, 'electron', 'security.cjs'));
const htmlPaths = [path.join(root, 'index.html')];
const builtHtmlPath = path.join(root, 'dist', 'index.html');
if (fs.existsSync(builtHtmlPath)) htmlPaths.push(builtHtmlPath);

function getContentSecurityPolicy(html) {
  return html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/iu)?.[1] ?? '';
}

function hasProductionContentSecurityPolicy(html) {
  const csp = getContentSecurityPolicy(html);
  const directives = new Map(csp.split(';').map((directive) => {
    const [name, ...values] = directive.trim().split(/\s+/u);
    return [name, values];
  }));
  const has = (directive, value) => directives.get(directive)?.includes(value) ?? false;
  const connectSources = directives.get('connect-src') ?? [];
  return (
    has('default-src', "'self'") &&
    has('base-uri', "'self'") &&
    has('object-src', "'none'") &&
    has('script-src', "'self'") &&
    !has('script-src', "'unsafe-inline'") &&
    !has('script-src', "'unsafe-eval'") &&
    has('style-src', "'self'") &&
    has('img-src', "'self'") &&
    has('worker-src', "'self'") &&
    has('frame-src', "'none'") &&
    has('form-action', "'self'") &&
    connectSources.length === 1 &&
    connectSources[0] === "'self'"
  );
}

const externalUrlCases = [
  ['https://example.com', 'https://example.com/'],
  ['https://example.com/path?q=1', 'https://example.com/path?q=1'],
  ['http://example.com', null],
  ['https://user:password@example.com', null],
  ['https://user@example.com', null],
  ['javascript:alert(1)', null],
  ['not a URL', null],
];
const externalUrlCheck = externalUrlCases.every(([input, expected]) =>
  getSafeExternalUrl(input) === expected,
);

const checks = [
  ['nodeIntegration disabled', /nodeIntegration:\s*false/.test(main)],
  ['context isolation enabled', /contextIsolation:\s*true/.test(main)],
  ['sandbox enabled', /sandbox:\s*true/.test(main)],
  ['web security enabled', /webSecurity:\s*true/.test(main)],
  ['production DevTools disabled for all windows', (main.match(/devTools:\s*!app\.isPackaged/gu) ?? []).length === 3],
  ['strict production CSP configured', htmlPaths.every((filePath) =>
    hasProductionContentSecurityPolicy(fs.readFileSync(filePath, 'utf8')),
  )],
  ['IPC sender validation', /event\.sender\s*!==\s*mainWindow\.webContents/.test(main)],
  ['save size limit', /MAX_SAVE_BYTES/.test(main)],
  ['HTTPS external URL check without credentials', externalUrlCheck && main.includes('getSafeExternalUrl(url)')],
];

const failed = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) process.exitCode = 1;
