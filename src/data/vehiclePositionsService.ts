import type { VehiclePositionInfo } from "../shared/models.js";
import { fetchAndDecodeFeed } from "./decodeFeedMessage.js";

const VEHICLE_POSITIONS_URL = "https://romamobilita.it/sites/default/files/rome_rtgtfs_vehicle_positions_feed.pb";

export class VehiclePositionsService {
  async getPositionsForTrips(tripIds: ReadonlySet<string>): Promise<VehiclePositionInfo[]> {
    if (tripIds.size === 0) return [];

    const feed = await fetchAndDecodeFeed(VEHICLE_POSITIONS_URL);
    const positions: VehiclePositionInfo[] = [];

    for (const entity of feed.entity ?? []) {
      const vehicle = entity.vehicle;
      const tripId = vehicle?.trip?.tripId;
      if (!vehicle || !tripId || !tripIds.has(tripId) || !vehicle.position) continue;

      positions.push({
        tripId,
        vehicleLabel: vehicle.vehicle?.label || vehicle.vehicle?.id || "",
        lat: vehicle.position.latitude ?? 0,
        lon: vehicle.position.longitude ?? 0,
        isStopped: vehicle.currentStatus === "STOPPED_AT",
        currentStopId: vehicle.stopId ?? "",
      });
    }

    return positions;
  }
}
