// Verify plant 1207966 owns datalogger Q0030398977037, then pull its real data.
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
const USR = env.SHINEMONITOR_USR,
  PWD = env.SHINEMONITOR_PWD;
const KEY = env.SHINEMONITOR_COMPANY_KEY || "bnrl_frRFjEz8Mkn";
const BASE = env.SHINEMONITOR_API_BASE || "http://api.shinemonitor.com/public/";
const PID = "1207966";

const sha1 = (s) => createHash("sha1").update(s, "utf8").digest("hex");
async function call(actionParams, secret, token) {
  const salt = Date.now().toString();
  const sign = secret
    ? sha1(salt + secret + token + actionParams)
    : sha1(salt + sha1(PWD) + actionParams);
  const res = await fetch(
    `${BASE}?sign=${sign}&salt=${salt}${token ? `&token=${token}` : ""}${actionParams}`
  );
  return JSON.parse(await res.text());
}

const auth = await call(`&action=auth&usr=${encodeURIComponent(USR)}&company-key=${KEY}`);
const { token, secret } = auth.dat;

// Try the plausible device-list actions; keep whichever works
for (const action of ["queryDevices", "queryPlantDevice", "queryCollectorList"]) {
  const r = await call(`&action=${action}&plantid=${PID}`, secret, token);
  console.log(`── ${action} → err=${r.err} ${r.desc}`);
  if (r.err === 0) console.log(JSON.stringify(r.dat).slice(0, 900));
}
