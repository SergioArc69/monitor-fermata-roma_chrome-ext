import type { GtfsRealtimeService } from "../data/gtfsRealtimeService.js";
import type { GtfsStaticData } from "../data/gtfsStaticData.js";
import type { VehiclePositionInfo } from "../shared/models.js";
import { estimatePosition, type PredictedStop } from "./positionEstimator.js";
import { VehicleHistory } from "./vehicleHistory.js";

/**
 * A new report often shows the vehicle behind where the last estimate had put it (it slowed down
 * in traffic, a light, a junction: nothing the predictions know). A bus does not go backwards, so
 * the marker is held where it was until the estimate catches up, for at most this long.
 */
const HOLD_MAX_MS = 90_000;
/** A step back bigger than this is not that: a wrong earlier guess or another trip, take the new position. */
const HOLD_MAX_BACK_METERS = 800;
/** Forget the trips not seen for this long. */
const SHOWN_RETENTION_MS = 5 * 60_000;

interface Shown {
  /** Metres along the trip's shape of the position last drawn. */
  distance: number;
  /** Since when the marker has been held back, if it is. */
  holdingSinceMs: number | null;
  seenMs: number;
}

/**
 * Moves the vehicles of the map from where their last report put them to where they probably are
 * now (see estimatePosition). Needs what the feed positions alone do not carry: the path of the trip
 * (static shapes) and the predicted times of the stops ahead (TripUpdates).
 *
 * Never throws and never makes things worse: a vehicle it cannot estimate keeps its reported position.
 */
export class VehicleEstimator {
  private readonly history = new VehicleHistory();
  private readonly shown = new Map<string, Shown>();

  constructor(
    private readonly staticData: GtfsStaticData,
    private readonly realtime: GtfsRealtimeService
  ) {}

  /** The positions to draw: the same vehicles, with lat/lon replaced by the estimate where there is one. */
  async apply(positions: VehiclePositionInfo[], nowMs = Date.now()): Promise<VehiclePositionInfo[]> {
    try {
      return await this.estimateAll(positions, nowMs);
    } catch (error) {
      console.error("[map] stima della posizione non riuscita, uso le posizioni segnalate:", error);
      return positions;
    }
  }

  private async estimateAll(positions: VehiclePositionInfo[], nowMs: number): Promise<VehiclePositionInfo[]> {
    const nowSecs = Math.floor(nowMs / 1000);
    this.history.observe(
      positions.flatMap((p) =>
        p.reportedSecs === null ? [] : [{ tripId: p.tripId, lat: p.lat, lon: p.lon, reportedSecs: p.reportedSecs }]
      ),
      nowMs
    );

    const tripIds = new Set(positions.filter((p) => p.reportedSecs !== null).map((p) => p.tripId));
    if (tripIds.size === 0) return positions;
    const updates = await this.realtime.getStopTimeUpdatesForTrips(tripIds);
    const shapes = await this.staticData.getShapesForTrips(updates.keys());

    return positions.map((position) => {
      const shape = shapes.get(position.tripId);
      const stopTimeUpdates = updates.get(position.tripId);
      if (!shape || !stopTimeUpdates || position.reportedSecs === null) return position;

      const stops: PredictedStop[] = [];
      for (const update of stopTimeUpdates) {
        const sequence = update.stopSequence;
        const location = update.stopId ? this.staticData.tryGetStopLocation(update.stopId) : undefined;
        if (!sequence || !location) continue;
        // The decoder fills defaults, so an absent time reads 0.
        const arrivalSecs = update.arrival?.time || undefined;
        const departureSecs = update.departure?.time || undefined;
        if (arrivalSecs === undefined && departureSecs === undefined) continue;
        stops.push({ sequence, lat: location.lat, lon: location.lon, arrivalSecs, departureSecs });
      }
      if (stops.length === 0) return position;

      const estimate = estimatePosition({
        shape,
        nowSecs,
        reportedSecs: position.reportedSecs,
        lat: position.lat,
        lon: position.lon,
        stopSequence: position.stopSequence,
        stoppedAtStop: position.isStopped,
        stops,
        previous: this.history.previousFor(position.tripId, position.reportedSecs),
      });
      if (!estimate) return position;

      const drawn = this.keepFromGoingBack(position.tripId, estimate.distance, nowMs);
      const point = drawn === estimate.distance ? estimate : shape.pointAt(drawn);
      return { ...position, lat: point.lat, lon: point.lon };
    });
  }

  /** The distance along the shape to draw: `distance`, unless that would take the marker back. */
  private keepFromGoingBack(tripId: string, distance: number, nowMs: number): number {
    for (const [id, shown] of this.shown) if (nowMs - shown.seenMs > SHOWN_RETENTION_MS) this.shown.delete(id);

    const last = this.shown.get(tripId);
    if (last && distance < last.distance && last.distance - distance <= HOLD_MAX_BACK_METERS) {
      const since = last.holdingSinceMs ?? nowMs;
      if (nowMs - since <= HOLD_MAX_MS) {
        this.shown.set(tripId, { distance: last.distance, holdingSinceMs: since, seenMs: nowMs });
        return last.distance;
      }
    }
    this.shown.set(tripId, { distance, holdingSinceMs: null, seenMs: nowMs });
    return distance;
  }
}
