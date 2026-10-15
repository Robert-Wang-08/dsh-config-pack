#!/usr/bin/env python3
"""把 ACP 客户端的会话、日志、快照与 DB 目录重定向到工作区内临时目录。

为什么需要它：opencode 默认写 ~/.local/share/opencode，kimi 默认写
~/.kimi-code/sessions。这两处都在工作区之外，在 workspace-write 类文件策略下
会被拒，表现为 ACP 在 initialize 或 session/new 阶段早夭——看起来像 provider
故障，实际是沙箱写拒绝。

本脚本只做两件事：
  1. 建好 (workspace)/.ptc/acp-tmp/{opencode,kimi-home}；
  2. 让重定向后的 kimi 家目录仍能认证：优先做 credentials 目录联接（junction，
     不复制凭据本体），不支持联接时退化为复制（凭据只有约 1.5 KB，且副本仍在
     被忽略的 .ptc/ 下，不进入版本库）。

不打印任何凭据内容。只用标准库。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

WIN = sys.platform == "win32"


def workspace_root() -> Path:
    override = os.environ.get("DSH_WORKSPACE")
    if override:
        return Path(override)
    here = Path.cwd()
    for candidate in (here, *here.parents):
        if (candidate / ".ptc").is_dir():
            return candidate
    return here


def tmp_root() -> Path:
    return Path(os.environ.get("PTC_ACP_TMP") or (workspace_root() / ".ptc" / "acp-tmp"))


def link_or_copy(src: Path, dst: Path) -> str:
    """优先目录联接；失败则复制。返回实际采用的方式。"""
    if dst.exists():
        return "exists"
    if WIN:
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(dst), str(src)],
            capture_output=True, text=True,
        )
        if result.returncode == 0:
            return "junction"
    try:
        shutil.copytree(src, dst)
        return "copy"
    except OSError as exc:
        return f"failed: {exc}"


def provision(real_kimi_home: Path) -> dict:
    root = tmp_root()
    report: dict = {"tmp_root": str(root), "actions": []}
    (root / "opencode").mkdir(parents=True, exist_ok=True)
    report["actions"].append({"path": str(root / "opencode"), "action": "mkdir"})

    kimi_dst = root / "kimi-home"
    kimi_dst.mkdir(parents=True, exist_ok=True)
    report["actions"].append({"path": str(kimi_dst), "action": "mkdir"})

    cred_src = real_kimi_home / "credentials"
    if cred_src.is_dir():
        how = link_or_copy(cred_src, kimi_dst / "credentials")
        report["actions"].append({"path": "credentials", "action": how})
    else:
        report["actions"].append({"path": str(cred_src), "action": "missing"})

    cfg_src = real_kimi_home / "config.toml"
    cfg_dst = kimi_dst / "config.toml"
    if cfg_src.is_file() and not cfg_dst.exists():
        shutil.copy2(cfg_src, cfg_dst)
        report["actions"].append({"path": "config.toml", "action": "copy"})

    report["env"] = {
        "XDG_DATA_HOME": str(root / "opencode"),
        "KIMI_CODE_HOME": str(kimi_dst),
    }
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="预置 ACP 工作区临时目录")
    parser.add_argument("--real-kimi-home", default=str(Path.home() / ".kimi-code"))
    parser.add_argument("--json", action="store_true")
    opts = parser.parse_args()
    report = provision(Path(opts.real_kimi_home))
    if opts.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"tmp root: {report['tmp_root']}")
        for action in report["actions"]:
            print(f"  {action['path']}: {action['action']}")
        print("export:")
        for key, value in report["env"].items():
            print(f"  {key}={value}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
