export function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(
    sortedArr.length - 1,
    Math.floor((p / 100) * sortedArr.length),
  );
  return sortedArr[idx];
}

function computeOverallStats(values) {
  return {
    count: values.length,
    meanMs: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    maxMs: values[values.length - 1],
  };
}

// Min/max via a plain loop, not Math.min/max(...ats) - spreading a large
// array as call arguments blows V8's argument-count limit (hit this for
// real at 20,000 games: 200,000 samples raised "Maximum call stack size
// exceeded" here, after a multi-minute run had already completed).
function computeTimeSpan(samples) {
  let minAt = Infinity;
  let maxAt = -Infinity;
  for (const s of samples) {
    if (s.atMs < minAt) minAt = s.atMs;
    if (s.atMs > maxAt) maxAt = s.atMs;
  }
  return { minAt, span: maxAt - minAt || 1 };
}

// Bucketed by position within the samples' OWN time span (not from script
// start) - otherwise setup/connect time that isn't part of move-play
// dilutes the span and skews every sample into the last bucket.
function bucketByQuarter(samples, minAt, span) {
  const buckets = [[], [], [], []];
  for (const s of samples) {
    const q = Math.min(3, Math.floor(((s.atMs - minAt) / span) * 4));
    buckets[q].push(s.latencyMs);
  }
  return buckets;
}

function summarizeQuarters(buckets) {
  return buckets.map((bucket, i) => {
    const sorted = [...bucket].sort((a, b) => a - b);
    return sorted.length === 0
      ? { quarter: i + 1, count: 0 }
      : {
          quarter: i + 1,
          count: sorted.length,
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
        };
  });
}

/** Summarizes a set of {atMs, latencyMs} samples: overall percentiles, plus
 * the same percentiles split into quarters of the run's wall-clock duration,
 * so a degrading-under-sustained-load pattern is visible even when the
 * overall numbers look fine. */
export function summarizeLatencies(samples) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a.latencyMs - b.latencyMs);
  const values = sorted.map((s) => s.latencyMs);
  const overall = computeOverallStats(values);

  const { minAt, span } = computeTimeSpan(samples);
  const byQuarter = bucketByQuarter(samples, minAt, span);
  const quarters = summarizeQuarters(byQuarter);

  return { overall, byQuarterOfRun: quarters };
}
