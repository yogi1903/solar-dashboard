import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("joins truthy class names", () => {
    expect(cn("a", false, undefined, "b")).toBe("a b");
  });

  it("lets later tailwind classes win conflicts", () => {
    expect(cn("p-2 text-left", "p-4")).toBe("text-left p-4");
  });
});
