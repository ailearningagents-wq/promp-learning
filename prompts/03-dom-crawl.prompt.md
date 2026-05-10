---
mode: agent
description: >
  STAGE 3 — DOM Crawl & Application Discovery.
  Uses authenticated Playwright MCP browser session to crawl all application routes,
  capture full DOM structure per page, probe conditional logic, and produce the
  application-map.json that drives all test generation in later stages.
tools:
  - read_file
  - create_file
  - replace_string_in_file
  - browser_navigate
  - browser_snapshot
  - browser_click
  - browser_fill
  - browser_select_option
  - browser_wait_for
  - browser_evaluate
---

# Stage 3 — DOM Crawl & Application Discovery

## Objective
Systematically crawl every accessible page of the application using the saved
authenticated state. Capture the complete DOM structure, form fields, controls,
conditional logic, navigation patterns, and page relationships.
The output (`application-map.json`) is the single source of truth for all test generation.

## Inputs Required
- `pipeline.config.json` → `application.*`, `crawl.*`, `pipeline.*`
- `output/auth/storageState.json` (from Stage 2)
- `learning/INDEX.json` and the associated `learning/locator-learning-*.json` files
  (**optional** — produced by `prompts/utility-pom-locator-miner.prompt.md`).
  If absent, the crawler runs normally using framework-default locator priorities
  (see "Locator-Learning Bias → Step 0" below). No error is raised when these
  files do not exist.

---

## Execution Model — Page-Wise Streaming (REQUIRED)

This stage **MUST NOT** capture the entire application in memory and write the
output only at the end. That approach causes the prompt to stall, exhaust
context/memory, and fail under non-trivial applications.

Instead, follow a strict page-wise streaming loop:

1. **After OIDC login (Stage 2) and route discovery (Step 2 below)**, hold only
   the route queue + visited set in memory — never the full DOM of every page.
2. **For each route**, perform the full per-page capture (Step 3), interaction
   probing (Step 4), and **incremental persist** before moving to the next:
   - Append the page object to `output/application-map.json` (write-as-you-go,
     do not buffer the entire `pages` array until the end).
   - Update `output/pipeline-state.json` → `stage3.lastCompletedRoute` and
     `stage3.routesCompleted`.
3. **Release per-page state** (DOM snapshot, interaction trees) before
   advancing. Only the application-map skeleton + counters should persist
   across iterations.
4. **Never** accumulate raw DOM, screenshots, or HAR for all pages in memory.
   If any artifact must be retained, write it to disk under `output/crawl/<pageId>/`
   and reference it by path in the application map.

### Resume Mechanism (REQUIRED)

If a prior run stalled or failed mid-crawl, the next invocation MUST resume
rather than restart from scratch:

1. On startup, check for `output/application-map.json` and
   `output/pipeline-state.json`.
2. If `pipeline-state.json` shows `stage3` as `"in_progress"` (or the map exists
   but `stage3` is not `"completed"`):
   - Load `routesCompleted` and `lastCompletedRoute`.
   - Rebuild `visitedRoutes` from the routes already present in the map.
   - Drop already-completed routes from `crawlQueue`.
   - Continue from the next pending route.
3. If a route was partially captured (a `pageId` exists in the map but its
   capture is missing required fields), treat it as pending and re-capture it,
   replacing the partial entry.
4. Log a `RESUME` banner at startup with the count of routes resumed vs.
   already complete vs. pending.

### Single-Route Mode

The pipeline-wide single-route mode is governed by the master orchestrator
(see `orchestrator/master-orchestrator.prompt.md` → Pipeline Modes). When
`pipeline.config.json` → `pipeline.mode` is `"single-route"`, the orchestrator
passes `pipeline.singleRoute` to this stage:

```json
"pipeline": {
  "mode": "single-route",
  "singleRoute": "/requests/create"
}
```

In single-route mode the crawler MUST:

1. **Skip Step 2** (Route Discovery Pass) entirely — the queue contains exactly
   one URL: `config.pipeline.singleRoute`.
2. Run Step 3 (Deep DOM Capture), Step 4 (Conditional Logic Probing), and any
   journey inference scoped to that route only.
3. **Merge** the resulting page object into the existing `application-map.json`
   if one is present (replacing any prior entry for the same URL); otherwise
   create a fresh map containing only this page.
4. Update only the relevant counters in `pipeline-state.json`. Do **not** mark
   `stage3` as `"completed"` for the whole application — instead set
   `stage3.singleRouteCompleted: "<url>"` so the orchestrator knows this was a
   targeted run.
5. Print `=== STAGE 3 (SINGLE-ROUTE) COMPLETE ===` and exit cleanly.

The default mode (`pipeline.mode === "full"` or unset) runs the full crawl
described in the rest of this document.

### Locator-Learning Bias (when `learning/` is present)

#### Step 0 — Check Whether Learning Data Exists (REQUIRED FIRST)

Before any other learning step, check whether `learning/INDEX.json` exists
at the workspace root **and** contains at least one valid scan entry.

- If `learning/INDEX.json` **does not exist** → log and skip the entire
  Locator-Learning Bias section:
  ```
  [LEARNING] learning/INDEX.json not found — skipping locator-learning bias. Using framework defaults.
  ```
  Jump directly to the DOM crawl steps. Do NOT attempt to read any file
  under `learning/`.

- If `learning/INDEX.json` **exists but is empty or contains no scan entries** → log and skip:
  ```
  [LEARNING] learning/INDEX.json is empty or has no scan entries — skipping locator-learning bias. Using framework defaults.
  ```
  Jump directly to the DOM crawl steps.

- If `learning/INDEX.json` **exists and has at least one entry** → continue
  with the Memory-Safe Multi-File Merge below.

---

If `learning/INDEX.json` exists at workspace root with valid entries, this stage MUST merge
**all** `learning/locator-learning-*.json` files referenced by the index
into a single **merged-bias** object and use it to bias capture.
The intent: the team's locator habits evolve across multiple miner runs;
aggregating all runs produces a richer, more representative signal than
any single scan in isolation.

#### Memory-Safe Multi-File Merge (REQUIRED)

Loading every learning file into memory at once can stall or crash the
prompt on large projects. Follow this strictly bounded procedure instead:

1. **Read `learning/INDEX.json`** (small file — safe to load whole).
   Collect the ordered list of scan entries, newest first.
   Cap the list to the last **`learning.maxFiles`** entries
   (read from `pipeline.config.json`; default **6** if absent).
   Log: `[LEARNING] Found <N> scan(s) in INDEX; processing <M> (maxFiles=<maxFiles>).`

2. **Process each file individually — one at a time, in newest-first order.**
   For each scan entry:

   a. Read **only that one file** from disk.

   b. **Validate** the top-level schema keys
      (`scanId`, `schemaVersion`, `locatorStrategies`, `byControlType`,
      `byUiLibrary`). If any required key is missing → log a warning,
      skip this file, continue with the next. Do NOT fail the crawl.

   c. **Extract only the aggregate sections** — do NOT hold `rawLocators`
      in memory. Specifically extract:
      - `locatorStrategies` (counts + percentages per strategy)
      - `byControlType` (preferredStrategies per control type)
      - `byUiLibrary` (preferredStrategies per UI library)
      - `interactionPatterns` (pattern names + occurrences only;
        drop the full `samples` arrays)
      - `fallbackChains` (field names + chains only; drop `file` paths
        and raw selector strings longer than 200 chars)

   d. **Assign a time-decay weight** to each file:
      - Newest file (index 0): weight = **1.0**
      - Each subsequent file: weight = previous × **0.8**
      (e.g., file 0 = 1.0, file 1 = 0.8, file 2 = 0.64, file 3 = 0.512…)
      This ensures that the most recent conventions dominate while older
      runs still contribute signal.

   e. **Merge this file's data into the running `mergedBias` object**
      (details in sub-section below).

   f. **Release the file** from memory immediately — do NOT accumulate
      raw file objects across the loop. Only `mergedBias` persists.

3. After all files are processed, **`mergedBias`** is the only
   learning artefact held in memory for the rest of the crawl.
   It is a compact object (no raw locators, no full sample arrays).

#### `mergedBias` Object Shape

```json
{
  "sourceScanIds": ["scan-2026-05-09T10-30-00", "scan-2026-04-12T16-22-09"],
  "filesProcessed": 2,
  "locatorStrategies": {
    "data-testid": { "weightedCount": 56.4, "percentage": 31.2 },
    "role":        { "weightedCount": 28.0, "percentage": 15.5 }
  },
  "byControlType": {
    "button":   { "preferredStrategies": ["role", "data-testid", "id"] },
    "input":    { "preferredStrategies": ["data-testid", "id", "name", "label"] },
    "dropdown": { "preferredStrategies": ["data-testid", "css"] }
  },
  "byUiLibrary": {
    "native":   { "preferredStrategies": ["role", "data-testid", "id"] },
    "kendo":    { "preferredStrategies": ["css(kendo-dropdownlist[name=...])", "css(.k-list-item)"] },
    "material": { "preferredStrategies": ["css(mat-select[formcontrolname=...])", "css(.cdk-overlay-pane mat-option)"] }
  },
  "topStrategy": "data-testid",
  "topStrategyPct": 31.2
}
```

#### Merging Rules

**`locatorStrategies`:** For each strategy key, accumulate
`weightedCount += file.locatorStrategies[strategy].count × weight`.
After all files are merged, recompute `percentage` as
`weightedCount / totalWeightedLocators × 100`. Sort strategies by
`weightedCount` descending to determine `topStrategy`.

**`byControlType`:** For each control type, collect all
`preferredStrategies` arrays from all files weighted by their position
in the array (index 0 = highest rank). Build a weighted vote tally
per strategy per control type. Emit the top 3 by vote score as the
merged `preferredStrategies`.

**`byUiLibrary`:** Same voting approach as `byControlType`.

**`interactionPatterns`:** Union of all patterns across files; for
duplicates, sum `occurrences` (weighted). Cap the final list at 20
entries by weighted occurrences.

**`fallbackChains`:** Union of unique chains across files (deduplicate
by `fieldName`). Cap at 50 entries.

#### Applying the Bias During Capture

4. Build per-control-type **preferred-strategy lists** from
   `mergedBias.byControlType[*].preferredStrategies`. For each captured
   field in Step 3b, when emitting the locator candidate set:
   - The first candidate is the highest-ranked preferred strategy that
     can actually resolve on the live DOM.
   - Subsequent candidates are remaining preferred strategies, then a
     framework-default fallback (so the field still works even if the
     team adds new patterns later).

5. For Kendo / Material wrappers, `mergedBias.byUiLibrary` overrides
   `byControlType` — the captured `componentSelector` (3h) is still the
   anchor; the bias only chooses *how* to find it.

6. Record the locator candidate chain on each captured field:
   ```json
   "candidateLocators": [
     { "strategy": "data-testid", "selector": "[data-testid='submit-btn']", "source": "learning-bias" },
     { "strategy": "role",        "selector": "role=button[name='Submit']", "source": "learning-bias" },
     { "strategy": "css",         "selector": "button.submit",              "source": "framework-fallback" }
   ]
   ```
   Stage 6 reads `candidateLocators` and emits the POM property using the
   first one; if a future regenerate finds it broken, Stage 6 can rotate
   to the next entry without re-crawling.

7. Add a summary note to `application-map.json`:
   ```json
   "locatorLearning": {
     "applied": true,
     "filesProcessed": 2,
     "sourceScanIds": ["scan-2026-05-09T10-30-00", "scan-2026-04-12T16-22-09"],
     "topStrategy": "data-testid",
     "topStrategyPct": 31.2
   }
   ```

8. If all files in the index fail schema validation (every file skipped),
   fall back to framework-default locator priorities and log:
   ```
   [LEARNING] All learning files failed validation — using framework defaults.
   ```

The multi-file merge improves Stage 7's success rate because it captures
locator patterns accumulated over multiple miner runs, not just the most
recent snapshot. Stage 7 can also *record* misses (locators that didn't
resolve) and surface them as `recommendations` for the next miner run.

---

## Step 1 — Initialize Crawl State

Create a crawl queue and visited set:
```
crawlQueue = [config.application.baseUrl]
visitedRoutes = []
routeMap = {}
excludeList = config.crawl.excludeRoutes
```

If `config.crawl.includeRoutes` is not empty → replace crawlQueue with those specific routes only.

**Single-route mode — pre-load existing map (REQUIRED):**
If `pipeline.mode === "single-route"`:
1. Read `output/application-map.json` if it exists and load all existing page entries into
   an in-memory map keyed by page URL.
2. During Step 3's per-page persistence, the newly captured page entry replaces only the
   entry matching `pipeline.singleRoute`; all other entries are left untouched.
3. When writing `application-map.json` during Step 3, always write the **full merged map**
   (all existing pages + the updated single-route entry) — NOT just the single captured page.
   This preserves all previously discovered pages.
If `output/application-map.json` does not exist yet, start with an empty map and treat this
run as a partial full-mode capture.

Open browser using `output/auth/storageState.json` for authenticated context.

---

## Step 2 — Route Discovery Pass

> **Route cap (REQUIRED):** Before processing the queue, establish the maximum
> number of routes the crawl will visit. Read `config.crawl.maxRoutes`
> (default **100** if absent or not a positive integer). Log:
> `[STAGE 3] Route cap: maxRoutes=[N]. Crawl will stop after [N] unique routes.`
> If the queue would grow beyond `maxRoutes` during discovery, add new routes
> to a `deferredRoutes` list (for potential future single-route runs) but do NOT
> add them to `crawlQueue`. When the cap is reached, log:
> ```
> [STAGE 3] WARNING: Route cap (maxRoutes=[N]) reached. Stopped adding new routes.
> Deferred routes (not crawled this run): [count]
> Increase config.crawl.maxRoutes if full coverage is needed.
> ```

For each URL in the crawl queue (up to `config.crawl.maxDepth` levels):

> **Route discovery navigation timeout (REQUIRED):** Every `browser_navigate` call in this
> loop must be guarded. After calling `browser_navigate`, immediately call `browser_wait_for`
> with a **30-second timeout** for `config.crawl.waitForSelector` to become visible (fall
> back to `body` if not configured). If the 30-second wait expires, skip this URL — do NOT
> halt route discovery. Log:
> ```
> [STAGE 3] WARNING: Route discovery navigation timed out after 30s — [url]. Skipping.
> ```
> Add the URL to `visitedRoutes` (so resume logic does not retry it) and continue with the
> next URL in the queue.

1. Call `browser_navigate` to the URL.
2. Call `browser_wait_for` with a 30-second timeout for `config.crawl.waitForSelector`
   (or `body` if not configured), per the guard above.
3. Take a browser snapshot
4. Extract all navigation links from the page:
   - All `<a href="...">` elements where href is a same-domain relative or absolute path
   - All navigation menu items (look for `nav`, `[role="navigation"]`, `.sidebar`, `.menu`)
   - All breadcrumb links
   - All "Go to", "View", "Open" action links in tables/lists
5. Add new undiscovered routes to the crawl queue
6. Skip routes matching `config.crawl.excludeRoutes` patterns
7. Skip external domains, file downloads (`.pdf`, `.xlsx`, `.csv`), and `#anchor` only links
8. Add current URL to `visitedRoutes`

Repeat until crawl queue is empty OR `maxDepth` is reached.

---

## Step 3 — Deep DOM Capture Per Page

For each discovered route, navigate to it and perform a **complete DOM capture**.

> **Per-page navigation timeout (REQUIRED):** For every route in the deep-capture
> loop, apply an explicit timeout on the navigation itself:
> 1. Call `browser_navigate` to the route URL.
> 2. Immediately call `browser_wait_for` with a **30-second timeout** for
>    `config.crawl.waitForSelector` to become visible (fall back to `body` if
>    the selector is not configured).
> 3. If the 30-second wait expires without the selector appearing, **skip this
>    route — do NOT halt the entire crawl.** Log:
>    ```
>    [STAGE 3] WARNING: Page timed out after 30s — [url]. Skipping to next route.
>    ```
>    Write a minimal placeholder entry to `application-map.json`:
>    `{ "url": "[url]", "status": "timeout", "pageId": "[id]" }`
>    Update `pipeline-state.json` (record the route as attempted so resume
>    logic does not retry it), then continue with the next route in the queue.

> **Per-page persistence reminder:** after sub-steps 3a–3h complete for a
> route, immediately persist that page object to `output/application-map.json`
> and update `pipeline-state.json` (see Execution Model). Do not advance to the
> next route until the write succeeds.

The capture MUST cover ALL of the following control surfaces, including those
that are not visible in the initial render:

- Standard HTML form inputs and submission flows
- Page-level validation containers (inline, toast, banner — see 3f)
- Data-creation flows (list → "New" button → form → submit → confirmation)
- Conditional / dependent controls (controls whose visibility, enablement, or
  required-state depends on the value of another control — see Step 4)
- **Hidden controls** (`display:none`, `visibility:hidden`, `*ngIf`, `v-if`,
  `aria-hidden="true"`, off-screen by CSS) — capture them with
  `hidden: true` and the computed visibility trigger if known
- Tables, grids, and virtualised lists (see 3d)
- UI-library-specific controls (Kendo UI, Angular Material — see 3h)

### 3a — Page Metadata

**Use this canonical extraction script.** Pass it to `browser_evaluate` and
parse the JSON response. Do NOT improvise a different script — the returned
shape is referenced by sub-steps 3b–3h.

```javascript
JSON.stringify({
  title: document.title || '',
  heading: (document.querySelector('h1') || {}).textContent?.trim() || '',
  breadcrumb: Array.from(document.querySelectorAll(
    '[aria-label="breadcrumb"] a, .breadcrumb a, nav.breadcrumbs a'
  )).map(a => a.textContent?.trim()).filter(Boolean),
  url: location.pathname,
  // Visibility helpers used by other captures
  hasKendo: !!window.kendo || !!document.querySelector('[class*=" k-"], [class^="k-"], kendo-dropdownlist, kendo-grid'),
  hasMaterial: !!document.querySelector('mat-select, mat-checkbox, mat-form-field, .cdk-overlay-container')
})
```

From the response:
- `title`, `heading`, `breadcrumb`, `url` — capture as-is.
- `hasKendo` / `hasMaterial` — feed into 3h's UI-library detection.
- Page role/purpose — infer from `title`, `heading`, and `url` (`list` /
  `create` / `edit` / `detail` / `dashboard` / `report`).

### 3b — Form Discovery

**Use this canonical extraction script** for form + field discovery (including
hidden / conditional fields). Pass it to `browser_evaluate` and parse the
JSON response.

```javascript
JSON.stringify(Array.from(document.querySelectorAll('form, [role="form"]')).map(form => {
  const isVisible = (el) => {
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none'
        && cs.visibility !== 'hidden'
        && el.getAttribute('aria-hidden') !== 'true';
  };
  const hiddenReasonOf = (el) => {
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none') return 'display-none';
    if (cs.visibility === 'hidden') return 'visibility-hidden';
    if (el.getAttribute('aria-hidden') === 'true') return 'aria-hidden';
    if (el.offsetParent === null) return 'offscreen';
    return null;
  };
  const fields = Array.from(form.querySelectorAll(
    'input:not([type=hidden]), select, textarea, ' +
    'kendo-dropdownlist, kendo-combobox, kendo-multiselect, kendo-datepicker, kendo-numerictextbox, ' +
    'mat-select, mat-checkbox, mat-radio-group, mat-form-field, mat-datepicker-toggle, mat-autocomplete'
  )).map(el => {
    const lbl = el.labels?.[0]?.textContent?.trim()
             || el.getAttribute('aria-label')
             || el.getAttribute('placeholder')
             || '';
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || el.tagName.toLowerCase(),
      id: el.id || '',
      name: el.getAttribute('name') || '',
      label: lbl,
      required: el.required || el.getAttribute('aria-required') === 'true',
      readonly: el.readOnly || el.hasAttribute('readonly'),
      disabled: el.disabled || el.hasAttribute('disabled'),
      maxLength: el.maxLength > 0 ? el.maxLength : null,
      pattern: el.getAttribute('pattern') || null,
      placeholder: el.getAttribute('placeholder') || '',
      dataTestId: el.getAttribute('data-testid') || el.getAttribute('data-test-id') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      hidden: !isVisible(el),
      hiddenReason: hiddenReasonOf(el),
      // Options for dropdown-style native or Kendo/Material wrapper
      options: el.tagName === 'SELECT'
        ? Array.from(el.options).map(o => ({ value: o.value, label: o.text }))
        : []
    };
  });
  return {
    formId: form.id || form.getAttribute('name') || form.getAttribute('aria-label') || '',
    formAction: form.action || '',
    formMethod: (form.method || 'get').toLowerCase(),
    fields
  };
}))
```

Fields whose `hidden === true` are still captured — Step 4 may reveal them
under a conditional branch and we want them in the map under the right
`conditionallyVisible` flag.

For every `<form>` element, the captured object is:
```json
{
  "formId": "[id or generated name]",
  "formAction": "[action attribute or inferred]",
  "formMethod": "[get/post or inferred]",
  "fields": []
}
```

For every field inside the form:
```json
{
  "fieldId": "[id attribute]",
  "fieldName": "[name attribute]",
  "fieldType": "[input type: text/email/password/number/date/checkbox/radio/select/textarea]",
  "label": "[associated <label> text or aria-label]",
  "placeholder": "[placeholder attribute]",
  "required": true,
  "readonly": false,
  "disabled": false,
  "validationAttributes": {
    "minLength": null,
    "maxLength": 100,
    "min": null,
    "max": null,
    "pattern": null,
    "step": null
  },
  "options": [],
  "dataTestId": "[data-testid attribute]",
  "ariaLabel": "[aria-label attribute]",
  "conditionallyVisible": false,
  "dependsOn": null,
  "hidden": false,
  "hiddenReason": null,
  "uiLibrary": "native | kendo | material | other",
  "componentSelector": "[stable selector for the wrapping component, e.g. kendo-dropdownlist[name='category']]",
  "interactionStrategy": "[how to set this control — see 3h]"
}
```

For `<select>` fields → capture all `<option>` values and labels.
For radio groups → capture all options.
For checkboxes → capture the label and checked state.

For **hidden** controls, set `hidden: true` and record `hiddenReason` as one
of: `display-none`, `visibility-hidden`, `aria-hidden`, `ngIf-removed`,
`offscreen`, `conditional`. Hidden controls that are removed from the DOM at
render time (e.g., `*ngIf="false"`) should still be captured if they appear
under any value combination probed in Step 4.

### 3c — Button Discovery
For every `<button>` and `<input type="submit">` and `<a>` acting as button:
```json
{
  "buttonId": "[id]",
  "buttonText": "[visible text]",
  "buttonType": "[submit/button/reset/link]",
  "dataTestId": "[data-testid]",
  "ariaLabel": "[aria-label]",
  "action": "[inferred: submit-form / navigate / open-modal / trigger-api / reset]",
  "navigatesTo": "[URL if link-type button]",
  "disabled": false
}
```

### 3d — Table Discovery
For every `<table>` or `[role="grid"]` or common table component:
```json
{
  "tableId": "[id or generated name]",
  "columns": ["Column 1", "Column 2"],
  "hasSorting": true,
  "hasFiltering": true,
  "hasPagination": true,
  "paginationSelector": "[selector]",
  "hasRowActions": true,
  "rowActionButtons": ["Edit", "Delete", "View"],
  "hasEmptyState": true,
  "emptyStateText": "[text shown when no data]"
}
```

### 3e — Modal/Dialog Discovery
For every `<dialog>`, `[role="dialog"]`, `.modal`, `.overlay` element:
```json
{
  "modalId": "[id or generated name]",
  "triggerSelector": "[what opens this modal]",
  "title": "[modal title]",
  "hasForm": false,
  "actionButtons": ["Confirm", "Cancel"],
  "closeByBackdrop": true
}
```

### 3f — Error & Validation Message Containers
Identify where validation errors appear:
```json
{
  "inlineErrors": "[selector for inline field errors, e.g., .field-error]",
  "toastNotifications": "[selector for toast/snackbar messages]",
  "pageErrors": "[selector for page-level error banners]",
  "successMessages": "[selector for success confirmations]"
}
```

### 3g — Navigation Elements
```json
{
  "primaryNav": "[selector for main navigation]",
  "breadcrumbs": "[selector for breadcrumbs]",
  "backButton": "[selector for back/cancel navigation]",
  "pageActions": "[selector for page-level action buttons (top-right area)]"
}
```

### 3h — UI Library Detection & Locator Strategy

Generic `<input>`/`<select>` locators are NOT sufficient. Many real-world
controls are wrapped in a UI-library component whose visible "input" element
is a stylised proxy (often `role="combobox"`, an inner `<input readonly>`, or
no native form element at all). Capture the library and its interaction
contract per page so downstream stages can drive the control correctly.

Detect the UI library by scanning the page's DOM and global scripts:

- **Kendo UI** — presence of `kendo-*` web components (`kendo-dropdownlist`,
  `kendo-combobox`, `kendo-grid`, `kendo-datepicker`, `kendo-multiselect`,
  `kendo-numerictextbox`), `.k-*` class prefixes (`.k-input`, `.k-dropdown`,
  `.k-grid`), or a `window.kendo` global.
- **Angular Material** — presence of `mat-*` element selectors
  (`mat-select`, `mat-checkbox`, `mat-radio-group`, `mat-form-field`,
  `mat-datepicker`, `mat-autocomplete`), `.mat-*` / `.mdc-*` class prefixes,
  or `cdk-overlay-container` in the DOM.
- **Native** — only standard HTML elements present.

Record the page-level detection:
```json
{
  "uiLibraries": ["kendo", "material"],
  "primaryLibrary": "kendo"
}
```

For **every captured control**, set `uiLibrary` and `interactionStrategy`
using the table below. Failing to do this is the most common cause of
"dropdown selection silently does nothing" failures in the generated specs.

| Control                  | uiLibrary | componentSelector                                  | interactionStrategy                                                                 |
|--------------------------|-----------|----------------------------------------------------|-------------------------------------------------------------------------------------|
| `kendo-dropdownlist`     | kendo     | `kendo-dropdownlist[name="<name>"]`                | click the wrapper → wait for `.k-list-container` → click `.k-list-item` by text     |
| `kendo-combobox`         | kendo     | `kendo-combobox[name="<name>"]`                    | click wrapper → type into inner input → click matching `.k-list-item`               |
| `kendo-multiselect`      | kendo     | `kendo-multiselect[name="<name>"]`                 | click wrapper → click each desired `.k-list-item` → click outside to close          |
| `kendo-datepicker`       | kendo     | `kendo-datepicker[name="<name>"]`                  | click toggle → use calendar nav, or type ISO date into inner `.k-input-inner`       |
| `kendo-numerictextbox`   | kendo     | `kendo-numerictextbox[name="<name>"]`              | clear inner input, then type the number                                             |
| `kendo-grid` row action  | kendo     | `kendo-grid` + row locator                         | locate row by unique cell text, then click the action `.k-button` inside that row   |
| `mat-select`             | material  | `mat-select[formcontrolname="<name>"]`             | click trigger → wait for `.cdk-overlay-pane` → click `mat-option` by text           |
| `mat-checkbox`           | material  | `mat-checkbox[formcontrolname="<name>"]`           | click the `.mat-mdc-checkbox-touch-target` (NOT the inner `<input>`)                |
| `mat-radio-group`        | material  | `mat-radio-group[formcontrolname="<name>"]`        | click `mat-radio-button` whose label text matches                                   |
| `mat-datepicker`         | material  | `mat-datepicker` + paired `<input>`                | type ISO date into the paired input (avoid the calendar UI for stability)           |
| `mat-autocomplete`       | material  | input bound to `[matAutocomplete]`                 | type → wait for `.mat-mdc-autocomplete-panel` → click matching option               |
| `mat-form-field` wrapper | material  | `mat-form-field` containing the control            | use to scope label/error lookups, never as the click target                         |
| native `<select>`        | native    | `select[name="<name>"]`                            | use Playwright `selectOption({ label })`                                            |
| native `<input>`         | native    | `input[name="<name>"]`                             | `fill()` for text/number/email/date, `check()` for checkbox/radio                   |

Record the table-relevant subset on the captured field:
```json
{
  "uiLibrary": "kendo",
  "componentSelector": "kendo-dropdownlist[name='category']",
  "interactionStrategy": "kendo-dropdown-click-list-item",
  "optionContainerSelector": ".k-list-container",
  "optionItemSelector": ".k-list-item"
}
```

For Kendo grids and Material tables, also record on the table object (3d):
```json
{
  "uiLibrary": "kendo",
  "rowSelector": "kendo-grid tr.k-table-row",
  "headerSelector": "kendo-grid th.k-table-th",
  "actionButtonSelector": ".k-button"
}
```

If a control's library cannot be reliably detected, set `uiLibrary: "other"`
and capture every visible role/aria/data attribute on the wrapper so the
strategy can be hand-tuned later.

---

## Step 4 — Conditional Logic Probing

**Only execute this step if `config.crawl.interactionProbing` is `true`.**

For each form discovered, probe for conditional fields. Use the
`interactionStrategy` recorded in 3h — do NOT assume native `<select>`
behaviour for Kendo dropdowns or Material selects.

1. For each dropdown-style field (native `<select>`, `kendo-dropdownlist`,
   `kendo-combobox`, `kendo-multiselect`, `mat-select`, `mat-autocomplete`)
   → cycle through each option value one at a time using the strategy
   from 3h.
   - **Option-count cap:** Read `config.crawl.maxOptionsPerField` (default **20**
     if absent). If the field has more options than this cap, probe only the
     **first**, the **last**, and a uniformly-sampled subset up to the cap total.
     The full option list is still captured in the application map (`field.options`)
     — the cap only limits how many DOM re-captures are triggered.
     Log: `[STAGE 3] Field [fieldId] has [N] options — capping conditional probe to [maxOptionsPerField].`
2. For each radio group (native, `mat-radio-group`, Kendo radios) → select
   each option one at a time.
3. For each checkbox / toggle (native, `mat-checkbox`, `mat-slide-toggle`,
   Kendo switch) → toggle it.
   - **Navigation guard:** Before toggling, capture the current URL.
     After toggling, immediately check whether the URL has changed.
     If navigation occurred (the toggle redirected the page):
     - Log: `[STAGE 3] Toggle [fieldId] triggered navigation to [newUrl] — re-navigating back.`
     - Navigate back to the form page URL.
     - Re-capture the page context (DOM snapshot) before continuing with the
       next field. The toggled field's conditional relationship is recorded as
       `"navigates": true` rather than `"shows" / "hides"` fields.
4. After each change, re-capture the DOM and detect:
   - **New fields that appeared** (were `display:none`, `*ngIf` removed,
     `aria-hidden`, or otherwise hidden) — these are dependent controls
     and MUST be added to the form's `fields[]` with `conditionallyVisible: true`
     and `dependsOn` populated, even though they were not present in the
     initial render.
   - Fields that disappeared.
   - Fields that changed from disabled to enabled (or required to optional).
5. Record conditional relationships:
```json
{
  "trigger": { "fieldId": "category-select", "value": "TypeA" },
  "effect": { "shows": ["typeA-detail-field"], "hides": ["typeB-detail-field"], "enables": [] }
}
```

---

## Step 5 — User Journey Mapping

By analyzing navigation patterns and button actions, infer key user journeys:

```json
{
  "journeyId": "J-001",
  "name": "Create and Submit Request",
  "steps": [
    { "step": 1, "page": "/dashboard", "action": "Click 'Create New'" },
    { "step": 2, "page": "/requests/create", "action": "Fill form and Submit" },
    { "step": 3, "page": "/requests/[id]", "action": "Verify submission on detail page" }
  ]
}
```

Identify journeys by looking for: list → create → detail, wizard step patterns, search → filter → results patterns.

---

## Step 6 — Application Map Structure (Written Incrementally)

`output/application-map.json` is **built up page-by-page during Step 3**
(see Execution Model). This step describes its final shape, not a separate
end-of-run write. After each page completes Steps 3–4, append its `pages[]`
entry, refresh the `summary` counters, and persist the file before moving on.

```json
{
  "generatedAt": "[ISO timestamp]",
  "application": {
    "name": "[config.application.name]",
    "baseUrl": "[config.application.baseUrl]",
    "environment": "[config.application.environment]"
  },
  "summary": {
    "totalPages": 0,
    "totalForms": 0,
    "totalFields": 0,
    "totalTables": 0,
    "totalModals": 0,
    "totalButtons": 0,
    "conditionalRelationships": 0,
    "userJourneys": 0
  },
  "pages": [
    {
      "pageId": "P-001",
      "url": "/dashboard",
      "title": "Dashboard",
      "heading": "Welcome",
      "role": "dashboard",
      "module": "Dashboard",
      "forms": [],
      "tables": [],
      "modals": [],
      "navigation": {},
      "errorContainers": {}
    }
  ],
  "conditionalLogic": [],
  "userJourneys": [],
  "modules": ["Dashboard", "Requests", "Admin"]
}
```

---

## Step 7 — Stage 3 Completion

Once the route queue is empty (full mode) or the single route has been
captured (single-route mode):

Update `output/pipeline-state.json`:
- Full mode: set `stages.stage3` to `"completed"`.
- Single-route mode: set `stages.stage3.singleRouteCompleted` to the route
  URL — do **not** mark the whole stage `"completed"`.
- Update `counters.pagesDiscovered`, `counters.routesResumed`,
  `counters.routesAlreadyComplete`.

Log summary:
```
=== STAGE 3 COMPLETE ===
Mode:                       [full | single-route]
Pages Crawled (this run):   [count]
Pages Resumed:              [count]    # routes whose partial state was reused
Pages Already Complete:     [count]    # routes skipped because already in map
Forms Discovered:           [count]
Fields Captured:            [count]
  - Hidden / Conditional:   [count]
  - Kendo / Material:       [count]
Tables Discovered:          [count]
Modals Discovered:          [count]
Conditional Relationships:  [count]
User Journeys Mapped:       [count]
Modules Identified:         [list]
Application Map:            output/application-map.json [SAVED INCREMENTALLY]
Stage 3: PASSED — Proceeding to Stage 4
```
