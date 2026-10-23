from pathlib import Path
import hashlib,json,re,shutil
src=Path(r'C:/Workspace/Tools/agent-box')
run=src/'runs/rakunloots'
dst=Path('docs/rewrite/evidence/phase9-review-fixes')
dst.mkdir(parents=True,exist_ok=True)
files={
 'red-folia-ownership.txt':run/'p9-fix-shutdown-red.log',
 'red-wiki-close.txt':run/'p9-fix-sessions-red.log',
 'red-superseded-open.txt':run/'p9-review-fixes-id6-red.log',
 'host-check.txt':run/'p9-review-fixes-final-host-check.log',
 'host-counts.json':run/'p9-review-fixes-final-host-counts.json',
 'probe-folia.txt':run/'p9-review-fixes-probe-folia-final.log',
 'probe-paper.txt':run/'p9-review-fixes-probe-paper-final.log',
 'probe-spigot.txt':run/'p9-review-fixes-probe-spigot-final.log',
 'server-audit.json':run/'p9-review-fixes-final-server-audit.json',
 'shutdown-old-jar.json':run/'p9-folia-shutdown-red-result.json',
 'shutdown-final-jar.jsonl':run/'p9-folia-shutdown-green-result.jsonl',
 'shutdown-final-stop.txt':run/'p9-folia-shutdown-green-stop.log',
 'reviewer-final.txt':run/'p9-review-fixes-review-r2/final.md',
 'folia-test-runtime.gradle':src/'tasks-rakunloots-folia-test-runtime.gradle',
 'folia-shutdown-probe.cjs':src/'tasks-p9-folia-shutdown-bot.cjs',
}
for name,path in files.items():
    data=path.read_bytes()
    # Check selected recorded outputs, not the unrelated environment/config files.
    text=data.decode('utf-8-sig')
    assert not re.search(r'(?i)(?:authorization\s*:\s*bearer\s+\S+|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|(?:api[_-]?key|password)\s*[=:]\s*[\"\']?[^\s\"\']{8,})',text), name
    shutil.copyfile(path,dst/name)
classes={
 'test':['menu.Phase9MenuRetirementTest','menu.Phase9SupersededRetirementProofTest','menu.Phase9SupersededRetirementRaceTest','wiki.Phase9WikiSessionCloseProofTest','wiki.Phase9WikiSessionRetirementTest'],
 'foliaTest':['server.Phase9FoliaShutdownOwnershipProofTest','server.Phase9FoliaMenuCloseOwnershipTest']
}
(dst/'junit').mkdir(exist_ok=True)
for suite,names in classes.items():
    for name in names:
        filename=f'TEST-me.rakkoon69.rakunloots.{name}.xml'
        shutil.copyfile(Path('build/test-results')/suite/filename,dst/'junit'/filename)
summary=json.loads((run/'p9-review-fixes-review-r2/summary.json').read_text())
keys=['head','start','model','seconds','phase_seconds','agent_exit','review_violation','findings','findings_unreadable','report_asked','final_recovered','blocked','flags']
(dst/'reviewer-status.json').write_text(json.dumps({k:summary[k] for k in keys},indent=2)+'\n')
manifest={str(p.relative_to(dst)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(dst.rglob('*')) if p.is_file() and p.name!='manifest.json'}
(dst/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'{len(manifest)} evidence files copied; {sum(p.stat().st_size for p in dst.rglob("*") if p.is_file())} bytes including manifest')
