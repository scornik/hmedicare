#!/usr/bin/env node
// SMS-002 capture (ZAMANIT-VERIFICATION §0/§3): calls the staging worker's redacted diagnostics endpoint
// and stores the result as a fixture for the adapter parser. Human-run only, never in CI.
//
//   WORKER_URL=https://worker-staging.<domain> INTERNAL_DIAGNOSTICS_TOKEN=... pnpm ops:capture-sms-probe
//
// The token is sent as a bearer header only. The worker already redacts; this script re-checks the capture
// for anything key- or phone-shaped and refuses to write it if something slipped through.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workerUrl = process.env.WORKER_URL;
const token = process.env.INTERNAL_DIAGNOSTICS_TOKEN;
if (process.env.CI === 'true') {
  console.error('capture-sms-probe: refuses to run in CI');
  process.exit(2);
}
if (!workerUrl || !token) {
  console.error('capture-sms-probe: WORKER_URL and INTERNAL_DIAGNOSTICS_TOKEN are required');
  process.exit(2);
}
const url = new URL('/internal/diagnostics/sms-balance', workerUrl);
if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
  console.error('capture-sms-probe: WORKER_URL must be https (the bearer token must not cross plain http)');
  process.exit(2);
}

const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, redirect: 'error' });
const text = await res.text();
if (!res.ok) {
  console.error(`capture-sms-probe: worker answered ${res.status}`);
  process.exit(1);
}

/** Leak checks: the diagnostics token, `api_key=` pairs, and phone-shaped digit runs. */
const leaks = [];
if (text.includes(token)) leaks.push('diagnostics token');
if (/api_key=[^&"\s]+/i.test(text)) leaks.push('api_key pair');
if (/(?<![\d.])\+?(?:880|0)1[3-9]\d{8}(?!\d)/.test(text)) leaks.push('phone number');
if (leaks.length) {
  console.error(`capture-sms-probe: refusing to store the capture (found: ${leaks.join(', ')})`);
  process.exit(1);
}

const { data } = JSON.parse(text);
const day = String(data.capturedAt).slice(0, 10);
const dir = path.join(root, 'packages/communication-adapters/zamanit/test/fixtures/verified');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${day}-checkbalance.json`);
writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

const r = data.result ?? {};
const cb = r.checkbalance ?? {};
const tls = r.httpsProbe ?? {};
const summary = [
  `checkbalance ${cb.transport ?? '?'} ${cb.status ?? cb.outcome} → ${cb.parsed?.outcome ?? '?'}` +
    (cb.parsed?.parseStatus ? `/${cb.parsed.parseStatus}` : '') +
    (cb.parsed?.errorClass ? `/${cb.parsed.errorClass}` : ''),
  `HTTPS ${tls.host ?? '?'}:443 ${tls.verified ? `verified (${tls.subject}, until ${tls.validTo})` : `not available (${tls.errorCode})`}`,
].join('; ');
console.log(`capture-sms-probe: wrote ${path.relative(root, file)}`);
console.log('Append to ZAMANIT-VERIFICATION.md §3:');
console.log(
  `| ${day} | SMS-002 | ZAMANIT-VER-01, ZAMANIT-VER-02 | ${summary} | \`${path.relative(root, file).replaceAll('\\', '/')}\` | <name> |`,
);
