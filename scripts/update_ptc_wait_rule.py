from pathlib import Path
p = Path(r'C:\Users\wwm_1\.agents\skills\ptc-multi-agent-control\SKILL.md')
text = p.read_text(encoding='utf-8')
old = '''**给足 ACP 预算再干预。** ACP 子代理的设计预算是绝对超时 30 分钟（absoluteTimeoutMs 1800s）；k3-256k thinking=high 每轮 5–60 秒，大文档梳理需要数十轮，10–30 分钟是正常时长。后台运行期间 job_output 的 text 恒为空是可见性假象，不是死锁——判断健康与否直接 tail 子代理日志（如 ~/.kimi-code/sessions/*/logs/kimi-code.log，llm response 行持续增长即正常），30 分钟内不得凭空输出误杀 job。'''
new = '''**等待时间按任务动态评估，不设默认时长。** ACP 子代理的硬上限是绝对超时 30 分钟（absoluteTimeoutMs 1800s），但主控不得拿它当默认等待值：派发前先按任务规模估算合理窗口（如 5–10 项一批的文档梳理约 5–15 分钟；k3-256k thinking=high 每轮 LLM 5–60 秒，按预计轮数折算），到窗口下限前先查进度，超过预估上限且日志无推进才判异常。

**子代理运行期间必须有可见输出通道，凭输出判断而非凭等待判断。** 后台运行期间 job_output 的 text 恒为空是可见性假象，不得作为死活依据。派发后立即定位并持续观察子代理的实时日志（如 kimi：tail ~/.kimi-code/sessions/*/logs/kimi-code.log，llm response 行持续增长即健康；opencode/cursor 同理用各自 ACP 会话日志），进度判断一律以日志推进为准；日志停滯超过两个 LLM 轮次时长才允许考虑干预。'''
assert text.count(old) == 1, 'old not found'
p.write_text(text.replace(old, new), encoding='utf-8')
print('ok')