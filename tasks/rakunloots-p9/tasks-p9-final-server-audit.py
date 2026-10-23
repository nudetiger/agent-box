from pathlib import Path
import hashlib,json,re
box=Path(r'C:/Workspace/Tools/agent-box/runs/rakunloots')
probe=Path(r'C:/Workspace/Projects/MinecraftPlugins/RakunProbe/servers')
expected='9032E7906D9509616D9824CF7E060483416A714B254E507A43EEFE042BB0558B'
out={}
for server in ['folia','paper','spigot']:
    text=(box/f'p9-review-fixes-probe-{server}-final.log').read_text(encoding='utf-8',errors='replace')
    footer=re.findall(rf'^== {server}-26\.2: (\d+) passed, (\d+) failed$',text,re.M)
    failures=re.findall(r'^FAIL .*$',text,re.M)
    bad=[s for s in text.splitlines() if re.search(r'(?:WARN|ERROR)\]: \[RakunLoots\]',s) or re.search(r'\[\S+/\s*(?:WARN|ERROR)\]: \[RakunLoots\]',s)]
    installed=probe/f'{server}-26.2/plugins/RakunLoots.jar'
    sha=hashlib.sha256(installed.read_bytes()).hexdigest().upper()
    out[server]=dict(footer=footer,failures=failures,plugin_warn_errors=bad,jar_sha256=sha)
    assert footer==[('58','0')],(server,footer)
    assert not failures and not bad,(server,failures,bad)
    assert sha==expected,(server,sha)
packets=[json.loads(s) for s in (box/'p9-folia-shutdown-green-result.jsonl').read_text().splitlines() if s.startswith('{')]
result=next(p for p in packets if p['kind']=='result')
assert result['pass'] and result['closePacketBeforeDisconnect'],result
out['shutdown']=result
out['total_passed']=174
(box/'p9-review-fixes-final-server-audit.json').write_text(json.dumps(out,indent=2))
print(json.dumps(out,indent=2))
