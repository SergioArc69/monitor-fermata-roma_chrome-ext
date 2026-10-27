import { PREVIOUS_MIN_GAP_SECS, type PreviousReport } from "./positionEstimator.js";

/** What the history keeps of a report: where and when. */
export interface TrackedReport {
  tripId: string;
  lat: number;
  lon: number;
  /** When the position was taken, POSIX seconds. */
  reportedSecs: number;
}

interface Track {
  reports: TrackedReport[]; // newest first
  seenMs: number;
}

/**
 * The last few positions of each vehicle shown on the map, so the position estimate can tell a bus
 * that is moving from one that is stuck (see PreviousReport). Kept per trip, not per vehicle: a
 * vehicle that starts another trip has a history that says nothing about the new one. It only grows
 * while the map is open and asking; the first answer after a silence simply has no history to use.
 */
export class VehicleHistory {
  /** An earlier report older than this says too little about how the vehicle is moving now. */
  static readonly MAX_PREVIOUS_AGE_SECS = 240;

  private readonly tracks = new Map<string, Track>();

  constructor(
    private readonly keep = 3,
    private readonly retentionMs = 10 * 60_000
  ) {}

  /**
   * Notes the reports of one reading of the feed, at `nowMs`. A report is new when its timestamp
   * differs from the last one remembered for the trip: the feed is read more often than the vehicles
   * report.
   */
  observe(reports: Iterable<TrackedReport>, nowMs: number): void {
    for (const report of reports) {
      let track = this.tracks.get(report.tripId);
      if (!track) {
        track = { reports: [], seenMs: nowMs };
        this.tracks.set(report.tripId, track);
      }
      track.seenMs = nowMs;
      if (track.reports.length === 0 || track.reports[0]!.reportedSecs !== report.reportedSecs) {
        track.reports.unshift(report);
        if (track.reports.length > this.keep) track.reports.pop();
      }
    }
    for (const [tripId, track] of this.tracks) {
      if (nowMs - track.seenMs > this.retentionMs) this.tracks.delete(tripId);
    }
  }

  /**
   * The report of the trip to compare `current` with: the most recent one taken at least
   * PREVIOUS_MIN_GAP_SECS before it (nearer in time says nothing) and not more than
   * MAX_PREVIOUS_AGE_SECS. Null when there is none.
   */
  previousFor(tripId: string, currentSecs: number): PreviousReport | null {
    const track = this.tracks.get(tripId);
    if (!track) return null;
    for (const report of track.reports) {
      const gap = currentSecs - report.reportedSecs;
      if (gap >= PREVIOUS_MIN_GAP_SECS && gap <= VehicleHistory.MAX_PREVIOUS_AGE_SECS) {
        return { lat: report.lat, lon: report.lon, secs: report.reportedSecs };
      }
    }
    return null;
  }
}
