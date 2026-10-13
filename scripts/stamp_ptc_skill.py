from pathlib import Path
p = Path(r'C:\Users\wwm_1\.agents\skills\ptc-multi-agent-control\SKILL.md')
text = p.read_text(encoding='utf-8')
old_ver = 'version: 0.8.1'
new_ver = 'version: 0.9.0'
assert text.count(old_ver) == 1
text = text.replace(old_ver, new_ver)
old_cl = 'changelog: "0.8.0：'
new_cl = 'changelog: "0.9.0：新增「子代理调度规则」章节（2026-10-13 超时根因诊断修正）：禁止 ACP 子代理调用包在 run_code 内、长跑一律后台、等待时长按任务规模动态评估不设默认值、运行期以 ACP 会话日志为强制可见输出通道、大文档任务分批 5-10 项、ACP 降级链由主控显式执行；固化环境修正（cursor useHttp1ForAgent=true 禁 HTTP/2、kimi Orca hooks 已删除）。0.8.0：'
assert text.count(old_cl) == 1
text = text.replace(old_cl, new_cl)
p.write_text(text, encoding='utf-8')
print('stamped 0.9.0')