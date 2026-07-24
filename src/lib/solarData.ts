// Deterministic mock data layer for the solar dashboard.
// Swap these functions with real API calls (datalogger / ShineMonitor)
// when backend integration is ready — the UI only depends on the shapes below.

export let SYSTEM_KWP = 5;
export const TARIFF_RS_PER_KWH = 8.8;
export const CO2_KG_PER_KWH = 0.82; // India grid emission factor
export let INSTALL_DATE = new Date(2025, 2, 14); // 14 Mar 2025
export let LIFETIME = { kwh: 12400, savedRs: 109120, co2Kg: 10168 };

// Live mode: shineClient plant info overrides these before first render.
// `let` exports keep ES-module live bindings, so all importers see updates.
export function _overrideSystem(o: {
  kwp?: number;
  installDate?: Date;
  lifetime?: { kwh: number; savedRs: number; co2Kg: number };
  costRs?: number;
}) {
  if (o.kwp != null) SYSTEM_KWP = o.kwp;
  if (o.installDate != null) INSTALL_DATE = o.installDate;
  if (o.lifetime != null) LIFETIME = o.lifetime;
  if (o.costRs != null) SYSTEM_COST_RS = o.costRs;
}

// India seasonal generation factor (monsoon dip Jun–Sep)
const SEASON = [0.88, 0.92, 1.02, 1.06, 1.04, 0.9, 0.7, 0.72, 0.78, 0.92, 0.9, 0.86];

function hashCode(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = (key: string) => mulberry32(hashCode(key));

export interface DayData {
  kwh: number;
  curve: number[]; // 24 hourly kW values
  peakKw: number;
  peakTime: string;
  savedRs: number;
  sunHours: number;
  co2Kg: number;
  percentile: number;
}

export interface MonthData {
  kwh: number;
  savedRs: number;
  co2Kg: number;
  percentile: number;
  days: { day: number; kwh: number }[];
  bestDay: { day: number; kwh: number };
}

export interface YearData {
  kwh: number;
  savedRs: number;
  co2Kg: number;
  percentile: number;
  months: { month: number; kwh: number }[]; // month: 0–11
  bestMonth: { month: number; kwh: number };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round0 = (n: number) => Math.round(n);

const DAY_MS = 86400000;

// Bell curve shape 6:00–19:00 — shared by the actual daily curve and the
// expected "typical clear-day" curve used for outage / cleaning estimates.
function bellShape(): { shape: number[]; sum: number } {
  const shape: number[] = [];
  let sum = 0;
  for (let h = 0; h < 24; h++) {
    const t = (h - 6) / 13;
    const v = t > 0 && t < 1 ? Math.pow(Math.sin(Math.PI * t), 1.35) : 0;
    shape.push(v);
    sum += v;
  }
  return { shape, sum };
}

// 24 hourly kW values (rounded to 1 decimal) summing ≈ kwh.
function bellCurve(kwh: number): number[] {
  const { shape, sum } = bellShape();
  return shape.map((v) => round1((v / sum) * kwh));
}

// Expected daily kWh on a clear day (seasonal, no weather noise).
export function typicalDayKwh(date: Date): number {
  return SYSTEM_KWP * 4.9 * SEASON[date.getMonth()] * 0.95;
}

// Hourly kW curve for a typical clear day (seasonal bell, no weather noise).
export function expectedClearCurve(date: Date): number[] {
  const { shape, sum } = bellShape();
  const kwh = typicalDayKwh(date);
  return shape.map((v) => (v / sum) * kwh);
}

// kWh produced inside a fractional hour window from an hourly kW curve.
export function curveWindowKwh(curve: number[], startH: number, endH: number): number {
  let s = 0;
  for (let h = 0; h < 24; h++) {
    const overlap = Math.min(h + 1, endH) - Math.max(h, startH);
    if (overlap > 0) s += curve[h] * overlap;
  }
  return s;
}

const startOfDayMs = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// Deterministic outage windows for a date (shared by getDayData zeroing and
// getDayOutages loss estimation). Today: one fixed morning event for the demo.
function outageWindowsForDate(date: Date): { startH: number; endH: number | null }[] {
  const now = new Date();
  const startOfToday = startOfDayMs(now);
  const dayStart = startOfDayMs(date);
  if (dayStart > startOfToday) return []; // future days: no outages yet
  if (dayStart < startOfDayMs(INSTALL_DATE)) return []; // not installed yet

  if (dayStart === startOfToday) {
    const nowH = now.getHours() + now.getMinutes() / 60;
    if (nowH <= 9.2) return []; // hasn't started yet
    return [{ startH: 9.2, endH: nowH < 10.1 ? null : 10.1 }]; // ongoing or done
  }

  const r = rand(`outage-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
  const windows: { startH: number; endH: number | null }[] = [];
  const roll = r();
  const nEvents = roll < 0.07 ? 2 : roll < 0.35 ? 1 : 0;
  for (let i = 0; i < nEvents; i++) {
    if (r() < 0.2) {
      const startH = 19 + r() * 4; // night outage 19:00–23:00
      windows.push({ startH, endH: startH + 0.3 + r() * 2.7 });
    } else {
      const startH = 6.5 + r() * 11; // daylight window 06:30–17:30
      windows.push({ startH, endH: startH + 0.3 + r() * 2.7 });
    }
  }
  return windows;
}

export function getDayData(date: Date, tariff = TARIFF_RS_PER_KWH): DayData {
  const key = `day-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const r = rand(key);
  const seasonal = SEASON[date.getMonth()];
  let weather = 0.62 + r() * 0.5; // cloudy vs clear day
  // Cleaning-nudge demo bias: the trailing 7 complete days run slightly dusty
  const now = new Date();
  const startOfToday = startOfDayMs(now);
  const startOfDate = startOfDayMs(date);
  const daysAgo = Math.round((startOfToday - startOfDate) / DAY_MS);
  if (daysAgo >= 1 && daysAgo <= 7) weather = Math.min(weather, 0.72);
  const targetKwh = SYSTEM_KWP * 4.9 * seasonal * weather;

  // Bell curve 6:00–19:00 scaled so hourly sum ≈ daily kWh
  const curve = bellCurve(targetKwh); // kW per hour slot

  // Grid outages: generation drops to zero for the affected fraction of each hour
  for (const w of outageWindowsForDate(date)) {
    const end = w.endH ?? now.getHours() + now.getMinutes() / 60;
    for (let h = 0; h < 24; h++) {
      const overlap = Math.min(h + 1, end) - Math.max(h, w.startH);
      if (overlap > 0) curve[h] = round1(curve[h] * Math.max(0, 1 - overlap));
    }
  }

  // Today: nothing generated after the current hour yet
  if (startOfDate === startOfToday) {
    const nowH = now.getHours() + now.getMinutes() / 60;
    for (let h = 0; h < 24; h++) {
      if (h + 1 <= nowH) continue;
      if (h >= nowH) curve[h] = 0;
      else curve[h] = round1(curve[h] * (nowH - h)); // partial current hour
    }
  }

  const kwh = round1(curve.reduce((a, b) => a + b, 0));
  const peakKw = Math.max(...curve);
  const peakHour = curve.indexOf(peakKw);
  const peakTime = `${String(peakHour).padStart(2, "0")}:${r() > 0.5 ? "10" : "40"}`;

  return {
    kwh,
    curve,
    peakKw: round1(peakKw),
    peakTime,
    savedRs: round0(kwh * tariff),
    sunHours: round1(kwh / SYSTEM_KWP),
    co2Kg: round1(kwh * CO2_KG_PER_KWH),
    percentile: 58 + Math.floor(r() * 37),
  };
}

export function getMonthData(year: number, month: number, tariff = TARIFF_RS_PER_KWH): MonthData {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const lastDay = isCurrentMonth ? today.getDate() : daysInMonth;

  const days: { day: number; kwh: number }[] = [];
  let kwhTotal = 0;
  for (let d = 1; d <= lastDay; d++) {
    const dd = getDayData(new Date(year, month, d));
    days.push({ day: d, kwh: dd.kwh });
    kwhTotal += dd.kwh;
  }
  const r = rand(`month-${year}-${month}`);
  const best = days.reduce((a, b) => (b.kwh > a.kwh ? b : a), days[0] ?? { day: 1, kwh: 0 });
  return {
    kwh: round1(kwhTotal),
    savedRs: round0(kwhTotal * tariff),
    co2Kg: round1(kwhTotal * CO2_KG_PER_KWH),
    percentile: 58 + Math.floor(r() * 37),
    days,
    bestDay: best,
  };
}

export function getYearData(year: number, tariff = TARIFF_RS_PER_KWH): YearData {
  const today = new Date();
  const lastMonth = today.getFullYear() === year ? today.getMonth() : 11;
  const months: { month: number; kwh: number }[] = [];
  let kwhTotal = 0;
  for (let m = 0; m <= lastMonth; m++) {
    const md = getMonthData(year, m);
    months.push({ month: m, kwh: md.kwh });
    kwhTotal += md.kwh;
  }
  const r = rand(`year-${year}`);
  const best = months.reduce((a, b) => (b.kwh > a.kwh ? b : a), months[0] ?? { month: 0, kwh: 0 });
  return {
    kwh: round1(kwhTotal),
    savedRs: round0(kwhTotal * tariff),
    co2Kg: round1(kwhTotal * CO2_KG_PER_KWH),
    percentile: 58 + Math.floor(r() * 37),
    months,
    bestMonth: best,
  };
}

/* ── Investment payback ─────────────────────────────────────── */

export let SYSTEM_COST_RS = 280000;

/* ── Grid outages ───────────────────────────────────────────── */
// Derived from inverter "No utility fault" alarms: deterministic per date.
// Roughly 28% of past days have one outage, ~7% have two; "today" always
// has exactly one completed morning outage so the demo view shows it.
// ~15% of events are night outages (no production impact).

export interface OutageEvent {
  startH: number; // hour float, e.g. 9.2 = 09:12
  endH: number | null; // null = ongoing (only possible for today)
  lostKwh: number; // estimated
  lostRs: number;
}

export function getDayOutages(date: Date, tariff = TARIFF_RS_PER_KWH): OutageEvent[] {
  const windows = outageWindowsForDate(date);
  if (windows.length === 0) return [];

  const expected = expectedClearCurve(date);
  const actual = getDayData(date).curve; // already zeroed during outage windows
  const nowH = new Date().getHours() + new Date().getMinutes() / 60;
  return windows.map((w) => {
    const end = w.endH ?? nowH;
    const lost = Math.max(
      0,
      curveWindowKwh(expected, w.startH, end) - curveWindowKwh(actual, w.startH, end),
    );
    const lostKwh = round1(lost);
    return { startH: w.startH, endH: w.endH, lostKwh, lostRs: round0(lostKwh * tariff) };
  });
}

export interface MonthOutageSummary {
  count: number;
  totalHours: number;
  lostKwh: number;
  lostRs: number;
  affectedDays: number[]; // day-of-month, days with ≥1 event
}

export function getMonthOutages(year: number, month: number, tariff = TARIFF_RS_PER_KWH): MonthOutageSummary {
  const now = new Date();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isCurrent = now.getFullYear() === year && now.getMonth() === month;
  const isFuture = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth());
  const beforeInstall =
    year < INSTALL_DATE.getFullYear() ||
    (year === INSTALL_DATE.getFullYear() && month < INSTALL_DATE.getMonth());
  const lastDay = isFuture || beforeInstall ? 0 : isCurrent ? now.getDate() : daysInMonth;
  const firstDay =
    year === INSTALL_DATE.getFullYear() && month === INSTALL_DATE.getMonth()
      ? INSTALL_DATE.getDate()
      : 1;

  const affectedDays: number[] = [];
  let count = 0;
  let totalHours = 0;
  let lostKwh = 0;
  let lostRs = 0;
  for (let d = firstDay; d <= lastDay; d++) {
    const events = getDayOutages(new Date(year, month, d), tariff);
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
  return { count, totalHours: round1(totalHours), lostKwh: round1(lostKwh), lostRs: round0(lostRs), affectedDays };
}

export interface YearOutageSummary {
  count: number;
  totalHours: number;
  lostKwh: number;
  lostRs: number;
  affectedMonths: number[]; // month indexes 0–11 with ≥1 event
  uptimePct: number;
}

// Hours of an event window that fall inside daylight (06:00–19:00).
export function daylightOverlapHours(startH: number, endH: number): number {
  return Math.max(0, Math.min(endH, 19) - Math.max(startH, 6));
}

export function getYearOutages(year: number, tariff = TARIFF_RS_PER_KWH): YearOutageSummary {
  const now = new Date();
  const lastMonth =
    year === now.getFullYear() ? now.getMonth() : year < now.getFullYear() ? 11 : -1;
  const firstMonth =
    year === INSTALL_DATE.getFullYear() ? INSTALL_DATE.getMonth() : 0;

  const affectedMonths: number[] = [];
  let count = 0;
  let totalHours = 0;
  let lostKwh = 0;
  let lostRs = 0;
  let daylightOutageHours = 0;
  for (let m = firstMonth; m <= lastMonth; m++) {
    const ms = getMonthOutages(year, m, tariff);
    count += ms.count;
    totalHours += ms.totalHours;
    lostKwh += ms.lostKwh;
    lostRs += ms.lostRs;
    if (ms.count > 0) affectedMonths.push(m);
    for (const d of ms.affectedDays) {
      for (const e of getDayOutages(new Date(year, m, d), tariff)) {
        const end = e.endH ?? now.getHours() + now.getMinutes() / 60;
        daylightOutageHours += daylightOverlapHours(e.startH, end);
      }
    }
  }

  // Elapsed days since install (or Jan 1), up to today
  const start = Math.max(startOfDayMs(new Date(year, 0, 1)), startOfDayMs(INSTALL_DATE));
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

/* ── Tomorrow forecast (mock) ───────────────────────────────── */

export interface TomorrowForecast {
  condition: "Sunny" | "Partly cloudy" | "Cloudy";
  expectedKwh: number;
  kwh: number; // alias of expectedKwh, kept for the existing UI
  note: string;
}

export function getTomorrowForecast(): TomorrowForecast {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  const roll = rand(`forecast-${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`)();
  const seasonal = SEASON[t.getMonth()];
  const build = (condition: TomorrowForecast["condition"], factor: number, note: string): TomorrowForecast => {
    const expectedKwh = round1(SYSTEM_KWP * 4.9 * seasonal * factor);
    return { condition, expectedKwh, kwh: expectedKwh, note };
  };
  if (roll < 0.6) return build("Sunny", 0.95, "Good day for heavy appliances");
  if (roll < 0.9) return build("Partly cloudy", 0.75, "Decent generation expected");
  return build("Cloudy", 0.55, "Keep heavy usage light");
}

/* ── Cleaning nudge ─────────────────────────────────────────── */
// Compares the last 7 complete days against typical clear-day output.

export interface CleaningNudge {
  belowPct: number; // whole % below expected
  deficitPct: number; // alias of belowPct, kept for the existing UI
}

export function getCleaningNudge(): CleaningNudge | null {
  const now = new Date();
  let actual = 0;
  let expected = 0;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    actual += getDayData(d).kwh;
    expected += typicalDayKwh(d);
  }
  if (expected <= 0) return null;
  const ratio = actual / expected;
  if (ratio >= 0.88) return null;
  const belowPct = Math.round((1 - ratio) * 100);
  return { belowPct, deficitPct: belowPct };
}

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const fmtRs = (n: number) => `₹${n.toLocaleString("en-IN")}`;
export const fmtDate = (d: Date) =>
  `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;

// Hour float → 12-hour clock: 9.2 → "9:12 AM", 13.5 → "1:30 PM"
export function fmtHour(h: number): string {
  const totalMins = Math.round(h * 60);
  const hh = Math.floor(totalMins / 60) % 24;
  const mm = totalMins % 60;
  const period = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${period}`;
}
