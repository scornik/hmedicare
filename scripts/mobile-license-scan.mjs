#!/usr/bin/env node
// Mobile license scan (TECHNOLOGY-STACK.md §5, Stage 4 rule: every new dependency passes a license scan).
// Reads mobile/pubspec.lock, classifies each hosted package's LICENSE from the local pub cache and fails on
// copyleft or unrecognized licenses. Run after `flutter pub get` in mobile/.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = readFileSync(path.join(root, 'mobile/pubspec.lock'), 'utf8');

const cache =
  process.env.PUB_CACHE ??
  (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA ?? '', 'Pub', 'Cache')
    : path.join(os.homedir(), '.pub-cache'));

/** Minimal pubspec.lock reader: `  name:` blocks with `source: hosted` and `version: "x"`. */
function hostedPackages(text) {
  const out = [];
  const blocks = text.split(/\n {2}(?=[a-z0-9_]+:\n)/);
  for (const b of blocks) {
    const name = b.match(/^([a-z0-9_]+):\n/)?.[1];
    if (!name || !/\n {4}source: hosted/.test(b)) continue;
    out.push({ name, version: b.match(/\n {4}version: "([^"]+)"/)?.[1] });
  }
  return out;
}

const RULES = [
  ['GPL/LGPL/AGPL', /GNU (AFFERO |LESSER |LIBRARY )?GENERAL PUBLIC LICENSE/i, false],
  ['MPL-2.0', /Mozilla Public License/i, false],
  ['Apache-2.0', /Apache License,?\s+Version 2\.0/i, true],
  ['MIT', /Permission is hereby granted, free of charge/i, true],
  ['BSD-3-Clause', /Redistribution and use in source and binary forms[\s\S]*Neither the name/i, true],
  ['BSD-2-Clause', /Redistribution and use in source and binary forms/i, true],
  ['ISC', /Permission to use, copy, modify, and\/or distribute this software for any purpose/i, true],
  ['Zlib', /This software is provided 'as-is'[\s\S]*altered source versions must be plainly marked/i, true],
];

function classify(dir) {
  const file = readdirSync(dir).find((f) => /^(LICEN[CS]E|COPYING)(\.(md|txt))?$/i.test(f));
  if (!file) return ['NO LICENSE FILE', false];
  const text = readFileSync(path.join(dir, file), 'utf8');
  for (const [id, re, ok] of RULES) if (re.test(text)) return [id, ok];
  return ['UNRECOGNIZED', false];
}

const problems = [];
const counts = {};
const pkgs = hostedPackages(lock);
for (const { name, version } of pkgs) {
  const dir = path.join(cache, 'hosted', 'pub.dev', `${name}-${version}`);
  if (!existsSync(dir)) {
    problems.push(`${name}@${version}: not in pub cache (run flutter pub get in mobile/)`);
    continue;
  }
  const [id, ok] = classify(dir);
  counts[id] = (counts[id] ?? 0) + 1;
  if (!ok) problems.push(`${name}@${version}: ${id}`);
}

if (problems.length) {
  console.error(`mobile-license-scan: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`mobile-license-scan: clean (${pkgs.length} packages: ${JSON.stringify(counts)})`);
