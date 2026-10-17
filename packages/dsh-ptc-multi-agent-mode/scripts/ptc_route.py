#!/usr/bin/env python3
"""PTC 工作分层路由 v1.1 — 自动判定 + CLI。

依据 `.ptc/routing/routing-v1.1-final.md`：route 枚举冻结，靠 tier 投影与
executor/model 记录真相；自上而下命中 R1–R9；U2 为各 tier 提供有序候选链。
仅使用标准库，Windows 可运行。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Mapping, MutableMapping, Sequence

from ptc_task_control import ROUTES

# 与账本/receipt 的冻结枚举共享单一事实源，禁止复制后静默漂移。
ROUTE_ENUM = tuple(sorted(ROUTES))

UNCERTAINTY_VALUES = ("low", "medium", "high")
FAILURE_COST_VALUES = ("low", "medium", "high")
VALIDATION_BURDEN_VALUES = ("low", "high")
WORK_KIND_VALUES = ("code", "docs", "other")
DESIGN_MODE_VALUES = ("fuzzy", "high", "general", "top_down")

INPUT_FIELDS = (
    "writes_files",
    "file_count",
    "uncertainty",
    "adjudication",
    "validation_burden",
    "context_lines",
    "cross_directory",
    "failure_cost",
    "work_kind",
    "prefers_acp",
    "background",
    "design_mode",
)

ENVELOPE_FIELDS = (
    "task_id",
    "subtask_id",
    "contract",
    "授权路径",
    "禁止项",
    "预期格式",
    "验证证据",
    "提权规则",
    "工作区",
    "receipt",
)

def _load_runtime_config() -> dict[str, Any]:
    path = Path(__file__).resolve().parent.parent / "assets" / "public-runtime-config.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"无法读取公开运行时配置 {path}: {exc}") from exc
    if data.get("schema_version") != "ptc-public-runtime/v1":
        raise RuntimeError("公开运行时配置 schema_version 不受支持")
    return data


_RUNTIME = _load_runtime_config()
CONTROLLER_PROVIDER = _RUNTIME["controller"]["provider"]
CONTROLLER_MODEL = _RUNTIME["controller"]["model"]
CONTROLLER_EFFORT = _RUNTIME["controller"]["effort"]
FALLBACK_PROVIDER = _RUNTIME["controller"]["fallbackProvider"]
FALLBACK_MODEL = _RUNTIME["controller"]["fallbackModel"]
EXECUTE_PROVIDER = _RUNTIME["execute"]["provider"]
EXECUTE_MODEL = _RUNTIME["execute"]["model"]
# 连续修改档（R7）：2026-10-16 用户指定改用 ais-2dsglm 的 GLM，不再走 Cursor/Grok ACP。
# 该 provider 上唯一的 GLM 档是 glm-5.3-flash；值仍从公开运行时配置读取，不写死在代码里。
CONTINUOUS_PROVIDER = _RUNTIME["continuous"]["provider"]
CONTINUOUS_MODEL = _RUNTIME["continuous"]["model"]
DOCS_PROVIDER = _RUNTIME["docs"]["provider"]
DOCS_MODEL = _RUNTIME["docs"]["model"]
ASTRA_PROVIDER = _RUNTIME["design"]["astraProvider"]
ASTRA_MODEL = _RUNTIME["design"]["astraModel"]
DESIGN_EFFORT = _RUNTIME["design"]["effort"]
EXEC_DESIGN_ASTRA = _RUNTIME["design"]["astraExecutor"]
OPUS55_PROVIDER = _RUNTIME["design"]["opusProvider"]
OPUS55_MODEL = _RUNTIME["design"]["opusModel"]
EXEC_OPUS55 = _RUNTIME["design"]["opusExecutor"]
# 每个 Opus 档位各自绑定一个只读复核执行档（5.5 与 5 走不同后端与独立配置目录）。
EXEC_OPUS_EXECUTORS = tuple(
    entry["tool"] for entry in (_RUNTIME["design"].get("opusExecutors") or {}).values()
) or (EXEC_OPUS55,)
# Opus 独立复核的降级梯：按 opusLadder 首条命中（5.5 -> 5 -> 4.8）；三档都不可用时
# 如实报告 Opus 不可用，不自动改用 Sonnet。缺少 opusLadder 时退回单档配置。
OPUS_LADDER = tuple(
    {
        "provider": entry["provider"],
        "model": entry["model"],
        "executor": entry.get("executor", EXEC_OPUS55),
    }
    for entry in (_RUNTIME["design"].get("opusLadder") or ())
) or ({"provider": OPUS55_PROVIDER, "model": OPUS55_MODEL, "executor": EXEC_OPUS55},)

EXEC_SPAWN = "subagent"
EXEC_OPENCODE = "subagent_opencode_dsv41"
EXEC_KIMI = "subagent_kimi_docs"
EXEC_CODEX_RELAY = "subagent_codex_relay"
EXEC_CODEX_OFFICIAL = "subagent_codex"
EXEC_DIRECTOR = "subagent_role"
EXEC_NONE = "none"

# route 枚举标签是冻结的历史标识，不代表实际执行者：continuous 档已改用
# ais-2dsglm/glm-5.3-flash，但标签仍沿用 continuous-cursor-grok，以免改动
# receipt schema 与账本可重放性。真实模型一律以 receipt.executor/model 为准。
DIRECTOR_TIER_ROUTES = {
    "design": "design-codex-astra",
    "execute": "execute-dsv41-flash",
    "continuous": "continuous-cursor-grok",
    "docs": "docs-kimi",
}


def route_config_path() -> Path:
    """本机人工确认路由层：PTC_ROUTE_CONFIG > DSH_HOME > ~/.dsh。"""
    override = os.environ.get("PTC_ROUTE_CONFIG")
    if override:
        return Path(override).expanduser()
    base = os.environ.get("DSH_HOME") or str(Path.home() / ".dsh")
    return Path(base).expanduser() / "plugins" / "provider-failover" / "route-config.json"


def load_subagent_switches(path: Path | None = None) -> dict[str, dict[str, Any]]:
    """读取 subagentRouting.switches 人工开关；文件/段缺失或非法时返回空表（全开）。

    每次 decide 调用时重新读取：开关 toggling 对新派发即时生效，无需重启。
    只认 dict 形态的开关定义；其余静默忽略，不阻断路由。
    """
    path = path or route_config_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    subagent = data.get("subagentRouting")
    if not isinstance(subagent, Mapping):
        return {}
    switches = subagent.get("switches")
    if not isinstance(switches, Mapping):
        return {}
    return {key: value for key, value in switches.items() if isinstance(value, Mapping)}


def apply_switches(
    chain: Sequence[Mapping[str, str]],
    *,
    switches: Mapping[str, Mapping[str, Any]],
) -> tuple[list[dict[str, str]], list[str]]:
    """按人工开关过滤候选链，返回 (保留链, 实际生效的关闭开关 key 列表)。

    规则：候选的 route ∈ 关闭开关 routes 或 executor ∈ 关闭开关 executors 即剔除；
    EXEC_NONE 主控席位（含 in-session provider 后备位）不是子代理，永不被开关剔除。
    过滤后为空时补一个主控兜底位，保证链非空。
    """
    disabled_routes: set[str] = set()
    disabled_executors: set[str] = set()
    for switch in switches.values():
        if switch.get("enabled", True):
            continue
        disabled_routes.update(r for r in switch.get("routes", ()) if isinstance(r, str))
        disabled_executors.update(e for e in switch.get("executors", ()) if isinstance(e, str))
    if not disabled_routes and not disabled_executors:
        return [dict(c) for c in chain], []
    kept: list[dict[str, str]] = []
    removed: list[Mapping[str, str]] = []
    for candidate in chain:
        if candidate["executor"] == EXEC_NONE:
            kept.append(dict(candidate))
        elif candidate["route"] in disabled_routes or candidate["executor"] in disabled_executors:
            removed.append(candidate)
        else:
            kept.append(dict(candidate))
    if not kept:
        kept.append(
            _candidate(
                "controller-codex",
                EXEC_NONE,
                CONTROLLER_MODEL,
                provider=CONTROLLER_PROVIDER,
                effort=CONTROLLER_EFFORT,
                shape="session",
            )
        )
    active_keys = sorted(
        key
        for key, switch in switches.items()
        if not switch.get("enabled", True)
        and any(
            c["route"] in switch.get("routes", ()) or c["executor"] in switch.get("executors", ())
            for c in removed
        )
    )
    return kept, active_keys


def load_director_role_policies(
    path: Path | None = None,
) -> tuple[dict[str, dict[str, Any]], int]:
    """读取 PTC 对 Director 角色的参与策略；角色本体由 Director settings 管理。"""
    path = path or route_config_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}, 0
    subagent = data.get("subagentRouting")
    if not isinstance(subagent, Mapping):
        return {}, 0
    raw_revision = subagent.get("revision", 0)
    revision = raw_revision if isinstance(raw_revision, int) and not isinstance(raw_revision, bool) and raw_revision >= 0 else 0
    policies = subagent.get("directorRoles")
    if not isinstance(policies, Mapping):
        return {}, revision
    return (
        {key: dict(value) for key, value in policies.items() if isinstance(key, str) and isinstance(value, Mapping)},
        revision,
    )


def apply_director_roles(
    chain: Sequence[Mapping[str, str]],
    *,
    tier: str,
    policies: Mapping[str, Mapping[str, Any]],
) -> tuple[list[dict[str, str]], list[str], list[str]]:
    """把已启用且命中 tier 的 Director 角色稳定插入候选链。

    position=preferred 的角色位于原生候选之前；fallback 位于首个主控席位之前。
    同组按 priority 升序、role id 字典序排序。未知 tier/非法策略静默跳过。
    """
    applicable: list[tuple[int, str, str]] = []
    disabled: list[str] = []
    for role_id, policy in policies.items():
        enabled = policy.get("enabled")
        tiers = policy.get("tiers")
        raw_priority = policy.get("priority", 100)
        raw_position = policy.get("position", "fallback")
        if not isinstance(enabled, bool):
            continue
        if (
            not isinstance(tiers, Sequence)
            or isinstance(tiers, (str, bytes))
            or any(not isinstance(item, str) or item not in DIRECTOR_TIER_ROUTES for item in tiers)
        ):
            continue
        if not isinstance(raw_priority, int) or isinstance(raw_priority, bool) or not 0 <= raw_priority <= 1000:
            continue
        if raw_position not in {"preferred", "fallback"}:
            continue
        if tier not in tiers:
            continue
        if not enabled:
            disabled.append(role_id)
            continue
        applicable.append((raw_priority, role_id, raw_position))

    applicable.sort(key=lambda item: (item[2] != "preferred", item[0], item[1]))
    preferred: list[dict[str, str]] = []
    fallback: list[dict[str, str]] = []
    for _priority, role_id, position in applicable:
        candidate = _candidate(
            DIRECTOR_TIER_ROUTES[tier],
            EXEC_DIRECTOR,
            "role-bound",
            effort="role-bound",
            shape="one-shot",
            role=role_id,
        )
        (preferred if position == "preferred" else fallback).append(candidate)

    base = [dict(candidate) for candidate in chain]
    fallback_at = next((index for index, candidate in enumerate(base) if candidate["executor"] == EXEC_NONE), len(base))
    merged = [*preferred, *base[:fallback_at], *fallback, *base[fallback_at:]]
    return merged, [role_id for _priority, role_id, _position in applicable], sorted(disabled)


class RouteError(ValueError):
    """输入不合法或无法判定。"""


def _require_bool(data: Mapping[str, Any], key: str) -> bool:
    if key not in data:
        raise RouteError(f"缺少必填字段: {key}")
    value = data[key]
    if not isinstance(value, bool):
        raise RouteError(f"{key} 必须是 bool，收到 {type(value).__name__}")
    return value


def _require_int(data: Mapping[str, Any], key: str, *, min_value: int | None = None) -> int:
    if key not in data:
        raise RouteError(f"缺少必填字段: {key}")
    value = data[key]
    if isinstance(value, bool) or not isinstance(value, int):
        raise RouteError(f"{key} 必须是 int，收到 {type(value).__name__}")
    if min_value is not None and value < min_value:
        raise RouteError(f"{key} 必须 >= {min_value}，收到 {value}")
    return value


def _require_enum(data: Mapping[str, Any], key: str, allowed: Sequence[str]) -> str:
    if key not in data:
        raise RouteError(f"缺少必填字段: {key}")
    value = data[key]
    if not isinstance(value, str):
        raise RouteError(f"{key} 必须是 str，收到 {type(value).__name__}")
    if value not in allowed:
        raise RouteError(f"{key} 必须是 {list(allowed)} 之一，收到 {value!r}")
    return value


def normalize_input(raw: Mapping[str, Any]) -> dict[str, Any]:
    """校验并规范化路由输入。"""
    if not isinstance(raw, Mapping):
        raise RouteError("输入必须是 JSON object")
    unknown = sorted(set(raw) - set(INPUT_FIELDS))
    if unknown:
        raise RouteError(f"未知字段: {', '.join(unknown)}")
    return {
        "writes_files": _require_bool(raw, "writes_files"),
        "file_count": _require_int(raw, "file_count", min_value=0),
        "uncertainty": _require_enum(raw, "uncertainty", UNCERTAINTY_VALUES),
        "adjudication": _require_bool(raw, "adjudication"),
        "validation_burden": _require_enum(raw, "validation_burden", VALIDATION_BURDEN_VALUES),
        "context_lines": _require_int(raw, "context_lines", min_value=0),
        "cross_directory": _require_bool(raw, "cross_directory"),
        "failure_cost": _require_enum(raw, "failure_cost", FAILURE_COST_VALUES),
        "work_kind": _require_enum(raw, "work_kind", WORK_KIND_VALUES),
        "prefers_acp": _require_bool(raw, "prefers_acp"),
        "background": _require_bool(raw, "background"),
        "design_mode": (
            _require_enum(raw, "design_mode", DESIGN_MODE_VALUES)
            if "design_mode" in raw else None
        ),
    }


def _candidate(
    route: str,
    executor: str,
    model: str,
    *,
    provider: str | None = None,
    effort: str = "provider",
    shape: str = "one-shot",
    role: str | None = None,
) -> dict[str, str]:
    result = {
        "route": route,
        "executor": executor,
        "model": model,
        "effort": effort,
        "shape": shape,
    }
    if provider is not None:
        result["provider"] = provider
    if role is not None:
        result["role"] = role
    return result


def execute_shape(*, prefers_acp: bool, background: bool) -> str:
    """execute tier 形态：仅后台 spawn 可续接。"""
    if prefers_acp:
        return "one-shot"
    if background:
        return "continuable"
    return "foreground-one-shot"


def execute_executor(*, prefers_acp: bool) -> str:
    return EXEC_OPENCODE if prefers_acp else EXEC_SPAWN


def tier_candidate_chain(
    tier: str,
    *,
    prefers_acp: bool = False,
    background: bool = False,
    effort: str = CONTROLLER_EFFORT,
    design_mode: str = "fuzzy",
) -> list[dict[str, str]]:
    """U2：各 tier 有序候选链；不可用时最终回 controller-codex。"""
    controller_tail = [
        _candidate(
            "controller-codex",
            EXEC_NONE,
            CONTROLLER_MODEL,
            provider=CONTROLLER_PROVIDER,
            effort=effort,
            shape="session",
        )
    ]
    if tier == "controller":
        return [
            _candidate(
                "controller-codex",
                EXEC_NONE,
                CONTROLLER_MODEL,
                provider=CONTROLLER_PROVIDER,
                effort=effort,
                shape="session",
            ),
            _candidate(
                "controller-codex",
                EXEC_NONE,
                FALLBACK_MODEL,
                provider=FALLBACK_PROVIDER,
                effort=effort,
                shape="session",
            ),
            _candidate(
                "controller-kimi",
                EXEC_NONE,
                DOCS_MODEL,
                provider=DOCS_PROVIDER,
                effort="high",
                shape="session",
            ),
            _candidate(
                "local-controller",
                EXEC_NONE,
                "local",
                provider="local",
                effort="medium",
                shape="session",
            ),
        ]
    if tier == "design":
        # 设计优先使用 Codex Relay 的 gpt-5.6-sol xhigh。主控席位和官方 Codex
        # 只作为 provider 失败后的后备；不再因“模糊”自动启动 Opus。
        astra = [
            _candidate(
                "design-codex-astra", EXEC_DESIGN_ASTRA, ASTRA_MODEL,
                provider=ASTRA_PROVIDER, effort=DESIGN_EFFORT, shape="one-shot",
            )
        ]
        gpt = [
            _candidate(
                "controller-codex", EXEC_NONE, CONTROLLER_MODEL,
                provider=CONTROLLER_PROVIDER, effort=CONTROLLER_EFFORT, shape="session",
            ),
            _candidate(
                "controller-codex", EXEC_NONE, FALLBACK_MODEL,
                provider=FALLBACK_PROVIDER, effort=CONTROLLER_EFFORT, shape="session",
            ),
            _candidate(
                "controller-codex", EXEC_CODEX_OFFICIAL, FALLBACK_MODEL,
                provider=FALLBACK_PROVIDER, effort="provider", shape="one-shot",
            ),
        ]
        opus = [
            _candidate("design-opus55", entry["executor"], entry["model"], provider=entry["provider"])
            for entry in OPUS_LADDER
        ]
        ds = [
            _candidate(
                "execute-dsv41-flash", EXEC_SPAWN, EXECUTE_MODEL,
                provider=EXECUTE_PROVIDER, shape="foreground-one-shot",
            ),
            _candidate(
                "execute-dsv41-flash", EXEC_OPENCODE, EXECUTE_MODEL,
                provider="opencode-go", shape="one-shot",
            ),
        ]
        if design_mode in ("high", "top_down"):
            # Opus 5.5 仅作为高难度/全新领域自顶向下设计的独立复核候选。
            return [*astra, *opus, *gpt]
        if design_mode in ("fuzzy", "general"):
            return [*astra, *gpt, *ds]
        raise RouteError(f"未知 design_mode: {design_mode}")
    if tier == "continuous":
        return [
            _candidate(
                "continuous-cursor-grok",
                EXEC_SPAWN,
                CONTINUOUS_MODEL,
                provider=CONTINUOUS_PROVIDER,
                shape="one-shot",
            ),
            _candidate(
                "execute-dsv41-flash",
                EXEC_OPENCODE,
                EXECUTE_MODEL,
                provider="opencode-go",
                shape="one-shot",
            ),
            *controller_tail,
        ]
    if tier == "docs":
        return [
            _candidate("docs-kimi", EXEC_KIMI, DOCS_MODEL, provider=DOCS_PROVIDER),
            *controller_tail,
        ]
    if tier == "execute":
        spawn = _candidate(
            "execute-dsv41-flash",
            EXEC_SPAWN,
            EXECUTE_MODEL,
            provider=EXECUTE_PROVIDER,
            shape=execute_shape(prefers_acp=False, background=background),
        )
        opencode = _candidate(
            "execute-dsv41-flash",
            EXEC_OPENCODE,
            EXECUTE_MODEL,
            provider="opencode-go",
            shape="one-shot",
        )
        ordered = [opencode, spawn] if prefers_acp else [spawn, opencode]
        return [*ordered, *controller_tail]
    raise RouteError(f"未知 tier: {tier}")


def _fallback_routes(chain: Sequence[Mapping[str, str]]) -> list[str]:
    """主选之后的有序 route 列表（去重保序）。"""
    seen: set[str] = set()
    out: list[str] = []
    for item in chain[1:]:
        route = item["route"]
        if route in seen:
            continue
        seen.add(route)
        out.append(route)
    return out


def _tier_envelope(tier: str) -> tuple[list[str], list[str]]:
    if tier == "controller":
        return [], []
    fields = list(ENVELOPE_FIELDS)
    if tier == "design":
        validation = [
            "回复正文行数",
            "前 5 行摘要",
            "声明未写任何文件（files_changed=[]）",
        ]
    elif tier == "execute":
        validation = [
            "命令+退出码",
            "Test-Path 存在性",
        ]
    elif tier == "continuous":
        validation = [
            "git diff --stat",
            "改动文件清单",
        ]
    elif tier == "docs":
        validation = [
            "文档路径",
            "字数",
            "章节标题",
        ]
    else:
        raise RouteError(f"未知 tier: {tier}")
    return fields, validation


def _decision(
    *,
    rule: str,
    tier: str,
    rationale: str,
    prefers_acp: bool,
    background: bool,
    effort: str | None = None,
    design_mode: str = "fuzzy",
) -> dict[str, Any]:
    if effort is None:
        effort = CONTROLLER_EFFORT if tier == "controller" else "provider"
    chain = tier_candidate_chain(
        tier,
        prefers_acp=prefers_acp,
        background=background,
        effort=effort if tier == "controller" else "high",
        design_mode=design_mode,
    )
    director_policies, route_revision = load_director_role_policies()
    active_director_roles: list[str] = []
    disabled_director_roles: list[str] = []
    if tier in DIRECTOR_TIER_ROUTES:
        chain, active_director_roles, disabled_director_roles = apply_director_roles(
            chain,
            tier=tier,
            policies=director_policies,
        )
    # 人工开关（subagentRouting.switches）在每次判定时重新读取并过滤子代理候选；
    # 主控席位（EXEC_NONE）不受影响。实际剔除过时，rationale 标注并在输出中记录。
    chain, active_switches = apply_switches(chain, switches=load_subagent_switches())
    configured_director_roles = active_director_roles
    active_director_roles = [
        candidate["role"]
        for candidate in chain
        if candidate.get("executor") == EXEC_DIRECTOR and "role" in candidate
    ]
    active_role_set = set(active_director_roles)
    filtered_director_roles = [role_id for role_id in configured_director_roles if role_id not in active_role_set]
    if active_switches:
        rationale += "；人工开关已关闭: " + ",".join(active_switches)
        if "opus-review" in active_switches and tier == "design":
            rationale += "（Opus 独立复核被人工关闭，主控须登记 decision 事件）"
    primary = dict(chain[0])
    if tier == "controller":
        primary["effort"] = effort
    envelope, validation = _tier_envelope(tier)
    return {
        "rule": rule,
        "tier": tier,
        "route": primary["route"],
        "executor": primary["executor"],
        "model": primary["model"],
        **({"provider": primary["provider"]} if "provider" in primary else {}),
        **({"role": primary["role"]} if "role" in primary else {}),
        "effort": primary["effort"],
        "shape": primary["shape"],
        "rationale": rationale,
        "disabled_switches": active_switches,
        "director_roles": active_director_roles,
        "disabled_director_roles": disabled_director_roles,
        "filtered_director_roles": filtered_director_roles,
        "route_config_revision": route_revision,
        "fallback_routes": _fallback_routes(chain),
        "required_envelope_fields": envelope,
        "required_validation": validation,
        "candidate_chain": [
            {
                "route": c["route"],
                "executor": c["executor"],
                "model": c["model"],
                "effort": c["effort"],
                **({"provider": c["provider"]} if "provider" in c else {}),
                **({"role": c["role"]} if "role" in c else {}),
            }
            for c in chain
        ],
    }


def decide(raw: Mapping[str, Any]) -> dict[str, Any]:
    """自上而下匹配 R1–R9，返回单个路由判定 JSON 对象。"""
    inp = normalize_input(raw)
    writes = inp["writes_files"]
    n_files = inp["file_count"]
    uncertainty = inp["uncertainty"]
    adjudication = inp["adjudication"]
    context_lines = inp["context_lines"]
    cross_directory = inp["cross_directory"]
    failure_cost = inp["failure_cost"]
    work_kind = inp["work_kind"]
    prefers_acp = inp["prefers_acp"]
    background = inp["background"]
    design_mode = inp["design_mode"]
    # validation_burden 为可观测输入契约字段，当前判定表未引用。

    # R1 跨目录拦截
    if cross_directory:
        return _decision(
            rule="R1",
            tier="controller",
            rationale="跨目录写入超出子代理工作区根，须由主控处理沙箱与授权",
            prefers_acp=prefers_acp,
            background=background,
            effort=CONTROLLER_EFFORT,
        )

    # R2 高代价拦截
    if failure_cost == "high":
        return _decision(
            rule="R2",
            tier="controller",
            rationale="失败代价高，需主控人工复核前置",
            prefers_acp=prefers_acp,
            background=background,
            effort=CONTROLLER_EFFORT,
        )

    # R3 文档（种类判据，排在规模规则之前）
    if writes and work_kind == "docs":
        return _decision(
            rule="R3",
            tier="docs",
            rationale="写入类文档/说明/总结任务，路由 docs-kimi",
            prefers_acp=prefers_acp,
            background=background,
        )

    # R4 高难度设计：GPT-5.6 Sol xhigh 设计，Opus 5.5 独立复核。
    if (not writes) and (
        design_mode in ("high", "top_down")
        or (design_mode is None and uncertainty == "high" and adjudication)
    ):
        return _decision(
            rule="R4",
            tier="design",
            rationale="GPT-5.6 Sol xhigh 设计；仅高难度或全新领域自顶向下设计进入 Opus 5.5 独立复核",
            prefers_acp=prefers_acp,
            background=background,
            design_mode=design_mode if design_mode in ("high", "top_down") else "high",
        )

    # R5 模糊设计：GPT-5.6 Sol xhigh 先设计，不自动调用 Opus。
    if (not writes) and (
        design_mode == "fuzzy" or (design_mode is None and uncertainty == "high" and not adjudication)
    ):
        return _decision(
            rule="R5",
            tier="design",
            rationale="模糊设计由 Codex Relay 的 gpt-5.6-sol xhigh 处理，不自动调用 Opus",
            prefers_acp=prefers_acp,
            background=background,
            design_mode="fuzzy",
        )

    # R5 一般设计：GPT 组设计，DS 组复核。
    if (not writes) and design_mode == "general":
        return _decision(
            rule="R5",
            tier="design",
            rationale="一般设计由 GPT 组设计，再由 DS 组复核",
            prefers_acp=prefers_acp,
            background=background,
            design_mode="general",
        )

    # R6 多面写入：≥6 文件无论确定性都由主控拆分和收口。
    if writes and n_files >= 6:
        return _decision(
            rule="R6",
            tier="controller",
            rationale="写入面 ≥6 且不确定性中/高，复杂度由主控收口",
            prefers_acp=prefers_acp,
            background=background,
            effort=CONTROLLER_EFFORT,
        )

    # R7 连续多步
    if (
        writes
        and 2 <= n_files <= 5
        and uncertainty in ("low", "medium")
        and not adjudication
        and context_lines < 10_000
        and failure_cost in ("low", "medium")
    ):
        return _decision(
            rule="R7",
            tier="continuous",
            rationale=f"同一代码面 2–5 文件连续修改，首选 {CONTINUOUS_PROVIDER}/{CONTINUOUS_MODEL}（route 标签 continuous-cursor-grok 为冻结历史标识）",
            prefers_acp=prefers_acp,
            background=background,
        )

    # R8 单点快速
    if (
        writes
        and n_files == 1
        and uncertainty in ("low", "medium")
        and not adjudication
        and context_lines < 2_000
        and failure_cost == "low"
    ):
        return _decision(
            rule="R8",
            tier="execute",
            rationale="单文件低不确定性快速执行；prefers_acp 选择 spawn/opencode",
            prefers_acp=prefers_acp,
            background=background,
        )

    # R8 只读定点查询：低/中不确定、上下文小，沿用 execute tier，但强制零写入验收。
    if (
        (not writes)
        and uncertainty in ("low", "medium")
        and not adjudication
        and context_lines < 10_000
    ):
        result = _decision(
            rule="R8",
            tier="execute",
            rationale="只读定点查询/字段核查，沿用 execute tier；receipt.files_changed 必须为空",
            prefers_acp=prefers_acp,
            background=background,
        )
        result["required_validation"].append("files_changed=[]")
        return result

    # R9 兜底
    return _decision(
        rule="R9",
        tier="controller",
        rationale="未命中 R1–R8，兜底主控（medium）",
        prefers_acp=prefers_acp,
        background=background,
        effort=CONTROLLER_EFFORT,
    )


def _parse_bool_flag(value: str) -> bool:
    lowered = value.strip().lower()
    if lowered in ("1", "true", "yes", "y", "on"):
        return True
    if lowered in ("0", "false", "no", "n", "off"):
        return False
    raise argparse.ArgumentTypeError(f"无法解析 bool: {value!r}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="PTC routing v1.1：根据可观测特征输出单个路由 JSON",
    )
    parser.add_argument("--input-json", help="内联 JSON object 字符串")
    parser.add_argument("--input-file", help="读取 JSON object 的文件路径")
    parser.add_argument("--writes-files", type=_parse_bool_flag, metavar="BOOL")
    parser.add_argument("--file-count", type=int)
    parser.add_argument("--uncertainty", choices=UNCERTAINTY_VALUES)
    parser.add_argument("--adjudication", type=_parse_bool_flag, metavar="BOOL")
    parser.add_argument(
        "--validation-burden",
        choices=VALIDATION_BURDEN_VALUES,
    )
    parser.add_argument("--context-lines", type=int)
    parser.add_argument("--cross-directory", type=_parse_bool_flag, metavar="BOOL")
    parser.add_argument("--failure-cost", choices=FAILURE_COST_VALUES)
    parser.add_argument("--work-kind", choices=WORK_KIND_VALUES)
    parser.add_argument("--prefers-acp", type=_parse_bool_flag, metavar="BOOL")
    parser.add_argument("--background", type=_parse_bool_flag, metavar="BOOL")
    parser.add_argument("--design-mode", choices=DESIGN_MODE_VALUES)
    return parser


def _flag_overrides(args: argparse.Namespace) -> dict[str, Any]:
    mapping = {
        "writes_files": args.writes_files,
        "file_count": args.file_count,
        "uncertainty": args.uncertainty,
        "adjudication": args.adjudication,
        "validation_burden": args.validation_burden,
        "context_lines": args.context_lines,
        "cross_directory": args.cross_directory,
        "failure_cost": args.failure_cost,
        "work_kind": args.work_kind,
        "prefers_acp": args.prefers_acp,
        "background": args.background,
        "design_mode": args.design_mode,
    }
    return {key: value for key, value in mapping.items() if value is not None}


def load_input(args: argparse.Namespace) -> dict[str, Any]:
    merged: MutableMapping[str, Any] = {}
    if args.input_file:
        try:
            text = open(args.input_file, encoding="utf-8").read()
        except OSError as exc:
            raise RouteError(f"无法读取输入文件: {exc}") from exc
        try:
            loaded = json.loads(text)
        except json.JSONDecodeError as exc:
            raise RouteError(f"input-file JSON 无效: {exc}") from exc
        if not isinstance(loaded, dict):
            raise RouteError("input-file 必须是 JSON object")
        merged.update(loaded)
    if args.input_json:
        try:
            loaded = json.loads(args.input_json)
        except json.JSONDecodeError as exc:
            raise RouteError(f"input-json JSON 无效: {exc}") from exc
        if not isinstance(loaded, dict):
            raise RouteError("input-json 必须是 JSON object")
        merged.update(loaded)
    merged.update(_flag_overrides(args))
    if not merged:
        raise RouteError("请提供 --input-json / --input-file / 字段 flags")
    return dict(merged)


def main(argv: Sequence[str] | None = None) -> int:
    # Windows 控制台默认编码常非 UTF-8；统一按 UTF-8 输出 JSON。
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8")
            except Exception:
                pass
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        raw = load_input(args)
        result = decide(raw)
    except RouteError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
