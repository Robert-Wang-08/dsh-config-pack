import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {officialModelProblems,installConfigProblems} from './model-config.mjs';
const text=readFileSync(new URL('../cordis.patch.yml',import.meta.url),'utf8');
assert.deepEqual(officialModelProblems(text),[]);
for (const id of ['deepseek-v4.1-flash','glm-5.3-flash','qwen3.8-max','grok-4.7']) assert.match(text, new RegExp('opencode-go:[\\s\\S]*- id: '+id));
for (const id of ['kimi-k2.7-code','kimi-k2.7-code-highspeed','kimi-k2.6','k3.1-pro']) assert.match(text, new RegExp('kimi-coding:[\\s\\S]*- id: '+id));
const old=text.replace(/      openai-codex:[\s\S]*?(?=      kimi-coding:)/,'      openai-codex:\n        displayName: official\n');
assert.ok(old.includes('id: gpt-6.1-sol'));
assert.ok(officialModelProblems(old).length);
const dump={code:0,out:text,err:''}, composed={code:0,dangling:0};
assert.deepEqual(installConfigProblems({code:0},dump,composed),[]);
for (const args of [
  [{code:1},dump,composed],
  [{code:0},{...dump,code:1},composed],
  [{code:0},{...dump,err:'1 entry did not activate'},composed],
  [{code:0},{...dump,err:'patch: entry "x" not found'},composed],
  [{code:0},dump,{code:1,dangling:0}],
  [{code:0},{...dump,out:old},composed]
]) assert.ok(installConfigProblems(...args).length);
console.log('PASS: model portability; shadowing, dump, activation and composed errors block acceptance');
