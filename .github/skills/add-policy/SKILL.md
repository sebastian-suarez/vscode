---
name: add-policy
description: Use when adding, modifying, or reviewing VS Code configuration policies. Covers the full policy lifecycle from registration to export to platform-specific artifacts. Run on ANY change that adds a `policy:` field to a configuration property.
---

# Adding a Configuration Policy

Policies allow enterprise administrators to lock configuration settings via OS-level mechanisms (Windows Group Policy, macOS managed preferences, Linux config files). This skill covers the complete procedure.

## When to Use

- Adding a new `policy:` field to any configuration property
- Modifying an existing policy (rename, category change, etc.)
- Reviewing a PR that touches policy registration
- Having one policy govern **multiple** settings via `policyReference`

## Architecture Overview

### Policy Sources (layered, last writer wins)

| Source | Implementation | How it reads policies |
|--------|---------------|----------------------|
| **OS-level** (Windows registry, macOS plist) | `NativePolicyService` via `@vscode/policy-watcher` | Watches `Software\Policies\Microsoft\{productName}` (Windows) or bundle identifier prefs (macOS) |
| **Linux file** | `FilePolicyService` | Reads `/etc/vscode/policy.json` |
| **Multiplex** | `MultiplexPolicyService` | Combines multiple OS/file policy readers in the main process |

### Key Files

| File | Purpose |
|------|---------|
| `src/vs/base/common/policy.ts` | `PolicyCategory` enum, `IPolicy` interface, `IPolicyReference` |
| `src/vs/platform/policy/common/policy.ts` | `IPolicyService`, `AbstractPolicyService`, `PolicyDefinition`, `toSerializablePolicyDefinition` (drops non-cloneable members for IPC) |
| `src/vs/platform/policy/common/multiplexPolicyService.ts` | Combines multiple policy services |
| `src/vs/platform/configuration/common/configurations.ts` | `PolicyConfiguration` — bridges policies to configuration values; applies values to `policyReference` settings |
| `src/vs/platform/configuration/common/configurationRegistry.ts` | `policy` / `policyReference` registration; `getPolicyReferenceConfigurations()` (name → subordinate settings) |
| `src/vs/workbench/contrib/policyExport/electron-browser/policyExport.contribution.ts` | `--export-policy-data` CLI handler |
| `build/lib/policies/policyData.jsonc` | Auto-generated policy catalog incl. `referencedSettings` (DO NOT edit manually) |
| `build/lib/policies/policyGenerator.ts` | Generates ADMX/ADML (Windows), plist (macOS), JSON (Linux) |
| `build/lib/test/policyConversion.test.ts` | Tests for policy artifact generation |

## Procedure

### Step 1 — Add the `policy` field to the configuration property

Find the configuration registration (typically in a `*.contribution.ts` file) and add a `policy` object to the property schema.

**Required fields:**

**Determining `minimumVersion`:** Always read `version` from the root `package.json` and use the `major.minor` portion. For example, if `package.json` has `"version": "1.112.0"`, use `minimumVersion: '1.112'`. Never hardcode an old version like `'1.99'`.

```typescript
policy: {
    name: 'MyPolicyName',                          // PascalCase, unique across all policies
    category: PolicyCategory.InteractiveSession,    // From PolicyCategory enum
    minimumVersion: '1.112',                        // Use major.minor from package.json version
    localization: {
        description: {
            key: 'my.config.key',                   // NLS key for the description
            value: nls.localize('my.config.key', "Human-readable description."),
        }
    }
}
```

**Optional: `enumDescriptions` for enum/string policies:**

**IMPORTANT:** If the configuration property has `type: 'string'` and an `enum` array, you **must** include `enumDescriptions` in the `localization` block with the same number of entries as the `enum` array. Without this, `npm run export-policy-data` will fail with: `enumDescriptions must exist and have the same length as enum for policy "..."`.

```typescript
localization: {
    description: { key: '...', value: nls.localize('...', "...") },
    enumDescriptions: [
        { key: 'opt.none', value: nls.localize('opt.none', "No access.") },
        { key: 'opt.all', value: nls.localize('opt.all', "Full access.") },
    ]
}
```

### Step 2 — Ensure `PolicyCategory` is imported

```typescript
import { PolicyCategory } from '../../../../base/common/policy.js';
```

Existing categories in the `PolicyCategory` enum:
- `Extensions`
- `IntegratedTerminal`
- `Telemetry`
- `Update`

If you need a new category, add it to `PolicyCategory` in `src/vs/base/common/policy.ts` and add corresponding `PolicyCategoryData` localization.

### Step 3 — Validate TypeScript compilation

Check the `VS Code - Build` watch task output, or run:

```bash
npm run typecheck-client
```

### Step 4 — Export the policy data

Regenerate the auto-generated policy catalog:

```bash
npm run export-policy-data
```

This script handles transpilation, sets up `GITHUB_TOKEN` (via `gh` CLI or GitHub OAuth device flow), and runs `--export-policy-data`. The export command reads extension configuration policies from the distro's `product.json` via the GitHub API and merges them into the output.

This updates `build/lib/policies/policyData.jsonc`. **Never edit this file manually.** Verify your new policy appears in the output.  You will need code review from a codeowner to merge the change to main.


## Policy for extension-provided settings

Extension authors cannot add `policy:` fields directly—their settings are defined in the extension's `package.json`, not in VS Code core. Instead, policies for extension settings are defined in `vscode-distro`'s `product.json` under the `extensionConfigurationPolicy` key.

### How it works

1. **Source of truth**: The `extensionConfigurationPolicy` map lives in `vscode-distro` under `mixin/{quality}/product.json` (stable, insider, exploration).
2. **Runtime**: When VS Code starts with a distro-mixed `product.json`, `configurationExtensionPoint.ts` reads `extensionConfigurationPolicy` and attaches matching `policy` objects to extension-contributed configuration properties.
3. **Export/build**: The `--export-policy-data` command fetches the distro's `product.json` at the commit pinned in `package.json` and merges extension policies into the output. Use `npm run export-policy-data` which sets up authentication automatically.

### Distro format

Each entry in `extensionConfigurationPolicy` must include:

```json
"extensionConfigurationPolicy": {
    "publisher.extension.settingName": {
        "name": "PolicyName",
        "category": "InteractiveSession",
        "minimumVersion": "1.99",
        "description": "Human-readable description."
    }
}
```

- `name`: PascalCase policy name, unique across all policies
- `category`: Must be a valid `PolicyCategory` enum value (e.g., `InteractiveSession`, `Extensions`)
- `minimumVersion`: The VS Code version that first shipped this policy
- `description`: Human-readable description string used to generate localization key/value pairs for ADMX/ADML/macOS/Linux policy artifacts

### Adding a new extension policy

1. Add the entry to `extensionConfigurationPolicy` in **all three** quality `product.json` files in `vscode-distro` (`mixin/stable/`, `mixin/insider/`, `mixin/exploration/`)
2. Update the `distro` commit hash in `package.json` to point to the distro commit that includes your new entry — the export command fetches extension policies from the pinned distro commit
3. Regenerate `policyData.jsonc` by running `npm run export-policy-data` (see Step 4 above)
4. Update the test fixture at `src/vs/workbench/contrib/policyExport/test/node/extensionPolicyFixture.json` with the new entry

### Test fixtures

The file `src/vs/workbench/contrib/policyExport/test/node/extensionPolicyFixture.json` is a test fixture that must stay in sync with the extension policies in the checked-in `policyData.jsonc`. When extension policies are added or changed in the distro, this fixture must be updated to match — otherwise the integration test will fail because the test output (generated from the fixture) won't match the checked-in file (generated from the real distro).

### Downstream consumers

| Consumer | What it reads | Output |
|----------|--------------|--------|
| `policyGenerator.ts` | `policyData.jsonc` | ADMX/ADML (Windows GP), `.mobileconfig` (macOS), `policy.json` (Linux) |
| `vscode-website` (`gulpfile.policies.js`) | `policyData.jsonc` | Enterprise policy reference table at code.visualstudio.com/docs/enterprise/policies |
| `vscode-docs` | Generated from website build | `docs/enterprise/policies.md` |

## One Policy for Many Settings (`policyReference`)

A single policy can govern multiple settings. The **owner** declares the full
`policy: { name, … }`; other settings declare `policyReference: { name }` pointing at
the owner's policy name.

```typescript
// Owner setting
policy: { name: 'MyPolicyName', category: PolicyCategory.Extensions, minimumVersion: '1.126', /* ... */ }

// Subordinate setting (no type/localization of its own)
policyReference: { name: 'MyPolicyName' }
```

Use `policyReference` whenever one enterprise policy should lock multiple settings to
the same value. The reference is a **pure pointer**. It contributes no type,
`restrictedValue`, or localization of its own; the owner remains the single source of
truth for policy metadata and runtime behavior.

Key rules and internals:

- A setting must **not** declare both `policy` and `policyReference` (rejected during
  configuration registration).
- Exactly one setting may own a policy name with `policy`; additional settings attach
  with `policyReference`.
- The reference setting's type must match the owner's type; `npm run export-policy-data`
  enforces this because the same resolved policy value is applied verbatim to owner and
  references.
- `ConfigurationRegistry.getPolicyReferenceConfigurations()` tracks `policyName →
  Set<settingKey>`, and `PolicyConfiguration` updates both the owner setting and all
  registered references when the policy value changes.
- `AbstractPolicyService.serialize()` uses `toSerializablePolicyDefinition()` to strip
  non-cloneable members before sending policy definitions over IPC.
- `AbstractPolicyService.updatePolicyDefinitions()` replaces definitions per policy
  name, so a late-registering owner supersedes an earlier reference fallback; if the
  owner is removed, a reference can still provide a bare type fallback.
- Exported policy data includes `referencedSettings` for references that are registered
  during export, and **Developer: Policy Diagnostics** lists registered owner/reference
  settings under the same policy name.

## Examples

Search the codebase for `policy:` to find all the examples of different policy configurations.

## Learnings

* Never hand-edit `build/lib/policies/policyData.jsonc` (its header explicitly forbids it). If `npm run export-policy-data` is failing, fix the script — don't patch the JSON. Common cause: running it in the wrong working directory (e.g. main repo instead of a worktree), which silently exports the wrong source tree.
* Document **behavior and business-logic expectations**, not copy-pasted implementation. Reproducing internal code in the skill rots the moment the source changes and adds no information beyond the source itself. State the contract in prose and point to the source for the implementation. Reserve code blocks for the **author-facing API contract** a contributor must follow — how to *declare* a `policy` or `policyReference` — not for restating runtime plumbing.
