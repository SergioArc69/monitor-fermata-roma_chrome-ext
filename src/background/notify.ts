import type { ArrivalInfo } from "../shared/models.js";
import { displayName, minutesLabel, timeUntilArrivalMs } from "../shared/arrivalFormatting.js";
import { getNotifySettings, type NotifySettings } from "../shared/notifySettings.js";
import { LAST_NOTIFIED_KEY_STORAGE } from "../shared/storageKeys.js";

/**
 * Mirrors the desktop app's MaybeNotifyNextArrival: bucketing the estimated arrival time to the
 * previous even minute means small second-to-second prediction jitter between polls doesn't
 * re-trigger a notification, but a real change in the estimate (e.g. traffic) that crosses into a
 * new bucket still does. Keyed by tripId + bucket so it survives service worker restarts (state is
 * read from/written to chrome.storage.local, never kept only in memory).
 */
export async function maybeNotifyNextArrival(next: ArrivalInfo): Promise<void> {
  const settings = await getNotifySettings();
  if (!settings.enabled) return;
  if (!next.isRealtime) return; // the static timetable doesn't reflect real delays; not a reliable notification basis

  const msUntilArrival = timeUntilArrivalMs(next);
  const thresholdMs = settings.minutesThreshold * 60_000;
  if (msUntilArrival <= 0 || msUntilArrival > thresholdMs) return;

  if (!isWithinNotifyWindow(settings)) return;

  const bucket = roundDownToEvenMinute(next.arrivalTime);
  const key = `${next.tripId}|${bucket.toISOString()}`;

  const stored = await chrome.storage.local.get(LAST_NOTIFIED_KEY_STORAGE);
  if (stored[LAST_NOTIFIED_KEY_STORAGE] === key) return;

  await chrome.storage.local.set({ [LAST_NOTIFIED_KEY_STORAGE]: key });

  chrome.notifications.create(`arrival-${next.tripId}`, {
    type: "basic",
    // A relative path doesn't reliably resolve from a service worker context (no document base
    // URI); chrome.runtime.getURL gives the notifications API an absolute chrome-extension:// URL.
    iconUrl: chrome.runtime.getURL("assets/icons/icon128.png"),
    title: "Autobus in arrivo",
    message: `${displayName(next)} arriva tra ${minutesLabel(next)} (${next.arrivalTime.toLocaleTimeString("it-IT")}).`,
  });
}

function roundDownToEvenMinute(date: Date): Date {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  const minutes = rounded.getMinutes();
  rounded.setMinutes(minutes - (minutes % 2));
  return rounded;
}

function isWithinNotifyWindow(settings: NotifySettings, now: Date = new Date()): boolean {
  const from = parseTimeOfDayMinutes(settings.fromTime) ?? 0;
  const to = parseTimeOfDayMinutes(settings.toTime) ?? 23 * 60 + 59;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return from <= to ? nowMinutes >= from && nowMinutes <= to : nowMinutes >= from || nowMinutes <= to; // overnight range, e.g. 22:00-06:00
}

function parseTimeOfDayMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number.parseInt(match[1]!, 10);
  const minutes = Number.parseInt(match[2]!, 10);
  return hours * 60 + minutes;
}
