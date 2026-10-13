from pathlib import Path
skill = Path(r'C:\Users\wwm_1\.agents\skills\ptc-multi-agent-control\SKILL.md')
sec = Path(r'D:\src\ncbs\.ptc\ptc_scheduling_rules_section.md').read_text(encoding='utf-8')
text = skill.read_text(encoding='utf-8')
anchor = '判定依据用上面的自检脚本复核，不要只凭错误文本。'
assert text.count(anchor) == 1, 'anchor not unique'
skill.write_text(text.replace(anchor, anchor + sec), encoding='utf-8')
print('inserted, new size:', skill.stat().st_size)