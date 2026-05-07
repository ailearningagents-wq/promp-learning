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
- `output/application-map.json` (from Stage 3)
- `output/test-plan.json` (from Stage 4)
- `output/pipeline-state.json` (current counters)
- All generated spec files (from Stage 7)
- All generated POM files (from Stage 6)

---

## Step 1 — Build Coverage Matrix

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

Review generated test files for quality issues:

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

## Step 6 — Write Merge Report (Existing Projects)

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

## Step 7 — Final Pipeline Summary

Update `output/pipeline-state.json`:
- Set `stages.stage8` to `"completed"`
- Set `completedAt` to current ISO timestamp

Produce the final summary in the exact format defined in the master orchestrator:

```
=== AUTOTESTGEN PIPELINE COMPLETE ===

Application:     [app name]
Environment:     [environment]
Mode:            [existing | new]
Tech Stack:      [framework + language]

Pages Discovered:     [count]
Forms Discovered:     [count]
Test Cases Generated: [count]
  - Smoke:            [count]
  - Regression:       [count]
  - E2E:              [count]

Files Created:        [count]
Files Extended:       [count]
Files Skipped:        [count]

Coverage Gaps Identified: [count]
  - Critical: [count]
  - High:     [count]
  - Medium:   [count]
  - Low:      [count]

Output Files:
  - output/application-map.json
  - output/test-plan.json
  - output/coverage-gap-report.json
  - output/merge-report.json

Next Steps:
  1. Review coverage-gap-report.json — address critical and high gaps
  2. Run tests:
     - Playwright (TS/JS): npx playwright test --headed
     - Selenium Java (Maven): mvn test
     - Selenium C# (.NET): dotnet test
     - selenium-js (Mocha/Jest): npm test
     - WebdriverIO: npx wdio run wdio.conf.js
  3. Set BASE_URL environment variable for your target environment
  4. Commit generated test files to version control

*** PIPELINE COMPLETE ***
```
