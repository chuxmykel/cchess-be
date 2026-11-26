import { Transform, type TransformCallback } from 'node:stream';

// zstd's skippable frames: 0x184D2A50-5F (little-endian), then a 4-byte
// length, then that many bytes of anything. Lichess's files are in zstd's
// seekable format, which opens with one - and Node's zstd decoder, given a
// stream starting with a skippable frame, stops there without a byte out
// (or errors, streaming). Later ones it skips as it should.
const HEADER = 8;

function skippableLength(buffer: Buffer): number | null {
  if (buffer.length < HEADER) return null;
  const magic = buffer.readUInt32LE(0);
  if ((magic & 0xfffffff0) !== 0x184d2a50) return -1;
  return HEADER + buffer.readUInt32LE(4);
}

/** A stream that drops any skippable frames at the start of a zstd stream,
 * passing the rest through untouched - for Node's decoder after it. */
export function skipLeadingSkippableFrames(): Transform {
  let pending: Buffer | null = Buffer.alloc(0);
  let toSkip = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done: TransformCallback) {
      if (pending === null) {
        done(null, chunk);
        return;
      }
      let buffer = Buffer.concat([pending, chunk]);
      for (;;) {
        if (toSkip > 0) {
          const skipped = Math.min(toSkip, buffer.length);
          buffer = buffer.subarray(skipped);
          toSkip -= skipped;
          if (toSkip > 0) {
            pending = Buffer.alloc(0);
            done();
            return;
          }
        }
        const length = skippableLength(buffer);
        if (length === null) {
          // Not enough yet to tell.
          pending = buffer;
          done();
          return;
        }
        if (length === -1) {
          pending = null;
          done(null, buffer);
          return;
        }
        toSkip = length;
      }
    },
    flush(done: TransformCallback) {
      done(null, pending && pending.length > 0 ? pending : undefined);
    },
  });
}
