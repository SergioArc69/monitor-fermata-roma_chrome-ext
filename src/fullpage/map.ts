import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { GtfsStaticData } from "../data/gtfsStaticData.js";
import { GtfsRealtimeService } from "../data/gtfsRealtimeService.js";
import { VehiclePositionsService } from "../data/vehiclePositionsService.js";
import { getMonitoredStopId, startMonitoringStop, stopMonitoringStop } from "../shared/monitoringController.js";
import type { ArrivalInfo } from "../shared/models.js";
import { minutesLabel } from "../shared/arrivalFormatting.js";

const MAX_VISIBLE_STOPS = 150;
const BUS_REFRESH_INTERVAL_MS = 15_000;
const ROME_FALLBACK = { lat: 41.9028, lon: 12.4964 };
const MAX_DISTANCE_FROM_ROME_KM = 50;

const instructionEl = document.getElementById("instruction") as HTMLDivElement;
const mapEl = document.getElementById("map") as HTMLDivElement;
const busStatusBarEl = document.getElementById("busStatusBar") as HTMLDivElement;
const stopMonitoringButton = document.getElementById("stopMonitoringButton") as HTMLButtonElement;

const staticData = new GtfsStaticData();
const realtimeService = new GtfsRealtimeService(staticData);
const vehiclePositions = new VehiclePositionsService();

const stopIcon = L.divIcon({ className: "stop-icon", html: "📍", iconSize: [22, 22] });
const monitoredStopIcon = L.divIcon({ className: "stop-icon monitored", html: "🚏", iconSize: [24, 24] });

let map: L.Map;
let meMarker: L.CircleMarker | null = null;
const stopMarkers = new Map<string, L.Marker>();
const busMarkers = new Map<string, L.Marker>();
let viewportDebounceTimer: number | undefined;
let busRefreshTimer: number | undefined;
let monitoredStopId: string | null = null;
// The upstream GTFS-RT feed drops a stop's stop_time_update entry almost as soon as the bus passes
// it — it does NOT keep reporting it for minutes afterwards. So to keep recently-passed buses on
// the map for a while, we have to remember their last-seen arrival ourselves, rather than expecting
// the feed to still have it on a later poll. Reset whenever a (possibly different) stop is monitored.
let recentArrivalsByTripId = new Map<string, ArrivalInfo>();

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
    await enterBrowseMode();
  }
}

async function enterMonitorMode(stopId: string): Promise<void> {
  monitoredStopId = stopId;
  recentArrivalsByTripId = new Map();
  window.clearInterval(busRefreshTimer);
  map?.off("moveend", onViewportMoveEnd);

  const location = staticData.tryGetStopLocation(stopId);
  if (!location) {
    instructionEl.textContent = `Fermata ${stopId} non trovata nei dati statici: mostro comunque la mappa di Roma.`;
    await enterBrowseMode();
    return;
  }

  instructionEl.textContent = "Fermata monitorata, con la posizione dei bus in transito (aggiornata ogni 15 secondi).";
  stopMonitoringButton.style.display = "block";
  mapEl.classList.add("with-bus-bar");
  busStatusBarEl.style.display = "flex";

  if (!map) createMap(location.lat, location.lon, 16);
  else map.setView([location.lat, location.lon], 16);

  const stopName = staticData.tryGetStopName(stopId) ?? "";
  addStopMarker(stopId, location.lat, location.lon, buildStopTooltip(stopId, stopName), false);

  await refreshBusPositions(stopId);
  if (monitoredStopId === stopId) {
    busRefreshTimer = window.setInterval(() => void refreshBusPositions(stopId), BUS_REFRESH_INTERVAL_MS);
  }
}

async function enterBrowseMode(): Promise<void> {
  monitoredStopId = null;
  window.clearInterval(busRefreshTimer);
  clearBusMarkers();
  busStatusBarEl.innerHTML = "";
  busStatusBarEl.style.display = "none";
  mapEl.classList.remove("with-bus-bar");
  stopMonitoringButton.style.display = "none";

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
  else map.setView([lat, lon], 16);
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
    map.removeLayer(meMarker);
    meMarker = null;
  }
  await enterMonitorMode(stopId);
}

/** Buses that already passed the stop stay visible on the map, in blue, for this long afterwards. */
const RECENTLY_PASSED_LOOKBACK_MINUTES = 10;

async function refreshBusPositions(stopId: string): Promise<void> {
  try {
    // Fetch only the "fresh" (not yet passed, modulo ~1 min feed lag) sightings for this tick, then
    // merge into our own short-term memory — see recentArrivalsByTripId's comment for why.
    const freshArrivals = await realtimeService.getArrivalsForStop(stopId);
    if (monitoredStopId !== stopId) return;

    for (const arrival of freshArrivals) {
      recentArrivalsByTripId.set(arrival.tripId, arrival);
    }
    const cutoff = Date.now() - RECENTLY_PASSED_LOOKBACK_MINUTES * 60_000;
    for (const [tripId, arrival] of recentArrivalsByTripId) {
      if (arrival.arrivalTime.getTime() < cutoff) recentArrivalsByTripId.delete(tripId);
    }

    clearBusMarkers();

    if (recentArrivalsByTripId.size === 0) {
      busStatusBarEl.innerHTML = "";
      return;
    }

    const arrivalByTripId = recentArrivalsByTripId;
    const positions = await vehiclePositions.getPositionsForTrips(new Set(arrivalByTripId.keys()));
    if (monitoredStopId !== stopId) return;

    const now = Date.now();
    busStatusBarEl.innerHTML = "";
    for (const position of positions) {
      const vehicleLabel = position.vehicleLabel || "?";
      const arrival = arrivalByTripId.get(position.tripId);
      // Prefix with the route so it's clear which line each bus belongs to at stops served by several.
      const label = arrival ? `[${arrival.routeLabel}] ${vehicleLabel}` : vehicleLabel;
      const hasPassed = arrival !== undefined && arrival.arrivalTime.getTime() < now;
      const etaLabel = arrival ? buildEtaLabel(arrival, hasPassed) : "";
      const statusLabel = hasPassed ? "già passato" : position.isStopped ? "fermo" : "in movimento";

      addBusMarker(position.tripId, position.lat, position.lon, label, position.isStopped, etaLabel, hasPassed);

      const chip = document.createElement("span");
      chip.className = hasPassed ? "bus-chip passed" : "bus-chip";
      chip.textContent = etaLabel ? `🚌 ${label}: ${statusLabel} — ${etaLabel}` : `🚌 ${label}: ${statusLabel}`;
      busStatusBarEl.appendChild(chip);
    }
  } catch (error) {
    console.error("[map] errore durante l'aggiornamento delle posizioni bus:", error);
  }
}

// The popup and this page share the monitoring state. Keep an already-open map in sync when
// monitoring is started or stopped elsewhere, rather than waiting for the page to be reopened.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes["monitoredStopId"]) return;

  const stopId = changes["monitoredStopId"].newValue as string | undefined;
  if (stopId) {
    if (stopId !== monitoredStopId) void enterMonitorMode(stopId);
  } else if (monitoredStopId) {
    void enterBrowseMode();
  }
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

function buildEtaLabel(arrival: ArrivalInfo, hasPassed: boolean): string {
  if (hasPassed) {
    const minutesAgo = Math.round((Date.now() - arrival.arrivalTime.getTime()) / 60_000);
    const label = minutesAgo <= 0 ? "appena passato" : minutesAgo === 1 ? "passato 1 min fa" : `passato ${minutesAgo} min fa`;
    return `${label} (${arrival.arrivalTime.toLocaleTimeString("it-IT")})`;
  }
  const label = minutesLabel(arrival);
  const prefix = label === "in arrivo" ? "" : "tra ";
  return `${prefix}${label} (${arrival.arrivalTime.toLocaleTimeString("it-IT")})`;
}

function buildStopTooltip(stopId: string, stopName: string): string {
  let tooltip = `<b>${escapeHtml(stopId)}</b> — ${escapeHtml(stopName)}`;
  const modes = staticData.tryGetStopModes(stopId);
  if (modes) tooltip += `<br><i>${escapeHtml(modes)}</i>`;
  return tooltip;
}

function createMap(lat: number, lon: number, zoom: number): void {
  map = L.map(mapEl).setView([lat, lon], zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
}

function addStopMarker(stopId: string, lat: number, lon: number, tooltipHtml: string, selectable: boolean): void {
  const marker = L.marker([lat, lon], { icon: selectable ? stopIcon : monitoredStopIcon })
    .addTo(map)
    .bindTooltip(tooltipHtml, { direction: "top", offset: [0, -14] });
  if (selectable) {
    marker.on("click", () => void selectStop(stopId));
  }
  stopMarkers.set(stopId, marker);
}

function addBusMarker(
  tripId: string,
  lat: number,
  lon: number,
  label: string,
  isStopped: boolean,
  etaLabel: string,
  hasPassed: boolean
): void {
  const statusClass = hasPassed ? "passed" : isStopped ? "stopped" : "moving";
  const icon = L.divIcon({ className: `bus-icon ${statusClass}`, html: "🚌", iconSize: [24, 24] });
  let popup = `${escapeHtml(label)} — ${hasPassed ? "già passato" : isStopped ? "fermo" : "in movimento"}`;
  if (etaLabel) popup += `<br>${escapeHtml(etaLabel)}`;
  const marker = L.marker([lat, lon], { icon }).addTo(map).bindPopup(popup);
  busMarkers.set(tripId, marker);
}

function addMeMarker(lat: number, lon: number): void {
  if (meMarker) map.removeLayer(meMarker);
  meMarker = L.circleMarker([lat, lon], { radius: 8, color: "#1a73e8", fillColor: "#1a73e8", fillOpacity: 0.9 })
    .addTo(map)
    .bindPopup("La tua posizione");
}

function clearStopMarkers(): void {
  for (const marker of stopMarkers.values()) map.removeLayer(marker);
  stopMarkers.clear();
}

function clearBusMarkers(): void {
  for (const marker of busMarkers.values()) map.removeLayer(marker);
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
