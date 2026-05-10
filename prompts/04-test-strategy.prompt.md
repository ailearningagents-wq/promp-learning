---
mode: agent
description: >
  STAGE 4 — Test Strategy Generation.
  Analyzes application-map.json and applies QA architect heuristics to produce
  a comprehensive, human-reviewable test plan covering all forms, tables, modals,
  conditional logic, navigation, auth boundaries, and end-to-end journeys.
tools:
  - read_file
  - create_file
---

# Stage 4 — Test Strategy Generation

## Objective
Act as a senior QA architect and produce a complete test plan from the application map.
Apply systematic heuristics to ensure every component, flow, and edge case is covered.
The output is a human-reviewable `test-plan.json` — a QA architect reviews this before
any code is generated.

## Inputs Required
- `output/application-map.json` (from Stage 3)
- `output/project-fingerprint.json` (from Stage 1, if existing project)
- `pipeline.config.json` → `generation.testTypes`

---

## Step 0 — Resume Check

Before doing any work, check `output/pipeline-state.json`:

- If `stages.stage4.status` is `"completed"` → log `[STAGE 4] Already completed — skipping.` and exit immediately.
- If `stages.stage4.pagesProcessed` exists and is non-empty → resume from where the previous run stopped (see Step 1).
  Log `[STAGE 4] Resuming — [N] pages already processed.`
- Otherwise → start fresh.

Set `stages.stage4.status` to `"in_progress"` in `pipeline-state.json` before continuing.

---

## Step 1 — Read Application Map (Chunked / Page-by-Page)

**Do NOT read `output/application-map.json` in full.** Large application maps can exceed
context limits and cause the agent to stall. Instead, process the map one page at a time:

1. Read `output/application-map.json` and extract only the **top-level page list** (page routes/names).
2. Check `pipeline-state.json → stages.stage4.pagesProcessed` (default: `[]`).
   Skip any pages already in that list (resume support).
3. For each page NOT yet processed:
   a. Read that page's full entry from `application-map.json`.
   b. Apply Heuristic Sets A–E and H (page-scoped) — see Step 2.
   c. Emit test cases for that page into `output/test-plan.json` (append-and-persist — see Step 4).
   d. Append the page's route to `stages.stage4.pagesProcessed` and persist `pipeline-state.json`.
   e. Release the page data before moving to the next page.

4. After the per-page loop completes, run **Step 2.5 — Cross-Page
   Heuristics** (Sets F + G) BEFORE writing the test plan summary in Step 5.
   The cross-page step is a separate, named step on purpose: skipping it
   results in no E2E or auth/session tests in the final plan.

This streaming approach prevents context exhaustion on applications with 20+ pages.

---

## Step 2 — Apply QA Heuristics Per Component

For every component type in the application map, generate test cases using the rules below.

### HEURISTIC SET A — Forms & Field Validation

For EVERY form discovered, generate ALL of the following test cases:

**A1 — Happy Path Submission (REQUIRED for every form discovered)**
- For **every** form found in `application-map.json` (including forms inside
  modals and forms revealed only after a conditional branch), generate at
  least one test that fills **every required field — and every conditionally-
  required field that becomes required under the chosen branch — with valid
  data**, then submits the form and verifies the documented success state
  (toast / redirect / list refresh / detail page load).
- The test data requirements section MUST list a concrete valid value (or
  generation rule) for every field driven, so the downstream JSON data file
  can be generated deterministically.
- Generate one additional happy-path variant per distinct valid combination
  when the form has conditional branches (one per `trigger.value` recorded
  in `conditionalLogic`).
- Do not stop at "fill and click submit" — the assertion MUST verify the
  end-to-end outcome (record persisted / API success / navigation), not just
  the absence of a validation error.

**A2 — Required Field Validation (one test per required field)**
- Leave field X empty, fill all others → submit → verify required error for field X only
- Test each required field independently

**A3 — Field Format Validation**
- For email fields: invalid format (missing @, missing domain) → verify error
- For date fields: invalid format, past date if not allowed, future date if not allowed
- For number fields: non-numeric input, out-of-range values
- For fields with `pattern` attribute: value that violates the pattern

**A4 — Boundary Value Tests (for fields with min/max)**
- At minimum boundary (min length or min value) → should pass
- Below minimum boundary → should fail
- At maximum boundary → should pass
- Above maximum boundary → should fail

**A5 — Special Input Tests**
- Very long strings (500+ characters) in text fields
- Leading/trailing whitespace
- Special characters in text fields (e.g., `<>`, `&`, `"`)
- Unicode characters in text fields

**A6 — Form Reset/Cancel**
- Fill form partially → click Cancel/Reset → verify form is cleared or navigation occurred
- Verify no data was persisted

**A7 — Duplicate Submission Prevention**
- Submit valid form → immediately attempt to submit again → verify duplicate prevention (if applicable)

---

### HEURISTIC SET B — Tables & Data Grids

For EVERY table discovered, generate:

**B1 — Table Load**
- Navigate to page → verify table loads with data
- Verify column headers match expected names

**B2 — Sorting**
- Click each sortable column → verify sort order (ascending then descending)

**B3 — Filtering**
- Apply each filter option → verify results are filtered correctly
- Apply multiple filters simultaneously
- Clear all filters → verify full results return

**B4 — Pagination**
- Navigate to page 2 → verify different results
- Navigate to last page → verify boundary behavior
- Change page size (if configurable)

**B5 — Empty State**
- Apply filter that yields no results → verify empty state message is shown

**B6 — Row Actions**
- Click each row action button (Edit, View, Delete) → verify correct behavior

---

### HEURISTIC SET C — Modals & Dialogs

For EVERY modal discovered, generate:

**C1 — Open Modal**
- Click trigger → verify modal opens → verify title and content

**C2 — Submit Modal**
- Open modal → fill content (if has form) → confirm → verify success state

**C3 — Cancel Modal**
- Open modal → click Cancel → verify modal closes → verify no changes made

**C4 — Backdrop Close**
- Open modal → click outside (backdrop) → verify modal closes (if `closeByBackdrop=true`)

**C5 — Escape Key Close**
- Open modal → press Escape → verify modal closes

---

### HEURISTIC SET D — Conditional Logic

For EVERY conditional relationship in the application map, generate:

**D1 — Condition Trigger — Show Branch**
- Set trigger field to value that SHOWS dependent field → verify dependent field is visible
- Verify dependent field validation applies when shown

**D2 — Condition Trigger — Hide Branch**
- Set trigger field to value that HIDES dependent field → verify dependent field is NOT visible
- Verify hidden field does not block form submission

**D3 — Condition Change Mid-Form**
- Fill dependent field → change trigger to hide condition → verify field hides and its value is cleared
- Change trigger back → verify field shows again (empty, not retaining old value)

---

### HEURISTIC SET E — Navigation & Routing

For EVERY page in the application map, generate:

**E1 — Direct Navigation**
- Navigate directly to the URL → verify correct page loads with correct title/heading

**E2 — Breadcrumb Navigation**
- On pages with breadcrumbs → click each breadcrumb level → verify correct navigation

**E3 — Back/Cancel Navigation**
- On create/edit pages → click Cancel/Back → verify navigation to correct parent page

**E4 — Unauthorized Access**
- Attempt to navigate to the page WITHOUT authenticated state → verify redirect to login
- > **`auth.type = "none"` SKIP rule:** If `config.auth.type` is `"none"`,
  > **DO NOT generate E4 for any page.** The application has no login page; an
  > unauthenticated-redirect test would always fail and must not be emitted.
  > Silently omit E4 and log at the end of this heuristic set:
  > `[STAGE 4] auth.type=none — E4 (Unauthorized Access) tests skipped for all pages.`

---

## Step 2.5 — Cross-Page Heuristics (REQUIRED, runs once after the per-page loop)

Heuristic Sets F (E2E journeys) and G (auth/session) are **application-scoped**,
not page-scoped. They run exactly once per pipeline run (or zero times in
single-route mode — see G's skip rule). Run them now, after all pages have
been processed in Step 1's loop. Read only `userJourneys[]` from
`output/application-map.json` for Set F; Set G needs no map data.

---

### HEURISTIC SET F — End-to-End Journeys

For EVERY user journey in the application map, generate:

**F1 — Full Happy Path Journey**
- Execute all journey steps in sequence → verify end state

**F2 — Journey with Interruption**
- Start journey → navigate away mid-flow → return → verify state is handled correctly

---

### HEURISTIC SET G — Auth & Session

> **Single-route mode — skip Heuristic Set G entirely when
> `pipeline.mode === "single-route"`.**
> G-type tests (Session Expiry, Post-Login Redirect, Logout) are
> application-scoped, not page-scoped. Re-generating them on every
> single-route run adds duplicate test IDs to `test-plan.json`. Before
> generating any G test, check `output/test-plan.json` — if any test case
> whose description contains "Session Expiry", "Post-Login Redirect", or
> "Logout" already exists, skip this heuristic set entirely and log:
> ```
> [STAGE 4] Heuristic Set G skipped — session/auth tests already present in test-plan.json.
> ```
> In `pipeline.mode === "single-route"`, always skip G without checking.

Generate these test cases regardless of specific application content (full mode,
first run only):

**G1 — Session Expiry Handling**
- Verify the app handles expired sessions gracefully (redirects to login, shows appropriate message)

**G2 — Post-Login Redirect**
- Verify that after login, user lands on the correct page

**G3 — Logout**
- Verify logout clears session and redirects to login page

---

### HEURISTIC SET H — UI Library Specifics (Kendo UI / Angular Material)

For every field whose `uiLibrary` in the application map is `kendo` or
`material`, the test plan MUST encode the correct interaction strategy
rather than treating the control as a native `<select>` / `<input>`. Failing
to do this is the single most common cause of generated specs silently
selecting nothing and submitting an empty form.

**H1 — Library-Aware Field Driving**
- Every test step that sets a value on a Kendo or Material control MUST
  reference the field's `interactionStrategy` and `componentSelector` from
  the application map.
- Steps targeting `kendo-dropdownlist` / `kendo-combobox` /
  `kendo-multiselect` MUST: click the wrapper, wait for `.k-list-container`,
  then click `.k-list-item` whose text matches the desired option.
- Steps targeting `mat-select` MUST: click the trigger, wait for
  `.cdk-overlay-pane`, then click the `mat-option` whose text matches.
- Steps targeting `mat-checkbox` / `mat-radio-button` MUST click the
  `.mat-mdc-*-touch-target`, NOT the inner native `<input>`.
- Steps targeting `mat-datepicker` / `kendo-datepicker` should prefer typing
  an ISO date into the paired input over driving the calendar UI.
- Each such test case MUST include `relatedElements` entries that point at
  the `componentSelector` recorded in 3h, so the downstream Page class
  generator can emit a strongly-typed locator.

**H2 — Library Dropdown Selection Verification**
- For every Kendo / Material dropdown driven in any test, add an explicit
  assertion after selection that the wrapper's displayed value matches the
  intended option text (e.g. read `.k-input-inner` value or
  `mat-select-value-text` content). This catches the failure mode where the
  click was registered against a stale list popup and no value was bound.

**H3 — Kendo Grid / Material Table Row Actions**
- For Kendo grids and Material tables, the row-action steps MUST locate the
  target row by a unique cell value (not by row index), then scope the
  action button click within that row's selector.

---

## Step 3 — Assign Test IDs, Modules, and Types

For each generated test case:
- Assign ID: `TC-[module abbreviation]-[sequential number]` (e.g., `TC-REQ-001`)
- Assign module from the page's module field in the application map
- Assign type:
  - `"smoke"` → one happy path per module (highest priority tests)
  - `"regression"` → validation, boundary, edge case tests
  - `"e2e"` → multi-page user journeys

---

## Step 4 — Write Test Plan (Streaming / Append-and-Persist)

**Fresh run — first page processed:** Initialize `output/test-plan.json` with the
top-level schema shown below (`testCases: []` empty) before emitting any test cases.

**Each subsequent page (same run):** Append new test cases to the existing
`testCases` array. Never re-write the whole file. Update `totalTestCases`,
`summary.byType`, and `summary.byModule` counters after every append.

**Resume (file already exists from a prior partial run):** Do NOT re-initialize
the file. Open the existing file, read which test-case IDs are already present,
and append only the test cases for pages not yet processed. A duplicate test-case
ID is a hard error — log it and stop rather than overwriting the existing entry.

Schema (initialized once on a fresh run):

Create `output/test-plan.json`:

```json
{
  "generatedAt": "[ISO timestamp]",
  "totalTestCases": 0,
  "summary": {
    "byType": { "smoke": 0, "regression": 0, "e2e": 0 },
    "byModule": {}
  },
  "testCases": [
    {
      "id": "TC-REQ-001",
      "module": "Requests",
      "page": "/requests/create",
      "type": "smoke",
      "category": "form-submission",
      "priority": "high",
      "description": "Submit Create Request form with all valid data — verify success",
      "preconditions": ["User is authenticated", "On /requests/create page"],
      "steps": [
        "Navigate to /requests/create",
        "Fill 'Request Name' with valid value",
        "Select 'Category' as 'TypeA'",
        "Fill 'Due Date' with a future date",
        "Click 'Submit'"
      ],
      "expectedResult": "Success notification shown. User redirected to /requests/[id]. Request appears in list.",
      "testDataRequirements": {
        "requestName": "valid string, max 100 chars",
        "category": "TypeA",
        "dueDate": "future date"
      },
      "relatedElements": ["form#create-request", "btn-submit"],
      "artifactRequirements": {
        "fixture": "authenticatedRequestsContext",
        "pageClass": "RequestCreatePage",
        "dataFile": "requests/create.valid.json",
        "specFile": "requests/create.spec.ts"
      },
      "heuristicSource": "A1",
      "status": "ready"
    }
  ]
}
```

Every test case MUST include `artifactRequirements` (see Step 6 below) so
the four-artifact contract — enforced by the master orchestrator — has the
inputs it needs. If any of the four sub-fields cannot be filled in, set
`status: "needs-review"` and add a one-line `reviewReason`.

---

## Step 5 — Generate Test Plan Summary

After writing the test plan, produce a human-readable summary table:

```
=== TEST PLAN SUMMARY ===

Module            | Smoke | Regression | E2E | Total
------------------|-------|------------|-----|------
Dashboard         |   1   |     8      |  0  |   9
Requests          |   1   |    24      |  2  |  27
Admin             |   1   |    16      |  1  |  18
Auth/Session      |   0   |     3      |  0  |   3
------------------|-------|------------|-----|------
TOTAL             |   3   |    51      |  3  |  57

Coverage Areas:
  ✓ Form validation (all required fields, all formats)
  ✓ Boundary values (all min/max attributes)
  ✓ Conditional logic ([count] branches)
  ✓ Table operations ([count] tables)
  ✓ Modal interactions ([count] modals)
  ✓ Navigation & routing ([count] routes)
  ✓ End-to-end journeys ([count] journeys)
  ✓ Auth boundaries (unauthorized access per route)
```

---

## Step 6 — Populate `artifactRequirements` (Input to the Four-Artifact Contract)

The four-artifact contract (fixture / page class / JSON data file /
spec class) is enforced by the **master orchestrator** after Stage 7, not
by Stage 4. Stage 4's job here is to give that contract enough information
to be enforceable: every test case MUST carry an `artifactRequirements`
block so Stages 5/6/7 can map cases to artifact files deterministically.

For every entry in `testCases[]`, populate:

```json
"artifactRequirements": {
  "fixture":   "authenticatedRequestsContext",   // consumed by Stage 7
  "pageClass": "RequestCreatePage",              // consumed by Stage 6
  "dataFile":  "requests/create.valid.json",     // consumed by Stage 5
  "specFile":  "requests/create.spec.ts"         // consumed by Stage 7
}
```

Naming guidance:

- `fixture` — logical fixture name (Playwright projects: matches an
  exported fixture in `src/fixtures/index.ts`; Selenium projects: matches
  a `BaseTest` subclass). The Stage 7 generator owns the actual file.
- `pageClass` — class name (PascalCase). Must match the page in
  `application-map.json` so Stage 6 can resolve it.
- `dataFile` — relative path from the project's data folder; Stage 5 owns
  the actual file path resolution per language.
- `specFile` — relative path from the project's specs folder; extension
  is set by Stage 7 based on the project's tech stack.

If any of the four sub-fields cannot be filled in confidently from the
application map, set `status: "needs-review"` on the test case and add a
one-line `reviewReason` — do **not** emit a partial `artifactRequirements`
block. The orchestrator will block the pipeline on `needs-review` cases
before Stage 5.

### Single-Route Mode

When the orchestrator runs the pipeline in `pipeline.mode: "single-route"`,
Stage 4 MUST:

1. Read the existing `output/test-plan.json` if it exists.
2. Generate test cases **only** for the page at `pipeline.singleRoute` and
   for any modal / journey directly opened from that page.
3. Replace any prior test cases whose `page` field equals the single
   route; leave all other test cases untouched.
4. Set `pipeline-state.json` → `stage4.status` to `"completed"` with a
   `singleRouteCompleted` annotation, not a fresh full-app completion.

---

## Step 7 — Stage 4 Completion

Update `output/pipeline-state.json`:
- Set `stages.stage4.status` to `"completed"`
- Set `stages.stage4.pagesProcessed` to the full list of page routes processed
- In single-route mode, additionally record `stages.stage4.singleRouteCompleted`
- Update `counters.testCasesGenerated`

**PAUSE HERE — notify the orchestrator that human review is required.**

Log:
```
=== STAGE 4 COMPLETE ===
Mode:                 [full | single-route]
Total Test Cases:     [count]
  - Smoke:            [count]
  - Regression:       [count]
  - E2E:              [count]
Library-Aware Tests:  [count]   # cases driving Kendo / Material controls
Needs-Review Cases:   [count]   # cases with incomplete artifactRequirements
Test Plan:            output/test-plan.json [SAVED]

*** HUMAN REVIEW REQUIRED ***
Please review output/test-plan.json before proceeding.
Add, remove, or modify test cases as needed.
Reply 'proceed' when ready to generate code.

Each test case carries `artifactRequirements` — Stages 5/6/7 will use it
to produce the four required artifacts (fixture, page class, JSON data,
spec class). The master orchestrator verifies the contract after Stage 7.
```
