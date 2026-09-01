# Scratchpad — one-off scenario runners

This folder is gitignored. Write investigation-specific runners here freely.

## Organization

Put each investigation in a **dated subfolder** named `YYYY-MM-DD-short-description/`:

```
scratchpad/
  2026-04-09-editor-tab-leak/
    scenario.mts
    findings.md
  2026-04-12-editor-tab-switching/
    scenario.mts
    findings.md
```

Each subfolder should contain:

- **Scripts** — scenario runners, analysis scripts, etc.
- **`findings.md`** — a summary of the investigation: all ideas considered, whether each led to a change or was rejected (and why), and before/after measurements so the user can review decisions and follow up.

Scenario runners you create here can import utilities from the checked-in
scripts or copy patterns from them. When a runner proves generally useful,
promote it to the parent `scripts/` folder.

## Quick start

```bash
# Write a runner
cat > scratchpad/my-scenario.mts << 'EOF'
import { chromium } from 'playwright-core';
// ... your scenario
EOF

# Run it
node .github/skills/auto-perf-optimize/scratchpad/my-scenario.mts
```

## Checked-in scripts (in `scripts/`)

These are reusable, generic helpers. Use them directly or as templates:

- **`userDataProfile.mts`** — Utility for managing user-data profiles in
  smoke test runs.

## Tips

- Always use `--user-data-dir .build/auto-perf-optimize/user-data` (the
  persistent profile). Never create a fresh user-data-dir.
- Use `--skip-prelaunch` to avoid re-downloading Electron on every run.
- If you need to clean up an orphaned test instance, stop only the specific
  Code - OSS process (e.g. by killing the PID that was logged at launch, or
  `lsof -ti :<port> | xargs kill`). Avoid `pkill -f 'Electron'` — it can
  kill unrelated Electron apps.
- For heap snapshot analysis, use the `heap-snapshot-analysis` skill's
  scratchpad and helpers.
