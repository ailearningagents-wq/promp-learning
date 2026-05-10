---
mode: agent
description: >
  STAGE 6 — Page Object Model Generation.
  Generates POM classes for every page discovered in the application map.
  Strictly follows existing project conventions (from fingerprint) or
  best-practice templates for new projects. Never overwrites existing POMs —
  only extends them with new locators and methods.
tools:
  - read_file
  - create_file
  - replace_string_in_file
  - grep_search
---

# Stage 6 — Page Object Model Generation

## Objective
Generate a Page Object Model (POM) class for every page in the application map.
POMs encapsulate all locators and interaction methods, so test files never reference
raw selectors. If a POM already exists for a page, extend it — never recreate it.

## Core Principles
1. **Tests use methods, not selectors** — a test calls `requestPage.submitForm()`, not `page.click('#submit-btn')`
2. **Locator priority is framework-specific** — do NOT apply a single priority order to all frameworks:
   - **Playwright (TS/JS):** `data-testid` → `aria-label` → `id` → `name` → `role` → CSS (last resort)
   - **Selenium Java:** `By.id()` → `By.name()` → `By.cssSelector()` → `By.xpath()`
   - **Selenium JS** (`selenium-webdriver` NPM): `By.id()` → `By.name()` → `By.css()` → `By.xpath()`
   - **Selenium C# (.NET):** `By.Id` → `By.Name` → `By.CssSelector` → `By.XPath` (see Step 2 for full C# details)
   - **WebdriverIO:** `$('#id')` → `$('[name=""]')` → `$('[data-testid=""]')` → `$('//xpath')`
3. **One POM per page** — no giant "God object" with all selectors
4. **Base class pattern** — all POMs extend a `BasePage` that has shared navigation utilities
5. **No assertions in POMs** — POMs only perform actions and return data; tests do the asserting

## Inputs Required
- `output/application-map.json` (from Stage 3) — pages, fields, **uiLibrary**,
  **componentSelector**, **interactionStrategy** per field
- `output/test-plan.json` (from Stage 4) — drives **which** POMs are
  required, via each test case's `artifactRequirements.pageClass`
- `output/project-fingerprint.json` (from Stage 1, if existing project)
- `config.project.newProjectTechStack` (for new projects)
- `output/pipeline-state.json` — for resume + single-route mode

---

## Execution Model — Streaming, Resume, Single-Route (REQUIRED)

This stage MUST stream page-by-page rather than loading every page's POM
in memory and writing at the end.

1. After each POM file is written or extended, update
   `pipeline-state.json` → `stage6.pagesCompleted` and persist before
   advancing to the next page.
2. **Resume:** on startup, read `pipeline-state.json`. Skip any page
   already in `stage6.pagesCompleted` whose POM file exists on disk.
3. **Single-route mode:** if `pipeline.mode === "single-route"`, the only
   POM to create or extend is the one whose page URL matches
   `pipeline.singleRoute`. Every other POM is left untouched.
4. The set of POM files this stage owns is determined by collecting the
   unique `artifactRequirements.pageClass` values across the test plan
   (filtered by single route if applicable). **When collecting these values,
   read only the `artifactRequirements.pageClass` field from each test case —
   do NOT load `steps[]`, `testDataRequirements`, `relatedElements`, or any
   other fields.** A POM only present in the application map but never
   referenced by any test case can be skipped unless
   `config.generation.generateUnreferencedPoms === true`.

---

## Step 1 — Determine POM Style

> **New-project guard (REQUIRED FIRST):** If `config.project.mode === "new"`,
> `output/project-fingerprint.json` does **not** exist (Stage 1 was skipped).
> Do NOT attempt to read it. Source style settings from
> `config.project.newProjectTechStack` instead and use these defaults:
>
> | Tech stack             | Language     | Locator style              | File suffix     | POMs folder              |
> |------------------------|--------------|----------------------------|-----------------|--------------------------|
> | playwright-typescript  | typescript   | `page.locator()`           | `*Page.ts`      | `src/pages/`             |
> | playwright-javascript  | javascript   | `page.locator()`           | `*Page.js`      | `src/pages/`             |
> | selenium-java          | java         | `By.id()` / `By.cssSelector` | `*Page.java`  | `src/main/java/.../pages/` |
> | selenium-dotnet        | csharp       | `By.Id` / `By.CssSelector` | `*Page.cs`      | `Pages/`                 |
> | selenium-js            | javascript   | `By.id()` / `By.css()`     | `*Page.js`      | `pages/`                 |
> | webdriverio            | javascript   | `$('#id')`                 | `*Page.js`      | `test/pageobjects/`      |
>
> Skip the rest of this step (BasePage detection / windowed reads) — there is
> no existing project to read. Proceed to Step 2 to create the BasePage from
> scratch.

For existing projects (`config.project.mode === "existing"`), read project
fingerprint to determine:
- Language: TypeScript / JavaScript / Java / C#
- POM base class name and import path
- Locator style: `page.locator()` / `page.$()` / `By.id()` / `driver.findElement()` / `By.CssSelector()`
- File naming convention: `RequestPage.ts` / `request-page.ts` / `RequestPage.java` / `RequestPage.cs`
- Target folder: `projectFingerprint.folders.pages` or default for new project

If existing project has a `BasePage`:
- **Do not read it in full in one pass.** Read only the first 200 lines to identify
  what shared methods are already declared. If the file exceeds 200 lines, also read
  the last 50 lines (closing bracket / final methods). This is sufficient to know
  the API surface without exhausting context on a 2000-line BasePage.
- **Hard cap on windowed reads:** at most **4 windows of 150 lines** (600 lines total)
  per BasePage / POM file. After 4 windows, stop reading and log:
  `[STAGE 6] WARNING: BasePage exceeds 600 lines — analyzing first 600 only. Manual review may be needed.`
- Do NOT re-implement anything already in BasePage.

---

## Step 2 — Generate BasePage

If **no BasePage exists** in the target project, create one. This applies to:
- All **new** projects (always create)
- **Existing** projects where `projectFingerprint.folders.pages` contains no base class file (i.e. no `BasePage.ts`, `BasePage.java`, `BasePage.cs`, or any class ending in `BasePage`, `PageBase`, `AbstractPage`)

If an existing BasePage IS found → read it using the same windowed approach described in
Step 1 (first 200 lines, plus the last 50 lines if the file exceeds 200 lines). This is
sufficient to catalogue the API surface. Do NOT read the full file — large BasePage
implementations can exhaust context before any POM is generated. Do NOT re-implement
anything already in BasePage.

Create the appropriate BasePage for the project's language:

### TypeScript BasePage (`src/pages/BasePage.ts`):
```typescript
// Auto-generated by AutoTestGen Stage 6
import { Page, Locator } from '@playwright/test';

export abstract class BasePage {
  protected readonly page: Page;
  readonly url: string;

  constructor(page: Page, url: string) {
    this.page = page;
    this.url = url;
  }

  async navigate(): Promise<void> {
    await this.page.goto(this.url);
    await this.waitForPageLoad();
  }

  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  async getPageTitle(): Promise<string> {
    return await this.page.title();
  }

  async getHeading(): Promise<string> {
    return await this.page.locator('h1').first().textContent() ?? '';
  }

  async isOnPage(urlFragment: string): Promise<boolean> {
    return this.page.url().includes(urlFragment);
  }

  async waitForUrl(urlFragment: string): Promise<void> {
    await this.page.waitForURL(`**${urlFragment}**`);
  }

  async getToastMessage(): Promise<string> {
    // Override in subclass if app has specific toast selector
    const toast = this.page.locator('[role="alert"], .toast, .notification, .snackbar').first();
    return await toast.textContent() ?? '';
  }

  async getErrorMessage(): Promise<string> {
    const error = this.page.locator('[role="alert"].error, .error-message, .alert-danger').first();
    return await error.textContent() ?? '';
  }
}
```

### Other frameworks

For JavaScript / WebdriverIO / selenium-js / Selenium Java / Selenium C#
BasePages and POMs, follow the same shape as the TypeScript canonical
above, adapted to the language. Concrete copy-paste examples live in:

- `prompts/_reference/basepage-examples.md` — BasePage variants for all
  five non-TypeScript frameworks
- `prompts/_reference/pom-examples.md` — POM variants (Selenium Java,
  Selenium C#) plus the C# locator-priority list

**Before reading these files, verify they exist.** If either file is absent,
do NOT stop the pipeline. Instead, fall back to generating the BasePage and
POMs based on:
1. The TypeScript canonical template shown in Step 2 above, adapted to the
   target language using standard conventions for that language.
2. For Java: use TestNG/JUnit `By.*` locators, WebDriverWait, and a standard
   `BasePage` extending `Object` with a protected `WebDriver driver` field.
3. For C#: use NUnit/MSTest/xUnit `By.*` locators, `WebDriverWait`, and a
   `BasePage` with a protected `IWebDriver _driver` field. Apply the C#
   Locator Priority list (By.Id → By.Name → By.CssSelector → By.XPath).
4. For selenium-js: use `selenium-webdriver` `By.*` locators with `async/await`.
5. For WebdriverIO: use `$()` / `$$()` selectors.
Log a warning: `[STAGE 6] WARNING: _reference files not found — generating from built-in templates.`

---

## Step 3 — Generate POM Per Page

**Do NOT read `output/application-map.json` in full before starting.** The
complete set of pages requiring POMs is already known from the test plan's
`artifactRequirements.pageClass` values (collected in the Execution Model above).
For each page in that set:
1. Read only that page's entry from `application-map.json`.
2. Generate the POM class from that page's locators and interaction strategies.
3. Write the file to disk and update `pipeline-state.json`.
4. Release the page data before advancing to the next page.

This ensures a 100-page application does not exhaust context during POM generation.

For each page in `application-map.json`, generate a POM class.

### Locator Resolution Rules:

> **For `selenium-dotnet` projects:** use the C# Locator Priority rules defined in Step 2 above (By.Id, By.Name, By.CssSelector, By.XPath). Do NOT use `page.getByTestId()` or `page.locator()` Playwright syntax.

> **For `selenium-java` projects:** use Java locator priority — `By.id()` → `By.name()` → `By.cssSelector()` → `By.xpath()`. Do NOT use `page.getByTestId()` or `page.locator()` Playwright syntax.

> **For `selenium-js` projects** (`selenium-webdriver` NPM): use the same locator priority as `selenium-java` but in JavaScript — `By.id('value')` → `By.name('value')` → `By.css('selector')` → `By.xpath('//xpath')`. Do NOT use Playwright syntax.

> **For `webdriverio` projects:** use WebdriverIO selector shorthand — `$('#id')` → `$('[name="field"]')` → `$('[data-testid="value"]')` → `$('//xpath')`. Prefer `#id` and attribute selectors over XPath.

For Playwright (TypeScript / JavaScript) projects, choose the locator in this priority order:
1. `data-testid` attribute → `page.getByTestId('value')`
2. `aria-label` attribute → `page.getByRole('button', { name: 'Submit' })`
3. `id` attribute → `page.locator('#element-id')`
4. `name` attribute → `page.locator('[name="field-name"]')`
5. Role + text → `page.getByRole('textbox', { name: 'Request Name' })`
6. CSS selector → `page.locator('.specific-class')` (only if nothing else works)

### UI-Library-Aware Locators & Action Methods (REQUIRED)

For every field whose `uiLibrary` in the application map is `kendo` or
`material`, the priority above is **overridden** by the field's
`componentSelector` and `interactionStrategy` from Stage 3 (see
03-dom-crawl → 3h). Treating these wrappers as native `<select>` or
`<input>` produces specs that silently submit no value — this is the
single most common cause of "the test passes but the record is empty"
in Stage 7's output.

**Locator rule:** the POM property points at the wrapper component, not
the inner native element. Examples:
```typescript
// Kendo
this.categoryDropdown = page.locator("kendo-dropdownlist[name='category']");
// Material
this.prioritySelect   = page.locator("mat-select[formcontrolname='priority']");
// Material checkbox — target the touch target, not the inner <input>
this.agreeCheckbox    = page.locator("mat-checkbox[formcontrolname='agree'] .mat-mdc-checkbox-touch-target");
```

**Action method rule:** every Kendo / Material control gets a dedicated
action method on the POM that implements the captured
`interactionStrategy`. Tests call `requestPage.selectCategory('TypeA')`;
they do NOT touch `.k-list-item` or `mat-option` themselves.

Reference implementations to emit per library (TypeScript / Playwright):

```typescript
// Kendo dropdownlist / combobox — open, wait, click matching item
private async selectKendoOption(wrapper: Locator, optionText: string): Promise<void> {
  await wrapper.click();
  const list = this.page.locator('.k-list-container').last();
  await list.waitFor({ state: 'visible' });
  await list.locator('.k-list-item', { hasText: optionText }).click();
  // Verification — guards against stale popup
  await expect(wrapper.locator('.k-input-inner')).toHaveValue(optionText);
}

// Material select — open, wait for overlay, click matching mat-option
private async selectMatOption(wrapper: Locator, optionText: string): Promise<void> {
  await wrapper.click();
  const panel = this.page.locator('.cdk-overlay-pane mat-option', { hasText: optionText });
  await panel.first().waitFor({ state: 'visible' });
  await panel.first().click();
  await expect(wrapper.locator('.mat-mdc-select-value-text')).toHaveText(optionText);
}

// Material checkbox — click touch target, not inner <input>
private async toggleMatCheckbox(wrapper: Locator, desired: boolean): Promise<void> {
  const touch = wrapper.locator('.mat-mdc-checkbox-touch-target');
  const inputEl = wrapper.locator('input[type="checkbox"]');
  const current = await inputEl.isChecked();
  if (current !== desired) await touch.click();
}

// Material datepicker / Kendo datepicker — prefer typing the ISO date
private async setIsoDate(input: Locator, isoDate: string): Promise<void> {
  await input.fill(isoDate);
  await input.blur();
}
```

For Selenium projects, emit equivalent helpers on `BasePage` (Java /
C# / JS), e.g. `selectKendoOption(By wrapper, String text)` /
`SelectKendoOption(By wrapper, string text)`. Specs only ever call the
typed page methods (`requestPage.SelectCategory("TypeA")`).

**`fillForm` for Kendo / Material forms** must dispatch by `uiLibrary`:

```typescript
async fillForm(data: Partial<RequestFormData>): Promise<void> {
  if (data.requestName !== undefined) await this.requestNameInput.fill(data.requestName);
  if (data.category !== undefined)    await this.selectKendoOption(this.categoryDropdown, data.category);
  if (data.priority !== undefined)    await this.selectMatOption(this.prioritySelect, data.priority);
  if (data.dueDate !== undefined)     await this.setIsoDate(this.dueDateInput, data.dueDate);
  if (data.agree !== undefined)       await this.toggleMatCheckbox(this.agreeCheckbox, data.agree);
}
```

If a field's `uiLibrary` is `other` (library couldn't be reliably detected
in Stage 3), emit the locator using priority rules above and add a
`// TODO: verify interaction strategy` comment so a human can audit it.

### TypeScript POM Example (`src/pages/RequestCreatePage.ts`):
```typescript
// Auto-generated by AutoTestGen Stage 6
// Page: /requests/create — Create Request Form
import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class RequestCreatePage extends BasePage {
  
  // Form Locators
  readonly requestNameInput: Locator;
  readonly categorySelect: Locator;
  readonly dueDateInput: Locator;
  readonly descriptionTextarea: Locator;
  readonly prioritySelect: Locator;
  
  // Conditional Locators (visible based on category selection)
  readonly typeADetailField: Locator;    // visible when category = TypeA
  readonly typeBDetailField: Locator;   // visible when category = TypeB
  
  // Buttons
  readonly submitButton: Locator;
  readonly cancelButton: Locator;
  readonly resetButton: Locator;
  
  // Error containers
  readonly requestNameError: Locator;
  readonly categoryError: Locator;
  readonly dueDateError: Locator;
  readonly formSuccessMessage: Locator;
  readonly formErrorBanner: Locator;

  constructor(page: Page) {
    super(page, '/requests/create');

    // Form fields
    this.requestNameInput   = page.getByTestId('request-name-input');
    this.categorySelect     = page.getByTestId('category-select');
    this.dueDateInput       = page.getByTestId('due-date-input');
    this.descriptionTextarea = page.getByTestId('description-textarea');
    this.prioritySelect     = page.getByRole('combobox', { name: 'Priority' });

    // Conditional fields
    this.typeADetailField   = page.getByTestId('typeA-detail');
    this.typeBDetailField   = page.getByTestId('typeB-detail');

    // Buttons
    this.submitButton   = page.getByRole('button', { name: 'Submit' });
    this.cancelButton   = page.getByRole('button', { name: 'Cancel' });
    this.resetButton    = page.getByRole('button', { name: 'Reset' });

    // Error containers
    this.requestNameError   = page.locator('[data-testid="request-name-error"]');
    this.categoryError      = page.locator('[data-testid="category-error"]');
    this.dueDateError       = page.locator('[data-testid="due-date-error"]');
    this.formSuccessMessage = page.locator('[role="alert"].success, .success-notification');
    this.formErrorBanner    = page.locator('[role="alert"].error, .error-banner');
  }

  // --- Action Methods ---

  async fillForm(data: {
    requestName?: string;
    category?: string;
    dueDate?: string;
    description?: string;
    priority?: string;
  }): Promise<void> {
    if (data.requestName !== undefined)
      await this.requestNameInput.fill(data.requestName);
    if (data.category !== undefined)
      await this.categorySelect.selectOption(data.category);
    if (data.dueDate !== undefined)
      await this.dueDateInput.fill(data.dueDate);
    if (data.description !== undefined)
      await this.descriptionTextarea.fill(data.description);
    if (data.priority !== undefined)
      await this.prioritySelect.selectOption(data.priority);
  }

  async submitForm(): Promise<void> {
    await this.submitButton.click();
  }

  async cancelForm(): Promise<void> {
    await this.cancelButton.click();
  }

  async resetForm(): Promise<void> {
    await this.resetButton.click();
  }

  async getFieldErrorText(field: 'requestName' | 'category' | 'dueDate'): Promise<string> {
    const errorMap = {
      requestName: this.requestNameError,
      category: this.categoryError,
      dueDate: this.dueDateError,
    };
    return await errorMap[field].textContent() ?? '';
  }

  async isTypeADetailVisible(): Promise<boolean> {
    return await this.typeADetailField.isVisible();
  }

  async isTypeBDetailVisible(): Promise<boolean> {
    return await this.typeBDetailField.isVisible();
  }
}
```

---

## Step 4 — Merge Strategy (Existing Projects)

If mode is `"existing"` and a POM already exists for this page:

1. **Do not read the existing POM file in full.** Read in 150-line windows
   starting from line 1, scanning each window for locator property names and
   method signatures. **Hard cap: 4 windows (600 lines total) per POM.** If
   the file exceeds 600 lines, stop reading after the 4th window and log:
   ```
   [STAGE 6] WARNING: POM [filename] exceeds 600 lines — analyzing first 600 only.
   New locators / methods are appended at end of file; manual review may be needed
   to confirm no overlap with the unread tail.
   ```
   Do NOT load method bodies — only declarations and signatures are needed
   to decide what to skip.
2. Identify locators and methods that ALREADY EXIST — skip them
3. Identify NEW locators from the application map that are NOT in the existing POM
4. Append only the new locators and methods at the end of the existing class (before the closing `}`)
5. Never change existing locator names, method signatures, or logic
6. Log in `output/merge-report.json`: `{ file: "RequestCreatePage.ts", action: "extended", addedLocators: 3, addedMethods: 1 }`

---

## Step 5 — Stage 6 Completion

Update `output/pipeline-state.json`:
- Set `stages.stage6.status` to `"completed"`
- Set `stages.stage6.pagesCompleted` to the full list of POM page classes processed
- In single-route mode, additionally record `stages.stage6.singleRouteCompleted`
- Update `counters.filesCreated` and `counters.filesExtended`

Log summary:
```
=== STAGE 6 COMPLETE ===
Mode:                          [full | single-route]
POM Files Created:             [count]
POM Files Extended:            [count] (existing projects only)
POMs Resumed (skipped):        [count]
BasePage Created:              [yes/no]
Total Locators:                [count]
  - Native:                    [count]
  - Kendo:                     [count]
  - Material:                  [count]
Total Action Methods:          [count]
Library-Aware Action Methods:  [count]   # selectKendoOption / selectMatOption / toggleMatCheckbox / setIsoDate
Stage 6: PASSED — Proceeding to Stage 7
```
