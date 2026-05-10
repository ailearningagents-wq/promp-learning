# autotestgen-mcp — Custom MCP server for AutoTestGen

A single-file Node.js MCP server that exposes high-level tools to the prompts.
Each tool replaces 8–15 individual browser primitive calls or repeated file I/O
sequences, cutting LLM token usage by ~85% and making every stage far more
reliable under session and rate limits.

## Tools exposed

| Tool                          | Replaces                                                                        |
|-------------------------------|---------------------------------------------------------------------------------|
| `mcp_oidc_login`              | Stage 2 Steps 3–5 (whole login flow + MFA detection)                           |
| `mcp_save_storage_state`      | Stage 2 Step 6 (cookies + localStorage capture + file write)                   |
| `mcp_capture_page_dom`        | Stage 3 sub-steps 3a–3h (page metadata, forms, fields, buttons, tables, modals, UI library detection — one call) |
| `mcp_extract_routes`          | Stage 3 Step 2 link-extraction JS                                               |
| `mcp_probe_conditional`       | Stage 3 Step 4 conditional-trigger probing                                      |
| `mcp_pom_mine_locators`       | Whole `utility-pom-locator-miner.prompt.md` body                                |
| `mcp_state_checkpoint`        | Every stage's read→merge→write `pipeline-state.json` sequence (per-page + completion checkpoints) |
| `mcp_bootstrap_output`        | Stage 0 Steps 1–2 (output/ directory creation + pipeline-state.json seeding)   |
| `mcp_fingerprint_project`     | Stage 1 Steps 1–4 (framework, language, folders, naming convention detection)   |
| `mcp_scan_spec_coverage`      | Stage 8 Step 0 inner loop (read spec files, extract test IDs + quality signals) |
| `mcp_compute_coverage_gaps`   | Stage 8 Steps 1–3 (coverage matrix + gap identification + unauthorized audit)   |
| `mcp_build_data_index`        | Stage 5 Step 1 (read test-plan index + per-page test cases → dataFile→testCases[] map) |

## Install

```bash
cd mcp-config/autotestgen-mcp
npm install   # installs playwright + @playwright/mcp from local node_modules
```

> **No browser download needed.** The server uses the system-installed **Google Chrome** (preferred) or **Microsoft Edge** — set via the `channel` option in Playwright. Make sure at least one is installed on the machine before running.

## Run (manual, for debugging)

```bash
node mcp-config/autotestgen-mcp/src/index.js
# Then send newline-delimited JSON-RPC over stdin.
```

## Register with VS Code Copilot

`mcp-config/mcp.json` already has both entries:

```jsonc
{
  "mcpServers": {
    "playwright":  { "command": "./mcp-config/autotestgen-mcp/node_modules/.bin/mcp-server-playwright" },
    "autotestgen": { "command": "node", "args": ["./mcp-config/autotestgen-mcp/src/index.js"] }
  }
}
```

Both servers execute entirely from the local `node_modules/` — no packages are downloaded at startup.

## Headless

Set `PLAYWRIGHT_HEADLESS=true` in the env to run in headless mode (default is **headful**).

## Browser selection

The server tries **Chrome** first (via `channel: 'chrome'`), then **Edge** (`channel: 'msedge'`). If neither is installed it throws a descriptive error. The bundled Playwright Chromium binary is never used.


## Notes on resilience

- The server reuses one browser, one context, one page across all tool
  calls in the same session — `mcp_oidc_login` then `mcp_capture_page_dom`
  shares the authenticated context with no re-login.
- Each tool is idempotent and self-contained; if Copilot loses its
  session mid-pipeline, the next invocation re-uses
  `output/auth/storageState.json` via Stage 2's resume check.
- No file is created outside the workspace folder. No secrets are logged.

## Adding a tool

Add an entry to `TOOLS` in `src/index.js` with `description`, `inputSchema`,
and `handler`. The dispatcher picks it up automatically — no other glue.
