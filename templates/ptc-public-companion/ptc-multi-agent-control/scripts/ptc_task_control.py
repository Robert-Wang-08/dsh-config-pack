#!/usr/bin/env python3
"""PTC 多代理模式的单一任务/进度账本控制器。

账本采用追加式 JSONL；只有主控写入，执行子代理只返回 receipt。
本工具只管理编排事实，不替代调用项目自己的需求、治理、代码或验证事实源。
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import socket
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

SCHEMA_VERSION = "1.0"
SKILL_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LEDGER = Path(os.getenv("PTC_LEDGER", ".ptc/registry.jsonl"))
DEFAULT_CONTRACT = SKILL_ROOT / "assets" / "task-contract.template.json"
TASK_STATUSES = {"backlog", "in_progress", "blocked", "review", "done", "cancelled"}
TRANSITIONS = {
    "backlog": {"in_progress", "blocked", "cancelled"},
    "in_progress": {"blocked", "review", "cancelled"},
    "blocked": {"in_progress", "cancelled"},
    "review": {"in_progress", "blocked", "done", "cancelled"},
    "done": set(),
    "cancelled": set(),
}
ROUTES = {
    "controller-codex",
    "controller-kimi",
    "design-opus5",
    "design-opus48",
    "execute-dsv41-flash",
    "continuous-cursor-grok",
    "docs-kimi",
    "local-controller",
}
PROJECT_EVENT_KINDS = {"decision", "progress", "risk", "handoff", "note", "milestone"}


class LedgerError(RuntimeError):
    """账本或输入违反不变量。"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return f"{prefix}-{stamp}-{uuid.uuid4().hex[:12]}"


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise LedgerError(f"文件不存在: {path}") from exc
    except json.JSONDecodeError as exc:
        raise LedgerError(f"JSON 无效: {path}: {exc}") from exc


def read_events(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as stream:
        for line_no, raw in enumerate(stream, 1):
            line = raw.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                raise LedgerError(f"账本第 {line_no} 行 JSON 无效: {exc}") from exc
            if not isinstance(item, dict):
                raise LedgerError(f"账本第 {line_no} 行必须是 JSON object")
            events.append(item)
    return events


@dataclass
class LedgerState:
    initialized: bool
    projects: dict[str, dict[str, Any]]
    tasks: dict[str, dict[str, Any]]
    sessions: dict[str, dict[str, Any]]
    subtasks: dict[str, dict[str, Any]]
    receipts: dict[str, dict[str, Any]]
    artifacts: dict[str, dict[str, Any]]
    timeline: list[dict[str, Any]]
    event_ids: set[str]


def empty_state() -> LedgerState:
    return LedgerState(False, {}, {}, {}, {}, {}, {}, [], set())


def required_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise LedgerError(f"{field} 必须是非空字符串")
    return value.strip()


def reduce_events(events: Iterable[dict[str, Any]]) -> LedgerState:
    state = empty_state()
    for index, event in enumerate(events, 1):
        version = event.get("schema_version")
        if version != SCHEMA_VERSION:
            raise LedgerError(f"第 {index} 个事件 schema_version={version!r}，应为 {SCHEMA_VERSION}")
        event_id = required_text(event.get("event_id"), "event_id")
        if event_id in state.event_ids:
            raise LedgerError(f"重复 event_id: {event_id}")
        state.event_ids.add(event_id)
        event_type = required_text(event.get("event_type"), "event_type")
        payload = event.get("payload")
        if not isinstance(payload, dict):
            raise LedgerError(f"事件 {event_id} 的 payload 必须是 object")

        if event_type == "registry_initialized":
            if state.initialized:
                raise LedgerError("registry_initialized 只能出现一次")
            state.initialized = True
            continue
        if not state.initialized:
            raise LedgerError("第一个事件必须是 registry_initialized")

        project_id = event.get("project_id")
        task_id = event.get("task_id")
        session_id = event.get("session_id")

        if event_type == "project_created":
            project_id = required_text(project_id, "project_id")
            if project_id in state.projects:
                raise LedgerError(f"重复 project_id: {project_id}")
            state.projects[project_id] = {
                "project_id": project_id,
                "name": required_text(payload.get("name"), "project.name"),
                "description": str(payload.get("description") or ""),
                "created_event_id": event_id,
            }
        elif event_type == "task_created":
            project_id = required_text(project_id, "project_id")
            task_id = required_text(task_id, "task_id")
            if project_id not in state.projects:
                raise LedgerError(f"task 引用了不存在的 project: {project_id}")
            if task_id in state.tasks:
                raise LedgerError(f"重复 task_id: {task_id}")
            contract = payload.get("contract")
            if not isinstance(contract, dict):
                raise LedgerError(f"task {task_id} 缺少 object 类型 contract")
            state.tasks[task_id] = {
                "task_id": task_id,
                "project_id": project_id,
                "title": required_text(payload.get("title"), "task.title"),
                "objective": required_text(payload.get("objective"), "task.objective"),
                "status": "backlog",
                "progress": 0,
                "contract": contract,
                "contract_hash": sha256_json(contract),
                "owner": required_text(payload.get("owner", "unknown"), "task.owner"),
                "created_event_id": event_id,
                "latest_event_id": event_id,
                "summary": "",
                "next_action": "开始执行",
                "evidence": [],
            }
        elif event_type == "session_started":
            task_id = required_text(task_id, "task_id")
            session_id = required_text(session_id, "session_id")
            if task_id not in state.tasks:
                raise LedgerError(f"session 引用了不存在的 task: {task_id}")
            previous = state.sessions.get(session_id)
            if previous is not None:
                # 同一个 DSH 会话可能在上一轮收官后继续开纠正轮（模型切换、
                # 用户在同一窗口继续对话），所以「已结束」的绑定可以重新开始；
                # 真正要禁止的是同一会话同时存在两个活动绑定。
                if not previous["ended"]:
                    raise LedgerError(f"重复 session_id: {session_id}")
                previous_task = state.tasks.get(previous["task_id"]) or {}
                if previous_task.get("status") not in {"done", "cancelled"}:
                    raise LedgerError(
                        f"session {session_id} 上次绑定的 task {previous['task_id']} "
                        f"状态为 {previous_task.get('status')}，尚未终结；"
                        "先收官或取消该 task 再换绑"
                    )
            active_for_task = [s for s in state.sessions.values() if s["task_id"] == task_id and not s["ended"]]
            if active_for_task and not payload.get("allow_parallel"):
                raise LedgerError(f"task {task_id} 已有活动 session: {active_for_task[0]['session_id']}")
            history = list(previous.get("history", [])) if previous else []
            if previous is not None:
                history.append(
                    {
                        "task_id": previous["task_id"],
                        "started_event_id": previous["started_event_id"],
                        "end_event_id": previous.get("end_event_id"),
                        "end_summary": previous.get("end_summary", ""),
                    }
                )
            state.sessions[session_id] = {
                "session_id": session_id,
                "task_id": task_id,
                "controller": required_text(payload.get("controller"), "session.controller"),
                "controller_model": required_text(payload.get("controller_model"), "session.controller_model"),
                "started_event_id": event_id,
                "ended": False,
                "history": history,
            }
        elif event_type == "session_ended":
            session_id = required_text(session_id, "session_id")
            if session_id not in state.sessions:
                raise LedgerError(f"结束了不存在的 session: {session_id}")
            if state.sessions[session_id]["ended"]:
                raise LedgerError(f"session 已结束: {session_id}")
            state.sessions[session_id]["ended"] = True
            state.sessions[session_id]["end_event_id"] = event_id
            state.sessions[session_id]["end_summary"] = str(payload.get("summary") or "")
        elif event_type == "subtask_created":
            task_id = required_text(task_id, "task_id")
            if task_id not in state.tasks:
                raise LedgerError(f"subtask 引用了不存在的 task: {task_id}")
            subtask_id = required_text(payload.get("subtask_id"), "subtask_id")
            if subtask_id in state.subtasks:
                raise LedgerError(f"重复 subtask_id: {subtask_id}")
            route = required_text(payload.get("route"), "subtask.route")
            if route not in ROUTES:
                raise LedgerError(f"未知 route: {route}; 可选: {', '.join(sorted(ROUTES))}")
            state.subtasks[subtask_id] = {
                "subtask_id": subtask_id,
                "task_id": task_id,
                "title": required_text(payload.get("title"), "subtask.title"),
                "objective": required_text(payload.get("objective"), "subtask.objective"),
                "route": route,
                "expected_output": required_text(payload.get("expected_output"), "subtask.expected_output"),
                "created_event_id": event_id,
                "receipt_id": None,
            }
        elif event_type == "receipt_recorded":
            task_id = required_text(task_id, "task_id")
            if task_id not in state.tasks:
                raise LedgerError(f"receipt 引用了不存在的 task: {task_id}")
            receipt = payload.get("receipt")
            validate_receipt(receipt, task_id=task_id)
            receipt_id = required_text(receipt.get("receipt_id"), "receipt_id")
            if receipt_id in state.receipts:
                raise LedgerError(f"重复 receipt_id: {receipt_id}")
            subtask_id = required_text(receipt.get("subtask_id"), "receipt.subtask_id")
            if subtask_id not in state.subtasks:
                raise LedgerError(f"receipt 引用了不存在的 subtask: {subtask_id}")
            if state.subtasks[subtask_id]["task_id"] != task_id:
                raise LedgerError(f"receipt 的 task_id 与 subtask 不一致: {receipt_id}")
            dispatched_route = state.subtasks[subtask_id]["route"]
            if receipt["route"] != dispatched_route:
                raise LedgerError(
                    f"receipt.route 与 subtask.route 不一致: "
                    f"{receipt['route']} != {dispatched_route}"
                )
            if state.subtasks[subtask_id]["receipt_id"]:
                raise LedgerError(f"subtask 已有 receipt: {subtask_id}")
            state.receipts[receipt_id] = receipt
            state.subtasks[subtask_id]["receipt_id"] = receipt_id
        elif event_type == "task_status_changed":
            task_id = required_text(task_id, "task_id")
            if task_id not in state.tasks:
                raise LedgerError(f"状态事件引用了不存在的 task: {task_id}")
            task = state.tasks[task_id]
            new_status = required_text(payload.get("status"), "status")
            if new_status not in TASK_STATUSES:
                raise LedgerError(f"未知 task status: {new_status}")
            old_status = task["status"]
            if new_status != old_status and new_status not in TRANSITIONS[old_status]:
                raise LedgerError(f"非法状态迁移: {old_status} -> {new_status}")
            progress = payload.get("progress")
            if not isinstance(progress, int) or not 0 <= progress <= 100:
                raise LedgerError("progress 必须是 0..100 的整数")
            if progress < task["progress"]:
                raise LedgerError(f"progress 不得回退: {task['progress']} -> {progress}")
            evidence = payload.get("evidence")
            if not isinstance(evidence, list) or not all(isinstance(x, str) and x.strip() for x in evidence):
                raise LedgerError("evidence 必须是非空字符串数组")
            if new_status in {"review", "done"} and not evidence:
                raise LedgerError(f"进入 {new_status} 必须提供 evidence")
            if new_status == "done" and progress != 100:
                raise LedgerError("done 状态的 progress 必须为 100")
            task.update(
                status=new_status,
                progress=progress,
                summary=required_text(payload.get("summary"), "summary"),
                next_action=required_text(payload.get("next_action"), "next_action"),
                evidence=evidence,
                latest_event_id=event_id,
            )
        elif event_type == "artifact_recorded":
            task_id = required_text(task_id, "task_id")
            if task_id not in state.tasks:
                raise LedgerError(f"artifact 引用了不存在的 task: {task_id}")
            artifact_id = required_text(payload.get("artifact_id"), "artifact_id")
            if artifact_id in state.artifacts:
                raise LedgerError(f"重复 artifact_id: {artifact_id}")
            state.artifacts[artifact_id] = {
                "artifact_id": artifact_id,
                "task_id": task_id,
                "path": required_text(payload.get("path"), "artifact.path"),
                "kind": required_text(payload.get("kind"), "artifact.kind"),
                "format": required_text(payload.get("format"), "artifact.format"),
                "sha256": str(payload.get("sha256") or ""),
                "evidence": str(payload.get("evidence") or ""),
                "event_id": event_id,
            }
        elif event_type == "project_event_recorded":
            project_id = required_text(project_id, "project_id")
            if project_id not in state.projects:
                raise LedgerError(f"event 引用了不存在的 project: {project_id}")
            if task_id is not None:
                task_id = required_text(task_id, "task_id")
                if task_id not in state.tasks:
                    raise LedgerError(f"event 引用了不存在的 task: {task_id}")
                if state.tasks[task_id]["project_id"] != project_id:
                    raise LedgerError("event 的 project_id 与 task 不一致")
            kind = required_text(payload.get("kind"), "event.kind")
            if kind not in PROJECT_EVENT_KINDS:
                raise LedgerError(f"未知 event kind: {kind}")
            evidence = payload.get("evidence", [])
            if not isinstance(evidence, list) or not all(isinstance(x, str) and x.strip() for x in evidence):
                raise LedgerError("event.evidence 必须是非空字符串数组")
            state.timeline.append(
                {
                    "event_id": event_id,
                    "occurred_at": event.get("occurred_at"),
                    "project_id": project_id,
                    "task_id": task_id,
                    "session_id": session_id,
                    "kind": kind,
                    "message": required_text(payload.get("message"), "event.message"),
                    "evidence": evidence,
                    "actor": event.get("actor"),
                }
            )
        elif event_type == "note_recorded":
            task_id = required_text(task_id, "task_id")
            if task_id not in state.tasks:
                raise LedgerError(f"note 引用了不存在的 task: {task_id}")
            required_text(payload.get("note"), "note")
        else:
            raise LedgerError(f"未知 event_type: {event_type}")
    return state


def validate_receipt(receipt: Any, task_id: str | None = None) -> None:
    if not isinstance(receipt, dict):
        raise LedgerError("receipt 必须是 JSON object")
    required = [
        "schema_version",
        "receipt_id",
        "task_id",
        "subtask_id",
        "route",
        "executor",
        "model",
        "outcome",
        "summary",
        "files_changed",
        "validation",
        "risks",
    ]
    missing = [key for key in required if key not in receipt]
    if missing:
        raise LedgerError(f"receipt 缺少字段: {', '.join(missing)}")
    extras = sorted(set(receipt) - set(required))
    if extras:
        raise LedgerError(f"receipt 包含 schema 未允许的额外字段: {', '.join(extras)}")
    if receipt["schema_version"] != SCHEMA_VERSION:
        raise LedgerError(f"receipt schema_version 应为 {SCHEMA_VERSION}")
    if task_id and receipt["task_id"] != task_id:
        raise LedgerError("receipt.task_id 与命令参数不一致")
    if receipt["route"] not in ROUTES:
        raise LedgerError(f"receipt.route 不合法: {receipt['route']}")
    if receipt["outcome"] not in {"completed", "partial", "blocked", "failed"}:
        raise LedgerError("receipt.outcome 必须是 completed/partial/blocked/failed")
    for field in ("files_changed", "validation", "risks"):
        if not isinstance(receipt[field], list):
            raise LedgerError(f"receipt.{field} 必须是 array")
    for field in ("receipt_id", "task_id", "subtask_id", "executor", "model", "summary"):
        required_text(receipt[field], f"receipt.{field}")


@contextlib.contextmanager
def exclusive_lock(ledger: Path) -> Iterator[None]:
    lock_path = ledger.with_suffix(ledger.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as lock_file:
        lock_file.seek(0, os.SEEK_END)
        if lock_file.tell() == 0:
            lock_file.write(b"0")
            lock_file.flush()
        lock_file.seek(0)
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(lock_file.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def build_event(
    event_type: str,
    actor: str,
    *,
    project_id: str | None = None,
    task_id: str | None = None,
    session_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "event_id": new_id("evt"),
        "occurred_at": utc_now(),
        "event_type": event_type,
        "project_id": project_id,
        "task_id": task_id,
        "session_id": session_id,
        "actor": actor,
        "machine": socket.gethostname(),
        "payload": payload or {},
    }


def append_events(ledger: Path, events: list[dict[str, Any]]) -> LedgerState:
    ledger.parent.mkdir(parents=True, exist_ok=True)
    with exclusive_lock(ledger):
        existing = read_events(ledger)
        state = reduce_events([*existing, *events])
        with ledger.open("a", encoding="utf-8", newline="\n") as stream:
            for event in events:
                stream.write(canonical_json(event) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
    return state


def parse_evidence(values: list[str] | None) -> list[str]:
    return [value.strip() for value in (values or []) if value.strip()]


def ensure_initialized(ledger: Path, actor: str) -> list[dict[str, Any]]:
    if read_events(ledger):
        return []
    return [
        build_event(
            "registry_initialized",
            actor,
            payload={
                "description": "PTC 多代理编排唯一任务/进度账本",
                "authoritative": True,
                "controller_only_write": True,
            },
        )
    ]


def cmd_init(args: argparse.Namespace) -> None:
    ledger = args.ledger
    events = ensure_initialized(ledger, args.actor)
    current = reduce_events(read_events(ledger)) if ledger.exists() and ledger.stat().st_size else empty_state()
    if args.project_id not in current.projects:
        events.append(
            build_event(
                "project_created",
                args.actor,
                project_id=args.project_id,
                payload={"name": args.project_name, "description": args.description},
            )
        )
    if events:
        state = append_events(ledger, events)
        print(canonical_json({"ok": True, "ledger": str(ledger), "projects": list(state.projects)}))
    else:
        print(canonical_json({"ok": True, "unchanged": True, "ledger": str(ledger)}))


def cmd_task_create(args: argparse.Namespace) -> None:
    contract = load_json(args.contract)
    task_id = args.task_id or new_id("task")
    event = build_event(
        "task_created",
        args.actor,
        project_id=args.project_id,
        task_id=task_id,
        payload={"title": args.title, "objective": args.objective, "owner": args.owner, "contract": contract},
    )
    append_events(args.ledger, [event])
    print(canonical_json({"ok": True, "task_id": task_id, "event_id": event["event_id"], "contract_hash": sha256_json(contract)}))


def cmd_session_start(args: argparse.Namespace) -> None:
    event = build_event(
        "session_started",
        args.actor,
        task_id=args.task_id,
        session_id=args.session_id,
        payload={
            "controller": args.controller,
            "controller_model": args.controller_model,
            "allow_parallel": args.allow_parallel,
        },
    )
    append_events(args.ledger, [event])
    print(canonical_json({"ok": True, "event_id": event["event_id"], "session_id": args.session_id}))


def cmd_session_end(args: argparse.Namespace) -> None:
    event = build_event(
        "session_ended",
        args.actor,
        task_id=args.task_id,
        session_id=args.session_id,
        payload={"summary": args.summary},
    )
    append_events(args.ledger, [event])
    print(canonical_json({"ok": True, "event_id": event["event_id"], "session_id": args.session_id}))


def cmd_subtask_create(args: argparse.Namespace) -> None:
    subtask_id = args.subtask_id or new_id("subtask")
    event = build_event(
        "subtask_created",
        args.actor,
        task_id=args.task_id,
        session_id=args.session_id,
        payload={
            "subtask_id": subtask_id,
            "title": args.title,
            "objective": args.objective,
            "route": args.route,
            "expected_output": args.expected_output,
        },
    )
    append_events(args.ledger, [event])
    print(canonical_json({"ok": True, "subtask_id": subtask_id, "event_id": event["event_id"]}))


def cmd_receipt_add(args: argparse.Namespace) -> None:
    receipt = load_json(args.receipt)
    validate_receipt(receipt, task_id=args.task_id)
    event = build_event(
        "receipt_recorded",
        args.actor,
        task_id=args.task_id,
        session_id=args.session_id,
        payload={"receipt": receipt},
    )
    append_events(args.ledger, [event])
    print(canonical_json({"ok": True, "receipt_id": receipt["receipt_id"], "event_id": event["event_id"]}))


def cmd_status_update(args: argparse.Namespace) -> None:
    event = build_event(
        "task_status_changed",
        args.actor,
        task_id=args.task_id,
        session_id=args.session_id,
        payload={
            "status": args.status,
            "progress": args.progress,
            "summary": args.summary,
            "next_action": args.next_action,
            "evidence": parse_evidence(args.evidence),
        },
    )
    state = append_events(args.ledger, [event])
    task = state.tasks[args.task_id]
    print(canonical_json({"ok": True, "event_id": event["event_id"], "task": task}))


def cmd_artifact_add(args: argparse.Namespace) -> None:
    artifact_id = args.artifact_id or new_id("artifact")
    event = build_event(
        "artifact_recorded",
        args.actor,
        task_id=args.task_id,
        session_id=args.session_id,
        payload={
            "artifact_id": artifact_id,
            "path": args.path,
            "kind": args.kind,
            "format": args.format,
            "sha256": args.sha256,
            "evidence": args.evidence,
        },
    )
    append_events(args.ledger, [event])
    print(canonical_json({"ok": True, "artifact_id": artifact_id, "event_id": event["event_id"]}))


def cmd_event_add(args: argparse.Namespace) -> None:
    event = build_event(
        "project_event_recorded",
        args.actor,
        project_id=args.project_id,
        task_id=args.task_id,
        session_id=args.session_id,
        payload={
            "kind": args.kind,
            "message": args.message,
            "evidence": parse_evidence(args.evidence),
        },
    )
    append_events(args.ledger, [event])
    print(canonical_json({"ok": True, "event_id": event["event_id"], "kind": args.kind}))


def state_projection(state: LedgerState, task_id: str | None = None) -> dict[str, Any]:
    tasks = state.tasks
    if task_id:
        if task_id not in tasks:
            raise LedgerError(f"task 不存在: {task_id}")
        tasks = {task_id: tasks[task_id]}
    task_ids = set(tasks)
    return {
        "schema_version": SCHEMA_VERSION,
        "projects": state.projects,
        "tasks": tasks,
        "sessions": {k: v for k, v in state.sessions.items() if v["task_id"] in task_ids},
        "subtasks": {k: v for k, v in state.subtasks.items() if v["task_id"] in task_ids},
        "receipts": {k: v for k, v in state.receipts.items() if v["task_id"] in task_ids},
        "artifacts": {k: v for k, v in state.artifacts.items() if v["task_id"] in task_ids},
        "timeline": [item for item in state.timeline if item["task_id"] is None or item["task_id"] in task_ids],
        "event_count": len(state.event_ids),
    }


def cmd_show(args: argparse.Namespace) -> None:
    state = reduce_events(read_events(args.ledger))
    projection = state_projection(state, args.task_id)
    print(json.dumps(projection, ensure_ascii=False, indent=2, sort_keys=True))


def cmd_verify(args: argparse.Namespace) -> None:
    events = read_events(args.ledger)
    state = reduce_events(events)
    active_sessions = [s["session_id"] for s in state.sessions.values() if not s["ended"]]
    print(
        canonical_json(
            {
                "ok": True,
                "ledger": str(args.ledger),
                "events": len(events),
                "projects": len(state.projects),
                "tasks": len(state.tasks),
                "active_sessions": active_sessions,
                "subtasks_without_receipt": [
                    item["subtask_id"] for item in state.subtasks.values() if not item["receipt_id"]
                ],
            }
        )
    )


def add_common(parser: argparse.ArgumentParser) -> None:
    """挂载账本与 actor 选项，允许写在子命令之前或之后。

    用 ``SUPPRESS`` 而不是普通默认值：子解析器只在用户确实传参时才写入该属性，
    因此写在子命令前的值不会被子解析器的默认值覆盖。
    """
    parser.add_argument("--ledger", type=Path, default=argparse.SUPPRESS)
    parser.add_argument("--actor", default=argparse.SUPPRESS)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    add_common(parser)
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init", help="初始化账本并登记项目（幂等）")
    add_common(init)
    init.add_argument("--project-id", required=True)
    init.add_argument("--project-name", required=True)
    init.add_argument("--description", default="")
    init.set_defaults(func=cmd_init)

    task = sub.add_parser("task-create", help="创建全局唯一根任务")
    add_common(task)
    task.add_argument("--project-id", required=True)
    task.add_argument("--task-id")
    task.add_argument("--title", required=True)
    task.add_argument("--objective", required=True)
    task.add_argument("--owner", default="unknown")
    task.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    task.set_defaults(func=cmd_task_create)

    session = sub.add_parser("session-start", help="将会话绑定到唯一根任务")
    add_common(session)
    session.add_argument("--task-id", required=True)
    session.add_argument("--session-id", required=True)
    session.add_argument("--controller", required=True)
    session.add_argument("--controller-model", required=True)
    session.add_argument("--allow-parallel", action="store_true")
    session.set_defaults(func=cmd_session_start)

    session_end = sub.add_parser("session-end", help="结束会话绑定")
    add_common(session_end)
    session_end.add_argument("--task-id", required=True)
    session_end.add_argument("--session-id", required=True)
    session_end.add_argument("--summary", required=True)
    session_end.set_defaults(func=cmd_session_end)

    subtask = sub.add_parser("subtask-create", help="创建细分子任务及固定路由")
    add_common(subtask)
    subtask.add_argument("--task-id", required=True)
    subtask.add_argument("--session-id")
    subtask.add_argument("--subtask-id")
    subtask.add_argument("--title", required=True)
    subtask.add_argument("--objective", required=True)
    subtask.add_argument("--route", required=True, choices=sorted(ROUTES))
    subtask.add_argument("--expected-output", required=True)
    subtask.set_defaults(func=cmd_subtask_create)

    receipt = sub.add_parser("receipt-add", help="主控验收并登记 worker receipt")
    add_common(receipt)
    receipt.add_argument("--task-id", required=True)
    receipt.add_argument("--session-id")
    receipt.add_argument("--receipt", type=Path, required=True)
    receipt.set_defaults(func=cmd_receipt_add)

    status = sub.add_parser("status-update", help="主控写入唯一进度状态")
    add_common(status)
    status.add_argument("--task-id", required=True)
    status.add_argument("--session-id")
    status.add_argument("--status", required=True, choices=sorted(TASK_STATUSES))
    status.add_argument("--progress", required=True, type=int)
    status.add_argument("--summary", required=True)
    status.add_argument("--next-action", required=True)
    status.add_argument("--evidence", action="append", default=[])
    status.set_defaults(func=cmd_status_update)

    artifact = sub.add_parser("artifact-add", help="按契约登记产出物")
    add_common(artifact)
    artifact.add_argument("--task-id", required=True)
    artifact.add_argument("--session-id")
    artifact.add_argument("--artifact-id")
    artifact.add_argument("--path", required=True)
    artifact.add_argument("--kind", required=True)
    artifact.add_argument("--format", required=True)
    artifact.add_argument("--sha256", default="")
    artifact.add_argument("--evidence", default="")
    artifact.set_defaults(func=cmd_artifact_add)

    project_event = sub.add_parser("event-add", help="登记项目级决策、风险、里程碑或交接事件")
    add_common(project_event)
    project_event.add_argument("--project-id", required=True)
    project_event.add_argument("--task-id")
    project_event.add_argument("--session-id")
    project_event.add_argument("--kind", required=True, choices=sorted(PROJECT_EVENT_KINDS))
    project_event.add_argument("--message", required=True)
    project_event.add_argument("--evidence", action="append", default=[])
    project_event.set_defaults(func=cmd_event_add)

    show = sub.add_parser("show", help="显示当前派生状态")
    add_common(show)
    show.add_argument("--task-id")
    show.set_defaults(func=cmd_show)

    verify = sub.add_parser("verify", help="重放并验证账本不变量")
    add_common(verify)
    verify.set_defaults(func=cmd_verify)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.ledger = Path(getattr(args, "ledger", DEFAULT_LEDGER)).resolve()
    args.actor = getattr(args, "actor", None) or os.getenv("USERNAME") or os.getenv("USER") or "unknown"
    try:
        args.func(args)
        return 0
    except LedgerError as exc:
        print(canonical_json({"ok": False, "error": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
