#!/usr/bin/env node
/**
 * scripts/metrics.mjs - read-only execution-metrics extractor for DSH session logs.
 *
 * Turns DSH durable per-session event logs into the execution metrics needed to
 * calibrate model routing: tool-call counts, durations, timeout classes, errors,
 * token usage and (only when a human supplies labels) first-pass success.
 *
 * Guiding rule: NEVER invent data. Anything that is not literally present in the
 * log is reported as null together with an explicit coverage number.
 *
 * Read-only contract: this script never writes anywhere, except inside its own
 * OS temp directory during selftest. No network access.
 *
 * Dependency: fzstd (pure JS, no native build) is REQUIRED because DSH session logs
 * are multi-frame zstd and Node's built-in zstd APIs only decode the first frame.
 * It is declared in package.json dependencies; a full "npm install" in this repo can
 * be blocked by unrelated pre-existing dependency conflicts, in which case install
 * it directly:  npm install fzstd --save --legacy-peer-deps
 *
 * Usage:
 *   node scripts/metrics.mjs scan     --sessions <dir> [--json]
 *   node scripts/metrics.mjs stats    --sessions <dir> [--group-by route,executor,model]
 *                                     [--labels <file.json>] [--json]
 *   node scripts/metrics.mjs selftest
 *   node scripts/metrics.mjs --help
 */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decompress } from 'fzstd';

export const SESSION_FILE_RE = /^session\.v\d+\.jsonl$/;
export const SESSION_ZSTD_RE = /^session\.v\d+\.jsonl\.zstd$/;

/* ---------------------------------------------------------------- patterns */
/* Timeout classes are separate root causes and are NEVER merged into one number. */
export const PATTERNS = {
  toolTimeout: /tool call timed out after \d+ms/,
  ptcDeadline: /execution deadline reached \(\d+ms\)/,
  /* ACP transport failures: the class pattern is tested against the FULL text of
   * the event, never against the truncated acpAny match. */
  acpTransport: /Subagent failure \(provider: ACP; stage: [^;]+; category: transport\)/,
  acpAny: /Subagent failure \(provider: ACP;/,
  cancelled: /subagent request was aborted/,
  testEvidence: /\b(npm test|npm run test|pytest|python -m pytest|node --test|node scripts\/verify\.mjs)\b/,
  exitCode: /(?:\[\s*exit code:\s*(\d+)\s*\]|exit code:\s*(\d+)|exit=(\d+))/,
};

const GROUP_KEYS = ['route', 'executor', 'model'];

/* Imported sessions can carry event timestamps whose clock does not line up with
 * the session's own createdAt (observed in real DSH stores: sessions whose span
 * exceeds a day). Such a timeline cannot yield a trustworthy duration, so the
 * duration is reported as null with clockSkew=true instead of being invented. */
export const CLOCK_TOLERANCE_MS = 6 * 60 * 60 * 1000;

/* ----------------------------------------------------------------- helpers */

export function toNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Collect every text payload a log event may carry, without ever printing it. */
function eventTexts(ev) {
  const d = ev && ev.data ? ev.data : {};
  const out = [];
  const push = (v) => { if (typeof v === 'string' && v) out.push(v); };
  const m = d.message;
  if (m && typeof m === 'object') {
    if (Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c && typeof c === 'object') {
          push(c.text);
          if (c.type === 'tool-call' || c.name) push(c.arguments);
        }
      }
    }
    if (typeof m.text === 'string') push(m.text);
  }
  if (Array.isArray(d.content)) {
    for (const c of d.content) {
      if (typeof c === 'string') push(c);
      else if (c && typeof c === 'object') push(c.text);
    }
  }
  push(d.text);
  if (typeof d.output === 'string') push(d.output);
  push(d.stdout);
  push(d.stderr);
  if (typeof d.arguments === 'string') push(d.arguments);
  if (typeof d.error === 'string') push(d.error);
  if (d.error && typeof d.error === 'object') push(d.error.message);
  return out;
}

/**
 * Classify ACP subagent failures in one text.
 * Each failure LINE is classified on its own: a line carrying
 * "category: transport" is an acpTransport failure, any other ACP failure line is
 * acpOther. Both are reported as SEPARATE counters; a text containing both kinds
 * counts once in each, and no counter is ever inferred from a truncated match.
 */
export function classifyAcpFailures(text) {
  const out = { acpTransport: 0, acpOther: 0 };
  if (typeof text !== 'string' || !text) return out;
  const lines = text.split(/[\r\n]+/);
  for (const line of lines) {
    if (!PATTERNS.acpAny.test(line)) continue;
    if (PATTERNS.acpTransport.test(line)) out.acpTransport += 1;
    else out.acpOther += 1;
  }
  return out;
}

function firstMatch(texts, re) {
  for (const t of texts) {
    const m = t.match(re);
    if (m) return m;
  }
  return null;
}

export function percentile90(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const idx = Math.ceil(0.9 * xs.length) - 1;
  return xs[Math.max(0, Math.min(xs.length - 1, idx))];
}

export function mean(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** rate(num, den) - null (never 0) when the denominator is 0. */
export function rate(num, den) {
  if (!den || den <= 0) return null;
  return num / den;
}

export function round(n, digits = 4) {
  if (n === null || n === undefined) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * Split a log file into JSON events.
 * Multi-frame zstd is decoded with fzstd; a plain .jsonl file is read as-is.
 * Never throws: unreadable/corrupt input is reported via { error }.
 */
export function readSessionEvents(filePath) {
  let buf;
  try {
    buf = readFileSync(filePath);
  } catch (err) {
    return { events: [], badLines: 0, error: 'unreadable: ' + (err && err.code ? err.code : 'unknown') };
  }
  let text;
  try {
    if (filePath.endsWith('.zstd')) {
      const raw = decompress(new Uint8Array(buf));
      text = Buffer.from(raw).toString('utf8');
    } else {
      text = buf.toString('utf8');
    }
  } catch (err) {
    return { events: [], badLines: 0, error: 'decode-failed: ' + (err && err.message ? String(err.message).slice(0, 80) : 'unknown') };
  }
  const events = [];
  let badLines = 0;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const ev = JSON.parse(s);
      if (ev && typeof ev === 'object') events.push(ev);
      else badLines += 1;
    } catch {
      badLines += 1;
    }
  }
  return { events, badLines, error: null };
}

/** Recursively find session log files under <sessions>. Never follows symlinks. */
export function discoverSessionFiles(root, maxDepth = 6) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p, depth + 1);
      } else if (e.isFile() && (SESSION_ZSTD_RE.test(e.name) || SESSION_FILE_RE.test(e.name))) {
        found.push(p);
      }
    }
  };
  walk(root, 0);
  found.sort();
  return found;
}

function histBump(hist, key) {
  if (key === null || key === undefined || key === '') return;
  hist[key] = (hist[key] || 0) + 1;
}

function modalPair(pairHist) {
  let best = null;
  let bestCount = -1;
  for (const [k, v] of Object.entries(pairHist)) {
    if (v > bestCount || (v === bestCount && best !== null && k < best)) {
      best = k;
      bestCount = v;
    }
  }
  if (best === null) return { provider: null, model: null, count: 0 };
  const parts = best.split('\u0000');
  return { provider: parts[0], model: parts[1], count: bestCount };
}

/* ------------------------------------------------------------ scan (records) */

/**
 * Extract the mechanical facts of ONE session from already-parsed events.
 * Mechanical only: labels (first-pass success / acceptance) are NOT invented here.
 */
export function metricsFromEvents(events, meta = {}) {
  let sessionId = meta.sessionId || null;
  let workspace = meta.workspace || null;
  let createdAt = null;
  let agentPreset = null;
  let delegationDepth = null;
  let sessionVersion = null;
  let cwd = null;

  const callIds = new Set();
  const subCallIds = new Set();
  const callInfo = new Map();
  const duplicateCallIds = new Set();
  const duplicateSubCallIds = new Set();
  const seenCallId = new Set();
  const seenSubCallId = new Set();

  const resultIds = new Set();
  const resultSeen = new Set();
  const errorFlagIds = new Set();
  let toolResultsTotal = 0;
  let toolResultsUnmatched = 0;
  const errorCodes = {};
  const timeouts = { toolTimeout: 0, ptcDeadline: 0, acpTransport: 0, acpOther: 0, cancelled: 0 };

  const durations = [];
  let durationsNull = 0;

  let assistantMessages = 0;
  let usageEvents = 0;
  let usageMissingEvents = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalTokens = 0;

  const observedPairHist = {};
  const headerPairHist = {};

  let testEvidence = 0;
  const testExitCodes = {};
  let testExitCodeNull = 0;
  /* Deduped by STABLE ID: one evidence event per distinct call id (an orphan
   * result with no call id falls back to its own seq). Never by text occurrence. */
  const testEvidenceKeys = new Set();
  const testEvidenceTexts = new Map();

  let firstTime = null;
  let lastTime = null;
  let outsideClockWindow = 0;
  let seqMax = null;
  let eventIndex = 0;

  for (const ev of events) {
    eventIndex += 1;
    if (!ev || typeof ev.type !== 'string') continue;
    const d = ev.data && typeof ev.data === 'object' ? ev.data : {};
    const t = toNumber(ev.time) !== null ? toNumber(ev.time) : (toNumber(d.time) !== null ? toNumber(d.time) : toNumber(ev.timestamp));
    if (t !== null) {
      if (firstTime === null || t < firstTime) firstTime = t;
      if (lastTime === null || t > lastTime) lastTime = t;
      if (createdAt !== null && Math.abs(t - createdAt) > CLOCK_TOLERANCE_MS) outsideClockWindow += 1;
    }
    const seq = toNumber(ev.seq);
    if (seq !== null && (seqMax === null || seq > seqMax)) seqMax = seq;
    const eventKey = seq !== null ? 's' + seq : 'e' + eventIndex;

    switch (ev.type) {
      case 'session': {
        /* Real DSH logs put these fields on the event ROOT
         * ({"type":"session","id":...}); fixtures may nest them under data.
         * Accept either, data first. */
        const sid = typeof d.id === 'string' ? d.id : (typeof ev.id === 'string' ? ev.id : null);
        if (!sessionId && sid !== null) sessionId = sid;
        const cw = typeof d.cwd === 'string' ? d.cwd : (typeof ev.cwd === 'string' ? ev.cwd : null);
        if (cw !== null) cwd = cw;
        const ap = typeof d.agentPreset === 'string' ? d.agentPreset : (typeof ev.agentPreset === 'string' ? ev.agentPreset : null);
        if (ap !== null) agentPreset = ap;
        const dd = toNumber(d.delegationDepth) !== null ? toNumber(d.delegationDepth) : toNumber(ev.delegationDepth);
        if (dd !== null) delegationDepth = dd;
        const v = toNumber(d.version) !== null ? toNumber(d.version) : toNumber(ev.version);
        if (v !== null) sessionVersion = v;
        const ca = toNumber(d.createdAt) !== null ? toNumber(d.createdAt) : toNumber(ev.createdAt);
        if (ca !== null) createdAt = createdAt === null ? ca : Math.min(createdAt, ca);
        break;
      }
      case 'tool/call': {
        const id = typeof d.callId === 'string' ? d.callId : null;
        if (id === null) break;
        if (seenCallId.has(id)) duplicateCallIds.add(id);
        seenCallId.add(id);
        callIds.add(id);
        if (!callInfo.has(id)) {
          callInfo.set(id, {
            time: t,
            name: typeof d.name === 'string' ? d.name : null,
            arguments: typeof d.arguments === 'string' ? d.arguments : (d.arguments ? JSON.stringify(d.arguments) : null),
          });
        }
        break;
      }
      case 'tool/ptc-dispatch-start': {
        const id = typeof d.subCallId === 'string' ? d.subCallId : null;
        if (id === null) break;
        if (seenSubCallId.has(id)) duplicateSubCallIds.add(id);
        seenSubCallId.add(id);
        subCallIds.add(id);
        break;
      }
      case 'tool/result': {
        toolResultsTotal += 1;
        const m = d.message && typeof d.message === 'object' ? d.message : {};
        const src = m.source && typeof m.source === 'object' ? m.source : {};
        const id = typeof src.callId === 'string' ? src.callId
          : (typeof m.toolCallId === 'string' ? m.toolCallId : null);
        if (id !== null) {
          if (!resultSeen.has(id)) {
            resultSeen.add(id);
            resultIds.add(id);
          }
          if (!callIds.has(id)) toolResultsUnmatched += 1;
          if (m.isError === true) errorFlagIds.add(id);
        } else {
          toolResultsUnmatched += 1;
        }
        if (d.error && typeof d.error === 'object') {
          const code = typeof d.error.code === 'string' ? d.error.code
            : (typeof d.error.name === 'string' ? d.error.name : null);
          histBump(errorCodes, code);
        }
        const callTime = id !== null && callInfo.has(id) ? callInfo.get(id).time : null;
        const delta = callTime !== null && t !== null ? t - callTime : null;
        if (delta !== null && delta >= 0 && delta <= CLOCK_TOLERANCE_MS) {
          durations.push(delta);
        } else {
          durationsNull += 1;
        }
        const texts = eventTexts(ev);
        if (firstMatch(texts, PATTERNS.toolTimeout)) timeouts.toolTimeout += 1;
        if (firstMatch(texts, PATTERNS.ptcDeadline)) timeouts.ptcDeadline += 1;
        for (const tx of texts) {
          const acp = classifyAcpFailures(tx);
          timeouts.acpTransport += acp.acpTransport;
          timeouts.acpOther += acp.acpOther;
        }
        if (firstMatch(texts, PATTERNS.cancelled)) timeouts.cancelled += 1;
        break;
      }
      case 'assistant/message': {
        assistantMessages += 1;
        const m = d.message && typeof d.message === 'object' ? d.message : {};
        const src = m.source && typeof m.source === 'object' ? m.source : {};
        if (typeof src.provider === 'string' || typeof src.model === 'string') {
          histBump(observedPairHist, String(src.provider !== undefined ? src.provider : '(none)') + '\u0000' + String(src.model !== undefined ? src.model : '(none)'));
        }
        const u = d.usage && typeof d.usage === 'object' ? d.usage : null;
        if (u) {
          usageEvents += 1;
          inputTokens += toNumber(u.inputTokens) !== null ? toNumber(u.inputTokens) : 0;
          outputTokens += toNumber(u.outputTokens) !== null ? toNumber(u.outputTokens) : 0;
          cacheReadTokens += toNumber(u.cacheReadTokens) !== null ? toNumber(u.cacheReadTokens) : 0;
          cacheWriteTokens += toNumber(u.cacheWriteTokens) !== null ? toNumber(u.cacheWriteTokens) : 0;
          totalTokens += toNumber(u.totalTokens) !== null ? toNumber(u.totalTokens) : 0;
        } else {
          usageMissingEvents += 1;
        }
        break;
      }
      case 'request/header': {
        const h = d.header && typeof d.header === 'object' ? d.header : {};
        const cfg = h.config && typeof h.config === 'object' ? h.config : {};
        if (typeof cfg.provider === 'string' || typeof cfg.model === 'string') {
          histBump(headerPairHist, String(cfg.provider !== undefined ? cfg.provider : '(none)') + '\u0000' + String(cfg.model !== undefined ? cfg.model : '(none)'));
        }
        break;
      }
      default:
        break;
    }

    /* Timeout classes also surface on console/command/dispatch events. */
    if (ev.type === 'tool/ptc-dispatch' || ev.type === 'command/run' || ev.type === 'command/done') {
      const texts = eventTexts(ev);
      if (firstMatch(texts, PATTERNS.ptcDeadline)) timeouts.ptcDeadline += 1;
      for (const tx of texts) {
        const acp = classifyAcpFailures(tx);
        timeouts.acpTransport += acp.acpTransport;
        timeouts.acpOther += acp.acpOther;
      }
      if (firstMatch(texts, PATTERNS.cancelled)) timeouts.cancelled += 1;
    }

    /* Test evidence: matching tool/call arguments OR result/console text.
     * Evidence is grouped by STABLE ID (the call id; the event seq only when a
     * result has no call id), so a call and its own result count as ONE piece of
     * evidence instead of two substring occurrences. One call therefore yields at
     * most one exit-code observation. */
    if (ev.type === 'tool/call' || ev.type === 'tool/result') {
      let evidenceTexts = null;
      let evidenceKey = eventKey;
      if (ev.type === 'tool/call') {
        evidenceTexts = typeof d.arguments === 'string' ? [d.arguments] : [];
        if (typeof d.callId === 'string') evidenceKey = 'c:' + d.callId;
      } else {
        evidenceTexts = eventTexts(ev);
        const m = d.message && typeof d.message === 'object' ? d.message : {};
        const src = m.source && typeof m.source === 'object' ? m.source : {};
        const id = typeof src.callId === 'string' ? src.callId : (typeof m.toolCallId === 'string' ? m.toolCallId : null);
        if (id !== null) evidenceKey = 'c:' + id;
        if (id !== null && callInfo.has(id) && callInfo.get(id).arguments) evidenceTexts = evidenceTexts.concat([callInfo.get(id).arguments]);
      }
      if (!testEvidenceKeys.has(evidenceKey)) {
        const bucket = testEvidenceTexts.get(evidenceKey) || [];
        for (const t of evidenceTexts) {
          if (firstMatch([t], PATTERNS.testEvidence)) bucket.push(t);
        }
        testEvidenceTexts.set(evidenceKey, bucket);
      }
    }
  }

  /* Evaluate each evidence bucket once, after all of its events were seen. */
  for (const key of testEvidenceTexts.keys()) {
    const bucket = testEvidenceTexts.get(key);
    if (bucket.length === 0) continue;
    testEvidenceKeys.add(key);
    testEvidence += 1;
    const exitMatch = firstMatch(bucket, PATTERNS.exitCode);
    if (exitMatch) {
      const raw = exitMatch[1] !== undefined ? exitMatch[1] : (exitMatch[2] !== undefined ? exitMatch[2] : exitMatch[3]);
      histBump(testExitCodes, String(Number(raw)));
    } else {
      testExitCodeNull += 1;
    }
  }

  const clockSkew = outsideClockWindow > 0;
  const durationMs = !clockSkew && firstTime !== null && lastTime !== null ? lastTime - firstTime : null;

  return {
    sessionId: sessionId,
    file: meta.file !== undefined ? meta.file : null,
    workspace: workspace,
    cwd: cwd,
    agentPreset: agentPreset,
    delegationDepth: delegationDepth,
    sessionVersion: sessionVersion,
    createdAt: createdAt,
    firstEventTime: firstTime,
    lastEventTime: lastTime,
    durationMs: durationMs,
    clockSkew: clockSkew,
    eventsOutsideClockWindow: outsideClockWindow,
    eventCount: events.length,
    seqMax: seqMax,
    toolCalls: {
      topLevel: callIds.size,
      nested: subCallIds.size,
      total: callIds.size + subCallIds.size,
      duplicateCallIds: duplicateCallIds.size,
      duplicateSubCallIds: duplicateSubCallIds.size,
      byName: nameHistogram(callInfo, callIds),
    },
    toolResults: {
      total: toolResultsTotal,
      distinctIds: resultIds.size,
      unmatched: toolResultsUnmatched,
    },
    toolDurationMs: {
      samples: durations.length,
      nullSamples: durationsNull,
      avg: round(mean(durations), 2),
      p90: round(percentile90(durations), 2),
      total: durations.length ? durations.reduce((a, b) => a + b, 0) : null,
    },
    errorFlags: errorFlagIds.size,
    errorCodes: errorCodes,
    timeouts: timeouts,
    tokens: {
      usageEvents: usageEvents,
      missingUsageEvents: usageMissingEvents,
      assistantMessages: assistantMessages,
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      cacheReadTokens: cacheReadTokens,
      cacheWriteTokens: cacheWriteTokens,
      totalTokens: totalTokens,
    },
    observedModel: modalPair(observedPairHist),
    observedModelHistogram: observedPairHist,
    headerModelHistogram: headerPairHist,
    headerPairs: Object.keys(headerPairHist).map((k) => {
      const parts = k.split('\u0000');
      return { provider: parts[0], model: parts[1] };
    }),
    testEvidence: {
      count: testEvidence,
      exitCodes: testExitCodes,
      exitCodeNull: testExitCodeNull,
    },
    labels: null,
    errors: meta.errors !== undefined ? meta.errors : [],
    badLines: meta.badLines !== undefined ? meta.badLines : 0,
  };
}

function nameHistogram(callInfo, callIds) {
  const hist = {};
  for (const id of callIds) {
    const info = callInfo.get(id);
    const name = info && info.name ? info.name : '(unknown)';
    hist[name] = (hist[name] || 0) + 1;
  }
  return hist;
}

function emptyRecord(overrides) {
  return Object.assign({
    sessionId: null,
    file: null,
    workspace: null,
    cwd: null,
    agentPreset: null,
    delegationDepth: null,
    sessionVersion: null,
    createdAt: null,
    firstEventTime: null,
    lastEventTime: null,
    durationMs: null,
    clockSkew: false,
    eventsOutsideClockWindow: 0,
    eventCount: 0,
    seqMax: null,
    toolCalls: { topLevel: 0, nested: 0, total: 0, duplicateCallIds: 0, duplicateSubCallIds: 0, byName: {} },
    toolResults: { total: 0, distinctIds: 0, unmatched: 0 },
    toolDurationMs: { samples: 0, nullSamples: 0, avg: null, p90: null, total: null },
    errorFlags: 0,
    errorCodes: {},
    timeouts: { toolTimeout: 0, ptcDeadline: 0, acpTransport: 0, acpOther: 0, cancelled: 0 },
    tokens: { usageEvents: 0, missingUsageEvents: 0, assistantMessages: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 },
    observedModel: { provider: null, model: null, count: 0 },
    observedModelHistogram: {},
    headerModelHistogram: {},
    headerPairs: [],
    testEvidence: { count: 0, exitCodes: {}, exitCodeNull: 0 },
    labels: null,
    errors: [],
    badLines: 0,
  }, overrides || {});
}

/** Scan a sessions root and return { meta, records, unreadable } (one record per file). */
export function scanSessions(sessionsDir) {
  const root = resolve(sessionsDir);
  let stat = null;
  try {
    stat = statSync(root);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isDirectory()) {
    return {
      meta: { sessionsDir: root, sessionsDirExists: false, filesTotal: 0, filesReadable: 0, filesUnreadable: 0, filesWithBadLines: 0 },
      records: [],
      unreadable: [],
    };
  }
  const files = discoverSessionFiles(root);
  const records = [];
  const unreadable = [];
  let filesReadable = 0;
  let filesUnreadable = 0;
  let filesWithBadLines = 0;
  for (const file of files) {
    const rel = file.slice(root.length + 1);
    const parts = rel.split(/[\\/]/);
    const sessionDirName = parts.length >= 2 ? parts[parts.length - 2] : null;
    const workspaceDirName = parts.length >= 3 ? parts[parts.length - 3] : null;
    const parsed = readSessionEvents(file);
    if (parsed.error) {
      filesUnreadable += 1;
      unreadable.push({ file: rel, error: parsed.error });
      records.push(emptyRecord({ sessionId: sessionDirName, file: rel, workspace: workspaceDirName, errors: [parsed.error] }));
      continue;
    }
    filesReadable += 1;
    if (parsed.badLines > 0) filesWithBadLines += 1;
    const record = metricsFromEvents(parsed.events, { file: rel, workspace: workspaceDirName, badLines: parsed.badLines });
    if (!record.sessionId) record.sessionId = sessionDirName;
    record.file = rel;
    records.push(record);
  }
  return {
    meta: {
      sessionsDir: root,
      sessionsDirExists: true,
      filesTotal: files.length,
      filesReadable: filesReadable,
      filesUnreadable: filesUnreadable,
      filesWithBadLines: filesWithBadLines,
    },
    records: records,
    unreadable: unreadable,
  };
}

/* ------------------------------------------------------------------- labels */

/** Load a labels file. Unreadable/malformed labels NEVER become guesses. */
export function loadLabels(labelsPath) {
  if (!labelsPath) return { labels: {}, ok: true, reason: 'no-labels-file-provided', path: null };
  const p = resolve(labelsPath);
  let raw;
  try {
    raw = readFileSync(p, 'utf8');
  } catch (err) {
    return { labels: {}, ok: false, reason: 'labels-unreadable: ' + (err && err.code ? err.code : 'unknown'), path: p };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { labels: {}, ok: false, reason: 'labels-not-an-object', path: p };
    }
    return { labels: parsed, ok: true, reason: null, path: p };
  } catch {
    return { labels: {}, ok: false, reason: 'labels-invalid-json', path: p };
  }
}

function labelledValue(label, key) {
  if (!label || typeof label !== 'object') return null;
  const v = label[key];
  if (v === true || v === false) return v;
  return null;
}

function labelText(label, key) {
  if (!label || typeof label !== 'object') return null;
  return typeof label[key] === 'string' && label[key] ? label[key] : null;
}

export function applyLabels(records, labels) {
  for (const r of records) {
    const label = r.sessionId && labels ? labels[r.sessionId] : null;
    const has = !!label && typeof label === 'object';
    r.labels = {
      present: has,
      taskId: has ? labelText(label, 'task_id') : null,
      firstPassSuccess: has ? labelledValue(label, 'first_pass_success') : null,
      accepted: has ? labelledValue(label, 'accepted') : null,
      route: has ? labelText(label, 'route') : null,
      executor: has ? labelText(label, 'executor') : null,
      model: has ? labelText(label, 'model') : null,
      attemptIndex: has && typeof label.attempt_index === 'number' ? label.attempt_index : null,
    };
  }
  return records;
}

/* -------------------------------------------------------------------- stats */

function groupValueFor(record, key) {
  if (key === 'route') return record.labels && record.labels.route ? record.labels.route : '(unlabelled)';
  if (key === 'executor') return record.labels && record.labels.executor ? record.labels.executor : '(unlabelled)';
  if (key === 'model') {
    if (record.labels && record.labels.model) return record.labels.model;
    if (record.observedModel && record.observedModel.model) return record.observedModel.model;
    return '(unlabelled)';
  }
  return '(unknown-key)';
}

function totalTokensOf(record) {
  const t = record.tokens;
  return t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;
}

function mergeHistograms(histograms) {
  const out = {};
  for (const h of histograms) {
    for (const k of Object.keys(h || {})) out[k] = (out[k] || 0) + h[k];
  }
  return out;
}

function aggregateGroup(records) {
  const samples = records.length;
  let labelled = 0;
  let firstPassKnown = 0;
  let firstPassTrue = 0;
  let acceptedKnown = 0;
  let acceptedTrue = 0;
  for (const r of records) {
    if (!r.labels || !r.labels.present) continue;
    labelled += 1;
    if (r.labels.firstPassSuccess !== null) { firstPassKnown += 1; if (r.labels.firstPassSuccess === true) firstPassTrue += 1; }
    if (r.labels.accepted !== null) { acceptedKnown += 1; if (r.labels.accepted === true) acceptedTrue += 1; }
  }

  const durations = [];
  const toolCalls = [];
  const tokenTotals = [];
  let acpTransport = 0;
  let acpOther = 0;
  let toolTimeout = 0;
  let ptcDeadline = 0;
  let cancelled = 0;
  let errorFlags = 0;
  let toolResultsUnmatched = 0;
  let testEvidenceEvents = 0;
  let testExitCodeNull = 0;
  let usageMissingEvents = 0;
  let assistantMessages = 0;
  let totalTokensSum = 0;
  let clockSkewSessions = 0;
  const exitCodeHists = [];
  for (const r of records) {
    if (r.clockSkew) clockSkewSessions += 1;
    if (typeof r.durationMs === 'number') durations.push(r.durationMs);
    toolCalls.push(r.toolCalls.total);
    const tt = totalTokensOf(r);
    tokenTotals.push(tt);
    totalTokensSum += tt;
    acpTransport += r.timeouts.acpTransport;
    acpOther += r.timeouts.acpOther;
    toolTimeout += r.timeouts.toolTimeout;
    ptcDeadline += r.timeouts.ptcDeadline;
    cancelled += r.timeouts.cancelled;
    errorFlags += r.errorFlags;
    toolResultsUnmatched += r.toolResults.unmatched;
    testEvidenceEvents += r.testEvidence.count;
    testExitCodeNull += r.testEvidence.exitCodeNull;
    usageMissingEvents += r.tokens.missingUsageEvents;
    assistantMessages += r.tokens.assistantMessages;
    exitCodeHists.push(r.testEvidence.exitCodes);
  }

  return {
    samples: samples,
    labelledSessions: labelled,
    unlabelledSessions: samples - labelled,
    firstPassSuccessKnown: firstPassKnown,
    firstPassSuccessRate: round(rate(firstPassTrue, firstPassKnown)),
    acceptedKnown: acceptedKnown,
    acceptedRate: round(rate(acceptedTrue, acceptedKnown)),
    acpTransport: acpTransport,
    acpTransportRate: round(rate(acpTransport, samples)),
    acpOther: acpOther,
    acpOtherRate: round(rate(acpOther, samples)),
    toolTimeout: toolTimeout,
    toolTimeoutRate: round(rate(toolTimeout, samples)),
    ptcDeadline: ptcDeadline,
    ptcDeadlineRate: round(rate(ptcDeadline, samples)),
    cancelled: cancelled,
    cancelledRate: round(rate(cancelled, samples)),
    avgToolCalls: round(mean(toolCalls), 2),
    toolCallsTotal: toolCalls.reduce((a, b) => a + b, 0),
    avgDurationMs: round(mean(durations), 2),
    p90DurationMs: round(percentile90(durations), 2),
    durationSamples: durations.length,
    durationNullSessions: samples - durations.length,
    clockSkewSessions: clockSkewSessions,
    avgTokens: round(mean(tokenTotals), 2),
    totalTokens: totalTokensSum,
    usageMissingEvents: usageMissingEvents,
    assistantMessages: assistantMessages,
    errorFlags: errorFlags,
    toolResultsUnmatched: toolResultsUnmatched,
    testEvidenceEvents: testEvidenceEvents,
    testExitCodes: mergeHistograms(exitCodeHists),
    testExitCodeNull: testExitCodeNull,
    reportedCostUsd: null,
    estimatedCostUsd: null,
    costSource: 'unavailable',
    costCoveragePct: 0,
    firstPassLabelCoveragePct: round(samples ? (labelled / samples) * 100 : 0, 2),
  };
}

/** Compute grouped statistics. Rates stay null when their denominator is 0. */
export function computeStats(scan, options = {}) {
  const requested = (options.groupBy && options.groupBy.length ? options.groupBy : ['model']).filter((k) => GROUP_KEYS.indexOf(k) >= 0);
  const groupBy = requested.length ? requested : ['model'];
  const records = scan.records;

  const groups = new Map();
  for (const r of records) {
    const key = groupBy.map((k) => groupValueFor(r, k)).join(' | ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const groupList = [];
  for (const entry of groups.entries()) {
    groupList.push(Object.assign({ group: entry[0] }, aggregateGroup(entry[1])));
  }
  groupList.sort((a, b) => (b.samples - a.samples) || a.group.localeCompare(b.group));

  const totals = aggregateGroup(records);
  const labelledCount = records.filter((r) => r.labels && r.labels.present).length;

  return {
    sessionsDir: scan.meta.sessionsDir,
    groupBy: groupBy,
    labelsPath: options.labelsPath !== undefined ? options.labelsPath : null,
    labelsOk: options.labelsOk !== undefined ? options.labelsOk : true,
    labelsReason: options.labelsReason !== undefined ? options.labelsReason : null,
    sessionsScanned: records.length,
    filesTotal: scan.meta.filesTotal,
    filesReadable: scan.meta.filesReadable,
    filesUnreadable: scan.meta.filesUnreadable,
    costCoveragePct: 0,
    firstPassLabelCoveragePct: records.length ? round((labelledCount / records.length) * 100, 2) : 0,
    reportedCostUsd: null,
    estimatedCostUsd: null,
    costSource: 'unavailable',
    toolCallsTotal: totals.toolCallsTotal,
    ptcDeadlineTotal: totals.ptcDeadline,
    acpTransportTotal: totals.acpTransport,
    groups: groupList,
    totals: totals,
  };
}

/* ----------------------------------------------------------------- printing */

const HELP = [
  'metrics.mjs - read-only DSH execution-metrics extractor',
  '',
  'Usage:',
  '  node scripts/metrics.mjs scan     --sessions <dir> [--json]',
  '  node scripts/metrics.mjs stats    --sessions <dir> [--group-by route,executor,model]',
  '                                    [--labels <file.json>] [--json]',
  '  node scripts/metrics.mjs selftest',
  '  node scripts/metrics.mjs --help',
  '',
  'Commands:',
  '  scan      One mechanical record per session log found under <dir>. Read-only.',
  '  stats     Grouped aggregate over the same records. Optional human labels add',
  '            first-pass success and acceptance; without labels those are null.',
  '  selftest  Offline, deterministic fixture test. Writes only inside its own temp dir.',
  '',
  'Options:',
  '  --sessions <dir>   Root of a DSH session store, e.g. ...\\.dsh\\sessions\\--D-src-example--',
  '  --group-by <keys>  Comma list from: route, executor, model   (default: model)',
  '  --labels <file>    JSON: {"<sessionId>":{"task_id","first_pass_success","accepted",',
  '                     "route","executor","model","attempt_index"}}',
  '  --json             Machine-readable output on stdout.',
  '',
  'Never invented:',
  '  * Timeout classes are reported as SEPARATE counters - toolTimeout, ptcDeadline,',
  '    acpTransport, acpOther, cancelled. They have different root causes and are',
  '    never merged into a single "timeout" number.',
  '  * firstPassSuccess / accepted are null unless a human supplied a label.',
  '  * Exit codes are reported only when the log text literally contains one',
  '    ("exit code: 0", "[exit code: 1]", "exit=0"); otherwise null.',
  '  * Cost: reportedCostUsd and estimatedCostUsd are ALWAYS null and costSource is',
  '    always "unavailable", costCoveragePct is always 0. DSH logs expose tokens, not',
  '    money; a Cursor subscription cannot be apportioned per task, so no dollar',
  '    figure is ever emitted.',
  '',
  'Coverage: filesUnreadable counts unreadable/corrupt logs instead of throwing.',
  'Raw tool arguments and log prose are never printed - only counts.',
  '',
].join('\n');

function fmt(n) {
  return n === null || n === undefined ? 'null' : String(n);
}

function printScanHuman(scan) {
  const lines = [];
  lines.push('sessions dir      : ' + scan.meta.sessionsDir);
  lines.push('files             : total=' + scan.meta.filesTotal + ' readable=' + scan.meta.filesReadable + ' unreadable=' + scan.meta.filesUnreadable + ' badLines=' + scan.meta.filesWithBadLines);
  lines.push('sessions scanned  : ' + scan.records.length);
  lines.push('');
  lines.push('sessionId | tools(top+nested) | unmatched | errors | toolTimeout/ptcDeadline/acpTransport/acpOther/cancelled | durationMs | tokens | model');
  for (const r of scan.records) {
    lines.push([
      r.sessionId === null ? '(none)' : r.sessionId,
      r.toolCalls.total + '(' + r.toolCalls.topLevel + '+' + r.toolCalls.nested + ')',
      String(r.toolResults.unmatched),
      String(r.errorFlags),
      r.timeouts.toolTimeout + '/' + r.timeouts.ptcDeadline + '/' + r.timeouts.acpTransport + '/' + r.timeouts.acpOther + '/' + r.timeouts.cancelled,
      fmt(r.durationMs),
      String(totalTokensOf(r)),
      r.observedModel.model === null ? 'null' : r.observedModel.model,
    ].join(' | '));
  }
  lines.push('');
  lines.push('costCoveragePct   : 0 (reportedCostUsd=null estimatedCostUsd=null costSource=unavailable)');
  return lines.join('\n');
}

function printStatsHuman(stats) {
  const lines = [];
  lines.push('sessions dir      : ' + stats.sessionsDir);
  lines.push('group by          : ' + stats.groupBy.join(','));
  lines.push('labels            : ' + (stats.labelsPath === null ? '(none)' : stats.labelsPath) + ' ok=' + stats.labelsOk + (stats.labelsReason ? ' reason=' + stats.labelsReason : ''));
  lines.push('sessions scanned  : ' + stats.sessionsScanned + '  files unreadable: ' + stats.filesUnreadable);
  lines.push('firstPassLabelCoveragePct : ' + fmt(stats.firstPassLabelCoveragePct));
  lines.push('costCoveragePct   : ' + stats.costCoveragePct + ' (reportedCostUsd=null estimatedCostUsd=null costSource=unavailable)');
  lines.push('');
  for (const g of stats.groups) {
    lines.push('## ' + g.group);
    lines.push('   samples=' + g.samples + ' labelled=' + g.labelledSessions + ' unlabelled=' + g.unlabelledSessions);
    lines.push('   firstPassSuccessRate=' + fmt(g.firstPassSuccessRate) + ' (known=' + g.firstPassSuccessKnown + ') acceptedRate=' + fmt(g.acceptedRate) + ' (known=' + g.acceptedKnown + ')');
    lines.push('   acpTransportRate=' + fmt(g.acpTransportRate) + ' toolTimeoutRate=' + fmt(g.toolTimeoutRate) + ' ptcDeadlineRate=' + fmt(g.ptcDeadlineRate));
    lines.push('   avgToolCalls=' + fmt(g.avgToolCalls) + ' avgDurationMs=' + fmt(g.avgDurationMs) + ' p90DurationMs=' + fmt(g.p90DurationMs) + ' avgTokens=' + fmt(g.avgTokens));
    lines.push('   costCoveragePct=' + g.costCoveragePct + ' firstPassLabelCoveragePct=' + fmt(g.firstPassLabelCoveragePct));
  }
  return lines.join('\n');
}

/* ----------------------------------------------------------------- selftest */

const FIXTURE_HEALTHY = [
  { type: 'session', version: 4, id: 'fixture-healthy', createdAt: 1000, cwd: 'D:\\tmp\\fixture-ws', agentPreset: 'ptc-multi-agent', delegationDepth: 0 },
  { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
  { type: 'step/start', seq: 2, time: 1000, data: { turn: 1, step: 1 } },
  { type: 'request/header', seq: 3, time: 1000, data: { header: { config: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }, tools: [] } } },
  { type: 'assistant/message', seq: 4, time: 1100, data: { turn: 1, step: 1, message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'opencode-go', model: 'deepseek-v4.1-flash' }, id: 'a1' }, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 0 } } },
  { type: 'tool/call', seq: 5, time: 1200, data: { turn: 1, step: 1, callId: 'call_a', name: 'run_code', arguments: '{"code":"node scripts/verify.mjs"}' } },
  { type: 'tool/ptc-dispatch-start', seq: 6, time: 1210, data: { rootCallId: 'call_a', parentCallId: 'call_a', subCallId: 'call_a:ptc:1', name: 'read', arguments: { file_path: 'x' } } },
  { type: 'tool/ptc-dispatch', seq: 7, time: 1250, data: { rootCallId: 'call_a', parentCallId: 'call_a', subCallId: 'call_a:ptc:1', name: 'read', content: [{ type: 'text', text: 'ok' }], isError: false } },
  { type: 'tool/result', seq: 8, time: 1700, data: { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'call_a' }, toolCallId: 'call_a', content: [{ type: 'text', text: 'npm test\nverify passed\nexit code: 0' }], isError: false }, sourceEventSeqs: [5] } },
  { type: 'assistant/message', seq: 9, time: 2000, data: { turn: 1, step: 1, message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'opencode-go', model: 'deepseek-v4.1-flash' }, id: 'a2' }, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 2 } } },
  { type: 'step/end', seq: 10, time: 2000, data: { turn: 1, step: 1 } },
  { type: 'turn/end', seq: 11, time: 2000, data: { turn: 1 } },
];

const FIXTURE_FAILING = [
  { type: 'session', version: 4, id: 'fixture-failing', createdAt: 5000, cwd: 'D:\\tmp\\fixture-ws', agentPreset: 'ptc-multi-agent', delegationDepth: 0 },
  { type: 'turn/start', seq: 1, time: 5000, data: { turn: 1 } },
  { type: 'step/start', seq: 2, time: 5000, data: { turn: 1, step: 1 } },
  { type: 'request/header', seq: 3, time: 5000, data: { header: { config: { provider: 'test-relay', model: 'gpt-5.6-sol' }, tools: [] } } },
  { type: 'assistant/message', seq: 4, time: 5100, data: { turn: 1, step: 1, message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'test-relay', model: 'gpt-5.6-sol' }, id: 'b1' }, usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  { type: 'assistant/message', seq: 5, time: 5150, data: { turn: 1, step: 1, message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'test-relay', model: 'gpt-5.6-sol' }, id: 'b1-nousage' } } },
  { type: 'tool/call', seq: 6, time: 5200, data: { turn: 1, step: 1, callId: 'call_b', name: 'run_code', arguments: '{"code":"npm test"}' } },
  { type: 'tool/result', seq: 7, time: 6200, data: { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'call_b' }, toolCallId: 'call_b', content: [{ type: 'text', text: 'tool call timed out after 120000ms\nexecution deadline reached (120000ms)\nSubagent failure (provider: ACP; stage: new-session; category: transport)\nSubagent failure (provider: ACP; stage: prompt; category: provider)' }], isError: true }, error: { name: 'CodeRunFailedError', code: 'CODE_RUN_FAILED' }, sourceEventSeqs: [6] } },
  { type: 'tool/result', seq: 8, time: 6500, data: { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'call_orphan' }, toolCallId: 'call_orphan', content: [{ type: 'text', text: 'orphan result, no matching call' }], isError: false } } },
  { type: 'tool/result', seq: 9, time: 6600, data: { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'call_c' }, toolCallId: 'call_c', content: [{ type: 'text', text: 'npm test finished without an exit code marker' }], isError: false } } },
  { type: 'tool/ptc-dispatch-start', seq: 10, time: 6700, data: { rootCallId: 'call_b', parentCallId: 'call_b', subCallId: 'call_b:ptc:1', name: 'skill', arguments: { name: 'x' } } },
  { type: 'tool/ptc-dispatch-start', seq: 11, time: 6701, data: { rootCallId: 'call_b', parentCallId: 'call_b', subCallId: 'call_b:ptc:2', name: 'read', arguments: {} } },
  { type: 'tool/ptc-dispatch', seq: 12, time: 6750, data: { rootCallId: 'call_b', parentCallId: 'call_b', subCallId: 'call_b:ptc:1', name: 'skill', content: [{ type: 'text', text: 'subagent request was aborted' }], isError: true } },
  { type: 'step/end', seq: 13, time: 7000, data: { turn: 1, step: 1 } },
  { type: 'turn/end', seq: 14, time: 7000, data: { turn: 1 } },
];

const SELFTEST_LABELS = {
  'fixture-healthy': { task_id: 'T-1', first_pass_success: true, accepted: true, route: 'opencode-go/deepseek-v4.1-flash', executor: 'subagent_opencode_dsv41', model: 'deepseek-v4.1-flash', attempt_index: 1 },
  'fixture-failing': { task_id: 'T-1', first_pass_success: false, accepted: true, route: 'test-relay/gpt-5.6-sol', executor: 'subagent_codex', model: 'gpt-5.6-sol', attempt_index: 2 },
};

export function runSelftest() {
  const failures = [];
  let assertions = 0;
  const check = (label, actual, expected) => {
    assertions += 1;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push('  ' + label + ': expected ' + e + ', got ' + a);
  };

  const tmp = mkdtempSync(join(tmpdir(), 'metrics-selftest-'));
  try {
    const wsDir = join(tmp, 'ws-a');
    const writeFixture = (sessionId, events) => {
      const dir = join(wsDir, sessionId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'session.v4.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    };
    writeFixture('fixture-healthy', FIXTURE_HEALTHY);
    writeFixture('fixture-failing', FIXTURE_FAILING);
    /* An imported session whose event clocks do not line up with createdAt. */
    writeFixture('fixture-skewed', [
      { type: 'session', version: 4, id: 'fixture-skewed', createdAt: 1000, cwd: 'D:\\tmp\\fixture-ws', agentPreset: 'ptc-multi-agent', delegationDepth: 0 },
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'turn/end', seq: 2, time: 1000 + 48 * 60 * 60 * 1000, data: { turn: 1 } },
    ]);
    /* Real DSH logs place session metadata on the event root. */
    writeFixture('fixture-rootmeta', [
      { type: 'session', version: 4, id: 'fixture-rootmeta', createdAt: 9000, cwd: 'D:\\tmp\\fixture-ws', agentPreset: 'ptc-multi-agent', origin: 'subagent', isSeeded: false, delegationDepth: 2 },
      { type: 'turn/start', seq: 1, time: 9000, data: { turn: 1 } },
      { type: 'turn/end', seq: 2, time: 9500, data: { turn: 1 } },
    ]);
    const labelsPath = join(tmp, 'labels.json');
    writeFileSync(labelsPath, JSON.stringify(SELFTEST_LABELS), 'utf8');

    /* ---- scan ---- */
    const scan = scanSessions(tmp);
    check('scan.filesTotal', scan.meta.filesTotal, 4);
    check('scan.filesReadable', scan.meta.filesReadable, 4);
    check('scan.filesUnreadable', scan.meta.filesUnreadable, 0);
    check('scan.records', scan.records.length, 4);
    const skewed = scan.records.find((r) => r.sessionId === 'fixture-skewed');
    check('skewed.clockSkew', skewed.clockSkew, true);
    check('skewed.eventsOutsideClockWindow', skewed.eventsOutsideClockWindow, 1);
    /* A skewed timeline must yield null, never a made-up duration. */
    check('skewed.durationMs', skewed.durationMs, null);
    const rootMeta = scan.records.find((r) => r.sessionId === 'fixture-rootmeta');
    check('rootmeta.present', !!rootMeta, true);
    check('rootmeta.cwd', rootMeta.cwd, 'D:\\tmp\\fixture-ws');
    check('rootmeta.agentPreset', rootMeta.agentPreset, 'ptc-multi-agent');
    check('rootmeta.delegationDepth', rootMeta.delegationDepth, 2);
    check('rootmeta.sessionVersion', rootMeta.sessionVersion, 4);

    const healthy = scan.records.find((r) => r.sessionId === 'fixture-healthy');
    const failing = scan.records.find((r) => r.sessionId === 'fixture-failing');
    check('healthy.present', !!healthy, true);
    check('failing.present', !!failing, true);

    check('healthy.toolCalls.topLevel', healthy.toolCalls.topLevel, 1);
    check('healthy.toolCalls.nested', healthy.toolCalls.nested, 1);
    check('healthy.toolCalls.total', healthy.toolCalls.total, 2);
    check('healthy.toolCalls.byName', healthy.toolCalls.byName, { run_code: 1 });
    check('healthy.toolResults.total', healthy.toolResults.total, 1);
    check('healthy.toolResults.unmatched', healthy.toolResults.unmatched, 0);
    check('healthy.errorFlags', healthy.errorFlags, 0);
    check('healthy.durationMs', healthy.durationMs, 1000);
    check('healthy.toolDurationMs.samples', healthy.toolDurationMs.samples, 1);
    check('healthy.toolDurationMs.avg', healthy.toolDurationMs.avg, 500);
    check('healthy.timeouts', healthy.timeouts, { toolTimeout: 0, ptcDeadline: 0, acpTransport: 0, acpOther: 0, cancelled: 0 });
    check('healthy.tokens.inputTokens', healthy.tokens.inputTokens, 110);
    check('healthy.tokens.outputTokens', healthy.tokens.outputTokens, 25);
    check('healthy.tokens.cacheReadTokens', healthy.tokens.cacheReadTokens, 30);
    check('healthy.tokens.cacheWriteTokens', healthy.tokens.cacheWriteTokens, 2);
    check('healthy.tokens.usageEvents', healthy.tokens.usageEvents, 2);
    check('healthy.tokens.missingUsageEvents', healthy.tokens.missingUsageEvents, 0);
    check('healthy.observedModel', healthy.observedModel, { provider: 'opencode-go', model: 'deepseek-v4.1-flash', count: 2 });
    check('healthy.testEvidence.count', healthy.testEvidence.count, 1);
    check('healthy.testEvidence.exitCodes', healthy.testEvidence.exitCodes, { 0: 1 });
    check('healthy.testEvidence.exitCodeNull', healthy.testEvidence.exitCodeNull, 0);
    /* Labels are NOT invented by the scan: they are null until applyLabels runs. */
    check('healthy.labels.preLabels', healthy.labels, null);

    check('failing.toolCalls.topLevel', failing.toolCalls.topLevel, 1);
    check('failing.toolCalls.nested', failing.toolCalls.nested, 2);
    check('failing.toolCalls.total', failing.toolCalls.total, 3);
    check('failing.toolResults.total', failing.toolResults.total, 3);
    check('failing.toolResults.unmatched', failing.toolResults.unmatched, 2);
    check('failing.toolDurationMs.samples', failing.toolDurationMs.samples, 1);
    check('failing.toolDurationMs.avg', failing.toolDurationMs.avg, 1000);
    check('failing.toolDurationMs.nullSamples', failing.toolDurationMs.nullSamples, 2);
    check('failing.errorFlags', failing.errorFlags, 1);
    check('failing.errorCodes', failing.errorCodes, { CODE_RUN_FAILED: 1 });
    check('failing.timeouts.toolTimeout', failing.timeouts.toolTimeout, 1);
    check('failing.timeouts.ptcDeadline', failing.timeouts.ptcDeadline, 1);
    check('failing.timeouts.acpTransport', failing.timeouts.acpTransport, 1);
    check('failing.timeouts.acpOther', failing.timeouts.acpOther, 1);
    check('failing.timeouts.cancelled', failing.timeouts.cancelled, 1);
    check('failing.tokens.usageEvents', failing.tokens.usageEvents, 1);
    check('failing.tokens.missingUsageEvents', failing.tokens.missingUsageEvents, 1);
    check('failing.tokens.inputTokens', failing.tokens.inputTokens, 1000);
    check('failing.durationMs', failing.durationMs, 2000);
    check('failing.testEvidence.count', failing.testEvidence.count, 2);
    check('failing.testEvidence.exitCodes', failing.testEvidence.exitCodes, {});
    check('failing.testEvidence.exitCodeNull', failing.testEvidence.exitCodeNull, 2);

    /* ---- labels + stats by executor ---- */
    const labels = loadLabels(labelsPath);
    check('labels.ok', labels.ok, true);
    applyLabels(scan.records, labels.labels);
    check('healthy.labels.firstPassSuccess.after', healthy.labels.firstPassSuccess, true);
    check('failing.labels.accepted.after', failing.labels.accepted, true);

    const stats = computeStats(scan, { groupBy: ['executor'], labelsPath: labelsPath, labelsOk: labels.ok, labelsReason: labels.reason });
    check('stats.groupBy', stats.groupBy, ['executor']);
    check('stats.sessionsScanned', stats.sessionsScanned, 4);
    check('stats.firstPassLabelCoveragePct', stats.firstPassLabelCoveragePct, 50);
    check('stats.costCoveragePct', stats.costCoveragePct, 0);
    check('stats.reportedCostUsd', stats.reportedCostUsd, null);
    check('stats.estimatedCostUsd', stats.estimatedCostUsd, null);
    check('stats.costSource', stats.costSource, 'unavailable');
    check('stats.groups.length', stats.groups.length, 3);
    check('stats.totals.clockSkewSessions', stats.totals.clockSkewSessions, 1);
    const gCodex = stats.groups.find((g) => g.group === 'subagent_codex');
    const gOpen = stats.groups.find((g) => g.group === 'subagent_opencode_dsv41');
    check('group.codex.samples', gCodex.samples, 1);
    check('group.codex.firstPassSuccessRate', gCodex.firstPassSuccessRate, 0);
    check('group.codex.acpTransportRate', gCodex.acpTransportRate, 1);
    check('group.codex.toolTimeoutRate', gCodex.toolTimeoutRate, 1);
    check('group.codex.ptcDeadlineRate', gCodex.ptcDeadlineRate, 1);
    check('group.codex.avgToolCalls', gCodex.avgToolCalls, 3);
    check('group.codex.avgDurationMs', gCodex.avgDurationMs, 2000);
    check('group.codex.p90DurationMs', gCodex.p90DurationMs, 2000);
    check('group.codex.avgTokens', gCodex.avgTokens, 1100);
    check('group.codex.costCoveragePct', gCodex.costCoveragePct, 0);
    check('group.codex.firstPassLabelCoveragePct', gCodex.firstPassLabelCoveragePct, 100);
    check('group.open.samples', gOpen.samples, 1);
    check('group.open.firstPassSuccessRate', gOpen.firstPassSuccessRate, 1);
    check('group.open.acpTransportRate', gOpen.acpTransportRate, 0);
    check('group.open.avgToolCalls', gOpen.avgToolCalls, 2);
    check('group.open.avgTokens', gOpen.avgTokens, 167);

    /* ---- unlabelled run: label-derived rates must be null, never 0 ---- */
    const scan2 = scanSessions(tmp);
    const statsNoLabels = computeStats(scan2, { groupBy: ['executor'] });
    check('nolabels.firstPassLabelCoveragePct', statsNoLabels.firstPassLabelCoveragePct, 0);
    check('nolabels.groups.length', statsNoLabels.groups.length, 1);
    check('nolabels.group.key', statsNoLabels.groups[0].group, '(unlabelled)');
    check('nolabels.samples', statsNoLabels.groups[0].samples, 4);
    check('nolabels.firstPassSuccessRate', statsNoLabels.groups[0].firstPassSuccessRate, null);
    check('nolabels.acceptedRate', statsNoLabels.groups[0].acceptedRate, null);
    const gUnlabelled = statsNoLabels.groups.find((g) => g.group === '(unlabelled)');
    check('nolabels.single.group', statsNoLabels.groups.length, 1);
    check('nolabels.unlabelled.samples', gUnlabelled.samples, 4);
    check('nolabels.unlabelled.avgDurationMs', gUnlabelled.avgDurationMs, 1166.67);
    check('nolabels.unlabelled.durationNullSessions', gUnlabelled.durationNullSessions, 1);
    check('nolabels.unlabelled.avgToolCalls', gUnlabelled.avgToolCalls, 1.25);
    check('nolabels.unlabelled.firstPassSuccessRate', gUnlabelled.firstPassSuccessRate, null);
    check('nolabels.p90DurationMs', statsNoLabels.groups[0].p90DurationMs, 2000);
    check('nolabels.unlabelled.acpTransportRate', gUnlabelled.acpTransportRate, 0.25);

    /* ---- group by model uses the observed provider/model when unlabelled ---- */
    const statsByModel = computeStats(scan2, { groupBy: ['model'] });
    check('bymodel.groups', statsByModel.groups.map((g) => g.group).sort(), ['(unlabelled)', 'deepseek-v4.1-flash', 'gpt-5.6-sol']);

    /* ---- rate()/percentile never turn an empty denominator into 0 ---- */
    check('rate.empty', rate(0, 0), null);
    check('rate.normal', rate(1, 4), 0.25);
    check('percentile90.empty', percentile90([]), null);
    check('percentile90.ten', percentile90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);

    /* ---- unreadable file is counted, never thrown ---- */
    const corruptDir = join(tmp, 'ws-corrupt', 'fixture-corrupt');
    mkdirSync(corruptDir, { recursive: true });
    writeFileSync(join(corruptDir, 'session.v4.jsonl.zstd'), Buffer.from('not a zstd frame'), 'utf8');
    const scan3 = scanSessions(tmp);
    check('corrupt.filesUnreadable', scan3.meta.filesUnreadable, 1);
    check('corrupt.records', scan3.records.length, 5);
    check('corrupt.record.flagged', scan3.records.filter((r) => r.errors.length > 0).length, 1);
  } catch (err) {
    failures.push('  unexpected exception: ' + (err && err.stack ? err.stack : String(err)));
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  if (failures.length > 0) {
    process.stdout.write('selftest: FAILED\n' + failures.join('\n') + '\n(' + assertions + ' assertions, ' + failures.length + ' failed)\n');
    return false;
  }
  process.stdout.write('selftest: OK (' + assertions + ' assertions)\n');
  return true;
}

/* -------------------------------------------------------------------- CLI */

function parseArgs(argv) {
  const out = { command: null, sessions: null, json: false, groupBy: null, labels: null, help: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--json') out.json = true;
    else if (a === '--sessions') { out.sessions = argv[i + 1]; i += 1; }
    else if (a.indexOf('--sessions=') === 0) out.sessions = a.slice('--sessions='.length);
    else if (a === '--group-by') { out.groupBy = argv[i + 1]; i += 1; }
    else if (a.indexOf('--group-by=') === 0) out.groupBy = a.slice('--group-by='.length);
    else if (a === '--labels') { out.labels = argv[i + 1]; i += 1; }
    else if (a.indexOf('--labels=') === 0) out.labels = a.slice('--labels='.length);
    else rest.push(a);
  }
  if (!out.command && rest.length > 0) out.command = rest[0];
  return out;
}

export function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!args.command) {
    process.stdout.write(HELP);
    return 1;
  }
  if (args.command === 'selftest') {
    return runSelftest() ? 0 : 1;
  }
  if (args.command !== 'scan' && args.command !== 'stats') {
    process.stderr.write('metrics.mjs: unknown command "' + args.command + '"\n\n' + HELP);
    return 1;
  }
  if (!args.sessions) {
    process.stderr.write('metrics.mjs: --sessions <dir> is required\n');
    return 1;
  }

  const scan = scanSessions(args.sessions);

  if (args.command === 'scan') {
    if (args.json) {
      process.stdout.write(JSON.stringify({
        command: 'scan',
        sessionsDir: scan.meta.sessionsDir,
        sessionsDirExists: scan.meta.sessionsDirExists,
        filesTotal: scan.meta.filesTotal,
        filesReadable: scan.meta.filesReadable,
        filesUnreadable: scan.meta.filesUnreadable,
        filesWithBadLines: scan.meta.filesWithBadLines,
        sessionsScanned: scan.records.length,
        costCoveragePct: 0,
        reportedCostUsd: null,
        estimatedCostUsd: null,
        costSource: 'unavailable',
        sessions: scan.records,
      }, null, 2) + '\n');
    } else {
      process.stdout.write(printScanHuman(scan) + '\n');
    }
    return 0;
  }

  const labels = loadLabels(args.labels);
  applyLabels(scan.records, labels.labels);
  const groupBy = args.groupBy ? args.groupBy.split(',').map((s) => s.trim()).filter(Boolean) : ['model'];
  const stats = computeStats(scan, { groupBy: groupBy, labelsPath: labels.path, labelsOk: labels.ok, labelsReason: labels.reason });

  if (args.json) {
    process.stdout.write(JSON.stringify(Object.assign({ command: 'stats' }, stats), null, 2) + '\n');
  } else {
    if (!labels.ok) process.stderr.write('metrics.mjs: labels unavailable (' + labels.reason + '); label-derived values are null\n');
    process.stdout.write(printStatsHuman(stats) + '\n');
  }
  return 0;
}

let invokedDirectly = false;
try {
  invokedDirectly = !!process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
} catch {
  invokedDirectly = false;
}

if (invokedDirectly) {
  process.exitCode = main();
}



