// Live data source: ShineMonitor → the exact shapes the UI already consumes.
// Period data is prefetched into module caches so readers stay synchronous —
// the UI awaits `prefetchFor()` before changing period, then reads cache.

import {
  _overrideSystem,
  expectedClearCurve,
  curveWindowKwh,
  daylightOverlapHours,
  typicalDayKwh,
  SYSTEM_KWP,
  CO2_KG_PER_KWH,
  TARIFF_RS_PER_KWH,
} from "./solarData";
import type {
  DayData,
  MonthData,
  YearData,
  OutageEvent,
  MonthOutageSummary,
  YearOutageSummary,
} from "./solarData";
import * as api from "./shineClient";

const round1 = (n: number) => Math.round(n * 10) / 10;
const round0 = (n: number) => Math.round(n);
const DAY_MS = 86400000;
const dateKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const startOfDayMs = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/* ── caches ──────────────────────────────────────────────────── */
const dayCache = new Map<string, DayData>();
const rawCurveCache = new Map<string, api.CurvePoint[]>();
const monthCache = new Map<string, MonthData>();
const yearCache = new Map<number, YearData>();
const outageWindows = new Map<string, { startH: number; endH: number | null }[]>();

const meta = {
  city: "",
  statusLabel: "All good",
  statusOk: true,
  updatedAt: null as Date | null,
  tariffDefault: 0,
};

export function getCity() {
  return meta.city;
}
export function getStatusInfo() {
  return { label: meta.statusLabel, ok: meta.statusOk };
}
export function getUpdatedAt() {
  return meta.updatedAt;
}
export function getLiveTariffDefault() {
  return meta.tariffDefault;
}

// Latest 5-min reading from today's curve — the "Producing now" figure.
export function liveCurrentKw(): number | null {
  const raw = rawCurveCache.get(dateKey(new Date()));
  if (!raw || raw.length === 0) return null;
  const now = new Date();
  let kw = 0;
  for (const p of raw) {
    if (p.date <= now) kw = p.kw;
    else break;
  }
  return round1(kw);
}

/* ── day ─────────────────────────────────────────────────────── */

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildDayData(points: api.CurvePoint[], tariff: number, key: string): DayData {
  const sum = new Array<number>(24).fill(0);
  const cnt = new Array<number>(24).fill(0);
  let peakKw = 0;
  let peakTime = "--:--";
  for (const p of points) {
    const h = p.date.getHours();
    sum[h] += p.kw;
    cnt[h]++;
    if (p.kw > peakKw) {
      peakKw = p.kw;
      peakTime = `${String(h).padStart(2, "0")}:${String(p.date.getMinutes()).padStart(2, "0")}`;
    }
  }
  // Hourly mean kW = kWh generated in that hour (same semantics as mock curve)
  const curve = sum.map((s, h) => (cnt[h] ? round1(s / cnt[h]) : 0));
  const kwh = round1(curve.reduce((a, b) => a + b, 0));
  return {
    kwh,
    curve,
    peakKw: round1(peakKw),
    peakTime,
    savedRs: round0(kwh * tariff),
    sunHours: round1(kwh / SYSTEM_KWP),
    co2Kg: round1(kwh * CO2_KG_PER_KWH),
    percentile: 58 + (hashStr(key) % 37), // placeholder until fleet benchmarking exists
  };
}

export async function prefetchLiveDay(date: Date): Promise<void> {
  const key = dateKey(date);
  if (rawCurveCache.has(key)) return;
  const pts = await api.getDayCurve(date);
  rawCurveCache.set(key, pts);
  dayCache.delete(key); // tariff-dependent fields recomputed on read
  if (key === dateKey(new Date()) && pts.length > 0) {
    meta.updatedAt = pts[pts.length - 1].date;
  }
}

export function liveDayData(date: Date, tariff = TARIFF_RS_PER_KWH): DayData {
  const key = dateKey(date);
  const raw = rawCurveCache.get(key);
  if (!raw) {
    // Not prefetched — caller should have awaited prefetchLiveDay; render zeros.
    return {
      kwh: 0,
      curve: new Array(24).fill(0),
      peakKw: 0,
      peakTime: "--:--",
      savedRs: 0,
      sunHours: 0,
      co2Kg: 0,
      percentile: 0,
    };
  }
  const d = buildDayData(raw, tariff, key);
  dayCache.set(key, d);
  return d;
}

/* ── month / year ────────────────────────────────────────────── */

export async function prefetchLiveMonth(year: number, month: number): Promise<void> {
  const key = `${year}-${month}`;
  if (monthCache.has(key)) return;
  const rows = await api.getMonthPerDay(year, month);
  const now = new Date();
  const inst = installDateRef;
  const isCurrent = now.getFullYear() === year && now.getMonth() === month;
  const isInstallMonth = inst.getFullYear() === year && inst.getMonth() === month;
  const days = rows.filter((r) => {
    if (isCurrent && r.day > now.getDate()) return false;
    if (isInstallMonth && r.day < inst.getDate()) return false;
    return true;
  });
  const kwh = round1(days.reduce((a, b) => a + b.kwh, 0));
  const best = days.reduce((a, b) => (b.kwh > a.kwh ? b : a), days[0] ?? { day: 1, kwh: 0 });
  monthCache.set(key, {
    kwh,
    savedRs: round0(kwh * TARIFF_RS_PER_KWH), // recomputed on read
    co2Kg: round1(kwh * CO2_KG_PER_KWH),
    percentile: 58 + (hashStr(key) % 37),
    days,
    bestDay: best,
  });
}

export function liveMonthData(year: number, month: number, tariff = TARIFF_RS_PER_KWH): MonthData {
  const m = monthCache.get(`${year}-${month}`);
  if (!m)
    return { kwh: 0, savedRs: 0, co2Kg: 0, percentile: 0, days: [], bestDay: { day: 1, kwh: 0 } };
  return { ...m, savedRs: round0(m.kwh * tariff) };
}

export async function prefetchLiveYear(year: number): Promise<void> {
  if (yearCache.has(year)) return;
  const rows = await api.getYearPerMonth(year);
  const now = new Date();
  const inst = installDateRef;
  const months = rows.filter((r) => {
    if (year === now.getFullYear() && r.month > now.getMonth()) return false;
    if (year === inst.getFullYear() && r.month < inst.getMonth()) return false;
    return true;
  });
  const kwh = round1(months.reduce((a, b) => a + b.kwh, 0));
  const best = months.reduce((a, b) => (b.kwh > a.kwh ? b : a), months[0] ?? { month: 0, kwh: 0 });
  yearCache.set(year, {
    kwh,
    savedRs: round0(kwh * TARIFF_RS_PER_KWH),
    co2Kg: round1(kwh * CO2_KG_PER_KWH),
    percentile: 58 + (hashStr(`y-${year}`) % 37),
    months,
    bestMonth: best,
  });
}

export function liveYearData(year: number, tariff = TARIFF_RS_PER_KWH): YearData {
  const y = yearCache.get(year);
  if (!y)
    return {
      kwh: 0,
      savedRs: 0,
      co2Kg: 0,
      percentile: 0,
      months: [],
      bestMonth: { month: 0, kwh: 0 },
    };
  return { ...y, savedRs: round0(y.kwh * tariff) };
}

/* ── outage-day curve prefetch (for recovery-based outage ends) ── */

// Fetch day curves for every outage-affected day of a month, so outage windows
// can end at real generation recovery instead of the seconds-short alarm.
export async function prefetchLiveOutageDays(year: number, month: number): Promise<void> {
  const now = new Date();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const inst = installDateRef;
  const isCurrent = now.getFullYear() === year && now.getMonth() === month;
  const isFuture =
    year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth());
  const beforeInstall =
    year < inst.getFullYear() || (year === inst.getFullYear() && month < inst.getMonth());
  const lastDay = isFuture || beforeInstall ? 0 : isCurrent ? now.getDate() : daysInMonth;
  const firstDay = year === inst.getFullYear() && month === inst.getMonth() ? inst.getDate() : 1;

  const jobs: Promise<void>[] = [];
  for (let d = firstDay; d <= lastDay; d++) {
    const date = new Date(year, month, d);
    if (windowsFor(date).length > 0) jobs.push(prefetchLiveDay(date));
  }
  for (let i = 0; i < jobs.length; i += 6) {
    await Promise.all(jobs.slice(i, i + 6)); // gentle concurrency
  }
}

export async function prefetchLiveOutageDaysYear(year: number): Promise<void> {
  const now = new Date();
  const inst = installDateRef;
  const lastMonth =
    year === now.getFullYear() ? now.getMonth() : year < now.getFullYear() ? 11 : -1;
  const firstMonth = year === inst.getFullYear() ? inst.getMonth() : 0;
  for (let m = firstMonth; m <= lastMonth; m++) {
    await prefetchLiveOutageDays(year, m);
  }
}

/* ── outages (from "No utility fault" warnings) ──────────────── */

const OUTAGE_CODE = "0x00000009";

function buildOutageWindows(warnings: api.WarningEvent[]) {
  const events = warnings
    .filter((w) => w.code === OUTAGE_CODE)
    .map((w) => ({
      start: w.start,
      end: w.end,
      dayKey: dateKey(w.start),
      startH: w.start.getHours() + w.start.getMinutes() / 60 + w.start.getSeconds() / 3600,
      endH: w.end ? w.end.getHours() + w.end.getMinutes() / 60 + w.end.getSeconds() / 3600 : null,
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Merge events less than 10 minutes apart into one window
  for (const e of events) {
    const list = outageWindows.get(e.dayKey) ?? [];
    const last = list[list.length - 1];
    const endH = e.endH ?? null;
    if (last && last.endH != null && e.startH - last.endH < 10 / 60) {
      last.endH = endH != null ? Math.max(last.endH, endH) : last.endH;
    } else {
      list.push({ startH: e.startH, endH });
    }
    outageWindows.set(e.dayKey, list);
  }
}

function windowsFor(date: Date): { startH: number; endH: number | null }[] {
  return outageWindows.get(dateKey(date)) ?? [];
}

const hourFloat = (d: Date) => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
const DAYLIGHT_END = 19.5;

// First sustained generation after startH on the day's 5-min curve — the real
// end of a grid outage (the inverter alarm clears in seconds; the grid hasn't).
function recoveryEndH(raw: api.CurvePoint[], startH: number, dayPeakKw: number): number | null {
  const threshold = Math.max(0.05, dayPeakKw * 0.05);
  for (let i = 0; i < raw.length; i++) {
    const h = hourFloat(raw[i].date);
    if (h < startH || h > DAYLIGHT_END) continue;
    if (raw[i].kw >= threshold && (raw[i + 1]?.kw ?? 0) >= threshold * 0.5) return h;
  }
  return null;
}

// kWh actually generated inside a fractional hour window (5-min samples).
function actualWindowKwh(raw: api.CurvePoint[], startH: number, endH: number): number {
  let s = 0;
  for (const p of raw) {
    const h = hourFloat(p.date);
    if (h >= startH && h < endH) s += p.kw * (5 / 60);
  }
  return s;
}

export function liveDayOutages(date: Date, tariff = TARIFF_RS_PER_KWH): OutageEvent[] {
  const ws = windowsFor(date);
  if (ws.length === 0) return [];
  const now = new Date();
  const isToday = dateKey(date) === dateKey(now);
  const nowH = hourFloat(now);
  const expected = expectedClearCurve(date);
  const raw = rawCurveCache.get(dateKey(date));

  return ws.map((w) => {
    if (raw && raw.length > 0) {
      const dayPeak = Math.max(...raw.map((p) => p.kw));
      const rec = recoveryEndH(raw, w.startH, dayPeak);
      let end: number;
      let ongoing = false;
      if (rec != null && rec > w.startH + 0.01) {
        end = rec; // generation picked back up
      } else if (isToday && w.startH <= nowH && nowH < DAYLIGHT_END) {
        end = nowH;
        ongoing = true; // grid still down right now
      } else {
        // Never recovered before generation ended for the day
        const lastH = raw.length ? hourFloat(raw[raw.length - 1].date) : DAYLIGHT_END;
        end = Math.max(w.startH, Math.min(DAYLIGHT_END, lastH));
      }
      const lost = Math.max(
        0,
        curveWindowKwh(expected, w.startH, end) - actualWindowKwh(raw, w.startH, end)
      );
      const lostKwh = round1(lost);
      return {
        startH: w.startH,
        endH: ongoing ? null : end,
        lostKwh,
        lostRs: round0(lostKwh * tariff),
      };
    }
    // No curve cached yet: fall back to the alarm's clear time (usually a big
    // underestimate) or a 30-minute estimate when it never cleared.
    const alarmEnd = w.endH != null ? (w.endH as number) : isToday ? nowH : w.startH + 0.5;
    const lost = Math.max(0, curveWindowKwh(expected, w.startH, alarmEnd));
    const lostKwh = round1(lost);
    return {
      startH: w.startH,
      endH: w.endH == null && isToday ? null : alarmEnd,
      lostKwh,
      lostRs: round0(lostKwh * tariff),
    };
  });
}

export function liveMonthOutages(
  year: number,
  month: number,
  tariff = TARIFF_RS_PER_KWH
): MonthOutageSummary {
  const now = new Date();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const inst = installDateRef;
  const isCurrent = now.getFullYear() === year && now.getMonth() === month;
  const isFuture =
    year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth());
  const beforeInstall =
    year < inst.getFullYear() || (year === inst.getFullYear() && month < inst.getMonth());
  const lastDay = isFuture || beforeInstall ? 0 : isCurrent ? now.getDate() : daysInMonth;
  const firstDay = year === inst.getFullYear() && month === inst.getMonth() ? inst.getDate() : 1;

  const affectedDays: number[] = [];
  let count = 0,
    totalHours = 0,
    lostKwh = 0,
    lostRs = 0;
  for (let d = firstDay; d <= lastDay; d++) {
    const events = liveDayOutages(new Date(year, month, d), tariff);
    if (events.length === 0) continue;
    affectedDays.push(d);
    for (const e of events) {
      count++;
      const end = e.endH ?? now.getHours() + now.getMinutes() / 60;
      totalHours += Math.max(0, end - e.startH);
      lostKwh += e.lostKwh;
      lostRs += e.lostRs;
    }
  }
  return {
    count,
    totalHours: round1(totalHours),
    lostKwh: round1(lostKwh),
    lostRs: round0(lostRs),
    affectedDays,
  };
}

export function liveYearOutages(year: number, tariff = TARIFF_RS_PER_KWH): YearOutageSummary {
  const now = new Date();
  const inst = installDateRef;
  const lastMonth =
    year === now.getFullYear() ? now.getMonth() : year < now.getFullYear() ? 11 : -1;
  const firstMonth = year === inst.getFullYear() ? inst.getMonth() : 0;

  const affectedMonths: number[] = [];
  let count = 0,
    totalHours = 0,
    lostKwh = 0,
    lostRs = 0,
    daylightOutageHours = 0;
  for (let m = firstMonth; m <= lastMonth; m++) {
    const ms = liveMonthOutages(year, m, tariff);
    count += ms.count;
    totalHours += ms.totalHours;
    lostKwh += ms.lostKwh;
    lostRs += ms.lostRs;
    if (ms.count > 0) affectedMonths.push(m);
    for (const d of ms.affectedDays) {
      for (const e of liveDayOutages(new Date(year, m, d), tariff)) {
        const end = e.endH ?? now.getHours() + now.getMinutes() / 60;
        daylightOutageHours += daylightOverlapHours(e.startH, end);
      }
    }
  }

  const start = Math.max(startOfDayMs(new Date(year, 0, 1)), startOfDayMs(inst));
  const end = Math.min(startOfDayMs(now), startOfDayMs(new Date(year, 11, 31)));
  const elapsedDays = end >= start ? Math.round((end - start) / DAY_MS) + 1 : 0;
  const uptimePct =
    elapsedDays > 0
      ? round1(Math.max(0, (1 - daylightOutageHours / (elapsedDays * 13)) * 100))
      : 100;

  return {
    count,
    totalHours: round1(totalHours),
    lostKwh: round1(lostKwh),
    lostRs: round0(lostRs),
    affectedMonths,
    uptimePct,
  };
}

/* ── cleaning nudge (last 7 cached days vs clear-day expected) ── */

export function liveCleaningNudge(): { belowPct: number; deficitPct: number } | null {
  const now = new Date();
  let actual = 0,
    expected = 0;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    actual += liveDayData(d).kwh;
    expected += typicalDayKwh(d);
  }
  if (expected <= 0) return null;
  const ratio = actual / expected;
  if (ratio >= 0.88) return null;
  const belowPct = Math.round((1 - ratio) * 100);
  return { belowPct, deficitPct: belowPct };
}

/* ── init ────────────────────────────────────────────────────── */

let installDateRef = new Date(2024, 4, 6);

export async function initLive(): Promise<void> {
  const info = await api.getPlantInfo();
  installDateRef = info.installDate;
  meta.city = info.city || "India";
  meta.statusOk = info.status === 0;
  meta.statusLabel = info.status === 0 ? "All good" : "Needs attention";
  const tariffForLifetime = info.tariffRsPerKwh > 0 ? info.tariffRsPerKwh : TARIFF_RS_PER_KWH;
  meta.tariffDefault = info.tariffRsPerKwh;

  const summary = await api.getEnergySummary();
  _overrideSystem({
    kwp: info.nominalPowerKw,
    installDate: info.installDate,
    lifetime: {
      kwh: round0(summary.total),
      savedRs: round0(summary.total * tariffForLifetime),
      co2Kg: round0(summary.total * CO2_KG_PER_KWH),
    },
  });

  // Seed the Settings tariff from the plant's configured tariff if the user
  // hasn't chosen one yet (Home reads localStorage on first render).
  if (info.tariffRsPerKwh > 0 && !localStorage.getItem("greentek-tariff")) {
    localStorage.setItem("greentek-tariff", String(info.tariffRsPerKwh));
  }

  const warnings = await api.getAllWarnings();
  buildOutageWindows(warnings);

  // Prefetch everything the first render + navigation needs
  const now = new Date();
  const jobs: Promise<void>[] = [
    prefetchLiveDay(now),
    prefetchLiveMonth(now.getFullYear(), now.getMonth()),
    prefetchLiveYear(now.getFullYear()),
  ];
  for (let i = 1; i <= 7; i++) {
    jobs.push(prefetchLiveDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  }
  if (now.getFullYear() !== installDateRef.getFullYear()) {
    jobs.push(prefetchLiveYear(installDateRef.getFullYear()));
  }
  await Promise.all(jobs);
}
