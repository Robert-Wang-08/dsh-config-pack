#!/usr/bin/env python3
"""ptc_route 离线单测：覆盖 R1–R9、优先级、U2 候选链与无效输入。

运行：python -B test_ptc_route.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ptc_route as route  # noqa: E402

SCRIPT = Path(__file__).resolve().parent / "ptc_route.py"


def base(**overrides):
    data = {
        "writes_files": False,
        "file_count": 0,
        "uncertainty": "low",
        "adjudication": False,
        "validation_burden": "low",
        "context_lines": 100,
        "cross_directory": False,
        "failure_cost": "low",
        "work_kind": "code",
        "prefers_acp": False,
        "background": False,
    }
    data.update(overrides)
    return data


class TestRules(unittest.TestCase):
    def test_r1_cross_directory(self):
        d = route.decide(base(cross_directory=True, failure_cost="high", work_kind="docs"))
        self.assertEqual(d["rule"], "R1")
        self.assertEqual(d["tier"], "controller")
        self.assertEqual(d["route"], "controller-codex")
        self.assertEqual(d["executor"], "none")
        self.assertEqual(d["model"], route.CONTROLLER_MODEL)
        self.assertEqual(d["effort"], route.CONTROLLER_EFFORT)
        self.assertEqual(d["shape"], "session")

    def test_r2_high_failure_cost(self):
        d = route.decide(base(failure_cost="high", writes_files=True, file_count=1))
        self.assertEqual(d["rule"], "R2")
        self.assertEqual(d["route"], "controller-codex")
        self.assertEqual(d["effort"], route.CONTROLLER_EFFORT)

    def test_r3_docs(self):
        d = route.decide(
            base(writes_files=True, file_count=3, work_kind="docs", uncertainty="medium")
        )
        self.assertEqual(d["rule"], "R3")
        self.assertEqual(d["tier"], "docs")
        self.assertEqual(d["route"], "docs-kimi")
        self.assertEqual(d["executor"], "subagent_kimi_docs")
        self.assertEqual(d["model"], route.DOCS_MODEL)
        self.assertEqual(d["shape"], "one-shot")
        self.assertIn("文档路径", d["required_validation"])

    def test_r4_adjudication_design(self):
        d = route.decide(
            base(writes_files=False, uncertainty="high", adjudication=True)
        )
        self.assertEqual(d["rule"], "R4")
        self.assertEqual(d["route"], "design-codex-astra")
        self.assertEqual(d["provider"], route.ASTRA_PROVIDER)
        self.assertEqual(d["executor"], route.EXEC_DESIGN_ASTRA)
        self.assertEqual(d["candidate_chain"][1]["route"], "design-opus55")

    def test_explicit_top_down_uses_single_opus55_review(self):
        d = route.decide(base(writes_files=False, design_mode="top_down"))
        self.assertEqual(d["rule"], "R4")
        self.assertEqual(d["candidate_chain"][0]["route"], "design-codex-astra")
        self.assertEqual(
            [c["executor"] for c in d["candidate_chain"]].count(route.EXEC_OPUS55),
            1,
        )

    def test_r5_external_design(self):
        d = route.decide(
            base(writes_files=False, uncertainty="high", adjudication=False)
        )
        self.assertEqual(d["rule"], "R5")
        self.assertEqual(d["tier"], "design")
        self.assertEqual(d["route"], "design-codex-astra")
        self.assertEqual(d["provider"], route.ASTRA_PROVIDER)
        self.assertEqual(d["executor"], route.EXEC_DESIGN_ASTRA)
        self.assertEqual(d["model"], route.ASTRA_MODEL)
        self.assertEqual(d["effort"], "high")
        self.assertEqual(d["shape"], "one-shot")
        self.assertNotIn("design-opus55", d["fallback_routes"])

    def test_r6_many_files(self):
        d = route.decide(
            base(writes_files=True, file_count=6, uncertainty="medium")
        )
        self.assertEqual(d["rule"], "R6")
        self.assertEqual(d["route"], "controller-codex")

    def test_r6_many_files_low_uncertainty(self):
        d = route.decide(base(writes_files=True, file_count=6, uncertainty="low"))
        self.assertEqual(d["rule"], "R6")

    def test_r7_continuous(self):
        d = route.decide(
            base(
                writes_files=True,
                file_count=3,
                uncertainty="low",
                context_lines=5000,
                failure_cost="medium",
            )
        )
        self.assertEqual(d["rule"], "R7")
        self.assertEqual(d["tier"], "continuous")
        self.assertEqual(d["route"], "continuous-cursor-grok")
        self.assertEqual(d["executor"], "subagent_cursor_grok")
        self.assertEqual(d["model"], "auto")
        self.assertEqual(d["shape"], "one-shot")

    def test_r8_execute_spawn_foreground(self):
        d = route.decide(
            base(
                writes_files=True,
                file_count=1,
                uncertainty="low",
                context_lines=100,
                prefers_acp=False,
                background=False,
            )
        )
        self.assertEqual(d["rule"], "R8")
        self.assertEqual(d["tier"], "execute")
        self.assertEqual(d["route"], "execute-dsv41-flash")
        self.assertEqual(d["executor"], "subagent")
        self.assertEqual(d["model"], route.EXECUTE_MODEL)
        self.assertEqual(d["shape"], "foreground-one-shot")

    def test_validation_defaults_to_ds_group(self):
        d = route.decide(base(validation_burden="high"))
        self.assertEqual(d["tier"], "execute")
        self.assertEqual(d["provider"], route.EXECUTE_PROVIDER)
        self.assertEqual(d["candidate_chain"][1]["provider"], "opencode-go")

    def test_r8_execute_spawn_background_continuable(self):
        d = route.decide(
            base(
                writes_files=True,
                file_count=1,
                uncertainty="low",
                prefers_acp=False,
                background=True,
            )
        )
        self.assertEqual(d["rule"], "R8")
        self.assertEqual(d["executor"], "subagent")
        self.assertEqual(d["shape"], "continuable")

    def test_r8_execute_medium_uncertainty(self):
        d = route.decide(base(writes_files=True, file_count=1, uncertainty="medium"))
        self.assertEqual(d["rule"], "R8")
        self.assertEqual(d["tier"], "execute")

    def test_r8_read_only_probe(self):
        d = route.decide(base(writes_files=False, uncertainty="medium"))
        self.assertEqual(d["rule"], "R8")
        self.assertEqual(d["tier"], "execute")
        self.assertIn("files_changed=[]", d["required_validation"])

    def test_r8_execute_prefers_acp(self):
        d = route.decide(
            base(
                writes_files=True,
                file_count=1,
                uncertainty="low",
                prefers_acp=True,
                background=True,
            )
        )
        self.assertEqual(d["rule"], "R8")
        self.assertEqual(d["executor"], "subagent_opencode_dsv41")
        self.assertEqual(d["shape"], "one-shot")

    def test_r9_fallback(self):
        d = route.decide(
            base(
                writes_files=True,
                file_count=3,
                uncertainty="high",
                context_lines=20_000,
            )
        )
        self.assertEqual(d["rule"], "R9")
        self.assertEqual(d["route"], "controller-codex")
        self.assertEqual(d["effort"], route.CONTROLLER_EFFORT)


class TestPriority(unittest.TestCase):
    def test_docs_beats_continuous_scale(self):
        """R3 在第 3 位：2–5 文件文档不得被 R7 截获。"""
        d = route.decide(
            base(
                writes_files=True,
                file_count=3,
                uncertainty="low",
                work_kind="docs",
                context_lines=100,
            )
        )
        self.assertEqual(d["rule"], "R3")
        self.assertEqual(d["route"], "docs-kimi")

    def test_cross_directory_beats_docs(self):
        d = route.decide(
            base(
                writes_files=True,
                work_kind="docs",
                cross_directory=True,
                file_count=2,
            )
        )
        self.assertEqual(d["rule"], "R1")

    def test_high_cost_beats_docs(self):
        d = route.decide(
            base(
                writes_files=True,
                work_kind="docs",
                failure_cost="high",
                file_count=2,
            )
        )
        self.assertEqual(d["rule"], "R2")

    def test_r4_beats_r5(self):
        d = route.decide(
            base(writes_files=False, uncertainty="high", adjudication=True)
        )
        self.assertEqual(d["rule"], "R4")

    def test_r6_beats_r7_when_many_files(self):
        d = route.decide(
            base(writes_files=True, file_count=6, uncertainty="medium")
        )
        self.assertEqual(d["rule"], "R6")

    def test_r7_context_too_large_falls_to_r9(self):
        d = route.decide(
            base(
                writes_files=True,
                file_count=3,
                uncertainty="low",
                context_lines=10_000,
            )
        )
        self.assertEqual(d["rule"], "R9")

    def test_r8_context_too_large_falls_to_r9(self):
        d = route.decide(
            base(
                writes_files=True,
                file_count=1,
                uncertainty="low",
                context_lines=2_000,
            )
        )
        self.assertEqual(d["rule"], "R9")


class TestCandidateChains(unittest.TestCase):
    def test_design_chain(self):
        # 模糊设计（默认）：Astra 先设计，不自动进入 Opus。
        chain = route.tier_candidate_chain("design")
        self.assertEqual(
            [c["route"] for c in chain],
            ["design-codex-astra", "controller-codex", "controller-codex", "controller-codex", "execute-dsv41-flash", "execute-dsv41-flash"],
        )
        self.assertEqual(chain[0]["executor"], route.EXEC_DESIGN_ASTRA)
        self.assertNotIn("subagent_claude_opus55_plan", [c["executor"] for c in chain])

    def test_high_design_chain(self):
        chain = route.tier_candidate_chain("design", design_mode="high")
        self.assertEqual(
            [c.get("provider") for c in chain],
            [route.ASTRA_PROVIDER, route.OPUS55_PROVIDER, route.CONTROLLER_PROVIDER, route.FALLBACK_PROVIDER, route.FALLBACK_PROVIDER],
        )
        self.assertEqual(
            [c["executor"] for c in chain],
            [route.EXEC_DESIGN_ASTRA, route.EXEC_OPUS55, "none", "none", "subagent_codex"],
        )

    def test_general_design_chain(self):
        chain = route.tier_candidate_chain("design", design_mode="general")
        self.assertEqual(
            [c.get("provider") for c in chain],
            [
                route.ASTRA_PROVIDER,
                route.CONTROLLER_PROVIDER,
                route.FALLBACK_PROVIDER,
                route.FALLBACK_PROVIDER,
                route.EXECUTE_PROVIDER,
                "opencode-go",
            ],
        )
        self.assertEqual(chain[0]["executor"], route.EXEC_DESIGN_ASTRA)
        self.assertNotIn(route.EXEC_OPUS55, [c["executor"] for c in chain])

    def test_explicit_general_design_decision(self):
        d = route.decide(base(design_mode="general", uncertainty="medium"))
        self.assertEqual(d["tier"], "design")
        self.assertEqual(d["provider"], route.ASTRA_PROVIDER)
        self.assertEqual(d["candidate_chain"][0]["executor"], route.EXEC_DESIGN_ASTRA)
        self.assertEqual(d["candidate_chain"][4]["provider"], route.EXECUTE_PROVIDER)

    def test_continuous_chain(self):
        chain = route.tier_candidate_chain("continuous")
        self.assertEqual(chain[0]["executor"], "subagent_cursor_grok")
        self.assertEqual(chain[1]["executor"], "subagent_opencode_dsv41")
        self.assertEqual(chain[1]["route"], "execute-dsv41-flash")
        self.assertEqual(chain[-1]["route"], "controller-codex")

    def test_docs_chain(self):
        chain = route.tier_candidate_chain("docs")
        self.assertEqual(
            [c["route"] for c in chain],
            ["docs-kimi", "controller-codex"],
        )

    def test_execute_chain_spawn_first(self):
        chain = route.tier_candidate_chain("execute", prefers_acp=False)
        self.assertEqual(
            [c["executor"] for c in chain],
            ["subagent", "subagent_opencode_dsv41", "none"],
        )
        self.assertEqual(chain[-1]["route"], "controller-codex")

    def test_execute_chain_acp_reverses(self):
        chain = route.tier_candidate_chain("execute", prefers_acp=True)
        self.assertEqual(
            [c["executor"] for c in chain],
            ["subagent_opencode_dsv41", "subagent", "none"],
        )

    def test_decide_embeds_fallback_and_chain(self):
        d = route.decide(base(writes_files=False, uncertainty="high"))
        self.assertEqual(d["candidate_chain"][0]["route"], "design-codex-astra")
        self.assertEqual(d["candidate_chain"][0]["provider"], route.ASTRA_PROVIDER)
        self.assertNotIn("design-opus55", d["fallback_routes"])
        self.assertEqual(d["candidate_chain"][1]["provider"], route.CONTROLLER_PROVIDER)
        self.assertEqual(d["candidate_chain"][2]["provider"], route.FALLBACK_PROVIDER)

    def test_controller_chain(self):
        chain = route.tier_candidate_chain("controller")
        self.assertEqual(
            [c["route"] for c in chain],
            ["controller-codex", "controller-codex", "controller-kimi", "local-controller"],
        )


class TestInvalidInput(unittest.TestCase):
    def test_missing_field(self):
        raw = base()
        del raw["file_count"]
        with self.assertRaises(route.RouteError):
            route.normalize_input(raw)

    def test_bad_uncertainty(self):
        with self.assertRaises(route.RouteError):
            route.normalize_input(base(uncertainty="extreme"))

    def test_bad_bool_type(self):
        with self.assertRaises(route.RouteError):
            route.normalize_input(base(writes_files="yes"))

    def test_negative_file_count(self):
        with self.assertRaises(route.RouteError):
            route.normalize_input(base(file_count=-1))

    def test_unknown_field(self):
        with self.assertRaises(route.RouteError):
            route.normalize_input(base(extra=1))

    def test_bool_rejected_as_int(self):
        with self.assertRaises(route.RouteError):
            route.normalize_input(base(file_count=True))


class TestOutputContract(unittest.TestCase):
    REQUIRED_KEYS = {
        "rule",
        "tier",
        "route",
        "executor",
        "model",
        "effort",
        "shape",
        "rationale",
        "fallback_routes",
        "required_envelope_fields",
        "required_validation",
    }

    def test_route_enum_uses_ledger_single_source(self):
        import ptc_task_control as ptc
        self.assertEqual(set(route.ROUTE_ENUM), ptc.ROUTES)

    def test_output_keys_and_frozen_route_enum(self):
        samples = [
            base(cross_directory=True),
            base(failure_cost="high"),
            base(writes_files=True, work_kind="docs", file_count=1),
            base(writes_files=False, uncertainty="high", adjudication=True),
            base(writes_files=False, uncertainty="high"),
            base(writes_files=True, file_count=6, uncertainty="high"),
            base(writes_files=True, file_count=2, uncertainty="low"),
            base(writes_files=True, file_count=1, uncertainty="low"),
            base(writes_files=True, file_count=3, uncertainty="high", context_lines=20_000),
        ]
        for raw in samples:
            d = route.decide(raw)
            self.assertTrue(self.REQUIRED_KEYS.issubset(d.keys()))
            self.assertIn(d["route"], route.ROUTE_ENUM)
            for item in d["fallback_routes"]:
                self.assertIn(item, route.ROUTE_ENUM)

    def test_design_envelope_includes_receipt(self):
        d = route.decide(base(writes_files=False, uncertainty="high"))
        self.assertIn("receipt", d["required_envelope_fields"])
        self.assertTrue(d["required_validation"])

    def test_controller_envelope_empty(self):
        d = route.decide(base(cross_directory=True))
        self.assertEqual(d["required_envelope_fields"], [])
        self.assertEqual(d["required_validation"], [])


class TestCLI(unittest.TestCase):
    def _run(self, *args: str) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"
        return subprocess.run(
            [sys.executable, "-B", str(SCRIPT), *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
        )

    def test_cli_input_json(self):
        payload = json.dumps(base(cross_directory=True), ensure_ascii=False)
        proc = self._run("--input-json", payload)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertEqual(data["rule"], "R1")
        self.assertEqual(data["route"], "controller-codex")

    def test_cli_input_file_and_flag_override(self):
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", suffix=".json", delete=False
        ) as handle:
            json.dump(base(writes_files=True, file_count=1, uncertainty="low"), handle)
            path = handle.name
        proc = self._run(
            "--input-file",
            path,
            "--prefers-acp",
            "true",
            "--background",
            "false",
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertEqual(data["rule"], "R8")
        self.assertEqual(data["executor"], "subagent_opencode_dsv41")
        self.assertEqual(data["shape"], "one-shot")

    def test_cli_field_flags_only(self):
        proc = self._run(
            "--writes-files",
            "true",
            "--file-count",
            "3",
            "--uncertainty",
            "low",
            "--adjudication",
            "false",
            "--validation-burden",
            "low",
            "--context-lines",
            "100",
            "--cross-directory",
            "false",
            "--failure-cost",
            "low",
            "--work-kind",
            "code",
            "--prefers-acp",
            "false",
            "--background",
            "false",
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertEqual(data["rule"], "R7")
        self.assertEqual(data["route"], "continuous-cursor-grok")
        self.assertEqual(data["executor"], "subagent_cursor_grok")
        self.assertEqual(data["model"], "auto")
        self.assertEqual(data["effort"], "provider")
        self.assertEqual(data["shape"], "one-shot")

    def test_cli_invalid_exits_nonzero(self):
        proc = self._run("--input-json", '{"writes_files": true}')
        self.assertEqual(proc.returncode, 2)
        self.assertTrue(proc.stderr.strip())


if __name__ == "__main__":
    unittest.main()
