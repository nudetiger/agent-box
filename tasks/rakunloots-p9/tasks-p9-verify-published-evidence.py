import subprocess,json,hashlib,base64
from pathlib import Path
head='74b431f4e41a677cc6044310a92a48f03af53a53'
def api(route): return json.loads(subprocess.check_output(['gh','api','repos/nudetiger/RakunLoots/'+route]))
pr=json.loads(subprocess.check_output(['gh','pr','view','115','--json','body,headRefOid,state,url']))
expected=Path(r'C:/Workspace/Tools/agent-box/tasks-p9-evidence-pr-body.md').read_text(encoding='utf-8').replace('\r\n','\n').strip()
assert pr['body'].replace('\r\n','\n').strip()==expected,'published body differs'
assert '\ufffd' not in pr['body'],'replacement character in body'
assert pr['headRefOid']==head and pr['state']=='OPEN'
root=Path('docs/rewrite/evidence/phase9-review-fixes')
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
tree=api('git/trees/'+head+'?recursive=1')
assert not tree.get('truncated')
blobs={item['path']:item['sha'] for item in tree['tree'] if item['type']=='blob'}
for name,digest in manifest.items():
    path=root/name
    data=path.read_bytes()
    assert hashlib.sha256(data).hexdigest()==digest
    gitsha=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\x00'+data).hexdigest()
    assert blobs[path.as_posix()]==gitsha,path
meta=api('contents/'+(root/'README.md').as_posix()+'?ref='+head)
readme=base64.b64decode(meta['content']).decode('utf-8')
assert 'O(n\u00b2 + g*n)' in readme and '\ufffd' not in readme
print(json.dumps({'url':pr['url'],'head':head,'state':pr['state'],'published_evidence_blobs_verified':len(manifest),'pr_body_roundtrip':'matches UTF-8 source','published_guide_utf8':'verified'}))
