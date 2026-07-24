// Locate the API `pid` for a plant shown in the web UI as "power station id".
// Usage: node scripts/find-plant.mjs [stationId] [dataloggerPn]

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(join(__dir, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !line.trim().startsWith("#")) env[m[1]] = m[2];
}
const USR = env.SHINEMONITOR_USR;
const PWD = env.SHINEMONITOR_PWD;
const KEY = env.SHINEMONITOR_COMPANY_KEY || "bnrl_frRFjEz8Mkn";
const BASE = env.SHINEMONITOR_API_BASE || "http://api.shinemonitor.com/public/";
const WANT_ID = process.argv[2] || env.SHINEMONITOR_PLANT_ID || "11207966";
const WANT_PN = process.argv[3] || "Q0030398977037";

const sha1 = (s) => createHash("sha1").update(s, "utf8").digest("hex");
async function call(actionParams, secret, token) {
  const salt = Date.now().toString();
  const sign = secret
    ? sha1(salt + secret + token + actionParams)
    : sha1(salt + sha1(PWD) + actionParams);
  const tokenParam = token ? `&token=${token}` : "";
  const res = await fetch(`${BASE}?sign=${sign}&salt=${salt}${tokenParam}${actionParams}`);
  return JSON.parse(await res.text());
}

const auth = await call(`&action=auth&usr=${encodeURIComponent(USR)}&company-key=${KEY}`);
if (auth.err !== 0) {
  console.error("Auth failed:", JSON.stringify(auth));
  process.exit(1);
}
const { token, secret } = auth.dat;

// Pull every plant (pagesize 100 covers all 65)
const all = await call(`&action=queryPlants&page=0&pagesize=100`, secret, token);
const plants = all?.dat?.plant ?? [];
console.log(`total=${all?.dat?.total} fetched=${plants.length}\n`);

const raw = JSON.stringify(all);
console.log(`"${WANT_ID}" appears in plant-list payload: ${raw.includes(WANT_ID)}`);
console.log(`"${WANT_PN}" appears in plant-list payload: ${raw.includes(WANT_PN)}\n`);

console.log("pid      | status | name");
console.log("---------+--------+-------------------------------");
for (const p of plants) {
  console.log(`${String(p.pid).padEnd(8)} | ${String(p.status).padEnd(6)} | ${p.name}`);
}

// Maybe the API accepts the web station id directly?
console.log(`\n── Trying queryPlantInfo&plantid=${WANT_ID} directly ──`);
const direct = await call(`&action=queryPlantInfo&plantid=${WANT_ID}`, secret, token);
console.log(JSON.stringify(direct).slice(0, 400));
