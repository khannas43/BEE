import { describe, expect, it } from "vitest";
import { citiesForState, defaultCityForState } from "../indiaLocations";

describe("indiaLocations", () => {
  it("lists multiple cities for Maharashtra", () => {
    expect(citiesForState("Maharashtra")).toContain("Pune");
    expect(citiesForState("Maharashtra").length).toBeGreaterThan(1);
  });

  it("falls back to a capital for states without an extended list", () => {
    expect(citiesForState("Sikkim")).toEqual(["Gangtok"]);
  });

  it("defaultCityForState picks the first city in the list", () => {
    expect(defaultCityForState("Maharashtra")).toBe("Pune");
  });
});
