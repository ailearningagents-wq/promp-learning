---
mode: agent
description: >
  STAGE 0 — Input Collection & Config Finalization.
  Validates config.json, resolves environment variables, determines project mode,
  and prepares the output directory structure for the pipeline.
tools:
  - read_file
  - create_file
  - list_dir
  - run_in_terminal
---

# Stage 0 — Input Collection & Config Finalization

## Objective
Validate all inputs, resolve environment variable references, determine project mode,
and set up the output directory. This stage ensures the pipeline has everything it
needs before any browser interaction or code generation begins.

---

## Step 1 — Read Configuration

Read `config.json` from the workspace root. Parse it and extract all values.
Store the parsed config internally — you will reference it throughout this stage.

---

## Step 2 — Resolve Environment Variables

For every field in `config.json` that starts with `$` (e.g., `$APP_USERNAME`):

1. Run `echo $VARIABLE_NAME` in the terminal to check if it is set
2. Build a resolved config map where `$VAR_NAME` is replaced with `[SET]` (never log actual values)
3. If any required environment variable is NOT set, collect all missing ones and report:

```
The following environment variables are required but not set:
  - $APP_USERNAME  → Set with: export APP_USERNAME="your-username"
  - $APP_PASSWORD  → Set with: export APP_PASSWORD="your-password"

Please set these variables and run the pipeline again.
```

Required variables are: `auth.username`, `auth.password`, `auth.clientId`

For `auth.type = "oidc-ping-pkce"` (PKCE/SPA flows):
- `auth.clientSecret` is NOT required and should be `null` — do NOT flag its absence as an error
- Confirm `auth.pkce.enabled` is `true` and `auth.pkce.redirectUri` is set

For `auth.type = "oidc-ping"` or `"oidc-standard"` (confidential client flows):
- `auth.clientSecret` IS required — flag if missing or null

---

## Step 3 — Validate Application URL

1. Run `curl -s -o /dev/null -w "%{http_code}" [config.application.baseUrl]` to verify the app is reachable
2. If the HTTP status code is NOT 200, 301, or 302 → warn the user but do NOT stop the pipeline
   (The app may require authentication to even respond with 200)
3. Log: `Application URL [baseUrl] is reachable — HTTP [status_code]`

---

## Step 4 — Determine Project Mode

Read `config.project.mode`:

### If mode = "existing":
1. Check that `config.project.existingProjectPath` directory exists
2. List the top-level contents of that directory
3. Confirm it looks like a test project (has `package.json` OR `pom.xml` OR `build.gradle` OR `*.csproj` OR `*.sln`)
4. If the directory does not exist → STOP with:
   ```
   Error: Existing project path does not exist: [path]
   Please update config.json with the correct path.
   ```
5. Log: `Existing project found at: [path]`

### If mode = "new":
1. Check that `config.project.newProjectPath` does NOT already exist OR is empty
2. If it exists and has files → ask:
   ```
   The target directory [path] already exists and contains files.
   Do you want to:
   A) Use it anyway (files will not be overwritten)
   B) Choose a different path
   
   Reply A or B.
   ```
3. Log: `New project will be created at: [path]`

---

## Step 5 — Create Output Directory Structure

Create the following directories if they do not already exist:

```
[workspace]/output/
[workspace]/output/auth/
[workspace]/output/logs/
```

Create `output/pipeline-state.json` to track pipeline progress:

```json
{
  "startedAt": "[ISO timestamp]",
  "config": {
    "appName": "[config.application.name]",
    "baseUrl": "[config.application.baseUrl]",
    "mode": "[config.project.mode]",
    "techStack": "[resolved tech stack]"
  },
  "stages": {
    "stage0": "completed",
    "stage1": "pending",
    "stage2": "pending",
    "stage3": "pending",
    "stage4": "pending",
    "stage5": "pending",
    "stage6": "pending",
    "stage7": "pending",
    "stage8": "pending"
  },
  "counters": {
    "pagesDiscovered": 0,
    "formsDiscovered": 0,
    "testCasesGenerated": 0,
    "filesCreated": 0,
    "filesExtended": 0,
    "filesSkipped": 0
  }
}
```

---

## Step 6 — Resolve Tech Stack

Determine the final tech stack that will be used:

- If mode = `"existing"` → tech stack will be determined in Stage 1 (fingerprinting)
- If mode = `"new"` → use `config.project.newProjectTechStack`:
  - `"playwright-typescript"` → Playwright with TypeScript
  - `"playwright-javascript"` → Playwright with JavaScript

Log the resolved tech stack to `output/logs/stage0.log`.

---

## Step 7 — Stage 0 Completion

Update `output/pipeline-state.json` — set `stages.stage0` to `"completed"`.

Log summary:
```
=== STAGE 0 COMPLETE ===
App Name:     [config.application.name]
Base URL:     [config.application.baseUrl]
Environment:  [config.application.environment]
Mode:         [config.project.mode]
Auth Type:    [config.auth.type]
Tech Stack:   [resolved tech stack]
Output Dir:   [workspace]/output/
All required environment variables: SET
Stage 0: PASSED — Proceeding to Stage 1
```
