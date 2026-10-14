from __future__ import annotations

import argparse
import contextlib
import io
import json
import tempfile
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ptc_task_control as ptc


class PtcTaskControlTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.ledger = Path(self.temp.name) / "registry.jsonl"
        self.contract = {"schema_version": "1.0", "deliverables": [], "invariants": []}
        events = [
            ptc.build_event("registry_initialized", "test", payload={"controller_only_write": True}),
            ptc.build_event(
                "project_created",
                "test",
                project_id="project-test",
                payload={"name": "Test", "description": ""},
            ),
            ptc.build_event(
                "task_created",
                "test",
                project_id="project-test",
                task_id="task-test",
                payload={
                    "title": "测试任务",
                    "objective": "验证唯一账本",
                    "owner": "test",
                    "contract": self.contract,
                },
            ),
        ]
        ptc.append_events(self.ledger, events)

    def append(self, event_type: str, **kwargs):
        event = ptc.build_event(event_type, "test", **kwargs)
        return ptc.append_events(self.ledger, [event])

    def test_happy_path_reaches_done_with_evidence(self) -> None:
        self.append(
            "session_started",
            task_id="task-test",
            session_id="session-test",
            payload={"controller": "codex", "controller_model": "gpt-5.6-sol/high"},
        )
        self.append(
            "task_status_changed",
            task_id="task-test",
            session_id="session-test",
            payload={
                "status": "in_progress",
                "progress": 10,
                "summary": "开始",
                "next_action": "执行",
                "evidence": [],
            },
        )
        self.append(
            "subtask_created",
            task_id="task-test",
            session_id="session-test",
            payload={
                "subtask_id": "subtask-test",
                "title": "原子修改",
                "objective": "只改一个点",
                "route": "execute-dsv41-flash",
                "expected_output": "receipt JSON",
            },
        )
        receipt = {
            "schema_version": "1.0",
            "receipt_id": "receipt-test",
            "task_id": "task-test",
            "subtask_id": "subtask-test",
            "route": "execute-dsv41-flash",
            "executor": "opencode",
            "model": "deepseek-v4.1-flash",
            "outcome": "completed",
            "summary": "完成",
            "files_changed": ["a.txt"],
            "validation": ["unit test passed"],
            "risks": [],
        }
        self.append(
            "receipt_recorded",
            task_id="task-test",
            session_id="session-test",
            payload={"receipt": receipt},
        )
        self.append(
            "task_status_changed",
            task_id="task-test",
            session_id="session-test",
            payload={
                "status": "review",
                "progress": 90,
                "summary": "待复核",
                "next_action": "复核",
                "evidence": ["receipt-test"],
            },
        )
        state = self.append(
            "task_status_changed",
            task_id="task-test",
            session_id="session-test",
            payload={
                "status": "done",
                "progress": 100,
                "summary": "已完成",
                "next_action": "无",
                "evidence": ["unit test passed"],
            },
        )
        self.assertEqual(state.tasks["task-test"]["status"], "done")
        self.assertEqual(state.subtasks["subtask-test"]["receipt_id"], "receipt-test")

    def test_done_without_review_is_rejected(self) -> None:
        with self.assertRaises(ptc.LedgerError):
            self.append(
                "task_status_changed",
                task_id="task-test",
                payload={
                    "status": "done",
                    "progress": 100,
                    "summary": "跳过",
                    "next_action": "无",
                    "evidence": ["self claim"],
                },
            )

    def test_second_active_session_is_rejected(self) -> None:
        self.append(
            "session_started",
            task_id="task-test",
            session_id="session-1",
            payload={"controller": "codex", "controller_model": "gpt-5.6-sol/high"},
        )
        with self.assertRaises(ptc.LedgerError):
            self.append(
                "session_started",
                task_id="task-test",
                session_id="session-2",
                payload={"controller": "kimi", "controller_model": "k3-256k"},
            )

    def test_receipt_extra_field_is_rejected(self) -> None:
        receipt = {
            "schema_version": "1.0",
            "receipt_id": "receipt-extra",
            "task_id": "task-test",
            "subtask_id": "subtask-test",
            "route": "execute-dsv41-flash",
            "executor": "opencode",
            "model": "deepseek-v4.1-flash",
            "outcome": "completed",
            "summary": "完成",
            "files_changed": [],
            "validation": [],
            "risks": [],
            "unexpected": True,
        }
        with self.assertRaises(ptc.LedgerError):
            ptc.validate_receipt(receipt, task_id="task-test")

    def test_receipt_route_must_match_dispatched_subtask(self) -> None:
        self.append(
            "subtask_created",
            task_id="task-test",
            payload={
                "subtask_id": "fixture-route-check",
                "title": "路由一致性",
                "objective": "拒绝伪造 route",
                "route": "docs-kimi",
                "expected_output": "receipt JSON",
            },
        )
        receipt = {
            "schema_version": "1.0",
            "receipt_id": "receipt-route-mismatch",
            "task_id": "task-test",
            "subtask_id": "fixture-route-check",
            "route": "execute-dsv41-flash",
            "executor": "opencode",
            "model": "deepseek-v4.1-flash",
            "outcome": "completed",
            "summary": "伪造 route",
            "files_changed": [],
            "validation": ["none"],
            "risks": [],
        }
        with self.assertRaises(ptc.LedgerError):
            self.append(
                "receipt_recorded",
                task_id="task-test",
                payload={"receipt": receipt},
            )

    def test_project_event_is_visible_in_timeline(self) -> None:
        state = self.append(
            "project_event_recorded",
            project_id="project-test",
            task_id="task-test",
            payload={"kind": "decision", "message": "采用单一账本", "evidence": ["ADR-001"]},
        )
        self.assertEqual(state.timeline[0]["kind"], "decision")
        self.assertEqual(state.timeline[0]["task_id"], "task-test")

    def test_progress_cannot_move_backwards(self) -> None:
        self.append(
            "task_status_changed",
            task_id="task-test",
            payload={
                "status": "in_progress",
                "progress": 30,
                "summary": "推进",
                "next_action": "继续",
                "evidence": [],
            },
        )
        with self.assertRaises(ptc.LedgerError):
            self.append(
                "task_status_changed",
                task_id="task-test",
                payload={
                    "status": "in_progress",
                    "progress": 20,
                    "summary": "回退",
                    "next_action": "继续",
                    "evidence": [],
                },
            )

    def test_ledger_option_works_before_and_after_subcommand(self) -> None:
        """两种写法都必须命中同一个账本，避免误落到默认 .ptc 目录。"""
        for argv in (
            ["--ledger", str(self.ledger), "verify"],
            ["verify", "--ledger", str(self.ledger)],
        ):
            with self.subTest(argv=argv):
                buffer = io.StringIO()
                with contextlib.redirect_stdout(buffer):
                    code = ptc.main(argv)
                self.assertEqual(code, 0)
                payload = json.loads(buffer.getvalue())
                self.assertEqual(payload["ledger"], str(self.ledger))
                self.assertEqual(payload["events"], 3)

    def test_main_resolves_default_ledger_and_actor(self) -> None:
        """省略选项时回落到默认账本，且 actor 永不为空。"""
        parser = ptc.build_parser()
        args = parser.parse_args(["verify"])
        self.assertFalse(hasattr(args, "ledger"))
        self.assertFalse(hasattr(args, "actor"))

    def _start(self, task_id: str, session_id: str) -> None:
        self.append(
            "session_started",
            task_id=task_id,
            session_id=session_id,
            payload={"controller": "codex", "controller_model": "gpt-5.6-sol/high"},
        )

    def _finish_task(self, task_id: str) -> None:
        self.append(
            "task_status_changed",
            task_id=task_id,
            payload={
                "status": "cancelled",
                "progress": 0,
                "summary": "终结",
                "next_action": "无",
                "evidence": [],
            },
        )

    def _new_task(self, task_id: str) -> None:
        self.append(
            "task_created",
            project_id="project-test",
            task_id=task_id,
            payload={
                "title": "纠正轮",
                "objective": "复核并修正",
                "owner": "test",
                "contract": self.contract,
            },
        )

    def test_session_can_rebind_after_previous_binding_ended(self) -> None:
        """同一 DSH 会话收官后开启纠正轮，不应被永久占用。"""
        self._start("task-test", "session-test")
        self.append("session_ended", task_id="task-test", session_id="session-test",
                    payload={"summary": "第一轮完成"})
        self._finish_task("task-test")
        self._new_task("task-second")
        self._start("task-second", "session-test")

        state = ptc.reduce_events(ptc.read_events(self.ledger))
        session = state.sessions["session-test"]
        self.assertEqual(session["task_id"], "task-second")
        self.assertFalse(session["ended"])
        self.assertEqual(len(session["history"]), 1)
        self.assertEqual(session["history"][0]["task_id"], "task-test")

    def test_session_rebind_rejected_while_previous_task_is_open(self) -> None:
        """上一轮 task 未终结时换绑会静默扯断控制权，必须拒绝。"""
        self._start("task-test", "session-test")
        self.append("session_ended", task_id="task-test", session_id="session-test",
                    payload={"summary": "先结束绑定"})
        self._new_task("task-second")
        with self.assertRaises(ptc.LedgerError):
            self._start("task-second", "session-test")

    def test_session_rebind_rejected_while_still_active(self) -> None:
        """绑定仍活动时，同一 session 不能再绑第二个 task。"""
        self._start("task-test", "session-test")
        self._new_task("task-second")
        with self.assertRaises(ptc.LedgerError):
            self._start("task-second", "session-test")


if __name__ == "__main__":
    unittest.main()
