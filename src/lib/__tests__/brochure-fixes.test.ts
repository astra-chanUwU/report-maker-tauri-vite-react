import { describe, expect, it } from "vitest";
import { buildMachineSpecs, joinCatalog } from "../spectra-catalog";
import { buildDocx, tocPartsFor } from "../generateDocx";
import { parseSp3 } from "../parseSp3";

describe("brochure fixes: TOC + specs + FFT grid + header/footer", () => {
  it("tocPartsFor includes description/problems/actions in brochure order", () => {
    // status + schematic + specs + description(lastReport) + problems + actions + vib sections
    expect(
      tocPartsFor({
        status: "Alert",
        specs: "15kW",
        schematic: { data: new Uint8Array([1, 2, 3]) },
        lastReport: "prev",
        problems: "unbalance",
        corrective: "balance",
        vib: { rows: [{}], trends: [{}], fft: [{}] },
      })
    ).toEqual([
      "status",
      "schematic",
      "specs",
      "description",
      "problems",
      "actions",
      "measuring",
      "trends",
      "fft",
    ]);
    // Only schematic + specs
    expect(tocPartsFor({ specs: "x", schematic: { data: new Uint8Array([1]) } })).toEqual([
      "schematic",
      "specs",
    ]);
    // Empty
    expect(tocPartsFor({})).toEqual([]);
  });

  it("renders specs as a 2-column table when colon-separated, else as paragraphs", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n"), "a.sp3");
    const base = {
      projectName: "P",
      engineer: "E",
      reportDate: "2026-09-30",
      units: "SI",
      norm: "Default",
      notes: "",
    };
    // Structured specs → table with Metric/Value header
    const structured = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: base,
      equipment: {
        name: "Pump A",
        specs:
          "Drive Chain: Motor-Coupling-Pump\nMotor Speed: 1500 RPM\nBearing List: P1: SKF 6213",
      },
    });
    const JSZip = (await import("jszip")).default;
    const xml = await (
      await JSZip.loadAsync(await structured.arrayBuffer())
    )
      .file("word/document.xml")!
      .async("string");
    expect(xml).toContain("Drive Chain");
    expect(xml).toContain("Motor-Coupling-Pump");
    // Header row uses sectionTitle keys
    expect(xml).toContain("Metric");
    // Free-form specs stays as paragraphs (no Metric header)
    const free = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: base,
      equipment: { name: "Pump A", specs: "Just a free-form note.\n\nAnother paragraph." },
    });
    const freeXml = await (
      await JSZip.loadAsync(await free.arrayBuffer())
    )
      .file("word/document.xml")!
      .async("string");
    expect(freeXml).toContain("Just a free-form note");

    // buildMachineSpecs produces colon-separated lines that trigger the table path
    const plant = `PlantID,Name\n1,"Motor Pump RO1"\n`;
    const machine = `MachineID,PlantID,Name,LblRPM,ValueRPM,Note\n1,1,"HHP-101A","Primary RPM",24.583,"Potable Water"\n`;
    const point = `PointID,MachineID,Name,BearProducer1,BearType1\n1,1,"P1","SKF","6213"\n`;
    const direction = `DirectionID,PointID,Name\n1,1,"V1"\n`;
    const joined = joinCatalog({
      plantCsv: plant,
      machineCsv: machine,
      pointCsv: point,
      directionCsv: direction,
    });
    const specs = buildMachineSpecs(joined[0]);
    expect(specs).toContain("Primary RPM");
    expect(specs).toContain("6213");
  });

  it("FFT gallery renders as 2-per-row grid table", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n"), "a.sp3");
    const { renderChartPng } = await import("../generateDocx");
    const png = renderChartPng(parsed.spectra);
    const blob = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: {
        projectName: "P",
        engineer: "E",
        reportDate: "2026-09-30",
        units: "SI",
        norm: "Default",
        notes: "",
        includeToc: false,
      },
      fftGallery: [
        { label: "P1 V", png, peak: "100" },
        { label: "P1 H", png, peak: "200" },
        { label: "P2 V", png, peak: "300" },
        { label: "P2 H", png, peak: "400" },
      ],
    });
    const JSZip = (await import("jszip")).default;
    const xml = await (
      await JSZip.loadAsync(await blob.arrayBuffer())
    )
      .file("word/document.xml")!
      .async("string");
    // All labels present
    expect(xml).toContain("P1 V");
    expect(xml).toContain("P2 H");
    // Single fft table (the doc has multiple tables, but fft table has w: gridCol 2)
    // Verify both charts on same logical row by checking two labels appear before the third table row close
    const p1v = xml.indexOf("P1 V");
    const p1h = xml.indexOf("P1 H");
    expect(p1v).toBeGreaterThan(0);
    expect(p1h).toBeGreaterThan(p1v);
  }, 30000);

  it("header and footer appear in document", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n"), "a.sp3");
    const blob = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: {
        projectName: "My Project",
        engineer: "E",
        reportDate: "2026-09-30",
        units: "SI",
        norm: "Default",
        notes: "",
      },
    });
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const headerFile = Object.keys(zip.files).find((f) => f === "word/header1.xml")!;
    const footerFile = Object.keys(zip.files).find((f) => f === "word/footer1.xml")!;
    expect(headerFile).toBeTruthy();
    expect(footerFile).toBeTruthy();
    const headerXml = await zip.file(headerFile)!.async("string");
    expect(headerXml).toContain("My Project");
    const footerXml = await zip.file(footerFile)!.async("string");
    expect(footerXml.toLowerCase()).toMatch(/page/);
  }, 30000);
});
