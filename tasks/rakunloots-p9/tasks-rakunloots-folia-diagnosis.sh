MSYS_NO_PATHCONV=1 podman exec -i agent-box-rakunloots-p9-107-complete python3 - <<'PY'
import glob,xml.etree.ElementTree as ET,hashlib,os
for f in glob.glob('/work/repo/build/test-results/foliaTest/TEST-*.xml'):
    r=ET.parse(f).getroot()
    if int(r.get('failures','0')):
        fail=r.find('.//failure')
        print('FOLIA_BASELINE_EXCEPTION',r.get('name'),fail.get('message'))
        text=fail.text or ''
        print(text[:1200]); print(text[-1600:]); break
for f in glob.glob('/home/node/.gradle/caches/modules-2/files-2.1/dev.folia/folia-api/1.20.1-R0.1-SNAPSHOT/*/*.jar'):
    print('FOLIA_JAR',os.path.basename(f),hashlib.sha256(open(f,'rb').read()).hexdigest())
PY