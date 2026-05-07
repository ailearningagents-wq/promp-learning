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
- `config.json` → `generation.testTypes`

---

## Step 1 — Read Application Map

Read `output/application-map.json` in full.
Build a mental model of:
- How many modules exist
- What forms exist and their complexity
- What conditional logic branches exist
- What user journeys span multiple pages

---

## Step 2 — Apply QA Heuristics Per Component

For every component type in the application map, generate test cases using the rules below.

### HEURISTIC SET A — Forms & Field Validation

For EVERY form discovered, generate ALL of the following test cases:

**A1 — Happy Path Submission**
- Fill all fields with valid data → submit → verify success state
- One test per valid data variant if multiple valid combinations exist

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

---

### HEURISTIC SET F — End-to-End Journeys

For EVERY user journey in the application map, generate:

**F1 — Full Happy Path Journey**
- Execute all journey steps in sequence → verify end state

**F2 — Journey with Interruption**
- Start journey → navigate away mid-flow → return → verify state is handled correctly

---

### HEURISTIC SET G — Auth & Session

Generate these test cases regardless of specific application content:

**G1 — Session Expiry Handling**
- Verify the app handles expired sessions gracefully (redirects to login, shows appropriate message)

**G2 — Post-Login Redirect**
- Verify that after login, user lands on the correct page

**G3 — Logout**
- Verify logout clears session and redirects to login page

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

## Step 4 — Write Test Plan

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
      "heuristicSource": "A1"
    }
  ]
}
```

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

## Step 6 — Stage 4 Completion

Update `output/pipeline-state.json`:
- Set `stages.stage4` to `"completed"`
- Update `counters.testCasesGenerated`

**PAUSE HERE — notify the orchestrator that human review is required.**

Log:
```
=== STAGE 4 COMPLETE ===
Total Test Cases:    [count]
  - Smoke:           [count]
  - Regression:      [count]
  - E2E:             [count]
Test Plan:           output/test-plan.json [SAVED]

*** HUMAN REVIEW REQUIRED ***
Please review output/test-plan.json before proceeding.
Add, remove, or modify test cases as needed.
Reply 'proceed' when ready to generate code.
```
