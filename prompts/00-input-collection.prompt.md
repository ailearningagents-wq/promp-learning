---
mode: agent
description: >
  STAGE 0 — Input Collection & Output Bootstrap.
  Trusts the master orchestrator's resolved config + .env (in memory).
  This stage only initializes the output directory and seeds pipeline-state.json.
tools:
  - read_file
  - create_file
  - list_dir
---

# Stage 0 — Input Collection & Output Bootstrap

## Objective
The master orchestrator has already:

- Located `pipeline.config.json` and resolved `.env` values **in memory only**.
- Validated required tokens, project mode, and project paths.
- Started the local Playwright MCP server (or confirmed it's running).

Stage 0's job is the small remainder: bootstrap the `output/` directory
and seed `pipeline-state.json` so downstream stages can checkpoint.

## Inputs (passed in-memory by the orchestrator)
- Resolved config (read-only view of `pipeline.config.json` with `.env` substituted)
- Project mode (`existing` | `new`) and the resolved project path
- Pipeline mode (`full` | `single-route`) and `singleRoute` if applicable

---

## Step 1 — Create Output Directory Structure

This stage's tools list does not include `run_in_terminal`. To create
directories, use `create_file` to drop a `.keep` placeholder inside each —
the parent directories are created implicitly by the file write.

Create:

| File (via `create_file`)            | Effect (created directory) |
|-------------------------------------|----------------------------|
| `output/.keep`                      | `output/`                  |
| `output/logs/.keep`                 | `output/logs/`             |

`output/auth/` is created on demand by Stage 2 when it writes
`storageState.json` — Stage 0 does not need to pre-create it.

`.keep` files contain a single line:
```
This file is intentional — it ensures the directory is tracked. Safe to ignore.
```

Never write secrets, resolved config values, or `.env` content into any
file under `output/`.

## Step 2 — Seed `pipeline-state.json`

If `output/pipeline-state.json` already exists, **do not overwrite it** —
the orchestrator's resume logic depends on it. Update only `pipeline.lastUpdated`
and confirm `stage0.status` is `"completed"`.

If it does not exist, write the schema defined in the master orchestrator
(see "Resume / Checkpointing"), with these initial values:

- `pipeline.mode` = the resolved pipeline mode
- `pipeline.singleRoute` = the resolved single-route value (or `null`)
- `stages.stage0.status` = `"completed"`
- All other stage statuses = `"pending"`
- All counters = `0`

## Step 3 — Resolve Tech Stack Hint

- Existing project → tech stack is determined in Stage 1 (fingerprinting).
- New project → use `project.newProjectTechStack` from the resolved config.

Log the resolved hint to `output/logs/stage0.log`.

## Step 4 — Stage 0 Completion Log

```
=== STAGE 0 COMPLETE ===
App:           [application.name]
Base URL:      [application.baseUrl]
Project Mode:  [existing | new]
Pipeline Mode: [full | single-route]
Project Path:  [resolved project path]
Tech Stack:    [resolved or "deferred to Stage 1"]
MCP Server:    [running]
Stage 0: PASSED — Proceeding to Stage 1
```

> Stage 0 must NOT print the resolved values of any `.env`-backed field
> (usernames, passwords, client secrets). Print only structural / non-secret
> values.
