import { describe, expect, it, beforeEach } from "vitest";
import { FIXTURE_APPLICATION_IDS } from "../fixtureSeed";
import { createFixtureManufacturerOnboardingClient, resetManufacturerOnboardingFixture } from "../fixtureClient";
import { observationWindowFromApproval, phaseAfterHoldResolved } from "../observation";

describe("manufacturer onboarding observation", () => {
  beforeEach(() => resetManufacturerOnboardingFixture());

  it("automatic activation sets observation end to activation + 15 calendar days", async () => {
    const client = createFixtureManufacturerOnboardingClient();
    const updated = await client.getApplication(FIXTURE_APPLICATION_IDS.director);
    const window = observationWindowFromApproval(updated.activatedAt!);
    expect(updated.observationStartedAt).toBe(window.observationStartedAt);
    expect(updated.observationEndsAt).toBe(window.observationEndsAt);
  });

  it("resolve before observation deadline returns active_observation", async () => {
    const holdId = FIXTURE_APPLICATION_IDS.hold;
    const ends = (await createFixtureManufacturerOnboardingClient().getApplication(holdId)).observationEndsAt!;
    const beforeEnd = new Date(ends).getTime() - 86400000;
    const client = createFixtureManufacturerOnboardingClient({
      nowIso: () => new Date(beforeEnd).toISOString(),
      nowMs: () => beforeEnd,
      actor: () => ({ username: "bee.director", effectiveRoles: [{ role: "director" }] }),
    });
    const updated = await client.directorResolve({ applicationId: holdId, version: 1, note: "Cleared before deadline." });
    expect(updated.phase).toBe("active_observation");
    expect(phaseAfterHoldResolved(ends, beforeEnd)).toBe("active_observation");
  });

  it("resolve on or after observation deadline returns active", async () => {
    const holdId = FIXTURE_APPLICATION_IDS.hold;
    const ends = (await createFixtureManufacturerOnboardingClient().getApplication(holdId)).observationEndsAt!;
    const afterEnd = new Date(ends).getTime() + 1000;
    const client = createFixtureManufacturerOnboardingClient({
      nowIso: () => new Date(afterEnd).toISOString(),
      nowMs: () => afterEnd,
      actor: () => ({ username: "bee.director", effectiveRoles: [{ role: "director" }] }),
    });
    const updated = await client.directorResolve({ applicationId: holdId, version: 1, note: "Cleared after observation ended." });
    expect(updated.phase).toBe("active");
    expect(phaseAfterHoldResolved(ends, afterEnd)).toBe("active");
  });
});
