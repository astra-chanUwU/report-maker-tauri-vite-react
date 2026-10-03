import { describe, expect, it } from "vitest";

describe("ux cleanup", () => {
  it("top nav has no Generate button", async () => {
    const src = await import("fs").then((fs) => fs.readFileSync("src/App.tsx", "utf8"));
    expect(src).not.toMatch(/Toolbar[\s\S]*ExportControls[\s\S]*<\/Toolbar>/);
    expect(src).toContain('className="hidden"');
    expect(src).toContain("ExportControls");
  });
  it("toast is centered", async () => {
    const src = await import("fs").then((fs) => fs.readFileSync("src/components/ui/sonner.tsx", "utf8"));
    expect(src).toContain('position="top-center"');
    expect(src).not.toContain("bottom-right");
  });
  it("machine picker middle select is removed", async () => {
    const src = await import("fs").then((fs) => fs.readFileSync("src/components/machine-picker.tsx", "utf8"));
    expect(src).not.toContain("Select all with data");
    expect(src).toContain("Other databases");
  });
});
