# harness-mcp Roadmap

## Product Positioning

`harness-mcp` is a language-agnostic AI collaboration contract layer.
The product rule is: keep the tool surface small, clear, and useful.

It should keep a compact product shape:

- `context`: let AI understand project rules before editing code.
- `info` / `ls`: let humans and AI inspect harness adoption.
- `run`: run normal business behavior checks.
- `flow`: run explicit end-to-end journeys.
- `check`: run governance constraints.
- `report`: inspect historical run results.

The execution layer should stay language-agnostic: Java, Python, Go,
TypeScript, or any other host project should be able to provide its own
commands.

In short:

> Keep business contracts in harness files; execute checks through host-project
> command adapters.

## Current State

The current MVP is a contract-reading and verification bridge.

Implemented MCP tools:

| Tool | Current role |
|---|---|
| `check` | Execute configured project constraint checks from `harness/constraints`. |
| `context` | Return project charter files and capability index. |
| `create_spec` | Safely create a new capability `.feature` file from AI-supplied full content. |
| `info` | Show current harness wiring without executing tests. |
| `doctor` | Statically diagnose harness wiring issues without executing tests. |
| `flow` | List or execute end-to-end journey `.feature` files from `harness/flows` and validate report coverage. |
| `list_capabilities` | List capability `.feature` files by tag or prefix. |
| `ls` | Discover harness-enabled projects under a workspace. |
| `read_spec` | Read one capability spec by fuzzy match. |
| `run` | Execute the configured normal business check command and parse its report. |
| `search` | Search all `.feature` files under `spec_dir`. |
| `update_spec` | Rewrite an existing capability spec with Gherkin validation. |
| `verify` | Execute capability `.feature` files through `bdd`, parse cucumber-json or surefire-xml, include git diff. |

Current limitations:

- No general tier model beyond the current charter, features, flows, and constraints directories.
- `run` exists as a basic command adapter for non-BDD host checks.
- `flow` uses the same BDD runner config as `verify` and validates report coverage.
- `check` exists as a basic command adapter over `harness/constraints`, but does not inherit dependency constraints yet.
- No historical result store or `report`.
- `verify` parses `cucumber-json` and `surefire-xml`; `pytest-json` is still schema-only.
- No template scaffolding tool by design; `create_spec` only validates and safely writes AI-supplied full content.

## Target Capability Model

The long-term model should keep the MCP surface focused around project context,
business contracts, verification, and governance checks.

| Capability | Purpose | Language-agnostic approach |
|---|---|---|
| `context` | Load AI-facing instructions and indexes. | Read configured tiers and return structured summaries. |
| `create_spec` | Safely add a new business spec. | Validate path, duplicate capability, `# capability`, and Gherkin before writing. |
| `info` | Show harness package state. | Parse config, tiers, suites, feature/scenario counts. |
| `ls` | Discover harness-enabled projects. | Scan for `harness.yaml` and later compatible package configs. |
| `read_spec` | Read a concrete feature/spec. | Keep fuzzy matching, extend across tiers. |
| `search` | Search harness knowledge. | Search all configured tier files. |
| `update_spec` | Modify an existing spec. | Keep whole-file rewrite and validation. |
| `run` | Daily behavior feedback. | Run configured host command for non-reserved tiers. |
| `flow` | End-to-end journey validation. | List/dry-run/run configured flow commands. |
| `check` | Governance constraints. | Run configured constraint commands and later inherited constraints. |
| `report` | Inspect historical results. | Store normalized run records locally. |
| `doctor` / `validate` | Check setup correctness. | Validate config, directories, metadata, report formats, commands. |

## Roadmap

### Phase 1: Make the Existing MVP Understandable and Self-Checking

Goal: make it obvious whether a project is correctly connected to `harness-mcp`.

Add:

- `info`
  - Shows project root, config path, charter count, capability count, tags, linked files, verify status.
  - Raw mode returns JSON.
- `doctor` or `validate`
  - Checks `harness.yaml`.
  - Checks `spec_dir` and `charter_dir`.
  - Checks every capability has `# capability:`.
  - Checks duplicate capability names.
  - Checks configured report format is actually supported.
- README update for "what this MCP is for".

Validation:

- Add script coverage using the existing MCP JSON-RPC style.
- Run `bun run typecheck`.
- Run existing scripts: `smoke`, `test-day2`, `test-day3`, `test-day4`, `test-day6`, `test-day7`.

### Phase 2: Add Project Discovery

Goal: quickly discover which projects in a workspace have adopted `harness-mcp`.

Added:

- `ls`
  - Scan a root directory for `harness.yaml`.
  - Support `depth` and `raw`.
  - Return each project path plus a compact status summary.

Validation:

- Fixture with multiple nested projects.
- Verify depth limiting and ignored directories.
- Keep existing MVP scripts green.

### Phase 3: Upgrade Config to a Tier Model

Goal: support richer harness knowledge tiers while preserving language independence.

Longer-term tier ideas remain separate from the current BDD execution model:

```yaml
version: 1
root_name: my-service

tiers:
  instructions: harness/instructions/**/*.feature
  methods: harness/methods/**/*.feature
  boundaries: harness/boundaries/**/*.feature
  flows: harness/flows/**/*.feature
  constraints: harness/constraints/**/*.feature

suites:
  subject-literacy:
    tags: ["@subject-literacy"]

commands:
  run:
    cmd: "mvn test"
    report:
      format: cucumber-json
      path: target/cucumber.json
  check:
    cmd: "mvn test -Dgroups=constraint"
    report:
      format: cucumber-json
      path: target/check-cucumber.json

bdd:
  runner: cucumber-jvm
  cmd: "mvn test"
  feature_arg_pattern: '"{feature}"'
  name_filter_pattern: '-Dcucumber.filter.name="{name}"'
  report:
    format: cucumber-json
    path: target/cucumber.json
```

Backward compatibility:

- Existing `spec_dir` and `charter_dir` keep working.
- Old `verify.cmd` / `commands.flow` config has been removed in favor of top-level `bdd`.

Validation:

- Fixture uses top-level `bdd`.
- New tiered fixture works when it also provides `bdd`.
- `context`, `search`, and `read_spec` operate across tiers.

### Phase 4: Add `run`, `flow`, and `check`

Goal: keep normal runs, flows, and governance checks operationally separate.

Added:

- `run`
  - Runs normal behavior checks.
  - Supports `commands.run`, `raw`, and report parsing.
  - Should not run flows or constraints by default.
- `flow`
  - Lists flows from `harness/flows/**/*.feature`.
  - Runs one flow by Feature title substring.
  - Supports `dryRun` and BDD report coverage validation.
- `check`
  - Lists constraints from `harness/constraints/**/*.feature` in `dryRun`.
  - Runs `commands.check` separately from normal behavior checks and flows.
  - Runs built-in generic lint constraints when `commands.check` is not configured.
  - Supports diff-aware constraints over added git diff lines plus untracked new files.

Still add:

- Dependency-provided constraints.
- Ignore list for known constraint exceptions.

Implementation principle:

- Do not import host project step files into this MCP process.
- Use configured host commands first.
- Normalize reports after execution.

Validation:

- Add separate fixtures for run, flow, and check.
- Verify that `run` never executes flow/check configuration.
- Verify that `flow` lists flows when no name is provided.
- Verify that `flow` runs only one matched flow when a name is provided.
- Verify failed scenarios are returned with enough context for AI repair.

### Phase 5: Add Result Store and `report`

Goal: turn one-off verification into a persistent feedback history.

Add:

- Normalized run record:
  - id
  - project
  - command type: run / flow / check / verify
  - suite or capability
  - started / finished timestamps
  - command and cwd
  - summary
  - failures
  - report path
  - git diff snapshot or git metadata
- Local result store.
- `report`
  - List recent runs.
  - Show one run by id.
  - Filter by project, type, suite, status.
  - Raw JSON mode.

Default storage candidate:

```text
~/.deepractice/harness-mcp/runs/
```

Validation:

- Run command saves a result.
- `report` lists latest runs.
- `report --id` expands failures and collapses passed scenarios.

### Phase 6: Broaden Report Formats

Goal: support common host ecosystems.

Add parsers:

- `pytest-json` or pytest JUnit XML for Python.
- Optional generic JUnit XML.

Validation:

- Parser unit tests with fixture files.
- Each parser returns the same normalized summary/failure shape.

### Phase 7: Dependency Constraints and Advanced Governance

Goal: make `check` strong enough for shared project governance.

Still add:

- Constraint inheritance from dependencies or configured upstream packages.
- Ignore list for known constraint exceptions.
- `check --dryRun` source-package metadata for inherited constraints.

Validation:

- Fixture with package A providing constraints.
- Fixture with package B consuming A's constraints.
- `check --dryRun` shows source package and scenario names.

## Suggested Build Order

Do one capability at a time and verify after each one:

1. `info`
2. `doctor` / `validate`
3. `ls`
4. Tier config normalization
5. Enhanced `context` over tiers
6. `run`
7. `flow` list + single run + dryRun
8. `check` own constraints
9. `create_spec`
10. Result store
11. `report`
12. Additional report parsers
13. Dependency constraint inheritance

## Definition of Done for Each Capability

Each new capability should include:

- MCP tool schema in `src/server.ts`.
- Tool implementation under `src/tools/`.
- Focused helper modules if needed.
- Fixture coverage under `examples/` or temp project setup in scripts.
- One script-style e2e test, matching the current `scripts/test-day*.ts` style.
- README or roadmap update when user-facing behavior changes.
- `bun run typecheck` passing.
- All existing scripts still passing.

## Non-Goals for Now

- No web UI.
- No auth or multi-tenant server.
- No forced "AI must call context first" runtime gate.
- No standalone template scaffolding/generator tool; AI writes content, MCP validates and safely writes it.
- No dependency constraint inheritance before local `check` works.

## Open Decisions

- Should the final config keep only `harness.yaml`, or support additional config locations?
- Should result storage be global under the home directory or local under each project?
- Should `verify` remain as a compatibility alias after `run` exists?
- Should this repo stay MCP-only, or also expose a first-class CLI surface?
