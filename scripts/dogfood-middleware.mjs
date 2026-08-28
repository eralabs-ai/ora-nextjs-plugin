#!/usr/bin/env node
// Dogfood for the @ora-ai/ax-nextjs/middleware runtime entry: boots the built `flagship` fixture with
// a real `next start` and probes it over HTTP — the same black-box posture as Ora's
// markdown-negotiation checks (dual-fetch of one URL with and without `Accept: text/markdown`
// must return different content types, correct bodies both ways, and `Vary: Accept` on the
// negotiated response). Unit tests already cover the branch logic; this proves the wiring holds
// through Next's Edge bundling, header merging, and static file serving on a real server —
// including flagship's composed form, `withAx({ manifest }, botGate)`, where the app's own
// middleware runs for every request ax's negotiation doesn't claim.
//
// Run after `pnpm fixtures:build` (the fixture must be built). Probes deliberately avoid the
// homepage: its twin is generated *post*build, so the first build's manifest doesn't list it yet
// (documented one-build staleness) — the hand-authored /destinations twin is the stable
// negotiation target.

import { execFile, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'flagship');
const port = 3100 + (process.pid % 500);
const origin = `http://127.0.0.1:${port}`;

const GPTBOT_UA = 'Mozilla/5.0; compatible; GPTBot/1.2; +https://openai.com/gptbot';
const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const CURSOR_UA =
  'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Cursor/0.40.0 Chrome/124.0.0.0 Safari/537.36';
const BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
};

let failures = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function varyCoversAccept(response) {
  return (response.headers.get('vary') ?? '')
    .split(',')
    .some((token) => token.trim().toLowerCase() === 'accept');
}

async function probe(path, headers) {
  const response = await fetch(`${origin}${path}`, { headers, redirect: 'manual' });
  const body = await response.text();
  return { response, body, contentType: response.headers.get('content-type') ?? '' };
}

// Node's fetch (undici) strips `sec-fetch-*` request headers, so the browser-navigation probe
// must go through curl — the one client here that sends exactly what it is told to.
async function probeCurl(path, headers) {
  const headerArgs = Object.entries(headers).flatMap(([name, value]) => [
    '-H',
    `${name}: ${value}`,
  ]);
  const { stdout } = await execFileAsync('curl', ['-s', ...headerArgs, `${origin}${path}`]);
  return stdout;
}

async function waitForServer(deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    try {
      await fetch(origin, { headers: BROWSER_HEADERS });
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`next start never answered on ${origin}`);
      await new Promise((resolvePause) => setTimeout(resolvePause, 250));
    }
  }
}

const server = spawn(join(fixtureDir, 'node_modules', '.bin', 'next'), ['start', '-p', `${port}`], {
  cwd: fixtureDir,
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (chunk) => process.stderr.write(`[next] ${chunk}`));

try {
  await waitForServer(30_000);
  console.log(`middleware dogfood against ${origin}`);

  // Ora's markdown-negotiation-vary semantics: the same URL, with and without the Accept header.
  const html = await probe('/destinations', BROWSER_HEADERS);
  check('browser /destinations is HTML', html.contentType.includes('text/html'), html.contentType);
  check('browser /destinations renders the page', html.body.includes('Where we fly'));

  const negotiated = await probe('/destinations', { ...BROWSER_HEADERS, accept: 'text/markdown' });
  check(
    'Accept: text/markdown /destinations is markdown',
    negotiated.contentType.includes('markdown'),
    negotiated.contentType,
  );
  check(
    'negotiated /destinations serves the twin body',
    negotiated.body.includes('# Where we fly (hand-authored twin)'),
  );
  check('negotiated /destinations carries Vary: Accept', varyCoversAccept(negotiated.response));
  check(
    'negotiated /destinations carries the canonical Link back to the HTML URL',
    /<[^>]*\/destinations>;\s*rel="canonical"/.test(negotiated.response.headers.get('link') ?? ''),
    negotiated.response.headers.get('link') ?? '(none)',
  );
  check(
    'the dual fetch returns two different content types',
    html.contentType.split(';')[0] !== negotiated.contentType.split(';')[0],
  );

  const agent = await probe('/destinations', { 'user-agent': GPTBOT_UA });
  check(
    'detected agent /destinations gets the markdown twin',
    agent.body.includes('# Where we fly (hand-authored twin)'),
  );
  check('agent /destinations carries Vary: Accept', varyCoversAccept(agent.response));

  // The two non-optional cloaking guards.
  const googlebot = await probe('/destinations', { 'user-agent': GOOGLEBOT_UA });
  check('Googlebot /destinations is never rerouted', googlebot.body.includes('Where we fly'));
  const cursorBody = await probeCurl('/destinations', {
    'user-agent': CURSOR_UA,
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
    accept: BROWSER_HEADERS.accept,
  });
  check("Cursor's embedded browser gets HTML", cursorBody.includes('Where we fly'));

  // The manifest is the contract: gated / dynamic fall through to the app. (The old twin-less
  // probe lives on in the markdown-twins fixture's /shell rung; every ungated flagship route in
  // the manifest has a twin.)
  const gated = await probe('/account', { 'user-agent': GPTBOT_UA });
  check('agent on a gated path is untouched', gated.body.includes('Sign in'));
  const dynamic = await probe('/destinations/jfk', { 'user-agent': GPTBOT_UA });
  check(
    'agent on a dynamic route gets the real page',
    // React SSR interleaves comment markers between text nodes, so never match the joined string.
    dynamic.contentType.includes('text/html') &&
      dynamic.body.includes('New York') &&
      dynamic.body.includes('JFK'),
  );
  // flagship's own middleware (the bot gate composed via withAx's second argument) still runs for
  // requests ax doesn't claim: a scripted UA on a plain page is challenged.
  const blocked = await probe('/destinations', { 'user-agent': 'curl/8.6.0' });
  check(
    'scripted UA is challenged by the composed app middleware',
    blocked.response.status === 403,
  );

  // The 404 doctrine: agents get a 200 wayfinding body, plain clients keep the honest 404.
  const wayfinding = await probe('/definitely-not-here', { 'user-agent': GPTBOT_UA });
  check('agent on an unknown URL gets 200 markdown wayfinding', wayfinding.response.status === 200);
  check(
    'wayfinding is markdown with directions',
    // Asserted against real routes, not the catalog link: on the very first build the prebuild
    // manifest predates the postbuild-written catalog (one-build staleness), so only route links
    // are guaranteed both before and after the fixture has ever been built twice.
    wayfinding.contentType.includes('markdown') &&
      wayfinding.body.startsWith('# /definitely-not-here — not found') &&
      wayfinding.body.includes('[/destinations](/destinations)'),
  );
  check('wayfinding carries Vary: Accept', varyCoversAccept(wayfinding.response));
  const miss = await probe('/definitely-not-here', BROWSER_HEADERS);
  check('plain client on an unknown URL keeps the honest 404', miss.response.status === 404);
} finally {
  server.kill('SIGTERM');
}

if (failures > 0) {
  console.error(`\n${failures} middleware dogfood probe(s) failed.`);
  process.exit(1);
}
console.log('\nAll middleware dogfood probes passed.');
