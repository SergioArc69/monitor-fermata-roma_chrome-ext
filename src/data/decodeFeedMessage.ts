import { transit_realtime } from "./protoRoot.js";
import type { RtFeedMessage } from "./gtfsRealtimeTypes.js";

const { FeedMessage } = transit_realtime;

export async function fetchAndDecodeFeed(url: string): Promise<RtFeedMessage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Feed GTFS-RT non raggiungibile: HTTP ${response.status} (${url})`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  const message = FeedMessage.decode(bytes);
  return FeedMessage.toObject(message, { longs: Number, enums: String, defaults: true }) as RtFeedMessage;
}
