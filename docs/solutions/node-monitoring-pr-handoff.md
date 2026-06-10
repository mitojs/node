# Node Monitoring PR Handoff

This file records the current PR-ready state for the Node monitoring CLI + Agent MVP. It exists because the branch is pushed, but PR creation from this environment is blocked by GitHub integration permissions.

## Branch

- Repository: `mitojs/node`
- Base branch: `master`
- Head branch: `feat-vite`
- Current remote branch SHA: run `git rev-parse origin/feat-vite` after `git fetch origin feat-vite`
- Last verified implementation/docs SHA before this handoff: `2af4657edbda51f3890776cc30a89486ca7da7ac`
- Compare URL: <https://github.com/mitojs/node/compare/master...feat-vite?expand=1>
- PR status checked through public GitHub API: no open `mitojs:feat-vite -> master` PR at the time of this handoff.

## PR Title

```text
feat(agent): add Node monitoring CLI and Agent pipeline
```

## PR Body

Exact PR body file:

```text
docs/solutions/node-monitoring-pr-body.md
```

```markdown
## Summary
- Add `mito-node analyze` and `mito-node discover` flows backed by Inspector/CDP collection and local analysis bundles.
- Add Rust Agent process/metrics HTTP endpoints plus SDK registration and metric reporting for cpu, memory, js_error, and timeout subjects.
- Add `mito-node agent status/processes/metrics`, smoke/staging scripts, and the Node monitoring learning handbook with PR review slices.

## Test Plan
- [x] `pnpm --filter @mitojs/node exec jest --config jest.config.cjs --runInBand`
- [x] `pnpm --filter @mitojs/node-cli exec jest --config jest.config.cjs --runInBand`
- [x] `~/.cargo/bin/cargo test`
- [x] `pnpm --filter @mitojs/node build`
- [x] `pnpm --filter @mitojs/node-cli build`
- [x] `MITO_AGENT_TCP_PORT=16682 scripts/smoke-sdk-agent-cli.sh`

## Review Notes
- The current Agent contract uses `proxy_port`; Rust and CLI still accept legacy `uds_port` for compatibility.
- Local demo/test-guide files and the rebuilt darwin-arm64 binary were intentionally left out of this PR.
- The implementation is one pushed MVP commit plus one handbook status commit because `packages/node-cli/src/bin.ts` wires multiple command groups in one entrypoint. Review can still follow `docs/solutions/node-monitoring-pr-slices.md`.
```

## Commits

- `59ae5a010e9a8ddd401f9986ceac74a98114f86c` - `feat(agent): add node monitoring cli pipeline`
- `2af4657edbda51f3890776cc30a89486ca7da7ac` - `docs(agent): update monitoring handbook status`
- This handoff may add a later docs-only commit on top of those two.

## Verified Behavior

The smoke script starts the SDK, starts the packaged local Rust Agent, registers the process with `proxy_port`, emits metrics, and queries the CLI. The expected smoke summary contains:

```json
{
  "metric_types": ["cpu", "js_error", "memory", "timeout"],
  "metric_status": "success",
  "missing": []
}
```

## Files Intentionally Not Included

- `demos/easyFetch-test-server.ts`
- `packages/node/src/__test__/shared/ReactiveSubject.test-guide.md`
- `packages/node/src/__test__/subjects/subjects.test-guide.md`
- `packages/node/binaries/mitojs-agent-darwin-arm64`

## PR Creation Blocker

Automatic PR creation failed with:

```text
GitHub API error 403: Resource not accessible by integration
```

The local `gh` CLI is not installed. Use the compare URL above to create the PR manually, or authenticate/install `gh` and run:

```bash
gh pr create \
  --base master \
  --head feat-vite \
  --title "feat(agent): add Node monitoring CLI and Agent pipeline" \
  --body-file docs/solutions/node-monitoring-pr-body.md
```
