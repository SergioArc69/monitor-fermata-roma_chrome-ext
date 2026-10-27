import type { GtfsRealtimeService } from "../data/gtfsRealtimeService.js";
import type { GtfsStaticData } from "../data/gtfsStaticData.js";
import type { VehiclePositionInfo } from "../shared/models.js";
import { estimatePosition, type PredictedStop } from "./positionEstimator.js";
import { VehicleHistory } from "./vehicleHistory.js";

/**
 * Moves the vehicles of the map from where their last report put them to where they probably are
 * now (see estimatePosition). Needs what the feed positions alone do not carry: the path of the trip
 * (static shapes) and the predicted times of the stops ahead (TripUpdates).
 *
 * Never throws and never makes things worse: a vehicle it cannot estimate keeps its reported position.
 */
export class VehicleEstimator {
  private readonly history = new VehicleHistory();

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
      return estimate ? { ...position, lat: estimate.lat, lon: estimate.lon } : position;
    });
  }
}
