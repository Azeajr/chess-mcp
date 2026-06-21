/** Small UI-chrome state (drawer visibility, phone tab). */
import { createSignal } from "solid-js";

export const [settingsOpen, setSettingsOpen] = createSignal(false);

/** Phone-only (≤720px) panel selector: which panel shows under the pinned board. */
export type MobileTab = "analysis" | "moves" | "chat";
export const [mobileTab, setMobileTab] = createSignal<MobileTab>("analysis");
