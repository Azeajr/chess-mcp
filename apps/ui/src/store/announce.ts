/**
 * WP-009 — the app's single announcement policy (docs/ui-ux-remediation-plan.md §4.6).
 *
 * Every policy event produces exactly one message; progress ticks, streaming chat tokens,
 * hover/focus/navigation produce none. The store owns the queue, a 500 ms rate limit, and
 * consecutive de-duplication so callers never need their own bookkeeping. `AppLiveRegion`
 * renders what this store holds; nothing else writes to the live regions.
 *
 * Errors route to the assertive region (`announce(message, { assertive: true })`); everything
 * else is polite. The existing visible `role="alert"` metadata warnings in `App.tsx` stay as
 * they are and are deliberately NOT routed through here — they are visible text, not duplicated
 * announcements.
 */
import { createSignal } from "solid-js";

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
/** Bounded observation log for tests/evidence — never rendered. */
const announcementHistory: Announcement[] = [];

export interface AnnounceOptions {
  /** Route to the assertive region. Errors only — the default is polite. */
  readonly assertive?: boolean;
}

/**
 * Announce one message. Two identical consecutive messages within the rate-limit window are
 * collapsed to one announcement; a different message always gets through. Returns the stored
 * announcement, or null when de-duplicated.
 */
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
  // Replace rather than append: two queued messages in one region make screen readers read both
  // on any later mutation. One region holding exactly the latest message keeps "exactly one
  // message per event" true no matter how fast events arrive.
  const set = options.assertive === true ? setAssertiveMessage : setPoliteMessage;
  set(announcement);
  announcementHistory.push(announcement);
  if (announcementHistory.length > 50) announcementHistory.shift();
  return announcement;
}

/** Test seam: reset the rate limiter, de-duplication state, and history between scenarios. */
export function resetAnnouncementsForTesting() {
  lastAnnouncedAt = 0;
  lastMessage = null;
  announcementHistory.length = 0;
  setPoliteMessage(null);
  setAssertiveMessage(null);
}

/** Test/evidence seam: every announcement since the last reset, in order. Never rendered. */
export function announcementLogForTesting(): readonly Announcement[] {
  return [...announcementHistory];
}
