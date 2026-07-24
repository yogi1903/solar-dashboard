// ShineMonitor API connectivity test.
// Usage: node scripts/shinemonitor-test.mjs
// Reads credentials from ../.env — fill in SHINEMONITOR_USR / SHINEMONITOR_PWD first.
//
// Auth flow (per ShineMonitor Open API docs):
//   salt  = current timestamp
//   sign  = SHA1(salt + SHA1(pwd) + "&action=auth&usr=<usr>&company-key=<key>")
//   → returns { token, secret, expire }
// Business calls:
//   sign  = SHA1(salt + secret + "&action=<action>&<params...>")
//   → request includes &token=<token>

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── tiny .env parser (no dependencies) ──────────────────────────
const env = {};
for (const line of readFileSync(join(__dir, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].trim();
}

const USR = env.SHINEMONITOR_USR;
const PWD = env.SHINEMONITOR_PWD;
const KEY = env.SHINEMONITOR_COMPANY_KEY || "bnrl";
const BASE = env.SHINEMONITOR_API_BASE || "http://api.shinemonitor.com/public/";
let PLANT_ID = env.SHINEMONITOR_PLANT_ID;

if (!USR || !PWD) {
  console.error("✗ Fill in SHINEMONITOR_USR and SHINEMONITOR_PWD in .env first.");
  process.exit(1);
}

const sha1 = (s) => createHash("sha1").update(s, "utf8").digest("hex");

async function call(actionParams, secret, token) {
  const salt = Date.now().toString();
  const sign = secret
    ? sha1(salt + secret + token + actionParams) // token is INSIDE the signature
    : sha1(salt + sha1(PWD) + actionParams);
  const tokenParam = token ? `&token=${token}` : "";
  const url = `${BASE}?sign=${sign}&salt=${salt}${tokenParam}${actionParams}`;
  const res = await fetch(url);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { parseError: true, raw: text.slice(0, 300) };
  }
}

const show = (label, obj, maxLen = 600) => {
  const s = JSON.stringify(obj, null, 1);
  console.log(`\n── ${label} ──`);
  console.log(s.length > maxLen ? s.slice(0, maxLen) + " …(truncated)" : s);
};

// ── 1. Authenticate ─────────────────────────────────────────────
console.log(`Authenticating as "${USR}" against ${BASE} (company-key=${KEY}) …`);
const auth = await call(`&action=auth&usr=${encodeURIComponent(USR)}&company-key=${KEY}`);

if (auth.err !== 0) {
  console.error("\n✗ Auth failed:", JSON.stringify(auth));
  process.exit(1);
}
const { token, secret, expire } = auth.dat ?? auth;
console.log(`✓ Auth OK — token acquired (expires in ${expire}s)`);

// ── 2. List plants ──────────────────────────────────────────────
const plants = await call(`&action=queryPlants&page=0&pagesize=100`, secret, token);
show("Plants on this account", plants);

const plantList = plants?.dat?.plant ?? [];
const validIds = new Set(plantList.map((p) => String(p.pid ?? p.plantid)));
if (!PLANT_ID || !validIds.has(String(PLANT_ID))) {
  if (PLANT_ID && !validIds.has(String(PLANT_ID))) {
    console.log(`\n⚠ SHINEMONITOR_PLANT_ID=${PLANT_ID} not in account list — using first plant instead.`);
  }
  PLANT_ID = plantList[0]?.pid ?? plantList[0]?.plantid;
}
if (!PLANT_ID) {
  console.error("\n✗ Could not find a plant ID automatically. Set SHINEMONITOR_PLANT_ID in .env.");
  process.exit(1);
}
console.log(`\nUsing plantid=${PLANT_ID}`);

// ── 3. Sample the data the dashboard needs ──────────────────────
const today = new Date().toISOString().slice(0, 10);

show("Plant info", await call(`&action=queryPlantInfo&plantid=${PLANT_ID}`, secret, token), 800);
show("Summary (today/month/year/total)", await call(`&action=queryPlantCurrentData&plantid=${PLANT_ID}&par=ENERGY_TODAY,ENERGY_MONTH,ENERGY_YEAR,ENERGY_TOTAL`, secret, token), 800);
show("Day power curve", await call(`&action=queryPlantActiveOuputPowerOneDay&plantid=${PLANT_ID}&date=${today}`, secret, token), 900);
show("Daily energy this month", await call(`&action=queryPlantEnergyMonthPerDay&plantid=${PLANT_ID}&date=${today.slice(0, 7)}`, secret, token), 800);
show("Alarms (outage source)", await call(`&action=queryPlantWarning&plantid=${PLANT_ID}&i18n=en_US&page=0&pagesize=5`, secret, token), 900);

console.log("\n✓ Connectivity test complete.");
