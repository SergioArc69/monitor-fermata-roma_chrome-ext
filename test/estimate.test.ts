import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimatePosition, type PredictedStop } from "../src/estimate/positionEstimator.js";
import { ShapeGeometry } from "../src/estimate/shapeGeometry.js";
import { VehicleHistory } from "../src/estimate/vehicleHistory.js";

const M = 111194.93; // metres per degree of latitude
const LON = 12.5;

/** A street running north from lat 41.9, one point every ~111 m, `n` points. */
function straight(n = 11): ShapeGeometry {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) points.push([41.9 + i * 0.001, LON]);
  return ShapeGeometry.fromPoints(points)!;
}

/** The latitude of the point `meters` along the straight street. */
const latAt = (meters: number): number => 41.9 + meters / M;

const stop = (sequence: number, meters: number, arrivalSecs: number): PredictedStop => ({
  sequence,
  lat: latAt(meters),
  lon: LON,
  arrivalSecs,
});

describe("estimatePosition", () => {
  it("moves a vehicle towards the next stop at the pace the prediction implies", () => {
    const e = estimatePosition({
      shape: straight(),
      nowSecs: 1030,
      reportedSecs: 1000,
      lat: latAt(200),
      lon: LON,
      stopSequence: 2,
      stoppedAtStop: false,
      stops: [stop(2, 600, 1060)],
    })!;
    // Half way in time between 200 m and 600 m.
    assert.ok(Math.abs(e.distance - 400) < 2, `distance ${e.distance}`);
    assert.ok(Math.abs(e.lat - latAt(400)) < 1e-5);
  });

  it("gives a stuck vehicle a quarter of the advance", () => {
    const e = estimatePosition({
      shape: straight(),
      nowSecs: 1030,
      reportedSecs: 1000,
      lat: latAt(200),
      lon: LON,
      stopSequence: 2,
      stoppedAtStop: false,
      stops: [stop(2, 600, 1060)],
      previous: { lat: latAt(195), lon: LON, secs: 960 },
    })!;
    assert.ok(Math.abs(e.distance - 250) < 2, `distance ${e.distance}`);
  });

  it("keeps a vehicle stopped at a stop there until its predicted departure", () => {
    const e = estimatePosition({
      shape: straight(),
      nowSecs: 1030,
      reportedSecs: 1000,
      lat: latAt(200),
      lon: LON,
      stopSequence: 2,
      stoppedAtStop: true,
      stops: [{ ...stop(2, 200, 1000), departureSecs: 1050 }, stop(3, 600, 1100)],
    })!;
    assert.equal(e.advanceMeters, 0);
  });

  it("does not extrapolate a report that is too old", () => {
    const e = estimatePosition({
      shape: straight(),
      nowSecs: 1400,
      reportedSecs: 1000,
      lat: latAt(200),
      lon: LON,
      stopSequence: 2,
      stoppedAtStop: false,
      stops: [stop(2, 600, 1460)],
    });
    assert.equal(e, null);
  });

  it("gives nothing for a vehicle off the shape", () => {
    const e = estimatePosition({
      shape: straight(),
      nowSecs: 1030,
      reportedSecs: 1000,
      lat: latAt(200),
      lon: LON + 0.01,
      stopSequence: 2,
      stoppedAtStop: false,
      stops: [stop(2, 600, 1060)],
    });
    assert.equal(e, null);
  });
});

describe("ShapeGeometry.projections", () => {
  /** North 1000 m, then back the same way. */
  function outAndBack(): ShapeGeometry {
    const points: Array<[number, number]> = [];
    for (let i = 0; i <= 10; i++) points.push([41.9 + i * 0.001, LON]);
    for (let i = 9; i >= 0; i--) points.push([41.9 + i * 0.001, LON]);
    return ShapeGeometry.fromPoints(points)!;
  }

  it("tells the two passes apart a little before the turn, but not right at it", () => {
    const shape = outAndBack();
    const turn = 41.9 + 10 * 0.001;
    assert.equal(shape.projections(turn - 0.0005, LON).length, 2); // ~55 m before the turn
    assert.equal(shape.projections(turn - 0.00005, LON).length, 1); // ~5 m before it
  });

  it("finds the point at a distance back again", () => {
    const shape = straight();
    const p = shape.pointAt(500);
    assert.ok(Math.abs(p.lat - latAt(500)) < 1e-6);
  });
});

describe("VehicleHistory", () => {
  const report = (reportedSecs: number) => ({ tripId: "t", lat: 41.9, lon: LON, reportedSecs });

  it("offers the newest report at least 15 s older, and none too old", () => {
    const h = new VehicleHistory();
    h.observe([report(900)], 0);
    h.observe([report(960)], 1);
    h.observe([report(960)], 2); // same report seen again: not a new one
    h.observe([report(990)], 3);
    assert.equal(h.previousFor("t", 1000)?.secs, 960); // 990 is only 10 s before
    assert.equal(h.previousFor("t", 1300)?.secs ?? null, null); // all older than 240 s
    assert.equal(h.previousFor("other", 1000), null);
  });
});
