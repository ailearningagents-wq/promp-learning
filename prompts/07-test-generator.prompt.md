---
mode: agent
description: >
  STAGE 7 — Test File Generation.
  Generates the actual Playwright/Selenium spec files from the approved test plan.
  Uses POMs for all interactions and data factories for all test data.
  Strictly maintains existing project structure. Merges safely — never overwrites.
tools:
  - read_file
  - create_file
  - replace_string_in_file
  - grep_search
---

# Stage 7 — Test File Generation

## Objective
Generate the actual Playwright (or Selenium) test spec files from `test-plan.json`.
Every test imports from POMs and data factories. No raw selectors. No hardcoded values.
Tests are organized by module and type, matching the existing project structure exactly.

## Inputs Required
- `output/test-plan.json` (from Stage 4, human-reviewed) — drives **which**
  spec files and fixtures to generate, via each test case's
  `artifactRequirements.specFile` and `artifactRequirements.fixture`
- `output/application-map.json` (from Stage 3)
- `output/project-fingerprint.json` (from Stage 1, if existing project)
- `output/auth/auth-fixture-stub.ts` (from Stage 2 — **Playwright projects only, when `auth.type` is NOT `"none"`**; not applicable for any Selenium framework — use `AuthHelper.java` / `AuthHelper.cs` from Stage 2 instead)
- Generated POM files (from Stage 6)
- Generated data factory files (from Stage 5)
- `output/pipeline-state.json` — for resume + single-route mode

---

## Execution Model — Streaming, Resume, Single-Route (REQUIRED)

This stage MUST stream spec-file by spec-file rather than buffering every
generated test in memory.

1. After each spec file is written or extended, update
   `pipeline-state.json` → `stage7.specFilesCompleted` and persist before
   advancing to the next spec file.
2. **Resume:** on startup, read `pipeline-state.json`. Skip any spec file
   already in `stage7.specFilesCompleted` whose file exists on disk and
   contains the expected test IDs.
3. **Single-route mode:** if `pipeline.mode === "single-route"`, the spec
   files to generate / extend are exactly the unique
   `artifactRequirements.specFile` values across test cases whose `page`
   matches `pipeline.singleRoute`. All other spec files are left
   untouched.
4. The **fixture artifact** (Step 3 + Step 3a below) is project-scoped,
   not per-test. It is created once and reused; in single-route mode it
   is created only if missing — never replaced.

---

## Step 1 — Read All Inputs (single streaming pass)

**Do NOT read `test-plan.json` in full.** For large test plans (200+ test cases)
this can exhaust context before a single spec file is written. Instead, make
**one** streaming pass that produces three derived structures the rest of the
stage will consume — never re-open `test-plan.json` again after this step:

1. Read `output/test-plan.json` once and, while iterating its `testCases[]`,
   extract per-case ONLY these fields (drop everything else immediately):
   - `id`
   - `page`
   - `module`
   - `artifactRequirements.specFile`
   - `artifactRequirements.fixture`
   - `artifactRequirements.pageClass`
   - `artifactRequirements.dataFile`

2. From those fields, build three in-memory derived structures:

   - **`specFileMap`** — map `specFile path → list of test-case IDs targeting it`.
   - **`fixtureUnion`** — set of unique `fixture` names referenced anywhere in
     the plan, plus the `pageClass` and `dataFile` each one needs to wire up.
     This is the input for Step 3a's fixture artifact (one file per project).
   - **`contractIndex`** — map `test-case id → { fixture, pageClass, dataFile, specFile }`.
     This is the input for Step 7's Four-Artifact Contract self-check.

   Discard the parsed test-plan after building these three structures. The
   rest of the stage refers ONLY to `specFileMap` / `fixtureUnion` /
   `contractIndex`.

3. Check `pipeline-state.json → stages.stage7.specFilesCompleted` (default `[]`).
   Filter `specFileMap` to remove already-completed entries (resume support).

4. For **each spec file** still in the filtered `specFileMap`:
   a. Read only the test cases whose `id` is in `specFileMap[specFile]`
      (lookup by id from `contractIndex`; selectively re-read those cases'
      `steps[]`, `testDataRequirements`, `expectedResult`, `relatedElements`
      from `test-plan.json`).
   b. Generate the spec file from those test cases (Steps 3–4 below).
   c. Write the file to disk.
   d. Append the spec file path to `stages.stage7.specFilesCompleted` and
      persist `pipeline-state.json` before moving on.
   e. Release the test case data for this file before loading the next file's cases.

This single-pass approach prevents context exhaustion on 50+ spec files **and**
guarantees Step 3a's fixture artifact is built from the union of all test
cases without a second test-plan pass.

> **New-project guard (REQUIRED before reading the fingerprint):**
> If `config.project.mode === "new"`, `output/project-fingerprint.json` does
> **not** exist (Stage 1 was skipped). Do NOT attempt to read it. Source the
> values below from `config.project.newProjectTechStack` instead, using
> these defaults:
>
> | Tech stack             | specs folder         | spec suffix       | testRunner          | import style |
> |------------------------|----------------------|-------------------|---------------------|--------------|
> | playwright-typescript  | `src/tests/`         | `*.spec.ts`       | `@playwright/test`  | `import`     |
> | playwright-javascript  | `src/tests/`         | `*.spec.js`       | `@playwright/test`  | `import`     |
> | selenium-java          | `src/test/java/.../`  | `*Test.java`      | `testng`            | `import`     |
> | selenium-dotnet        | `Tests/`             | `*Tests.cs`       | `nunit`             | `using`      |
> | selenium-js            | `test/`              | `*.test.js`       | `mocha`             | `require`    |
> | webdriverio            | `test/specs/`        | `*.spec.js`       | `mocha`             | `require`    |

For existing projects (`config.project.mode === "existing"`), read
`project-fingerprint.json` to determine:
- Target specs folder
- File naming convention
- Import style (`import` / `require` / `using`)
- Test syntax (`describe`/`test` vs `@Test` annotations (Java) vs `[TestFixture]`/`[Test]` (NUnit) vs `[TestClass]`/`[TestMethod]` (MSTest) vs `[Fact]`/`[Theory]` (xUnit))
- Auth pattern (how to reference storageState)

---

## Step 2 — Determine File Structure

Create a file map: one spec file per module per test type.

Example grouping from test plan (Playwright TypeScript):
```
Requests / smoke         → src/tests/smoke/requests.smoke.spec.ts
Requests / regression    → src/tests/regression/requests/
  ├── requests.form-validation.spec.ts
  ├── requests.form-submission.spec.ts
  ├── requests.conditional-logic.spec.ts
  ├── requests.navigation.spec.ts
  └── requests.table.spec.ts
Requests / e2e           → src/tests/e2e/requests.e2e.spec.ts
```

Example grouping from test plan (Selenium .NET / C#):
```
Requests / smoke         → Tests/Smoke/RequestsSmokeTests.cs
Requests / regression    → Tests/Regression/Requests/
  ├── RequestsFormValidationTests.cs
  ├── RequestsFormSubmissionTests.cs
  ├── RequestsConditionalLogicTests.cs
  ├── RequestsNavigationTests.cs
  └── RequestsTableTests.cs
Requests / e2e           → Tests/E2E/RequestsE2ETests.cs
```

Example grouping from test plan (Selenium Java / TestNG or JUnit 5):
```
Requests / smoke         → src/test/java/[package]/smoke/RequestsSmokeTest.java
Requests / regression    → src/test/java/[package]/regression/requests/
  ├── RequestsFormValidationTest.java
  ├── RequestsFormSubmissionTest.java
  ├── RequestsConditionalLogicTest.java
  ├── RequestsNavigationTest.java
  └── RequestsTableTest.java
Requests / e2e           → src/test/java/[package]/e2e/RequestsE2ETest.java
```

Example grouping from test plan (selenium-js — Mocha / Jest):
```
Requests / smoke         → test/smoke/requests.smoke.test.js
Requests / regression    → test/regression/requests/
  ├── requests.form-validation.test.js
  ├── requests.form-submission.test.js
  ├── requests.conditional-logic.test.js
  ├── requests.navigation.test.js
  └── requests.table.test.js
Requests / e2e           → test/e2e/requests.e2e.test.js
```

Example grouping from test plan (WebdriverIO — Mocha / Jasmine):
```
Requests / smoke         → test/specs/smoke/requests.smoke.spec.js
Requests / regression    → test/specs/regression/requests/
  ├── requests.form-validation.spec.js
  ├── requests.form-submission.spec.js
  ├── requests.conditional-logic.spec.js
  ├── requests.navigation.spec.js
  └── requests.table.spec.js
Requests / e2e           → test/specs/e2e/requests.e2e.spec.js
```

Adapt paths to match `projectFingerprint.folders.specs` exactly.

---

## Step 3 — Generate Auth Setup Reference

Every spec file must reference the shared auth state — NEVER implement login inline.

> **`auth.type = "none"` — no-auth applications:**
> If `config.auth.type` is `"none"`, skip all auth setup below. Do NOT reference
> `storageState.json`, do NOT import an auth fixture, and do NOT add cookie injection.
> Tests navigate directly to URLs without any auth context. The `playwright.config.ts`
> generated in Step 6 must NOT include a `storageState` in its project configuration.
> For Selenium projects with `auth.type = "none"`, BaseTest's `setUp` method should
> navigate directly to the app URL without calling `AuthHelper`.

### Playwright TypeScript pattern (authenticated apps):
```typescript
import { test, expect } from '../fixtures';  // uses project's custom fixture
// OR if no custom fixture:
import { test, expect } from '@playwright/test';
// storageState is configured in playwright.config.ts via project configuration
```

### New project — add to playwright.config.ts:
```typescript
projects: [
  {
    name: 'authenticated',
    use: {
      storageState: 'output/auth/storageState.json',
    },
  },
],
```

### Selenium Java pattern:
```java
// Auth is handled in @BeforeMethod (TestNG) / @BeforeEach (JUnit 5) via cookie injection
// See AuthHelper.java and BaseTest.java for implementation
```

### Selenium .NET (C#) pattern:
```csharp
// Auth is handled in [SetUp] / [OneTimeSetUp] via cookie injection from storageState.json
// See AuthHelper.cs for implementation
// BaseTest.cs reads output/auth/storageState.json and injects cookies into the driver
```

### Selenium JS (`selenium-webdriver` NPM) pattern:
```javascript
// Auth is handled in beforeEach / before hook via cookie injection
// See auth-helper.js for implementation
const { injectStorageState } = require('../../output/auth/auth-helper');

beforeEach(async function () {
  await injectStorageState(driver, baseUrl);
});
```

### WebdriverIO pattern:
```javascript
// Auth is handled in the beforeEach hook via cookie injection
// See auth-helper.js for implementation
const { injectStorageState } = require('../../output/auth/auth-helper');

beforeEach(async function () {
  await injectStorageState(process.env.BASE_URL || '[config.application.baseUrl]');
});
```

---

## Step 3a — Generate Fixture Artifact (REQUIRED)

The **fixture classes** artifact is one of the four required artifacts in
the master orchestrator's Four-Artifact Contract. It wires auth + POMs +
data factories into a single per-test setup point so spec files can stay
declarative. This stage owns producing it (or extending an existing one
in place).

> **Use the `fixtureUnion` from Step 1 — do NOT re-read `test-plan.json`.**
> Step 1 already built `fixtureUnion` (the set of unique `fixture` names plus
> the `pageClass` and `dataFile` each one wires up) in a single streaming
> pass. Step 3a generates the fixture artifact directly from `fixtureUnion`
> before the per-spec streaming loop begins. Re-reading `test-plan.json` here
> would negate Step 1's discipline — don't.

The fixture file's exact location is set by the project fingerprint; the
target file is the union of all `artifactRequirements.fixture` values
referenced by test cases — typically one fixture per project.

### Playwright TypeScript — `src/fixtures/index.ts`

```typescript
// Auto-generated by AutoTestGen Stage 7
import { test as base, expect } from '@playwright/test';
import { RequestCreatePage } from '../pages/RequestCreatePage';
import { RequestListPage } from '../pages/RequestListPage';
import { RequestsTestData } from '../data/requests.data';

type Fixtures = {
  requestCreatePage: RequestCreatePage;
  requestListPage:   RequestListPage;
  requestsData:      typeof RequestsTestData;
};

export const test = base.extend<Fixtures>({
  requestCreatePage: async ({ page }, use) => { await use(new RequestCreatePage(page)); },
  requestListPage:   async ({ page }, use) => { await use(new RequestListPage(page)); },
  requestsData:      async ({}, use)        => { await use(RequestsTestData); },
});

export { expect };
```

Spec files then `import { test, expect } from '../../fixtures';` and
write `test('...', async ({ requestCreatePage, requestsData }) => { ... })`.

### Playwright JavaScript — same shape, drop the type aliases.

### Other frameworks

For Selenium Java (`BaseTest.java`), Selenium C# (`BaseTest.cs`),
selenium-js (`test/base-test.js`), and WebdriverIO (auth-helper +
`pageObjects.js`), follow the same fixture pattern adapted to the
language's setup/teardown mechanism. Concrete copy-paste examples per
framework live in `prompts/_reference/fixture-examples.md`.

**Before reading `fixture-examples.md`, verify it exists.** If the file is absent,
do NOT stop the pipeline. Fall back to generating the fixture / BaseTest file using:
1. The TypeScript fixture canonical above as structural reference, adapted to
   the target language's setup/teardown mechanism.
2. For `selenium-java`: generate `BaseTest.java` with `@BeforeMethod`/`@AfterMethod`
   (TestNG) or `@BeforeEach`/`@AfterEach` (JUnit 5) — **determined by
   `projectFingerprint.testRunner`** (see Fix 16 note below).
3. For `selenium-dotnet`: generate `BaseTest.cs` with `[SetUp]`/`[TearDown]`
   (NUnit) or `[TestInitialize]`/`[TestCleanup]` (MSTest) or constructor
   injection (xUnit) — determined by `projectFingerprint.testRunner`.
4. For `selenium-js`: generate `test/base-test.js` with `before`/`after` hooks.
5. For `webdriverio`: generate auth-helper + `pageObjects.js` with `before`/`after` hooks.

Log a warning: `[STAGE 7] WARNING: fixture-examples.md not found — generating from built-in templates.`

> **TestNG vs JUnit 5 annotation consistency (Selenium Java):**
> Read `projectFingerprint.testRunner` before generating any Java fixture or BaseTest file.
> - If `testRunner === "testng"` → use `@BeforeMethod` / `@AfterMethod` / `@Test`
> - If `testRunner === "junit5"` → use `@BeforeEach` / `@AfterEach` / `@Test`
> - If `testRunner === "junit4"` → use `@Before` / `@After` / `@Test`
> Do NOT mix annotation styles within the same project — if Stage 2 generated a
> `BaseTest.java` with TestNG annotations and the fingerprint says JUnit 5, replace
> only the annotation style (keep method bodies). Log:
> `[STAGE 7] Detected testRunner=[value] — using matching annotations in BaseTest.java.`

### Merge rule (existing projects)

If a fixture file already exists, **never replace it**. Read it, identify
which fixtures (POMs / data) are already wired, and append only the new
ones. Fixture name collisions are an error — log them and require human
intervention rather than overwriting.

---

## Step 4 — Generate Spec Files

For each group of test cases, generate one spec file.

### PLAYWRIGHT TYPESCRIPT SPEC EXAMPLE:

```typescript
// Auto-generated by AutoTestGen Stage 7
// Module: Requests | Type: Regression | Category: Form Validation
// Source: test-plan.json

import { test, expect } from '@playwright/test';
import { RequestCreatePage } from '../../pages/RequestCreatePage';
import { RequestsTestData } from '../../data/requests.data';

test.describe('Requests — Form Validation', () => {

  let requestPage: RequestCreatePage;

  test.beforeEach(async ({ page }) => {
    requestPage = new RequestCreatePage(page);
    await requestPage.navigate();
  });

  // TC-REQ-002: Submit with empty Request Name — verify required error
  test('TC-REQ-002 | Submit with empty Request Name shows required error', async () => {
    await requestPage.fillForm(RequestsTestData.createRequest.invalid.emptyRequestName);
    await requestPage.submitForm();
    
    const errorText = await requestPage.getFieldErrorText('requestName');
    expect(errorText).toContain('required');
    expect(await requestPage.submitButton.isVisible()).toBe(true); // still on form
  });

  // TC-REQ-003: Submit with missing Category — verify required error
  test('TC-REQ-003 | Submit with missing Category shows required error', async () => {
    await requestPage.fillForm(RequestsTestData.createRequest.invalid.missingCategory);
    await requestPage.submitForm();
    
    const errorText = await requestPage.getFieldErrorText('category');
    expect(errorText).toContain('required');
  });

  // TC-REQ-004: Submit with Request Name exceeding max length — verify error
  test('TC-REQ-004 | Request Name exceeding max length shows validation error', async () => {
    await requestPage.fillForm(RequestsTestData.createRequest.invalid.requestNameTooLong);
    await requestPage.submitForm();
    
    const errorText = await requestPage.getFieldErrorText('requestName');
    expect(errorText).toBeTruthy();
  });

  // TC-REQ-005: Submit with past Due Date — verify date validation error
  test('TC-REQ-005 | Past Due Date shows date validation error', async () => {
    await requestPage.fillForm(RequestsTestData.createRequest.invalid.pastDueDate);
    await requestPage.submitForm();
    
    const errorText = await requestPage.getFieldErrorText('dueDate');
    expect(errorText).toBeTruthy();
  });

  // TC-REQ-006: Request Name at maximum boundary — should pass
  test('TC-REQ-006 | Request Name at maximum length boundary is accepted', async () => {
    await requestPage.fillForm(RequestsTestData.createRequest.valid.maximumBoundary);
    await requestPage.submitForm();
    
    // Verify no error on requestName field
    const errorVisible = await requestPage.requestNameError.isVisible();
    expect(errorVisible).toBe(false);
  });

});
```

---

### PLAYWRIGHT TYPESCRIPT SMOKE TEST EXAMPLE:

```typescript
// Auto-generated by AutoTestGen Stage 7
// Module: Requests | Type: Smoke
// Source: test-plan.json

import { test, expect } from '@playwright/test';
import { RequestCreatePage } from '../../pages/RequestCreatePage';
import { RequestListPage } from '../../pages/RequestListPage';
import { RequestsTestData } from '../../data/requests.data';

test.describe('Requests — Smoke', () => {

  // TC-REQ-001: Create Request happy path
  test('TC-REQ-001 | Create Request with valid data — success', async ({ page }) => {
    const createPage = new RequestCreatePage(page);
    const listPage = new RequestListPage(page);

    await createPage.navigate();
    await createPage.fillForm(RequestsTestData.createRequest.valid.typical);
    await createPage.submitForm();

    // Verify success
    await page.waitForURL('**/requests/**');
    const successMessage = await createPage.getToastMessage();
    expect(successMessage).toContain('created successfully');
  });

});
```

---

### CONDITIONAL LOGIC SPEC EXAMPLE:

```typescript
// Auto-generated by AutoTestGen Stage 7
// Module: Requests | Category: Conditional Logic
// Source: test-plan.json + application-map conditionalLogic array

import { test, expect } from '@playwright/test';
import { RequestCreatePage } from '../../pages/RequestCreatePage';
import { RequestsTestData } from '../../data/requests.data';

test.describe('Requests — Conditional Logic', () => {

  let requestPage: RequestCreatePage;

  test.beforeEach(async ({ page }) => {
    requestPage = new RequestCreatePage(page);
    await requestPage.navigate();
  });

  // TC-REQ-020: Category = TypeA shows TypeA detail field
  test('TC-REQ-020 | Selecting TypeA category reveals TypeA detail field', async () => {
    await requestPage.categorySelect.selectOption('TypeA');
    
    await expect(requestPage.typeADetailField).toBeVisible();
    await expect(requestPage.typeBDetailField).not.toBeVisible();
  });

  // TC-REQ-021: Category = TypeB hides TypeA detail, shows TypeB detail
  test('TC-REQ-021 | Selecting TypeB category reveals TypeB detail field and hides TypeA', async () => {
    await requestPage.categorySelect.selectOption('TypeA');
    await expect(requestPage.typeADetailField).toBeVisible();

    await requestPage.categorySelect.selectOption('TypeB');
    await expect(requestPage.typeBDetailField).toBeVisible();
    await expect(requestPage.typeADetailField).not.toBeVisible();
  });

  // TC-REQ-022: TypeA detail field is required when visible
  test('TC-REQ-022 | TypeA detail field is required when Category = TypeA', async () => {
    await requestPage.fillForm({
      ...RequestsTestData.createRequest.valid.typical,
      category: 'TypeA',
    });
    // Clear the conditional field
    await requestPage.typeADetailField.fill('');
    await requestPage.submitForm();
    
    // Expect error on the conditional field
    const errorVisible = await requestPage.page.locator('[data-testid="typeA-detail-error"]').isVisible();
    expect(errorVisible).toBe(true);
  });

});
```

---

### E2E JOURNEY SPEC EXAMPLE:

```typescript
// Auto-generated by AutoTestGen Stage 7
// Journey: J-001 — Create and Submit Request
// Type: E2E

import { test, expect } from '@playwright/test';
import { DashboardPage } from '../../pages/DashboardPage';
import { RequestCreatePage } from '../../pages/RequestCreatePage';
import { RequestDetailPage } from '../../pages/RequestDetailPage';
import { RequestListPage } from '../../pages/RequestListPage';
import { RequestsTestData } from '../../data/requests.data';

test.describe('E2E — Create and Submit Request Journey', () => {

  test('J-001 | User creates a request from dashboard and verifies it in list', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    const createPage    = new RequestCreatePage(page);
    const detailPage    = new RequestDetailPage(page);
    const listPage      = new RequestListPage(page);

    // Step 1: Start from Dashboard
    await dashboardPage.navigate();
    await expect(page).toHaveTitle(/Dashboard/);

    // Step 2: Navigate to Create Request
    await dashboardPage.createNewButton.click();
    await page.waitForURL('**/requests/create**');

    // Step 3: Fill and submit form
    await createPage.fillForm(RequestsTestData.createRequest.valid.typical);
    await createPage.submitForm();

    // Step 4: Verify detail page shows correct data
    await page.waitForURL('**/requests/**');
    const heading = await detailPage.getHeading();
    expect(heading).toContain(RequestsTestData.createRequest.valid.typical.requestName);

    // Step 5: Verify request appears in list
    await listPage.navigate();
    const requestVisible = await listPage.isRequestVisible(
      RequestsTestData.createRequest.valid.typical.requestName
    );
    expect(requestVisible).toBe(true);
  });

});
```

---

### Non-Playwright Spec Patterns

For Selenium Java (TestNG / JUnit 5), Selenium C# (NUnit / MSTest / xUnit),
selenium-js (Mocha / Jest), and WebdriverIO (Mocha / Jasmine), follow the
same structure as the canonical Playwright examples above (one `describe`
per category, one `test` / `it` / `@Test` / `[Test]` per test case from
the plan, POM methods only, data factories only).

Concrete copy-paste examples per framework live in
`prompts/_reference/spec-examples.md`. **Before reading it, verify it exists.**
If absent, fall back to the canonical Playwright TypeScript examples in this prompt,
adapted to the target language: use the appropriate test runner annotations
(`@Test` / `[Test]` / `[Fact]`), import style, and assertion library for the
project's detected `testRunner`. Log a warning:
`[STAGE 7] WARNING: spec-examples.md not found — generating from built-in templates.`
Always use the test runner detected in
`projectFingerprint.testRunner` — never mix NUnit / MSTest / xUnit
attributes, never use Playwright `test.describe` syntax outside
Playwright projects.

---

## Step 5 — Merge Strategy (Existing Projects)

For each spec file to be created:

1. Check if the file already exists at the target path
2. If it does NOT exist → create the full file
3. If it DOES exist:
   - Read the existing file in **150-line windows**, scanning each window for
     test ID patterns (e.g. `TC-[A-Z]+-[0-9]+`). Do NOT load the full file
     body into context — only ID presence is needed, not method bodies or
     assertion logic. Stop reading once all target IDs have been checked or
     the file end is reached.
   - For each test case in the plan targeting this file:
     - Check if a test with the same ID (e.g., `TC-REQ-002`) already exists
     - If it already exists → SKIP it, log: `{ testId: "TC-REQ-002", action: "skipped", reason: "already exists" }`
     - If it is new → append it inside the relevant `describe` block
4. Never modify or delete existing test cases
5. Log each file action in `output/merge-report.json`

---

## Step 6 — Generate playwright.config.ts (New Projects Only)

If mode is `"new"`, create `playwright.config.ts`.

**Choose the correct variant based on `auth.type`:**

**Variant A — Authenticated app (`auth.type` is NOT `"none"`):**

```typescript
// Auto-generated by AutoTestGen Stage 7
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/tests',
  timeout: 30000,
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  
  use: {
    baseURL: process.env.BASE_URL || '[config.application.baseUrl]',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
    },
    {
      name: 'authenticated',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'output/auth/storageState.json',
      },
      dependencies: ['setup'],
    },
  ],
});
```

**Variant B — No-auth app (`auth.type = "none"`):**

```typescript
// Auto-generated by AutoTestGen Stage 7
// auth.type = "none" — no storageState or setup project required
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/tests',
  timeout: 30000,
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: process.env.BASE_URL || '[config.application.baseUrl]',
    ...devices['Desktop Chrome'],
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },
});
```

> **For `playwright-javascript` projects:** rename the file to `playwright.config.js` and remove TypeScript type annotations. The `defineConfig()` wrapper and `devices` import are available without TypeScript — remove the `import type` if present and the file works as plain JS.

---

## Step 7 — Four-Artifact Contract Self-Check (REQUIRED before completion)

Before declaring Stage 7 complete, verify locally — the master orchestrator
will independently re-verify after this stage returns.

Use the `contractIndex` built in Step 1 (do NOT re-read `test-plan.json`).
For every entry `{ id, fixture, pageClass, dataFile, specFile }` in
`contractIndex`:

1. `fixture` — confirm a fixture entry of that name exists in the
   generated fixture file (Step 3a).
2. `pageClass` — confirm the POM file from Stage 6 exists at the project's
   pages folder.
3. `dataFile` — confirm the data file from Stage 5 exists at the project's
   data folder.
4. `specFile` — confirm THIS stage's output contains a
   `test`/`@Test`/`[Test]`/`[Fact]` block whose name includes the test
   case's `id`.

For any test case where one or more of these is missing, log:
```
CONTRACT VIOLATION — TC-REQ-014
  fixture:   authenticatedRequestsContext  [OK]
  pageClass: RequestCreatePage             [OK]
  dataFile:  requests/create.valid.json    [MISSING]
  specFile:  requests/create.spec.ts       [OK]
```

…and set `stages.stage7.status` to `"failed"` in `pipeline-state.json`.
Do NOT proceed to Stage 8.

---

## Step 8 — Stage 7 Completion

Update `output/pipeline-state.json`:
- Set `stages.stage7.status` to `"completed"`
- Set `stages.stage7.specFilesCompleted` to the full list of spec files processed
- In single-route mode, additionally record `stages.stage7.singleRouteCompleted`
- Update all counters

Log summary:
```
=== STAGE 7 COMPLETE ===
Mode:                       [full | single-route]
Spec Files Created:         [count]
Spec Files Extended:        [count] (existing projects only)
Spec Files Resumed:         [count]
Fixture Artifact:           [created | extended | unchanged]
Tests Generated:            [count]
  - Smoke:                  [count]
  - Regression:             [count]
  - E2E:                    [count]
Tests Skipped (dup):        [count] (existing projects only)
Four-Artifact Contract:     [PASS | FAIL — see contract violations above]
Stage 7: PASSED — Proceeding to Stage 8
```
