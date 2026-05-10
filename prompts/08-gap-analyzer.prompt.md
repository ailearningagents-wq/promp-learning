---
mode: agent
description: >
  STAGE 8 — Coverage Gap Analysis.
  Compares the generated test suite against the application map to identify
  any coverage gaps. Produces a prioritized gap report for QA architect review.
  This is the final human review gate before the project is considered complete.
tools:
  - read_file
  - create_file
---

# Stage 8 — Coverage Gap Analysis

## Objective
Perform a systematic coverage audit by comparing what was discovered in the application
map against what was actually generated in the test suite. Identify gaps, categorize them
by severity, and produce an actionable report for the QA architect.

## Inputs Required
- `output/application-map.json` (from Stage 3) — page INDEX only;
  load for the page list, then load per-page detail on demand
- `output/pages/<pageId>.json` (from Stage 3) — full DOM detail per page
  (forms, buttons, modals, conditional-logic); load one at a time during Step 1
- `output/test-plan.json` (from Stage 4) — page INDEX only;
  load for the page list, then load per-page test cases on demand
- `output/test-cases/<pageId>.json` (from Stage 4) — test IDs and coverage
  detail per page; load one at a time during Step 1
- `output/pipeline-state.json` (current counters)
- All generated spec files (from Stage 7) — processed **one file at a time** (see Step 0)
- All generated POM files (from Stage 6)

---

## Step 0 — Resume Check & Streaming Setup

Before doing any work, check `output/pipeline-state.json`:

- If `stages.stage8.status` is `"completed"` **AND** `pipeline.mode !== "single-route"` →
  log `[STAGE 8] Already completed — skipping.` and exit.
- If `stages.stage8.status` is `"completed"` **AND** `pipeline.mode === "single-route"` →
  do NOT exit. A prior full-run completion must not block gap analysis for the new single route.
  Log `[STAGE 8] Prior full-run completion detected — re-entering for single-route: [pipeline.singleRoute].`
  Scope the entire stage to the pages and spec files associated with `pipeline.singleRoute` only.
- If `stages.stage8.pagesAnalyzed` exists and is non-empty → resume from where the previous run stopped.
  Log `[STAGE 8] Resuming — [N] pages already analyzed.`
- Otherwise → start fresh.

Set `stages.stage8.status` to `"in_progress"` in `pipeline-state.json` before continuing.

**Preferred path — `mcp_scan_spec_coverage` call:**

When the `autotestgen` MCP server is registered, replace the per-file spec
scan loop (items 1–4 below) with one call:

```jsonc
mcp_scan_spec_coverage({
  "specFiles": ["<abs path>/create.spec.ts", "<abs path>/list.spec.ts", ...]
})
```

Pass the list from `stages.stage7.specFilesCompleted` (or the fallback scan
result). Returns `{ byFile: { "path": { testIds, testNames, rawSelectorCount,
rawSelectorSamples, hardcodedAssertionCount, qualityFlags } }, totalFiles }`.
Store this result as `specCoverageResult` — pass it to `mcp_compute_coverage_gaps`
in Step 1. The fallback loop below applies when the server is not available.

---

**Streaming rule (fallback):** Do NOT read all spec files into memory at once. Process one spec file at a time:
1. Get the list of spec files from `stages.stage7.specFilesCompleted` in `pipeline-state.json`.
   **If `stages.stage7.specFilesCompleted` is absent or empty**, fall back to scanning the
   project specs folder (`projectFingerprint.folders.specs`) recursively for files matching the
   project naming convention (`*.spec.ts`, `*.spec.js`, `*Test.java`, `*Tests.cs`,
   `*.test.js`, `*.spec.js`). Log:
   ```
   [STAGE 8] WARNING: stages.stage7.specFilesCompleted checkpoint is missing.
   Falling back to scanning specs folder: [projectFingerprint.folders.specs]
   Found [N] spec files.
   ```
2. Skip any files whose corresponding page already appears in `stages.stage8.pagesAnalyzed`.
3. For each spec file: read it ONCE in this stage. While reading, capture
   ALL of the following signals into the in-memory coverage matrix entry
   for that file (so Step 4 never needs to re-open the file):
   - **Test IDs** — every `TC-[A-Z]+-[0-9]+` pattern.
   - **Test name strings** — the description / `@DisplayName` / `[Description]`
     text on each test (used by Step 4 quality check #1).
   - **Raw selector literals** — any line containing `page.locator(`,
     `By.cssSelector(`, `By.CssSelector(`, `By.xpath(`, `By.XPath(`,
     `$('//`, `$('.`, `driver.findElement(` outside of POM imports
     (used by Step 4 quality check #2 — POM use).
   - **Hardcoded string literals in assertions** — any `expect("…")`,
     `Assert.That("…")`, `assert.equal("…", …)`, `Assert.Equal("…", …)`
     where the literal is not coming from a data factory import
     (used by Step 4 quality check #3 — data factory use).
   - **Cross-test references** — any line referring to module-level state
     shared across tests (used by Step 4 quality check #6 — independence).
   Then release the file before moving on.
4. After each file is processed, persist the updated `stages.stage8.pagesAnalyzed` checkpoint.

---

## Step 1 — Build Coverage Matrix

**Preferred path — `mcp_compute_coverage_gaps` call:**

When the `autotestgen` MCP server is registered, replace the per-page
comparison loop (items 1–3 below) with one call:

```jsonc
mcp_compute_coverage_gaps({
  "pagesDir":     "<absolute path to output/pages/>",
  "testCasesDir": "<absolute path to output/test-cases/>",
  "specCoverage": <specCoverageResult from Step 0>
})
```

Returns `{ gaps, pagesCoverage, summary: { totalPages, pagesWithGaps,
coveragePct, gapsBySeverity } }`. Store as `gapResult`. Proceed directly to
**Step 2** using `gapResult.gaps` for the gap identification narrative and
Step 3 for unauthorized access reporting from `gapResult.pagesCoverage`.
The fallback loop below applies when the server is not available.

---

**Coverage matrix (fallback):** Do NOT read `output/application-map.json` in full.
It is an index only — no DOM detail is stored there. Instead:
1. Read `output/application-map.json` and extract the **page index**
   (`pageId`, `url`, `title`, `module`, `role`, `status`).
2. For each page:
   a. Load `output/pages/<pageId>.json` to obtain the full page detail
      (forms, fields, buttons, modals, conditional-logic branches).
      Additionally load `output/test-cases/<pageId>.json` to obtain the
      test IDs that were generated for this page.
   b. Build the coverage matrix entry for that page by comparing its forms,
      fields, buttons, modals, and conditional-logic branches against the test
      IDs already extracted in Step 0 and from the per-page test-cases file.
   c. Release both files before advancing to the next page.
3. After all pages are processed, assemble the final matrix summary.

For every page and component in the application map, create a coverage matrix:

```
Page: /requests/create
  Forms:
    ├── createRequestForm
    │     Fields:
    │       ├── requestName (required, maxLength=100)
    │       │     ├── [✓] required validation tested
    │       │     ├── [✓] maxLength boundary tested
    │       │     ├── [✓] happy path (filled correctly)
    │       │     └── [✗] MISSING: special characters test
    │       ├── category (required, select)
    │       │     ├── [✓] required validation tested
    │       │     └── [✓] all options exercised
    │       └── dueDate (required, date, min=today)
    │             ├── [✓] required validation tested
    │             ├── [✓] past date rejected
    │             └── [✗] MISSING: invalid date format test
    ├── [✓] happy path submission tested
    ├── [✓] cancel navigation tested
    └── [✗] MISSING: form reset/clear tested
  
  Conditional Logic:
    ├── [✓] TypeA shows typeA-detail tested
    ├── [✓] TypeB shows typeB-detail tested
    └── [✓] switching category clears previous field tested
  
  Navigation:
    ├── [✓] direct URL navigation tested
    ├── [✓] breadcrumb navigation tested
    └── [✗] MISSING: unauthorized access test
```

---

## Step 2 — Gap Identification Rules

Apply these rules to identify coverage gaps:

### CRITICAL GAPS (must fix before test suite is production-ready):
- Any page with zero test cases
- Any form with no happy path test
- Any required field with no validation test
- Any OIDC/auth route with no unauthorized access test
- Any conditional logic branch (show OR hide) with no test

### HIGH GAPS (should fix before release):
- Any form with no cancel/reset test
- Any table with no empty state test
- Any modal with no cancel test
- Any field with maxLength but no boundary test
- Any user journey with no complete e2e test

### MEDIUM GAPS (improve coverage over time):
- Any field without special character / edge case test
- Any table column without sort test
- Any filter option without a test
- Any error state without a test

### LOW GAPS (nice to have):
- Any pagination without test
- Any keyboard navigation without test
- Performance/visual regression tests (not in scope for this generator)

---

## Step 3 — Unauthorized Access Audit

For every authenticated page discovered, check if there is a test that:
- Navigates to the page WITHOUT using the storageState (unauthenticated context)
- Verifies the redirect to login occurs

If any authenticated page lacks this test → mark as CRITICAL GAP.

Generate a list of all missing unauthorized access tests.

---

## Step 4 — Test Quality Checks

> **Do NOT re-read spec files in this step.** These checks MUST use signals
> captured during Step 0's streaming pass. During Step 0, when each spec file
> is read for test ID extraction, additionally capture and store in the coverage
> matrix: test name strings (for descriptiveness), any raw selector literals
> visible in test bodies (e.g. `page.locator(`, `By.CssSelector(` — for the POM
> check), and any hardcoded string literals in `expect`/`Assert` calls (for the
> data-factory check). Step 4 then applies the quality rules to those cached
> signals. Re-opening spec files here negates Step 0’s streaming discipline.

Review quality signals collected during Step 0 for each spec file:

### Check each test for:
- [ ] Does the test have a clear, descriptive name?
- [ ] Does the test use POM methods? (no raw `page.locator()` in Playwright specs; no raw `By.CssSelector()` calls in Selenium C#/Java test classes — use POM wrapper methods instead)
- [ ] Does the test use data factory values (no hardcoded strings)?
- [ ] Does the test have a single clear assertion (or related group of assertions)?
- [ ] Does the test clean up state if it modifies data? (or use isolated test data)
- [ ] Does the test depend on another test's output? (should be independent)

Flag any tests that fail these checks.

---

## Step 5 — Write Coverage Gap Report

Create `output/coverage-gap-report.json`:

```json
{
  "generatedAt": "[ISO timestamp]",
  "overallCoverage": {
    "pagesWithTests": 0,
    "totalPages": 0,
    "coveragePercentage": 0,
    "formsFullyCovered": 0,
    "totalForms": 0,
    "conditionalBranchesCovered": 0,
    "totalConditionalBranches": 0
  },
  "summary": {
    "criticalGaps": 0,
    "highGaps": 0,
    "mediumGaps": 0,
    "lowGaps": 0
  },
  "gaps": [
    {
      "gapId": "GAP-001",
      "severity": "critical",
      "type": "missing-unauthorized-access-test",
      "page": "/requests/create",
      "description": "No test verifies that unauthenticated users are redirected to login",
      "suggestedTestCase": {
        "description": "Navigate to /requests/create without auth — verify redirect to OIDC login",
        "type": "regression",
        "category": "auth-boundary"
      }
    },
    {
      "gapId": "GAP-002",
      "severity": "high",
      "type": "missing-boundary-test",
      "page": "/requests/create",
      "field": "requestName",
      "description": "No test covers special characters input in requestName field",
      "suggestedTestCase": {
        "description": "Enter special characters in requestName — verify handled correctly",
        "type": "regression",
        "category": "form-validation"
      }
    }
  ],
  "qualityIssues": [],
  "coverageByModule": {
    "Requests": {
      "totalTests": 27,
      "criticalGaps": 0,
      "highGaps": 1,
      "coverageScore": "92%"
    }
  },
  "recommendations": [
    "Address 0 critical gaps before merging to main branch",
    "Address 2 high gaps before next release",
    "Consider adding visual regression tests in a future iteration"
  ]
}
```

---

## Step 6 — Write Merge Report (Existing Projects Only)

**If `project.mode` is `"new"`, skip this step entirely.**
New projects have no pre-existing test files to merge into; a merge report is not applicable.

If mode is `"existing"`, finalize `output/merge-report.json`:

```json
{
  "generatedAt": "[ISO timestamp]",
  "mode": "existing",
  "projectPath": "[project path]",
  "summary": {
    "filesCreated": 0,
    "filesExtended": 0,
    "filesSkipped": 0,
    "testsAdded": 0,
    "testsDuplicated": 0
  },
  "fileActions": [
    {
      "file": "src/tests/regression/requests/requests.form-validation.spec.ts",
      "action": "created",
      "testsAdded": 6
    },
    {
      "file": "src/pages/RequestCreatePage.ts",
      "action": "extended",
      "locatorsAdded": 3,
      "methodsAdded": 1
    },
    {
      "file": "src/tests/smoke/dashboard.smoke.spec.ts",
      "action": "skipped",
      "reason": "All test IDs already exist in file"
    }
  ],
  "conflicts": []
}
```

---

## Step 7 — Stage 8 Completion

Update `output/pipeline-state.json`:
- Set `stages.stage8.status` to `"completed"`
- Set `stages.stage8.pagesAnalyzed` to the full list of pages analyzed
- Set `pipeline.lastUpdated` to current ISO timestamp

Stage 8 produces only `output/coverage-gap-report.json` (and updates
`output/merge-report.json` for existing projects). It does NOT print the
pipeline-completion summary or perform the post-pipeline cleanup — those
are the master orchestrator's responsibility (see master-orchestrator
→ "Post-Pipeline Cleanup" and "Pipeline Completion Summary").

Hand control back to the orchestrator with:
```
=== STAGE 8 COMPLETE ===
Mode:                       [full | single-route]
Coverage Gaps Identified:   [count]
  - Critical:               [count]
  - High:                   [count]
  - Medium:                 [count]
  - Low:                    [count]
Reports written:
  - output/coverage-gap-report.json
  - output/merge-report.json   (existing-project mode only)
Stage 8: PASSED — Returning to orchestrator for cleanup + final summary.
```
