## Summary
- Add `mito-node analyze` and `mito-node discover` flows backed by Inspector/CDP collection and local analysis bundles.
- Add Rust Agent process/metrics HTTP endpoints plus SDK registration and metric reporting for cpu, memory, js_error, and timeout subjects.
- Add `mito-node agent status/processes/metrics`, smoke/staging scripts, and the Node monitoring learning handbook with PR review slices.
- Expand the handbook with an explicit Node.js runtime, monitoring/governance, and Rust Agent boundary knowledge map.

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
