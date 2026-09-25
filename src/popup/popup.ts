import { GtfsStaticData } from "../data/gtfsStaticData.js";
import { GtfsRealtimeService } from "../data/gtfsRealtimeService.js";
import { RecentStopsService } from "../data/recentStopsService.js";
import type { ArrivalInfo, StopSuggestion } from "../shared/models.js";
import { commonDestination, destinationLabel, delayLabel, minutesLabel } from "../shared/arrivalFormatting.js";
import { MONITORED_STOP_KEY, MONITOR_ALARM_NAME } from "../shared/storageKeys.js";
import { DEFAULT_NOTIFY_SETTINGS, getNotifySettings, setNotifySettings } from "../shared/notifySettings.js";
import { applyLineFilter, getLineFilter, setLineFilter, type LineFilterState } from "../shared/lineFilter.js";
import { startMonitoringStop, stopMonitoringStop } from "../shared/monitoringController.js";
import { getCachedArrivals, setCachedArrivals, clearCachedArrivals } from "../shared/arrivalsCache.js";

const MAX_SEARCH_RESULTS = 20;

const stopInput = document.getElementById("stopInput") as HTMLInputElement;
const suggestionsEl = document.getElementById("suggestions") as HTMLDivElement;
const stopHintEl = document.getElementById("stopHint") as HTMLDivElement;
const arrivalsEl = document.getElementById("arrivals") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const monitorButton = document.getElementById("monitorButton") as HTMLButtonElement;
const stopButton = document.getElementById("stopButton") as HTMLButtonElement;
const mapButton = document.getElementById("mapButton") as HTMLButtonElement;
const aboutButton = document.getElementById("aboutButton") as HTMLButtonElement;

const settingsToggle = document.getElementById("settingsToggle") as HTMLButtonElement;
const settingsPanel = document.getElementById("settingsPanel") as HTMLDivElement;
const notifyEnabledInput = document.getElementById("notifyEnabled") as HTMLInputElement;
const minutesThresholdInput = document.getElementById("minutesThreshold") as HTMLInputElement;
const notifyFromInput = document.getElementById("notifyFrom") as HTMLInputElement;
const notifyToInput = document.getElementById("notifyTo") as HTMLInputElement;

const lineFilterEnabledInput = document.getElementById("lineFilterEnabled") as HTMLInputElement;
const lineFilterListEl = document.getElementById("lineFilterList") as HTMLDivElement;

const staticData = new GtfsStaticData();
const realtimeService = new GtfsRealtimeService(staticData);
const recentStops = new RecentStopsService();

let staticDataReady = false;
let monitoredStopId: string | null = null;
let lastArrivals: ArrivalInfo[] = [];
const availableLines = new Set<string>();
let lineFilterState: LineFilterState = { enabled: false, selectedLines: [] };

async function init(): Promise<void> {
  const stored = await chrome.storage.local.get(MONITORED_STOP_KEY);
  monitoredStopId = (stored[MONITORED_STOP_KEY] as string | undefined) ?? null;

  await loadNotifySettingsIntoUi();
  lineFilterState = await getLineFilter();
  updateLineFilterEnabledState();

  statusEl.textContent = "Caricamento dati GTFS statici...";
  try {
    await staticData.load();
    staticDataReady = true;
    statusEl.textContent = "Dati caricati.";
    // Background, best-effort: a multi-second full scan to learn each stop's transport mode and each
    // line's stops (used by search-by-line and the map's tooltips). Nothing waits on this — if it
    // isn't done yet, search-by-line and mode info just aren't available until it completes.
    void staticData.buildStopIndexes();
  } catch (error) {
    statusEl.textContent = `Errore nel caricamento dei dati statici: ${(error as Error).message}`;
  }

  if (monitoredStopId) {
    stopInput.value = monitoredStopId;
    updateStopHint();
    setMonitoringUiState(true);
    // Re-create defensively in case it didn't survive an extension reload/update.
    chrome.alarms.create(MONITOR_ALARM_NAME, { when: Date.now() + 1000, periodInMinutes: 1 });

    // The background poll already fetched arrivals for this stop within the last minute: show that
    // instantly instead of a blank "searching" state, then refresh in the background for accuracy
    // (line filter is applied by applyFilterAndDisplay, so an unfiltered cache is fine here).
    const cached = await getCachedArrivals(monitoredStopId);
    if (cached) {
      lastArrivals = cached;
      for (const arrival of lastArrivals) availableLines.add(arrival.routeLabel);
      renderLineFilterList();
      applyFilterAndDisplay();
    }

    await refreshArrivals();
  }
}

async function loadNotifySettingsIntoUi(): Promise<void> {
  const settings = await getNotifySettings();
  notifyEnabledInput.checked = settings.enabled;
  minutesThresholdInput.value = String(settings.minutesThreshold);
  notifyFromInput.value = settings.fromTime;
  notifyToInput.value = settings.toTime;
}

async function saveNotifySettingsFromUi(): Promise<void> {
  const minutesThreshold = Number.parseInt(minutesThresholdInput.value, 10) || DEFAULT_NOTIFY_SETTINGS.minutesThreshold;
  await setNotifySettings({
    enabled: notifyEnabledInput.checked,
    minutesThreshold,
    fromTime: notifyFromInput.value || DEFAULT_NOTIFY_SETTINGS.fromTime,
    toTime: notifyToInput.value || DEFAULT_NOTIFY_SETTINGS.toTime,
  });
}

function updateStopHint(): void {
  stopHintEl.classList.remove("error");
  const stopId = stopInput.value.trim();
  if (!stopId) {
    stopHintEl.textContent = "";
  } else if (!staticDataReady) {
    stopHintEl.textContent = "(caricamento nomi fermate...)";
  } else {
    const name = staticData.tryGetStopName(stopId);
    stopHintEl.textContent = name ?? "";
  }
}

async function buildRecentSuggestions(): Promise<StopSuggestion[]> {
  const ids = await recentStops.getStopIds();
  return ids.map((stopId) => ({ stopId, stopName: staticData.tryGetStopName(stopId) ?? "" }));
}

async function updateSuggestions(): Promise<void> {
  const text = stopInput.value.trim();
  let items: StopSuggestion[];

  if (!text) {
    items = await buildRecentSuggestions();
  } else if (staticDataReady) {
    items = staticData.searchStops(text, MAX_SEARCH_RESULTS);
  } else {
    items = [];
  }

  renderSuggestions(items);
}

function renderSuggestions(items: StopSuggestion[]): void {
  suggestionsEl.innerHTML = "";
  if (items.length === 0) {
    suggestionsEl.style.display = "none";
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.textContent = item.isLine ? `🚌 Linea ${item.stopId} — ${item.stopName}` : `${item.stopId} — ${item.stopName}`;
    row.addEventListener("click", () => {
      stopInput.value = item.stopId;
      if (item.isLine) {
        // Picking a line searches its code instead of ending the search, so the field then lists
        // that line's stops.
        void updateSuggestions();
        stopInput.focus();
      } else {
        suggestionsEl.style.display = "none";
      }
      updateStopHint();
    });
    suggestionsEl.appendChild(row);
  }
  suggestionsEl.style.display = "block";
}

function setMonitoringUiState(isMonitoring: boolean): void {
  monitorButton.disabled = isMonitoring;
  stopButton.disabled = !isMonitoring;
  stopInput.disabled = isMonitoring;
}

function setStatusLoading(message: string): void {
  statusEl.innerHTML = "";
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  statusEl.append(spinner, message);
}

async function startMonitoring(): Promise<void> {
  const stopId = stopInput.value.trim();
  if (!stopId) {
    statusEl.textContent = "Inserisci un codice fermata valido.";
    return;
  }

  // Only refuse a code the static data is sure does not exist: with it not loaded yet there is
  // nothing to check against, so it is let through (the realtime feed can know a stop the static
  // data doesn't, too). Checked here, before touching "recent stops" or starting a useless poll —
  // unlike the warning below, which still applies once monitoring is under way.
  if (staticDataReady && !staticData.tryGetStopName(stopId)) {
    stopHintEl.textContent = `Codice fermata "${stopId}" non trovato`;
    stopHintEl.classList.add("error");
    return;
  }
  stopHintEl.classList.remove("error");

  monitoredStopId = stopId;
  setMonitoringUiState(true);
  setStatusLoading("Ricerca corse in arrivo...");
  arrivalsEl.innerHTML = "";
  arrivalsEl.classList.add("loading");
  arrivalsEl.textContent = "Ricerca in corso, attendere qualche secondo...";

  await startMonitoringStop(stopId);
  availableLines.clear();
  renderLineFilterList();

  await refreshArrivals();
}

async function stopMonitoring(): Promise<void> {
  monitoredStopId = null;
  await stopMonitoringStop();
  await clearCachedArrivals();
  setMonitoringUiState(false);
  lastArrivals = [];
  availableLines.clear();
  renderLineFilterList();
  arrivalsEl.innerHTML = "";
  statusEl.textContent = "Monitoraggio fermato.";
}

async function refreshArrivals(): Promise<void> {
  if (!monitoredStopId) return;

  setStatusLoading("Ricerca corse in arrivo...");

  try {
    const realtimeArrivals = await realtimeService.getArrivalsForStop(monitoredStopId);
    if (realtimeArrivals.length > 0) void setCachedArrivals(monitoredStopId, realtimeArrivals);

    lastArrivals =
      realtimeArrivals.length === 0
        ? await getScheduledFallback(monitoredStopId)
        : await supplementSparseLines(monitoredStopId, realtimeArrivals);

    for (const arrival of lastArrivals) availableLines.add(arrival.routeLabel);
    renderLineFilterList();
    applyFilterAndDisplay();
  } catch (error) {
    arrivalsEl.classList.remove("loading");
    statusEl.textContent = `Errore durante l'aggiornamento: ${(error as Error).message}`;
  }
}

/** GTFS-RT sometimes has nothing for a stop (quiet periods, feed gaps): fall back to the static timetable. */
async function getScheduledFallback(stopId: string): Promise<ArrivalInfo[]> {
  const scheduled = await staticData.getScheduledArrivals(stopId, 20);
  return scheduled.map((s) => ({ ...s, delaySeconds: 0, isRealtime: false }));
}

/**
 * When a line only has a single realtime arrival, the rider can't yet tell if buses on that line are
 * still frequent or about to thin out — pad it with the next couple of scheduled (non-live) arrivals
 * for the same line, clearly marked as such via isRealtime: false.
 */
async function supplementSparseLines(stopId: string, realtimeArrivals: ArrivalInfo[]): Promise<ArrivalInfo[]> {
  const countByLine = new Map<string, number>();
  for (const arrival of realtimeArrivals) {
    countByLine.set(arrival.routeLabel, (countByLine.get(arrival.routeLabel) ?? 0) + 1);
  }
  const sparseLines = new Set([...countByLine].filter(([, count]) => count === 1).map(([line]) => line));
  if (sparseLines.size === 0) return realtimeArrivals;

  const scheduled = await staticData.getScheduledArrivals(stopId, 150);
  if (scheduled.length === 0) return realtimeArrivals;

  const existingTripIds = new Set(realtimeArrivals.map((a) => a.tripId));
  const byLine = new Map<string, ArrivalInfo[]>();
  for (const s of scheduled) {
    if (!sparseLines.has(s.routeLabel) || existingTripIds.has(s.tripId)) continue;
    const list = byLine.get(s.routeLabel) ?? [];
    list.push({ ...s, delaySeconds: 0, isRealtime: false });
    byLine.set(s.routeLabel, list);
  }

  const supplement: ArrivalInfo[] = [];
  for (const list of byLine.values()) {
    list.sort((a, b) => a.arrivalTime.getTime() - b.arrivalTime.getTime());
    supplement.push(...list.slice(0, 2));
  }

  return [...realtimeArrivals, ...supplement].sort((a, b) => a.arrivalTime.getTime() - b.arrivalTime.getTime());
}

function applyFilterAndDisplay(): void {
  const arrivals = applyLineFilter(lastArrivals, lineFilterState);
  renderArrivals(arrivals);

  const scheduledCount = arrivals.filter((a) => !a.isRealtime).length;
  const timestamp = new Date().toLocaleTimeString("it-IT");
  if (arrivals.length === 0) {
    statusEl.textContent = `Ultimo aggiornamento: ${timestamp} — nessuna corsa in arrivo trovata per questa fermata.`;
  } else if (scheduledCount === arrivals.length) {
    statusEl.textContent = `Ultimo aggiornamento: ${timestamp} — nessun dato in tempo reale, mostrate le prossime ${arrivals.length} corse dall'orario schedulato.`;
  } else if (scheduledCount > 0) {
    statusEl.textContent = `Ultimo aggiornamento: ${timestamp} — ${arrivals.length} corse in arrivo (${scheduledCount} dall'orario schedulato).`;
  } else {
    statusEl.textContent = `Ultimo aggiornamento: ${timestamp} — ${arrivals.length} corse in arrivo.`;
  }
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

/**
 * The filter only ever does anything with at least one line selected, so keep the master checkbox
 * disabled (and forcibly unchecked) whenever the selection is empty, rather than letting it sit
 * checked-but-inert.
 */
function updateLineFilterEnabledState(): void {
  const hasSelection = lineFilterState.selectedLines.length > 0;
  lineFilterEnabledInput.disabled = !hasSelection;
  if (!hasSelection) lineFilterState = { ...lineFilterState, enabled: false };
  lineFilterEnabledInput.checked = lineFilterState.enabled;
}

async function onLineFilterSelectionChanged(line: string, checked: boolean): Promise<void> {
  const selected = new Set(lineFilterState.selectedLines);
  if (checked) selected.add(line);
  else selected.delete(line);
  lineFilterState = { ...lineFilterState, selectedLines: [...selected] };
  updateLineFilterEnabledState();
  await setLineFilter(lineFilterState);
  applyFilterAndDisplay();
}

function renderArrivals(arrivals: ArrivalInfo[]): void {
  arrivalsEl.classList.remove("loading");
  arrivalsEl.innerHTML = "";

  const byLine = new Map<string, ArrivalInfo[]>();
  for (const arrival of arrivals) {
    const group = byLine.get(arrival.routeLabel) ?? [];
    group.push(arrival);
    byLine.set(arrival.routeLabel, group);
  }

  const lineLabels = [...byLine.keys()].sort((a, b) => a.localeCompare(b, "it", { numeric: true }));
  for (const line of lineLabels) {
    const lineArrivals = byLine.get(line)!;
    const destination = commonDestination(lineArrivals);

    const groupEl = document.createElement("div");
    groupEl.className = "arrivals-group";

    const heading = document.createElement("h2");
    heading.textContent = destination ? `Linea ${line} → ${destination}` : `Linea ${line}`;
    groupEl.appendChild(heading);

    // When every run agrees on a destination it's shown once, on the heading above, rather than
    // repeated on every row.
    for (const arrival of lineArrivals) {
      const row = document.createElement("div");
      row.className = "arrival-row";

      if (!destination) {
        const dest = document.createElement("span");
        dest.className = "destination";
        dest.textContent = destinationLabel(arrival);
        if (!arrival.isRealtime) dest.classList.add("scheduled");
        row.appendChild(dest);
      }

      const minutes = document.createElement("span");
      minutes.className = "minutes";
      minutes.textContent = `${minutesLabel(arrival)} [${arrival.arrivalTime.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}]`;
      row.appendChild(minutes);

      const delay = document.createElement("span");
      delay.className = "delay";
      delay.textContent = delayLabel(arrival);
      if (arrival.isRealtime && arrival.delaySeconds > 60) delay.classList.add("late");
      row.appendChild(delay);

      groupEl.appendChild(row);
    }

    arrivalsEl.appendChild(groupEl);
  }
}

stopInput.addEventListener("input", () => {
  updateStopHint();
  void updateSuggestions();
});
stopInput.addEventListener("focus", () => void updateSuggestions());
stopInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void startMonitoring();
});
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Node)) return;
  if (!suggestionsEl.contains(event.target) && event.target !== stopInput) {
    suggestionsEl.style.display = "none";
  }
});

monitorButton.addEventListener("click", () => void startMonitoring());
stopButton.addEventListener("click", () => void stopMonitoring());
mapButton.addEventListener("click", () => {
  const stopId = stopInput.value.trim();
  const pagePath = stopId ? `dist/map.html?centerStop=${encodeURIComponent(stopId)}` : "dist/map.html";
  void openOrFocusTab("mapTabId", pagePath);
});
aboutButton.addEventListener("click", () => void openOrFocusTab("aboutTabId", "dist/about.html"));

/**
 * Reuses an already-open tab for a given extension page instead of stacking up duplicates. Also
 * re-navigates it to pagePath even when reused, so e.g. a newly typed stop code (via the map's
 * ?centerStop= param) still takes effect on a map tab that was already open.
 */
async function openOrFocusTab(sessionKey: string, pagePath: string): Promise<void> {
  const stored = await chrome.storage.session.get(sessionKey);
  const tabId = stored[sessionKey] as number | undefined;
  const url = chrome.runtime.getURL(pagePath);

  if (tabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true, url });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch {
      // Tab was closed since we last tracked it: fall through and open a new one.
    }
  }

  const created = await chrome.tabs.create({ url });
  if (created.id !== undefined) await chrome.storage.session.set({ [sessionKey]: created.id });
}

settingsToggle.addEventListener("click", () => settingsPanel.classList.toggle("open"));
for (const el of [notifyEnabledInput, minutesThresholdInput, notifyFromInput, notifyToInput]) {
  el.addEventListener("change", () => void saveNotifySettingsFromUi());
}

lineFilterEnabledInput.addEventListener("change", () => {
  lineFilterState = { ...lineFilterState, enabled: lineFilterEnabledInput.checked };
  void setLineFilter(lineFilterState).then(applyFilterAndDisplay);
});

void init();
