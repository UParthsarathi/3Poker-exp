// Builds the app with the test driver injected, serves it on 127.0.0.1-40
// (one origin per phone), runs the harness in headless Chrome, writes
// out/summary.txt, deletes the test rooms and exits.
// usage: node e2e/run.mjs smoke|S1,S34 [maxMinutes]
// env: CHROME=<chrome binary>, OUT=<dir>, REBUILD=1, NOCAP=1 (uncapped log),
//      PAGE=offline.html (single player / local pass-and-play: SP,MP,MP6)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = +process.env.PORT || 5391;
const names = (process.argv[2] || 'smoke').split(',');
const maxMin = +(process.argv[3] || 15);
const OUT = path.join(HERE, process.env.OUT || 'out'), DIST = path.join(HERE, process.env.DIST || 'dist');
const SB = 'https://xxkgxosmtvjhbzoxqnsf.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4a2d4b3NtdHZqaGJ6b3hxbnNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2OTc0MTksImV4cCI6MjA4MDI3MzQxOX0.DjYl3kA43ae4fHG_nOoQhAMAWZE4Miqgk3D9fIYVgLw';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const log = m => fs.appendFileSync(path.join(OUT, 'runner.log'), new Date().toISOString().slice(11, 19) + ' ' + m + '\n');

if (process.env.REBUILD || !fs.existsSync(path.join(DIST, 'index.html'))) {
  const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')).href);
  await build({
    root: ROOT, configFile: false, logLevel: 'warn', esbuild: { jsx: 'automatic' },
    plugins: [{ name: 'nocap', enforce: 'pre', transform(code, id) {
      // NOCAP=1: build fix B alone (uncapped log) so big states still reach the TOAST path.
      if (!process.env.NOCAP || !id.includes('gameReducer')) return null;
      const out = code.replace('turnLog: next.turnLog.slice(-LOG_LIMIT)', 'turnLog: next.turnLog');
      if (out === code) throw new Error('NOCAP: cap line not found');
      log('NOCAP applied'); return out;
    } }, { name: 'tri-test', transformIndexHtml: h => h.replace('<head>', '<head><script src="/__driver.js"></script>').replace('<script src="https://cdn.tailwindcss.com"></script>', '') }],
    build: { outDir: DIST, emptyOutDir: true, minify: false, reportCompressedSize: false }
  });
  log('built');
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const reports = {};
const handler = (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/__report') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      try {
        const r = JSON.parse(b);
        reports[r.name] = r;
        fs.writeFileSync(path.join(OUT, r.name + '.txt'), r.text);
        if (r.final) log('final ' + r.name);
        if (names.every(n => reports[n] && reports[n].final)) finish('all done');
      } catch (e) { log('bad report ' + e.message); }
      res.end('ok');
    });
    return;
  }
  let file = url.pathname === '/__driver.js' ? path.join(HERE, 'driver.js')
    : url.pathname === '/__harness' ? path.join(HERE, process.env.PAGE || 'harness.html')
    : path.join(DIST, decodeURIComponent(url.pathname));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(url.pathname)) { res.writeHead(404); res.end(); return; }
    file = path.join(DIST, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
};
// Loopback only (no firewall prompt); each 127.0.0.x is its own origin.
const servers = [];
for (let i = 1; i <= 40; i++) servers.push(http.createServer(handler).listen(PORT, '127.0.0.' + i));

const prof = path.join(HERE, 'profile-' + PORT);
fs.rmSync(prof, { recursive: true, force: true });
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome');
const chrome = spawn(CHROME, [
  ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
  '--headless=new', '--user-data-dir=' + prof, '--window-size=2600,1700',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process,CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  `http://127.0.0.1:${PORT}/__harness?s=${names.join(',')}`
], { stdio: 'ignore' });
chrome.on('exit', c => { log('chrome exited ' + c); setTimeout(() => finish('chrome exited'), 2000); });
log(`started ${names} (max ${maxMin} min)`);

let finishing = false;
async function finish(why) {
  if (finishing) return;
  finishing = true;
  log('finish: ' + why);
  for (const c of Object.values(reports).map(r => r.code).filter(Boolean)) {
    try {
      const r = await fetch(`${SB}/rest/v1/rooms?code=eq.${c}`, { method: 'DELETE', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, Prefer: 'return=representation' } });
      log(`cleanup room ${c}: ${(await r.text()).length > 2 ? 'deleted leftover row' : 'already gone'}`);
    } catch (e) { log('cleanup failed ' + c + ' ' + e.message); }
  }
  try { if (process.platform === 'win32') execSync(`taskkill /PID ${chrome.pid} /T /F`, { stdio: 'ignore' }); else chrome.kill('SIGKILL'); } catch {}
  const text = names.map(n => reports[n] ? reports[n].text : `== ${n}: no report`).join('\n\n');
  fs.writeFileSync(path.join(OUT, 'summary.txt'), text + '\n\n-- runner --\n' + fs.readFileSync(path.join(OUT, 'runner.log'), 'utf8'));
  servers.forEach(s => s.close());
  setTimeout(() => process.exit(0), 500);
}
setTimeout(() => finish(`timeout ${maxMin} min`), maxMin * 60000);
