import type { VehiclePositionInfo } from "../shared/models.js";
import { fetchAndDecodeFeed } from "./decodeFeedMessage.js";
import type { GtfsStaticData } from "./gtfsStaticData.js";
import type { RtVehiclePosition } from "./gtfsRealtimeTypes.js";

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
      positions.push(toVehiclePositionInfo(vehicle, tripId));
    }

    return positions;
  }

  /**
   * Every vehicle currently serving [routeLabel], anywhere in the city, not just the ones already
   * found from a single stop's arrivals — feeds the map's "vedi tutti i mezzi della linea" toggle.
   * Scans the whole feed (there's no server-side index to filter by route here), resolving each
   * entity's trip to a route label via the static data the same way arrivals do.
   */
  async getPositionsForRoute(routeLabel: string, staticData: GtfsStaticData): Promise<VehiclePositionInfo[]> {
    const feed = await fetchAndDecodeFeed(VEHICLE_POSITIONS_URL);
    const wanted = routeLabel.toUpperCase();
    const positions: VehiclePositionInfo[] = [];

    for (const entity of feed.entity ?? []) {
      const vehicle = entity.vehicle;
      const tripId = vehicle?.trip?.tripId;
      if (!vehicle || !tripId || !vehicle.position) continue;

      const resolved = staticData.describeTrip(tripId, vehicle.trip?.routeId ?? "");
      if (resolved.routeLabel.toUpperCase() !== wanted) continue;

      positions.push(toVehiclePositionInfo(vehicle, tripId));
    }

    return positions;
  }
}

function toVehiclePositionInfo(vehicle: RtVehiclePosition, tripId: string): VehiclePositionInfo {
  return {
    tripId,
    vehicleLabel: vehicle.vehicle?.label || vehicle.vehicle?.id || "",
    lat: vehicle.position?.latitude ?? 0,
    lon: vehicle.position?.longitude ?? 0,
    isStopped: vehicle.currentStatus === "STOPPED_AT",
    currentStopId: vehicle.stopId ?? "",
  };
}
