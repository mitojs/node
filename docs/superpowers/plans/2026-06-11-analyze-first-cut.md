# Analyze First Cut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first stable `mito-node analyze --pid <pid> --json` path that writes a local bundle and returns machine-readable artifact status.

**Architecture:** Keep the first cut inside `packages/node-cli` and add small focused modules for analyze orchestration, bundle writing, collectors, and inspector access. Existing low-level commands in `cli.ts` stay in place; `bin.ts` routes `analyze` to the new path and routes older commands to the existing `CLI` class.

**Tech Stack:** TypeScript, Commander.js, Node.js inspector over WebSocket, Jest + ts-jest, Node.js fs/path/os APIs.

---

### Task 1: Bundle Contract

**Files:**
- Create: `packages/node-cli/src/analyze/types.ts`
- Create: `packages/node-cli/src/analyze/bundle.ts`
- Test: `packages/node-cli/src/__test__/analyze/bundle.spec.ts`

- [ ] **Step 1: Write the failing bundle test**

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBundleWriter } from '../../analyze/bundle'

describe('createBundleWriter', () => {
	let rootDir: string

	beforeEach(() => {
		rootDir = mkdtempSync(join(tmpdir(), 'mito-node-bundle-'))
	})

	afterEach(() => {
		rmSync(rootDir, { force: true, recursive: true })
	})

	it('writes artifact files and returns a stable analyze result', () => {
		const writer = createBundleWriter({ outDir: rootDir, pid: 12345, startedAt: new Date('2026-06-11T00:00:00.000Z') })

		writer.writeJsonArtifact('memory', 'memory.json', { memoryUsage: { rss: 1 } })
		const result = writer.finalize({
			command: 'node demos/listen_server.mjs',
			duration: 3000,
			warnings: [],
			errors: [],
		})

		expect(result.status).toBe('success')
		expect(result.pid).toBe(12345)
		expect(result.bundleDir).toContain(rootDir)
		expect(result.artifacts.memory.status).toBe('ok')
		expect(result.artifacts.report.status).toBe('skipped')
		expect(result.artifacts.cpuProfile.status).toBe('skipped')
		expect(result.readOrder).toEqual(['summaryMd', 'summaryJson', 'memory'])

		const summary = JSON.parse(readFileSync(result.artifacts.summaryJson.path, 'utf8'))
		expect(summary.status).toBe('success')
		expect(readFileSync(result.artifacts.summaryMd.path, 'utf8')).toContain('PID: 12345')
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mitojs/node-cli exec jest --config jest.config.cjs --runInBand src/__test__/analyze/bundle.spec.ts`

Expected: FAIL because `../../analyze/bundle` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `types.ts` with `AnalyzeResult`, `ArtifactStatus`, `AnalyzeArtifactKey`, and `AnalyzeStatus`.

Create `bundle.ts` with:
- `createBundleWriter({ outDir, pid, startedAt })`
- `writeJsonArtifact(key, fileName, data)`
- `writeTextArtifact(key, fileName, data)`
- `markFailed(key, fileName, error)`
- `markSkipped(key, fileName)`
- `finalize({ command, duration, warnings, errors })`

Status rules:
- `success`: at least one core artifact is `ok` and no core artifact is `failed`
- `partial`: at least one core artifact is `ok` and at least one core artifact is `failed`
- `failed`: no core artifact is `ok`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mitojs/node-cli exec jest --config jest.config.cjs --runInBand src/__test__/analyze/bundle.spec.ts`

Expected: PASS.

### Task 2: Inspector Client

**Files:**
- Create: `packages/node-cli/src/inspector/client.ts`
- Create: `packages/node-cli/src/inspector/session.ts`
- Test: `packages/node-cli/src/__test__/inspector/client.spec.ts`

- [ ] **Step 1: Write the failing request/response test**

```ts
import { EventEmitter } from 'node:events'
import { InspectorClient } from '../../inspector/client'

class FakeSocket extends EventEmitter {
	sent: string[] = []
	readyState = 1

	send(message: string) {
		this.sent.push(message)
	}

	close() {}
}

describe('InspectorClient', () => {
	it('matches inspector responses by id', async () => {
		const socket = new FakeSocket()
		const client = new InspectorClient(socket as any)

		const pending = client.send('Runtime.evaluate', { expression: '1 + 1' })
		const request = JSON.parse(socket.sent[0])

		socket.emit('message', Buffer.from(JSON.stringify({ id: request.id, result: { result: { value: 2 } } })))

		await expect(pending).resolves.toEqual({ result: { value: 2 } })
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mitojs/node-cli exec jest --config jest.config.cjs --runInBand src/__test__/inspector/client.spec.ts`

Expected: FAIL because `../../inspector/client` does not exist.

- [ ] **Step 3: Write minimal implementation**

`InspectorClient` responsibilities:
- assign monotonically increasing request ids
- keep a `Map<number, { resolve, reject, timer }>`
- reject on inspector error responses
- support `send<T>(method, params?, timeoutMs?)`
- support `evaluate<T>(expression, timeoutMs?)` using `Runtime.evaluate` with `awaitPromise: true` and `returnByValue: true`
- close the WebSocket without calling target-process `inspector.close()`

`session.ts` responsibilities for first cut:
- validate that the PID exists with `process.kill(pid, 0)`
- send `SIGUSR1` only when the configured port is not reachable
- poll `http://127.0.0.1:<port>/json`
- connect to the first target with `webSocketDebuggerUrl`
- return `{ client, openedByCli, close }`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mitojs/node-cli exec jest --config jest.config.cjs --runInBand src/__test__/inspector/client.spec.ts`

Expected: PASS.

### Task 3: Analyze Collectors

**Files:**
- Create: `packages/node-cli/src/analyze/collectors.ts`
- Test: `packages/node-cli/src/__test__/analyze/collectors.spec.ts`

- [ ] **Step 1: Write failing collector tests**

```ts
import { collectMemory, collectProcessReport } from '../../analyze/collectors'

describe('analyze collectors', () => {
	it('collects memory through Runtime.evaluate', async () => {
		const client = {
			evaluate: jest.fn().mockResolvedValue({ memoryUsage: { rss: 10 } }),
		}

		await expect(collectMemory(client as any)).resolves.toEqual({ memoryUsage: { rss: 10 } })
		expect(client.evaluate).toHaveBeenCalledWith(expect.stringContaining('process.memoryUsage'), expect.any(Number))
	})

	it('collects process report through Runtime.evaluate', async () => {
		const client = {
			evaluate: jest.fn().mockResolvedValue({ header: { nodejsVersion: 'v20.0.0' } }),
		}

		await expect(collectProcessReport(client as any)).resolves.toEqual({ header: { nodejsVersion: 'v20.0.0' } })
		expect(client.evaluate).toHaveBeenCalledWith(expect.stringContaining('process.report.getReport'), expect.any(Number))
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mitojs/node-cli exec jest --config jest.config.cjs --runInBand src/__test__/analyze/collectors.spec.ts`

Expected: FAIL because `../../analyze/collectors` does not exist.

- [ ] **Step 3: Write minimal implementation**

Implement:
- `collectMemory(client)`
- `collectProcessReport(client)`
- `collectCpuProfile(client, durationMs)`

CPU profile should call:
1. `Profiler.enable`
2. `Profiler.start`
3. wait `durationMs`
4. `Profiler.stop`
5. best-effort `Profiler.disable`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mitojs/node-cli exec jest --config jest.config.cjs --runInBand src/__test__/analyze/collectors.spec.ts`

Expected: PASS.

### Task 4: Analyze Orchestration and CLI Routing

**Files:**
- Create: `packages/node-cli/src/analyze/analyze.ts`
- Modify: `packages/node-cli/src/bin.ts`
- Test: `packages/node-cli/src/__test__/analyze/analyze.spec.ts`

- [ ] **Step 1: Write failing orchestration test**

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAnalyze } from '../../analyze/analyze'

describe('runAnalyze', () => {
	let outDir: string

	beforeEach(() => {
		outDir = mkdtempSync(join(tmpdir(), 'mito-node-analyze-'))
	})

	afterEach(() => {
		rmSync(outDir, { force: true, recursive: true })
	})

	it('returns partial when one collector fails and another succeeds', async () => {
		const result = await runAnalyze(
			{ pid: process.pid, port: 9229, outDir, duration: 10 },
			{
				openSession: jest.fn().mockResolvedValue({
					client: {},
					openedByCli: false,
					close: jest.fn(),
				}),
				collectors: {
					memory: jest.fn().mockResolvedValue({ memoryUsage: { rss: 1 } }),
					report: jest.fn().mockRejectedValue(new Error('report unavailable')),
					cpuProfile: jest.fn().mockResolvedValue({ nodes: [] }),
				},
			}
		)

		expect(result.status).toBe('partial')
		expect(result.artifacts.memory.status).toBe('ok')
		expect(result.artifacts.report.status).toBe('failed')
		expect(result.artifacts.cpuProfile.status).toBe('ok')
		expect(result.errors).toContain('report unavailable')
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mitojs/node-cli exec jest --config jest.config.cjs --runInBand src/__test__/analyze/analyze.spec.ts`

Expected: FAIL because `../../analyze/analyze` does not exist.

- [ ] **Step 3: Write minimal implementation**

`runAnalyze(options, deps?)` should:
- validate options
- create bundle writer
- open inspector session
- run memory, report, and CPU profile collectors independently
- write successful artifacts
- mark failed artifacts without aborting the whole run
- always close the session
- return `AnalyzeResult`

`bin.ts` should:
- add `program.command('analyze')`
- support `--pid`, `--port`, `--out-dir`, `--duration`, `--json`
- print only JSON when `--json` is passed
- set `process.exitCode = 1` only when `result.status === 'failed'`
- keep existing low-level commands working for now

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mitojs/node-cli exec jest --config jest.config.cjs --runInBand src/__test__/analyze/analyze.spec.ts`

Expected: PASS.

### Task 5: Verification and Handbook Update

**Files:**
- Modify: `docs/solutions/node-monitoring-handbook.md`

- [ ] **Step 1: Run focused tests**

Run:
```bash
pnpm --filter @mitojs/node-cli exec jest --config jest.config.cjs --runInBand src/__test__/analyze/bundle.spec.ts src/__test__/inspector/client.spec.ts src/__test__/analyze/collectors.spec.ts src/__test__/analyze/analyze.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:
```bash
pnpm --filter @mitojs/node-cli build
```

Expected: PASS, or document the exact build failure if it is unrelated to this PR.

- [ ] **Step 3: Run manual analyze smoke test**

Run:
```bash
node demos/listen_server.mjs
pnpm --filter @mitojs/node-cli build
node packages/node-cli/dist/cli.mjs analyze --pid <pid> --duration 100 --json
```

Expected:
- stdout is valid JSON
- `bundleDir` exists
- `manifest.json`, `summary.json`, `summary.md`, `memory.json`, `process.report.json`, and `cpu.cpuprofile` are present when collectors succeed

- [ ] **Step 4: Update handbook PR status**

Append status under section 12:

```markdown
### PR status

- PR: local first cut
- Commit: not committed
- Verified command: <commands run>
- Bundle example: <bundleDir>
- Remaining gaps: discover command, full inspector port ownership check, CLI contract tests in CI
- Superpower flow: using-superpowers, writing-plans, test-driven-development, verification-before-completion
```
