import { unzipSync, strFromU8 } from "fflate";
import type { NearbyStop, RouteInfo, ScheduledArrival, StopInfo, StopSuggestion, TripInfo } from "../shared/models.js";
import { parseCsvRecords } from "./csv.js";
import { getCachedZipBlob, setCachedZipBlob } from "./zipCache.js";

const STATIC_FEED_URL = "https://romamobilita.it/sites/default/files/rome_static_gtfs.zip";
const CACHE_LIFETIME_MS = 24 * 60 * 60 * 1000; // checked/refreshed at most once a day
const META_STORAGE_KEY = "gtfsStaticMeta";

const ROUTE_TYPE_NAMES: Record<number, string> = {
  0: "Tram",
  1: "Metro",
  2: "Treno",
  3: "Bus",
  4: "Traghetto",
  5: "Tram a fune",
  6: "Funivia",
  7: "Funicolare",
};

interface StaticMeta {
  lastModifiedHeader?: string;
  lastFetchedIso?: string;
}

/**
 * Loads and caches the static GTFS feed (routes/trips/stops/calendar_dates) to translate the bare ids
 * coming from GTFS-RT into human-readable line names and stop names. stop_times.txt (150+MB uncompressed)
 * is never kept resident: it's decompressed and scanned on demand only, either for one stop at a time
 * (the scheduled-time fallback) or once in the background to build the small stop-modes/route-stops
 * indexes — see the bottom of this class.
 */
export class GtfsStaticData {
  private routes = new Map<string, RouteInfo>();
  private trips = new Map<string, TripInfo>();
  private stops = new Map<string, StopInfo>();
  private activeServiceDates = new Set<string>(); // `${serviceId}|${yyyymmdd}`
  private stopRouteTypes = new Map<string, Set<number>>();
  private routeStops = new Map<string, StopSuggestion[]>(); // keyed by routeLabel.toUpperCase()

  async load(forceRefresh = false): Promise<void> {
    const zipBytes = await this.ensureCachedZip(forceRefresh);

    const wanted = new Set(["routes.txt", "trips.txt", "stops.txt", "calendar_dates.txt"]);
    const files = unzipSync(zipBytes, { filter: (file) => wanted.has(file.name) });

    this.routes = parseRoutes(files["routes.txt"]);
    this.trips = parseTrips(files["trips.txt"]);
    this.stops = parseStops(files["stops.txt"]);
    this.activeServiceDates = parseActiveServiceDates(files["calendar_dates.txt"]);
    // Stale after a refresh; rebuilt by buildStopIndexes (a separate, much heavier on-demand scan).
    this.stopRouteTypes = new Map();
    this.routeStops = new Map();
  }

  tryGetStopName(stopId: string): string | undefined {
    return this.stops.get(stopId)?.name;
  }

  tryGetStopLocation(stopId: string): { lat: number; lon: number } | undefined {
    const stop = this.stops.get(stopId);
    if (!stop || (stop.lat === 0 && stop.lon === 0)) return undefined;
    return { lat: stop.lat, lon: stop.lon };
  }

  /**
   * An exact (case-insensitive) match against a known line number takes priority and returns that
   * line's stops in route order — e.g. typing "53" lists every stop line 53 serves. Otherwise falls
   * back to matching the query against both the stop code and the stop name (codes aren't always
   * numeric, e.g. "BP16").
   */
  searchStops(query: string, maxResults: number): StopSuggestion[] {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const routeMatch = this.routeStops.get(trimmed.toUpperCase());
    if (routeMatch && routeMatch.length > 0) return routeMatch.slice(0, maxResults);

    const needle = trimmed.toLowerCase();
    const results: StopSuggestion[] = [];
    for (const [stopId, stop] of this.stops) {
      if (stopId.toLowerCase().includes(needle) || stop.name.toLowerCase().includes(needle)) {
        results.push({ stopId, stopName: stop.name });
      }
    }
    results.sort((a, b) => a.stopName.localeCompare(b.stopName, "it", { sensitivity: "base" }));
    return results.slice(0, maxResults);
  }

  getNearbyStops(lat: number, lon: number, maxResults: number): NearbyStop[] {
    const results: NearbyStop[] = [];
    for (const [stopId, stop] of this.stops) {
      if (stop.lat === 0 && stop.lon === 0) continue;
      results.push({
        stopId,
        stopName: stop.name,
        lat: stop.lat,
        lon: stop.lon,
        distanceMeters: haversineMeters(lat, lon, stop.lat, stop.lon),
      });
    }
    results.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return results.slice(0, maxResults);
  }

  getStopsInBounds(north: number, south: number, east: number, west: number, maxResults: number): NearbyStop[] {
    const centerLat = (north + south) / 2;
    const centerLon = (east + west) / 2;

    const results: NearbyStop[] = [];
    for (const [stopId, stop] of this.stops) {
      if (stop.lat === 0 && stop.lon === 0) continue;
      if (stop.lat > north || stop.lat < south || stop.lon > east || stop.lon < west) continue;
      results.push({
        stopId,
        stopName: stop.name,
        lat: stop.lat,
        lon: stop.lon,
        distanceMeters: haversineMeters(centerLat, centerLon, stop.lat, stop.lon),
      });
    }
    results.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return results.slice(0, maxResults);
  }

  describeTrip(tripId: string, fallbackRouteId: string): { routeLabel: string; headsign: string } {
    const trip = this.trips.get(tripId);
    if (trip) {
      const routeId = trip.routeId || fallbackRouteId;
      return { routeLabel: this.resolveRouteLabel(routeId), headsign: trip.headsign };
    }
    return { routeLabel: this.resolveRouteLabel(fallbackRouteId), headsign: "" };
  }

  isServiceActiveOn(serviceId: string, yyyymmdd: number): boolean {
    return this.activeServiceDates.has(`${serviceId}|${yyyymmdd}`);
  }

  getTrip(tripId: string): TripInfo | undefined {
    return this.trips.get(tripId);
  }

  /**
   * Falls back to the static timetable when GTFS-RT has nothing to say for a stop (quiet periods,
   * feed gaps) or when a line only has a single realtime arrival. Decompresses and scans
   * stop_times.txt on demand for just this one stop — measured at ~250-300ms against the real feed,
   * fine for an occasional on-demand call, not something to run on every 30s refresh unconditionally.
   */
  async getScheduledArrivals(stopId: string, maxResults: number): Promise<ScheduledArrival[]> {
    const { lines, tripIdx, stopIdx, arrivalIdx } = await this.getStopTimesLines();
    if (tripIdx < 0 || stopIdx < 0 || arrivalIdx < 0) return [];

    const now = new Date();
    const todayKey = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    const results: ScheduledArrival[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      // Cheap pre-check before paying for a split(): most rows are for other stops.
      if (!line || !line.includes(stopId)) continue;

      const fields = line.split(",");
      if (fields[stopIdx] !== stopId) continue;

      const tripId = fields[tripIdx]!;
      const trip = this.trips.get(tripId);
      if (!trip || !this.isServiceActiveOn(trip.serviceId, todayKey)) continue;

      const timeOfDay = parseGtfsTimeOfDay(fields[arrivalIdx] ?? "");
      if (timeOfDay === null) continue;

      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const arrivalTime = new Date(startOfDay.getTime() + timeOfDay); // GTFS allows hours >= 24 for past-midnight trips
      if (arrivalTime.getTime() < now.getTime() - 60_000) continue;

      const { routeLabel, headsign } = this.describeTrip(tripId, trip.routeId);
      results.push({ tripId, routeLabel, headsign, arrivalTime });
    }

    results.sort((a, b) => a.arrivalTime.getTime() - b.arrivalTime.getTime());
    return results.slice(0, maxResults);
  }

  /**
   * Scans stop_times.txt once to learn which transport modes (bus/metro/tram/...) serve each stop and,
   * for every line, which stops it visits (in route order) — two small aggregated indexes from a single
   * pass, rather than keeping the whole file resident. Meant to be kicked off in the background: it's a
   * multi-second full scan, and optional — tryGetStopModes/searchStops's route matching simply return
   * nothing until this has completed.
   */
  async buildStopIndexes(): Promise<void> {
    const { lines, tripIdx, stopIdx, seqIdx } = await this.getStopTimesLines();
    if (tripIdx < 0 || stopIdx < 0) return;

    const stopModes = new Map<string, Set<number>>();
    // routeLabel (uppercase) -> stopId -> lowest stop_sequence seen, so the final list roughly
    // follows the physical order of the route instead of being alphabetical.
    const routeStopSequence = new Map<string, Map<string, number>>();
    const routeLabelsByUpper = new Map<string, string>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line) continue;
      const fields = line.split(",");

      const tripId = fields[tripIdx];
      const stopId = fields[stopIdx];
      if (!tripId || !stopId) continue;

      const trip = this.trips.get(tripId);
      if (!trip) continue;
      const route = this.routes.get(trip.routeId);
      if (!route || route.routeType < 0) continue;

      let types = stopModes.get(stopId);
      if (!types) {
        types = new Set();
        stopModes.set(stopId, types);
      }
      types.add(route.routeType);

      const routeLabel = this.resolveRouteLabel(trip.routeId);
      const routeKey = routeLabel.toUpperCase();
      routeLabelsByUpper.set(routeKey, routeLabel);

      let stopsForRoute = routeStopSequence.get(routeKey);
      if (!stopsForRoute) {
        stopsForRoute = new Map();
        routeStopSequence.set(routeKey, stopsForRoute);
      }

      const sequence = seqIdx >= 0 ? Number.parseInt(fields[seqIdx] ?? "", 10) : Number.NaN;
      const existing = stopsForRoute.get(stopId);
      if (existing === undefined || (!Number.isNaN(sequence) && sequence < existing)) {
        stopsForRoute.set(stopId, Number.isNaN(sequence) ? Number.MAX_SAFE_INTEGER : sequence);
      }
    }

    this.stopRouteTypes = stopModes;

    const routeStops = new Map<string, StopSuggestion[]>();
    for (const [routeKey, stopsForRoute] of routeStopSequence) {
      const ordered = [...stopsForRoute.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([stopId]) => ({ stopId, stopName: this.stops.get(stopId)?.name ?? "" }));
      routeStops.set(routeKey, ordered);
    }
    this.routeStops = routeStops;
  }

  /** Human-readable transport mode(s) for a stop (e.g. "Bus", "Metro/Bus"), once buildStopIndexes() has run. */
  tryGetStopModes(stopId: string): string | undefined {
    const types = this.stopRouteTypes.get(stopId);
    if (!types || types.size === 0) return undefined;
    return [...types]
      .sort((a, b) => a - b)
      .map((t) => ROUTE_TYPE_NAMES[t] ?? "Altro")
      .filter((label, index, all) => all.indexOf(label) === index)
      .join("/");
  }

  private async getStopTimesLines(): Promise<{ lines: string[]; tripIdx: number; stopIdx: number; arrivalIdx: number; seqIdx: number }> {
    const zipBytes = await this.ensureCachedZip(false);
    const files = unzipSync(zipBytes, { filter: (file) => file.name === "stop_times.txt" });
    const bytes = files["stop_times.txt"];
    if (!bytes) return { lines: [], tripIdx: -1, stopIdx: -1, arrivalIdx: -1, seqIdx: -1 };

    // stop_times.txt has no quoted fields in this feed, so a plain split is safe and much faster
    // than the quote-aware CSV parser used for the small files.
    const lines = strFromU8(bytes).split("\n");
    const headers = (lines[0] ?? "").split(",");
    return {
      lines,
      tripIdx: headers.indexOf("trip_id"),
      stopIdx: headers.indexOf("stop_id"),
      arrivalIdx: headers.indexOf("arrival_time"),
      seqIdx: headers.indexOf("stop_sequence"),
    };
  }

  private resolveRouteLabel(routeId: string): string {
    const route = this.routes.get(routeId);
    if (!route) return routeId;
    return route.shortName || route.longName;
  }

  private async ensureCachedZip(forceRefresh: boolean): Promise<Uint8Array> {
    const meta = await getMeta();
    const cachedBlob = await getCachedZipBlob();

    const isExpired =
      !cachedBlob ||
      !meta.lastFetchedIso ||
      Date.now() - new Date(meta.lastFetchedIso).getTime() > CACHE_LIFETIME_MS;

    if (cachedBlob && !forceRefresh && !isExpired) {
      return new Uint8Array(await cachedBlob.arrayBuffer());
    }

    const headers: HeadersInit = {};
    if (cachedBlob && meta.lastModifiedHeader) {
      headers["If-Modified-Since"] = meta.lastModifiedHeader;
    }

    const response = await fetch(STATIC_FEED_URL, { headers });

    if (response.status === 304 && cachedBlob) {
      await setMeta({ ...meta, lastFetchedIso: new Date().toISOString() });
      return new Uint8Array(await cachedBlob.arrayBuffer());
    }

    if (!response.ok) {
      if (cachedBlob) return new Uint8Array(await cachedBlob.arrayBuffer()); // best effort: keep serving stale data
      throw new Error(`Download GTFS statico fallito: HTTP ${response.status}`);
    }

    const blob = await response.blob();
    await setCachedZipBlob(blob);
    await setMeta({
      lastModifiedHeader: response.headers.get("Last-Modified") ?? undefined,
      lastFetchedIso: new Date().toISOString(),
    });

    return new Uint8Array(await blob.arrayBuffer());
  }
}

function parseRoutes(bytes: Uint8Array | undefined): Map<string, RouteInfo> {
  const result = new Map<string, RouteInfo>();
  if (!bytes) return result;
  for (const row of parseCsvRecords(strFromU8(bytes))) {
    const id = row["route_id"];
    if (!id) continue;
    result.set(id, {
      shortName: row["route_short_name"] ?? "",
      longName: row["route_long_name"] ?? "",
      routeType: Number.parseInt(row["route_type"] ?? "", 10) || -1,
    });
  }
  return result;
}

function parseTrips(bytes: Uint8Array | undefined): Map<string, TripInfo> {
  const result = new Map<string, TripInfo>();
  if (!bytes) return result;
  for (const row of parseCsvRecords(strFromU8(bytes))) {
    const id = row["trip_id"];
    if (!id) continue;
    result.set(id, {
      routeId: row["route_id"] ?? "",
      headsign: row["trip_headsign"] ?? "",
      serviceId: row["service_id"] ?? "",
    });
  }
  return result;
}

function parseStops(bytes: Uint8Array | undefined): Map<string, StopInfo> {
  const result = new Map<string, StopInfo>();
  if (!bytes) return result;
  for (const row of parseCsvRecords(strFromU8(bytes))) {
    const id = row["stop_id"];
    if (!id) continue;
    result.set(id, {
      name: row["stop_name"] ?? "",
      lat: Number.parseFloat(row["stop_lat"] ?? "") || 0,
      lon: Number.parseFloat(row["stop_lon"] ?? "") || 0,
    });
  }
  return result;
}

function parseActiveServiceDates(bytes: Uint8Array | undefined): Set<string> {
  const result = new Set<string>();
  if (!bytes) return result;
  for (const row of parseCsvRecords(strFromU8(bytes))) {
    const serviceId = row["service_id"];
    const date = row["date"];
    if (!serviceId || !date) continue;
    // exception_type: 1 = added, 2 = removed. Rome's feed only ever adds (no base calendar.txt), but honor it if present.
    if (row["exception_type"] === "2") continue;
    result.add(`${serviceId}|${date}`);
  }
  return result;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusMeters = 6_371_000;
  const dLat = degreesToRadians(lat2 - lat1);
  const dLon = degreesToRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(degreesToRadians(lat1)) * Math.cos(degreesToRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Parses a GTFS "HH:MM:SS" time (hours may be >= 24 for past-midnight trips) into total milliseconds since midnight. */
function parseGtfsTimeOfDay(value: string): number | null {
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const hours = Number.parseInt(parts[0]!, 10);
  const minutes = Number.parseInt(parts[1]!, 10);
  const seconds = Number.parseInt(parts[2]!, 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

async function getMeta(): Promise<StaticMeta> {
  const result = await chrome.storage.local.get(META_STORAGE_KEY);
  return (result[META_STORAGE_KEY] as StaticMeta | undefined) ?? {};
}

async function setMeta(meta: StaticMeta): Promise<void> {
  await chrome.storage.local.set({ [META_STORAGE_KEY]: meta });
}
