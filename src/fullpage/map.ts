import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { GtfsStaticData } from "../data/gtfsStaticData.js";
import { GtfsRealtimeService } from "../data/gtfsRealtimeService.js";
import { VehiclePositionsService } from "../data/vehiclePositionsService.js";
import { getMonitoredStopId, startMonitoringStop, stopMonitoringStop } from "../shared/monitoringController.js";
import type { ArrivalInfo } from "../shared/models.js";
import { minutesLabel } from "../shared/arrivalFormatting.js";
import { applyLineFilter, getLineFilter, setLineFilter, type LineFilterState } from "../shared/lineFilter.js";
import { getCachedArrivals } from "../shared/arrivalsCache.js";

// MapLibre normally resolves its worker script relative to its own bundle's import.meta.url, but
// that auto-detection doesn't work inside a chrome-extension:// page — it ends up requesting the
// current document instead of the worker file. Point it explicitly at the copy build.mjs places
// next to this bundle.
maplibregl.setWorkerUrl(chrome.runtime.getURL("dist/maplibre-gl-worker.mjs"));

const MAX_VISIBLE_STOPS = 150;
const BUS_REFRESH_INTERVAL_MS = 20_000;
const ROME_FALLBACK = { lat: 41.9028, lon: 12.4964 };
const MAX_DISTANCE_FROM_ROME_KM = 50;

const instructionEl = document.getElementById("instruction") as HTMLDivElement;
const mapEl = document.getElementById("map") as HTMLDivElement;
const busStatusBarEl = document.getElementById("busStatusBar") as HTMLDivElement;
const stopMonitoringButton = document.getElementById("stopMonitoringButton") as HTMLButtonElement;
const lineFilterBarEl = document.getElementById("lineFilterBar") as HTMLDivElement;
const lineFilterEnabledInput = document.getElementById("lineFilterEnabled") as HTMLInputElement;
const lineFilterListEl = document.getElementById("lineFilterList") as HTMLDivElement;

const staticData = new GtfsStaticData();
const realtimeService = new GtfsRealtimeService(staticData);
const vehiclePositions = new VehiclePositionsService();

let map: maplibregl.Map;
let meMarker: maplibregl.Marker | null = null;
const stopMarkers = new Map<string, maplibregl.Marker>();
// Stop tooltips are shown via a Popup added directly to the map (not marker.setPopup(), to get
// hover instead of click-to-open), so removing the marker itself does not remove an open tooltip.
// Track them here so clearStopMarkers can close any that are still open, otherwise one left open
// while its marker is replaced (e.g. by a viewport refresh on moveend) never receives the
// 'mouseleave' that would normally close it, and lingers on the map with no way to dismiss it.
const stopTooltips = new Set<maplibregl.Popup>();
const busMarkers = new Map<string, maplibregl.Marker>();
let viewportDebounceTimer: number | undefined;
let busRefreshTimer: number | undefined;
let busRefreshInFlight = false;
let monitoredStopId: string | null = null;
// The upstream GTFS-RT feed drops a stop's stop_time_update entry almost as soon as the bus passes
// it — it does NOT keep reporting it for minutes afterwards. So to keep recently-passed buses on
// the map for a while, we have to remember their last-seen arrival ourselves, rather than expecting
// the feed to still have it on a later poll. Reset whenever a (possibly different) stop is monitored.
let recentArrivalsByTripId = new Map<string, ArrivalInfo>();
// Same filter the popup and the notification logic apply to the arrivals list — shared via
// chrome.storage.local (see shared/lineFilter.ts), kept live here via the storage.onChanged
// listener below so editing it from either the popup or this map takes effect immediately in
// both places.
let lineFilterState: LineFilterState = { enabled: false, selectedLines: [] };
const availableLines = new Set<string>();

async function init(): Promise<void> {
  instructionEl.textContent = "Caricamento dati...";
  try {
    await staticData.load();
  } catch (error) {
    instructionEl.textContent = `Impossibile caricare i dati GTFS statici: ${(error as Error).message}`;
    return;
  }
  // Background, best-effort: populates tryGetStopModes for the tooltips below once the multi-second
  // scan completes. Tooltips just show without the mode line until then.
  void staticData.buildStopIndexes();

  const storedMonitoredStopId = await getMonitoredStopId();
  if (storedMonitoredStopId) {
    await enterMonitorMode(storedMonitoredStopId);
  } else {
    const centerStopId = new URLSearchParams(window.location.search).get("centerStop");
    await enterBrowseMode(centerStopId);
  }
}

async function enterMonitorMode(stopId: string): Promise<void> {
  monitoredStopId = stopId;
  recentArrivalsByTripId = new Map();
  // Any refresh still in flight is now for the previous session; its post-await guards make it a
  // no-op, so don't let its flag block this session's first refresh.
  busRefreshInFlight = false;
  window.clearInterval(busRefreshTimer);
  map?.off("moveend", onViewportMoveEnd);

  const location = staticData.tryGetStopLocation(stopId);
  if (!location) {
    instructionEl.textContent = `Fermata ${stopId} non trovata nei dati statici: mostro comunque la mappa di Roma.`;
    await enterBrowseMode();
    return;
  }

  instructionEl.textContent = "Fermata monitorata, con la posizione dei bus in transito (aggiornata ogni 20 secondi).";
  stopMonitoringButton.style.display = "block";
  mapEl.classList.add("with-bus-bar");
  busStatusBarEl.style.display = "flex";

  availableLines.clear();
  mapEl.classList.add("with-line-filter");
  lineFilterBarEl.style.display = "flex";
  lineFilterState = await getLineFilter();
  if (monitoredStopId !== stopId) return; // superseded while awaiting
  updateLineFilterEnabledState();
  const cachedArrivals = await getCachedArrivals(stopId);
  if (monitoredStopId !== stopId) return;
  if (cachedArrivals) for (const arrival of cachedArrivals) availableLines.add(arrival.routeLabel);
  renderLineFilterList();

  if (!map) createMap(location.lat, location.lon, 16);
  else map.jumpTo({ center: [location.lon, location.lat], zoom: 16 });

  const stopName = staticData.tryGetStopName(stopId) ?? "";
  addStopMarker(stopId, location.lat, location.lon, buildStopTooltip(stopId, stopName), false);

  await refreshBusPositions(stopId);
  if (monitoredStopId === stopId) {
    busRefreshTimer = window.setInterval(() => void refreshBusPositions(stopId), BUS_REFRESH_INTERVAL_MS);
  }
}

async function enterBrowseMode(centerStopId?: string | null): Promise<void> {
  monitoredStopId = null;
  window.clearInterval(busRefreshTimer);
  clearBusMarkers();
  busStatusBarEl.innerHTML = "";
  busStatusBarEl.style.display = "none";
  mapEl.classList.remove("with-bus-bar");
  stopMonitoringButton.style.display = "none";
  mapEl.classList.remove("with-line-filter");
  lineFilterBarEl.style.display = "none";
  availableLines.clear();

  const centerStopLocation = centerStopId ? staticData.tryGetStopLocation(centerStopId) : null;

  if (centerStopLocation) {
    instructionEl.textContent =
      "Fermate vicino al codice inserito: clicca su una fermata per monitorarla, oppure sposta o zooma la mappa per cercarne altre.";

    if (!map) createMap(centerStopLocation.lat, centerStopLocation.lon, 16);
    else map.jumpTo({ center: [centerStopLocation.lon, centerStopLocation.lat], zoom: 16 });

    map.off("moveend", onViewportMoveEnd);
    map.on("moveend", onViewportMoveEnd);

    await refreshStopsInViewport();
    return;
  }

  const rawLocation = await getCurrentLocation();
  // Monitoring may have been restarted from the popup while geolocation was pending.
  if (monitoredStopId) return;
  const location =
    rawLocation && distanceKm(rawLocation, ROME_FALLBACK) <= MAX_DISTANCE_FROM_ROME_KM ? rawLocation : null;
  const lat = location?.lat ?? ROME_FALLBACK.lat;
  const lon = location?.lon ?? ROME_FALLBACK.lon;

  instructionEl.textContent = location
    ? "Fermate vicino alla tua posizione: clicca su una fermata per monitorarla, oppure sposta o zooma la mappa per cercarne altre."
    : "Posizione non disponibile: mostro le fermate del centro di Roma. Clicca su una fermata per monitorarla, oppure sposta o zooma la mappa per cercarne altre.";

  if (!map) createMap(lat, lon, 16);
  else map.jumpTo({ center: [lon, lat], zoom: 16 });
  addMeMarker(lat, lon);

  map.off("moveend", onViewportMoveEnd);
  map.on("moveend", onViewportMoveEnd);

  await refreshStopsInViewport();
}

function onViewportMoveEnd(): void {
  window.clearTimeout(viewportDebounceTimer);
  viewportDebounceTimer = window.setTimeout(() => void refreshStopsInViewport(), 500);
}

async function refreshStopsInViewport(): Promise<void> {
  const bounds = map.getBounds();
  clearStopMarkers();

  const stops = staticData.getStopsInBounds(
    bounds.getNorth(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getWest(),
    MAX_VISIBLE_STOPS
  );
  for (const stop of stops) {
    addStopMarker(stop.stopId, stop.lat, stop.lon, buildStopTooltip(stop.stopId, stop.stopName), true);
  }
}

async function selectStop(stopId: string): Promise<void> {
  // Set this first so the storage listener does not start a second, overlapping transition.
  monitoredStopId = stopId;
  await startMonitoringStop(stopId);

  // Leave browse mode for good: without this, the viewport 'moveend' listener stays registered,
  // and the map.setView() inside enterMonitorMode (below) fires 'moveend' itself — which would
  // silently repopulate the map with clickable nearby-stop markers a moment later, undoing the
  // switch to monitor mode.
  map.off("moveend", onViewportMoveEnd);
  window.clearTimeout(viewportDebounceTimer);

  clearStopMarkers();
  if (meMarker) {
    meMarker.remove();
    meMarker = null;
  }
  await enterMonitorMode(stopId);
}

/** Buses that already passed the stop stay visible on the map, in blue, for this long afterwards. */
const RECENTLY_PASSED_LOOKBACK_MINUTES = 10;
/**
 * A bus is only treated as "already passed" once it has BOTH dropped out of the TripUpdates feed
 * for this stop (producers remove a stop the moment the vehicle passes it) AND its last predicted
 * arrival is comfortably in the past. Time alone isn't enough: a late bus that's still approaching
 * keeps a stale-looking prediction while its real position shows it hasn't arrived.
 */
const PASSED_CONFIRM_GRACE_MS = 90_000;

async function refreshBusPositions(stopId: string): Promise<void> {
  // A slow previous refresh still resolving its fetches would otherwise interleave with this one and
  // leak duplicate markers (it clears early, then this run adds before it finishes adding).
  if (busRefreshInFlight) return;
  busRefreshInFlight = true;
  try {
    // Fetch only the "fresh" (not yet passed, modulo ~1 min feed lag) sightings for this tick, then
    // merge into our own short-term memory — see recentArrivalsByTripId's comment for why.
    const freshArrivals = await realtimeService.getArrivalsForStop(stopId);
    if (monitoredStopId !== stopId) return;

    // Trips still listed for this stop haven't passed it yet, however late they're running.
    const stillApproaching = new Set(freshArrivals.map((a) => a.tripId));
    let sawNewLine = false;
    for (const arrival of freshArrivals) {
      recentArrivalsByTripId.set(arrival.tripId, arrival);
      if (!availableLines.has(arrival.routeLabel)) {
        availableLines.add(arrival.routeLabel);
        sawNewLine = true;
      }
    }
    if (sawNewLine) renderLineFilterList();
    const cutoff = Date.now() - RECENTLY_PASSED_LOOKBACK_MINUTES * 60_000;
    for (const [tripId, arrival] of recentArrivalsByTripId) {
      if (arrival.arrivalTime.getTime() < cutoff) recentArrivalsByTripId.delete(tripId);
    }

    // Apply the line filter to what's actually shown on the map, without discarding tracked
    // arrivals for other lines from recentArrivalsByTripId — so toggling the filter takes effect
    // immediately, instead of waiting for the recently-passed lookback window to expire.
    const filteredTripIds = new Set(
      applyLineFilter([...recentArrivalsByTripId.values()], lineFilterState).map((a) => a.tripId)
    );
    if (filteredTripIds.size === 0) {
      clearBusMarkers();
      busStatusBarEl.innerHTML = "";
      return;
    }

    const arrivalByTripId = recentArrivalsByTripId;
    const positions = await vehiclePositions.getPositionsForTrips(filteredTripIds);
    if (monitoredStopId !== stopId) return;

    // For buses currently stopped, look up the realtime predicted departure from the stop they're
    // sitting at, so the chip can show when they're expected to move on.
    const stoppedTripStops = new Map<string, string>();
    for (const position of positions) {
      if (position.isStopped && position.currentStopId) {
        stoppedTripStops.set(position.tripId, position.currentStopId);
      }
    }
    const predictedDepartures = await realtimeService.getPredictedDeparturesAtStops(stoppedTripStops);
    if (monitoredStopId !== stopId) return;

    // Replace this tick's snapshot in one go, only after every fetch has resolved — clearing earlier
    // would leave the map empty during the fetch window.
    clearBusMarkers();
    const now = Date.now();
    busStatusBarEl.innerHTML = "";
    for (const position of positions) {
      const vehicleLabel = position.vehicleLabel || "?";
      const arrival = arrivalByTripId.get(position.tripId);
      // Prefix with the route so it's clear which line each bus belongs to at stops served by several.
      const label = arrival ? `[${arrival.routeLabel}] ${vehicleLabel}` : vehicleLabel;
      const hasPassed =
        arrival !== undefined &&
        !stillApproaching.has(position.tripId) &&
        arrival.arrivalTime.getTime() < now - PASSED_CONFIRM_GRACE_MS;
      const departureTime = position.isStopped && !hasPassed ? predictedDepartures.get(position.tripId) : undefined;

      const statusClass = hasPassed ? "passed" : position.isStopped ? "stopped" : "moving";
      let statusLabel = hasPassed ? "già passato" : position.isStopped ? "fermo" : "in movimento";
      if (departureTime) statusLabel = `fermo (${departureTime.toLocaleTimeString("it-IT")} |→)`;

      const etaLabel = arrival ? buildEtaLabel(arrival, hasPassed, departureTime !== undefined) : "";

      addBusMarker(position.tripId, position.lat, position.lon, label, statusClass, statusLabel, etaLabel);

      const chip = document.createElement("span");
      chip.className = hasPassed ? "bus-chip passed" : "bus-chip";
      chip.textContent = etaLabel ? `🚌 ${label}: ${statusLabel} — ${etaLabel}` : `🚌 ${label}: ${statusLabel}`;
      busStatusBarEl.appendChild(chip);
    }
  } catch (error) {
    console.error("[map] errore durante l'aggiornamento delle posizioni bus:", error);
  } finally {
    busRefreshInFlight = false;
  }
}

// The popup and this page share the monitoring state (and the line filter). Keep an already-open
// map in sync when either is changed elsewhere, rather than waiting for the page to be reopened.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes["monitoredStopId"]) {
    const stopId = changes["monitoredStopId"].newValue as string | undefined;
    if (stopId) {
      if (stopId !== monitoredStopId) void enterMonitorMode(stopId);
    } else if (monitoredStopId) {
      void enterBrowseMode();
    }
  }

  if (changes["lineFilter"] && monitoredStopId) {
    lineFilterState = (changes["lineFilter"].newValue as LineFilterState | undefined) ?? {
      enabled: false,
      selectedLines: [],
    };
    updateLineFilterEnabledState();
    renderLineFilterList();
    void refreshBusPositions(monitoredStopId);
  }
});

/**
 * The filter only ever does anything with at least one line selected, so keep the master checkbox
 * disabled (and forcibly unchecked) whenever the selection is empty, rather than letting it sit
 * checked-but-inert.
 */
function updateLineFilterEnabledState(): void {
  const hasSelection = lineFilterState.selectedLines.length > 0;
  lineFilterEnabledInput.disabled = !hasSelection;
  if (!hasSelection && lineFilterState.enabled) {
    lineFilterState = { ...lineFilterState, enabled: false };
    void setLineFilter(lineFilterState);
  }
  lineFilterEnabledInput.checked = lineFilterState.enabled;
}

function renderLineFilterList(): void {
  lineFilterListEl.innerHTML = "";
  const lines = [...availableLines].sort((a, b) => a.localeCompare(b, "it", { numeric: true }));

  for (const line of lines) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = lineFilterState.selectedLines.includes(line);
    checkbox.addEventListener("change", () => void onLineFilterSelectionChanged(line, checkbox.checked));
    label.append(checkbox, ` ${line}`);
    lineFilterListEl.appendChild(label);
  }
}

async function onLineFilterSelectionChanged(line: string, checked: boolean): Promise<void> {
  // Just persist it: chrome.storage.onChanged fires in this same page too, and its handler above
  // takes care of re-rendering the checkboxes and refreshing the bus markers.
  const selected = new Set(lineFilterState.selectedLines);
  if (checked) selected.add(line);
  else selected.delete(line);
  await setLineFilter({ ...lineFilterState, selectedLines: [...selected] });
}

lineFilterEnabledInput.addEventListener("change", () => {
  void setLineFilter({ ...lineFilterState, enabled: lineFilterEnabledInput.checked });
});

stopMonitoringButton.addEventListener("click", () => void stopMonitoringFromMap());

async function stopMonitoringFromMap(): Promise<void> {
  stopMonitoringButton.disabled = true;
  try {
    // Clear local mode before storage emits its change event, so the map switches immediately.
    monitoredStopId = null;
    await stopMonitoringStop();
    await enterBrowseMode();
  } finally {
    stopMonitoringButton.disabled = false;
  }
}

function buildEtaLabel(arrival: ArrivalInfo, hasPassed: boolean, markArrival = false): string {
  if (hasPassed) {
    const minutesAgo = Math.round((Date.now() - arrival.arrivalTime.getTime()) / 60_000);
    const label = minutesAgo <= 0 ? "appena passato" : minutesAgo === 1 ? "passato 1 min fa" : `passato ${minutesAgo} min fa`;
    return `${label} (${arrival.arrivalTime.toLocaleTimeString("it-IT")})`;
  }
  const label = minutesLabel(arrival);
  const prefix = label === "in arrivo" ? "" : "tra ";
  // When a departure time (|→) is also shown, mark the arrival time with →| to tell the two apart.
  const arrivalMark = markArrival ? "→| " : "";
  return `${prefix}${label} (${arrivalMark}${arrival.arrivalTime.toLocaleTimeString("it-IT")})`;
}

function buildStopTooltip(stopId: string, stopName: string): string {
  let tooltip = `<b>${escapeHtml(stopId)}</b> — ${escapeHtml(stopName)}`;
  const modes = staticData.tryGetStopModes(stopId);
  if (modes) tooltip += `<br><i>${escapeHtml(modes)}</i>`;
  return tooltip;
}

function createMap(lat: number, lon: number, zoom: number): void {
  // tile.openstreetmap.org is a volunteer-run server that blocks third-party app traffic (missing
  // browser-extension/WebView referrers read as "bulk" usage under its tile usage policy — see
  // https://operations.osmfoundation.org/policies/tiles/). Wikimedia's raster tiles turned out to
  // be rate-limited in practice, and CARTO's free basemaps now require an API key — OpenFreeMap is
  // free, unlimited, and needs no key, but only serves vector tiles, hence MapLibre GL JS instead
  // of Leaflet.
  map = new maplibregl.Map({
    container: mapEl,
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [lon, lat],
    zoom,
    attributionControl: { compact: true, customAttribution: "© OpenStreetMap contributors · © OpenFreeMap" },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

  // The "liberty" style (like "bright" before it) references a few POI icons (gate, office,
  // swimming_pool, ...) that aren't in the sprite sheet it's paired with — cosmetic gaps upstream.
  // setMissingStyleImageResolver is
  // awaited *before* MapLibre treats the image as missing, so resolving it here (unlike handling
  // the 'styleimagemissing' event, which fires only after the "could not be loaded" warning is
  // already logged) avoids the console warning entirely, not just the visual gap.
  map.setMissingStyleImageResolver((id) => {
    if (map.hasImage(id)) return;
    map.addImage(id, { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) });
  });
}

function addStopMarker(stopId: string, lat: number, lon: number, tooltipHtml: string, selectable: boolean): void {
  const el = document.createElement("div");
  el.className = "stop-marker" + (selectable ? " selectable" : " monitored");
  el.textContent = selectable ? "📍" : "🚏";
  // Leaflet's bindTooltip showed the label on hover (not click); replicate that with a popup
  // toggled on mouseenter/mouseleave instead of MapLibre's default click-to-open.
  const tooltip = new maplibregl.Popup({ offset: 14, closeButton: false, closeOnClick: false }).setHTML(tooltipHtml);
  stopTooltips.add(tooltip);
  el.addEventListener("mouseenter", () => tooltip.setLngLat([lon, lat]).addTo(map));
  el.addEventListener("mouseleave", () => tooltip.remove());
  if (selectable) {
    el.addEventListener("click", () => void selectStop(stopId));
  }
  stopMarkers.set(stopId, new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map));
}

function addBusMarker(
  tripId: string,
  lat: number,
  lon: number,
  label: string,
  statusClass: string,
  statusLabel: string,
  etaLabel: string
): void {
  busMarkers.get(tripId)?.remove(); // never leave the previous position's marker behind

  const el = document.createElement("div");
  el.className = `bus-icon ${statusClass}`;
  el.textContent = "🚌";
  let popupHtml = `${escapeHtml(label)} — ${escapeHtml(statusLabel)}`;
  if (etaLabel) popupHtml += `<br>${escapeHtml(etaLabel)}`;
  const popup = new maplibregl.Popup({ offset: 12 }).setHTML(popupHtml);
  busMarkers.set(tripId, new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).setPopup(popup).addTo(map));
}

function addMeMarker(lat: number, lon: number): void {
  meMarker?.remove();
  const el = document.createElement("div");
  el.className = "me-marker";
  const popup = new maplibregl.Popup({ offset: 10 }).setHTML("La tua posizione");
  meMarker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).setPopup(popup).addTo(map);
}

function clearStopMarkers(): void {
  for (const marker of stopMarkers.values()) marker.remove();
  stopMarkers.clear();
  for (const tooltip of stopTooltips) tooltip.remove(); // no-op for ones already closed
  stopTooltips.clear();
}

function clearBusMarkers(): void {
  for (const marker of busMarkers.values()) marker.remove();
  busMarkers.clear();
}

function getCurrentLocation(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => resolve(null),
      { timeout: 10_000, maximumAge: 5 * 60_000 }
    );
  });
}

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const EARTH_RADIUS_KM = 6371;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

void init();
