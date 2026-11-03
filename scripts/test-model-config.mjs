import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {officialModelProblems,selectionProblems,installConfigProblems} from './model-config.mjs';
const text=readFileSync(new URL('../cordis.patch.yml',import.meta.url),'utf8');
assert.deepEqual(officialModelProblems(text),[]);
assert.deepEqual(selectionProblems(text),[]);
for (const id of ['deepseek-v4.1-flash','glm-5.3-flash','qwen3.8-max','grok-4.7']) assert.match(text, new RegExp('opencode-go:[\\s\\S]*- id: '+id));
for (const id of ['kimi-k2.7-code','kimi-k2.7-code-highspeed','kimi-k2.6','k3.1-pro']) assert.match(text, new RegExp('kimi-coding:[\\s\\S]*- id: '+id));
const old=text.replace(/      openai-codex:[\s\S]*?(?=      kimi-coding:)/,'      openai-codex:\n        displayName: official\n');
assert.ok(old.includes('id: gpt-6.1-sol'));
assert.ok(officialModelProblems(old).length);
// regression 2026-10-30: an `off` level on gpt-6.1-sol dispatches reasoning.effort="none" -> 400
const off=text.replace(/(openai-codex:[\s\S]*?reasoningEfforts: )\{/, '$1{ off: null,');
assert.match(off, /reasoningEfforts: \{ off: null/);
assert.ok(officialModelProblems(off).length);
// regression 2026-10-30: a repeated exact route fails every new Session at composition
const dup=text.replace(
  /(      - provider: openai-codex\n        model: gpt-6\.1-sol\n)/,
  '$1      - provider: openai-codex\n        model: gpt-6.1-sol\n'
);
assert.notEqual(dup,text);
assert.deepEqual(selectionProblems(dup),[
  'subagent-model-selection-settings.allowedModels repeats route "openai-codex/gpt-6.1-sol" — the Host rejects the policy and every new Session fails to compose; keep one entry per exact route'
]);
const dump={code:0,out:text,err:''}, composed={code:0,dangling:0};
assert.deepEqual(installConfigProblems({code:0},dump,composed),[]);
for (const args of [
  [{code:1},dump,composed],
  [{code:0},{...dump,code:1},composed],
  [{code:0},{...dump,err:'1 entry did not activate'},composed],
  [{code:0},{...dump,err:'patch: entry "x" not found'},composed],
  [{code:0},dump,{code:1,dangling:0}],
  [{code:0},{...dump,out:old},composed],
  [{code:0},{...dump,out:off},composed],
  [{code:0},{...dump,out:dup},composed]
]) assert.ok(installConfigProblems(...args).length);
console.log('PASS: model portability (off level, duplicate selection route); shadowing, dump, activation and composed errors block acceptance');
