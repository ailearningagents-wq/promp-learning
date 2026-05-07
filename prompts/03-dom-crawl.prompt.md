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
- `config.json` → `application.*`, `crawl.*`
- `output/auth/storageState.json` (from Stage 2)

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

Open browser using `output/auth/storageState.json` for authenticated context.

---

## Step 2 — Route Discovery Pass

For each URL in the crawl queue (up to `config.crawl.maxDepth` levels):

1. Navigate to the URL using Playwright MCP
2. Wait for `config.crawl.waitForSelector` to be visible (or wait 2 seconds if selector not found)
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

### 3a — Page Metadata
Extract:
- Page `<title>`
- Main heading (`<h1>` text)
- Breadcrumb path if present
- Current URL (normalized, without query params for the map)
- Page role/purpose (infer from title, heading, and URL: "list", "create", "edit", "detail", "dashboard", "report")

### 3b — Form Discovery
For every `<form>` element on the page:

Capture:
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
  "dependsOn": null
}
```

For `<select>` fields → capture all `<option>` values and labels.
For radio groups → capture all options.
For checkboxes → capture the label and checked state.

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

---

## Step 4 — Conditional Logic Probing

**Only execute this step if `config.crawl.interactionProbing` is `true`.**

For each form discovered, probe for conditional fields:

1. For each `<select>` field → change to each option value one at a time
2. For each radio group → select each option one at a time
3. For each checkbox → toggle it
4. After each change, re-capture the DOM and detect:
   - New fields that appeared (were `display:none` or `v-if`/`ng-if` hidden)
   - Fields that disappeared
   - Fields that changed from disabled to enabled
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

## Step 6 — Write Application Map

Create `output/application-map.json`:

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

Update `output/pipeline-state.json`:
- Set `stages.stage3` to `"completed"`
- Update `counters.pagesDiscovered`

Log summary:
```
=== STAGE 3 COMPLETE ===
Pages Crawled:              [count]
Forms Discovered:           [count]
Fields Captured:            [count]
Tables Discovered:          [count]
Modals Discovered:          [count]
Conditional Relationships:  [count]
User Journeys Mapped:       [count]
Modules Identified:         [list]
Application Map:            output/application-map.json [SAVED]
Stage 3: PASSED — Proceeding to Stage 4
```
