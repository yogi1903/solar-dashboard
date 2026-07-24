// ShineMonitor API client (browser-side, via the Vite dev proxy).
// LOCAL DEMO ONLY — credentials ship in the bundle here. In production this
// must move behind the FastAPI module (see docs/migration-plan.md).
//
// Auth: sign = SHA1(salt + SHA1(pwd) + actionParams) → token + secret
// Calls: sign = SHA1(salt + secret + token + actionParams), plus &token=

const BASE = "/shinemonitor"; // proxied to http://api.shinemonitor.com/public/

const USR = import.meta.env.VITE_SHINEMONITOR_USR ?? "";
const PWD = import.meta.env.VITE_SHINEMONITOR_PWD ?? "";
const KEY = import.meta.env.VITE_SHINEMONITOR_COMPANY_KEY ?? "bnrl_frRFjEz8Mkn";
export const PLANT_ID = import.meta.env.VITE_SHINEMONITOR_PLANT_ID ?? "";

async function sha1Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ── token cache (localStorage, token lives ~5 days) ─────────── */
interface AuthState { token: string; secret: string; expiresAt: number }
const AUTH_KEY = "greentek-shine-auth";

function loadAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as AuthState;
    return a.expiresAt > Date.now() + 60_000 ? a : null; // 1 min safety margin
  } catch { return null; }
}
function saveAuth(a: AuthState) { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); }
export function clearAuth() { localStorage.removeItem(AUTH_KEY); }

async function rawCall(actionParams: string, attempt = 0): Promise<any> {
  const salt = Date.now().toString();
  const auth = loadAuth();
  const sign = auth
    ? await sha1Hex(salt + auth.secret + auth.token + actionParams)
    : await sha1Hex(salt + (await sha1Hex(PWD)) + actionParams);
  const url = `${BASE}?sign=${sign}&salt=${salt}${auth ? `&token=${auth.token}` : ""}${actionParams}`;
  try {
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      return rawCall(actionParams, attempt + 1);
    }
    throw e;
  }
}

async function ensureAuth(): Promise<void> {
  if (loadAuth()) return;
  const r = await rawCall(`&action=auth&usr=${encodeURIComponent(USR)}&company-key=${KEY}`);
  if (r.err !== 0) throw new Error(`ShineMonitor auth failed: ${r.desc ?? JSON.stringify(r)}`);
  const { token, secret, expire } = r.dat;
  saveAuth({ token, secret, expiresAt: Date.now() + Math.min(expire ?? 432000, 432000) * 1000 });
}

// Signed business call; on auth-type errors, re-authenticates once.
export async function shineCall(actionParams: string, retried = false): Promise<any> {
  await ensureAuth();
  const r = await rawCall(actionParams);
  if (r.err !== 0 && !retried) {
    clearAuth(); // token may have been revoked server-side
    await ensureAuth();
    return rawCall(actionParams);
  }
  if (r.err !== 0) throw new Error(`ShineMonitor ${actionParams}: ${r.desc ?? r.err}`);
  return r.dat;
}

/* ── typed queries ───────────────────────────────────────────── */

const P = () => `&plantid=${PLANT_ID}`;

// "2026-07-22 16:25:34" → local Date (string is plant-local time)
export function parseTs(ts: string): Date {
  const [d, t] = ts.split(" ");
  const [y, m, dd] = d.split("-").map(Number);
  const [H, M, S] = (t ?? "00:00:00").split(":").map(Number);
  return new Date(y, m - 1, dd, H, M, S);
}

export interface PlantInfo {
  pid: number; name: string; status: number; nominalPowerKw: number;
  installDate: Date; city: string; tariffRsPerKwh: number; co2KgPerKwh: number;
}
export async function getPlantInfo(): Promise<PlantInfo> {
  const d = await shineCall(`&action=queryPlantInfo${P()}`);
  return {
    pid: d.pid,
    name: d.name,
    status: d.status,
    nominalPowerKw: parseFloat(d.nominalPower) || 0,
    installDate: parseTs(d.install),
    city: d.address?.city || d.address?.province || "",
    tariffRsPerKwh: parseFloat(d.profit?.unitProfit) || 0,
    co2KgPerKwh: parseFloat(d.profit?.co2) || 0,
  };
}

export interface EnergySummary { today: number; month: number; year: number; total: number }
export async function getEnergySummary(): Promise<EnergySummary> {
  const rows = await shineCall(
    `&action=queryPlantCurrentData${P()}&par=ENERGY_TODAY,ENERGY_MONTH,ENERGY_YEAR,ENERGY_TOTAL`,
  );
  const get = (k: string) => parseFloat(rows.find((r: any) => r.key === k)?.val ?? "0") || 0;
  return { today: get("ENERGY_TODAY"), month: get("ENERGY_MONTH"), year: get("ENERGY_YEAR"), total: get("ENERGY_TOTAL") };
}

// 5-minute kW points for a day (288 entries, zeros at night)
export interface CurvePoint { kw: number; date: Date }
export async function getDayCurve(date: Date): Promise<CurvePoint[]> {
  const ds = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const d = await shineCall(`&action=queryPlantActiveOuputPowerOneDay${P()}&date=${ds}`);
  return (d?.outputPower ?? []).map((p: any) => ({ kw: parseFloat(p.val) || 0, date: parseTs(p.ts) }));
}

// Daily kWh totals for a month
export async function getMonthPerDay(year: number, month: number): Promise<{ day: number; kwh: number }[]> {
  const ds = `${year}-${String(month + 1).padStart(2, "0")}`;
  const d = await shineCall(`&action=queryPlantEnergyMonthPerDay${P()}&date=${ds}`);
  return (d?.perday ?? []).map((p: any) => ({ day: parseTs(p.ts).getDate(), kwh: parseFloat(p.val) || 0 }));
}

// Monthly kWh totals for a year
export async function getYearPerMonth(year: number): Promise<{ month: number; kwh: number }[]> {
  const d = await shineCall(`&action=queryPlantEnergyYearPerMonth${P()}&date=${year}`);
  return (d?.permonth ?? []).map((p: any) => ({ month: parseTs(p.ts).getMonth(), kwh: parseFloat(p.val) || 0 }));
}

// All warnings for the plant (API caps pagesize at 100 → page through).
// Only "No utility fault" (0x00000009) marks a grid outage.
export interface WarningEvent { code: string; desc: string; start: Date; end: Date | null }
export async function getAllWarnings(maxPages = 6): Promise<WarningEvent[]> {
  const out: WarningEvent[] = [];
  for (let page = 0; page < maxPages; page++) {
    const d = await shineCall(`&action=queryPlantWarning${P()}&i18n=en_US&page=${page}&pagesize=100`);
    const rows: any[] = d?.warning ?? [];
    for (const w of rows) {
      const start = parseTs(w.gts);
      const end = w.cts ? parseTs(w.cts) : null;
      out.push({ code: w.code, desc: w.desc, start, end: end && end > start ? end : null });
    }
    if (rows.length < 100) break;
  }
  return out;
}
