import { ShapeGeometry, type ShapeProjection } from "./shapeGeometry.js";

/** A stop still ahead of a vehicle (or the one it is at), with what the trip-updates feed predicts for it. */
export interface PredictedStop {
  /** GTFS stop_sequence within the trip. */
  sequence: number;
  lat: number;
  lon: number;
  /** Predicted instants, POSIX seconds. */
  arrivalSecs?: number;
  departureSecs?: number;
}

/** Where a vehicle probably is now. */
export interface EstimatedPosition {
  lat: number;
  lon: number;
  /** Metres along the trip's shape. */
  distance: number;
  /** How far past the reported position the estimate is, along the shape. */
  advanceMeters: number;
}

/**
 * An earlier report of the same vehicle, taken at least PREVIOUS_MIN_GAP_SECS before the current
 * one: from the two, how it has been moving.
 */
export interface PreviousReport {
  lat: number;
  lon: number;
  /** When it was taken, POSIX seconds. */
  secs: number;
}

/** Closer together than this, two reports say nothing about movement: the position has a few metres of noise. */
export const PREVIOUS_MIN_GAP_SECS = 15;

/** How what the last two reports say about the movement of a vehicle changes the estimate. */
export interface EstimateTuning {
  /** A vehicle that moved less than this between the two reports (and is not at a stop) is stuck. */
  stationaryMeters: number;
  /** How much of the predicted advance a stuck vehicle is given: 1 as if it were not stuck, 0 none. */
  stationaryFactor: number;
  /** When set, a moving vehicle advances at most this many times the pace it was seen to have... */
  paceCapFactor?: number;
  /** ...but never less than this many m/s. */
  paceFloor: number;
}

/** The variant the Stally server uses, the best of those tried on real data. */
export const PRODUCTION_TUNING: EstimateTuning = {
  stationaryMeters: 25,
  stationaryFactor: 0.25,
  paceCapFactor: 2,
  paceFloor: 1.5,
};

export interface EstimateInput {
  shape: ShapeGeometry;
  nowSecs: number;
  reportedSecs: number;
  lat: number;
  lon: number;
  stopSequence: number | null;
  stoppedAtStop: boolean;
  stops: PredictedStop[];
  maxSpeed?: number;
  maxAgeSecs?: number;
  maxOffShape?: number;
  previous?: PreviousReport | null;
  tuning?: EstimateTuning;
}

/**
 * Where a vehicle has got to since its position was reported.
 *
 * The position the feed carries is old (tens of seconds when published, plus polling), so a vehicle
 * on the map is typically one or two stops behind. The model: put the last reported position on the
 * trip's shape, then let the vehicle go from there to each following stop at the pace the predicted
 * arrival times imply, straight line in time between stops. A vehicle reported stopped at a stop stays
 * there until its predicted departure. Nothing goes faster than maxSpeed or past the end of the
 * shape, and a report older than maxAgeSecs is not extrapolated at all.
 *
 * Returns null when there is nothing sound to say: the report is too old, it is not on the shape, or
 * it is not clear where on a shape that passes the same place twice.
 */
export function estimatePosition(input: EstimateInput): EstimatedPosition | null {
  const {
    shape, nowSecs, reportedSecs, lat, lon, stopSequence, stoppedAtStop, stops,
    maxSpeed = 25, maxAgeSecs = 300, maxOffShape = 80, previous = null, tuning = PRODUCTION_TUNING,
  } = input;

  const age = nowSecs - reportedSecs;
  if (age > maxAgeSecs) return null;

  const vehicleCandidates = shape.projections(lat, lon, maxOffShape);
  if (vehicleCandidates.length === 0) return null;

  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
  // The stop the vehicle is at, or heading for (undefined when the feed has dropped it).
  const current = stopSequence === null ? undefined : ordered.find((s) => s.sequence === stopSequence);

  // Which pass of the shape the vehicle is on: no doubt with a single candidate; a shape that passes
  // the same place twice (out and back along one street, a loop) needs some more.
  let d1: number;
  if (vehicleCandidates.length === 1) {
    d1 = vehicleCandidates[0]!.distance;
  } else {
    const chosen = choosePass(shape, vehicleCandidates, ordered, current, stopSequence);
    if (chosen === null) return null;
    d1 = chosen;
  }

  // Where each stop lies along the shape, in trip order: the first pass past the previous stop.
  const ahead: Array<[PredictedStop, number]> = [];
  let lastStopDistance = d1 - 800;
  for (const stop of ordered) {
    if (stopSequence !== null && stop.sequence < stopSequence - 1) continue;
    const pick = shape.projections(stop.lat, stop.lon, 120).find((c) => c.distance >= lastStopDistance - 30);
    if (!pick) continue;
    lastStopDistance = pick.distance;
    if (pick.distance > d1 + 1) ahead.push([stop, pick.distance]);
  }

  // The vehicle's own timeline: where it is when reported, then at each stop ahead at its predicted
  // time. A stopped vehicle first waits to leave.
  let startSecs = reportedSecs;
  if (stoppedAtStop && current) {
    const departure = current.departureSecs ?? current.arrivalSecs;
    if (departure !== undefined && departure > startSecs) startSecs = departure;
  }
  const timeline: Array<[number, number]> = [[startSecs, d1]];
  for (const [stop, distance] of ahead) {
    const secs = stop.arrivalSecs ?? stop.departureSecs;
    if (secs !== undefined && secs > timeline[timeline.length - 1]![0]) timeline.push([secs, distance]);
  }

  let distance = d1;
  for (let i = 0; i + 1 < timeline.length; i++) {
    const [fromSecs, fromDistance] = timeline[i]!;
    const [toSecs, toDistance] = timeline[i + 1]!;
    if (nowSecs >= toSecs) {
      distance = toDistance;
    } else if (nowSecs > fromSecs) {
      distance = fromDistance + ((toDistance - fromDistance) * (nowSecs - fromSecs)) / (toSecs - fromSecs);
      break;
    } else {
      break;
    }
  }

  // What the last two reports say about the way it has been moving.
  if (previous && reportedSecs - previous.secs >= PREVIOUS_MIN_GAP_SECS && age > 0) {
    const gap = reportedSecs - previous.secs;
    const moved = meters(previous.lat, previous.lon, lat, lon);
    const stuck = moved < tuning.stationaryMeters && !stoppedAtStop;
    let advance = distance - d1;
    if (stuck) {
      advance *= tuning.stationaryFactor;
    } else if (tuning.paceCapFactor !== undefined && !stoppedAtStop) {
      // (Not for a vehicle at a stop: its pace so far is the wait, and it goes off at its departure.)
      const pace = Math.max((moved / gap) * tuning.paceCapFactor, tuning.paceFloor);
      advance = Math.min(advance, pace * age);
    }
    distance = d1 + advance;
  }

  const cap = age > 0 ? d1 + maxSpeed * age : d1;
  if (distance > cap) distance = cap;
  if (distance > shape.length) distance = shape.length;

  if (distance <= d1) {
    // Nothing to add: the report itself is the best answer, not its snap to the shape.
    return { lat, lon, distance: d1, advanceMeters: 0 };
  }
  const point = shape.pointAt(distance);
  return { lat: point.lat, lon: point.lon, distance, advanceMeters: distance - d1 };
}

/**
 * Picks, among the places `candidates` where the vehicle may be on a shape that passes the same spot
 * more than once, the one it is really at: its distance along the shape, or null when it cannot be
 * told. The vehicle is at, or on its way to, the stop with the sequence it reports, so it is just
 * before that stop; how far through the trip that stop is says roughly how far along the shape. A stop
 * the feed no longer lists (it drops one as soon as the vehicle has passed it) is stood in for by the
 * first one it still does.
 */
function choosePass(
  shape: ShapeGeometry,
  candidates: ShapeProjection[],
  ordered: PredictedStop[],
  current: PredictedStop | undefined,
  stopSequence: number | null
): number | null {
  const reference = current ?? ordered.find((s) => stopSequence === null || s.sequence >= stopSequence);
  if (!reference) return null;
  const stopCandidates = shape.projections(reference.lat, reference.lon, 120);
  if (stopCandidates.length === 0) return null;

  // Where along the shape the vehicle should be going by how far through the trip it is (only when
  // it says which stop it is at).
  let expected: number | null = null;
  const lastSequence = ordered[ordered.length - 1]!.sequence;
  if (stopSequence !== null && lastSequence > 1) {
    expected = shape.length * Math.min(1, Math.max(0, (stopSequence - 1) / (lastSequence - 1)));
  }

  // Each candidate, scored by its best pairing with a pass of the reference stop in which the vehicle
  // is at or before the stop and not far from it (a little after is the noise of the position).
  const scored: Array<[number, number]> = [];
  for (const v of candidates) {
    let best: number | null = null;
    for (const s of stopCandidates) {
      const aheadBy = s.distance - v.distance;
      if (aheadBy < -60 || aheadBy > 900) continue;
      const score = expected !== null ? Math.abs(v.distance - expected) : Math.abs(aheadBy);
      if (best === null || score < best) best = score;
    }
    if (best !== null) scored.push([v.distance, best]);
  }

  if (scored.length === 0) {
    // Nothing is "just before the stop": the closest pairing either way, if it is close.
    let bestGap = Infinity;
    let chosen = 0;
    for (const v of candidates) {
      for (const s of stopCandidates) {
        const gap = Math.abs(v.distance - s.distance);
        if (gap < bestGap) {
          bestGap = gap;
          chosen = v.distance;
        }
      }
    }
    return bestGap > 900 ? null : chosen;
  }

  scored.sort((a, b) => a[1] - b[1]);
  if (scored.length > 1 && scored[1]![1] - scored[0]![1] < 60) return null;
  return scored[0]![0];
}

/** Straight-line metres between two points, flat-earth, enough for tens of metres to a few km. */
function meters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dx = (lon2 - lon1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180) * 111194.93;
  const dy = (lat2 - lat1) * 111194.93;
  return Math.hypot(dx, dy);
}
