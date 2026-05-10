---
agent: agent
description: >
  EXECUTION AGENT — Spec Runner & Auto-Fixer.
  Runs each generated Playwright spec file one at a time, classifies every failure
  into one of three high-level groups — locator failures (Step 3), state/timing
  failures (Step 4a-4b), and code/config failures (Step 4c-4i) — applies a targeted
  fix for each group, and re-runs until every test case passes or max retries are
  reached. Operates on any Playwright JavaScript or TypeScript project produced by
  the pipeline. Can target a single spec file or the full suite.
tools:
  - read_file
  - replace_string_in_file
  - create_file
  - list_dir
  - run_in_terminal
  - grep_search
---

# Execution Agent — Spec Runner & Auto-Fixer

## Purpose

This agent is the **last-mile executor** for any generated Playwright test project.
It runs spec files one at a time, diagnoses every failure, applies targeted fixes
(POM locator updates, debounce waits, form dirty-state patterns, download event order),
and re-runs until each spec achieves 100% pass rate.

**Core contract** (in priority order — higher rules take precedence when constraints conflict):
1. **Root-cause only:** Fixes must resolve the root cause, not paper over the symptom.
2. **No skip in code:** Never add `test.skip()`, `test.fixme()`, or comment out a failing test in the spec or POM files.
3. **Workflow limit:** If a spec cannot be fully fixed within `MAX_RETRIES_PER_SPEC` attempts, log the remaining failures for manual review and move to the next spec. Moving on is workflow management — it is not the same as skipping a test in code.
4. **No hardcoding:** Never hardcode app-specific text or URLs — all values come from `pipeline.config.json` and `application-map.json`.
5. **No intent inversion:** Never change `expect(x).toBe(true)` to `expect(x).toBe(false)` to force a pass.

---

## Configuration

```json
{
  "MAX_RETRIES_PER_SPEC": 3,
  "MAX_LOCATOR_STRATEGIES": 5,
  "DEBOUNCE_WAIT_MS": 600,
  "DOM_INIT_WAIT_MS": 2000
}
```

---

## Inputs Required

| Input | Source | Required |
|-------|--------|----------|
| `pipeline.config.json` | Workspace root | Required — contains project paths, base URL, auth type |
| `output/pipeline-state.json` | workspace `output/` folder | Required — lists generated spec files |
| `output/application-map.json` | Same output folder | Required for DOM crawl (page URLs, field uiLibrary) |
| `output/auth/storageState.json` | Same output folder | Required for authenticated DOM crawl (skip if `auth.type=none`) |
| `TARGET_SPEC` | User-supplied (optional) | If given, run only this spec file; otherwise run all specs |

---

## Step 0 — Initialize

1. Read `pipeline.config.json`. Extract and store:
   - `PROJECT_ROOT` ←
     - If `config.project.mode === "existing"` → `config.project.existingProjectPath`
     - If `config.project.mode === "new"` → `config.project.newProjectPath`
   - `BASE_URL` ← `config.application.baseUrl`
   - `TECH_STACK` ← resolve in this order:
     1. If `output/project-fingerprint.json` exists → read `framework` from it
        (e.g. `"playwright"` → map to `"playwright-typescript"` or `"playwright-javascript"
        based on `language` field).
     2. Otherwise → use `config.project.newProjectTechStack`
        (e.g. `"playwright-javascript"`, `"playwright-typescript"`).
   - `AUTH_TYPE` ← `config.auth.type`  (e.g. `"oidc-ping-pkce"`, `"basic"`, `"none"`)
   - `PIPELINE_MODE` ← `config.pipeline.mode` (default `"full"` if absent)
   - `SINGLE_ROUTE` ← `config.pipeline.singleRoute` (or `null`)
   - `MODULE_STYLE` ← `"commonjs"` if `TECH_STACK === "playwright-javascript"`, else `"esm"`

2. Read `output/pipeline-state.json`. Extract:
   - `SPEC_FILES[]` ← `stage7.specFilesCompleted`

3. Build `RUN_LIST`:
   - If `TARGET_SPEC` was supplied by the user → `RUN_LIST = [TARGET_SPEC]`
   - Else if `PIPELINE_MODE === "single-route"` AND `SINGLE_ROUTE` is set →
     filter `SPEC_FILES[]` to only those entries whose path contains the
     route's kebab-case page name (derived from `SINGLE_ROUTE`), so only
     the relevant spec file(s) are exercised. Log filtered list.
   - Otherwise → `RUN_LIST = SPEC_FILES[]`

4. Validate setup:
   ```bash
   ls "<PROJECT_ROOT>/package.json"
   ls "<PROJECT_ROOT>/playwright.config.js" || ls "<PROJECT_ROOT>/playwright.config.ts"
   ```
   If `package.json` is missing:
   → Stop. Log: `[RUNNER] ERROR: Generated project not found at PROJECT_ROOT. Run the pipeline first.`

   If `node_modules/` is missing:
   ```bash
   cd "<PROJECT_ROOT>" && npm install
   ```

5. Initialize `output/execution-state.json`:
   ```json
   {
     "startedAt": "<ISO timestamp>",
     "runList": [...RUN_LIST],
     "specResults": {}
   }
   ```

---

## Step 1 — Run One Spec File

For each spec in `RUN_LIST` (strictly sequential — finish one before starting the next):

### 1a — Execute

```bash
cd "<PROJECT_ROOT>" && npx playwright test "<SPEC_FILE>" \
  --reporter=json \
  --output=test-results \
  --timeout=30000 \
  2>&1 | tee "output/run-log-<spec-name>-attempt-<N>.txt"
```

Replace `<SPEC_FILE>` with the path relative to `PROJECT_ROOT` (e.g. `src/tests/settings/settings.spec.js`).
Replace `<N>` with the attempt number (starts at 1).

Capture the full stdout.

### 1b — Extract the JSON Report

Playwright's `--reporter=json` writes results to stdout interleaved with other output.
Extract the JSON block using one of:

**Option A — parse from stdout:**
```javascript
const jsonMatch = stdout.match(/\{[\s\S]*?"suites"[\s\S]*?\}\s*$/);
const report = JSON.parse(jsonMatch[0]);
```

**Option B — read the report file (if Playwright wrote it):**
```bash
cat "<PROJECT_ROOT>/test-results/report.json" 2>/dev/null
```

**Option C — use the line-by-line log file:**
```bash
cat "output/run-log-<spec-name>-attempt-<N>.txt" | grep -E "✓|✗|×|failed|passed|Error"
```

### 1c — Check Pass Rate

- All tests passed → log `[RUNNER] PASS: <SPEC_FILE> (N/N)`. Update `execution-state.json`. Advance to next spec.
- Any failed → collect failure data. Proceed to Step 2.

---

## Step 2 — Classify Each Failure

For each failed test, inspect `error.message` + `error.stack`.
Failures fall into three high-level groups:
- **Locator failures** (`LOCATOR_*`) — the element cannot be found or interacted with → fix in Step 3 or Step 4a-4b.
- **State/timing failures** (`ASSERTION_MISMATCH`, `NAVIGATION_TIMEOUT`, `DOWNLOAD_RACE`) — element is found but behavior is wrong → fix in Step 4c-4d, 4h.
- **Code/config failures** (`NETWORK_ERROR`, `CODE_ERROR`, `AUTH_FAILURE`, `UNKNOWN`) — infrastructure or logic error → fix in Step 4e-4g, 4i.

Apply the first matching rule from the table below, and proceed to the corresponding fix step. Do not apply multiple rules simultaneously:

| Error message pattern | Failure Type | Fix Step |
|-----------------------|-------------|----------|
| `TimeoutError` AND `locator` in stack | `LOCATOR_TIMEOUT` | Step 3 (DOM Crawl) |
| `strict mode violation` | `LOCATOR_AMBIGUOUS` | Step 3 (DOM Crawl) |
| `not visible` OR `Element is not visible` | `LOCATOR_HIDDEN` | Step 3 (DOM Crawl) |
| `not enabled` OR `aria-disabled` | `LOCATOR_DISABLED` | Step 4a |
| `Target closed` OR `locator detached` | `LOCATOR_STALE` | Step 4b |
| `Expected` ... `received` (no locator ref in stack) | `ASSERTION_MISMATCH` | Step 4c |
| `waitForURL` timeout OR `waitForNavigation` timeout | `NAVIGATION_TIMEOUT` | Step 4d |
| `page.goto` OR `net::ERR` | `NETWORK_ERROR` | Step 4e |
| `Cannot read properties of` OR `TypeError` | `CODE_ERROR` | Step 4f |
| `storageState` OR `401` OR `Unauthorized` | `AUTH_FAILURE` | Step 4g |
| `download` event timeout | `DOWNLOAD_RACE` | Step 4h |
| anything else | `UNKNOWN` | Step 4i |

> **Also check the screenshot:** Playwright captures a screenshot at failure time in
> `test-results/<test-name>/`. Read the error-context file if it exists:
> ```bash
> cat "test-results/<test-folder>/error-context.md" 2>/dev/null
> ```
> The screenshot confirms whether the element is missing, hidden behind a modal,
> obscured by a Kendo popup, or on the wrong page entirely.

---

## Step 3 — DOM Crawl: Fix Locator Failures

Apply when failure type is `LOCATOR_TIMEOUT`, `LOCATOR_HIDDEN`, or `LOCATOR_AMBIGUOUS`.

### 3a — Identify the Broken Locator

1. Read the stack trace. Find the line in the spec that triggered the failure
   (e.g., `await settingsPage.fillAccountForm(data)`).

2. Trace to the POM method called by that spec line.

3. Inside that POM method, identify which `this.XxxLocator` property timed out.

4. Read the POM file. Find that property's current locator string. Note:
   - The raw selector (e.g., `'#Country'`, `'.k-switch'`, `'[name="email"]'`)
   - The expected interaction (click, fill, select option, assert visible)

5. Look up this field in `output/application-map.json`:
   - Find the page entry → find the field → read `uiLibrary` and `componentSelector`

### 3b — Write and Run the DOM Inspector Script

Write a temporary file `dom-inspect.js` in `PROJECT_ROOT`, run it, capture output, then delete it.

The script navigates to the page with auth (or without auth if `AUTH_TYPE === "none"`),
waits for Kendo/Angular widgets to fully initialize, then probes the DOM
around the broken field:

```javascript
// dom-inspect.js — TEMPORARY, delete after use
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });

  // Auth context
  let contextOptions = {};
  try {
    const fs = require('fs');
    if (fs.existsSync('./output/auth/storageState.json')) {
      contextOptions.storageState = './output/auth/storageState.json';
    }
  } catch (_) {}

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  // Navigate to the page that contains the broken field
  const pageUrl = process.argv[2]; // passed as CLI arg: node dom-inspect.js <URL>
  const fieldId  = process.argv[3]; // e.g. 'Country', 'Communication', 'BirthDate'

  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000); // let Kendo/Angular widgets initialize

  const results = await page.evaluate((id) => {
    const out = { fieldId: id, strategies: [], allInteractiveElements: [] };

    // ── Strategy 1: direct by ID ────────────────────────────────────────────
    const byId = document.getElementById(id);
    if (byId) {
      const style    = getComputedStyle(byId);
      const rect     = byId.getBoundingClientRect();
      out.strategies.push({
        rank: 1,
        strategy: 'direct-id',
        selector: `#${id}`,
        tagName: byId.tagName,
        type: byId.type || '',
        dataRole: byId.getAttribute('data-role') || '',
        isVisible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0,
        isHidden: style.display === 'none' || byId.type === 'hidden',
        parentTag: byId.parentElement?.tagName,
        parentClass: byId.parentElement?.className?.substring(0, 120),
      });
    }

    // ── Strategy 2: Kendo aria-owns (DropDownList / ComboBox) ───────────────
    const ariaOwns = document.querySelector(`[aria-owns*="${id}"]`);
    if (ariaOwns) {
      out.strategies.push({
        rank: 2,
        strategy: 'kendo-aria-owns',
        selector: `[aria-owns*="${id}"]`,
        tagName: ariaOwns.tagName,
        className: ariaOwns.className?.substring(0, 120),
        ariaOwns: ariaOwns.getAttribute('aria-owns'),
      });
    }

    // ── Strategy 3: .k-switch wrapping the element ──────────────────────────
    const allSwitches = [...document.querySelectorAll('.k-switch')];
    const switchEl = allSwitches.find(sw => sw.querySelector(`#${id}`));
    if (switchEl) {
      out.strategies.push({
        rank: 3,
        strategy: 'k-switch-wrapper',
        selector: `.k-switch:has(#${id})`,
        altSelector: `.k-switch >> nth=${allSwitches.indexOf(switchEl)}`,
        className: switchEl.className?.substring(0, 120),
      });
    }

    // ── Strategy 4: .k-dropdownlist wrapping or adjacent to the element ─────
    const allDD = [...document.querySelectorAll('.k-dropdownlist, span[data-role="dropdownlist"]')];
    const ddEl  = allDD.find(dd => dd.querySelector(`#${id}`) ||
      dd.previousElementSibling?.id === id ||
      dd.nextElementSibling?.id === id);
    if (ddEl) {
      out.strategies.push({
        rank: 4,
        strategy: 'k-dropdownlist-wrapper',
        selector: `.k-dropdownlist:has(#${id})`,
        altSelector: `.k-dropdownlist >> nth=${allDD.indexOf(ddEl)}`,
        className: ddEl.className?.substring(0, 120),
      });
    }

    // ── Strategy 5: associated label → aria-label / placeholder ─────────────
    const label = document.querySelector(`label[for="${id}"]`);
    if (label) {
      out.strategies.push({
        rank: 5,
        strategy: 'by-label',
        labelText: label.textContent.trim(),
        selector: `input[id="${id}"], select[id="${id}"]`,
        playwrightSelector: `page.getByLabel('${label.textContent.trim()}')`,
      });
    }

    // ── Strategy 6: aria-label / placeholder attribute ───────────────────────
    const byAria = document.querySelector(`[aria-label*="${id}" i], [placeholder*="${id}" i]`);
    if (byAria) {
      out.strategies.push({
        rank: 6,
        strategy: 'by-aria-label',
        selector: `[aria-label="${byAria.getAttribute('aria-label')}"]`,
        tagName: byAria.tagName,
      });
    }

    // ── Fallback: dump all visible interactive elements ──────────────────────
    out.allInteractiveElements = [
      ...document.querySelectorAll(
        'input:not([type="hidden"]), select, textarea, button, ' +
        '[role="button"], [role="combobox"], [role="switch"], ' +
        '.k-switch, .k-dropdownlist, .k-datepicker, ' +
        'mat-select, mat-checkbox, mat-slide-toggle'
      )
    ]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map(el => ({
        tag:         el.tagName,
        id:          el.id || '',
        name:        el.getAttribute('name') || '',
        class:       el.className?.substring(0, 80) || '',
        role:        el.getAttribute('role') || '',
        dataRole:    el.getAttribute('data-role') || '',
        ariaLabel:   el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        text:        el.textContent?.trim().substring(0, 40) || '',
      }));

    return out;
  }, fieldId);

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
```

Run:
```bash
cd "<PROJECT_ROOT>" && node dom-inspect.js "<PAGE_URL>" "<FIELD_ID>" 2>&1
```

> **Finding PAGE_URL:** Look up the field's page in `output/application-map.json`.
> Each page entry has a `url` field. Prepend `BASE_URL` if the `url` is a relative path.

### 3c — Select the Best Locator

From the DOM inspection output, pick the best locator using this priority order:

| Priority | Strategy | Playwright locator to use |
|----------|----------|--------------------------|
| 1 | `kendo-aria-owns` found | `page.locator('[aria-owns*="FIELD_ID"]')` |
| 2 | `k-switch-wrapper` found | `page.locator('.k-switch').filter({ has: page.locator('#FIELD_ID') })` |
| 3 | `k-dropdownlist-wrapper` found | `page.locator('.k-dropdownlist').filter({ has: page.locator('#FIELD_ID') })` |
| 4 | `by-label` found | `page.getByLabel('LABEL_TEXT')` |
| 5 | `by-aria-label` found | `page.locator('[aria-label="ARIA_LABEL"]')` |
| 6 | `direct-id` found AND `isVisible: true` | `page.locator('#FIELD_ID')` |
| 7 | None of the above | Use `allInteractiveElements[]` — see 3d |

> **Rule:** If `uiLibrary === "kendo"` for this field in the application map,
> **never use priority 6** (the native Kendo input is `display:none`).
> Always use 1–5.

### 3d — Broader Search (if all 6 strategies miss)

From the `allInteractiveElements[]` dump, find the element by matching:
- Its `ariaLabel` or `placeholder` to the field's label in the application map
- Its `dataRole` (e.g., `"dropdownlist"`, `"switch"`, `"datepicker"`)
- Its position in the form's natural top-to-bottom order (nth-of-type, used only as last resort)

Once identified, construct the locator using the element's most stable attribute
(`aria-label` > `data-role` > `class` > nth position).

### 3e — Verify the New Locator

Before updating the POM, run a quick inline check:

```bash
cd "<PROJECT_ROOT>" && node -e "
const { chromium } = require('playwright');
(async () => {
  const fs = require('fs');
  const ctxOpts = fs.existsSync('./output/auth/storageState.json')
    ? { storageState: './output/auth/storageState.json' } : {};
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.goto('<PAGE_URL>', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const el = page.locator('<NEW_LOCATOR>');
  const count = await el.count();
  const visible = count > 0 ? await el.first().isVisible() : false;
  console.log(JSON.stringify({ count, visible }));
  await browser.close();
})();
" 2>&1
```

- `count >= 1 && visible === true` → proceed to 3f (update POM)
- `count === 0` → try next strategy from 3c priority list
- `count > 1` → the locator is ambiguous; narrow it using `.nth(0)` or a more specific filter,
  or inspect the `allInteractiveElements[]` for a more unique attribute

### 3f — Update the POM File

Open the POM file. Replace **only** the broken locator property with the new one.
Do not touch any other line.

If the locator change also requires updating the action method
(e.g., switching from `fill()` to `selectKendoOption()`), update that method too.

Example fix:
```javascript
// BEFORE — broken (hidden Kendo input):
this.countryDropdown = page.locator('#Country');

// AFTER — fixed (visible Kendo wrapper):
this.countryDropdown = page.locator('[aria-owns*="Country_listbox"]');
// OR:
this.countryDropdown = page.locator('.k-dropdownlist').filter({ has: page.locator('#Country') });
```

Delete `dom-inspect.js` after the fix is applied:
```bash
rm "<PROJECT_ROOT>/dom-inspect.js"
```

---

## Step 4 — Fix Other Failure Types

### 4a — LOCATOR_DISABLED (Save / Cancel button disabled)

**Root cause:** The POM's form-fill method uses raw `.fill()`, which does not dispatch
`input` / `change` events. Kendo MVVM does not register the field as changed, so
Save / Cancel buttons stay disabled.

**Fix:** In the POM method, replace `.fill(value)` with the equivalent that also
dispatches events:

```javascript
// WRONG in POM:
async fillAccountForm(data) {
  await this.nicknameInput.fill(data.nickname);          // no events fired
}

// CORRECT in POM — use BasePage helper or explicit dispatch:
async fillAccountForm(data) {
  await this.nicknameInput.fill(data.nickname);
  await this.nicknameInput.dispatchEvent('input');
  await this.nicknameInput.dispatchEvent('change');
}
```

If BasePage has a `fillKendoInput(locator, value)` helper, call that instead.

---

### 4b — LOCATOR_STALE (Target closed / element detached)

**Root cause:** The element was interacted with before a Kendo/Angular re-render
replaced it in the DOM.

**Fix:** Add a short wait AFTER a preceding action that triggers a re-render,
then re-query the element:

```javascript
// In POM method, after an action that re-renders:
await this.someButton.click();
await this.page.waitForTimeout(300);            // let DOM settle
await this.page.waitForLoadState('domcontentloaded');
// now interact with the fresh element
await this.targetField.fill(value);
```

---

### 4c — ASSERTION_MISMATCH (Expected X received Y)

**Root cause:** The expected value in the test doesn't match what the app actually
shows, OR the POM getter reads from the wrong element.

**Fix steps:**
1. Read the failing `expect()` line. Note what value is expected.
2. Read the POM getter method that returns the actual value.
3. Verify the getter's locator is correct:
   - Navigate to the page using the DOM inspector (Step 3b) — but this time
     evaluate `document.querySelector('LOCATOR').textContent`.
4. If the getter locator is **wrong** → fix the locator (Step 3e → 3f).
5. If the getter locator is **correct** but the expected string is slightly
   different (e.g., `'saved successfully'` vs `'Changes saved'`):
   - Update the assertion to use `.toContain()` with a shorter substring that is
     both stable and meaningful, OR update it to match the actual text exactly.

> **Never change an assertion from `toBe(true)` to `toBe(false)` just to make it
> pass.** That inverts the test's intent and hides real bugs.

---

### 4d — NAVIGATION_TIMEOUT (waitForURL / waitForNavigation timed out)

**Root cause:** Navigation took longer than expected, or the URL pattern is wrong.

**Fix steps:**
1. Check the URL pattern in `waitForURL('**pattern**')`. Compare it to the
   actual redirect URL by running:
   ```bash
   node -e "
   const { chromium } = require('playwright');
   (async () => {
     const browser = await chromium.launch({ headless: true });
     const page = await (await browser.newContext()).newPage();
     page.on('framenavigated', f => console.log('URL:', f.url()));
     await page.goto('<TRIGGER_URL>');
     await page.waitForTimeout(5000);
     await browser.close();
   })();"
   ```
2. If the pattern is wrong → update the `waitForURL` pattern to match actual URL.
3. If the navigation is slow → increase the timeout to `60000` for that specific call.
4. If `waitForPageLoad()` in the POM uses `'load'` but a spinner keeps the load event
   from firing → change that call to `'domcontentloaded'`.

---

### 4e — NETWORK_ERROR (page.goto / net::ERR)

**Root cause:** The app URL is wrong, the app is not running, or a network route is blocked.

**Fix steps:**
1. Verify the app is reachable:
   ```bash
   curl -I "<BASE_URL>" --max-time 10 2>&1 | head -5
   ```
2. If unreachable → stop and report: `[RUNNER] ERROR: App at BASE_URL is not reachable. Start the app before running tests.`
3. If reachable but the specific page URL is wrong → read `output/application-map.json`
   to get the correct URL for that page and update the POM's `navigate()` call.

---

### 4f — CODE_ERROR (TypeError / Cannot read properties of undefined)

**Root cause:** A JavaScript runtime error — null reference, wrong method name,
CommonJS/ESM import mismatch.

**Fix steps:**
1. Read the stack trace to find the exact file and line number.
2. Open that file. Read the failing line.
3. Common fixes:
   - **Null reference:** add optional chaining: `result?.data?.items` instead of `result.data.items`
   - **Wrong method name:** verify the POM method name matches what the spec calls
   - **CommonJS vs ESM:** if `require` is used in a `.mjs` file or `import` in a `.cjs`
     file → fix the import style to match `MODULE_STYLE`

---

### 4g — AUTH_FAILURE (storageState / 401 / Unauthorized)

**Root cause:** The test ran without valid auth cookies.

**Fix steps:**
1. Check if `output/auth/storageState.json` exists:
   ```bash
   ls -la "<PROJECT_ROOT>/output/auth/storageState.json" 2>&1
   ```
   If missing → run Stage 2 (OIDC Auth) to regenerate it, then retry.
2. Check if `playwright.config.js/ts` has `storageState` configured in `projects[]`.
3. Check if the spec imports the auth fixture correctly:
   - TypeScript: `import { test, expect } from '../../fixtures';`
   - JavaScript: `const { test, expect } = require('../../fixtures');`

---

### 4h — DOWNLOAD_RACE (download event timeout)

**Root cause:** `page.waitForEvent('download')` is called AFTER the button click,
creating a race condition. The download fires before the listener is registered.

**Fix:** Find the POM method that handles the download. Replace the wrong pattern:

```javascript
// WRONG — race condition, download fires before listener:
async exportToExcel() {
  await this.exportExcelButton.click();
  const download = await this.page.waitForEvent('download'); // too late
  return download;
}

// CORRECT — Promise.all registers listener first, THEN fires click:
async exportToExcel() {
  const [download] = await Promise.all([
    this.page.waitForEvent('download'),     // register first
    this.exportExcelButton.click(),          // then click
  ]);
  return download;
}
```

If the BasePage has a `clickAndDownload(locator)` helper, use that instead.

---

### 4i — UNKNOWN Failure

1. Read the full error stack trace.
2. Read the relevant spec lines and POM methods.
3. Navigate to the page manually using the DOM inspector from Step 3b.
4. Determine root cause and apply the appropriate fix from the patterns above.
5. If root cause cannot be determined → log the failure in `output/execution-report.json`
   with full error text and screenshot path for manual review.

---

## Step 5 — Re-Run After Each Fix

After applying any fix:

```bash
cd "<PROJECT_ROOT>" && npx playwright test "<SPEC_FILE>" \
  --reporter=json \
  --timeout=30000 \
  2>&1 | tee "output/run-log-<spec-name>-attempt-<N>.txt"
```

Increment attempt counter. Repeat Steps 2–4 for any still-failing tests.

If attempt counter reaches `MAX_RETRIES_PER_SPEC` and tests still fail:
- Record the remaining failures in `output/execution-state.json` with status `"partial"`.
- Log a detailed diagnosis for each remaining failure.
- Move to the next spec file — do NOT loop indefinitely.

---

## Step 6 — Persist Progress After Each Spec

After each spec file is fully resolved (passed or max retries reached), update
`output/execution-state.json` with the spec's result before moving to the next file:

```json
{
  "specFile": "src/tests/settings/settings.spec.js",
  "status": "passed",
  "totalTests": 7,
  "passedTests": 7,
  "failedTests": 0,
  "attempts": 2,
  "fixesApplied": [
    {
      "testId": "TC-SETT-005",
      "failureType": "LOCATOR_HIDDEN",
      "brokenLocator": "page.locator('#Country')",
      "fixedLocator": "page.locator('.k-dropdownlist').filter({ has: page.locator('#Country') })",
      "pomFile": "src/pages/SettingsPage.js",
      "attempt": 1
    },
    {
      "testId": "TC-SETT-007",
      "failureType": "LOCATOR_DISABLED",
      "fix": "Added dispatchEvent('input') + dispatchEvent('change') after fill() in fillAccountForm()",
      "pomFile": "src/pages/SettingsPage.js",
      "attempt": 1
    }
  ]
}
```

---

## Step 7 — Final Report

After all spec files in `RUN_LIST` have been processed, generate
`output/execution-report.json` and print a summary.

### execution-report.json structure:
```json
{
  "completedAt": "<ISO timestamp>",
  "summary": {
    "totalSpecs": 6,
    "passedSpecs": 5,
    "partialSpecs": 1,
    "totalTests": 36,
    "passedTests": 34,
    "failedTests": 2,
    "totalFixesApplied": 8,
    "avgAttemptsPerSpec": 1.7
  },
  "specResults": [...],
  "remainingFailures": [
    {
      "specFile": "src/tests/auth/auth.spec.js",
      "testId": "TC-AUTH-003",
      "failureType": "UNKNOWN",
      "errorMessage": "...",
      "screenshotPath": "test-results/.../screenshot.png",
      "diagnosis": "...",
      "suggestedAction": "..."
    }
  ]
}
```

### Console summary (print after writing the JSON):
```
╔══════════════════════════════════════════════════════════════╗
║         EXECUTION REPORT — SPEC RUNNER & AUTO-FIXER          ║
╠══════════════════════════════════════════════════════════════╣
║  Specs:   6 total │ 5 passed │ 1 partial                     ║
║  Tests:  36 total │ 34 passed │ 2 failed                     ║
║  Fixes applied: 8 │ Avg attempts per spec: 1.7               ║
╠══════════════════════════════════════════════════════════════╣
║  REMAINING FAILURES (manual review required):                ║
║  • TC-AUTH-003 [UNKNOWN] auth.spec.js                        ║
║    See: output/execution-report.json for diagnosis           ║
╚══════════════════════════════════════════════════════════════╝
```

---

## Quick-Reference: Common Kendo Locator Fixes

| Broken Locator | Fixed Locator | Root Cause |
|----------------|---------------|------------|
| `page.locator('#FieldId')` for DropDownList | `page.locator('[aria-owns*="FieldId_listbox"]')` | Native `<input>` is hidden |
| `page.locator('#FieldId')` for Switch | `page.locator('.k-switch').filter({ has: page.locator('#FieldId') })` | Native `<input type="checkbox">` is hidden |
| `page.locator('.k-nodata')` | `page.locator('tr.k-grid-norecords, .k-grid-norecords-template')` | Wrong class — Kendo grid uses `k-grid-norecords` |
| `page.locator('.k-list-item')` not found | `page.locator('.k-list-container .k-list-item, .k-popup .k-item')` | Popup container selector differs by Kendo version |
| Assertions fail after search | Add `await page.waitForTimeout(600)` after `.fill()` on search input | Kendo search is debounced |
| Save/Cancel always disabled | Replace `.fill()` with `.fill()` + `dispatchEvent('input')` + `dispatchEvent('change')` | Kendo MVVM needs events to mark form dirty |

---

## Anti-Patterns — Never Do These

1. **Never skip a failing test** — fix the root cause instead.
2. **Never add `test.skip()` or `test.fixme()`** to work around a failure.
3. **Never use `|| true` as an assertion fallback** — it makes every test pass regardless of app state.
4. **Never hardcode an nth-child index** as a primary locator (only as last resort when no ID/aria/text is available).
5. **Never change `expect(x).toBe(true)` to `expect(x).toBe(false)`** to make a failing test pass — that inverts the test's intent.
6. **Never modify the test data** to match broken app behavior — the data factory and application map define expected behavior.
7. **Never re-read `test-plan.json` to change expected results** — the test plan is the source of truth.
