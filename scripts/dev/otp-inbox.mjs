#!/usr/bin/env node
// `pnpm dev:otp` — prints the mock OTP code for the most recent challenge (local development only).
// Reads the challenge id from the dev database and the code from the API's dev inbox
// (`GET /internal/test/otp/:challengeId`, registered only when APP_ENV is development/test).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.loadEnvFile(path.join(root, '.env'));
if (!['development', 'test'].includes(process.env.APP_ENV ?? '')) {
  console.error('dev:otp: only for APP_ENV=development/test');
  process.exit(2);
}
const require = createRequire(path.join(root, 'packages/database/package.json'));
const mariadb = require('mariadb');
const apiBase = process.env.DEV_API_URL ?? 'http://localhost:3000';

const u = new URL(process.env.DATABASE_URL);
const conn = await mariadb.createConnection({
  host: u.hostname,
  port: Number(u.port) || 3306,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
});
const rows = await conn.query(
  // DATETIME columns hold UTC: compute the countdown in SQL so the local time zone never skews it.
  'SELECT id, status, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), expires_at) AS seconds_left FROM otp_challenges ORDER BY created_at DESC LIMIT 1',
);
await conn.end();
if (!rows.length) {
  console.log('dev:otp: no OTP challenge yet — tap "Send code" in the app first');
  process.exit(1);
}
const c = rows[0];
const res = await fetch(`${apiBase}/internal/test/otp/${c.id}`);
if (res.status !== 200) {
  console.log(
    `dev:otp: challenge ${c.id} (${c.status}) is not in the inbox (the api restarted?) — request a new code`,
  );
  process.exit(1);
}
const { code } = await res.json();
const left = Number(c.seconds_left);
console.log(
  `OTP code: ${code}   (${c.status}, ${left > 0 ? `expires in ${left}s` : 'EXPIRED — request a new code'})`,
);
