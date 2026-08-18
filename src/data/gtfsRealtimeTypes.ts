/** Shapes matching FeedMessage.toObject({ longs: Number, enums: String, defaults: true }). */

export interface RtStopTimeEvent {
  time?: number;
  delay?: number;
}

export interface RtStopTimeUpdate {
  stopId?: string;
  arrival?: RtStopTimeEvent;
  departure?: RtStopTimeEvent;
}

export interface RtTripDescriptor {
  tripId?: string;
  routeId?: string;
}

export interface RtTripUpdate {
  trip?: RtTripDescriptor;
  stopTimeUpdate?: RtStopTimeUpdate[];
}

export interface RtPosition {
  latitude?: number;
  longitude?: number;
  speed?: number;
}

export interface RtVehicleDescriptor {
  id?: string;
  label?: string;
}

export interface RtVehiclePosition {
  trip?: RtTripDescriptor;
  vehicle?: RtVehicleDescriptor;
  position?: RtPosition;
  currentStatus?: "INCOMING_AT" | "STOPPED_AT" | "IN_TRANSIT_TO";
}

export interface RtFeedEntity {
  id?: string;
  tripUpdate?: RtTripUpdate;
  vehicle?: RtVehiclePosition;
}

export interface RtFeedMessage {
  entity?: RtFeedEntity[];
}
