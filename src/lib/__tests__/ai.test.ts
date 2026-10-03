import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { draftReport, fallbackDraft, type AiDraftInput } from "../ai";

vi.mock("../license", () => ({
  getHostedRequestAuth: vi.fn(),
  getControlPlaneUrl: vi.fn().mockResolvedValue("http://127.0.0.1:8787"),
  signHostedRequest: vi.fn(),
}));
import { getHostedRequestAuth, signHostedRequest } from "../license";

function input(over?: Partial<AiDraftInput>): AiDraftInput {
  return {
    meta: { filename: "data.csv", source: "spec-csv" },
    spectra: [
      { freq: 1, amp: 0.1 },
      { freq: 2, amp: 0.5 },
    ],
    options: {
      projectName: "Elika",
      engineer: "A. Chan",
      reportDate: "2026-09-30",
      units: "mm/s",
      norm: "Default",
      notes: "field notes",
    },
    stats: {
      spectra_points: 2,
      freq_min: 1,
      freq_max: 2,
      amp_min: 0.1,
      amp_max: 0.5,
      peak: { freq: 2, amp: 0.5 },
    },
    ...over,
  } as AiDraftInput;
}

describe("fallbackDraft", () => {
  it("fills all five sections offline", () => {
    const d = fallbackDraft(input());
    expect(Object.keys(d)).toEqual([
      "summary",
      "methodology",
      "observations",
      "recommendations",
      "conclusion",
    ]);
    for (const v of Object.values(d)) expect(v.length).toBeGreaterThan(10);
    expect(d.summary).toMatch(/Elika/);
    expect(d.summary).toMatch(/peak/i);
  });

  it("mentions synthetic source in observations", () => {
    const d = fallbackDraft(input({ meta: { filename: "x.sp3", source: "synthetic" } }));
    expect(d.observations.toLowerCase()).toMatch(/synthetic/);
  });
});

describe("draftReport", () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.fetch = origFetch;
  });

  it("returns fallback when no hosted entitlement (zero network)", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    vi.mocked(getHostedRequestAuth).mockResolvedValue(null);
    const r = await draftReport(input());
    expect(r.usedFallback).toBe(true);
    expect(r.draft.summary).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it("times out and falls back without hanging", async () => {
    vi.mocked(getHostedRequestAuth).mockResolvedValue({
      activationId: "act_test",
      headers: { Authorization: "Bearer test" },
    });
    vi.mocked(signHostedRequest).mockResolvedValue("signature");
    globalThis.fetch = ((_: string, opts?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        );
      })) as unknown as typeof fetch;
    const p = draftReport(input(), { timeoutMs: 30 });
    await vi.advanceTimersByTimeAsync(40);
    const r = await p;
    expect(r.usedFallback).toBe(true);
    expect(r.warning).toMatch(/timed out|unavailable/i);
  });

  it("uses fallback when API returns non-JSON", async () => {
    vi.mocked(getHostedRequestAuth).mockResolvedValue({
      activationId: "act_test",
      headers: { Authorization: "Bearer test" },
    });
    vi.mocked(signHostedRequest).mockResolvedValue("signature");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: "not a draft" }),
    } as unknown as Response);
    const r = await draftReport(input());
    expect(r.usedFallback).toBe(true);
  });

  it("parses valid JSON from model response", async () => {
    vi.mocked(getHostedRequestAuth).mockResolvedValue({
      activationId: "act_test",
      headers: { Authorization: "Bearer test" },
    });
    vi.mocked(signHostedRequest).mockResolvedValue("signature");
    const draft = {
      summary: "s",
      methodology: "m",
      observations: "o",
      recommendations: "r",
      conclusion: "c",
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ draft }),
    } as unknown as Response);
    const r = await draftReport(input());
    expect(r.usedFallback).toBe(false);
    expect(r.draft).toEqual(draft);
  });
});
