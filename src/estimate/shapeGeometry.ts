/** Metres in one degree of latitude: distances here are small enough for a flat local approximation. */
const METERS_PER_DEGREE = 111194.93;

/**
 * Two neighbouring segments that both touch a point are one place if the point's distances along
 * the shape differ by no more than this, plus twice the point's distance from the shape. (Round a
 * bend the two projections of a point off the road differ by about that; at a U-turn a point `s`
 * metres before the turn is `2s` metres from its own way back: two places, once it is more than a
 * few metres from the turn.)
 */
const SAME_STRETCH_METERS = 30;

export interface ShapeProjection {
  /** Metres from the start of the shape to the nearest point on it. */
  distance: number;
  /** Metres between the point and the shape. */
  perpendicular: number;
}

/**
 * The path of a trip (GTFS shapes.txt): a polyline whose points know how far along it they are, in
 * metres. Distances are computed from the coordinates, not taken from shape_dist_traveled (optional,
 * unspecified units). Same geometry as the Stally server, ported from its Dart.
 */
export class ShapeGeometry {
  private constructor(
    private readonly lats: Float64Array,
    private readonly lons: Float64Array,
    private readonly dists: Float64Array
  ) {}

  /** Builds a shape from its points, in order. Needs at least two. */
  static fromPoints(points: ReadonlyArray<readonly [number, number]>): ShapeGeometry | null {
    if (points.length < 2) return null;
    const lats = new Float64Array(points.length);
    const lons = new Float64Array(points.length);
    const dists = new Float64Array(points.length);
    for (let i = 0; i < points.length; i++) {
      lats[i] = points[i]![0];
      lons[i] = points[i]![1];
      if (i > 0) dists[i] = dists[i - 1]! + segmentLength(lats[i - 1]!, lons[i - 1]!, lats[i]!, lons[i]!);
    }
    return new ShapeGeometry(lats, lons, dists);
  }

  /** Length of the whole path, in metres. */
  get length(): number {
    return this.dists[this.dists.length - 1]!;
  }

  /**
   * Every place along the shape that lies within `maxPerpendicular` metres of the point, nearest
   * point of each stretch, in order along the shape. More than one when the path passes the same
   * spot twice (a loop line, a terminus where way out and way back share a street): which one is
   * meant is for the caller to decide.
   */
  projections(lat: number, lon: number, maxPerpendicular = 80): ShapeProjection[] {
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const found: ShapeProjection[] = [];
    let current: ShapeProjection | null = null;
    let currentIndex = -2;

    for (let i = 0; i < this.lats.length - 1; i++) {
      // Local flat coordinates, in metres, with the point at the origin.
      const ax = (this.lons[i]! - lon) * cosLat * METERS_PER_DEGREE;
      const ay = (this.lats[i]! - lat) * METERS_PER_DEGREE;
      const bx = (this.lons[i + 1]! - lon) * cosLat * METERS_PER_DEGREE;
      const by = (this.lats[i + 1]! - lat) * METERS_PER_DEGREE;
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSquared = dx * dx + dy * dy;
      const u = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, (-ax * dx - ay * dy) / lengthSquared));
      const perpendicular = Math.hypot(ax + u * dx, ay + u * dy);
      if (perpendicular > maxPerpendicular) continue;

      const candidate: ShapeProjection = {
        distance: this.dists[i]! + u * (this.dists[i + 1]! - this.dists[i]!),
        perpendicular,
      };
      // The same stretch as the previous segment, when it follows it and is not far along the shape.
      if (
        current !== null &&
        i === currentIndex + 1 &&
        Math.abs(candidate.distance - current.distance) <
          SAME_STRETCH_METERS + 2 * Math.max(candidate.perpendicular, current.perpendicular)
      ) {
        if (candidate.perpendicular < current.perpendicular) current = candidate;
      } else {
        if (current !== null) found.push(current);
        current = candidate;
      }
      currentIndex = i;
    }
    if (current !== null) found.push(current);
    return found;
  }

  /** The point `distance` metres along the shape (clamped to its ends). */
  pointAt(distance: number): { lat: number; lon: number } {
    if (distance <= 0) return { lat: this.lats[0]!, lon: this.lons[0]! };
    if (distance >= this.length) return { lat: this.lats[this.lats.length - 1]!, lon: this.lons[this.lons.length - 1]! };

    // Last point at or before the distance.
    let lo = 0;
    let hi = this.dists.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.dists[mid]! <= distance) lo = mid;
      else hi = mid;
    }
    const span = this.dists[hi]! - this.dists[lo]!;
    const u = span === 0 ? 0 : (distance - this.dists[lo]!) / span;
    return {
      lat: this.lats[lo]! + u * (this.lats[hi]! - this.lats[lo]!),
      lon: this.lons[lo]! + u * (this.lons[hi]! - this.lons[lo]!),
    };
  }
}

function segmentLength(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dx = (lon2 - lon1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180) * METERS_PER_DEGREE;
  const dy = (lat2 - lat1) * METERS_PER_DEGREE;
  return Math.hypot(dx, dy);
}
