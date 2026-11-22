/**
 * Statistical performance regression & changepoint detector over JSONL timing history
 * (Netflix CI performance gate pattern: 4-sigma anomaly gate + e-divisive changepoint).
 *
 * Usage (CLI):
 *   bun scripts/perfRegression.ts <history.jsonl> <metricName>
 *
 * Each JSONL line is an object containing numeric metric fields (e.g.
 * `{"sha":"abc123","medianFrame":8.2,"p75Frame":10.4,"jsHeapUsedMb":84}`).
 */

export interface SigmaGateResult {
  anomaly: boolean;
  latest: number;
  mean: number;
  stdDev: number;
  threshold: number;
  sampleSize: number;
}

export interface ChangepointResult {
  detected: boolean;
  index: number;
  beforeMean: number;
  afterMean: number;
  energyGain: number;
}

/**
 * Check whether the latest value exceeds `mean + sigma * stdDev` computed over the preceding
 * `window` runs (default: 40 runs, 4-sigma threshold). Uses a small floor on stdDev so
 * ultra-flat baselines don't false-alarm on sub-millisecond jitter.
 */
export function checkSigmaGate(values: readonly number[], window = 40, sigma = 4, minStdDev = 0.5): SigmaGateResult {
  if (values.length < 2) {
    const latest = values[values.length - 1] ?? 0;
    return { anomaly: false, latest, mean: latest, stdDev: 0, threshold: Infinity, sampleSize: 0 };
  }
  const latest = values[values.length - 1];
  const history = values.slice(Math.max(0, values.length - 1 - window), values.length - 1);
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance = history.reduce((acc, v) => acc + (v - mean) ** 2, 0) / history.length;
  const rawStd = Math.sqrt(variance);
  const stdDev = Math.max(rawStd, minStdDev);
  const threshold = mean + sigma * stdDev;
  return {
    anomaly: history.length >= 5 && latest > threshold,
    latest,
    mean,
    stdDev: rawStd,
    threshold,
    sampleSize: history.length,
  };
}

/**
 * Energy-distance (e-divisive) single changepoint test over the last `window` runs (default 100).
 * Finds the split `k` maximizing the two-sample energy statistic `E(A, B)` and flags a step
 * regression when the relative shift exceeds `minShiftRatio` and the standardized energy gain
 * exceeds `minEnergyZ` (prevents drift blindness that a rolling sigma window misses).
 */
export function detectChangepoint(
  values: readonly number[],
  window = 100,
  minSegment = 8,
  minShiftRatio = 0.15,
  minEnergyZ = 2.5,
): ChangepointResult {
  const series = values.slice(-window);
  const n = series.length;
  if (n < minSegment * 2) {
    return { detected: false, index: -1, beforeMean: 0, afterMean: 0, energyGain: 0 };
  }

  let bestIdx = -1;
  let bestGain = 0;
  let bestBefore = 0;
  let bestAfter = 0;

  for (let k = minSegment; k <= n - minSegment; k++) {
    const a = series.slice(0, k);
    const b = series.slice(k);
    const meanA = a.reduce((s, v) => s + v, 0) / a.length;
    const meanB = b.reduce((s, v) => s + v, 0) / b.length;
    if (meanB <= meanA) continue; // Only alert on regressions (increases)

    // 1D energy distance: 2*E|X-Y| - E|X-X'| - E|Y-Y'|
    const cross = meanAbsDiffTwo(a, b);
    const withinA = meanAbsDiffOne(a);
    const withinB = meanAbsDiffOne(b);
    const energy = 2 * cross - withinA - withinB;
    const scale = Math.max(withinA, withinB, 0.5);
    const weighted = ((k * (n - k)) / n) * (energy / scale);
    if (weighted > bestGain) {
      bestGain = weighted;
      bestIdx = k;
      bestBefore = meanA;
      bestAfter = meanB;
    }
  }

  const shiftRatio = bestBefore > 0 ? (bestAfter - bestBefore) / bestBefore : bestAfter > 0 ? 1 : 0;
  const detected = bestIdx >= 0 && shiftRatio >= minShiftRatio && bestGain >= minEnergyZ;
  return {
    detected,
    index: detected ? values.length - n + bestIdx : -1,
    beforeMean: bestBefore,
    afterMean: bestAfter,
    energyGain: bestGain,
  };
}

function meanAbsDiffOne(arr: readonly number[]): number {
  const n = arr.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) sum += Math.abs(arr[i] - arr[j]);
  }
  return (2 * sum) / (n * n);
}

function meanAbsDiffTwo(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (const x of a) for (const y of b) sum += Math.abs(x - y);
  return sum / (a.length * b.length);
}

export function parseJsonlMetric(jsonl: string, metric: string): number[] {
  const out: number[] = [];
  for (const line of jsonl.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>;
      const val = row[metric];
      if (typeof val === "number" && Number.isFinite(val)) out.push(val);
    } catch {
      // Skip malformed lines cleanly.
    }
  }
  return out;
}

export function evaluatePerfHistory(values: readonly number[]) {
  const sigma = checkSigmaGate(values);
  const changepoint = detectChangepoint(values);
  return {
    ok: !sigma.anomaly && !changepoint.detected,
    sigma,
    changepoint,
  };
}

if (import.meta.main) {
  const [file, metric] = process.argv.slice(2);
  if (!file || !metric) {
    console.error("Usage: bun scripts/perfRegression.ts <history.jsonl> <metricName>");
    process.exit(2);
  }
  const text = await Bun.file(file).text();
  const values = parseJsonlMetric(text, metric);
  const result = evaluatePerfHistory(values);
  console.log(JSON.stringify({ metric, count: values.length, ...result }, null, 2));
  if (!result.ok) process.exit(1);
}
