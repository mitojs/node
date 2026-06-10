#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'USAGE'
Usage:
  scripts/stage-node-monitoring-pr-slice.sh <slice>
  scripts/stage-node-monitoring-pr-slice.sh --dry-run <slice>

Slices:
  cli-local-diagnostics
  agent-http-contract
  sdk-agent-pipeline
  cli-agent-query
  booklet

The script only stages files for the requested slice. It does not commit, push,
or include local demo/test-guide files or generated Agent binaries.
USAGE
}

dry_run=0

if [[ "${1:-}" == "--dry-run" ]]; then
	dry_run=1
	shift
fi

if [[ $# -ne 1 ]]; then
	usage
	exit 1
fi

slice="$1"

stage_existing() {
	for path in "$@"; do
		if [[ -e "$path" ]] && ! is_excluded "$path"; then
			if [[ "$dry_run" -eq 1 ]]; then
				printf '%s\n' "$path"
			else
				git add -- "$path"
			fi
		fi
	done
}

stage_glob() {
	local pattern="$1"
	while IFS= read -r path; do
		if is_excluded "$path"; then
			continue
		fi
		if [[ "$dry_run" -eq 1 ]]; then
			printf '%s\n' "$path"
		else
			git add -- "$path"
		fi
	done < <(find "$pattern" -type f -print 2>/dev/null | sort)
}

is_excluded() {
	case "$1" in
		demos/easyFetch-test-server.ts|\
		packages/node/src/__test__/shared/ReactiveSubject.test-guide.md|\
		packages/node/src/__test__/subjects/subjects.test-guide.md|\
		packages/node/binaries/mitojs-agent-darwin-arm64)
			return 0
			;;
		*)
			return 1
			;;
	esac
}

case "$slice" in
	cli-local-diagnostics)
		stage_existing \
			.gitignore \
			packages/node-cli/jest.config.cjs \
			packages/node-cli/src/bin.ts
		stage_glob packages/node-cli/src/analyze
		stage_glob packages/node-cli/src/discover
		stage_glob packages/node-cli/src/inspector
		stage_glob packages/node-cli/src/__test__/analyze
		stage_glob packages/node-cli/src/__test__/discover
		stage_glob packages/node-cli/src/__test__/inspector
		;;
	agent-http-contract)
		stage_existing \
			agent/src/data_processor/store.rs \
			agent/src/data_processor/subscribe.rs \
			agent/src/ipc/http/common.rs \
			agent/src/ipc/http/endpoints/heartbeat.rs \
			agent/src/ipc/http/endpoints/mod.rs \
			agent/src/ipc/http/endpoints/processes.rs \
			agent/src/ipc/http/http.rs
		;;
	sdk-agent-pipeline)
		stage_existing \
			packages/node/src/agent.ts \
			packages/node/src/binary.ts \
			packages/node/src/client.ts \
			packages/node/src/init.ts \
			packages/node/src/proxy_thread/index.ts \
			packages/node/src/request.ts \
			packages/node/src/shared/constants.ts \
			packages/node/src/subjects/index.ts \
			packages/node/src/subjects/js-error.ts \
			packages/node/src/subjects/timeout.ts \
			packages/node/src/types.ts \
			packages/node/tsconfig.json \
			packages/node/src/__test__/shared/ReactiveSubject.spec.ts
		stage_glob packages/node/src/__test__/agent
		stage_glob packages/node/src/__test__/client
		stage_glob packages/node/src/__test__/subjects
		if [[ "$dry_run" -ne 1 ]]; then
			git restore --staged -- \
				packages/node/src/__test__/subjects/subjects.test-guide.md \
				packages/node/src/__test__/shared/ReactiveSubject.test-guide.md \
				packages/node/binaries/mitojs-agent-darwin-arm64 \
				2>/dev/null || true
		fi
		;;
	cli-agent-query)
		stage_existing packages/node-cli/src/bin.ts
		stage_glob packages/node-cli/src/agent
		stage_glob packages/node-cli/src/__test__/agent
		;;
	booklet)
		stage_existing \
			docs/solutions/node-monitoring-handbook.md \
			docs/solutions/node-monitoring-pr-body.md \
			docs/solutions/node-monitoring-pr-handoff.md \
			docs/solutions/node-process-analysis-plan.md \
			docs/solutions/node-monitoring-pr-slices.md \
			docs/superpowers/plans/2026-06-11-analyze-first-cut.md \
			scripts/stage-node-monitoring-pr-slice.sh \
			scripts/smoke-sdk-agent-cli.sh
		;;
	-h|--help|help)
		usage
		exit 0
		;;
	*)
		echo "Unknown slice: $slice" >&2
		usage >&2
		exit 1
		;;
esac

if [[ "$dry_run" -eq 1 ]]; then
	echo "Dry-run slice: $slice" >&2
else
	echo "Staged slice: $slice"
	git diff --cached --name-status
fi
