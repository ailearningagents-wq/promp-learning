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
  - mcp_oidc_login
  - mcp_save_storage_state
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
- Resolved config (in-memory, from the orchestrator) — `auth.*` and
  `application.baseUrl`. Secrets are passed by the orchestrator via tool
  inputs; this stage MUST NOT read them from `pipeline.config.json` directly,
  and MUST NOT write them to disk.
- `output/pipeline-state.json` — for resume support.

---

## Step 0 — Resume Check (REQUIRED FIRST)

Re-running the orchestrator must NOT re-trigger the OIDC flow on every
invocation. Repeated logins risk MFA challenges, account lockouts, and
session collisions.

Before doing any browser work, check whether a usable saved auth state
already exists.

1. Look for `output/auth/storageState.json`.
2. If it does **not** exist → fall through to Step 1 (fresh auth run).
3. If it **exists**, validate it:
   a. **File age:** read the file's modification time. If it is older than
      24 hours, treat as stale → fall through to Step 1.
   b. **Schema:** read the file. It must parse as JSON and contain either
      `cookies` (non-empty array) or `origins[0].localStorage`
      (non-empty array). Otherwise it is not a usable storage state →
      fall through to Step 1.
   c. **Live probe:** using the **existing** Playwright MCP browser (do NOT open a
      new context — that causes a second browser window), `browser_navigate` to
      `application.baseUrl + auth.postLoginUrlPattern`,
      `browser_wait_for` (timeout 30s) on the configured
      `crawl.waitForSelector` (or `body`). If the navigation lands on the
      authenticated dashboard (URL contains `postLoginUrlPattern` and no
      login redirect occurs), the state is **valid**.
   d. If the probe redirects to the login page or times out → state is
      **stale**; fall through to Step 1.
4. If the state is **valid**, skip Steps 1–7 entirely and go directly to
   Step 8 (auth fixture stub generation — only if it is not already present).
   Update `output/pipeline-state.json`:
   - Set `stages.stage2.status` to `"completed"`.
   - Set `stages.stage2.resumedFromCache` to `true`.
   - Set `auth.verifiedAt` to current ISO timestamp.
   Log:
   ```
   [STAGE 2] Reusing valid storageState.json (age < 24h, probe passed).
   No new login attempted.
   ```

`config.auth.type === "none"` short-circuits even this step — proceed
directly to Step 2's "none" branch.

---

## Step 1 — Read Auth Configuration

Use the resolved config view supplied by the orchestrator. Required keys:
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

Credential values arrive from the orchestrator's in-memory resolution
of `.env` (see master orchestrator → Pre-Flight step 1). This stage
MUST NOT call `echo $APP_USERNAME` etc. — that re-resolves the secret
into a logged shell command. Always consume the values via the resolved
config object the orchestrator passes in.

Never write credentials, tokens, or any value sourced from `.env` to any
file under `output/` or anywhere else on disk.

If `auth.type` is `"oidc-ping-pkce"` and `auth.clientSecret` is NOT null → warn:
```
WARNING: auth.type is oidc-ping-pkce but clientSecret is set.
PKCE/public client flows do not use a client secret.
The clientSecret value will be IGNORED for this flow.
If this is a confidential client, change auth.type to "oidc-ping" instead.
```

---

## Step 2 — Early Exit for `auth.type = "none"`

If `auth.type` is `"none"`, **skip Steps 3 through 6 entirely.**
The application requires no authentication.

1. Write an empty placeholder `output/auth/storageState.json`:
   ```json
   { "cookies": [], "origins": [] }
   ```
2. Log:
   ```
   [AUTH] auth.type = "none" — no login required. Skipping browser auth flow.
   ```
3. Proceed directly to **Step 8 — Generate Auth Fixture Stub (no-auth variant).**

---

## Step 2.5 — Preferred path: single `mcp_oidc_login` call

**If the `autotestgen` MCP server is registered** (see
`mcp-config/mcp.json`), do the entire login in ONE tool call instead of
walking Steps 3–5 manually:

```jsonc
mcp_oidc_login({
  "baseUrl":             config.application.baseUrl,
  "authType":            config.auth.type,
  "loginPageTitle":      config.auth.loginPageTitle,
  "usernameSelector":    config.auth.usernameSelector,
  "passwordSelector":    config.auth.passwordSelector,
  "submitSelector":      config.auth.submitSelector,
  "postLoginUrlPattern": config.auth.postLoginUrlPattern,
  "username":            <resolved $APP_USERNAME>,
  "password":            <resolved $APP_PASSWORD>,
  "timeoutMs":           30000
})
```

The tool follows up to 5 SSO redirects, handles step-up flows, detects MFA,
and returns:
```json
{ "ok": true, "alreadyAuthenticated": false, "finalUrl": "https://app/dashboard" }
```
or:
```json
{ "ok": false, "error": "MFA challenge detected. ..." }
```

If `ok` is `true` → skip Steps 3–5 and proceed directly to Step 6.
If the tool returns an MFA error → STOP per the MFA handling block in Step 4.
If the `autotestgen` server is NOT available, fall through to Step 3 and
follow the manual primitives below.

---

## Step 3 — Open Application in Browser

Using Playwright MCP browser tool:

1. Navigate to `config.application.baseUrl`
2. Take a browser snapshot immediately — **wait up to 30 seconds** for the page to respond.
   - If no response within 30 seconds → STOP with:
     ```
     Application did not load within 30 seconds at [baseUrl].
     Check that the application is running and the baseUrl is correct.
     ```
3. Detect what is shown:
   - If the login page title matches `config.auth.loginPageTitle` → already on login page, go to Step 4
   - If the URL has changed (redirect occurred to OIDC/Ping provider) → go to Step 4
   - If the application dashboard/home is already visible → already authenticated, take snapshot and go to Step 6

   **Multi-hop SSO redirect chain handling:**
   Corporate environments sometimes chain multiple redirects before the actual
   login page appears (e.g., App → Corporate SSO Portal → Ping Login Page).
   Keep following redirects, re-detecting the state above after each one.
   - Track the number of redirects. If **more than 5 redirects** occur without
     landing on a recognized login page or authenticated dashboard → STOP with:
     ```
     More than 5 SSO redirects occurred without reaching a recognized login page
     or authenticated state.
     Last URL: [current URL]
     Check that auth.loginPageTitle and auth.postLoginUrlPattern are correct in
     pipeline.config.json. If your environment chains through a corporate SSO
     portal, add that portal's login page title to auth.loginPageTitle.
     ```
   - If an **intermediate redirect page** resembles the application dashboard
     (URL matches `postLoginUrlPattern` but no session cookies are present),
     take a snapshot and check for authenticated UI elements (nav menu, user
     profile, etc.) before deciding to skip to Step 6. If those elements are
     absent, continue following redirects.

---

## Step 4 — Handle Auth Flow By Type

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
4. Wait for `config.auth.usernameSelector` to be visible — **timeout 30s.** If the selector does not appear, STOP and report which selector timed out.
5. Fill the username field with the resolved `$APP_USERNAME` value
6. If password field visible on same page:
   - Fill `config.auth.passwordSelector` with resolved `$APP_PASSWORD`
   - Click `config.auth.submitSelector`
7. If step-up flow (username then password on separate page):
   - Submit username → **wait up to 30 seconds** for the password page selector
     (`config.auth.passwordSelector`) to appear. If it does not appear within
     30 seconds → STOP with:
     ```
     Step-up login: password page did not appear within 30 seconds after
     username submission. Check that auth.passwordSelector is correct
     and that the OIDC provider is reachable.
     ```
   - Fill password → click submit
8. After submit, the Ping server validates credentials and redirects back to `config.auth.pkce.redirectUri`
9. The SPA receives the authorization `code` and exchanges it for tokens via PKCE (no secret needed)
10. Confirm the app has loaded the post-login page

**Handle MFA if it appears:**
If an MFA/OTP challenge is detected → STOP and notify:
```
MFA challenge detected on the Ping login page.
PKCE flows with MFA require the test account to have MFA disabled or use a bypass policy.
Please configure a test service account without MFA in Ping, update credentials in .env, and re-run.
```

---

### For `auth.type = "oidc-ping"` or `"oidc-standard"` (Confidential Client):

The flow:
```
App URL → Redirect → OIDC Provider Login Page → Credentials → Token exchange (with client_secret) → App
```

1. Wait for the login page and `config.auth.usernameSelector` to be visible — **timeout 30s.** If timeout, STOP and report.
2. Fill username → fill password → click submit
3. Token exchange happens server-side with client_secret (invisible to browser)
4. Follow redirect back to app

**Handle MFA if it appears (applies to all confidential client flows):**
After submitting credentials, if an MFA/OTP/TOTP challenge page is detected → STOP and notify:
```
MFA challenge detected on the OIDC login page.
Confidential client flows with MFA require the test account to have MFA disabled or use a bypass policy.
Please configure a test service account without MFA in your OIDC provider, update credentials in .env, and re-run.
```

---

### For `auth.type = "basic"`:
1. Wait for `config.auth.usernameSelector` to be visible — **timeout 30s.**
2. Fill `config.auth.usernameSelector` with resolved username
3. Fill `config.auth.passwordSelector` with resolved password
4. Click `config.auth.submitSelector`

---

## Step 5 — Confirm Successful Authentication

After submitting credentials:

1. Wait for navigation to complete — **timeout 30s.** If still on login page after 30s, proceed to failure handling.
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

## Step 6 — Save Authentication State

Save the current browser session as a Playwright `storageState.json`. This
file is the foundation for every generated test — get this wrong and the
whole pipeline downstream breaks.

### Preferred path — `mcp_save_storage_state` (one call)

```jsonc
mcp_save_storage_state({ "outPath": "output/auth/storageState.json" })
```

Returns:
```json
{ "ok": true, "path": "output/auth/storageState.json", "cookies": 12, "localStorageEntries": 4 }
```

If `cookies + localStorageEntries === 0`, the auth did not actually take —
re-run Step 4 once before failing.

Log only:
```
[STAGE 2] storageState.json saved — [N] cookie(s), [M] localStorage entry(ies).
```

If `mcp_save_storage_state` is unavailable, use the **fallback procedure**
below.

### Fallback procedure (manual, exact tool calls in order)

1. **Capture cookies** with `browser_evaluate`:
   ```javascript
   JSON.stringify(await context.cookies())
   ```
   If `context` is not exposed by the MCP runtime, fall back to:
   ```javascript
   JSON.stringify(document.cookie.split('; ').map(c => {
     const [name, ...rest] = c.split('=');
     return { name, value: rest.join('='), domain: location.hostname, path: '/' };
   }))
   ```
   (Fallback is lossy — it loses `httpOnly` cookies. Prefer the `context.cookies()`
   form when available.)

2. **Capture origin storage** with `browser_evaluate`:
   ```javascript
   JSON.stringify({
     origin: location.origin,
     localStorage: Object.fromEntries(Object.entries(localStorage)),
     sessionStorage: Object.fromEntries(Object.entries(sessionStorage))
   })
   ```

3. **Assemble the storage-state object** in memory (do NOT log it):
   ```json
   {
     "cookies": [ /* from step 1 */ ],
     "origins": [
       {
         "origin": "https://your-app-url.com",
         "localStorage": [ { "name": "...", "value": "..." } ]
       }
     ]
   }
   ```
   Convert the `localStorage` object to the `[{name, value}, …]` array shape
   Playwright expects. (Skip `sessionStorage` — Playwright's storageState
   schema does not preserve it; it is captured here only for diagnostic logs
   on failures.)

4. **Write to disk** using `create_file`:
   - Path: `output/auth/storageState.json`
   - Content: the JSON-stringified storage-state object from step 3.

5. **Validation (REQUIRED before declaring success):**
   - Re-read the file with `read_file`.
   - Confirm `cookies` is present and has at least one entry, OR `origins[0].localStorage`
     has at least one entry. An empty `{ "cookies": [], "origins": [] }` means
     auth did not actually take — STOP and re-run Step 4 once before failing.
   - Do NOT log the file's contents. Log only:
     ```
     [STAGE 2] storageState.json saved — [N] cookie(s), [M] localStorage entry(ies).
     ```

**Security:** never echo, log, or include the contents of `storageState.json`
in any other file. Treat it as sensitive — it contains live session tokens.

---

## Step 7 — Verify Auth State is Reusable

> **Do NOT open a new browser context or window for this step.** The Playwright MCP shares
> a single browser session; creating an additional context to verify the file causes a
> second visible browser window that persists into Stage 3. The verification below uses the
> existing browser session and file-level checks — both are sufficient and avoid the second instance.

To confirm the saved state works:

1. **Structural check:** read `output/auth/storageState.json` with `read_file`. Confirm:
   - File parses as JSON.
   - `cookies` array is non-empty, OR `origins[0].localStorage` array is non-empty.
   - If both arrays are empty → the save did not capture the session. Re-run Steps 4–6 once.

2. **Live check:** using the **existing** Playwright MCP browser session (already at the
   authenticated dashboard after Steps 3–5), navigate to
   `config.application.baseUrl + config.auth.postLoginUrlPattern` and take a snapshot.
   Confirm:
   - The URL contains `postLoginUrlPattern` (no redirect to login).
   - A known authenticated UI element is visible (nav menu, user profile heading, dashboard).

3. If the live check fails (login page appears or navigation times out after 30s) →
   re-run Steps 4–6 once. If it fails a second time → STOP with error.

Log:
```
[STAGE 2] Verification PASSED — storageState.json is valid and session is active.
```

---

## Step 8 — Generate Auth Fixture Stub

Based on the fingerprint (or new project tech stack), generate a reusable auth fixture stub
that will be used by all generated test files.

**Resolve namespace / package placeholders BEFORE writing any file:**

The Java / C# templates below contain `[ProjectNamespace]` and `[your.package]`
placeholders. Replace them deterministically — do NOT leave them literal in
the generated files.

| Project mode | Source                                                           | Fallback if absent           |
|--------------|------------------------------------------------------------------|------------------------------|
| existing — Java   | `projectFingerprint.javaPackage` (top-level package detected from existing `pom.xml` / source tree) | derive from project folder name (lowercase, dot-separated) |
| existing — C#     | `projectFingerprint.csharpNamespace` (root namespace from `.csproj` `<RootNamespace>`) | derive from project folder name (PascalCase) |
| new — Java        | derive from `project.newProjectPath` folder name (lowercase, dot-separated) | `com.autotestgen.tests`      |
| new — C#          | derive from `project.newProjectPath` folder name (PascalCase) | `AutoTestGen.Tests`           |

Apply the resolved values via direct substitution into the template strings
before writing — every occurrence of `[your.package]` becomes the resolved
package, every `[ProjectNamespace]` becomes the resolved namespace. If the
resolved value contains characters that are invalid in a Java package or C#
namespace, sanitize (replace with `_`).

**PKCE note:** The `storageState.json` saved in Step 6 contains the session cookies and
tokens that the SPA received after the PKCE exchange. Tests reuse this saved state directly —
they do NOT re-initiate the PKCE flow. This is correct and safe. The PKCE flow only runs once
during pipeline setup (this stage), not per test.

> **`auth.type = "none"` — no-auth fixture variant:**
> If `auth.type` is `"none"`, skip all framework-specific stubs below EXCEPT the Playwright section.
> For Playwright, generate the no-auth variant instead of the standard auth fixture:
> ```typescript
> // Auto-generated by AutoTestGen Stage 2
> // auth.type = "none" — this application requires no authentication
> export { test, expect } from '@playwright/test';
> export const STORAGE_STATE = null;
> ```
> For Selenium (Java/C#/JS) and WebdriverIO with `auth.type = "none"`, no auth fixture is needed.
> Skip fixture generation for those frameworks. Stage 7 will generate tests that navigate directly
> without any auth setup.

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

## Step 9 — Stage 2 Completion

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
