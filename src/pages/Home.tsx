import { useMemo, useState } from "react";
import {
  getDayData,
  getMonthData,
  getYearData,
  SYSTEM_KWP,
  TARIFF_RS_PER_KWH,
  LIFETIME,
  MONTH_SHORT,
  MONTH_LONG,
  fmtRs,
  fmtDate,
  INSTALL_DATE,
  getDayOutages,
  getMonthOutages,
  getYearOutages,
  SYSTEM_COST_RS,
  getTomorrowForecast,
  getCleaningNudge,
  prefetchFor,
  getCity,
  getStatusInfo,
  getUpdatedLabel,
  getCurrentKw,
} from "@/lib/data";
import type { OutageEvent } from "@/lib/data";
import { downloadReport, type PeriodReport } from "@/lib/report";
import { downloadShareCard } from "@/lib/shareCard";
import {
  AlertTriangle,
  Cloud,
  CloudSun,
  Droplets,
  Leaf,
  Share2,
  Sun,
  TreePine,
} from "lucide-react";
import { toast } from "sonner";
import PeriodPicker from "@/components/PeriodPicker";
import SettingsPanel from "@/components/SettingsPanel";

const TARIFF_KEY = "greentek-tariff";

// Greentek Alliance · Solar Monitor
// Mobile-first, fully featured: day / month / year history, PDF reports,
// performance percentile, lifetime stats, referral hook.

const INK = "#0d201d";
const MUTED = "#5a6e6a";
const FAINT = "#71807d";
const GOLD = "#c9a460";
const DEEP_GOLD = "#8a6826";
const PALE_GOLD = "#f4ead4";
const TEAL = "#237a6e";
const BRIGHT_TEAL = "#16b8a8";
const PALE_TEAL = "#e2eeed";
const BORDER = "#e8e4d8";
const DISPLAY = "'Bricolage Grotesque', Inter, sans-serif";
const BODY = "Inter, -apple-system, sans-serif";

type Mode = "day" | "month" | "year";

// Builds the day-curve path: light smoothing during normal operation,
// ~3-minute straight ramps down/up at outage edges and at the "now" cutoff.
function buildCurvePath(
  curve: number[],
  outages: { startH: number; endH: number | null }[],
  nowH: number | null,
  width: number,
  height: number,
  max: number
) {
  const EPS = 0.004; // tiny offset anchoring the pre-drop value
  const RAMP = 0.05; // ~3 minutes of ramp at every discontinuity
  const clampH = (h: number) => Math.max(0, Math.min(23.999, h));
  const inOutage = (h: number) => outages.some((o) => h >= o.startH && h < (o.endH ?? nowH ?? 24));

  // Linear interpolation of the hourly curve at fractional hour h
  const rawVal = (h: number) => {
    const i = Math.min(Math.floor(h), 22);
    const f = h - i;
    return (curve[i] ?? 0) + ((curve[i + 1] ?? 0) - (curve[i] ?? 0)) * f;
  };
  const valAt = (h: number) => {
    if (inOutage(h)) return 0;
    if (nowH != null && h >= nowH) return 0;
    return rawVal(h);
  };

  // Point set: hourly points + ramp pairs at every discontinuity
  const hs = new Set<number>();
  for (let h = 0; h <= 23; h++) hs.add(h);
  outages.forEach((o) => {
    const s = o.startH;
    const e = o.endH ?? nowH ?? 24;
    hs.add(clampH(s - EPS)); // last normal value
    hs.add(clampH(Math.min(s + RAMP, e))); // bottom of drop
    hs.add(clampH(Math.max(e - RAMP, s))); // still zero before restore
    if (o.endH != null) hs.add(clampH(e + EPS)); // restored value (skip for ongoing)
  });
  if (nowH != null) {
    hs.add(clampH(nowH - EPS)); // last generated value
    hs.add(clampH(nowH + RAMP)); // bottom of the now cutoff
  }

  const pts = [...hs]
    .sort((a, b) => a - b)
    .map((h) => ({
      x: (h / 23) * width,
      y: height - (valAt(h) / max) * height,
    }));

  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    if (p1.x - p0.x < 2) {
      d += ` L ${p1.x},${p1.y}`; // ramp/cliff — straight line, no smoothing
    } else {
      const dx = p1.x - p0.x;
      d += ` C ${p0.x + dx * 0.3},${p0.y} ${p1.x - dx * 0.3},${p1.y} ${p1.x},${p1.y}`;
    }
  }
  return d;
}

// "9:12 – 10:06 AM" style outage time ranges
function fmtClock(h: number, withPeriod: boolean): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.min(59, Math.round((h - Math.floor(h)) * 60));
  const period = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const base = `${h12}:${String(mm).padStart(2, "0")}`;
  return withPeriod ? `${base} ${period}` : base;
}

function fmtTimeRange(startH: number, endH: number): string {
  const samePeriod = Math.floor(startH) < 12 === Math.floor(endH) < 12;
  return samePeriod
    ? `${fmtClock(startH, false)} – ${fmtClock(endH, true)}`
    : `${fmtClock(startH, true)} – ${fmtClock(endH, true)}`;
}

function fmtDuration(startH: number, endH: number): string {
  const mins = Math.round((endH - startH) * 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function OutageRows({ events }: { events: OutageEvent[] }) {
  return (
    <>
      {events.map((o, i) => (
        <div key={i} className="flex items-baseline justify-between gap-3">
          <span
            className="text-[13px] font-medium [font-variant-numeric:tabular-nums]"
            style={{ color: INK }}
          >
            {fmtTimeRange(o.startH, o.endH ?? o.startH)} ·{" "}
            {fmtDuration(o.startH, o.endH ?? o.startH)}
          </span>
          <span
            className="text-[12px] whitespace-nowrap [font-variant-numeric:tabular-nums]"
            style={{ color: DEEP_GOLD }}
          >
            {o.lostKwh > 0
              ? `≈${o.lostKwh} kWh lost (≈${fmtRs(o.lostRs)})`
              : "No production impact"}
          </span>
        </div>
      ))}
    </>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      className={className}
    >
      <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />
      <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3L19 19M19 5l-1.7 1.7M6.7 17.3L5 19" />
    </svg>
  );
}

function Card({
  children,
  className = "",
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`bg-white rounded-[18px] shadow-[0_2px_14px_rgba(13,32,29,0.05)] border p-5 ${className}`}
      style={{ borderColor: BORDER }}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] font-medium tracking-wide" style={{ color: MUTED }}>
      {children}
    </p>
  );
}

function StatCard({
  label,
  value,
  unit,
  note,
  valueColor,
  testId,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
  valueColor?: string;
  testId?: string;
  icon?: React.ReactNode;
}) {
  return (
    <Card testId={testId}>
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {icon}
      </div>
      <p
        className="mt-1 text-[28px] font-medium tracking-tight [font-variant-numeric:tabular-nums]"
        style={{ fontFamily: DISPLAY, color: valueColor ?? INK }}
      >
        {value}
        {unit && (
          <span className="text-[14px]" style={{ color: MUTED }}>
            {" "}
            {unit}
          </span>
        )}
      </p>
      <p className="text-[12px]" style={{ color: FAINT }}>
        {note}
      </p>
    </Card>
  );
}

function Bars({
  values,
  highlight,
  labels,
  marks,
}: {
  values: number[];
  highlight: number;
  labels?: string[];
  marks?: number[];
}) {
  const max = Math.max(...values, 0.001);
  return (
    <div className={`mt-4 flex h-24 items-end gap-[3px] ${labels ? "justify-between" : ""}`}>
      {values.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1.5 min-w-0">
          <div
            className="w-full rounded-full"
            style={{
              height: `${Math.max((v / max) * 84, 3)}px`,
              background: i === highlight ? GOLD : PALE_TEAL,
            }}
          />
          {marks && (
            <span className="flex h-[6px] items-center">
              {marks.includes(i) && (
                <span className="h-[4px] w-[4px] rounded-full" style={{ background: GOLD }} />
              )}
            </span>
          )}
          {labels && (
            <span
              className="text-[10px] truncate"
              style={{
                color: i === highlight ? INK : FAINT,
                fontWeight: i === highlight ? 600 : 400,
              }}
            >
              {labels[i]}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const today = useMemo(() => new Date(), []);
  const [mode, setMode] = useState<Mode>("day");
  const [anchor, setAnchor] = useState<Date>(today);
  const [tipOpen, setTipOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showOutages, setShowOutages] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tab, setTab] = useState<"solar" | "settings">("solar");
  const [tariff, setTariff] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem(TARIFF_KEY) ?? "");
    return !isNaN(saved) && saved > 0 ? saved : TARIFF_RS_PER_KWH;
  });

  function updateTariff(t: number) {
    setTariff(t);
    localStorage.setItem(TARIFF_KEY, String(t));
  }

  const day = useMemo(() => getDayData(anchor, tariff), [anchor, tariff]);
  const month = useMemo(
    () => getMonthData(anchor.getFullYear(), anchor.getMonth(), tariff),
    [anchor, tariff]
  );
  const year = useMemo(() => getYearData(anchor.getFullYear(), tariff), [anchor, tariff]);

  const outages = useMemo(() => getDayOutages(anchor, tariff), [anchor, tariff]);
  const monthOutages = useMemo(
    () => getMonthOutages(anchor.getFullYear(), anchor.getMonth(), tariff),
    [anchor, tariff]
  );
  const yearOutages = useMemo(() => getYearOutages(anchor.getFullYear(), tariff), [anchor, tariff]);
  const forecast = useMemo(() => getTomorrowForecast(), []);
  const cleaningNudge = useMemo(() => getCleaningNudge(), []);

  const payback = useMemo(() => {
    // LIFETIME.kwh is the all-time total (already includes today), so recovered
    // derives from it directly — tariff-reactive, no double counting.
    const recovered = Math.round(LIFETIME.kwh * tariff);
    const pct = Math.min(100, Math.max(0, Math.round((recovered / SYSTEM_COST_RS) * 100)));
    const elapsedMonths = Math.max(today.getMonth() + 1, 1);
    const ytdSaved = getYearData(today.getFullYear(), tariff).savedRs;
    const avgMonthly = Math.max(ytdSaved / elapsedMonths, 1);
    const monthsRemaining = Math.max(0, Math.ceil((SYSTEM_COST_RS - recovered) / avgMonthly));
    const breakeven = new Date(today.getFullYear(), today.getMonth() + monthsRemaining, 1);
    return { recovered, pct, breakeven };
  }, [today, tariff]);

  const isToday = anchor.toDateString() === today.toDateString();
  const isCurrentMonth =
    anchor.getFullYear() === today.getFullYear() && anchor.getMonth() === today.getMonth();
  const isCurrentYear = anchor.getFullYear() === today.getFullYear();
  const canGoNext = mode === "day" ? !isToday : mode === "month" ? !isCurrentMonth : !isCurrentYear;

  // Live mode: changing the period awaits a prefetch, then reads render from cache
  const [navBusy, setNavBusy] = useState(false);
  async function goTo(nextMode: Mode, nextAnchor: Date) {
    if (navBusy) return;
    setNavBusy(true);
    try {
      await prefetchFor(nextMode, nextAnchor);
    } catch (e) {
      console.error("[data] prefetch failed", e);
      toast.error("Couldn't load that period — check your connection");
    }
    setMode(nextMode);
    setAnchor(nextAnchor);
    setNavBusy(false);
  }

  // Live hero figures (null in mock → demo values)
  const liveKw = getCurrentKw();
  const heroKw = liveKw ?? 4.2;
  const heroPct = liveKw != null ? Math.min(100, Math.round((liveKw / SYSTEM_KWP) * 100)) : 84;
  const statusInfo = getStatusInfo();

  const periodLabel =
    mode === "day"
      ? isToday
        ? "Today"
        : fmtDate(anchor)
      : mode === "month"
        ? `${MONTH_LONG[anchor.getMonth()]} ${anchor.getFullYear()}${isCurrentMonth ? " · so far" : ""}`
        : `${anchor.getFullYear()}${isCurrentYear ? " · so far" : ""}`;

  const percentile =
    mode === "day" ? day.percentile : mode === "month" ? month.percentile : year.percentile;

  function shift(dir: -1 | 1) {
    const d = new Date(anchor);
    if (mode === "day") d.setDate(d.getDate() + dir);
    else if (mode === "month") d.setMonth(d.getMonth() + dir, 1);
    else d.setFullYear(d.getFullYear() + dir, 0, 1);
    if (dir === 1) {
      const limit = new Date(today);
      if (mode === "month") limit.setDate(1);
      if (mode === "year") limit.setMonth(0, 1);
      if (d > limit) return;
    }
    if (dir === -1 && d < new Date(INSTALL_DATE.getFullYear(), INSTALL_DATE.getMonth(), 1)) return;
    void goTo(mode, d);
  }

  async function handleDownload() {
    const report: PeriodReport =
      mode === "day"
        ? { kind: "day", label: fmtDate(anchor), day }
        : mode === "month"
          ? {
              kind: "month",
              label: `${MONTH_LONG[anchor.getMonth()]} ${anchor.getFullYear()}`,
              year: anchor.getFullYear(),
              month: anchor.getMonth(),
              data: month,
            }
          : {
              kind: "year",
              label: `Year ${anchor.getFullYear()}`,
              year: anchor.getFullYear(),
              data: year,
            };
    await downloadReport(report, tariff);
    toast.success("Report downloaded");
  }

  async function handleShare() {
    const monthLabel = `${MONTH_LONG[anchor.getMonth()]} ${anchor.getFullYear()}`;
    await downloadShareCard({
      monthLabel,
      kwh: month.kwh,
      savedRs: month.savedRs,
      co2Kg: month.co2Kg,
      percentile: month.percentile,
      trees: Math.round(month.co2Kg / 20),
    });
    toast.success("Summary card downloaded");
  }

  // Live "now" marker position on today's curve (~current hour)
  const W = 320,
    H = 88;
  const maxCurve = Math.max(...day.curve) * 1.15 || 1;
  const nowHour = today.getHours() + today.getMinutes() / 60;
  const line = buildCurvePath(day.curve, outages, isToday ? nowHour : null, W, H, maxCurve);
  const nowX = Math.min((nowHour / 23) * W, W);
  const nowY = H - ((day.curve[Math.min(Math.floor(nowHour), 23)] ?? 0) / maxCurve) * H;

  return (
    <div
      className="min-h-screen antialiased"
      style={{ background: "#f3f1ea", color: INK, fontFamily: BODY }}
    >
      {navBusy && (
        <div
          data-testid="nav-loading"
          className="fixed top-0 left-0 right-0 z-50 h-[3px]"
          style={{ background: `linear-gradient(90deg, ${GOLD}, ${DEEP_GOLD})` }}
        />
      )}
      <div className="mx-auto max-w-md px-5 pb-28 pt-8 space-y-4">
        {/* Header */}
        <header className="flex items-start justify-between px-1">
          <div>
            <p
              className="text-[11px] font-semibold tracking-[0.18em] uppercase"
              style={{ color: DEEP_GOLD }}
            >
              Greentek Alliance
            </p>
            <h1
              className="text-[30px] font-semibold tracking-tight leading-tight mt-0.5"
              style={{ fontFamily: DISPLAY }}
            >
              My Solar
            </h1>
            <p className="text-[13px]" style={{ color: MUTED }}>
              {fmtDate(today)} · {getCity()}
            </p>
          </div>
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 mt-2"
            style={{ background: statusInfo.ok ? PALE_TEAL : PALE_GOLD }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: statusInfo.ok ? BRIGHT_TEAL : GOLD }}
            />
            <span
              className="text-[12px] font-semibold"
              style={{ color: statusInfo.ok ? TEAL : DEEP_GOLD }}
            >
              {statusInfo.label}
            </span>
          </div>
        </header>

        {tab === "solar" ? (
          <>
            {/* Mode switch + period nav */}
            <div
              className="flex items-center gap-1 rounded-full bg-white border p-1"
              style={{ borderColor: BORDER }}
            >
              {(["day", "month", "year"] as Mode[]).map((m) => (
                <button
                  key={m}
                  data-testid={`mode-${m}`}
                  onClick={() => void goTo(m, anchor)}
                  className="flex-1 rounded-full py-2 text-[13px] font-semibold capitalize transition-all duration-150 active:scale-[0.98]"
                  style={mode === m ? { background: INK, color: "#fff" } : { color: MUTED }}
                >
                  {m}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between px-1">
              <button
                onClick={() => shift(-1)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white border text-[16px] active:scale-[0.98] transition-transform duration-150"
                style={{ borderColor: BORDER, color: INK }}
                aria-label="Previous"
              >
                ‹
              </button>
              <button
                data-testid="period-picker-open"
                onClick={() => setPickerOpen(true)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
                style={{ background: "transparent" }}
                aria-label="Choose period"
              >
                <span className="text-[15px] font-semibold" style={{ fontFamily: DISPLAY }}>
                  {periodLabel}
                </span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={FAINT}
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  className="h-3 w-3"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              <div className="flex items-center gap-2">
                {!canGoNext ? null : (
                  <button
                    data-testid="period-jump-current"
                    onClick={() => {
                      if (mode === "day") void goTo(mode, new Date(today));
                      else if (mode === "month")
                        void goTo(mode, new Date(today.getFullYear(), today.getMonth(), 1));
                      else void goTo(mode, new Date(today.getFullYear(), 0, 1));
                    }}
                    className="flex h-9 items-center rounded-full border px-3 text-[12px] font-semibold active:scale-[0.98] transition-transform duration-150"
                    style={{ borderColor: BORDER, color: TEAL, background: "#fff" }}
                  >
                    {mode === "day" ? "Today" : mode === "month" ? "This month" : "This year"}
                  </button>
                )}
                {mode !== "day" && (
                  <button
                    data-testid="report-download-button"
                    onClick={handleDownload}
                    className="flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[12px] font-semibold active:scale-[0.98] transition-transform duration-150"
                    style={{ borderColor: GOLD, color: DEEP_GOLD, background: "#fff" }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      className="h-3.5 w-3.5"
                    >
                      <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" />
                    </svg>
                    Report
                  </button>
                )}
                <button
                  onClick={() => shift(1)}
                  disabled={!canGoNext}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white border text-[16px] disabled:opacity-30 active:scale-[0.98] transition-transform duration-150"
                  style={{ borderColor: BORDER, color: INK }}
                  aria-label="Next"
                >
                  ›
                </button>
              </div>
            </div>

            {/* ── DAY VIEW ─────────────────────────────────────────── */}
            {mode === "day" && (
              <>
                {isToday && (
                  <Card testId="live-hero-card">
                    <div className="flex items-start justify-between">
                      <div>
                        <p
                          className="flex items-center gap-1.5 text-[12px] font-medium"
                          style={{ color: MUTED }}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: BRIGHT_TEAL }}
                          />
                          Producing now
                        </p>
                        <p
                          className="mt-1 text-[30px] font-medium tracking-tight [font-variant-numeric:tabular-nums]"
                          style={{ fontFamily: DISPLAY }}
                        >
                          {heroKw}
                          <span className="text-[14px]" style={{ color: MUTED }}>
                            {" "}
                            kW
                          </span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[12px] font-medium" style={{ color: MUTED }}>
                          Today
                        </p>
                        <p
                          className="mt-1 text-[30px] font-medium tracking-tight [font-variant-numeric:tabular-nums]"
                          style={{ fontFamily: DISPLAY }}
                        >
                          {day.kwh}
                          <span className="text-[14px]" style={{ color: MUTED }}>
                            {" "}
                            kWh
                          </span>
                        </p>
                      </div>
                    </div>
                    <div
                      className="mt-3.5 h-1.5 overflow-hidden rounded-full"
                      style={{ background: PALE_TEAL }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${heroPct}%`,
                          background: `linear-gradient(90deg, ${GOLD}, ${DEEP_GOLD})`,
                        }}
                      />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <p className="text-[11px]" style={{ color: FAINT }}>
                        {heroPct}% of your {SYSTEM_KWP} kW system
                      </p>
                      <p
                        className="text-[13px] font-semibold [font-variant-numeric:tabular-nums]"
                        style={{ color: TEAL }}
                      >
                        {fmtRs(day.savedRs)} saved
                      </p>
                    </div>
                  </Card>
                )}

                {/* Cleaning nudge (only on today, only when triggered) */}
                {isToday && cleaningNudge && (
                  <div
                    data-testid="cleaning-nudge"
                    className="flex items-start gap-3 rounded-[18px] p-5 shadow-[0_2px_14px_rgba(13,32,29,0.05)]"
                    style={{ background: PALE_TEAL }}
                  >
                    <Droplets className="mt-0.5 h-5 w-5 shrink-0" style={{ color: TEAL }} />
                    <div>
                      <p
                        className="text-[14px] font-semibold leading-snug [font-variant-numeric:tabular-nums]"
                        style={{ color: INK }}
                      >
                        Generation is {cleaningNudge.belowPct}% below normal this week — a panel
                        cleaning may help.
                      </p>
                      <p className="mt-1 text-[12px]" style={{ color: FAINT }}>
                        Dust can cost 15–25% output in Indian conditions.
                      </p>
                    </div>
                  </div>
                )}

                <Card>
                  <div className="flex items-baseline justify-between">
                    <Label>Power through the day</Label>
                    <p className="text-[12px]" style={{ color: MUTED }}>
                      Peak {day.peakKw} kW · {day.peakTime}
                    </p>
                  </div>
                  <svg viewBox={`0 0 ${W} ${H + 6}`} className="mt-3 w-full">
                    <defs>
                      <linearGradient id="goldfill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={GOLD} stopOpacity="0.30" />
                        <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d={`${line} L ${W},${H} L 0,${H} Z`} fill="url(#goldfill)" />
                    {outages.map((o, i) => {
                      const x1 = (o.startH / 23) * W;
                      const x2 = ((o.endH ?? nowHour) / 23) * W;
                      return (
                        <g key={i}>
                          <rect
                            x={x1}
                            y="0"
                            width={Math.max(x2 - x1, 1)}
                            height={H}
                            fill="rgba(180,35,24,0.10)"
                          />
                          <line
                            x1={x2}
                            y1="0"
                            x2={x2}
                            y2={H}
                            stroke="#b42318"
                            strokeWidth="1"
                            strokeDasharray="3 3"
                          />
                        </g>
                      );
                    })}
                    <path
                      d={line}
                      fill="none"
                      stroke={GOLD}
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    {isToday && (
                      <>
                        <line
                          x1={nowX}
                          y1="4"
                          x2={nowX}
                          y2={H}
                          stroke="#d8d3c4"
                          strokeDasharray="3 3"
                          strokeWidth="1"
                        />
                        <circle
                          cx={nowX}
                          cy={nowY}
                          r="3.5"
                          fill={GOLD}
                          stroke="#fff"
                          strokeWidth="1.5"
                        />
                      </>
                    )}
                  </svg>
                  <div className="mt-1 flex justify-between text-[11px]" style={{ color: FAINT }}>
                    <span>6 AM</span>
                    <span>12 PM</span>
                    <span>6 PM</span>
                  </div>
                </Card>

                {/* Grid outage card (only when the day has outages) */}
                {outages.length > 0 && (
                  <div
                    data-testid="outage-card"
                    className="rounded-[18px] p-5 shadow-[0_2px_14px_rgba(13,32,29,0.05)]"
                    style={{ background: PALE_GOLD }}
                  >
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" style={{ color: DEEP_GOLD }} />
                      <p className="text-[13px] font-semibold" style={{ color: DEEP_GOLD }}>
                        {outages.length === 1 ? "Grid outage" : "Grid outages"}
                      </p>
                    </div>
                    <div className="mt-3 space-y-2">
                      <OutageRows events={outages} />
                      {outages.length > 1 && (
                        <div
                          className="flex items-baseline justify-between gap-3 border-t pt-2"
                          style={{ borderColor: "rgba(138,104,38,0.2)" }}
                        >
                          <span className="text-[13px] font-semibold" style={{ color: INK }}>
                            Total
                          </span>
                          <span
                            className="text-[12px] font-semibold [font-variant-numeric:tabular-nums]"
                            style={{ color: DEEP_GOLD }}
                          >
                            ≈{Math.round(outages.reduce((a, o) => a + o.lostKwh, 0) * 10) / 10} kWh
                            lost (≈
                            {fmtRs(outages.reduce((a, o) => a + o.lostRs, 0))})
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Tomorrow forecast (only on today, below the graph) */}
                {isToday && (
                  <Card testId="forecast-card" className="flex items-center gap-4">
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                      style={{ background: PALE_GOLD, color: GOLD }}
                    >
                      {forecast.condition === "Sunny" ? (
                        <Sun className="h-5 w-5" />
                      ) : forecast.condition === "Partly cloudy" ? (
                        <CloudSun className="h-5 w-5" />
                      ) : (
                        <Cloud className="h-5 w-5" />
                      )}
                    </div>
                    <div>
                      <p
                        className="text-[15px] font-medium [font-variant-numeric:tabular-nums]"
                        style={{ color: INK }}
                      >
                        Tomorrow: {forecast.condition} — expect ≈{forecast.expectedKwh} kWh
                      </p>
                      <p className="text-[12px]" style={{ color: MUTED }}>
                        {forecast.note}
                      </p>
                    </div>
                  </Card>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {!isToday && (
                    <>
                      <StatCard
                        label="Energy"
                        value={`${day.kwh}`}
                        unit="kWh"
                        note={`${day.sunHours} peak sun hours`}
                      />
                      <StatCard
                        label="Saved"
                        value={fmtRs(day.savedRs)}
                        note={`at ${fmtRs(tariff)} / kWh`}
                        valueColor={TEAL}
                      />
                    </>
                  )}
                  <StatCard
                    label="CO₂ avoided"
                    value={`${day.co2Kg}`}
                    unit="kg"
                    note="vs grid electricity"
                    icon={<Leaf className="h-4 w-4" style={{ color: TEAL }} />}
                  />
                  <StatCard
                    label="Trees equivalent"
                    value={`${(day.co2Kg / 20).toFixed(1)}`}
                    note="planted this day"
                    icon={<TreePine className="h-4 w-4" style={{ color: TEAL }} />}
                  />
                </div>
              </>
            )}

            {/* ── MONTH VIEW ───────────────────────────────────────── */}
            {mode === "month" && (
              <>
                <Card>
                  <div className="flex items-baseline justify-between">
                    <Label>Energy this month</Label>
                    <p
                      className="text-[13px] font-semibold [font-variant-numeric:tabular-nums]"
                      style={{ color: TEAL }}
                    >
                      {fmtRs(month.savedRs)} saved
                    </p>
                  </div>
                  <p
                    className="mt-1 text-[34px] font-medium tracking-tight [font-variant-numeric:tabular-nums]"
                    style={{ fontFamily: DISPLAY }}
                  >
                    {month.kwh.toLocaleString("en-IN")}{" "}
                    <span className="text-[16px]" style={{ color: MUTED }}>
                      kWh
                    </span>
                  </p>
                  <Bars
                    values={month.days.map((d) => d.kwh)}
                    highlight={month.bestDay.day - 1}
                    marks={monthOutages.affectedDays.map((d) => d - 1)}
                  />
                  <p
                    className="mt-3 text-[12px] [font-variant-numeric:tabular-nums]"
                    style={{ color: FAINT }}
                  >
                    Best day: {month.bestDay.day} {MONTH_SHORT[anchor.getMonth()]} ·{" "}
                    {month.bestDay.kwh} kWh
                  </p>
                </Card>

                {/* Compact outage summary */}
                {monthOutages.count > 0 && (
                  <div data-testid="month-outage-summary" className="flex items-center gap-2 px-1">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: GOLD }} />
                    <p
                      className="text-[12px] [font-variant-numeric:tabular-nums]"
                      style={{ color: MUTED }}
                    >
                      {monthOutages.count} outage{monthOutages.count === 1 ? "" : "s"} ·{" "}
                      {monthOutages.totalHours} h total · ≈{monthOutages.lostKwh} kWh lost (≈
                      {fmtRs(monthOutages.lostRs)})
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <StatCard
                    label="Daily average"
                    value={`${Math.round((month.kwh / Math.max(month.days.length, 1)) * 10) / 10}`}
                    unit="kWh"
                    note={`across ${month.days.length} days`}
                  />
                  <StatCard
                    label="CO₂ avoided"
                    value={`${(month.co2Kg / 1000).toFixed(2)}`}
                    unit="t"
                    note={`≈ ${Math.round(month.co2Kg / 20)} trees`}
                  />
                </div>

                {/* Shareable monthly summary card */}
                <button
                  data-testid="share-summary-button"
                  onClick={handleShare}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-[12px] text-[14px] font-semibold active:scale-[0.98] transition-transform duration-150"
                  style={{
                    background: "rgba(201,164,96,0.16)",
                    border: "1px solid rgba(138,104,38,0.25)",
                    color: INK,
                  }}
                >
                  <Share2 className="h-4 w-4" />
                  Share monthly summary
                </button>

                {/* Expandable outage list */}
                {monthOutages.count > 0 && (
                  <Card className="p-0 overflow-hidden">
                    <button
                      data-testid="month-outages-toggle"
                      onClick={() => setShowOutages(!showOutages)}
                      className="flex w-full items-center justify-between px-5 py-4"
                    >
                      <span className="text-[13px] font-medium" style={{ color: MUTED }}>
                        Outages this month
                      </span>
                      <span className="text-[13px]" style={{ color: FAINT }}>
                        {showOutages ? "Hide" : "Show"}
                      </span>
                    </button>
                    {showOutages && (
                      <div
                        className="border-t px-5 py-4 space-y-2.5"
                        style={{ borderColor: "#ece8dc" }}
                      >
                        {/* Total at top */}
                        <div
                          className="flex items-baseline justify-between gap-3 pb-2.5 border-b"
                          style={{ borderColor: "#ece8dc" }}
                        >
                          <span className="text-[13px] font-semibold" style={{ color: INK }}>
                            Total · {monthOutages.count} outage{monthOutages.count > 1 ? "s" : ""} ·{" "}
                            {monthOutages.totalHours} h
                          </span>
                          <span
                            className="text-[13px] font-semibold whitespace-nowrap [font-variant-numeric:tabular-nums]"
                            style={{ color: "#b42318" }}
                          >
                            ≈{monthOutages.lostKwh} kWh (≈{fmtRs(monthOutages.lostRs)})
                          </span>
                        </div>
                        {monthOutages.affectedDays.map((d) => (
                          <div key={d} className="space-y-2">
                            {getDayOutages(
                              new Date(anchor.getFullYear(), anchor.getMonth(), d),
                              tariff
                            ).map((o, i) => (
                              <div key={i} className="flex items-baseline justify-between gap-3">
                                <span
                                  className="text-[13px] [font-variant-numeric:tabular-nums]"
                                  style={{ color: MUTED }}
                                >
                                  {d} {MONTH_SHORT[anchor.getMonth()]} ·{" "}
                                  {fmtTimeRange(o.startH, o.endH ?? o.startH)} ·{" "}
                                  {fmtDuration(o.startH, o.endH ?? o.startH)}
                                </span>
                                <span
                                  className="text-[13px] font-medium whitespace-nowrap [font-variant-numeric:tabular-nums]"
                                  style={{ color: INK }}
                                >
                                  {o.lostKwh > 0
                                    ? `≈${o.lostKwh} kWh (≈${fmtRs(o.lostRs)})`
                                    : "No impact"}
                                </span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                )}
              </>
            )}

            {/* ── YEAR VIEW ────────────────────────────────────────── */}
            {mode === "year" && (
              <>
                <Card>
                  <div className="flex items-baseline justify-between">
                    <Label>Energy this year</Label>
                    <p
                      className="text-[13px] font-semibold [font-variant-numeric:tabular-nums]"
                      style={{ color: TEAL }}
                    >
                      {fmtRs(year.savedRs)} saved
                    </p>
                  </div>
                  <p
                    className="mt-1 text-[34px] font-medium tracking-tight [font-variant-numeric:tabular-nums]"
                    style={{ fontFamily: DISPLAY }}
                  >
                    {year.kwh.toLocaleString("en-IN")}{" "}
                    <span className="text-[16px]" style={{ color: MUTED }}>
                      kWh
                    </span>
                  </p>
                  <Bars
                    values={year.months.map((m) => m.kwh)}
                    highlight={year.bestMonth.month}
                    labels={year.months.map((m) => MONTH_SHORT[m.month])}
                  />
                  <p
                    className="mt-3 text-[12px] [font-variant-numeric:tabular-nums]"
                    style={{ color: FAINT }}
                  >
                    Best month: {MONTH_LONG[year.bestMonth.month]} ·{" "}
                    {year.bestMonth.kwh.toLocaleString("en-IN")} kWh
                  </p>
                </Card>

                {/* Compact outage summary */}
                {yearOutages.count > 0 && (
                  <div data-testid="year-outage-summary" className="flex items-center gap-2 px-1">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: GOLD }} />
                    <p
                      className="text-[12px] [font-variant-numeric:tabular-nums]"
                      style={{ color: MUTED }}
                    >
                      {yearOutages.count} outage{yearOutages.count === 1 ? "" : "s"} ·{" "}
                      {yearOutages.totalHours} h · ≈{yearOutages.lostKwh} kWh lost (≈
                      {fmtRs(yearOutages.lostRs)})
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <StatCard
                    label="Grid uptime"
                    testId="year-uptime"
                    value={`${yearOutages.uptimePct}`}
                    unit="%"
                    note="this year"
                    valueColor={DEEP_GOLD}
                  />
                  <StatCard
                    label="CO₂ avoided"
                    value={`${(year.co2Kg / 1000).toFixed(2)}`}
                    unit="t"
                    note={`≈ ${Math.round(year.co2Kg / 20)} trees`}
                  />
                </div>
              </>
            )}

            {/* Performance percentile + tooltip */}
            <Card className="relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Label>Plant performance</Label>
                  <button
                    data-testid="percentile-info-button"
                    onClick={() => setTipOpen(!tipOpen)}
                    className="flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-bold"
                    style={{ borderColor: FAINT, color: FAINT }}
                    aria-label="About performance percentile"
                  >
                    i
                  </button>
                </div>
                <span
                  className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: PALE_GOLD, color: DEEP_GOLD }}
                >
                  Top {100 - percentile}%
                </span>
              </div>
              <p className="mt-2 text-[15px] leading-snug">
                Better than{" "}
                <span className="font-semibold" style={{ color: TEAL }}>
                  {percentile}%
                </span>{" "}
                of similar {SYSTEM_KWP} kW plants in {getCity()}{" "}
                {mode === "day" ? "today" : mode === "month" ? "this month" : "this year"}.
              </p>
              {tipOpen && (
                <div
                  className="absolute left-4 right-4 top-12 z-10 rounded-[14px] border bg-white p-4 shadow-[0_8px_30px_rgba(13,32,29,0.12)]"
                  style={{ borderColor: BORDER }}
                >
                  <p className="text-[13px] font-semibold mb-1" style={{ fontFamily: DISPLAY }}>
                    How this is calculated
                  </p>
                  <p className="text-[12px] leading-relaxed" style={{ color: MUTED }}>
                    We compare your plant's actual generation against its expected output for its
                    size, location and the weather — then rank it against all {SYSTEM_KWP} kW
                    residential plants monitored by Greentek in your state. A higher percentile
                    means your system is converting sunlight better than most, factoring out weather
                    you can't control.
                  </p>
                  <button
                    onClick={() => setTipOpen(false)}
                    className="mt-2 text-[12px] font-semibold"
                    style={{ color: DEEP_GOLD }}
                  >
                    Got it
                  </button>
                </div>
              )}
            </Card>

            {/* Lifetime strip */}
            <Card className="p-0 overflow-hidden">
              <div className="px-5 py-4 text-center" style={{ background: "#f7f5ee" }}>
                <p className="text-[12px]" style={{ color: MUTED }}>
                  Since installation · {fmtDate(INSTALL_DATE)}
                </p>
                <p
                  className="text-[19px] font-semibold tracking-tight [font-variant-numeric:tabular-nums]"
                  style={{ fontFamily: DISPLAY }}
                >
                  {(LIFETIME.kwh / 1000).toFixed(1)} MWh ·{" "}
                  <span style={{ color: DEEP_GOLD }}>
                    {fmtRs(Math.round(LIFETIME.kwh * tariff))} saved
                  </span>
                </p>
                <p
                  className="text-[12px] mt-0.5 [font-variant-numeric:tabular-nums]"
                  style={{ color: FAINT }}
                >
                  {(LIFETIME.co2Kg / 1000).toFixed(1)} t CO₂ · ≈ {Math.round(LIFETIME.co2Kg / 20)}{" "}
                  trees
                </p>
              </div>
            </Card>

            {/* Investment payback tracker */}
            <Card testId="payback-card">
              <Label>Investment payback</Label>
              <p
                className="mt-1 text-[26px] font-medium tracking-tight [font-variant-numeric:tabular-nums]"
                style={{ fontFamily: DISPLAY, color: INK }}
              >
                {fmtRs(payback.recovered)} recovered
              </p>
              <p
                className="text-[12px] [font-variant-numeric:tabular-nums]"
                style={{ color: FAINT }}
              >
                {payback.pct}% of {fmtRs(SYSTEM_COST_RS)} · break-even ≈{" "}
                {MONTH_LONG[payback.breakeven.getMonth()]} {payback.breakeven.getFullYear()}
              </p>
              <div
                className="mt-3 h-2 overflow-hidden rounded-full"
                style={{ background: PALE_TEAL }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${payback.pct}%`,
                    background: `linear-gradient(90deg, ${GOLD}, ${DEEP_GOLD})`,
                  }}
                />
              </div>
            </Card>

            {/* Advanced — tucked away */}
            <Card className="p-0 overflow-hidden">
              <button
                data-testid="technical-details-toggle"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex w-full items-center justify-between px-5 py-4"
              >
                <span className="text-[13px] font-medium" style={{ color: MUTED }}>
                  Technical details
                </span>
                <span className="text-[13px]" style={{ color: FAINT }}>
                  {showAdvanced ? "Hide" : "Show"}
                </span>
              </button>
              {showAdvanced && (
                <div className="border-t px-5 py-4 space-y-2.5" style={{ borderColor: "#ece8dc" }}>
                  {[
                    ["Grid voltage", "243 V"],
                    ["Grid frequency", "50.02 Hz"],
                    ["Inverter temperature", "41 °C"],
                    ["Specific yield", `${(day.kwh / SYSTEM_KWP).toFixed(1)} kWh / kWp`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between">
                      <span className="text-[13px]" style={{ color: MUTED }}>
                        {k}
                      </span>
                      <span className="text-[13px] font-medium" style={{ color: INK }}>
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Referral hook */}
            <div
              className="rounded-[18px] p-5 text-center shadow-[0_2px_14px_rgba(13,32,29,0.06)]"
              style={{ background: "linear-gradient(135deg, #fff7e6, #dcc086, #c9a460)" }}
            >
              <p
                className="text-[15px] font-semibold"
                style={{ fontFamily: DISPLAY, color: "#3d2f10" }}
              >
                You've saved {fmtRs(Math.round(LIFETIME.kwh * tariff))} and planted{" "}
                {Math.round(LIFETIME.co2Kg / 20)} trees
              </p>
              <p className="mt-1 text-[13px]" style={{ color: "#5c4a1e" }}>
                Know a neighbour who'd love numbers like these?
              </p>
              <button
                className="mt-3 rounded-full px-6 py-2.5 text-[14px] font-semibold text-white"
                style={{ background: INK }}
              >
                Refer & Earn
              </button>
            </div>

            <p className="px-1 pt-1 text-center text-[12px]" style={{ color: FAINT }}>
              {getUpdatedLabel()} · {SYSTEM_KWP} kW rooftop · Greentek India
            </p>
          </>
        ) : (
          <SettingsPanel tariff={tariff} onTariffChange={updateTariff} />
        )}
      </div>

      {/* Bottom tab bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 border-t bg-white/90 backdrop-blur"
        style={{ borderColor: BORDER }}
      >
        <div className="mx-auto flex max-w-md">
          {(
            [
              { id: "solar", label: "Solar", icon: <SunIcon className="h-6 w-6" /> },
              {
                id: "settings",
                label: "Settings",
                icon: (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    className="h-6 w-6"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 8.49a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 008.92 4a1.65 1.65 0 001-1.51V2.4a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82 1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
                  </svg>
                ),
              },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              data-testid={`tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className="flex flex-1 flex-col items-center gap-0.5 py-2.5 active:scale-[0.98] transition-transform duration-150"
              style={{ color: tab === t.id ? DEEP_GOLD : FAINT }}
            >
              {t.icon}
              <span className="text-[11px] font-medium">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {pickerOpen && (
        <PeriodPicker
          mode={mode}
          anchor={anchor}
          onSelect={(d) => void goTo(mode, d)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
