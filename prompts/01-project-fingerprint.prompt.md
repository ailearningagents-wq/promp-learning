---
mode: agent
description: >
  STAGE 1 — Project Fingerprinting (Existing Projects Only).
  Analyzes the existing test project to determine framework, language, folder structure,
  naming conventions, and code style. Output drives all code generation in Stages 5-7.
tools:
  - read_file
  - list_dir
  - create_file
  - grep_search
---

# Stage 1 — Project Fingerprinting

## Objective
Deeply analyze the existing test project to produce a `project-fingerprint.json` that
precisely captures its tech stack, structure, naming conventions, and code style.
All code generated in later stages will strictly conform to this fingerprint.

## Inputs Required
- `pipeline.config.json` → `project.existingProjectPath`

---

## Step 0 — Early Exit for New Projects

If `config.project.mode` is `"new"`, **skip this entire stage.**

There is no existing project to fingerprint. The master orchestrator already handles
new-project mode by using `config.project.newProjectTechStack` for all downstream stages.

Update `output/pipeline-state.json`:
- Set `stages.stage1.status` to `"completed"`
- Set `stages.stage1.skippedReason` to `"mode=new — no existing project to fingerprint"`

Log:
```
=== STAGE 1 SKIPPED ===
Reason: project.mode = "new" — fingerprinting not applicable.
Tech stack will be sourced from config.project.newProjectTechStack by downstream stages.
Stage 1: PASSED (skipped) — Proceeding to Stage 2
```

Exit immediately. Do NOT proceed to Step 1.

---

## Step 1 — Framework Detection

Navigate to `config.project.existingProjectPath` and examine:

### Check for Playwright:
- Look for `playwright.config.ts` or `playwright.config.js` at project root
- Check `package.json` for `@playwright/test` in dependencies or devDependencies
- Check for `*.spec.ts`, `*.spec.js`, `*.test.ts`, `*.test.js` files

### Check for Selenium (JavaScript/TypeScript):
- Check `package.json` for `selenium-webdriver`, `webdriverio`, `nightwatch`
- Look for `wdio.conf.js`, `nightwatch.conf.js`

### Check for Selenium (Java):
- Look for `pom.xml` → check for `selenium-java` dependency
- Look for `build.gradle` → check for selenium dependency
- Look for `*.java` test files with `@Test` annotations
- Check for TestNG (`testng.xml`) or JUnit (`@RunWith`, `@ExtendWith`)

### Check for Selenium (.NET / C#):
- Look for `*.csproj` or `*.sln` files at project root
- Check `*.csproj` for NuGet package references: `Selenium.WebDriver`, `Selenium.Support`
- Check for test runner: `NUnit` (`[TestFixture]`, `[Test]`), `MSTest` (`[TestClass]`, `[TestMethod]`), or `xUnit` (`[Fact]`, `[Theory]`)
- Look for `*.cs` test files with test attributes
- Check for `App.config`, `appsettings.json`, or `runsettings` file

### Determine Primary Framework:
Set `framework` to one of: `"playwright"`, `"selenium-js"`, `"selenium-java"`, `"selenium-dotnet"`, `"webdriverio"`
If both Playwright and Selenium exist → set `framework` to `"playwright"` and `frameworkSecondary` to `"selenium-java"` or `"selenium-dotnet"`

---

## Step 2 — Language & Runtime Detection

### For JavaScript/TypeScript projects:
- Read `package.json` → check for TypeScript in devDependencies
- Check for `tsconfig.json` at root
- Check if existing spec files use `.ts` or `.js` extension
- Check for `import` vs `require` patterns in existing files
- Determine: `"typescript"` or `"javascript"`

### For Java projects:
- Read `pom.xml` or `build.gradle` to confirm Java
- Check Java version from `<java.version>` or `sourceCompatibility`
- Determine: `"java"`

### For .NET / C# projects:
- Read `*.csproj` → confirm `<TargetFramework>` (e.g., `net6.0`, `net8.0`)
- Check for `<Nullable>enable</Nullable>` or `<LangVersion>` to confirm C#
- Check NUnit vs MSTest vs xUnit from package references
- Determine: `"csharp"`
- Set `testRunner` to `"nunit"`, `"mstest"`, or `"xunit"` accordingly

---

## Step 3 — Folder Structure Mapping

Recursively list the project directory (max 4 levels deep).
Identify and record the exact paths for:

| Purpose | Path Found |
|---|---|
| Test spec files | (e.g., `src/tests`, `test/specs`, `e2e`) |
| Page Object Models | (e.g., `src/pages`, `src/pageObjects`, `pages`) |
| Test fixtures | (e.g., `src/fixtures`, `fixtures`) |
| Test data / data factories | (e.g., `src/data`, `test-data`, `fixtures/data`) |
| Helper utilities | (e.g., `src/helpers`, `src/utils`, `utils`) |
| Auth setup | (e.g., `src/fixtures/auth.ts`, `global-setup.ts`) |
| Config files | (e.g., `playwright.config.ts`, `config/`) |

If any category has NO matching folder, set its value to `null` in the fingerprint.
In later stages, new folders matching the closest convention will be created.

---

## Step 4 — Naming Convention Detection

Read **up to 3** existing spec files and **up to 3** existing POM files. If fewer
than 3 files exist in either category, read as many as are available and log:
```
[STAGE 1] NOTE: only [N] [spec/POM] file(s) found — analyzing all available.
```
Read the **first 150 lines** of each file. If the file exceeds 150 lines, also
read the **last 50 lines** (closing brackets, final imports, decorator
patterns). The combined head + tail window catches naming conventions and any
trailing class metadata without exhausting context on long files.
Analyze:

### File naming:
- Are spec files named `*.spec.ts`, `*.test.ts`, `*-spec.ts`, `*Test.java`, `*Tests.cs`?
- Are POM files named `*Page.ts`, `*PO.ts`, `*PageObject.ts`, `*Page.java`, `*Page.cs`?
- Are data files named `*.data.ts`, `*.fixture.ts`, `*TestData.java`, `*TestData.cs`, `*Data.cs`?

### Class/function naming:
- Are classes in PascalCase? Are functions in camelCase?
- Do POM classes extend a base class? (e.g., `extends BasePage`)
- Do spec files use `describe`/`it` or `test`/`expect`?

### Test ID pattern:
- Do existing tests have IDs in their descriptions? (e.g., `TC-001`, `[SMOKE-01]`, `@regression`)
- What is the ID format?

---

## Step 5 — Code Style Sampling

Read **up to 2** existing spec files, capped at **150 lines each** (the first
150 lines are sufficient to determine import style, describe nesting, assertion
style, and async patterns). Read **up to 2** existing POM files, also capped
at **150 lines each**. If fewer than 2 files of either type exist, read as many
as are available. Extract and store as style samples:

From spec files:
- How are imports structured (grouped? aliased?)
- How are `describe` blocks nested
- How is `beforeEach`/`afterEach` used
- How are assertions written (`expect(x).toBe()` vs `assert.equal()`)
- How are async/await patterns used
- Is there a custom `test` fixture wrapper?

From POM files:
- Constructor pattern
- How locators are defined (`page.locator()` vs `By.id()` vs `this.page.$()`)
- How action methods are structured
- Whether getters or methods are used for locators

---

## Step 6 — Auth Pattern Detection

Look for the existing authentication setup:
- Check for `global-setup.ts` or `globalSetup` in playwright config
- Check for `storageState` in `playwright.config.ts`
- Check for auth fixtures in the fixtures folder
- Check for login helper methods in helpers/utils
- Record: `"storageState"`, `"fixture"`, `"beforeEach"`, `"none"`

### For `selenium-java` projects additionally check:
- Look for `BaseTest.java` — check if it calls `AuthHelper.injectStorageState(driver, baseUrl)` or contains `driver.manage().addCookie()` logic
- Look for `AuthHelper.java` or `CookieHelper.java` — check for cookie injection from `storageState.json`
- Check `testng.xml` or JUnit `@Suite` classes for global setup hooks
- If cookie injection is found in `BaseTest.java` → record `auth.pattern` as `"beforeEach"`
- If no auth setup found → record `"none"`

### For `selenium-js` and `webdriverio` projects additionally check:
- Look for `auth-helper.js` — check for `injectStorageState(driver, baseUrl)` (selenium-js) or `injectStorageState(baseUrl)` (webdriverio)
- Check `beforeEach` / `before` hooks in spec files or a shared base module for `injectStorageState` calls
- Check `wdio.conf.js` or `nightwatch.conf.js` for a `before` hook that injects cookies
- If `injectStorageState` call found → record `auth.pattern` as `"beforeEach"`
- If no auth setup found → record `"none"`

### For `selenium-dotnet` projects additionally check:
- Look for `BaseTest.cs` — check if it reads `storageState.json` and injects cookies via `Driver.Manage().Cookies.AddCookie()`
- Look for `AuthHelper.cs` or `CookieHelper.cs` — check for cookie injection logic
- Check `appsettings.json`, `.runsettings`, or `App.config` for `BaseUrl` and auth settings
- If cookie injection is found in `BaseTest.cs` → record `auth.pattern` as `"beforeEach"`
- If no auth setup found → record `"none"`

---

## Step 7 — Write Project Fingerprint

Create `output/project-fingerprint.json` with this structure:

```json
{
  "detectedAt": "[ISO timestamp]",
  "projectPath": "[absolute path]",
  "framework": "playwright",
  "frameworkSecondary": null,
  "language": "typescript",           // typescript | javascript | java | csharp
  "testRunner": "@playwright/test",    // @playwright/test | testng | junit | nunit | mstest | xunit | mocha | jest | jasmine | wdio
  "moduleSystem": "esm",              // esm | commonjs | java | dotnet
  "folders": {
    "specs": "src/tests",
    "pages": "src/pages",
    "fixtures": "src/fixtures",
    "data": "src/data",
    "helpers": "src/helpers",
    "auth": "src/fixtures/auth.ts",
    "config": "playwright.config.ts"
  },
  "naming": {
    "specFileSuffix": ".spec.ts",
    "pomFileSuffix": "Page.ts",
    "dataFileSuffix": ".data.ts",
    "testIdPrefix": "TC-",
    "classStyle": "PascalCase",
    "methodStyle": "camelCase"
  },
  "codeStyle": {
    "describeNesting": "module > feature",
    "assertionLibrary": "expect",
    "asyncPattern": "async/await",
    "usesCustomTestFixture": true,
    "customFixtureImport": "import { test, expect } from '../fixtures'",
    "pomBaseClass": "BasePage",
    "pomLocatorStyle": "page.locator()"
  },
  "auth": {
    "pattern": "storageState",
    "storageStatePath": "playwright/.auth/user.json",
    "globalSetupFile": "global-setup.ts"
  },
  "styleSamples": {
    "specExample": "[first few lines of an existing spec file for reference]",
    "pomExample": "[first few lines of an existing POM file for reference]"
  }
}
```

---

## Step 8 — Stage 1 Completion

Update `output/pipeline-state.json` — set `stages.stage1` to `"completed"`.

Log summary:
```
=== STAGE 1 COMPLETE ===
Framework:      [framework]
Language:       [language]
Test Runner:    [testRunner]
Spec Pattern:   [specFileSuffix]
POM Pattern:    [pomFileSuffix]
Auth Pattern:   [auth.pattern]
Folders mapped: [count of non-null folders]
Stage 1: PASSED — Proceeding to Stage 2
```
