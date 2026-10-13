import json, tomllib, sys
from pathlib import Path
ok = []
# 1. kimi config.toml: TOML 可解析、hooks 已清空、模型/provider 完整
kimi = tomllib.loads(Path(r'C:\Users\wwm_1\.kimi-code\config.toml').read_text(encoding='utf-8'))
hooks = kimi.get('hooks', [])
model = kimi.get('models', {}).get('kimi-code/k3-256k', {})
ok.append(('kimi config.toml TOML 解析', True))
ok.append(('kimi hooks 已清空', hooks == []))
ok.append(('kimi k3-256k 模型配置完整', model.get('max_context_size') == 262144 and 'kimi-code/k3' in str(kimi.get('models', {}).keys())))
# 2. cursor cli-config.json: JSON 可解析、HTTP1 开启
cfg = json.loads(Path(r'C:\Users\wwm_1\.cursor\cli-config.json').read_text(encoding='utf-8'))
ok.append(('cursor cli-config.json JSON 解析', True))
ok.append(('cursor useHttp1ForAgent=true', cfg.get('network', {}).get('useHttp1ForAgent') is True))
# 3. SKILL.md: frontmatter 完整、版本 0.9.0、调度规则章节存在
text = Path(r'C:\Users\wwm_1\.agents\skills\ptc-multi-agent-control\SKILL.md').read_text(encoding='utf-8')
fm = text.split('---')[1]
ok.append(('SKILL.md frontmatter 存在', text.startswith('---')))
ok.append(('version=0.9.0', 'version: 0.9.0' in fm))
ok.append(('updated=2026-10-13', 'updated: 2026-10-13' in fm))
ok.append(('origin/author/created/managed-by 齐全', all(k in fm for k in ['origin: self','author: wang','created: 2026-10-12','managed-by: skillhub'])))
ok.append(('调度规则章节存在', '子代理调度规则' in text and '等待时间按任务动态评估' in text and '可见输出通道' in text))
# 4. 云载荷一致
import hashlib
h = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
ok.append(('cloud-sync 载荷与源一致', h(r'C:\Users\wwm_1\.agents\skills\ptc-multi-agent-control\SKILL.md') == h(r'D:\nutstore\Skill+Tool\skillhub-cloud-sync\payload\skills\ptc-multi-agent-control\SKILL.md')))
for name, passed in ok:
    print(('PASS' if passed else 'FAIL'), name)
sys.exit(0 if all(p for _, p in ok) else 1)