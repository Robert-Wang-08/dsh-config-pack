#!/usr/bin/env python3
"""预置两个 Opus 复核执行档各自的 Claude Code 配置目录。

背景：Claude Code 的 settings.json 里 env 的优先级高于进程环境（2026-10-15 实测：
即使给子进程塞无效 token 仍能成功），所以只靠环境变量无法让两个执行档走不同后端。
CLAUDE_CONFIG_DIR 才是有效隔离点。本脚本据此为每个 Opus 档预置一个独立配置目录。

用法：
    python claude_config_profiles.py            # 预置（已存在则不覆盖，除非 --force）
    python claude_config_profiles.py --check    # 只报告状态，不写

凭据来源：DSH 凭据库（DSH_CREDENTIALS 或 ~/.dsh/.credentials.yaml）。
本脚本从不打印任何凭据值，只打印目录路径与档位映射。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

PROFILES = {
    "relay": {
        "source": "anthropic-relay",
        "base_url": "https://ai.orbitlink.me",
        "key_name": "CLAUDE_RELAY_TOKEN",
        "opus_model": "claude-opus-5",
        "haiku_model": "claude-haiku-4-5-20251001",
    },
    "tokeniss": {
        "source": "tokeniss",
        "base_url": "https://tokeness.io",
        "key_name": "TOKENISS_API_KEY",
        "opus_model": "claude-opus-5-5",
        "haiku_model": "claude-haiku-4-5",
    },
}


def profiles_root() -> Path:
    override = os.environ.get("PTC_CLAUDE_PROFILES_ROOT")
    if override:
        return Path(override)
    home = os.environ.get("USERPROFILE") or os.environ.get("HOME") or str(Path.home())
    return Path(home) / ".claude-profiles"


def credentials_path() -> Path:
    override = os.environ.get("DSH_CREDENTIALS")
    if override:
        return Path(override)
    home = os.environ.get("USERPROFILE") or os.environ.get("HOME") or str(Path.home())
    return Path(home) / ".dsh" / ".credentials.yaml"


def read_key(name: str) -> str | None:
    path = credentials_path()
    if not path.is_file():
        return None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if stripped.startswith(name + ":"):
            value = stripped.split(":", 1)[1].strip().strip('"').strip("'")
            return value or None
    return None


def global_settings() -> dict:
    home = os.environ.get("USERPROFILE") or os.environ.get("HOME") or str(Path.home())
    path = Path(home) / ".claude" / "settings.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def build(spec: dict, key: str, template: dict) -> dict:
    data = json.loads(json.dumps(template)) if template else {}
    env = dict(data.get("env") or {})
    env["ANTHROPIC_BASE_URL"] = spec["base_url"]
    env["ANTHROPIC_AUTH_TOKEN"] = key
    env["ANTHROPIC_DEFAULT_OPUS_MODEL"] = spec["opus_model"]
    env["ANTHROPIC_DEFAULT_OPUS_MODEL_NAME"] = spec["opus_model"]
    env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = spec["haiku_model"]
    env["ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME"] = spec["haiku_model"]
    data["env"] = env
    data.setdefault("model", "opus")
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description="预置 Opus 执行档的 Claude Code 配置目录")
    parser.add_argument("--check", action="store_true", help="只报告状态，不写文件")
    parser.add_argument("--force", action="store_true", help="覆盖已存在的配置目录")
    args = parser.parse_args()

    template = global_settings()
    if not template:
        print("warn: 未找到全局 ~/.claude/settings.json，将以最小模板预置", file=sys.stderr)

    root = profiles_root()
    created = 0
    missing_keys = []
    for name, spec in PROFILES.items():
        target_dir = root / name
        target = target_dir / "settings.json"
        key = read_key(spec["key_name"])
        if not key:
            missing_keys.append(spec["key_name"])
        if target.is_file() and not args.force:
            print(f"keep   {name:9s} {target}  ({spec['source']} / {spec['opus_model']})")
            continue
        if args.check:
            print(f"todo   {name:9s} {target}  ({spec['source']} / {spec['opus_model']})")
            continue
        if not key:
            print(f"skip   {name:9s} 凭据 {spec['key_name']} 缺失，未写入", file=sys.stderr)
            continue
        target_dir.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(build(spec, key, template), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        created += 1
        print(f"write  {name:9s} {target}  ({spec['source']} / {spec['opus_model']})")

    print(f"profiles_root={root}")
    print(f"created={created}")
    if missing_keys:
        print("missing_credentials=" + ",".join(sorted(set(missing_keys))), file=sys.stderr)
    print("note: 目录内含凭据，属设备本地状态，不得入库或提交。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
