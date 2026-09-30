import { describe, expect, it } from "vitest";
import { defaultBranding, hasStoredBranding, loadBranding, saveBranding } from "../settings";

describe("branding storage (logo / cover / signature)", () => {
  it("defaults to empty branding", () => {
    expect(defaultBranding()).toEqual({
      logoBase64: null,
      coverBase64: null,
      signatureBase64: null,
    });
    // vitest has no localStorage → falls back to defaults
    expect(loadBranding()).toEqual(defaultBranding());
    expect(hasStoredBranding()).toBe(false);
  });

  it("round-trips all three assets", () => {
    saveBranding({ logoBase64: "bG9nbw==", coverBase64: "Y292ZXI=", signatureBase64: "c2ln" });
    expect(hasStoredBranding()).toBe(true);
    expect(loadBranding()).toEqual({
      logoBase64: "bG9nbw==",
      coverBase64: "Y292ZXI=",
      signatureBase64: "c2ln",
    });
    saveBranding(defaultBranding());
  });

  it("repairs legacy single-field payloads", () => {
    saveBranding({ logoBase64: "bG9nbw==" } as unknown as Parameters<typeof saveBranding>[0]);
    expect(loadBranding()).toEqual({
      logoBase64: "bG9nbw==",
      coverBase64: null,
      signatureBase64: null,
    });
    saveBranding(defaultBranding());
  });
});
