"""Exercise the built demo in a real Unix PTY; keep all output outside audit snapshots."""
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time

node, root = sys.argv[1:3]
with tempfile.TemporaryDirectory(prefix="mito-terminal-test-") as directory:
    evidence = Path(directory)
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 68, 240, 0, 0))
    env = {**os.environ, "MITO_EVIDENCE_DIR": directory, "TERM": "xterm-256color", "NO_COLOR": "1"}
    env.pop("CI", None)
    env.pop("FORCE_COLOR", None)
    child = subprocess.Popen(
        [node, "scripts/self-test-terminal.mjs"], cwd=root, env=env,
        stdin=slave, stdout=slave, stderr=slave, start_new_session=True
    )
    os.close(slave)
    output = bytearray()

    def pump(seconds):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if select.select([master], [], [], min(.05, max(0, end - time.monotonic())))[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    return
                if not chunk:
                    return
                output.extend(chunk)

    def text():
        return re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", output.decode("utf8", "replace"))

    session = None
    second_target = None
    try:
        deadline = time.monotonic() + 6
        while not (evidence / "session.json").exists() and time.monotonic() < deadline:
            pump(.1)
        session = json.loads((evidence / "session.json").read_text())
        expected_pid = "PID " + str(session["targetPid"])
        deadline = time.monotonic() + 2
        while expected_pid not in text() and time.monotonic() < deadline:
            pump(.1)
        auto_selected = expected_pid in text()
        if not auto_selected:
            # Baseline fallback lets the redraw assertion fail independently of PID preselection.
            os.write(master, b"/")
            pump(.15)
            os.write(master, str(session["targetPid"]).encode())
            pump(.15)
            os.write(master, b"\r")
            pump(.15)
            os.write(master, b"\r")
        deadline = time.monotonic() + 8
        while not re.search(r"最近错误 0\s+活跃定时器 [1-9]\d*", text()) and time.monotonic() < deadline:
            pump(.1)

        def press_expect(keys, expected):
            start = len(output)
            os.write(master, keys)
            until = time.monotonic() + .7
            while expected not in output[start:].decode("utf8", "replace") and time.monotonic() < until:
                pump(.05)
            return expected in output[start:].decode("utf8", "replace")

        task_down = press_expect(b"\x1b[B", "› 查看内存详情")
        task_up = press_expect(b"\x1b[A", "› 采集 CPU Profile")
        parameter_open = press_expect(b"\r", "采集时长 (ms): 10000▏")
        parameter_down = press_expect(b"\x1b[B", "输出目录: .▏")
        os.write(master, b"\x1b")
        pump(.2)
        keyboard_tasks = task_down and task_up and parameter_open and parameter_down
        offset = len(output)
        pump(2)
        steady = bytes(output[offset:])
        observed = text()
        # A separate owned target shares the configured port but has no SDK.
        # Switching must use its Inspector data, never the preselected demo's Agent data.
        second_target = subprocess.Popen([
            node, "--inspect-port=127.0.0.1:" + str(session["inspectorPort"]),
            "-e", "setInterval(() => {}, 1000)"
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        pump(.2)
        os.write(master, b"p")
        pump(.2)
        os.write(master, b"/")
        pump(.15)
        os.write(master, str(second_target.pid).encode())
        pump(.15)
        os.write(master, b"\r")
        pump(.15)
        switch_offset = len(output)
        os.write(master, b"\r")
        deadline = time.monotonic() + 5
        while "来源 inspector" not in output[switch_offset:].decode("utf8", "replace") and time.monotonic() < deadline:
            pump(.1)
        switched = output[switch_offset:].decode("utf8", "replace")
        os.write(master, b"\x03")
        deadline = time.monotonic() + 5
        while child.poll() is None and time.monotonic() < deadline:
            pump(.1)
        child.wait(timeout=1)
        final = json.loads((evidence / "session.json").read_text())
        print(json.dumps({
            "autoSelected": auto_selected,
            "sdk": "SDK 已注册" in observed and "Agent 已连接" in observed,
            "errors": "最近错误 0" in observed,
            "timers": bool(re.search(r"活跃定时器 [1-9]\d*", observed)),
            "steadyBytes": len(steady),
            "erasedLines": steady.count(b"\x1b[2K"),
            "updates": steady.count(b"\x1b["),
            "exitCode": child.returncode,
            "targetExitCode": final.get("targetExitCode"),
            "keyboardTasks": keyboard_tasks,
            "switchedToInspector": "来源 inspector" in switched and ("PID " + str(second_target.pid)) in switched
        }))
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                child.kill()
        if second_target and second_target.poll() is None:
            second_target.terminate()
            second_target.wait(timeout=2)
        if session and child.returncode != 130:
            try:
                os.kill(session["targetPid"], signal.SIGTERM)
            except ProcessLookupError:
                pass
        os.close(master)
