from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).with_name("claude_config_profiles.py")
SPEC = importlib.util.spec_from_file_location("claude_config_profiles_under_test", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ClaudeCredentialLookupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.credentials = Path(self.temp.name) / ".credentials.yaml"
        self.path_patch = mock.patch.object(MODULE, "credentials_path", return_value=self.credentials)
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)

    def test_credentials_file_has_highest_priority(self) -> None:
        self.credentials.write_text('CLAUDETOKENISS25_API_KEY: "file-value"\n', encoding="utf-8")
        with mock.patch.dict(os.environ, {"CLAUDETOKENISS25_API_KEY": "process-value"}, clear=False), mock.patch.object(
            MODULE,
            "read_windows_environment",
            create=True,
            return_value="registry-value",
        ):
            self.assertEqual(MODULE.read_key("CLAUDETOKENISS25_API_KEY"), "file-value")

    def test_process_environment_is_used_when_file_has_no_key(self) -> None:
        self.credentials.write_text("OTHER_KEY: value\n", encoding="utf-8")
        with mock.patch.dict(os.environ, {"CLAUDETOKENISS25_API_KEY": "process-value"}, clear=False), mock.patch.object(
            MODULE,
            "read_windows_environment",
            create=True,
            return_value="registry-value",
        ):
            self.assertEqual(MODULE.read_key("CLAUDETOKENISS25_API_KEY"), "process-value")

    def test_user_environment_precedes_machine_environment(self) -> None:
        self.credentials.write_text("", encoding="utf-8")
        calls: list[str] = []

        def registry_value(_name: str, scope: str) -> str | None:
            calls.append(scope)
            return {"User": "user-value", "Machine": "machine-value"}.get(scope)

        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(
            MODULE,
            "read_windows_environment",
            create=True,
            side_effect=registry_value,
        ):
            self.assertEqual(MODULE.read_key("CLAUDETOKENISS25_API_KEY"), "user-value")
        self.assertEqual(calls, ["User"])

    def test_machine_environment_is_final_fallback(self) -> None:
        self.credentials.write_text("", encoding="utf-8")

        def registry_value(_name: str, scope: str) -> str | None:
            return {"User": None, "Machine": "machine-value"}.get(scope)

        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(
            MODULE,
            "read_windows_environment",
            create=True,
            side_effect=registry_value,
        ):
            self.assertEqual(MODULE.read_key("CLAUDETOKENISS25_API_KEY"), "machine-value")

    def test_missing_key_returns_none(self) -> None:
        self.credentials.write_text("", encoding="utf-8")
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(
            MODULE,
            "read_windows_environment",
            create=True,
            return_value=None,
        ):
            self.assertIsNone(MODULE.read_key("CLAUDETOKENISS25_API_KEY"))

    def test_expand_string_registry_values_are_expanded(self) -> None:
        class Key:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        fake_winreg = types.SimpleNamespace(
            HKEY_CURRENT_USER=object(),
            HKEY_LOCAL_MACHINE=object(),
            REG_EXPAND_SZ=2,
            OpenKey=lambda *_args: Key(),
            QueryValueEx=lambda *_args: ("%FAKE_ROOT%\\token", 2),
        )
        reader = getattr(MODULE, "read_windows_environment", lambda *_args: None)
        with mock.patch.dict(sys.modules, {"winreg": fake_winreg}), mock.patch.object(
            MODULE.os.path,
            "expandvars",
            return_value=r"C:\expanded\token",
        ):
            self.assertEqual(reader("CLAUDETOKENISS25_API_KEY", "Machine"), r"C:\expanded\token")


if __name__ == "__main__":
    unittest.main()
