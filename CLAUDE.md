# harness-mcp AI Notes

## Project Shape

`harness-mcp` is a Bun + TypeScript MCP server. The runtime entrypoint is `src/index.ts`; the CLI shim is `bin/harness-mcp`.

The public tool surface is intentionally small:

- `help`
- `context`
- `discover`
- `contract`
- `read`
- `verify`
- `lint`
- `check`

Do not reintroduce removed legacy tools such as `doctor`, `run`, `flow`, `create_spec`, `update_spec`, `ls`, `info`, or `ping`.

## Development Rules

- Use `bun run typecheck` for type checks.
- Use `bun run scripts/smoke.ts` to verify MCP registration.
- Keep `_charter` as Markdown only: `harness/_charter/*.md`.
- Keep business contracts as Gherkin only: `harness/features/**/*.feature` and `harness/flows/**/*.feature`.
- BDD step definitions, runner configs, and reports belong to the host project test/build output, not inside `harness/`.

## Verification Baseline

Run this before claiming changes are complete:

```bash
bun run typecheck
bun run scripts/smoke.ts
bun run scripts/test-discover.ts
bun run scripts/test-contract.ts
bun run scripts/test-context-charter.ts
bun run scripts/test-verify-bdd.ts
bun run scripts/test-lint.ts
bun run scripts/test-check-governance.ts
git diff --check
```
