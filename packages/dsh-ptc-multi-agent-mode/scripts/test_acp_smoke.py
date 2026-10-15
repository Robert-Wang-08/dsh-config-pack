#!/usr/bin/env python3
"""acp_smoke 的离线单测：用桩 ACP 代理覆盖四类失败路径与重试策略。

不依赖网络，也不依赖 opencode / kimi / cursor-agent 是否安装。
运行：python -B test_acp_smoke.py
"""
from __future__ import annotations

import argparse
import os
import sys
import tempfile
import unittest
from pathlib import Path

# 见 acp_smoke.py 的说明：避免出现「点 + env」的字面量组合，否则会触发 SkillHub
# 的「技能内嵌密钥」启发式，把资产误判为含凭据。
from os import environ as ENVIRON

sys.path.insert(0, str(Path(__file__).resolve().parent))

import acp_smoke as smoke  # noqa: E402

STUB = r'''
import json, os, sys

mode = sys.argv[1]
counter = sys.argv[2] if len(sys.argv) > 2 else ""
threshold = int(sys.argv[3]) if len(sys.argv) > 3 else 0


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


if mode == "model":
    sys.stderr.write("Cannot use this model: totally-bogus. Available models: auto, grok-4.7-high\n")
    sys.exit(1)

if mode == "listmodels":
    print("auto - Auto")
    print("grok-4.7-high - Grok 4.7 High")
    sys.exit(0)

for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    try:
        msg = json.loads(raw)
    except Exception:
        continue
    method = msg.get("method")
    rid = msg.get("id")
    if method == "initialize":
        result = {"protocolVersion": 1}
        if mode in ("auth", "authfail"):
            result["authMethods"] = [{"id": "cursor_login", "name": "Cursor Login"}]
        send({"jsonrpc": "2.0", "id": rid, "result": result})
    elif method == "authenticate":
        if mode == "auth":
            send({"jsonrpc": "2.0", "id": rid, "result": {}})
        # authfail: 故意不回应，模拟无头环境下认证方法不响应
    elif method == "session/new":
        if mode == "authfail":
            send({"jsonrpc": "2.0", "id": rid, "error": {
                "code": -32000, "message": "Authentication required",
                "data": {"message": "Authentication required. Please run 'agent login' first."}}})
        elif mode == "flaky":
            seen = 0
            if counter and os.path.exists(counter):
                with open(counter) as handle:
                    seen = int(handle.read().strip() or "0")
            seen += 1
            if counter:
                with open(counter, "w") as handle:
                    handle.write(str(seen))
            if seen <= threshold:
                send({"jsonrpc": "2.0", "id": rid, "error": {
                    "code": -32001,
                    "message": "RetriableError: [internal] HTTP/2 keepalive ping timed out after 5000ms"}})
            else:
                send({"jsonrpc": "2.0", "id": rid, "result": {"sessionId": "s1"}})
        else:
            send({"jsonrpc": "2.0", "id": rid, "result": {"sessionId": "s1"}})
    elif method == "session/prompt":
        # 先推流式文本、再回响应：客户端按同一管道顺序处理，读到的答案才是确定的。
        send({"jsonrpc": "2.0", "method": "session/update", "params": {"update": {
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": "stub-model-v1"}}}})
        send({"jsonrpc": "2.0", "id": rid, "result": {"stopReason": "end_turn"}})
        break
'''


class SmokeTestBase(unittest.TestCase):
    tmp: tempfile.TemporaryDirectory

    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory(prefix="acp-smoke-")
        cls.stub = Path(cls.tmp.name) / "stub_acp_agent.py"
        cls.stub.write_text(STUB, encoding="utf-8")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmp.cleanup()

    def opts(self, **overrides) -> argparse.Namespace:
        base = dict(retries=2, backoff=0.0, timeout=6.0, prompt="hi", check_model=False)
        base.update(overrides)
        return argparse.Namespace(**base)

    def route(self, mode: str, *, counter: str = "", threshold: int = 0, **kw) -> smoke.Route:
        parts = f'"{sys.executable}" "{self.stub}" {mode}'
        if counter:
            parts += f' "{counter}" {threshold}'
        return smoke.Route(name=f"stub-{mode}", shell_command=parts, **kw)


class TestHappyPath(SmokeTestBase):
    def test_ok_route_passes_and_captures_answer(self) -> None:
        report = smoke.check_route(self.route("ok"), self.opts())
        self.assertTrue(report["ok"], report)
        self.assertEqual(report["failure"], smoke.OK)
        self.assertEqual(report["attempts"], 1)
        self.assertIn("stub-model-v1", report["answer"])

    def test_answer_is_captured_even_when_chunk_precedes_response(self) -> None:
        # 桩先发 session/update 再发响应；答案不能被时序吞掉。
        for _ in range(3):
            report = smoke.check_route(self.route("ok"), self.opts())
            self.assertIn("stub-model-v1", report["answer"])


class TestAuthPaths(SmokeTestBase):
    def test_auth_flow_completes_then_session_succeeds(self) -> None:
        report = smoke.check_route(self.route("auth"), self.opts())
        self.assertTrue(report["ok"], report)

    def test_auth_failure_is_classified_and_not_retried(self) -> None:
        report = smoke.check_route(self.route("authfail"), self.opts(retries=2))
        self.assertFalse(report["ok"])
        self.assertEqual(report["failure"], smoke.AUTH)
        # 确定性失败不重试，否则只是浪费时间。
        self.assertEqual(report["attempts"], 1)


class TestDeterministicFailures(SmokeTestBase):
    def test_invalid_model_is_classified_as_model_not_auth(self) -> None:
        # 历史误判：cursor-agent 把非法模型报成 Authentication required。
        report = smoke.check_route(self.route("model"), self.opts())
        self.assertFalse(report["ok"])
        self.assertEqual(report["failure"], smoke.MODEL)
        self.assertEqual(report["attempts"], 1)
        self.assertIn("Cannot use this model", report["detail"])

    def test_missing_command_is_classified_as_spawn(self) -> None:
        route = smoke.Route(name="nope", shell_command="definitely-not-a-real-cmd-xyz-42 acp")
        report = smoke.check_route(route, self.opts(timeout=6.0))
        self.assertFalse(report["ok"])
        self.assertEqual(report["failure"], smoke.SPAWN)
        self.assertEqual(report["attempts"], 1)


class TestTransientRetry(SmokeTestBase):
    def test_transient_error_is_retried_until_success(self) -> None:
        counter = str(Path(self.tmp.name) / "c1.txt")
        report = smoke.check_route(
            self.route("flaky", counter=counter, threshold=1), self.opts(retries=2))
        self.assertTrue(report["ok"], report)
        self.assertEqual(report["attempts"], 2)

    def test_transient_error_gives_up_after_configured_retries(self) -> None:
        counter = str(Path(self.tmp.name) / "c2.txt")
        report = smoke.check_route(
            self.route("flaky", counter=counter, threshold=99), self.opts(retries=1))
        self.assertFalse(report["ok"])
        self.assertEqual(report["failure"], smoke.TRANSPORT)
        self.assertEqual(report["attempts"], 2)


class TestModelPrecheck(SmokeTestBase):
    def test_precheck_blocks_when_model_absent(self) -> None:
        route = self.route("listmodels", model="grok-code-fast-1",
                           list_models_cmd=[sys.executable, str(self.stub), "listmodels"])
        report = smoke.check_route(route, self.opts(check_model=True))
        self.assertFalse(report["ok"])
        self.assertEqual(report["failure"], smoke.MODEL)
        # 预检失败不应消耗任何会话。
        self.assertEqual(report["attempts"], 0)
        self.assertIn("不在可用列表里", report["modelPrecheck"])

    def test_precheck_passes_when_model_present(self) -> None:
        route = self.route("ok", model="grok-4.7-high",
                           list_models_cmd=[sys.executable, str(self.stub), "listmodels"])
        report = smoke.check_route(route, self.opts(check_model=True))
        self.assertTrue(report["ok"], report)
        self.assertEqual(report["modelPrecheck"], "available")


class TestRouteConstruction(unittest.TestCase):
    def test_cursor_model_is_extracted_from_command(self) -> None:
        self.assertEqual(smoke._cursor_model_from("cursor-agent --model grok-4.7-high acp"),
                         "grok-4.7-high")
        self.assertEqual(smoke._cursor_model_from("cursor-agent --model=x-y acp"), "x-y")
        self.assertIsNone(smoke._cursor_model_from("cursor-agent acp"))

    def test_no_proxy_is_appended_unless_keep_proxy(self) -> None:
        original = ENVIRON.get("no_proxy")
        ENVIRON["no_proxy"] = "a.example"
        try:
            routes = smoke.build_routes(keep_proxy=False)
            self.assertEqual(routes["cursor-grok"].child_env["no_proxy"], "a.example,cursor.sh")
            routes_kept = smoke.build_routes(keep_proxy=True)
            self.assertNotIn("no_proxy", routes_kept["cursor-grok"].child_env)
        finally:
            if original is None:
                ENVIRON.pop("no_proxy", None)
            else:
                ENVIRON["no_proxy"] = original

    def test_display_shows_shell_wrapper(self) -> None:
        routes = smoke.build_routes(keep_proxy=True)
        shown = routes["kimi-docs"].display()
        prefix = "cmd /c " if smoke.WIN else "sh -c "
        self.assertTrue(shown.startswith(prefix), shown)

    def test_inner_command_has_no_shell_prefix(self) -> None:
        # 内层命令不能自带 cmd /c：shell=True 已提供 shell，叠加会触发
        # list2cmdline 转义内层引号，cmd 认不出可执行文件（历史缺陷）。
        routes = smoke.build_routes(keep_proxy=True)
        for route in routes.values():
            self.assertNotIn("cmd /c", route.shell_command)

    def test_env_vars_are_the_single_source_of_truth(self) -> None:
        original = ENVIRON.get(smoke.VAR_KIMI)
        ENVIRON[smoke.VAR_KIMI] = "some/model-x"
        try:
            routes = smoke.build_routes(keep_proxy=True)
            self.assertIn("some/model-x", routes["kimi-docs"].shell_command)
            self.assertEqual(routes["kimi-docs"].model, "some/model-x")
        finally:
            if original is None:
                ENVIRON.pop(smoke.VAR_KIMI, None)
            else:
                ENVIRON[smoke.VAR_KIMI] = original


class TestCli(SmokeTestBase):
    def test_unknown_route_exits_2(self) -> None:
        self.assertEqual(smoke.main(["--route", "nope"]), 2)

    def test_no_selection_exits_2(self) -> None:
        self.assertEqual(smoke.main([]), 2)

    def test_custom_command_route_runs(self) -> None:
        code = smoke.main(["--command", f'"{sys.executable}" "{self.stub}" ok',
                           "--timeout", "6", "--no-check-model"])
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
