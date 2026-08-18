const STORAGE_KEY = "recentStopIds";
const MAX_ITEMS = 5;

/** Keeps the last N monitored stop ids (most-recent-first), persisted in chrome.storage.local. */
export class RecentStopsService {
  async getStopIds(): Promise<string[]> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as string[] | undefined) ?? [];
  }

  async touch(stopId: string): Promise<void> {
    const current = await this.getStopIds();
    const next = [stopId, ...current.filter((id) => id !== stopId)].slice(0, MAX_ITEMS);
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
  }
}
