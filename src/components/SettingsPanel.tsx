import { useState } from "react";
import { toast } from "sonner";
import { SYSTEM_KWP, INSTALL_DATE, fmtDate, fmtRs } from "@/lib/data";

// Settings tab — customer-editable tariff (drives all ₹ savings numbers)
// plus read-only system information.

const INK = "#0d201d";
const MUTED = "#5a6e6a";
const FAINT = "#71807d";
const DEEP_GOLD = "#8a6826";
const PALE_GOLD = "#f4ead4";
const TEAL = "#237a6e";
const BORDER = "#e8e4d8";
const DISPLAY = "'Bricolage Grotesque', Inter, sans-serif";

interface Props {
  tariff: number;
  onTariffChange: (t: number) => void;
}

export default function SettingsPanel({ tariff, onTariffChange }: Props) {
  const [draft, setDraft] = useState(tariff.toString());
  const [savedFlash, setSavedFlash] = useState(false);

  const parsed = parseFloat(draft);
  const valid = !isNaN(parsed) && parsed > 0 && parsed < 100;
  const dirty = valid && parsed !== tariff;

  function save() {
    if (!dirty) return;
    onTariffChange(parsed);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
    toast.success("Tariff saved");
  }

  return (
    <div className="space-y-4">
      {/* Tariff */}
      <div className="bg-white rounded-[18px] shadow-[0_2px_14px_rgba(13,32,29,0.05)] border p-5" style={{ borderColor: BORDER }}>
        <p className="text-[12px] font-medium tracking-wide" style={{ color: MUTED }}>Your electricity tariff</p>
        <p className="mt-1 text-[13px] leading-snug" style={{ color: FAINT }}>
          We use this to convert every kWh your plant generates into rupees saved. Check your latest electricity bill
          for your per-unit rate.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <div
            className="flex flex-1 items-center rounded-[14px] border px-4 py-3 focus-within:ring-2"
            style={{ borderColor: dirty ? DEEP_GOLD : BORDER, ["--tw-ring-color" as string]: PALE_GOLD }}
          >
            <span className="text-[18px] font-medium mr-1" style={{ color: MUTED }}>₹</span>
            <input
              data-testid="tariff-input"
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full bg-transparent text-[20px] font-medium tracking-tight outline-none"
              style={{ fontFamily: DISPLAY, color: INK }}
              aria-label="Tariff in rupees per kWh"
            />
            <span className="text-[13px] whitespace-nowrap" style={{ color: FAINT }}>/ kWh</span>
          </div>
          <button
            data-testid="tariff-save-button"
            onClick={save}
            disabled={!dirty}
            className="rounded-full px-5 py-3 text-[14px] font-semibold text-white active:scale-[0.98] transition-transform duration-150 disabled:opacity-30"
            style={{ background: savedFlash ? TEAL : INK }}
          >
            {savedFlash ? "Saved ✓" : "Save"}
          </button>
        </div>
        {!valid && draft !== "" && (
          <p className="mt-2 text-[12px]" style={{ color: "#b3241a" }}>Enter a valid rate between 0 and 100.</p>
        )}
        <p className="mt-3 text-[12px]" style={{ color: FAINT }}>
          Currently applied: {fmtRs(tariff)} per kWh · changes apply to all views and reports instantly.
        </p>
      </div>

      {/* System info (read-only) */}
      <div className="bg-white rounded-[18px] shadow-[0_2px_14px_rgba(13,32,29,0.05)] border p-5" style={{ borderColor: BORDER }}>
        <p className="text-[12px] font-medium tracking-wide mb-3" style={{ color: MUTED }}>Your system</p>
        <div className="space-y-3">
          {[
            ["Capacity", `${SYSTEM_KWP} kW rooftop`],
            ["Installed", fmtDate(INSTALL_DATE)],
            ["Location", "Rajkot, Gujarat"],
            ["Inverter", "Growatt MIN 5000TL-X"],
            ["Monitoring", "ShineMonitor · live"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <span className="text-[14px]" style={{ color: MUTED }}>{k}</span>
              <span className="text-[14px] font-medium" style={{ color: INK }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Support */}
      <div className="bg-white rounded-[18px] shadow-[0_2px_14px_rgba(13,32,29,0.05)] border p-5" style={{ borderColor: BORDER }}>
        <p className="text-[12px] font-medium tracking-wide mb-3" style={{ color: MUTED }}>Support</p>
        <div className="space-y-3">
          {[
            ["Service helpline", "1800-XXX-XXXX"],
            ["WhatsApp support", "+91 98XXX XXXXX"],
            ["App version", "1.0.0"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <span className="text-[14px]" style={{ color: MUTED }}>{k}</span>
              <span className="text-[14px] font-medium" style={{ color: TEAL }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="px-1 pt-1 text-center text-[12px]" style={{ color: FAINT }}>
        Greentek India Limited · alliance.greentekindia.co.in
      </p>
    </div>
  );
}
