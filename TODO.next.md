# Desktop report and DOCX backlog

This is the desktop-only backlog. It does not describe the Go website,
payments, customer accounts, or deployment.

## Highest priority: inspect a real generated report

Add a small DOCX smoke command using the existing fixtures. Include a cover,
table of contents, two machines, measuring rows, trends, FFT content, and ISO
results. Open the result in Word or LibreOffice and record whether it opens
without repair warnings. Keep the fixture and command local and reproducible.

## DOCX fidelity

- Match the brochure header and footer while keeping the cover header-free.
- Add the brochure version line and page numbering.
- Improve the table-of-contents leaders and accent treatment.
- Verify section ordering when optional sections are absent.
- Add an opt-in ElikaTejarat-style cover while preserving existing templates.
- Check measuring-table density with five or more points.

## Structured equipment data

Wire the existing spectra catalog fields into the equipment workspace so that
motor RPM, bearings, drive chain, and directions populate the DOCX specification
table. Preserve the manual specification override.

## Import and analysis improvements

- Ship a small, anonymized sample dataset and a “Load sample” onboarding path.
- Support multiple `.sp3`/CSV imports with a clear file-origin column.
- Add history reopen and comparison against a previous report.
- Expose envelope spectra and bearing fault-frequency markers where the source
  data contains them.
- Consider Excel/PDF export only after DOCX output is reliable.
- Bundle `mdb-export` per platform when licensing and distribution allow it.

## UX review

After loading real or curated sample data, review Data, Measurements, Details,
Equipment, Findings, Chart, Layout, and History at 1280×680 and 1920×1080.
Record concrete issues with screenshots or reproduction steps before changing
the visual language.

## Desktop verification

```text
npm run typecheck
npm test -- --run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml -q
```

DOCX opening, native file dialogs, MDB tools, and passkey/keychain behavior need
separate desktop checks; a TypeScript or Rust test does not prove those paths.
