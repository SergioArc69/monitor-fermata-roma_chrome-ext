import type { ArrivalInfo } from "./models.js";

export interface LineFilterState {
  enabled: boolean;
  selectedLines: string[];
}

const DEFAULT_LINE_FILTER: LineFilterState = { enabled: false, selectedLines: [] };
const STORAGE_KEY = "lineFilter";

export async function getLineFilter(): Promise<LineFilterState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<LineFilterState> | undefined;
  return { ...DEFAULT_LINE_FILTER, ...stored };
}

export async function setLineFilter(filter: LineFilterState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: filter });
}

export function applyLineFilter(arrivals: ArrivalInfo[], filter: LineFilterState): ArrivalInfo[] {
  if (!filter.enabled || filter.selectedLines.length === 0) return arrivals;
  const selected = new Set(filter.selectedLines);
  return arrivals.filter((a) => selected.has(a.routeLabel));
}
