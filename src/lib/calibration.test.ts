import { describe, expect, it } from "vitest";
import { evalSource, computeCalibration, CALIBRATION_THRESHOLD } from "./calibration";
import type { Evaluation } from "@/types";

let _id = 0;
function ev(over: {
  msg: string;
  verdict: "passed" | "failed";
  source: "human" | "auto";
  at: string;
}): Evaluation {
  _id += 1;
  return {
    id: `e${_id}`,
    questionId: `q-${over.msg}`,
    messageId: over.msg,
    scores: [],
    notes: "",
    verdict: over.verdict,
    submittedAt: over.at,
    ...(over.source === "auto" ? { judgeProfileId: "judge-1" } : {}),
  };
}
const pair = (msg: string, human: "passed" | "failed", auto: "passed" | "failed") => [
  ev({ msg, verdict: human, source: "human", at: "2026-06-08T01:00:00Z" }),
  ev({ msg, verdict: auto, source: "auto", at: "2026-06-08T01:00:00Z" }),
];

describe("evalSource", () => {
  it("auto when judgeProfileId present, else human", () => {
    expect(evalSource(ev({ msg: "m", verdict: "passed", source: "auto", at: "2026-06-08T00:00:00Z" }))).toBe("auto");
    expect(evalSource(ev({ msg: "m", verdict: "passed", source: "human", at: "2026-06-08T00:00:00Z" }))).toBe("human");
  });
});

describe("computeCalibration", () => {
  it("all agree → 100% gatePass, no disagreements", () => {
    const r = computeCalibration([
      ...pair("m1", "passed", "passed"),
      ...pair("m2", "failed", "failed"),
      ...pair("m3", "passed", "passed"),
    ]);
    expect(r.n).toBe(3);
    expect(r.agreementPct).toBe(100);
    expect(r.gatePass).toBe(true);
    expect(r.disagreements).toEqual([]);
  });

  it("1 of 5 disagree → 80%, not gatePass, lists the disagreement", () => {
    const r = computeCalibration([
      ...pair("m1", "passed", "passed"),
      ...pair("m2", "failed", "failed"),
      ...pair("m3", "passed", "passed"),
      ...pair("m4", "failed", "failed"),
      ...pair("m5", "passed", "failed"),
    ]);
    expect(r.n).toBe(5);
    expect(r.agreementPct).toBe(80);
    expect(r.gatePass).toBe(false);
    expect(r.disagreements.map((d) => d.messageId)).toEqual(["m5"]);
  });

  it("85% boundary (17/20) → gatePass true", () => {
    const evals: Evaluation[] = [];
    for (let i = 0; i < 17; i++) evals.push(...pair(`a${i}`, "passed", "passed"));
    for (let i = 0; i < 3; i++) evals.push(...pair(`b${i}`, "passed", "failed"));
    const r = computeCalibration(evals);
    expect(r.n).toBe(20);
    expect(r.agreementPct).toBe(85);
    expect(r.gatePass).toBe(true);
    expect(CALIBRATION_THRESHOLD).toBe(85);
  });

  it("n=0 when no pairs (empty / only-human / only-auto)", () => {
    expect(computeCalibration([]).agreementPct).toBeNull();
    const onlyHuman = computeCalibration([ev({ msg: "m", verdict: "passed", source: "human", at: "2026-06-08T01:00:00Z" })]);
    expect(onlyHuman.n).toBe(0);
    expect(onlyHuman.gatePass).toBe(false);
  });

  it("multiple human evals on same message → uses latest by submittedAt", () => {
    const r = computeCalibration([
      ev({ msg: "m", verdict: "failed", source: "human", at: "2026-06-08T01:00:00Z" }),
      ev({ msg: "m", verdict: "passed", source: "human", at: "2026-06-08T02:00:00Z" }),
      ev({ msg: "m", verdict: "passed", source: "auto", at: "2026-06-08T01:30:00Z" }),
    ]);
    expect(r.n).toBe(1);
    expect(r.agreementPct).toBe(100);
  });
});
