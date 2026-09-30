# TODO.next — Post-Redesign & Pre-Release Plan

> Sidebar workspace landed (`shell.tsx`, 9 pages). Base design language is good.
> Docx generation needs visual parity work next. This file is the pickup list for
> parallel agents. Each task is self-contained with acceptance criteria.
> Keep diffs <400 lines, add a test where noted, run `npm run typecheck && npm test && npm run build`.

---

## Lane 1 — Docx fidelity (highest priority, do first)

### N1 — Rebuild docx smoke preview

**Goal:** see what we currently generate vs the brochure sample.

- Add `npm run docx:smoke` (or `scripts/smoke-docx.mjs`) that builds a 2-machine docx from fixtures
  (use `src/lib/__tests__/fixtures/` or `ro1-live` data) with all sections on, writes to `dist/smoke.docx`.
- Include: cover + TOC, 2 equipments (one with MachPicture), measuring rows, allTrends, fftGallery, ISO.
- Verify in Word/LibreOffice: TOC page numbers update, 2-col FFT grid renders, spec table appears.
  **Done when:** `npm run docx:smoke` produces a docx that unzips and opens without repair warning.

### N2 — Docx visual polish (beyond brochure-fixes)

Brochure is 8 pages; our docx is functional but not pixel-matching. Pick up after N1.

- [ ] Header: replace placeholder (`Project — Date`) with brochure header (`Combined Vibration Report (N machine)` + logo area). Make it omit the cover's first section (cover should have no header).
- [ ] Footer: add version line (`MONITORING SYSTEMS REPORT | Ver 2.32` + page) to match p.4/p.7. Currently `PAGE x / y` only.
- [ ] TOC: dotted leaders + green accent line, per brochure p.4. Currently plain `PAGEREF` table.
- [ ] TOC ordering: verify `description → problems → actions → measuring → trends → fft` shows correctly when only a subset exists (e.g. no schematic, no trends). Test in `brochure-fixes.test.ts`.
- [ ] Cover: replace 3 text templates with at least one ElikaTejarat-style layout (green wave, service icons) as an opt-in template. Keep classic/modern/minimal for now; add `elika` as 4th.
- [ ] Measuring-results density: N1 smoke will show whether single-row-per-point is readable at 5+ points. If not, add pagination or 9-pt font toggle.
      **Depends on:** N1
      **Done when:** smoke docx side-by-side with PDF p.4-p.8 is visually close on header/footer/TOC/FFT.

### N3 — Equipment specs wiring

**Goal:** brochure spec table isn't free-text — it's structured.

- `spectra-catalog.ts` already extracts `Drive Chain / Motor RPM / Bearings / Directions`.
- Ensure `EquipmentWorkspace` auto-fills `specs` from `joinCatalog` when a machine is picked from the Spectra catalog, so the docx spec table path triggers without manual paste.
- Preserve manual `specs` textarea as override.
  **Done when:** picking `HHP-101A` from the catalog auto-populates a colon-separated spec that renders as the Metric/Value table in the docx.

---

## Lane 2 — UI/UX curation (needs your feedback after this)

These are intentionally unstarted — they need feedback/curated data before committing.

### U1 — Curated demo dataset

**Goal:** designers/agents need real-feeling data without a 900MB .sp3.

- Provide a small `public/sample/` with:
  - One 5-row spec CSV (varied points P1-P3, V/H/A, with plausible RMS progression) — can be derived from `ro1-live` fixture.
  - One anonymized multi-machine catalog CSV set (Plant/Machine/Point/Direction) with 2 machines.
  - Screenshots checked into `docs/screenshots/` of the 9 pages on a 1366×768 window.
- Wire onboarding to offer "Load sample" without file picker.
  **Done when:** `npm run dev` → "Load sample" populates Data + Measurements + Details without any upload.

### U2 — UX feedback pass (requires your notes)

**Prompt for you:** once you click through Data → Measurements → Details → Equipment → Findings → Chart → Layout → History, note:

- Which page feels too dense / too empty? (Measuring, Chart and Findings are likely).
- Which empty-state copy is confusing?
- Which RTL strings feel off?
- 1366×768 vs 1920×1080: does the sidebar still feel right? `tauri.conf.json` is now `1280×680`.
  File feedback as issues `UX-01`, `UX-02`, … and link to screenshots. Next agent will take them one-by-one.

### U3 — Feedback telemetry (optional, not tracking)

**Goal:** lightweight local UX signal without PostHog.

- If you want it: add a "Send feedback" textarea in Settings that dumps `page, timestamp, window size` to a local file or clipboard, so you can paste it into an issue during dogfooding. Keep opt-in.

---

## Lane 3 — Feature richness (pick after docx + feedback)

Order by customer value in vibration reporting.

### F1 — Envelope spectrum (bearing diagnosis)

Brochure says "(سایر پارامترها نیز … قابل اضافه شدن)" — envelope is already partly wired (`EnvelopeData` table → `allTrends.envelopePng`).

- UI: expose `envelope` as a per-equipment toggle, include in measuring table zone and docx.
- Ensure `list_envelope_samples` (Rust `mdb.rs`) is called for every linked `.sp3` in `export-card.tsx` (currently only when envelope asked).
  **Done when:** a file with `EnvelopeData` shows an envelope trend column + docx section.

### F2 — Batch / multi-file import

**Goal:** combine several `.sp3` files (e.g. monthly surveys) into one report.

- Allow multiple file drops → merged `CsvRowSummary[]` with a file-origin column.
- Trends automatically span all files (already time-sorted in `groupHistories`).
- Cap at ~50000 rows (existing `ROW_LIST_CAP`).
  **Done when:** dropping 3 CSVs yields a single Measuring table with rows from all three.

### F3 — History comparison & re-report

History currently stores entry metadata. Extend to:

- "Reopen as new report" (load options + equipment + limits).
- Trend comparison: sparkline already in measuring table; add delta (%) vs previous report.
  **Done when:** History entry → Reopen populates form + warns if the source CSV is missing.

### F4 — Export beyond docx

- PDF export (via docx → PDF or direct canvas). Low effort via `docx` + print.
- Excel measuring-results export (one sheet per machine) — customers often want this for their own plots.
  **Done when:** Export card offers `Download .xlsx` beside `Generate .docx`.

### F5 — Bearing database & alarm tuning

- Ship a small bearing fault-frequency table (BPFO/BPFI/BSF/FTF) keyed by bearing type (6213, 6311 etc. already extracted).
- Show expected fault lines as vertical markers on the FFT chart.
- Zone limits editor (`zone-limits.tsx`) already exists; add presets per ISO group.
  **Done when:** selecting a point with bearing `6213` shows its 4 fault lines on `spectra-chart.tsx`.

### F6 — Offline bundle of `mdbtools`

`mdb-export` is still `PATH`-dependent. For shop-floor use, bundle the binary via `tauri-plugin` resources or `sidecar` so raw `.sp3` just works on Windows without `MDB_EXPORT_PATH`.
**Depends on:** platform binaries available. Documented as future in `TODO.md` Learned format.
**Done when:** fresh Windows install drags a raw `.sp3` and succeeds with no PATH setup.

---

## Agent rules

- One task = one branch/PR, <400 lines where possible. Reference the task ID (`N1`, `U1`, `F2`, …) in the PR title.
- Before pushing: `npm run typecheck && npm test && npm run build` + `cargo check` if Rust touched.
- Don't invent `.sp3` format — add fixtures under `src/lib/__tests__/fixtures/` instead.
- Tests: add at least one assertion per docx visual change (unzip + `word/document.xml` contains token). See `brochure-fixes.test.ts` as example.
- Commit this file as you check items off, so other agents see progress.

## Suggested start order (if working solo)

1. **N1 → N2 → N3** (docx must look good before customers see it)
2. U1 (so the next UI pass has data)
3. Then your UX feedback (U2)
4. F1, F5 (bearing/envelope — core value), then F2–F4 as time allows
