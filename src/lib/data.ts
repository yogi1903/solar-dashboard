// Single entry point for dashboard data. When VITE_DATA_SOURCE=live and the
// ShineMonitor init succeeds, reads come from the live cache; otherwise the
// deterministic mock. Consumers keep the same function shapes either way.

import * as mock from "./solarData";
import * as live from "./liveSolar";
import type { OutageEvent } from "./solarData";

export const USE_LIVE = import.meta.env.VITE_DATA_SOURCE === "live";

let liveActive = false;
export const isLive = () => USE_LIVE && liveActive;

export async function initDataSource(): Promise<void> {
  if (!USE_LIVE) return;
  try {
    await live.initLive();
    liveActive = true;
  } catch (e) {
    console.error("[data] Live init failed — falling back to mock data.", e);
    liveActive = false;
  }
}

// Prefetch whatever a period view needs before switching to it (live mode).
// Month/year also pull the day curves of outage-affected days so outage
// windows end at real generation recovery.
export async function prefetchFor(mode: "day" | "month" | "year", anchor: Date): Promise<void> {
  if (!isLive()) return;
  if (mode === "day") return live.prefetchLiveDay(anchor);
  if (mode === "month") {
    const y = anchor.getFullYear(),
      m = anchor.getMonth();
    await Promise.all([live.prefetchLiveMonth(y, m), live.prefetchLiveOutageDays(y, m)]);
    return;
  }
  const y = anchor.getFullYear();
  await Promise.all([live.prefetchLiveYear(y), live.prefetchLiveOutageDaysYear(y)]);
}

/* ── dispatched readers (same signatures as the mock) ────────── */

export const getDayData: typeof mock.getDayData = (d, t) =>
  isLive() ? live.liveDayData(d, t) : mock.getDayData(d, t);
export const getMonthData: typeof mock.getMonthData = (y, m, t) =>
  isLive() ? live.liveMonthData(y, m, t) : mock.getMonthData(y, m, t);
export const getYearData: typeof mock.getYearData = (y, t) =>
  isLive() ? live.liveYearData(y, t) : mock.getYearData(y, t);
export const getDayOutages: typeof mock.getDayOutages = (d, t) =>
  isLive() ? live.liveDayOutages(d, t) : mock.getDayOutages(d, t);
export const getMonthOutages: typeof mock.getMonthOutages = (y, m, t) =>
  isLive() ? live.liveMonthOutages(y, m, t) : mock.getMonthOutages(y, m, t);
export const getYearOutages: typeof mock.getYearOutages = (y, t) =>
  isLive() ? live.liveYearOutages(y, t) : mock.getYearOutages(y, t);
export const getCleaningNudge: typeof mock.getCleaningNudge = () =>
  isLive() ? live.liveCleaningNudge() : mock.getCleaningNudge();
// Tomorrow forecast stays an estimate in both modes
export const getTomorrowForecast = mock.getTomorrowForecast;

/* ── identity / status helpers ───────────────────────────────── */

export function getCity(): string {
  return isLive() ? live.getCity() || "India" : "Rajkot";
}
export function getStatusInfo(): { label: string; ok: boolean } {
  return isLive() ? live.getStatusInfo() : { label: "All good", ok: true };
}
export function getUpdatedLabel(): string {
  if (!isLive()) return "Updated just now";
  const at = live.getUpdatedAt();
  if (!at) return "Live";
  const hh = at.getHours() % 12 === 0 ? 12 : at.getHours() % 12;
  const mm = String(at.getMinutes()).padStart(2, "0");
  return `Updated ${hh}:${mm} ${at.getHours() < 12 ? "AM" : "PM"}`;
}
export function getCurrentKw(): number | null {
  return isLive() ? live.liveCurrentKw() : null;
}

/* ── pass-throughs (constants, types, formatters) ────────────── */

export {
  SYSTEM_KWP,
  TARIFF_RS_PER_KWH,
  CO2_KG_PER_KWH,
  INSTALL_DATE,
  LIFETIME,
  SYSTEM_COST_RS,
  MONTH_SHORT,
  MONTH_LONG,
  fmtRs,
  fmtDate,
  fmtHour,
  typicalDayKwh,
} from "./solarData";
export type {
  DayData,
  MonthData,
  YearData,
  MonthOutageSummary,
  YearOutageSummary,
  TomorrowForecast,
  CleaningNudge,
} from "./solarData";
export type { OutageEvent };
