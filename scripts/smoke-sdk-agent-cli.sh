#!/usr/bin/env bash
set -euo pipefail

port="${MITO_AGENT_TCP_PORT:-16679}"
status_file="$(mktemp -t mito-sdk-agent-status.XXXXXX.json)"
metrics_file="$(mktemp -t mito-sdk-agent-metrics.XXXXXX.json)"

cleanup() {
	if [[ -n "${sdk_pid:-}" ]]; then
		kill "$sdk_pid" >/dev/null 2>&1 || true
		wait "$sdk_pid" >/dev/null 2>&1 || true
	fi
	rm -f "$status_file" "$metrics_file"
}
trap cleanup EXIT

MITO_AGENT_TCP_PORT="$port" node - <<'NODE' &
const { MitoNode } = require('./packages/node/dist/client.js')

async function main() {
	const client = new MitoNode()
	await client.start()
	setTimeout(() => {}, 30000)
	process.emit('uncaughtException', new Error('sdk smoke error'))
	await new Promise((resolve) => setTimeout(resolve, 9000))
	await client.destroy()
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
NODE
sdk_pid=$!

ready=0
for _ in {1..20}; do
	if node packages/node-cli/dist/cli.mjs agent status --host localhost --port "$port" --json >/dev/null 2>&1; then
		ready=1
		break
	fi
	sleep 0.3
done

if [[ "$ready" -ne 1 ]]; then
	echo "Agent did not become ready on port $port" >&2
	exit 1
fi

sleep 6
node packages/node-cli/dist/cli.mjs agent status --host localhost --port "$port" --json >"$status_file"
node packages/node-cli/dist/cli.mjs agent metrics --pid "$sdk_pid" --host localhost --port "$port" --json >"$metrics_file"

node - "$status_file" "$metrics_file" <<'NODE'
const fs = require('node:fs')

const status = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const metrics = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
const processInfo = status.processes[0]
const metricTypes = [...new Set(metrics.metrics.map((metric) => metric.metric_type))].sort()
const missing = ['cpu', 'js_error', 'memory', 'timeout'].filter((type) => !metricTypes.includes(type))

const summary = {
	agent: status.agent,
	process_id: processInfo?.process_id,
	proxy_port: processInfo?.proxy_port,
	metric_types: metricTypes,
	metric_status: metrics.status,
	missing,
}

console.log(JSON.stringify(summary, null, 2))

if (metrics.status !== 'success' || missing.length > 0) {
	process.exit(1)
}
NODE

wait "$sdk_pid"
