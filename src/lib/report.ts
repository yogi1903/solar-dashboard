import {
  SYSTEM_KWP,
  TARIFF_RS_PER_KWH,
  LIFETIME,
  MONTH_LONG,
  MONTH_SHORT,
  fmtRs,
  fmtDate,
  INSTALL_DATE,
  getCity,
} from "./data";
import type { DayData, MonthData, YearData } from "./data";

const INK: [number, number, number] = [13, 32, 29];
const MUTED: [number, number, number] = [90, 110, 106];
const GOLD: [number, number, number] = [201, 164, 96];
const CREAM: [number, number, number] = [243, 241, 234];

export type PeriodReport =
  | { kind: "day"; label: string; day: DayData }
  | { kind: "month"; label: string; year: number; month: number; data: MonthData }
  | { kind: "year"; label: string; year: number; data: YearData };

export async function downloadReport(report: PeriodReport, tariff = TARIFF_RS_PER_KWH) {
  const { jsPDF } = await import("jspdf"); // lazy-loaded: keeps the main bundle small
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 48;
  let y = 0;

  // Header band
  doc.setFillColor(...INK);
  doc.rect(0, 0, pageW, 92, "F");
  doc.setTextColor(...GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("GREENTEK ALLIANCE", margin, 36);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.text("Solar Generation Report", margin, 60);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(226, 238, 237);
  doc.text(report.label, margin, 78);
  y = 122;

  // Site block
  doc.setTextColor(...MUTED);
  doc.setFontSize(9);
  doc.text("SITE", margin, y);
  doc.setTextColor(...INK);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(`Residential rooftop · ${SYSTEM_KWP} kW · ${getCity()}`, margin, y + 15);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  doc.text(
    `Tariff ${fmtRs(tariff)}/kWh · Installed ${fmtDate(INSTALL_DATE)} · Generated ${fmtDate(new Date())}`,
    margin,
    y + 31
  );
  y += 58;

  const stats: [string, string][] =
    report.kind === "day"
      ? [
          ["Energy generated", `${report.day.kwh} kWh`],
          ["Money saved", fmtRs(report.day.savedRs)],
          ["Peak power", `${report.day.peakKw} kW at ${report.day.peakTime}`],
          ["Peak sun hours", `${report.day.sunHours} h`],
          ["CO2 avoided", `${report.day.co2Kg} kg`],
          ["Performance", `Better than ${report.day.percentile}% of similar plants`],
        ]
      : report.kind === "month"
        ? [
            ["Energy generated", `${report.data.kwh} kWh`],
            ["Money saved", fmtRs(report.data.savedRs)],
            [
              "Best day",
              `${report.data.bestDay.day} ${MONTH_SHORT[report.month]} · ${report.data.bestDay.kwh} kWh`,
            ],
            [
              "Daily average",
              `${Math.round((report.data.kwh / Math.max(report.data.days.length, 1)) * 10) / 10} kWh`,
            ],
            ["CO2 avoided", `${report.data.co2Kg} kg`],
            ["Performance", `Better than ${report.data.percentile}% of similar plants`],
          ]
        : [
            ["Energy generated", `${report.data.kwh} kWh`],
            ["Money saved", fmtRs(report.data.savedRs)],
            [
              "Best month",
              `${MONTH_LONG[report.data.bestMonth.month]} · ${report.data.bestMonth.kwh} kWh`,
            ],
            [
              "Monthly average",
              `${Math.round((report.data.kwh / Math.max(report.data.months.length, 1)) * 10) / 10} kWh`,
            ],
            ["CO2 avoided", `${report.data.co2Kg} kg`],
            ["Performance", `Better than ${report.data.percentile}% of similar plants`],
          ];

  // Stats box
  doc.setFillColor(...CREAM);
  doc.roundedRect(margin, y, pageW - margin * 2, stats.length * 24 + 20, 8, 8, "F");
  stats.forEach(([k, v], i) => {
    const ry = y + 24 + i * 24;
    doc.setTextColor(...MUTED);
    doc.setFontSize(10);
    doc.text(k, margin + 16, ry);
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.text(v, margin + 190, ry);
    doc.setFont("helvetica", "normal");
  });
  y += stats.length * 24 + 44;

  // Breakdown table (top rows)
  doc.setTextColor(...MUTED);
  doc.setFontSize(9);
  const breakdownTitle =
    report.kind === "day"
      ? "HOURLY GENERATION (kW)"
      : report.kind === "month"
        ? "DAILY GENERATION (kWh)"
        : "MONTHLY GENERATION (kWh)";
  doc.text(breakdownTitle, margin, y);
  y += 16;

  const rows: [string, string][] =
    report.kind === "day"
      ? report.day.curve
          .map((kw, h) => [`${String(h).padStart(2, "0")}:00`, `${kw}`] as [string, string])
          .filter(([, v]) => parseFloat(v) > 0)
      : report.kind === "month"
        ? report.data.days.map(
            (d) => [`${d.day} ${MONTH_SHORT[report.month]}`, `${d.kwh}`] as [string, string]
          )
        : report.data.months.map((m) => [MONTH_LONG[m.month], `${m.kwh}`] as [string, string]);

  // Two-column table
  const colW = (pageW - margin * 2) / 2;
  const half = Math.ceil(rows.length / 2);
  rows.forEach(([label, val], i) => {
    const col = i < half ? 0 : 1;
    const row = i < half ? i : i - half;
    const rx = margin + col * colW;
    const ry = y + row * 15;
    if (ry > 760) return;
    doc.setTextColor(...MUTED);
    doc.setFontSize(9);
    doc.text(label, rx + 8, ry + 11);
    doc.setTextColor(...INK);
    doc.text(val, rx + colW - 40, ry + 11);
  });

  // Footer
  const fy = 800;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1);
  doc.line(margin, fy, pageW - margin, fy);
  doc.setTextColor(...MUTED);
  doc.setFontSize(8.5);
  doc.text(
    `Lifetime since installation: ${(LIFETIME.kwh / 1000).toFixed(1)} MWh · ${fmtRs(Math.round(LIFETIME.kwh * tariff))} saved · ${(LIFETIME.co2Kg / 1000).toFixed(1)} t CO2 avoided`,
    margin,
    fy + 16
  );
  doc.text("Greentek India Limited · alliance.greentekindia.co.in", margin, fy + 30);

  const filename =
    report.kind === "day"
      ? `greentek-solar-report-${report.label.replace(/\s/g, "-")}.pdf`
      : `greentek-solar-report-${report.label.replace(/\s/g, "-")}.pdf`;
  doc.save(filename);
}
