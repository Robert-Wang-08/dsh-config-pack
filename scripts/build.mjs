#!/usr/bin/env node
// Assemble cordis.patch.yml from config/*.yml.
//
// Why plain concatenation instead of a YAML library: the patch format uses the
// custom tag "!!js", which ordinary YAML emitters either reject or re-quote into
// something DSH no longer evaluates. The fragments are already hand-written YAML
// with the correct indentation, so byte-level assembly is both simpler and safer.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configDir = join(root, 'config');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const files = readdirSync(configDir).filter((f) => f.endsWith('.yml')).sort();

if (files.length === 0) {
  console.error('build: config/ has no .yml fragments');
  process.exit(1);
}

const parts = files.map((f) => {
  const text = readFileSync(join(configDir, f), 'utf8').replace(/[\r\n]+$/, '');
  return `# ═══ config/${f} ${'═'.repeat(Math.max(0, 56 - f.length))}
${text}`;
});

const header = `# dsh-config-pack v${pkg.version} — GENERATED FILE, DO NOT EDIT.
#
# Source of truth: config/*.yml   Rebuild with: npm run build
# Verify before publishing:       npm run verify
#
# 本文件是 DSH 的 profile patch 补丁层，由本包作为 bundle 提供。
# 补丁语义（见 @deepseek-ai/dsh-base）：
#   - 顶层 ${'\u0060'}- id: X${'\u0060'} + config 会**整体替换** X 行的 config，不是合并；
#   - ${'\u0060'}- insert:${'\u0060'} 追加新行；
#   - 后续组合包层与用户的 profile cordis.patch.yml 按 id 覆盖，**最后一次写入生效**；
#   - 因此用户 profile 里若还留着同 id 的内联块，本文件对那一行就是死码。
#
# !!js 表达式写法约束（YAML 硬约束，不是风格问题）：
#   - 写成不含「冒号加空格」的普通标量；
#   - 不要以引号 / { / [ / ! 开头；
#   - 否则块状上下文会把它当成映射键或标签解析。

`;

writeFileSync(join(root, 'cordis.patch.yml'), header + parts.join('\n\n') + '\n', 'utf8');
console.log(`build: wrote cordis.patch.yml from ${files.length} fragment(s): ${files.join(', ')}`);
