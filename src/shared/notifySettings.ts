export interface NotifySettings {
  enabled: boolean;
  minutesThreshold: number;
  fromTime: string; // "HH:mm"
  toTime: string; // "HH:mm"
}

export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = {
  enabled: true,
  minutesThreshold: 5,
  fromTime: "00:00",
  toTime: "23:59",
};

const STORAGE_KEY = "notifySettings";

export async function getNotifySettings(): Promise<NotifySettings> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<NotifySettings> | undefined;
  return { ...DEFAULT_NOTIFY_SETTINGS, ...stored };
}

export async function setNotifySettings(settings: NotifySettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}
