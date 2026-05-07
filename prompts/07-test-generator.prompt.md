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
- `output/test-plan.json` (from Stage 4, human-reviewed)
- `output/application-map.json` (from Stage 3)
- `output/project-fingerprint.json` (from Stage 1, if existing project)
- `output/auth/auth-fixture-stub.ts` (from Stage 2 — **Playwright projects only**; not applicable for any Selenium framework — use `AuthHelper.java` / `AuthHelper.cs` from Stage 2 instead)
- Generated POM files (from Stage 6)
- Generated data factory files (from Stage 5)

---

## Step 1 — Read All Inputs

Read `test-plan.json` in full.
Group test cases by: `module` → `type` → `category`.
This determines the file organization.

Read `project-fingerprint.json` to determine:
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

### Playwright TypeScript pattern:
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

### JAVA TESTNG SPEC EXAMPLE (`RequestsFormValidationTest.java`):

```java
// Auto-generated by AutoTestGen Stage 7
// Module: Requests | Type: Regression | Category: Form Validation
// Source: test-plan.json
import org.testng.Assert;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;
import [your.package].pages.RequestCreatePage;
import [your.package].testdata.RequestsTestData;

public class RequestsFormValidationTest extends BaseTest {

    private RequestCreatePage requestPage;

    @BeforeMethod
    public void setUpPage() {
        requestPage = new RequestCreatePage(driver, baseUrl);
        requestPage.navigate();
    }

    // TC-REQ-002: Submit with empty Request Name — verify required error
    @Test(groups = {"regression"}, description = "TC-REQ-002 | Submit with empty Request Name shows required error")
    public void TC_REQ_002_EmptyRequestName_ShowsRequiredError() {
        requestPage.fillRequestName(RequestsTestData.CreateRequest.EMPTY_REQUEST_NAME);
        requestPage.clickSubmit();

        String error = requestPage.getRequestNameError();
        Assert.assertTrue(error.toLowerCase().contains("required"),
            "Expected required error on requestName, got: " + error);
    }

    // TC-REQ-004: Request Name exceeding max length — verify error
    @Test(groups = {"regression"}, description = "TC-REQ-004 | Request Name exceeding max length shows validation error")
    public void TC_REQ_004_RequestNameTooLong_ShowsValidationError() {
        requestPage.fillRequestName(RequestsTestData.CreateRequest.REQUEST_NAME_TOO_LONG);
        requestPage.clickSubmit();

        String error = requestPage.getRequestNameError();
        Assert.assertFalse(error.isEmpty(), "Expected validation error on requestName");
    }
}
```

> **For JUnit 5 projects:** Replace `@BeforeMethod` with `@BeforeEach`, `@Test(groups=...)` with `@Tag("regression") @Test`, and `org.testng.Assert` with `org.junit.jupiter.api.Assertions`. Extend `BaseTest` the same way.

---

### C# NUNIT SPEC EXAMPLE (`RequestsFormValidationTests.cs`):

```csharp
// Auto-generated by AutoTestGen Stage 7
// Module: Requests | Type: Regression | Category: Form Validation
// Source: test-plan.json
using NUnit.Framework;
using [ProjectNamespace].Pages;
using [ProjectNamespace].TestData;

namespace [ProjectNamespace].Tests.Regression.Requests
{
    [TestFixture]
    public class RequestsFormValidationTests : BaseTest
    {
        private RequestCreatePage _requestPage;

        [SetUp]
        public void SetUp()
        {
            _requestPage = new RequestCreatePage(Driver, BaseUrl);
            _requestPage.Navigate();
        }

        // TC-REQ-002: Submit with empty Request Name — verify required error
        [Test, Category("regression")]
        [Description("TC-REQ-002 | Submit with empty Request Name shows required error")]
        public void TC_REQ_002_EmptyRequestName_ShowsRequiredError()
        {
            _requestPage.FillRequestName(RequestsTestData.CreateRequest.EmptyRequestName);
            _requestPage.ClickSubmit();

            var error = _requestPage.GetRequestNameError();
            Assert.That(error, Does.Contain("required").IgnoreCase);
        }

        // TC-REQ-004: Request Name exceeding max length — verify error
        [Test, Category("regression")]
        [Description("TC-REQ-004 | Request Name exceeding max length shows validation error")]
        public void TC_REQ_004_RequestNameTooLong_ShowsValidationError()
        {
            _requestPage.FillRequestName(RequestsTestData.CreateRequest.RequestNameTooLong);
            _requestPage.ClickSubmit();

            var error = _requestPage.GetRequestNameError();
            Assert.That(error, Is.Not.Empty);
        }
    }
}
```

### C# MSTEST SPEC EXAMPLE (if testRunner = mstest):
```csharp
[TestClass]
public class RequestsFormValidationTests : BaseTest
{
    private RequestCreatePage _requestPage;

    [TestInitialize]
    public void SetUp() { /* same as above */ }

    [TestMethod]
    [TestCategory("regression")]
    [Description("TC-REQ-002 | Submit with empty Request Name shows required error")]
    public void TC_REQ_002_EmptyRequestName_ShowsRequiredError() { /* ... */ }
}
```

### C# XUNIT SPEC EXAMPLE (if testRunner = xunit):
```csharp
public class RequestsFormValidationTests : BaseTest
{
    [Fact]
    [Trait("Category", "regression")]
    public void TC_REQ_002_EmptyRequestName_ShowsRequiredError() { /* ... */ }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void TC_REQ_002b_InvalidRequestNames_ShowError(string input) { /* ... */ }
}
```

> Always use the test runner detected in `projectFingerprint.testRunner`. Never mix NUnit, MSTest, and xUnit attributes.

---

### SELENIUM-JS SPEC NOTE (`selenium-webdriver` NPM):

For `selenium-js` projects, test files use the test runner detected in `projectFingerprint.testRunner` (typically Mocha or Jest). Structure follows standard Node.js patterns:

```javascript
// Auto-generated by AutoTestGen Stage 7
// Module: Requests | Type: Regression | Category: Form Validation
const { injectStorageState } = require('../../output/auth/auth-helper');
const RequestCreatePage = require('../../pages/RequestCreatePage');
const RequestsTestData = require('../../testdata/RequestsTestData');

// Mocha pattern — adapt to project's existing test runner (Jest, Jasmine, etc.)
describe('Requests — Form Validation', function () {

  let driver, requestPage;

  beforeEach(async function () {
    driver = /* driver setup from project BaseTest or shared helper */;
    await injectStorageState(driver, process.env.BASE_URL);
    requestPage = new RequestCreatePage(driver, process.env.BASE_URL);
    await requestPage.navigate();
  });

  afterEach(async function () {
    await driver.quit();
  });

  it('TC-REQ-002 | Submit with empty Request Name shows required error', async function () {
    await requestPage.fillRequestName(RequestsTestData.EMPTY_REQUEST_NAME);
    await requestPage.clickSubmit();
    const error = await requestPage.getRequestNameError();
    assert.ok(error.toLowerCase().includes('required'), `Expected required error, got: ${error}`);
  });
});
```

> Always follow the project's existing spec file structure from `projectFingerprint.styleSamples.specExample`. Do NOT use Playwright `test.describe` syntax for selenium-js projects.

---

### WEBDRIVERIO SPEC NOTE:

For `webdriverio` projects, test files use the runner detected from `wdio.conf.js` (typically Mocha or Jasmine). The global `browser` object is used for all interactions:

```javascript
// Auto-generated by AutoTestGen Stage 7
// Module: Requests | Type: Regression | Category: Form Validation
const { injectStorageState } = require('../../output/auth/auth-helper');
const RequestCreatePage = require('../../pages/RequestCreatePage');
const RequestsTestData = require('../../testdata/RequestsTestData');

// Mocha/Jasmine pattern — adapt to project's wdio.conf.js runner
describe('Requests — Form Validation', () => {

  let requestPage;

  beforeEach(async () => {
    await injectStorageState(process.env.BASE_URL);
    requestPage = new RequestCreatePage(browser, process.env.BASE_URL);
    await requestPage.navigate();
  });

  it('TC-REQ-002 | Submit with empty Request Name shows required error', async () => {
    await requestPage.fillRequestName(RequestsTestData.EMPTY_REQUEST_NAME);
    await requestPage.clickSubmit();
    const error = await requestPage.getRequestNameError();
    expect(error.toLowerCase()).toContain('required');
  });
});
```

> Always follow the project's existing spec file structure from `projectFingerprint.styleSamples.specExample`. Do NOT use Playwright `test.describe` syntax for WebdriverIO projects.

---

## Step 5 — Merge Strategy (Existing Projects)

For each spec file to be created:

1. Check if the file already exists at the target path
2. If it does NOT exist → create the full file
3. If it DOES exist:
   - Read the existing file
   - For each test case in the plan targeting this file:
     - Check if a test with the same ID (e.g., `TC-REQ-002`) already exists
     - If it already exists → SKIP it, log: `{ testId: "TC-REQ-002", action: "skipped", reason: "already exists" }`
     - If it is new → append it inside the relevant `describe` block
4. Never modify or delete existing test cases
5. Log each file action in `output/merge-report.json`

---

## Step 6 — Generate playwright.config.ts (New Projects Only)

If mode is `"new"`, create `playwright.config.ts`:

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

> **For `playwright-javascript` projects:** rename the file to `playwright.config.js` and remove TypeScript type annotations. The `defineConfig()` wrapper and `devices` import are available without TypeScript — remove the `import type` if present and the file works as plain JS.

---

## Step 7 — Stage 7 Completion

Update `output/pipeline-state.json`:
- Set `stages.stage7` to `"completed"`
- Update all counters

Log summary:
```
=== STAGE 7 COMPLETE ===
Spec Files Created:    [count]
Spec Files Extended:   [count] (existing projects only)
Tests Generated:       [count]
  - Smoke:             [count]
  - Regression:        [count]
  - E2E:               [count]
Tests Skipped (dup):   [count] (existing projects only)
Stage 7: PASSED — Proceeding to Stage 8
```
