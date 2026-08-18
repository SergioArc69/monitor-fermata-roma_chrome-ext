import type { ArrivalInfo } from "./models.js";
import { LAST_ARRIVALS_KEY } from "./storageKeys.js";

/**
 * Caches the last known realtime arrivals per stop in chrome.storage.local, so a freshly opened
 * popup can show something instantly (the background poll already fetched this within the last
 * minute) instead of a blank "searching" state while it re-fetches for up-to-date data.
 */
type StoredArrival = Omit<ArrivalInfo, "arrivalTime"> & { arrivalTime: string };

interface CachedArrivals {
  stopId: string;
  fetchedAtIso: string;
  arrivals: StoredArrival[];
}

export async function getCachedArrivals(stopId: string): Promise<ArrivalInfo[] | null> {
  const stored = await chrome.storage.local.get(LAST_ARRIVALS_KEY);
  const cached = stored[LAST_ARRIVALS_KEY] as CachedArrivals | undefined;
  if (!cached || cached.stopId !== stopId) return null;

  const arrivals = cached.arrivals
    .map((a) => ({ ...a, arrivalTime: new Date(a.arrivalTime) }))
    .filter((a) => !Number.isNaN(a.arrivalTime.getTime()));
  return arrivals;
}

export async function setCachedArrivals(stopId: string, arrivals: ArrivalInfo[]): Promise<void> {
  const cached: CachedArrivals = {
    stopId,
    fetchedAtIso: new Date().toISOString(),
    arrivals: arrivals.map((a) => ({ ...a, arrivalTime: a.arrivalTime.toISOString() })),
  };
  await chrome.storage.local.set({ [LAST_ARRIVALS_KEY]: cached });
}

export async function clearCachedArrivals(): Promise<void> {
  await chrome.storage.local.remove(LAST_ARRIVALS_KEY);
}
