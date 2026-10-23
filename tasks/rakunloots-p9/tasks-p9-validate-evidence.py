from pathlib import Path
import hashlib,json,re,xml.etree.ElementTree as ET
p=Path('docs/rewrite/evidence/phase9-review-fixes')
manifest=json.loads((p/'manifest.json').read_text())
for name,digest in manifest.items():
    assert hashlib.sha256((p/name).read_bytes()).hexdigest()==digest,name
    text=(p/name).read_text(encoding='utf-8-sig')
    assert not re.search(r'(?i)(?:authorization\s*:\s*bearer\s+\S+|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|(?:api[_-]?key|password)\s*[=:]\s*[\"\']?[^\s\"\']{8,})',text),name
for target in re.findall(r'\]\(([^)]+)\)',(p/'README.md').read_text()):
    if target.startswith(('http','https','#')): continue
    assert (p/target.split('#')[0]).resolve().exists(),target
for f in (p/'junit').glob('*.xml'):
    root=ET.parse(f).getroot()
    assert int(root.get('failures','0'))==0 and int(root.get('errors','0'))==0,f
print(f'Validated {len(manifest)} evidence hashes, all README source/artifact links, XML results and selected-file credential scan.')
