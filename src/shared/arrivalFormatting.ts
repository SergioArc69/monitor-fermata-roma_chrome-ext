import type { ArrivalInfo } from "./models.js";

export function displayName(arrival: ArrivalInfo): string {
  return arrival.headsign
    ? `Linea ${arrival.routeLabel} → ${arrival.headsign}`
    : `Linea ${arrival.routeLabel}`;
}

export const unknownDestination = "—";

export function destinationLabel(arrival: ArrivalInfo): string {
  return arrival.headsign || unknownDestination;
}

/**
 * The destination to show once, next to the line's name, instead of on every row: only when every
 * run agrees on a real one. A stop served in more than one direction can have runs of the same line
 * going different ways, so those keep the per-row destination instead — and so does a line the feed
 * never gives a destination for (some don't): unknownDestination never counts as "agreed".
 */
export function commonDestination(lineArrivals: ArrivalInfo[]): string | null {
  const destinations = new Set(lineArrivals.map(destinationLabel));
  if (destinations.size !== 1) return null;
  const [only] = destinations;
  return only === unknownDestination ? null : only!;
}

export function timeUntilArrivalMs(arrival: ArrivalInfo, now: Date = new Date()): number {
  return arrival.arrivalTime.getTime() - now.getTime();
}

export function minutesLabel(arrival: ArrivalInfo, now: Date = new Date()): string {
  const minutes = Math.round(timeUntilArrivalMs(arrival, now) / 60_000);
  if (Number.isNaN(minutes)) return "orario sconosciuto";
  if (minutes <= 0) return "in arrivo";
  if (minutes === 1) return "1 min";
  return `${minutes} min`;
}

export function delayLabel(arrival: ArrivalInfo): string {
  if (!arrival.isRealtime) return "da orario";
  if (arrival.delaySeconds === 0) return "in orario";
  const minutes = Math.round(arrival.delaySeconds / 60);
  return minutes > 0 ? `+${minutes} min` : `${minutes} min`;
}
