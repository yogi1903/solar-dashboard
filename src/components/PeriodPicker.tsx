import { useState } from "react";
import { INSTALL_DATE, MONTH_SHORT, MONTH_LONG } from "@/lib/data";

// Fitness-app style period picker — a bottom sheet that adapts to the
// active view: calendar grid for days, month grid for months, year list
// for years. Future and pre-installation periods are disabled.

const INK = "#0d201d";
const FAINT = "#a8b0ac";
const DEEP_GOLD = "#8a6826";
const PALE_GOLD = "#f4ead4";
const BORDER = "#e8e4d8";
const DISPLAY = "'Bricolage Grotesque', Inter, sans-serif";

export type PickerMode = "day" | "month" | "year";

interface Props {
  mode: PickerMode;
  anchor: Date;
  onSelect: (d: Date) => void;
  onClose: () => void;
}

export default function PeriodPicker({ mode, anchor, onSelect, onClose }: Props) {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const installStart = new Date(INSTALL_DATE.getFullYear(), INSTALL_DATE.getMonth(), 1);

  // Navigation cursor inside the sheet (independent of anchor until selection)
  const [view, setView] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));

  const pick = (d: Date) => {
    onSelect(d);
    onClose();
  };

  const navBtn = (dir: -1 | 1, disabled: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 w-9 items-center justify-center rounded-full border bg-white text-[16px] disabled:opacity-25"
      style={{ borderColor: BORDER, color: INK }}
    >
      {dir === -1 ? "‹" : "›"}
    </button>
  );

  let body: React.ReactNode = null;
  let header: React.ReactNode = null;

  if (mode === "day") {
    const y = view.getFullYear();
    const m = view.getMonth();
    const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const canPrev = new Date(y, m - 1, 1) >= installStart || (y === installStart.getFullYear() && m > installStart.getMonth());
    const canNext = m < today.getMonth() || y < today.getFullYear();

    header = (
      <div className="flex items-center justify-between mb-4">
        {navBtn(-1, !canPrev, () => setView(new Date(y, m - 1, 1)))}
        <p className="text-[16px] font-semibold" style={{ fontFamily: DISPLAY }}>{MONTH_LONG[m]} {y}</p>
        {navBtn(1, !canNext, () => setView(new Date(y, m + 1, 1)))}
      </div>
    );

    const cells: React.ReactNode[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(<div key={`e${i}`} />);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(y, m, d);
      const disabled = date > todayStart || date < new Date(INSTALL_DATE.getFullYear(), INSTALL_DATE.getMonth(), INSTALL_DATE.getDate());
      const selected = date.toDateString() === anchor.toDateString();
      const isToday = date.toDateString() === today.toDateString();
      cells.push(
        <button
          key={d}
          disabled={disabled}
          onClick={() => pick(date)}
          className="flex h-10 items-center justify-center rounded-full text-[14px] transition-colors"
          style={{
            background: selected ? INK : "transparent",
            color: disabled ? FAINT : selected ? "#fff" : isToday ? DEEP_GOLD : INK,
            fontWeight: selected || isToday ? 600 : 400,
          }}
        >
          {d}
        </button>
      );
    }
    body = (
      <>
        <div className="grid grid-cols-7 mb-1">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <p key={i} className="text-center text-[11px] font-medium" style={{ color: FAINT }}>{d}</p>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">{cells}</div>
      </>
    );
  } else if (mode === "month") {
    const y = view.getFullYear();
    const canPrev = y > installStart.getFullYear();
    const canNext = y < today.getFullYear();
    header = (
      <div className="flex items-center justify-between mb-4">
        {navBtn(-1, !canPrev, () => setView(new Date(y - 1, 0, 1)))}
        <p className="text-[16px] font-semibold" style={{ fontFamily: DISPLAY }}>{y}</p>
        {navBtn(1, !canNext, () => setView(new Date(y + 1, 0, 1)))}
      </div>
    );
    body = (
      <div className="grid grid-cols-3 gap-2">
        {MONTH_SHORT.map((name, m) => {
          const future = y === today.getFullYear() && m > today.getMonth();
          const beforeInstall = y === installStart.getFullYear() && m < installStart.getMonth();
          const disabled = future || beforeInstall;
          const selected = y === anchor.getFullYear() && m === anchor.getMonth();
          return (
            <button
              key={name}
              disabled={disabled}
              onClick={() => pick(new Date(y, m, 1))}
              className="rounded-full py-2.5 text-[14px] transition-colors"
              style={{
                background: selected ? INK : disabled ? "transparent" : "#f7f5ee",
                color: disabled ? FAINT : selected ? "#fff" : INK,
                fontWeight: selected ? 600 : 500,
              }}
            >
              {name}
            </button>
          );
        })}
      </div>
    );
  } else {
    const years: number[] = [];
    for (let y = today.getFullYear(); y >= installStart.getFullYear(); y--) years.push(y);
    header = <p className="text-[16px] font-semibold mb-4 text-center" style={{ fontFamily: DISPLAY }}>Select year</p>;
    body = (
      <div className="space-y-2">
        {years.map((y) => {
          const selected = y === anchor.getFullYear();
          return (
            <button
              key={y}
              onClick={() => pick(new Date(y, 0, 1))}
              className="w-full rounded-[14px] py-3 text-[15px] transition-colors"
              style={{
                background: selected ? INK : "#f7f5ee",
                color: selected ? "#fff" : INK,
                fontWeight: selected ? 600 : 500,
                fontFamily: DISPLAY,
              }}
            >
              {y}
            </button>
          );
        })}
      </div>
    );
  }

  const currentLabel =
    mode === "day" ? "Today" : mode === "month" ? "This month" : "This year";
  const jumpToCurrent = () => {
    if (mode === "day") pick(new Date(todayStart));
    else if (mode === "month") pick(new Date(today.getFullYear(), today.getMonth(), 1));
    else pick(new Date(today.getFullYear(), 0, 1));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(13,32,29,0.35)" }} />
      <div
        className="relative w-full max-w-md rounded-t-[24px] bg-white p-5 pb-8 shadow-[0_-8px_40px_rgba(13,32,29,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full" style={{ background: BORDER }} />
        {header}
        {body}
        <button
          onClick={jumpToCurrent}
          className="mt-5 w-full rounded-full py-3 text-[14px] font-semibold"
          style={{ background: PALE_GOLD, color: DEEP_GOLD }}
        >
          {currentLabel}
        </button>
      </div>
    </div>
  );
}
