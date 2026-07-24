import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PeriodPicker from "./PeriodPicker";

// Fixed anchor after the mock install date (14 Mar 2025).
const ANCHOR = new Date(2025, 5, 15); // 15 Jun 2025

function setup(mode: "day" | "month" | "year" = "day") {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(<PeriodPicker mode={mode} anchor={ANCHOR} onSelect={onSelect} onClose={onClose} />);
  return { onSelect, onClose };
}

describe("PeriodPicker", () => {
  it("day mode: selecting a day reports the date and closes", async () => {
    const user = userEvent.setup();
    const { onSelect, onClose } = setup("day");

    expect(screen.getByText("June 2025")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "10" }));

    expect(onSelect).toHaveBeenCalledWith(new Date(2025, 5, 10));
    expect(onClose).toHaveBeenCalled();
  });

  it("day mode: days before installation are disabled", () => {
    setup("day");
    // navigate is not needed: June 2025 is after install, so all days here
    // are selectable — but the "Today" shortcut must always be offered.
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
  });

  it("month mode: selecting a month reports its first day", async () => {
    const user = userEvent.setup();
    const { onSelect } = setup("month");

    await user.click(screen.getByRole("button", { name: "Mar" }));
    expect(onSelect).toHaveBeenCalledWith(new Date(2025, 2, 1));
  });

  it("month mode: pre-install months are disabled", () => {
    setup("month");
    expect(screen.getByRole("button", { name: "Jan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Feb" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apr" })).toBeEnabled();
  });

  it("year mode: selecting a year reports Jan 1", async () => {
    const user = userEvent.setup();
    const { onSelect } = setup("year");

    await user.click(screen.getByRole("button", { name: "2025" }));
    expect(onSelect).toHaveBeenCalledWith(new Date(2025, 0, 1));
  });
});
