from pathlib import Path
import shutil,hashlib,json
src=Path(r'C:/Workspace/Tools/agent-box/runs/rakunloots/phase9-large-chance-host')
dst=Path('docs/rewrite/evidence/phase9-review-fixes')
(dst/'math').mkdir(exist_ok=True)
for name in ['positive_transition_reference.py','positive-transition-reference.txt','ProbePositiveReference.java','positive-reference-dc6-green.log','first-draw-dc6-green.log']:
    target=name.replace('.log','.txt')
    shutil.copyfile(src/name,dst/'math'/target)
for name in ['roll.LootChanceLargeGroupAccuracyTest','roll.LootChanceTest','config.RawRollExtremeChanceTest']:
    filename=f'TEST-me.rakkoon69.rakunloots.{name}.xml'
    shutil.copyfile(Path('build/test-results/test')/filename,dst/'junit'/filename)
with (dst/'.gitattributes').open('a') as out: out.write('*.py -text\n*.java -text\n')
p=dst/'README.md'
s=p.read_text()
section='''## Numerical evidence already claimed by this phase

The [independent Decimal70/100 positive-transition reference](math/positive_transition_reference.py) and [recorded reference values](math/positive-transition-reference.txt) are now included so a reviewer can derive the 250-light/250-heavy,250-draw constants used by [LootChanceLargeGroupAccuracyTest](../../../../src/test/java/me/rakkoon69/rakunloots/roll/LootChanceLargeGroupAccuracyTest.java). The reference uses remaining-count transition probabilities rather than the production quadrature. Its final output-file path is machine-specific; adjust/remove that output-file write when running elsewhere, retaining the calculation and precision checks.

The [standalone comparison source](math/ProbePositiveReference.java), [500-entry comparison result](math/positive-reference-dc6-green.txt) and [10,000-entry first-draw result](math/first-draw-dc6-green.txt) are **historical numerical runs at `dc6ec63`**, not newly executed on the final jar. Recorded max errors were5.93e-14 and1.74e-10 respectively. Current final-host XMLs for [large-group accuracy](junit/TEST-me.rakkoon69.rakunloots.roll.LootChanceLargeGroupAccuracyTest.xml), [raw extreme ranges](junit/TEST-me.rakkoon69.rakunloots.config.RawRollExtremeChanceTest.xml) and [the original50ms fixture](junit/TEST-me.rakkoon69.rakunloots.roll.LootChanceTest.xml) are also included.

The owner-approved cost correction in [ADR0018](../../../../docs/adr/0018-loot-chance.md) must be reviewed with the implementation: stable-direction removal has at most `O(n² + g*n)` cost per quadrature point, with grid-dependent total work. The50ms assertion covers100 distinct entries/max50 after three warm-ups; it is not a50ms guarantee for all input sizes. The independent larger cases above took hundreds of milliseconds. The [verification record](../../phase9-verification.md#math-decision-and-independent-accuracy-checks-107) links the approved ruling and remaining derivation details.

'''
# Resolve the real ADR filename rather than inventing a source link.
adr=next(Path('docs/adr').glob('0018*')).name
section=section.replace('0018-loot-chance.md',adr)
for x,y in [('250-heavy,250','250-heavy, 250'),('were5.93','were 5.93'),('and1.74','and 1.74'),('original50ms','original 50 ms'),('ADR0018','ADR 0018'),('The50ms','The 50 ms'),('covers100','covers 100'),('max50','max 50'),('a50ms','a 50 ms')]: section=section.replace(x,y)
s=s.replace('## Review coverage and remaining gaps\n',section+'## Review coverage and remaining gaps\n')
s=s.replace('Raw host/driver outputs and JUnit regression XMLs','Raw host/driver outputs, historical numerical sources/outputs and JUnit regression XMLs')
p.write_text(s)
manifest={str(p.relative_to(dst)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(dst.rglob('*')) if p.is_file() and p.name not in ['manifest.json','README.md','.gitattributes']}
(dst/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'{len(manifest)} hashed evidence files')
