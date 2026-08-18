import { GtfsStaticData } from "../data/gtfsStaticData.js";
import { GtfsRealtimeService } from "../data/gtfsRealtimeService.js";
import { maybeNotifyNextArrival } from "./notify.js";
import { MONITORED_STOP_KEY, MONITOR_ALARM_NAME } from "../shared/storageKeys.js";
import { applyLineFilter, getLineFilter } from "../shared/lineFilter.js";
import { setCachedArrivals } from "../shared/arrivalsCache.js";

console.log("[Monitor Fermata ATAC Roma] service worker avviato.");

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Monitor Fermata ATAC Roma] estensione installata/aggiornata.");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MONITOR_ALARM_NAME) void pollMonitoredStop();
});

async function pollMonitoredStop(): Promise<void> {
  const stored = await chrome.storage.local.get(MONITORED_STOP_KEY);
  const stopId = stored[MONITORED_STOP_KEY] as string | undefined;
  if (!stopId) return; // stale alarm firing after monitoring was stopped; nothing to do

  try {
    const staticData = new GtfsStaticData();
    await staticData.load();

    const realtimeService = new GtfsRealtimeService(staticData);
    const arrivals = await realtimeService.getArrivalsForStop(stopId);
    await setCachedArrivals(stopId, arrivals);

    const lineFilter = await getLineFilter();
    const filtered = applyLineFilter(arrivals, lineFilter);

    if (filtered.length > 0) {
      await maybeNotifyNextArrival(filtered[0]!);
    }
  } catch (error) {
    // HTTP errors and truncated-response decode failures are transient upstream feed hiccups,
    // not application bugs: the next poll (in 1 minute) retries on its own.
    console.warn("[Monitor Fermata ATAC Roma] poll in background non riuscito (riprovo al prossimo ciclo):", error);
  }
}
