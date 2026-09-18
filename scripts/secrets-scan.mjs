#!/usr/bin/env node
// Secret scanner (TEST-IMPLEMENTATION.md §3, SECURITY-IMPLEMENTATION.md T22).
// CI additionally runs gitleaks (pinned binary). This scanner has no dependencies so it also runs in
// the pre-commit hook. Usage: node scripts/secrets-scan.mjs [--staged] [files...]
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const PATTERNS = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['OpenAI-style key', /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['Groq key', /\bgsk_[A-Za-z0-9]{40,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Private key block', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  // aamarPay published sandbox signature key must not be committed (AAMARPAY-VERIFICATION.md)
  ['aamarPay sandbox key', /dbb74894e82415a2f7ff0ec3a97e4183/],
  ['aamarPay sandbox store id', /\baamarpaytest\b/],
  ['Credential in URL query', /[?&](api_key|signature_key)=[A-Za-z0-9]{12,}/],
  // Real-looking Bangladesh mobile numbers outside the reserved synthetic range +8801700000000–999
  ['Bangladesh phone outside synthetic range', /(?<![0-9])(\+?8801|01)[3-9][0-9]{8}(?![0-9])/],
];
const SYNTHETIC_PHONE = /(\+?88)?01700000[0-9]{3}/;
const SKIP = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /pnpm-lock\.yaml$/,
  /\.(png|jpg|jpeg|gif|ico|woff2?|ttf|otf|pdf|zip|gz|jar|keystore)$/i,
  /^tools\/medicine-data\//, // Stage M tool: public registry data (DGDA/Mendeley ids), not secrets
  /^teardown\//,
  /^docs\/implementation\/COMBINED-/,
  /^scripts\/secrets-scan\.mjs$/,
  /^tests\/architecture\/fixtures\//,
];
// Lines explicitly documenting a synthetic/fake value may opt out: `secrets-scan: allow <reason>`.
const ALLOW_MARK = /secrets-scan:\s*allow\s+\S+/;

function listFiles(args) {
  if (args.includes('--staged')) {
    return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  }
  const explicit = args.filter((a) => !a.startsWith('--'));
  if (explicit.length) return explicit;
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

const findings = [];
for (const file of listFiles(process.argv.slice(2))) {
  const rel = file.replace(/\\/g, '/');
  if (SKIP.some((re) => re.test(rel))) continue;
  let text;
  try {
    if (statSync(file).size > 2_000_000) continue;
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (ALLOW_MARK.test(line)) return;
    for (const [label, re] of PATTERNS) {
      const m = line.match(re);
      if (!m) continue;
      if (label.startsWith('Bangladesh phone') && SYNTHETIC_PHONE.test(m[0])) continue;
      findings.push(`${rel}:${i + 1}: ${label}`);
    }
  });
}

if (findings.length) {
  console.error(`secrets-scan: ${findings.length} finding(s). Values are not printed.`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log('secrets-scan: clean');
