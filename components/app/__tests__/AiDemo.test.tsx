import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiDemo } from "@/components/app/demo/AiDemo";

const model = (useCase: string, canRun: boolean) => ({
  id: `${useCase}-m`, useCase, name: "Test model", version: "1.0.0", kind: "rules", description: "Transparent rules, not machine learning.",
  limitations: "Small samples.", trainedOn: "Not trained.", status: "registered", canRead: true, canRun,
});
const run = {
  id: "run-1", useCase: "helpdesk-assist", modelVersion: "m@1.0.0", dataVersion: "abc123def456", inputRef: "fees?", confidence: 0.8,
  createdAt: "2026-10-15T09:00:00Z", createdBy: "bee.helpdesk", dispositionCount: 0, latestDecision: null,
  output: { summary: "x", suggestedCategory: "fees", escalateToHuman: false, topAnswers: [], draftReply: "Pay at the gateway.", evidence: [{ source: "ai_kb.id 9", field: "How is the fee?", value: 0.6 }] },
  dispositions: [], audit: [{ action: "run", actor: "bee.helpdesk", role: "helpdesk", detail: "Run computed", at: "2026-10-15T09:00:00Z" }],
};

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("AiDemo", () => {
  const calls: { url: string; body?: string }[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url.endsWith("/ai/models")) return json({ models: ["compliance-risk", "production-anomaly", "rating-trends", "helpdesk-assist", "document-extraction"].map((u) => model(u, true)) });
      if (url.endsWith("/runs") && init?.method === "GET") return json({ runs: [] });
      if (url.endsWith("/runs")) return json(run, 201);
      if (url.endsWith("/disposition")) return json({ error: "validation_failed", detail: "A reason is required to override or reject." }, 400);
      return json({}, 404);
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the persistent banner, the model card and runs a use case with evidence", async () => {
    render(<AiDemo hidden={[]} />);
    fireEvent.click(await screen.findByTestId("ai-tab-helpdesk-assist"));
    expect(screen.getByTestId("ai-model-card").textContent).toContain("not machine learning");
    fireEvent.click(await screen.findByTestId("ai-run"));
    expect(await screen.findByTestId("ai-data-version")).toBeTruthy();
    expect(screen.getByTestId("ai-evidence").textContent).toContain("Helpdesk knowledge base, article 9");
    expect(calls.some((c) => c.url.endsWith("/helpdesk-assist/runs") && c.body?.includes("question"))).toBe(true);
  });

  it("shows the refusal when an override has no reason", async () => {
    render(<AiDemo hidden={[]} />);
    fireEvent.click(await screen.findByTestId("ai-tab-helpdesk-assist"));
    fireEvent.click(await screen.findByTestId("ai-run"));
    fireEvent.click(await screen.findByTestId("ai-decision-override"));
    fireEvent.click(screen.getByTestId("ai-submit-disposition"));
    await waitFor(() => expect(screen.getByTestId("ai-disposition-error").textContent).toContain("reason is required"));
  });
});
