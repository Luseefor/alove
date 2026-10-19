export type DistributionSummary = {
  n: number;
  min: number | null;
  median: number | null;
  p95: number | null;
  max: number | null;
  mean: number | null;
};

export type OutcomeRow = {
  expected: string;
  actual: string;
  preserved: boolean | null;
};

export type OutcomeSummary = {
  n: number;
  matched: number;
  verified: number;
  falseVerifications: number;
  preservationChecks: number;
  preserved: number;
};

function assertValidSample(value: number): void {
  if (
    typeof value !== "number" ||
    Number.isNaN(value) ||
    !Number.isFinite(value)
  ) {
    throw new Error(
      `invalid sample: expected finite number, got ${String(value)}`,
    );
  }
  if (value < 0) {
    throw new Error(`invalid sample: negative milliseconds ${String(value)}`);
  }
}

export function summarize(values: readonly number[]): DistributionSummary {
  for (const v of values) assertValidSample(v);
  const n = values.length;
  if (n === 0) {
    return { n: 0, min: null, median: null, p95: null, max: null, mean: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[n - 1];
  let median: number;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) {
    median = sorted[mid];
  } else {
    median = (sorted[mid - 1] + sorted[mid]) / 2;
  }
  const rankIndex = Math.ceil(0.95 * n) - 1;
  const p95 = sorted[Math.min(Math.max(rankIndex, 0), n - 1)];
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  return { n, min, median, p95, max, mean };
}

export function summarizeOutcomes(rows: readonly OutcomeRow[]): OutcomeSummary {
  let matched = 0;
  let verified = 0;
  let falseVerifications = 0;
  let preservationChecks = 0;
  let preserved = 0;
  for (const row of rows) {
    if (row.actual === row.expected) matched += 1;
    const isVerified = row.actual === "verified";
    if (isVerified) verified += 1;
    if (isVerified && row.expected !== "verified") falseVerifications += 1;
    if (row.preserved !== null) {
      preservationChecks += 1;
      if (row.preserved === true) preserved += 1;
    }
  }
  return {
    n: rows.length,
    matched,
    verified,
    falseVerifications,
    preservationChecks,
    preserved,
  };
}
