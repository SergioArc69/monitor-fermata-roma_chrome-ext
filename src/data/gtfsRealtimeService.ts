import type { ArrivalInfo } from "../shared/models.js";
import { fetchAndDecodeFeed } from "./decodeFeedMessage.js";
import type { RtFeedMessage } from "./gtfsRealtimeTypes.js";
import type { GtfsStaticData } from "./gtfsStaticData.js";

const TRIP_UPDATES_URL = "https://romamobilita.it/sites/default/files/rome_rtgtfs_trip_updates_feed.pb";
const FEED_CACHE_MS = 10_000;

export class GtfsRealtimeService {
  constructor(private readonly staticData: GtfsStaticData) {}

  // Short-lived memo of the decoded TripUpdates feed so back-to-back calls within one map refresh
  // cycle (arrivals + stopped-bus departures) don't fetch and decode the same feed twice.
  private feedCache?: { at: number; feed: RtFeedMessage };

  private async getTripUpdatesFeed(): Promise<RtFeedMessage> {
    if (this.feedCache && Date.now() - this.feedCache.at < FEED_CACHE_MS) return this.feedCache.feed;
    const feed = await fetchAndDecodeFeed(TRIP_UPDATES_URL);
    this.feedCache = { at: Date.now(), feed };
    return feed;
  }

  async getArrivalsForStop(stopId: string): Promise<ArrivalInfo[]> {
    const feed = await this.getTripUpdatesFeed();
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

  /**
   * For each `tripId → stopId` pair, the realtime predicted departure time at that stop from the
   * TripUpdates feed — used to show when a currently-stopped bus is expected to leave the stop it's
   * sitting at. Trips/stops with no matching prediction are simply omitted from the result.
   */
  async getPredictedDeparturesAtStops(tripStops: ReadonlyMap<string, string>): Promise<Map<string, Date>> {
    const result = new Map<string, Date>();
    if (tripStops.size === 0) return result;

    const feed = await this.getTripUpdatesFeed();
    for (const entity of feed.entity ?? []) {
      const tripUpdate = entity.tripUpdate;
      const tripId = tripUpdate?.trip?.tripId;
      if (!tripId) continue;
      const wantedStopId = tripStops.get(tripId);
      if (wantedStopId === undefined) continue;

      for (const stopTimeUpdate of tripUpdate!.stopTimeUpdate ?? []) {
        if (stopTimeUpdate.stopId !== wantedStopId) continue;
        const event = stopTimeUpdate.departure ?? stopTimeUpdate.arrival;
        if (event?.time === undefined) continue;
        result.set(tripId, new Date(event.time * 1000));
        break;
      }
    }
    return result;
  }
}
