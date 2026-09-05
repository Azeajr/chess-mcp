import { createSignal } from "solid-js";
import { assertTestOnly } from "./test-seam";

export interface Announcement {
  readonly id: number;
  readonly message: string;
  readonly assertive: boolean;
}

const RATE_LIMIT_MS = 500;

const [politeMessage, setPoliteMessage] = createSignal<Announcement | null>(null);
const [assertiveMessage, setAssertiveMessage] = createSignal<Announcement | null>(null);
export { politeMessage, assertiveMessage };

let nextId = 0;
let lastAnnouncedAt = 0;
let lastMessage: string | null = null;
const announcementHistory: Announcement[] = [];

export interface AnnounceOptions {
  readonly assertive?: boolean;
}

export function announce(message: string, options: AnnounceOptions = {}): Announcement | null {
  if (message.trim() === "") return null;
  const now = Date.now();
  if (lastMessage === message && now - lastAnnouncedAt < RATE_LIMIT_MS) return null;
  lastAnnouncedAt = now;
  lastMessage = message;
  const announcement: Announcement = {
    id: (nextId += 1),
    message,
    assertive: options.assertive === true,
  };
  const set = options.assertive === true ? setAssertiveMessage : setPoliteMessage;
  set(announcement);
  announcementHistory.push(announcement);
  if (announcementHistory.length > 50) announcementHistory.shift();
  return announcement;
}

export function resetAnnouncementsForTesting() {
  assertTestOnly();
  lastAnnouncedAt = 0;
  lastMessage = null;
  announcementHistory.length = 0;
  setPoliteMessage(null);
  setAssertiveMessage(null);
}

export function announcementLogForTesting(): readonly Announcement[] {
  assertTestOnly();
  return [...announcementHistory];
}
