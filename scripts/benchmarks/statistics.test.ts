import { describe, expect, test } from "bun:test";
import { summarize, summarizeOutcomes } from "./statistics";

describe("summarize", () => {
  test("empty input returns nulls", () => {
    expect(summarize([])).toEqual({
      n: 0,
      min: null,
      median: null,
      p95: null,
      max: null,
      mean: null,
    });
  });

  test("single value distribution", () => {
    expect(summarize([42])).toEqual({
      n: 1,
      min: 42,
      median: 42,
      p95: 42,
      max: 42,
      mean: 42,
    });
  });

  test("odd-count median picks middle of sorted copy", () => {
    const s = summarize([30, 10, 20]);
    expect(s.n).toBe(3);
    expect(s.min).toBe(10);
    expect(s.median).toBe(20);
    expect(s.max).toBe(30);
    expect(s.mean!).toBeCloseTo(20, 10);
  });

  test("even-count median averages two middle values", () => {
    const s = summarize([1, 2, 3, 4]);
    expect(s.median).toBe(2.5);
    expect(s.mean!).toBeCloseTo(2.5, 10);
  });

  test("ties do not distort median/mean", () => {
    const s = summarize([5, 5, 5, 5]);
    expect(s.median).toBe(5);
    expect(s.mean).toBe(5);
    expect(s.min).toBe(5);
    expect(s.max).toBe(5);
    expect(s.p95).toBe(5);
  });

  test("outlier shifts mean but not median", () => {
    const s = summarize([10, 10, 10, 10, 1000]);
    expect(s.median).toBe(10);
    expect(s.mean!).toBeCloseTo(208, 10);
    expect(s.max).toBe(1000);
    expect(s.min).toBe(10);
  });

  test("p95 nearest-rank ceil(0.95*n)-1", () => {
    // n=20: ceil(19)-1 = 18 -> max of sorted 1..20
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(summarize(twenty).p95).toBe(19);
    // n=10: ceil(9.5)-1 = 9 -> sorted[9] = 10
    const ten = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(summarize(ten).p95).toBe(10);
  });

  test("p95 small N", () => {
    expect(summarize([7]).p95).toBe(7);
    // n=2: ceil(1.9)-1 = 1 -> max
    expect(summarize([3, 9]).p95).toBe(9);
    // n=3: ceil(2.85)-1 = 2 -> max
    expect(summarize([30, 10, 20]).p95).toBe(30);
  });

  test("does not mutate input", () => {
    const values = [30, 10, 20];
    const frozen = [...values];
    summarize(values);
    expect(values).toEqual(frozen);
  });

  test("rejects NaN, Infinity, and negative samples", () => {
    expect(() => summarize([1, Number.NaN])).toThrow();
    expect(() => summarize([1, Number.POSITIVE_INFINITY])).toThrow();
    expect(() => summarize([1, Number.NEGATIVE_INFINITY])).toThrow();
    expect(() => summarize([-1])).toThrow();
    expect(() => summarize([0, -0.001])).toThrow();
  });

  test("accepts zero milliseconds", () => {
    const s = summarize([0, 0, 10]);
    expect(s.min).toBe(0);
    expect(s.median).toBe(0);
  });
});

describe("summarizeOutcomes", () => {
  test("empty rows", () => {
    expect(summarizeOutcomes([])).toEqual({
      n: 0,
      matched: 0,
      verified: 0,
      falseVerifications: 0,
      preservationChecks: 0,
      preserved: 0,
    });
  });

  test("counts matches and verified", () => {
    const s = summarizeOutcomes([
      { expected: "verified", actual: "verified", preserved: true },
      { expected: "unresolved", actual: "unresolved", preserved: null },
      { expected: "incompatible", actual: "unresolved", preserved: false },
    ]);
    expect(s.n).toBe(3);
    expect(s.matched).toBe(2);
    expect(s.verified).toBe(1);
    expect(s.falseVerifications).toBe(0);
    expect(s.preservationChecks).toBe(2);
    expect(s.preserved).toBe(1);
  });

  test("negative controls do not inflate verified rate", () => {
    const s = summarizeOutcomes([
      { expected: "unresolved", actual: "verified", preserved: null },
      { expected: "incompatible", actual: "verified", preserved: null },
      { expected: "verified", actual: "verified", preserved: null },
    ]);
    expect(s.n).toBe(3);
    expect(s.verified).toBe(3);
    expect(s.falseVerifications).toBe(2);
    // Only one true verification: verified - falseVerifications
    expect(s.verified - s.falseVerifications).toBe(1);
    expect(s.matched).toBe(1);
  });

  test("preservationChecks only counts non-null", () => {
    const s = summarizeOutcomes([
      { expected: "verified", actual: "verified", preserved: true },
      { expected: "verified", actual: "verified", preserved: false },
      { expected: "verified", actual: "unresolved", preserved: null },
    ]);
    expect(s.preservationChecks).toBe(2);
    expect(s.preserved).toBe(1);
  });

  test("all mismatches with no verifications", () => {
    const s = summarizeOutcomes([
      { expected: "verified", actual: "unresolved", preserved: null },
      { expected: "verified", actual: "incompatible", preserved: true },
    ]);
    expect(s.matched).toBe(0);
    expect(s.verified).toBe(0);
    expect(s.falseVerifications).toBe(0);
    expect(s.preservationChecks).toBe(1);
    expect(s.preserved).toBe(1);
  });
});
