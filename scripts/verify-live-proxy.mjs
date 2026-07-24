// End-to-end verification of the live data path THROUGH the Vite proxy —
// exercises exactly what the browser client will do (auth + all queries).
// Usage: node scripts/verify-live-proxy.mjs   (dev server must be running on :3000)

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(join(__dir, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].trim();
}
const USR = env.SHINEMONITOR_USR, PWD = env.SHINEMONITOR_PWD;
const KEY = "bnrl_frRFjEz8Mkn";
const PID = "1207966";
const BASE = "http://127.0.0.1:3000/shinemonitor"; // through the Vite proxy

const sha1 = (s) => createHash("sha1").update(s, "utf8").digest("hex");
async function call(ap, secret, token) {
  const salt = Date.now().toString();
  const sign = secret ? sha1(salt + secret + token + ap) : sha1(salt + sha1(PWD) + ap);
  const r = await fetch(`${BASE}?sign=${sign}&salt=${salt}${token ? `&token=${token}` : ""}${ap}`);
  return r.json();
}

const results = [];
const check = (name, ok, detail) => { results.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) process.exitCode = 1; };

const auth = await call(`&action=auth&usr=${encodeURIComponent(USR)}&company-key=${KEY}`);
check("auth via proxy", auth.err === 0, auth.err === 0 ? `token ok, expire=${auth.dat.expire}s` : JSON.stringify(auth));
if (auth.err !== 0) { console.log(results.join("\n")); process.exit(1); }
const { token, secret } = auth.dat;

const info = await call(`&action=queryPlantInfo&plantid=${PID}`, secret, token);
check("plant info", info.err === 0, `${info.dat?.name} · ${info.dat?.nominalPower} kW · ${info.dat?.address?.city} · status=${info.dat?.status} · tariff=₹${info.dat?.profit?.unitProfit}`);

const sum = await call(`&action=queryPlantCurrentData&plantid=${PID}&par=ENERGY_TODAY,ENERGY_MONTH,ENERGY_YEAR,ENERGY_TOTAL`, secret, token);
const g = (k) => sum.dat?.find((r) => r.key === k)?.val;
check("energy summary", sum.err === 0, `today=${g("ENERGY_TODAY")} month=${g("ENERGY_MONTH")} year=${g("ENERGY_YEAR")} total=${g("ENERGY_TOTAL")} kWh`);

const today = new Date().toISOString().slice(0, 10);
const curve = await call(`&action=queryPlantActiveOuputPowerOneDay&plantid=${PID}&date=${today}`, secret, token);
const pts = curve.dat?.outputPower ?? [];
check("day curve", curve.err === 0 && pts.length === 288, `${pts.length} pts, peak ${Math.max(...pts.map((p) => parseFloat(p.val)))} kW`);

const mp = await call(`&action=queryPlantEnergyMonthPerDay&plantid=${PID}&date=${today.slice(0, 7)}`, secret, token);
check("month per-day", mp.err === 0, `${mp.dat?.perday?.length} days`);

const ym = await call(`&action=queryPlantEnergyYearPerMonth&plantid=${PID}&date=${today.slice(0, 4)}`, secret, token);
check("year per-month", ym.err === 0, `${ym.dat?.permonth?.length} months`);

const warn = await call(`&action=queryPlantWarning&plantid=${PID}&i18n=en_US&page=0&pagesize=100`, secret, token);
const outages = (warn.dat?.warning ?? []).filter((w) => w.code === "0x00000009");
check("warnings", warn.err === 0, `${warn.dat?.warning?.length}/100 fetched (total ${warn.dat?.total}), ${outages.length} grid-outage events on page 0`);

console.log(results.join("\n"));
