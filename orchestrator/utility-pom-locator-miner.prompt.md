---
mode: agent
description: >
  UTILITY — POM Locator Miner.
  Performs a deep scan of existing Page Object Model classes in a manual /
  Playwright / Selenium / WebdriverIO project. For every page class it
  captures: full class anatomy (class name, page URL pattern, constructor
  args, navigation methods, action methods, getter methods, assertion helpers),
  every locator strategy in use (data-testid, id, name, aria-*, getByRole,
  getByLabel, css, xpath, chained, nth, filter, shadow-DOM, iframe, etc.),
  complex scenario-specific element patterns (dynamic table rows, modal
  elements, conditional visibility, shadow DOM, iframes, repeated components),
  wait and assertion strategies, and per-control-type UI library habits.
  Aggregates all of this into a rich timestamped learning JSON so Stage 3
  (DOM crawler) and Stage 7 (test generator) can mirror the project's real
  element-finding and interaction conventions exactly.
tools:
  - read_file
  - create_file
  - list_dir
  - grep_search
  - mcp_pom_mine_locators
---

# Utility — POM Locator Miner

## When to run this
- **Onboarding** an existing manual / automated test project to AutoTestGen.
- **After a major refactor** of POMs (new locator conventions, new UI library
  introduced, large add of `data-testid` attributes).
- **Periodically** (e.g. monthly) so Stage 3 keeps learning from the team's
  evolving locator style.

This is a **standalone** prompt — it is NOT part of the master orchestrator's
8-stage pipeline. Run it whenever you need to refresh the project's locator
fingerprint. The pipeline still works without learnings; the miner just
makes Stage 3 smarter.

## Inputs Required
- `pipeline.config.json` → `learning.learningProjectPath` (the project to
  scan). Or, when running on a different project ad-hoc, the user can pass
  an absolute path inline at invocation.
- `output/project-fingerprint.json` (optional) — if present, used to scope
  the scan to known POM folders. If absent, the miner walks the whole
  project looking for POM-shaped files.

## Outputs
- A new file `learning/locator-learning-<ISO-timestamp>.json` (one per scan).
- Update of `learning/INDEX.json` listing every scan, newest first.

The `learning/` folder lives at workspace root. Each scan creates a new
file; old files are never modified or deleted by this prompt — retention is
manual.

---

## Step 0 — Preferred path: single `mcp_pom_mine_locators` call

When the `autotestgen` MCP server is registered, replace Steps 1–4 below
with one call:

```jsonc
mcp_pom_mine_locators({
  "projectPath": <resolved learning.learningProjectPath>,
  "framework":   "auto"
})
```

Returns the full `locator-learning-*.json` aggregate (schema +
locatorStrategies + per-control-type rollups + framework detection)
without the prompt having to read any POM file directly.

Steps 1–4 below remain as the **fallback** when the custom MCP server is
not available. Step 5 (compose JSON), Step 6 (write to `learning/`), and
Step 7 (print summary) still apply either way.

---

## Step 1 — Locate POM Files

Determine the target project path:

1. If invoked via the orchestrator → use `learning.learningProjectPath`.
2. If invoked directly with a path argument → use that.
3. If `output/project-fingerprint.json` exists → use
   `projectFingerprint.folders.pages` to scope the scan.
4. Otherwise scan the whole project for POM-shaped files using these
   patterns:

```
Playwright TS/JS:    src/pages/**/*.{ts,js}, **/pages/**/*.{ts,js}
Selenium Java:       src/main/java/**/pages/**/*.java, src/test/java/**/pages/**/*.java
Selenium C#/.NET:    **/Pages/**/*.cs, **/PageObjects/**/*.cs
selenium-js:         pages/**/*.js, src/pages/**/*.js
WebdriverIO:         test/pageobjects/**/*.js, pages/**/*.js
Manual / mixed:      any file matching *Page.{ts,js,java,cs} or *PageObject.{ts,js,java,cs}
```

Skip `node_modules/`, `vendor/`, `bin/`, `obj/`, `target/`, `build/`, `dist/`.

Record the file list in memory; do NOT read all files at once.

---

## Step 2 — Detect Framework + UI Library

For each candidate file, determine framework from imports / namespaces:

| Signal                                            | Framework               |
|---------------------------------------------------|-------------------------|
| `from '@playwright/test'`                         | playwright-typescript / -javascript |
| `import org.openqa.selenium`                      | selenium-java           |
| `using OpenQA.Selenium`                           | selenium-dotnet         |
| `require('selenium-webdriver')`                   | selenium-js             |
| `browser.$(`, `wdio` config / no driver param     | webdriverio             |

Detect UI library hints in the file content:
- `kendo-`, `.k-`, `window.kendo` → `kendo`
- `mat-`, `.mat-`, `cdk-overlay` → `material`
- otherwise → `native`

Record per-file framework + uiLibraries.

---

## Step 3 — Extract Locator Strategies

**Resume support:** Before processing any POM file, check whether
`learning/miner-checkpoint.json` exists.

- If it exists, read it and collect `filesProcessed` (list of file paths
  already scanned). Skip those files in the loop below.
  Log: `[MINER] Resuming — [N] file(s) already processed in prior run.`
- If it does not exist, start fresh. Create `learning/miner-checkpoint.json`
  with `{ "filesProcessed": [] }` before entering the loop.

After each POM file is successfully processed, append its path to
`miner-checkpoint.json → filesProcessed` and persist the file. This ensures
that if the miner is interrupted (network error, context limit, crash), the
next invocation resumes from the last successfully processed file rather
than restarting from scratch.

When Step 6 completes successfully, delete `learning/miner-checkpoint.json`
(the scan is complete; the checkpoint is no longer needed).

**Streaming discipline (REQUIRED):** process POM files **one at a time**.
Never `read_file` more than one POM into memory simultaneously. After each
file:
1. Extract its locators and append per-locator records to the running
   in-memory aggregates (do NOT keep the full file body).
2. Append the file path to `learning/miner-checkpoint.json → filesProcessed`
   and persist the checkpoint before moving on.
3. Release the file body before reading the next.

This mirrors the streaming discipline in Stages 5/6/7 and prevents context
exhaustion on large monorepos with hundreds of POM files.

For each POM file, parse every locator expression. Map each one to a
canonical **strategy** plus the **raw selector**.

### Playwright Strategies

| Code pattern                                          | Strategy            |
|-------------------------------------------------------|---------------------|
| `page.getByTestId('x')`                               | `data-testid`       |
| `page.getByRole('button', { name: 'Submit' })`        | `role`              |
| `page.getByLabel('Email')`                            | `label`             |
| `page.getByPlaceholder('Search')`                     | `placeholder`       |
| `page.getByText('Save')`                              | `text`              |
| `page.getByAltText('Logo')`                           | `alt`               |
| `page.getByTitle('Close')`                            | `title`             |
| `page.locator('#id')` or `[id="x"]`                   | `id`                |
| `page.locator('[name="x"]')`                          | `name`              |
| `page.locator('[data-testid="x"]')`                   | `data-testid`       |
| `page.locator('[aria-label="x"]')`                    | `aria-label`        |
| `page.locator('//xpath')` or `xpath=...`              | `xpath`             |
| `page.locator('.cls')` / any other CSS                | `css`               |

### Selenium (Java / C# / JS) Strategies

| Code pattern                                          | Strategy            |
|-------------------------------------------------------|---------------------|
| `By.id("x")` / `By.Id("x")`                           | `id`                |
| `By.name("x")` / `By.Name("x")`                       | `name`              |
| `By.cssSelector("[data-testid='x']")` / `By.CssSelector("[data-testid='x']")` | `data-testid` |
| `By.cssSelector("[name='x']")`                        | `name` (via css)    |
| `By.cssSelector("#id")`                               | `id` (via css)      |
| `By.cssSelector("[aria-label='x']")`                  | `aria-label`        |
| `By.cssSelector(".cls")` / any other CSS              | `css`               |
| `By.xpath("//x")` / `By.XPath("//x")`                 | `xpath`             |
| `By.linkText("…")` / `By.partialLinkText("…")`        | `link-text`         |
| `By.tagName("…")`                                     | `tag-name`          |
| `By.className("…")`                                   | `class-name`        |

### WebdriverIO Strategies

| Code pattern                                          | Strategy            |
|-------------------------------------------------------|---------------------|
| `$('#id')`                                            | `id`                |
| `$('[name="x"]')`                                     | `name`              |
| `$('[data-testid="x"]')`                              | `data-testid`       |
| `$('[aria-label="x"]')`                               | `aria-label`        |
| `$('//xpath')`                                        | `xpath`             |
| `$('.cls')` / any other CSS                           | `css`               |
| `$('=Save')` (link text)                              | `text`              |
| `$('android=…')` / `$('ios=…')`                       | `mobile`            |

### Recording Format

For every locator extracted, record:

```json
{
  "file": "src/pages/RequestCreatePage.ts",
  "line": 42,
  "fieldName": "submitButton",
  "controlType": "button",
  "uiLibrary": "native",
  "strategy": "role",
  "rawSelector": "page.getByRole('button', { name: 'Submit' })",
  "stableHint": "name = 'Submit'"
}
```

`controlType` is inferred from the field/method name using these heuristics:
- `*Button`, `*Btn`, `submitButton` → `button`
- `*Input`, `*TextBox`, `*Field`, `*Box` (without `Button`) → `input`
- `*Dropdown`, `*Select`, `*Combo` → `dropdown`
- `*Checkbox`, `*Toggle`, `*Switch` → `checkbox`
- `*Radio` → `radio`
- `*Date`, `*Picker`, `*Calendar` → `datepicker`
- `*Modal`, `*Dialog`, `*Popup` → `modal`
- `*Table`, `*Grid`, `*List` → `table`
- `*Error`, `*Validation`, `*Message` → `message`
- otherwise → `unknown`

If the project clearly uses Kendo or Material wrappers (e.g.
`kendo-dropdownlist`, `mat-select` appears in selectors), set `uiLibrary`
accordingly on the affected entries.

---

## Step 4 — Aggregate Statistics

Build the aggregate buckets:

### `locatorStrategies` — overall use of each strategy
```json
"locatorStrategies": {
  "data-testid": { "count": 45, "percentage": 28.8, "examplePaths": ["…"] },
  "id":          { "count": 32, "percentage": 20.5, "examplePaths": ["…"] },
  "role":        { "count": 28, "percentage": 17.9, "examplePaths": ["…"] },
  "css":         { "count": 22, "percentage": 14.1, "examplePaths": ["…"] },
  "xpath":       { "count": 12, "percentage":  7.7, "examplePaths": ["…"] },
  "label":       { "count":  9, "percentage":  5.8, "examplePaths": ["…"] },
  "name":        { "count":  6, "percentage":  3.8, "examplePaths": ["…"] },
  "aria-label":  { "count":  2, "percentage":  1.3, "examplePaths": ["…"] }
}
```

### `byControlType` — strategy distribution per control type
```json
"byControlType": {
  "button":     { "preferredStrategies": ["role", "data-testid", "id"], "samples": [...] },
  "input":      { "preferredStrategies": ["data-testid", "id", "name", "label"], "samples": [...] },
  "dropdown":   { "preferredStrategies": ["data-testid", "css"], "samples": [...] },
  "checkbox":   { "preferredStrategies": ["role", "label"], "samples": [...] },
  "datepicker": { "preferredStrategies": ["data-testid", "css"], "samples": [...] },
  "table":      { "preferredStrategies": ["css", "xpath"], "samples": [...] },
  "message":    { "preferredStrategies": ["css", "data-testid"], "samples": [...] }
}
```

### `byUiLibrary` — strategy distribution per UI library
```json
"byUiLibrary": {
  "native":   { "preferredStrategies": ["role", "data-testid", "id"] },
  "kendo":    { "preferredStrategies": ["css(kendo-dropdownlist[name=...])", "css(.k-list-item)"] },
  "material": { "preferredStrategies": ["css(mat-select[formcontrolname=...])", "css(.cdk-overlay-pane mat-option)"] }
}
```

### `interactionPatterns` — common method-name patterns
Look for action method names and group them: `fill*`, `click*`, `select*`,
`get*Error`, `get*Message`, etc. Note any `selectKendoOption`,
`selectMatOption`, `toggleMatCheckbox`-style helpers — these are explicit
UI-library helpers Stage 6 should preserve.

### `fallbackChains` — observed multi-strategy patterns
If any field has more than one locator (e.g. `try data-testid; on miss, fall
back to css`), record the chain so Stage 3 can capture both for resilience.

### `recommendations` — autogenerated for the QA architect

**Anti-hallucination rule (REQUIRED):** every recommendation that cites a
number (percentage, count, file count, etc.) MUST cite a value that already
exists in this same JSON file under `locatorStrategies`, `byControlType`,
`byUiLibrary`, or `interactionPatterns`. Do NOT invent figures. Each
recommendation entry's `evidence` array MUST list the exact JSON path
(e.g., `"locatorStrategies.data-testid.percentage"`) that supports the
claim. If a claim cannot be backed by an aggregate already in this file,
either rephrase it without the number or omit the recommendation.

Examples the miner should emit when relevant:
- `"data-testid coverage is 28.8% — recommend pushing dev to add it on Kendo grids (currently 100% xpath)"` — evidence: `["locatorStrategies.data-testid.percentage", "byUiLibrary.kendo.preferredStrategies"]`.
- `"3 fields rely on positional xpath (//div[3]/span[2]) — flag as brittle"` — evidence: `["locatorStrategies.xpath.count"]`.
- `"No POM uses getByLabel for inputs — Stage 3 should capture label-based locators as a secondary strategy for Material inputs"` — evidence: `["byControlType.input.preferredStrategies"]`.

---

## Step 5 — Compose the Learning JSON

Assemble the final document:

```json
{
  "scanId": "scan-2026-05-09T10-30-00",
  "schemaVersion": 1,
  "scannedAt": "[ISO timestamp]",
  "project": {
    "path": "/abs/path/to/project",
    "framework": "playwright-typescript",
    "uiLibraries": ["native", "kendo"],
    "totalPomFiles": 12,
    "totalLocators": 156
  },
  "locatorStrategies": { /* see Step 4 */ },
  "byControlType":     { /* see Step 4 */ },
  "byUiLibrary":       { /* see Step 4 */ },
  "interactionPatterns": [ /* … */ ],
  "fallbackChains":      [ /* … */ ],
  "recommendations":     [ /* … */ ],
  "rawLocators":         [ /* every per-locator record from Step 3, capped at 1000 by default */ ]
}
```

Conform to `schemas/locator-learning.schema.json`.

`rawLocators` is capped at `learning.rawLocatorsMax` (default 1000) to keep
files reviewable. If the project has more, sample uniformly and note
`samplingApplied: true`.

---

## Step 6 — Write the File + Update INDEX

### 6a — Write the learning JSON

Write the JSON to:
```
learning/locator-learning-<ISO-timestamp-no-colons>.json
```

If `learning/` does not exist, create it.

### 6b — Update INDEX.json

Read `learning/INDEX.json` if it exists (seed with `{ "schemaVersion": 1, "scans": [] }` if absent).
Prepend the new scan entry at position 0 (newest first):

```json
{
  "schemaVersion": 1,
  "scans": [
    {
      "scanId": "scan-2026-05-09T10-30-00",
      "file": "locator-learning-2026-05-09T10-30-00.json",
      "scannedAt": "2026-05-09T10:30:00Z",
      "framework": "playwright-typescript",
      "totalLocators": 156,
      "topStrategy": "data-testid",
      "topStrategyPct": 28.8
    }
    /* prior scans here, newest first */
  ]
}
```

### 6c — Prune INDEX to `learning.maxFiles`

After prepending the new entry:

1. Read `learning.maxFiles` from `pipeline.config.json`
   (default **6** if the key is absent).
2. If `INDEX.json → scans` now contains more than `maxFiles` entries:
   - Trim the `scans` array to keep only the newest `maxFiles` entries
     (drop from the tail — those are the oldest).
   - **Do NOT delete the trimmed JSON files from disk.** Trimming only
     removes them from the index so Stage 3's bounded scan loop
     doesn't re-process them.
   - Log a warning for each dropped entry:
     ```
     [LEARNING] INDEX pruned: scan-<id> removed from index (maxFiles=<N>).
       File still on disk: learning/locator-learning-<ts>.json
       To archive: mv learning/locator-learning-<ts>.json learning/archive/
     ```
3. Write the updated `INDEX.json` to disk.

This keeps the index bounded and prevents Stage 3's multi-file merge
from growing unbounded as scans accumulate over time.

---

## Step 7 — Print Summary

```
=== LOCATOR MINER COMPLETE ===
Project:           [path]
Framework:         [framework]
UI Libraries:      [libraries]
POM Files Scanned: [count]
Locators Found:    [count]
Top Strategies:
  - data-testid    [count] ([%])
  - role           [count] ([%])
  - id             [count] ([%])
  - css            [count] ([%])
  - xpath          [count] ([%])
Saved To:          learning/locator-learning-<ts>.json
Index Updated:     learning/INDEX.json
Recommendations:   [count] (see file → "recommendations")
```

This summary is safe to log — it contains no secrets and no source code.
