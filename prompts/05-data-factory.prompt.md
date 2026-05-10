---
mode: agent
description: >
  STAGE 5 — Test Data Factory Generation.
  Generates structured, reusable test data factories for every form and module
  discovered in the application map. Covers valid, invalid, boundary, and edge
  case data sets. No magic values ever appear inline in test files.
tools:
  - read_file
  - create_file
  - replace_string_in_file
---

# Stage 5 — Test Data Factory Generation

## Objective
Generate test data factory files for every form and module in the application.
All test cases in Stage 7 will import from these factories — never use hardcoded
values directly in test files.

## Core Principle
Test data factories are **functions or objects**, not raw values.
They produce consistent, named data sets that describe their intent:
- `validRequestData()` — returns a complete valid form payload
- `invalidEmailData()` — returns a payload with a bad email format
- `boundaryMaxLengthData()` — returns values at maximum allowed lengths

## Inputs Required
- `output/application-map.json` (from Stage 3)
- `output/project-fingerprint.json` or `config.project.newProjectTechStack`
- `output/test-plan.json` (from Stage 4) — drives **which** factories to
  generate, via each test case's `artifactRequirements.dataFile`
- `output/pipeline-state.json` — for resume + single-route mode

---

## Execution Model — Streaming, Resume, Single-Route (REQUIRED)

This stage MUST stream module-by-module rather than loading every form's
data variants in memory and writing at the end (see master orchestrator
→ Cross-Cutting Rules).

1. After each module's data factory file is written, update
   `pipeline-state.json` → `stage5.modulesCompleted` and persist the file
   before advancing to the next module.
2. **Resume:** on startup, read `pipeline-state.json`. Skip any module
   already in `stage5.modulesCompleted`. Only re-process a module if its
   data file is missing or invalid.
3. **Single-route mode:** if `pipeline.mode === "single-route"`, only
   generate / extend the data factory file for the module that contains
   the configured `pipeline.singleRoute`. All other modules' factories are
   left untouched. The set of factory files to touch is determined by
   collecting each test case in `test-plan.json` whose `page` matches the
   single route, then taking the unique set of
   `artifactRequirements.dataFile` values.

---

## Step 1 — Read Inputs

**Do NOT read `output/application-map.json` in full.** For a large application,
the full map can be megabytes of JSON and will exhaust context before a single
factory file is generated. Instead:
1. Read `output/application-map.json` and extract only the **top-level page
   list** (page routes / IDs) — not each page's form fields.
2. Form-field data for each page is loaded on-demand inside Step 3's streaming
   loop, one page at a time, when it is actually needed to generate that page's
   factory variants.

**Do NOT read `output/test-plan.json` in full.** When building the index,
read only the `artifactRequirements.dataFile` and `testDataRequirements`
fields from each test case. Skip `steps[]`, `preconditions`,
`relatedElements`, `expectedResult`, and all other fields — they are not
needed by this stage and loading them wastes significant context on large
test plans.

Build a `dataFile → testCases[]` index from each test case's
`artifactRequirements.dataFile`. The list of factory files this stage must
produce is exactly the set of unique `dataFile` values in that index —
nothing more, nothing less.

For each `dataFile`, derive the variant set by unioning the
`testDataRequirements` blocks of every test case that points at it. This
guarantees Stage 7 specs always find a named variant for the data they
import (no missing `RequestsTestData.createRequest.invalid.pastDueDate`
errors).

Determine language and folder structure:

> **New-project guard:** If `config.project.mode === "new"`,
> `output/project-fingerprint.json` does NOT exist. Do not attempt to read
> it — source the language from `config.project.newProjectTechStack` and
> use the new-project default folder shown below. The "Existing project"
> branch only applies when `mode === "existing"`.

Determine target folder for data files:
- Existing project → use `projectFingerprint.folders.data`
  - **If `folders.data` is `null`** (the fingerprinter found no existing data
    folder), do NOT stop. Fall back to a sensible default and log:
    ```
    [STAGE 5] WARNING: projectFingerprint.folders.data is null — no data folder found
    in the existing project. Defaulting to [existingProjectPath]/src/data/ (TS/JS)
    or [existingProjectPath]/src/test/resources/testdata/ (Java)
    or [existingProjectPath]/TestData/ (C#).
    The folder will be created if it does not exist.
    ```
    Use the default that matches the project's detected language:
    - TypeScript / JavaScript / selenium-js / WebdriverIO → `src/data/`
    - Java → `src/test/resources/testdata/`
    - C# → `TestData/`
- New project → use `[newProjectPath]/src/data/` (TS) or `[newProjectPath]/data/` (JS)

For Kendo / Material dropdown / radio / checkbox fields, the option set
captured by Stage 3 (see `field.options` in `application-map.json`) is the
authoritative source for valid values — do **not** invent option labels.

---

## Step 2 — Generate Data Sets Per Field

For every field in every form, generate the following data variants:

### Text / String Fields:
```
valid_typical:    A realistic value of medium length
valid_minimum:    Exactly [minLength] characters (or 1 char if no min)
valid_maximum:    Exactly [maxLength] characters
invalid_too_long: [maxLength + 1] characters
invalid_empty:    "" (empty string)
invalid_whitespace: "   " (whitespace only)
edge_special_chars: "<script>alert(1)</script>" (XSS baseline — should be rejected or escaped)
edge_unicode:     "Ünïcödé Téxt 日本語"
```

### Email Fields:
```
valid_email:          "testuser@example.com"
invalid_missing_at:   "testuseremail.com"
invalid_missing_domain: "testuser@"
invalid_double_at:    "test@@example.com"
invalid_empty:        ""
```

### Number Fields (with min/max):
```
valid_typical:    Middle of range
valid_at_min:     Exactly [min]
valid_at_max:     Exactly [max]
invalid_below_min: [min - 1]
invalid_above_max: [max + 1]
invalid_text:     "abc"
invalid_negative: -1 (if min >= 0)
```

### Date Fields:
```
valid_today:         Today's date formatted as required
valid_future:        Today + 30 days
valid_past:          Today - 30 days (if past dates allowed)
invalid_format:      "not-a-date"
invalid_past:        Yesterday (if past dates not allowed)
invalid_empty:       ""
```

### Select / Dropdown Fields:
```
valid_first_option:  [first valid option value]
valid_last_option:   [last valid option value]
valid_each_option:   Array of all valid option values
```

### Checkbox Fields:
```
checked: true
unchecked: false
```

---

## Step 3 — Generate Factory File Per Module

For each module (group of related pages/forms), create one data factory file.

### TypeScript Example (`requests.data.ts`):

```typescript
// Auto-generated by AutoTestGen Stage 5
// Module: Requests
// Source: application-map.json

export const RequestsTestData = {

  createRequest: {
    valid: {
      typical: {
        requestName: 'Test Request - Automation',
        category: 'TypeA',
        dueDate: getRelativeDate(30),
        description: 'This is a valid test description for automation purposes.',
        priority: 'Medium',
      },
      minimumRequired: {
        requestName: 'A',
        category: 'TypeA',
        dueDate: getRelativeDate(1),
        description: '',
        priority: 'Low',
      },
      maximumBoundary: {
        requestName: 'A'.repeat(100),     // maxLength = 100
        category: 'TypeC',
        dueDate: getRelativeDate(365),
        description: 'D'.repeat(500),    // maxLength = 500
        priority: 'High',
      },
    },
    invalid: {
      emptyRequestName: {
        requestName: '',
        category: 'TypeA',
        dueDate: getRelativeDate(30),
        description: 'Valid description',
        priority: 'Medium',
      },
      missingCategory: {
        requestName: 'Test Request',
        category: '',
        dueDate: getRelativeDate(30),
        description: 'Valid description',
        priority: 'Medium',
      },
      pastDueDate: {
        requestName: 'Test Request',
        category: 'TypeA',
        dueDate: getRelativeDate(-1),
        description: 'Valid description',
        priority: 'Medium',
      },
      requestNameTooLong: {
        requestName: 'A'.repeat(101),    // maxLength + 1
        category: 'TypeA',
        dueDate: getRelativeDate(30),
        description: 'Valid description',
        priority: 'Medium',
      },
      specialCharacters: {
        requestName: '<script>alert("xss")</script>',
        category: 'TypeA',
        dueDate: getRelativeDate(30),
        description: 'Valid description',
        priority: 'Medium',
      },
    },
  },

};

// Helper — returns date string relative to today
function getRelativeDate(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}
```

### JavaScript Example (`requests.data.js`):
Same structure, remove TypeScript types, use `module.exports` or `export const` based on project's module system.

### Java Example (`RequestsTestData.java`):
```java
// Auto-generated by AutoTestGen Stage 5
public class RequestsTestData {
    
    public static class CreateRequest {
        public static final String VALID_REQUEST_NAME = "Test Request - Automation";
        public static final String VALID_CATEGORY = "TypeA";
        public static final String VALID_DESCRIPTION = "This is a valid test description.";
        
        public static final String EMPTY_REQUEST_NAME = "";
        public static final String REQUEST_NAME_TOO_LONG = "A".repeat(101);
        public static final String INVALID_SPECIAL_CHARS = "<script>alert(1)</script>";
    }
}
```

### C# (.NET) Example (`RequestsTestData.cs`):
```csharp
// Auto-generated by AutoTestGen Stage 5
namespace [ProjectNamespace].TestData
{
    public static class RequestsTestData
    {
        public static class CreateRequest
        {
            // Valid data sets
            public static readonly string ValidRequestName     = "Test Request - Automation";
            public static readonly string ValidCategory        = "TypeA";
            public static readonly string ValidDescription     = "This is a valid test description.";
            public static readonly string ValidDueDate         = DateTime.Today.AddDays(30).ToString("yyyy-MM-dd");

            // Boundary data
            public static readonly string MaxLengthRequestName = new string('A', 100);  // maxLength = 100
            public static readonly string MaxLengthDescription = new string('D', 500);  // maxLength = 500

            // Invalid data sets
            public static readonly string EmptyRequestName     = "";
            public static readonly string RequestNameTooLong   = new string('A', 101);  // maxLength + 1
            public static readonly string InvalidSpecialChars  = "<script>alert(1)</script>";
            public static readonly string PastDueDate          = DateTime.Today.AddDays(-1).ToString("yyyy-MM-dd");
            public static readonly string EmptyCategory        = "";
        }
    }
}
```

For C# projects, set the target folder to the path detected in `projectFingerprint.folders.data` (e.g., `Tests/TestData/`).
File naming follows the project convention — typically `*TestData.cs` or `*Data.cs`.

---

## Step 4 — Generate Shared Test Utilities

> **Java projects:** Skip this step. Java data factories use `static final String` constants; date math is handled inline with `LocalDate.now().plusDays(30).toString()`. No separate utility class is needed.
>
> **C# (.NET) projects:** Skip this step. C# data factories use `static readonly string` fields; date math is handled inline with `DateTime.Today.AddDays(30).ToString("yyyy-MM-dd")`. No separate utility class is needed.

For TypeScript and JavaScript projects only, create a shared utilities file:

### TypeScript (`src/data/test-utils.ts`):
```typescript
// Auto-generated by AutoTestGen Stage 5

export const TestUtils = {
  
  /** Returns a date string N days from today in YYYY-MM-DD format */
  getRelativeDate(daysFromToday: number): string {
    const date = new Date();
    date.setDate(date.getDate() + daysFromToday);
    return date.toISOString().split('T')[0];
  },

  /** Generates a random string of given length */
  randomString(length: number): string {
    return Math.random().toString(36).substring(2, 2 + length).padEnd(length, 'x');
  },

  /** Generates a string of exactly the given length using the given char */
  exactLength(length: number, char = 'A'): string {
    return char.repeat(length);
  },

  /** Returns today's date in YYYY-MM-DD format */
  today(): string {
    return new Date().toISOString().split('T')[0];
  },

  /** Returns a valid test email */
  testEmail(prefix = 'testuser'): string {
    return `${prefix}+automation@example.com`;
  },
};
```

---

## Step 5 — Merge Strategy (Existing Projects)

If mode is `"existing"`:
- Check if a data file for the module already exists at `projectFingerprint.folders.data`
- If it exists → read it, identify what data sets are already defined, append ONLY new data sets
- If it does not exist → create the new file using the existing project's code style
- Log each file: CREATED or EXTENDED in `output/merge-report.json`

---

## Step 6 — Stage 5 Completion

Update `output/pipeline-state.json`:
- Set `stages.stage5.status` to `"completed"`
- Set `stages.stage5.modulesCompleted` to the full list of modules processed
- In single-route mode, additionally record `stages.stage5.singleRouteCompleted`
- Update `counters.filesCreated` and `counters.filesExtended`

Log summary:
```
=== STAGE 5 COMPLETE ===
Mode:                         [full | single-route]
Data Factory Files Created:   [count]
Data Factory Files Extended:  [count] (existing projects only)
Modules Resumed (skipped):    [count]
Total Data Sets Generated:    [count]
  - Valid sets:               [count]
  - Invalid sets:             [count]
  - Boundary sets:            [count]
  - Edge case sets:           [count]
Stage 5: PASSED — Proceeding to Stage 6
```
