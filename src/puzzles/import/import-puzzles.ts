// Imports a slice of lichess's puzzle database into the pool:
//
//   npm run puzzles:import -- [--limit 50000] [--file lichess_db_puzzle.csv(.zst)]
//
// With no --file it streams the database from lichess (a few hundred MB,
// zstd-compressed, read as it arrives); a .zst file is decompressed the
// same way, a .csv read as it is. Puzzles already in the pool are updated
// - their rating and votes move - so it can be run again. Run once per
// environment; in production, where the image has no build tools, the built
// script itself: docker compose exec api node
// dist/puzzles/import/import-puzzles.js.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createZstdDecompress } from 'node:zlib';
import { parseArgs } from 'node:util';

import { AppDataSource } from '../../database/data-source.js';
import { Puzzle } from '../entities/puzzle.entity.js';
import {
  LICHESS_PUZZLES_URL,
  makeSelector,
  parseRow,
  type PuzzleRow,
} from './lichess-csv.js';
import { skipLeadingSkippableFrames } from './zstd.js';

const BATCH = 1000;

const unzstd = (stream: NodeJS.ReadableStream) =>
  stream.pipe(skipLeadingSkippableFrames()).pipe(createZstdDecompress());

async function source(
  file: string | undefined,
): Promise<NodeJS.ReadableStream> {
  if (file) {
    const stream = createReadStream(file);
    return file.endsWith('.zst') ? unzstd(stream) : stream;
  }
  const response = await fetch(LICHESS_PUZZLES_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Couldn't fetch the puzzles: ${response.status}`);
  }
  return unzstd(Readable.fromWeb(response.body as never));
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      limit: { type: 'string', default: '50000' },
      file: { type: 'string' },
    },
  });
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('--limit must be a whole number above 0');
  }
  const keep = makeSelector(limit);
  await AppDataSource.initialize();
  const puzzles = AppDataSource.getRepository(Puzzle);
  let batch: PuzzleRow[] = [];
  let kept = 0;
  let read = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    await puzzles.upsert(batch, ['id']);
    kept += batch.length;
    batch = [];
  };
  const lines = createInterface({ input: await source(values.file) });
  for await (const line of lines) {
    read += 1;
    const row = parseRow(line);
    if (!row || !keep(row)) continue;
    batch.push(row);
    if (batch.length >= BATCH) {
      await flush();
      console.log(`${kept} kept of ${read} read`);
    }
    if (kept + batch.length >= limit) break;
  }
  await flush();
  lines.close();
  console.log(`Done: ${kept} puzzles kept of ${read} read`);
  await AppDataSource.destroy();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
