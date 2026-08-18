import type { ArrivalInfo } from "./models.js";

export function displayName(arrival: ArrivalInfo): string {
  return arrival.headsign
    ? `Linea ${arrival.routeLabel} → ${arrival.headsign}`
    : `Linea ${arrival.routeLabel}`;
}

export function destinationLabel(arrival: ArrivalInfo): string {
  return arrival.headsign || "—";
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
