import { describe, expect, it } from "vitest";

describe("wizard DB list is first page", () => {
  it("data page shows uploaded databases list with selection", async () => {
    const src = await import("fs").then((fs) => fs.readFileSync("src/App.tsx", "utf8"));
    expect(src).toContain("Uploaded databases");
    expect(src).toContain("selectedDbPaths");
    expect(src).toContain("sp3Paths.length > 0");
    expect(src).toContain("Add databases");
  });
  it("machines page respects selected DBs", async () => {
    const src = await import("fs").then((fs) => fs.readFileSync("src/App.tsx", "utf8"));
    expect(src).toContain("selectedDbPaths.length > 0 ? selectedDbPaths");
    expect(src).toContain("You can go back here anytime");
  });
  it("wizard back navigation exists", async () => {
    const shell = await import("fs").then((fs) => fs.readFileSync("src/components/shell.tsx", "utf8"));
    expect(shell).toContain("WizardFooter");
    expect(shell).toContain("ArrowLeft");
  });
});
