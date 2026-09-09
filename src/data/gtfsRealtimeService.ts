import type { ArrivalInfo } from "../shared/models.js";
import { fetchAndDecodeFeed } from "./decodeFeedMessage.js";
import type { GtfsStaticData } from "./gtfsStaticData.js";

const TRIP_UPDATES_URL = "https://romamobilita.it/sites/default/files/rome_rtgtfs_trip_updates_feed.pb";

export class GtfsRealtimeService {
  constructor(private readonly staticData: GtfsStaticData) {}

  async getArrivalsForStop(stopId: string): Promise<ArrivalInfo[]> {
    const feed = await fetchAndDecodeFeed(TRIP_UPDATES_URL);
    const minTimeMs = Date.now() - 60_000;
    const arrivals: ArrivalInfo[] = [];

    for (const entity of feed.entity ?? []) {
      const tripUpdate = entity.tripUpdate;
      if (!tripUpdate?.trip) continue;

      for (const stopTimeUpdate of tripUpdate.stopTimeUpdate ?? []) {
        if (stopTimeUpdate.stopId !== stopId) continue;

        const stopTimeEvent = stopTimeUpdate.arrival ?? stopTimeUpdate.departure;
        if (stopTimeEvent?.time === undefined) continue;

        const arrivalTime = new Date(stopTimeEvent.time * 1000);
        if (arrivalTime.getTime() <= minTimeMs) continue;

        const tripId = tripUpdate.trip.tripId ?? "";
        const { routeLabel, headsign } = this.staticData.describeTrip(tripId, tripUpdate.trip.routeId ?? "");

        arrivals.push({
          tripId,
          routeLabel,
          headsign,
          arrivalTime,
          delaySeconds: stopTimeEvent.delay ?? 0,
          isRealtime: true,
        });
      }
    }

    arrivals.sort((a, b) => a.arrivalTime.getTime() - b.arrivalTime.getTime());
    return arrivals;
  }
}
