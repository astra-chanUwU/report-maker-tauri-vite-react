# CURSOR_REPORT — main landing (C00–C12)

**Model:** Grok 4.5 High  
**Date:** 2026-10-05  
**Integrate tip pushed:** `origin/integrate/control-plane` @ **`3af5c80`**  
**main tip:** `origin/main` @ **`ebeb5cd`** (control-plane merge `03a71b7`)  

## Landing status

- **C00–C04, C06–C10, C12 product work:** on integrate and merged to `main`.
- **C05:** Go CI content ready in repo root `ci-go.yml.new` (separate
  `frontend-rust` + `go` jobs; Go from `server/go.mod`; `go test`/`go vet`; no
  `-race`). Applying to `.github/workflows/ci.yml` on origin is **blocked** —
  OAuth App lacks `workflow` scope (`git push` and `gh api` Contents PUT both
  rejected). Owner must apply `ci-go.yml.new` → `.github/workflows/ci.yml` with a
  token that has `workflow` scope.
- **C09:** done on integrate (admin support console); stale TODO tips are wrong.
- **C11:** still open — no live VPS restore/HTTPS evidence.

## Known blockers (unchanged)

1. Browser passkey enrollment/login on final RP ID/origin — unverified.
2. Live ZarinPal / email / SMS providers — no owner credentials.
3. VPS deploy + backup→restore + HTTPS proof (C11).
4. C05 workflow file not yet on `origin` under `.github/workflows/` (see above).

## Local validation (2026-10-05)

```
cd server
# Go: C:\Program Files\Go\bin ; GOPROXY=https://goproxy.io,https://goproxy.cn,direct ; GOSUMDB=off
go test ./... -count=1 -timeout 180s   # ok
go vet ./...                           # exit 0
```

---

# CURSOR_REPORT - C12 final review (integrate tip)

**Model:** Grok 4.5 High  
**Branch:** `feat/c12-final-review` @ **`fdf52f1`** (pushed)  
**Base / integrate tip reviewed:** `origin/integrate/control-plane` @ **`a2f2f03`**  
**Date:** 2026-10-04  
**main:** **merged 2026-10-05** (see landing section above)

Historical slice notes (`CURSOR_REPORT_C0*.md`, `CURSOR_REPORT_S0*.md`) are
superseded for **integration status** by this file. Keep them only as
per-slice archaeology.

## 1. Slice and outcome

C12 audited the current integrate tip, aligned docs with the real Go routes /
env / schema, cleared stale TODO and report claims, verified fixture artifact
checksums, and recorded a classified validation matrix.

**Not claimed:** production readiness, live ZarinPal/email/SMS success, browser
passkey enrollment, VPS backup/restore, or desktop interoperability against a
production host.

**Still open before a responsible `main` merge:** C05 (Go CI), C09 (admin
support console), C10 (marketing/UX polish + browser journey), C11 (VPS deploy
+ restore evidence). At C12 freeze, **C09–C11 were not on `origin`** as finished
feature branches (local WIP may exist elsewhere).

## 2. Files changed (this C12 commit)

| Area | Files |
| --- | --- |
| Docs | `docs/go-architecture.md`, `docs/control-plane.md`, `docs/licensing.md`, `server/README.md`, `README.md`, `TODO.md` |
| Report | `CURSOR_REPORT.md` (replaced), supersession banners on older `CURSOR_REPORT_*.md` |
| Backend / desktop / tests | none (review-only) |

## 3. Integrate tip — exact commits

Fetched `origin/integrate/control-plane` at review time. Tip:

| Commit | Summary |
| --- | --- |
| `a2f2f03` | fix: refresh fixture artifact checksums after C06–C08 merge |
| `ffc9b05` | merge: C08 Iran email/SMS providers |
| `db6a8cd` | merge: C07 release artifacts |
| `6f8d021` | feat: fail-closed production configuration (C06) |
| `5772302` | test: C04 end-to-end flow suite |
| `b43b071` | merge: C03 license disclosure + C04 e2e |
| `44a7223` | merge: C02 checkout account-safe |
| `9ecd153` | fix: numbered SQLite schema migrations (C01) |
| `895962e` / `83fdc10` / `93f7842` | merge S03 / S04 / S02 |
| `e1b304d` | base from `main` lineage for the task pack |

Ancestry note: `origin/feat/c05-go-ci`, `c06`, `c07`, `c08` are ancestors of
integrate tip for commits that exist, but **C05 never added a Go CI job** (its
tip equals the C04 test commit). C06–C08 product work is present on integrate.

## 4. Architecture / docs alignment (code-checked)

- Layout is a flat `server/` Go module (`reportmaker/controlplane`), not the
  aspirational `internal/*` tree formerly documented.
- Web payment paths are `/payments/{provider}/redirect|callback`, not `/pay/*`.
- Schema version **4** with `delivery_outbox`; perpetual catalog default
  **1_000_000 rials** (`REPORT_PERPETUAL_PRICE_RIALS`).
- Fixture SHA-256 in `server/releases.json` matches files under
  `server/testdata/artifacts` (Windows + macOS fixtures).
- Local `RM-XXXX` checksum helper is localhost/UI plumbing only — not production
  license authority.
- Postgres/FastAPI: documented only as non-goals / historical removal; SQLite is
  first production DB.

## 5. Security / privacy review (status, not a full re-audit)

Present on tip: customer vs admin cookies, CSRF on mutating forms, rate limits,
fail-closed production config, masked license disclosure, hashed license lookup,
separate delivery AES key, path-traversal rejection on artifacts, redacted
provider errors, consent-gated telemetry contract.

Gaps / blockers (evidence missing): real browser passkey on final RP ID/origin,
live payment + email/SMS sandbox, VPS restore + HTTPS + key backup drills, richer
admin support console (C09), Go job in GitHub Actions (C05).

## 6. Validation evidence

### Automated — Go (pass)

```text
cd server
# PATH includes C:\Program Files\Go\bin
# GOPROXY=https://goproxy.io,https://goproxy.cn,direct  GOSUMDB=off
go test ./... -count=1
# ok  reportmaker/controlplane  ~6.8s
go vet ./...
# exit 0 (on clean integrate tip without foreign WIP files)
```

Go 1.27.0 windows/amd64.

### Automated - npm / cargo

| Check | Result |
| --- | --- |
| `npm run typecheck` | **pass** (exit 0 on integrate tip tree) |
| `npm test -- --run` | **unavailable here** — isolated worktree lacked `node_modules` / local `vitest` on PATH |
| `npm run build` | **unavailable here** — same (`tsc`/`vite` not on PATH without install) |
| `cargo test --manifest-path src-tauri/Cargo.toml -q` | **unavailable here** (exit 101 — crates.io download of `keyring` timed out). Owner or GitHub Actions must confirm. |
| `git diff --check` | Clean on C12 commit tree |

Frontend + Rust CI still run via `.github/workflows/ci.yml` on PRs; that workflow does **not** yet include Go (C05 open).

### HTTP (automated in Go tests — pass)

Demo gateway + mocked ZarinPal flows, disclosure, downloads, auth rate limits,
migration upgrade regression — covered by `go test ./...` (including C04 package).

### Browser / device

**Unavailable / not verified** — real passkey registration/login on configured
RP ID/origin; full anonymous→paid→download journey in a browser.

### Desktop interoperability

**Unavailable / not verified** against this integrate tip host (activation /
lease / AI / telemetry from a release Tauri build).

### Live providers / VPS restore

**Unavailable** — no owner ZarinPal/email/SMS credentials; no VPS restore or
HTTPS passkey-origin proof.

## 7. Known limitations / production blockers

1. **C05** — CI still lacks a Go job on integrate.
2. **C09** — admin is login + static home only; no support search/actions/audit UI.
3. **C10** — marketing/account UX incomplete (no Persian/RTL policy journey proof).
4. **C11** — no documented/verified VPS backup→restore→HTTPS path.
5. Browser passkey, live providers, desktop↔server E2E — blockers for “production ready”.
6. Fixture installers are test artifacts, not signed production Tauri releases.
7. `GET /readyz` currently shares the liveness handler (harden in C11).

## 8. Pending merges

At C12 freeze, `origin` had `feat/c05-go-ci` … `feat/c08-iran-providers`.
`origin/feat/c11-vps-deploy` also existed but pointed at the same tip as integrate
(`a2f2f03`) — no unique C11 commits to merge yet. Finished `feat/c09-*` /
`feat/c10-*` heads were **not** on origin. If unique C09–C11 commits appear
later, merge them into `integrate/control-plane` before `main`. Do not block
C12 docs on unfinished parallel WIP.

## 9. Recommended owner merge commands (do not run in C12)

C12 pushes only `feat/c12-final-review`. Suggested sequence for the owner:

```bash
git fetch origin
git checkout integrate/control-plane
git pull --ff-only origin integrate/control-plane
git merge --no-ff origin/feat/c12-final-review -m "merge: C12 final review and docs cleanup"
# after C05 and C09–C11 land and evidence exists:
# git checkout main
# git merge --no-ff integrate/control-plane -m "merge: control-plane integration"
# git push origin main
```

**Do not merge to `main` until** Go CI exists, C09–C11 acceptance evidence is
recorded, and browser/provider/restore blockers above are cleared or explicitly
accepted as launch exclusions.

## 10. Git state

- **Branch:** `feat/c12-final-review` @ `fdf52f1` (pushed to `origin`)
- **Based on:** `origin/integrate/control-plane` @ `a2f2f03`
- **main:** untouched
- **Working tree:** clean on the C12 branch after push
- **Secrets:** none committed
