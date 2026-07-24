import { describe, expect, it } from "vitest";
import {
  CO2_KG_PER_KWH,
  SYSTEM_KWP,
  TARIFF_RS_PER_KWH,
  curveWindowKwh,
  daylightOverlapHours,
  expectedClearCurve,
  fmtHour,
  fmtRs,
  getDayData,
  getDayOutages,
  getMonthData,
  getTomorrowForecast,
  getYearData,
  typicalDayKwh,
} from "./solarData";

// Fixed past date, well after the mock install date (14 Mar 2025), so
// results are deterministic and independent of "today".
const DAY = new Date(2025, 5, 15); // 15 Jun 2025

describe("typicalDayKwh", () => {
  it("is positive and scaled by system size", () => {
    const v = typicalDayKwh(DAY);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(SYSTEM_KWP * 6); // sanity bound for kWh/kWp/day
  });

  it("reflects the monsoon dip (Apr beats Jul)", () => {
    expect(typicalDayKwh(new Date(2025, 3, 15))).toBeGreaterThan(
      typicalDayKwh(new Date(2025, 6, 15))
    );
  });
});

describe("expectedClearCurve", () => {
  it("has 24 hourly points that are zero outside daylight", () => {
    const curve = expectedClearCurve(DAY);
    expect(curve).toHaveLength(24);
    for (const h of [0, 1, 5, 6, 19, 20, 23]) expect(curve[h]).toBe(0);
    for (const h of [8, 11, 13, 16]) expect(curve[h]).toBeGreaterThan(0);
  });

  it("sums to the typical day total", () => {
    const sum = expectedClearCurve(DAY).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(typicalDayKwh(DAY), 6);
  });
});

describe("curveWindowKwh", () => {
  it("sums the whole curve over 0–24", () => {
    const curve = Array.from({ length: 24 }, (_, h) => h);
    expect(curveWindowKwh(curve, 0, 24)).toBe(curve.reduce((a, b) => a + b, 0));
  });

  it("prorates fractional hour windows", () => {
    const flat = Array(24).fill(1);
    expect(curveWindowKwh(flat, 9.2, 10.1)).toBeCloseTo(0.9, 6);
  });

  it("returns 0 for an empty window", () => {
    expect(curveWindowKwh(Array(24).fill(5), 12, 12)).toBe(0);
  });
});

describe("getDayData", () => {
  it("is deterministic for the same date", () => {
    expect(getDayData(DAY)).toEqual(getDayData(DAY));
  });

  it("keeps kwh, savings and co2 internally consistent", () => {
    const d = getDayData(DAY);
    expect(d.curve).toHaveLength(24);
    expect(d.kwh).toBeCloseTo(
      d.curve.reduce((a, b) => a + b, 0),
      0
    );
    expect(d.savedRs).toBe(Math.round(d.kwh * TARIFF_RS_PER_KWH));
    expect(d.co2Kg).toBeCloseTo(d.kwh * CO2_KG_PER_KWH, 1);
    expect(d.peakKw).toBe(Math.max(...d.curve));
  });

  it("honours a custom tariff", () => {
    const d = getDayData(DAY, 10);
    expect(d.savedRs).toBe(Math.round(d.kwh * 10));
  });
});

describe("getMonthData / getYearData", () => {
  it("month totals equal the sum of their day totals", () => {
    const m = getMonthData(2025, 5);
    const sum = m.days.reduce((a, b) => a + b.kwh, 0);
    expect(m.kwh).toBeCloseTo(sum, 0);
    expect(m.bestDay.kwh).toBe(Math.max(...m.days.map((d) => d.kwh)));
  });

  it("year totals equal the sum of month totals", () => {
    const y = getYearData(2025);
    const sum = y.months.reduce((a, b) => a + b.kwh, 0);
    expect(y.kwh).toBeCloseTo(sum, 0);
    expect(y.bestMonth.kwh).toBe(Math.max(...y.months.map((m) => m.kwh)));
    // spot-check one month against the direct month reader
    expect(y.months[5].kwh).toBe(getMonthData(2025, 5).kwh);
  });
});

describe("outages", () => {
  it("never reports outages before installation or in the future", () => {
    expect(getDayOutages(new Date(2025, 0, 10))).toEqual([]); // pre-install
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    expect(getDayOutages(future)).toEqual([]);
  });

  it("estimates non-negative losses within an outage window", () => {
    // find a past day that actually has an outage (deterministic per date)
    let found = false;
    for (let d = 1; d <= 28 && !found; d++) {
      const events = getDayOutages(new Date(2025, 4, d));
      for (const e of events) {
        found = true;
        expect(e.lostKwh).toBeGreaterThanOrEqual(0);
        expect(e.lostRs).toBe(Math.round(e.lostKwh * TARIFF_RS_PER_KWH));
      }
    }
    expect(found).toBe(true); // ~28% of days have one — May 2025 must contain one
  });
});

describe("daylightOverlapHours", () => {
  it.each([
    [9, 10, 1],
    [20, 23, 0], // fully at night
    [5, 20, 13], // clipped to 06:00–19:00
    [18, 22, 1],
    [10, 8, 0], // inverted window
  ])("(%f, %f) → %f", (start, end, expected) => {
    expect(daylightOverlapHours(start, end)).toBe(expected);
  });
});

describe("getTomorrowForecast", () => {
  it("returns a sane, internally consistent forecast", () => {
    const f = getTomorrowForecast();
    expect(["Sunny", "Partly cloudy", "Cloudy"]).toContain(f.condition);
    expect(f.expectedKwh).toBeGreaterThan(0);
    expect(f.kwh).toBe(f.expectedKwh);
    expect(f.note.length).toBeGreaterThan(0);
  });
});

describe("formatters", () => {
  it("fmtRs uses Indian digit grouping", () => {
    expect(fmtRs(109120)).toBe("₹1,09,120");
    expect(fmtRs(880)).toBe("₹880");
  });

  it("fmtHour converts hour floats to 12-hour clock", () => {
    expect(fmtHour(9.2)).toBe("9:12 AM");
    expect(fmtHour(13.5)).toBe("1:30 PM");
    expect(fmtHour(0)).toBe("12:00 AM");
    expect(fmtHour(12)).toBe("12:00 PM");
  });
});
