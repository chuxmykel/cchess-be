#!/usr/bin/env node
// `npm run seed:generate -- src/database/seeds/SomeName`: typeorm-extension's
// `seed create`, then takes the template's `track = false` out - a seeder's
// own `track` wins over data-source.ts's `seedTracking: true`, so left in,
// the new seeder would run on every `seed:run` instead of once, untracked.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const name = process.argv[2];
if (!name) {
  console.error('Usage: npm run seed:generate -- src/database/seeds/SomeName');
  process.exit(1);
}

// Chosen here rather than by the CLI, so we know the file it writes.
const timestamp = Date.now();
execFileSync(
  process.execPath,
  [
    'node_modules/typeorm-extension/bin/cli.mjs',
    'seed',
    'create',
    '--name',
    name,
    '--timestamp',
    String(timestamp),
  ],
  { stdio: 'inherit' },
);

const file = path.join(
  path.dirname(name),
  `${timestamp}-${path.basename(name)}${path.extname(name) ? '' : '.ts'}`,
);
const TRACK_LINE = /^\s*track = false;\n/m;
const source = readFileSync(file, 'utf8');
if (!TRACK_LINE.test(source)) {
  console.error(
    `${file}: the template has no \`track = false;\` line any more - check ` +
      'it leaves the seeder tracked, and update scripts/seed-generate.mjs',
  );
  process.exit(1);
}
writeFileSync(file, source.replace(TRACK_LINE, ''));
execFileSync('npx', ['prettier', '--write', file], { stdio: 'inherit' });
