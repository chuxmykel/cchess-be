import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { createZstdDecompress, zstdCompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { skipLeadingSkippableFrames } from './zstd.js';

const skippable = (payload: number[]) =>
  Buffer.concat([
    Buffer.from([0x50, 0x2a, 0x4d, 0x18]),
    Buffer.from(Uint32Array.of(payload.length).buffer),
    Buffer.from(payload),
  ]);

// The bytes in chunks of `size`, as a download arrives.
const decompress = (bytes: Buffer, size: number) => {
  const chunks: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    chunks.push(bytes.subarray(i, i + size));
  }
  return text(
    Readable.from(chunks)
      .pipe(skipLeadingSkippableFrames())
      .pipe(createZstdDecompress()),
  );
};

describe('skipLeadingSkippableFrames', () => {
  const data = zstdCompressSync(Buffer.from('a,b,c\n'.repeat(100)));

  it('reads a stream opening with a skippable frame, as lichess files do', async () => {
    const bytes = Buffer.concat([skippable([1, 2, 3, 4]), data]);

    for (const size of [1, 3, 8, 13, 64 * 1024]) {
      expect(await decompress(bytes, size)).toBe('a,b,c\n'.repeat(100));
    }
  });

  it('skips several, then leaves the rest alone', async () => {
    const bytes = Buffer.concat([
      skippable([]),
      skippable([9, 9, 9]),
      data,
      skippable([7]),
    ]);

    expect(await decompress(bytes, 5)).toBe('a,b,c\n'.repeat(100));
  });

  it('passes a plain stream through', async () => {
    expect(await decompress(data, 7)).toBe('a,b,c\n'.repeat(100));
  });
});
