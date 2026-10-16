import { describe, expect, it } from "vitest";
import { istStamp } from "@/lib/client/istTime";

describe("istStamp", () => {
  it("shows a UTC instant in Indian Standard Time", () => {
    expect(istStamp("2026-10-16T09:55:00Z")).toBe("2026-10-16 15:25:00");
    expect(istStamp("2026-10-16T09:55:07.123456Z", false)).toBe("2026-10-16 15:25");
  });
  it("rolls over midnight and the date with the +5:30 offset", () => {
    expect(istStamp("2026-12-31T19:00:00Z")).toBe("2027-01-01 00:30:00");
    expect(istStamp("2026-10-16T18:29:59Z")).toBe("2026-10-16 23:59:59");
  });
  it("accepts an instant that already carries an offset", () => {
    expect(istStamp("2026-10-16T15:25:00+05:30")).toBe("2026-10-16 15:25:00");
  });
  it("leaves empty and non-date values alone", () => {
    expect(istStamp(null)).toBe("");
    expect(istStamp(undefined)).toBe("");
    expect(istStamp("not a date")).toBe("not a date");
  });
});
