import { RecentStopsService } from "../data/recentStopsService.js";
import { LAST_NOTIFIED_KEY_STORAGE, MONITORED_STOP_KEY, MONITOR_ALARM_NAME } from "./storageKeys.js";

const recentStops = new RecentStopsService();

/** Shared by the popup and the map page: both can start monitoring a stop (map: by clicking a marker). */
export async function startMonitoringStop(stopId: string): Promise<void> {
  await chrome.storage.local.set({ [MONITORED_STOP_KEY]: stopId });
  await chrome.storage.local.remove(LAST_NOTIFIED_KEY_STORAGE);
  await recentStops.touch(stopId);
  // The background service worker polls independently of whether the popup/map is open; `when`
  // fires the first check almost immediately instead of waiting a full period.
  chrome.alarms.create(MONITOR_ALARM_NAME, { when: Date.now() + 1000, periodInMinutes: 1 });
}

export async function stopMonitoringStop(): Promise<void> {
  await chrome.storage.local.remove([MONITORED_STOP_KEY, LAST_NOTIFIED_KEY_STORAGE]);
  await chrome.alarms.clear(MONITOR_ALARM_NAME);
}

export async function getMonitoredStopId(): Promise<string | null> {
  const stored = await chrome.storage.local.get(MONITORED_STOP_KEY);
  return (stored[MONITORED_STOP_KEY] as string | undefined) ?? null;
}
