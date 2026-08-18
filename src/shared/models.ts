export interface RouteInfo {
  shortName: string;
  longName: string;
  routeType: number;
}

export interface TripInfo {
  routeId: string;
  headsign: string;
  serviceId: string;
}

export interface StopInfo {
  name: string;
  lat: number;
  lon: number;
}

export interface StopSuggestion {
  stopId: string;
  stopName: string;
}

export interface NearbyStop {
  stopId: string;
  stopName: string;
  lat: number;
  lon: number;
  distanceMeters: number;
}

export interface ArrivalInfo {
  tripId: string;
  routeLabel: string;
  headsign: string;
  arrivalTime: Date;
  delaySeconds: number;
  isRealtime: boolean;
}

export interface ScheduledArrival {
  tripId: string;
  routeLabel: string;
  headsign: string;
  arrivalTime: Date;
}

export interface VehiclePositionInfo {
  tripId: string;
  vehicleLabel: string;
  lat: number;
  lon: number;
  isStopped: boolean;
}
