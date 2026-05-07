---
mode: agent
description: >
  STAGE 2 — OIDC/Ping Authentication.
  Uses Playwright MCP browser tool to perform the full OIDC login flow,
  then saves the authenticated browser state for reuse by all generated tests.
  Supports Channel Secure Ping PKCE (SPA/public clients), confidential client flows,
  standard OIDC, and basic auth flows.
tools:
  - read_file
  - create_file
  - browser_navigate
  - browser_snapshot
  - browser_click
  - browser_fill
  - browser_wait_for
  - browser_evaluate
  - run_in_terminal
---

# Stage 2 — OIDC / Ping Authentication

## Objective
Log into the application using the configured OIDC/Ping authentication flow.
Save the authenticated browser session state so ALL generated tests can reuse it
without repeating the login process. This is the foundation for the entire test suite.

## CRITICAL RULES
1. Credentials are NEVER hardcoded. Always read them from environment variables.
2. Never log, print, or include actual credential values in any output file.
3. Never log or save the contents of `storageState.json` — it contains live tokens.
4. For PKCE flows: NEVER attempt to use or capture `client_secret` — it does not exist.

## Auth Type Reference

| Type | Client Secret | PKCE | Use Case |
|---|---|---|---|
| `oidc-ping-pkce` | NOT PRESENT | Yes (S256) | SPA, single-page apps, Channel Secure public clients |
| `oidc-ping` | Required | No | Server-side confidential clients |
| `oidc-standard` | Required | No | Standard OIDC confidential clients |
| `basic` | N/A | N/A | Direct username/password form |
| `none` | N/A | N/A | No authentication |

## Inputs Required
- `config.json` → `auth.*` and `application.baseUrl`
- Environment variables as referenced in `config.json`

---

## Step 1 — Read Auth Configuration

Read `config.json` and extract:
- `application.baseUrl`
- `auth.type`
- `auth.oidcIssuerUrl`
- `auth.clientId`
- `auth.clientSecret` (will be `null` for PKCE — this is correct and expected)
- `auth.pkce` (enabled, codeChallengeMethod, redirectUri)
- `auth.scopes`
- `auth.loginPageTitle`
- `auth.usernameSelector`
- `auth.passwordSelector`
- `auth.submitSelector`
- `auth.postLoginUrlPattern`

Resolve credential environment variables by running:
```
echo $[auth.username variable name]
echo $[auth.password variable name]
```
Store resolved values in memory ONLY for this session. Never write them to any file.

If `auth.type` is `"oidc-ping-pkce"` and `auth.clientSecret` is NOT null → warn:
```
WARNING: auth.type is oidc-ping-pkce but clientSecret is set.
PKCE/public client flows do not use a client secret.
The clientSecret value will be IGNORED for this flow.
If this is a confidential client, change auth.type to "oidc-ping" instead.
```

---

## Step 2 — Open Application in Browser

Using Playwright MCP browser tool:

1. Navigate to `config.application.baseUrl`
2. Take a browser snapshot immediately
3. Detect what is shown:
   - If the login page title matches `config.auth.loginPageTitle` → already on login page, go to Step 3
   - If the URL has changed (redirect occurred to OIDC/Ping provider) → go to Step 3
   - If the application dashboard/home is already visible → already authenticated, take snapshot and go to Step 6

---

## Step 3 — Handle Auth Flow By Type

### For `auth.type = "oidc-ping-pkce"` (SPA / Channel Secure PKCE):

**How PKCE works in a browser (the agent does NOT need to generate the code challenge manually):**
The SPA automatically generates the `code_verifier` and `code_challenge` when the user clicks Login.
The browser handles the full PKCE flow transparently. The agent simply:
1. Navigates to the app → the app initiates PKCE authorization request automatically
2. Follows the redirect to the Ping login page
3. Fills credentials
4. Follows the redirect back — the PKCE token exchange happens automatically in the browser

**Steps:**
1. Navigate to `config.application.baseUrl`
2. Observe the authorization redirect URL — confirm it contains:
   - `response_type=code`
   - `code_challenge=` (confirms PKCE is active)
   - `code_challenge_method=S256`
   - `client_id=[config.auth.clientId]`
   - **NO `client_secret` parameter** (correct for PKCE)
3. Take a snapshot to confirm arrival on the Ping login page
4. Wait for `config.auth.usernameSelector` to be visible
5. Fill the username field with the resolved `$APP_USERNAME` value
6. If password field visible on same page:
   - Fill `config.auth.passwordSelector` with resolved `$APP_PASSWORD`
   - Click `config.auth.submitSelector`
7. If step-up flow (username then password on separate page):
   - Submit username → wait for password page → fill password → submit
8. After submit, the Ping server validates credentials and redirects back to `config.auth.pkce.redirectUri`
9. The SPA receives the authorization `code` and exchanges it for tokens via PKCE (no secret needed)
10. Confirm the app has loaded the post-login page

**Handle MFA if it appears:**
If an MFA/OTP challenge is detected → STOP and notify:
```
MFA challenge detected on the Ping login page.
PKCE flows with MFA require the test account to have MFA disabled or use a bypass policy.
Please configure a test service account without MFA in Ping and update config.json credentials.
```

---

### For `auth.type = "oidc-ping"` or `"oidc-standard"` (Confidential Client):

The flow:
```
App URL → Redirect → OIDC Provider Login Page → Credentials → Token exchange (with client_secret) → App
```

1. Wait for the login page and `config.auth.usernameSelector` to be visible
2. Fill username → fill password → click submit
3. Token exchange happens server-side with client_secret (invisible to browser)
4. Follow redirect back to app

---

### For `auth.type = "basic"`:
1. Fill `config.auth.usernameSelector` with resolved username
2. Fill `config.auth.passwordSelector` with resolved password
3. Click `config.auth.submitSelector`

---

## Step 4 — Confirm Successful Authentication

After submitting credentials:

1. Wait for navigation to complete
2. Take a browser snapshot
3. Confirm success by checking:
   - Current URL contains `config.auth.postLoginUrlPattern`
   - OR the OIDC login page is no longer visible
   - OR a known authenticated UI element is present (navigation menu, user profile, dashboard heading)
4. If login failed (error message visible, still on login page):
   - Take a snapshot
   - **STOP THE PIPELINE** with:
     ```
     Authentication failed. Login form shows an error.
     Possible causes:
       - Invalid credentials in environment variables
       - Account locked or expired
       - OIDC provider configuration mismatch
     Please verify credentials and OIDC config, then retry.
     ```

---

## Step 5 — Save Authentication State

Using Playwright MCP, execute a script to save the current browser storage state:

The storage state captures:
- Session cookies (OIDC tokens, session IDs)
- localStorage tokens
- sessionStorage data

Save to: `output/auth/storageState.json`

Verify the file was created and is not empty.
Verify it contains `cookies` or `origins` data — a valid storage state.

**NEVER log the contents of storageState.json** — it contains sensitive tokens.

---

## Step 6 — Verify Auth State is Reusable

To confirm the saved state works:

1. Open a NEW browser context using the saved `storageState.json`
2. Navigate directly to `config.application.baseUrl` + `config.auth.postLoginUrlPattern`
3. Confirm the app loads in authenticated state (no redirect to login)
4. Take a snapshot confirming the authenticated view
5. Close the browser context

If this verification fails → re-run Steps 2-5 once. If it fails again → STOP with error.

---

## Step 7 — Generate Auth Fixture Stub

Based on the fingerprint (or new project tech stack), generate a reusable auth fixture stub
that will be used by all generated test files.

**PKCE note:** The `storageState.json` saved in Step 5 contains the session cookies and
tokens that the SPA received after the PKCE exchange. Tests reuse this saved state directly —
they do NOT re-initiate the PKCE flow. This is correct and safe. The PKCE flow only runs once
during pipeline setup (this stage), not per test.

---

> **Framework routing — generate ONLY the section matching `projectFingerprint.framework` (or new project tech stack). Do NOT generate all sections:**
> - `selenium-dotnet` → generate C# files only (next section)
> - `selenium-java` → generate Java files only (second section)
> - `selenium-js` → generate JavaScript auth-helper.js only (third section)
> - `webdriverio` → generate WebdriverIO auth-helper.js only (fourth section)
> - `playwright` / `playwright-typescript` / `playwright-javascript` → generate TypeScript/JavaScript fixture only (fifth section)

---

### For `selenium-dotnet` (C# / .NET):

**Do NOT generate a TypeScript fixture.** Instead, generate two C# helper files:

**`output/auth/AuthHelper.cs`:**
```csharp
// Auto-generated by AutoTestGen Stage 2
// Reads storageState.json saved by the OIDC login flow and injects cookies into the WebDriver.
// Import this into BaseTest.cs — do not re-run the OIDC flow per test.

using System;
using System.IO;
using System.Text.Json;
using OpenQA.Selenium;

namespace [ProjectNamespace].Auth
{
    public static class AuthHelper
    {
        private static readonly string StorageStatePath =
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "output", "auth", "storageState.json");

        /// <summary>
        /// Reads saved OIDC session cookies from storageState.json and adds them to the WebDriver.
        /// Call this after navigating to baseUrl so the cookie domain is set correctly.
        /// </summary>
        public static void InjectStorageState(IWebDriver driver, string baseUrl)
        {
            if (!File.Exists(StorageStatePath))
                throw new FileNotFoundException(
                    $"storageState.json not found at {StorageStatePath}. Run AutoTestGen Stage 2 first.");

            var json = File.ReadAllText(StorageStatePath);
            using var doc = JsonDocument.Parse(json);

            // storageState.json format: { "cookies": [ { "name": "...", "value": "...", "domain": "...", "path": "..." } ] }
            if (!doc.RootElement.TryGetProperty("cookies", out var cookies)) return;

            driver.Navigate().GoToUrl(baseUrl); // navigate first so domain is valid
            foreach (var cookie in cookies.EnumerateArray())
            {
                driver.Manage().Cookies.AddCookie(new Cookie(
                    cookie.GetProperty("name").GetString(),
                    cookie.GetProperty("value").GetString(),
                    cookie.TryGetProperty("domain", out var d) ? d.GetString() : null,
                    cookie.TryGetProperty("path", out var p) ? p.GetString() : "/",
                    null
                ));
            }
        }
    }
}
```

**`output/auth/BaseTest.cs`:**
```csharp
// Auto-generated by AutoTestGen Stage 2
// All generated test classes inherit from BaseTest to get an authenticated WebDriver.

using NUnit.Framework; // Replace with [TestInitialize] / IClassFixture if using MSTest / xUnit
using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;
using [ProjectNamespace].Auth;

namespace [ProjectNamespace]
{
    public abstract class BaseTest
    {
        protected IWebDriver Driver { get; private set; }
        protected string BaseUrl { get; private set; }

        [SetUp]
        public void BaseSetUp()
        {
            BaseUrl = Environment.GetEnvironmentVariable("BASE_URL")
                      ?? "[config.application.baseUrl]";

            var options = new ChromeOptions();
            options.AddArgument("--headless");
            options.AddArgument("--no-sandbox");
            Driver = new ChromeDriver(options);
            Driver.Manage().Window.Maximize();

            // Inject saved OIDC session cookies — no re-login per test
            AuthHelper.InjectStorageState(Driver, BaseUrl);
        }

        [TearDown]
        public void BaseTearDown()
        {
            Driver?.Quit();
            Driver?.Dispose();
        }
    }
}
```

> **Note for MSTest:** Replace `[SetUp]`/`[TearDown]` with `[TestInitialize]`/`[TestCleanup]`.
> **Note for xUnit:** Implement `IDisposable` instead of using `[TearDown]`.
> In Stage 6/7, these stubs will be adapted to match the existing project's namespace and driver setup.

---

### For `selenium-java` (Java / TestNG or JUnit):

**Do NOT generate a TypeScript fixture.** Instead, generate two Java helper files:

**`output/auth/AuthHelper.java`:**
```java
// Auto-generated by AutoTestGen Stage 2
// Reads storageState.json saved by the OIDC login flow and injects cookies into the WebDriver.
// Call AuthHelper.injectStorageState(driver, baseUrl) in your @Before / @BeforeClass method.

package [your.package].auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.openqa.selenium.Cookie;
import org.openqa.selenium.WebDriver;

import java.io.File;
import java.io.IOException;
import java.nio.file.Paths;

public class AuthHelper {

    private static final String STORAGE_STATE_PATH =
        Paths.get(System.getProperty("user.dir"), "output", "auth", "storageState.json").toString();

    /**
     * Reads saved OIDC session cookies from storageState.json and adds them to the WebDriver.
     * Navigate to baseUrl first so the cookie domain is valid before calling this.
     */
    public static void injectStorageState(WebDriver driver, String baseUrl) throws IOException {
        File stateFile = new File(STORAGE_STATE_PATH);
        if (!stateFile.exists()) {
            throw new RuntimeException(
                "storageState.json not found at " + STORAGE_STATE_PATH + ". Run AutoTestGen Stage 2 first.");
        }

        ObjectMapper mapper = new ObjectMapper();
        JsonNode root = mapper.readTree(stateFile);
        JsonNode cookies = root.path("cookies");

        driver.get(baseUrl); // navigate first so domain is valid
        for (JsonNode c : cookies) {
            driver.manage().addCookie(new Cookie(
                c.path("name").asText(),
                c.path("value").asText(),
                c.has("domain") ? c.path("domain").asText() : null,
                c.has("path")   ? c.path("path").asText()   : "/",
                null
            ));
        }
    }
}
```

**`output/auth/BaseTest.java`** (TestNG example — adapt for JUnit 5 with `@BeforeEach` / `@AfterEach`):
```java
// Auto-generated by AutoTestGen Stage 2
// All generated test classes extend BaseTest to receive an authenticated WebDriver.

package [your.package];

import [your.package].auth.AuthHelper;
import io.github.bonigarcia.wdm.WebDriverManager;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeMethod;

public abstract class BaseTest {

    protected WebDriver driver;
    protected String baseUrl = System.getProperty("BASE_URL", "[config.application.baseUrl]");

    @BeforeMethod
    public void setUp() throws Exception {
        WebDriverManager.chromedriver().setup();
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless", "--no-sandbox", "--disable-dev-shm-usage");
        driver = new ChromeDriver(options);
        driver.manage().window().maximize();

        // Inject saved OIDC session cookies — no re-login per test
        AuthHelper.injectStorageState(driver, baseUrl);
    }

    @AfterMethod
    public void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }
}
```

> **Note for JUnit 5:** Replace `@BeforeMethod` / `@AfterMethod` with `@BeforeEach` / `@AfterEach`. Import `org.junit.jupiter.api.BeforeEach` etc.
> In Stage 6/7, these stubs will be adapted to match the existing project's package structure and driver setup.

---

### For `selenium-js` projects (selenium-webdriver NPM package):

Create `output/auth/auth-helper.js`:

```javascript
// Auto-generated by AutoTestGen Stage 2
// Reads storageState.json and injects cookies into the WebDriver session.
const fs = require('fs');
const path = require('path');

const STORAGE_STATE_PATH = path.join(__dirname, '..', '..', 'output', 'auth', 'storageState.json');

async function injectStorageState(driver, baseUrl) {
  if (!fs.existsSync(STORAGE_STATE_PATH)) {
    throw new Error(`storageState.json not found at ${STORAGE_STATE_PATH}. Run AutoTestGen Stage 2 first.`);
  }
  const state = JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, 'utf8'));
  // Navigate first so the domain is valid before adding cookies
  await driver.get(baseUrl);
  for (const cookie of state.cookies || []) {
    await driver.manage().addCookie({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
    });
  }
  await driver.navigate().refresh();
}

module.exports = { injectStorageState };
```

Call `injectStorageState(driver, baseUrl)` in the `beforeEach` / `before` hook in each test file (or in a shared BaseTest module).

---

### For `webdriverio` projects:

Create `output/auth/auth-helper.js`:

```javascript
// Auto-generated by AutoTestGen Stage 2
// Reads storageState.json and injects cookies into the WebdriverIO browser session.
const fs = require('fs');
const path = require('path');

const STORAGE_STATE_PATH = path.join(__dirname, '..', '..', 'output', 'auth', 'storageState.json');

async function injectStorageState(baseUrl) {
  // `browser` is the global WebdriverIO instance
  if (!fs.existsSync(STORAGE_STATE_PATH)) {
    throw new Error(`storageState.json not found at ${STORAGE_STATE_PATH}. Run AutoTestGen Stage 2 first.`);
  }
  const state = JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, 'utf8'));
  await browser.url(baseUrl); // navigate first so domain is valid
  for (const cookie of state.cookies || []) {
    await browser.setCookies({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
    });
  }
  await browser.refresh();
}

module.exports = { injectStorageState };
```

Call `injectStorageState(baseUrl)` in a `beforeEach` hook or WebdriverIO `before` hook in your spec files.

---

### For Playwright + TypeScript / JavaScript:

Create `output/auth/auth-fixture-stub.ts` (or `.js`):

```typescript
// Auto-generated by AutoTestGen Stage 2
// This fixture is used by all generated tests — do not modify the storageState path

import { test as base, Browser } from '@playwright/test';
import path from 'path';

export const STORAGE_STATE = path.join(__dirname, 'storageState.json');

export const test = base.extend({
  // All tests using this fixture will start with authenticated state
  page: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: STORAGE_STATE,
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect } from '@playwright/test';
```

Note: In Stage 6/7, this stub will be adapted to match the existing project's fixture pattern.

---

## Step 8 — Stage 2 Completion

Update `output/pipeline-state.json`:
- Set `stages.stage2` to `"completed"`
- Add `auth.storageStatePath`: `"output/auth/storageState.json"`
- Add `auth.verifiedAt`: `[ISO timestamp]`

Log summary:
```
=== STAGE 2 COMPLETE ===
Auth Type:         [auth.type]
Login URL:         [OIDC provider URL]
Post-Login URL:    [confirmed post-login URL]
Storage State:     output/auth/storageState.json [SAVED]
Verification:      PASSED (auth state reusable)
Stage 2: PASSED — Proceeding to Stage 3
```
