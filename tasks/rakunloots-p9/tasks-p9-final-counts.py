from pathlib import Path
import xml.etree.ElementTree as ET
import json
root=Path(r'C:/Workspace/Projects/MinecraftPlugins/RakunLoots')
def counts(path):
    result=dict(tests=0,failures=0,errors=0,skipped=0)
    for file in path.glob('TEST-*.xml'):
        s=ET.parse(file).getroot()
        for key in result: result[key]+=int(s.attrib.get(key,0))
    return result
out={name:counts(root/'build/test-results'/name) for name in ('test','foliaTest','fancyTest','java17Test')}
out['adapters']={p.name:counts(p/'build/test-results/test') for p in (root/'packet-adapters').iterdir() if p.is_dir() and p.name.startswith('v')}
print(json.dumps(out,indent=2))
Path(r'C:/Workspace/Tools/agent-box/runs/rakunloots/p9-review-fixes-final-host-counts.json').write_text(json.dumps(out,indent=2))
