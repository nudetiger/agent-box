---
files: [docs/rewrite/phases.md]
issue: 114
red: false
steps: 35
---
Review the RakunProbe test-driver changes attached BELOW, read-only. They live in sibling repository C:/Workspace/Projects/MinecraftPlugins/RakunProbe, outside this sandbox's product repository. These are actual source snapshots and exact git diff captured by root. Do NOT review unrelated product commits or pretend these files exist under /work/repo. Reconstruct the three Python files into /tmp/probe-review if useful; standard-library unit tests need no server. No implementation edits. Return valid agent-box-findings JSON, [] if no actionable problems.

Contract: #113 tests final phase on Paper26.2, Spigot26.2, Folia26.2 fresh and afterreload, no RakunLoots ERROR/WARN, two menu files quiet, console commandsplayer-only, menus/claim/wiki checks. #114: the old broad startup check wrongly attributed exact Windows OSHI crash-report diagnostics beforepluginenable toRakunLoots. Preservefulltracevisibility, onlyseparatethoseexactknownexternalrecords, keepEVERYpluginorunknownerrorfailing. No RakunLoots/serverjar/registrychange. Unitmatchercheckspluginframes andunknownnestederrors remainfailing. TemporaryOSHIJvmflagwasremovedfromfinalruns. Existing35testsrootconditionalunrelated.

Also review earlier authorized phase9 smoke additions and --after-reload mode: same jarSHA/config/databasepreserved, server stopped/testbotfilesreset, start thenreload BEFOREallchecks. Bothrunmodesfinishstopped. Do not demand fulllegacyservermatrix or ownerclientcolors/sounds; explicit#113nonblocking. Don'tflag pre-existing unrelated TESTLOG/bothelpers. Only changedownedfiles included.

Validate parsers against actualnamed diagnostic examples, and testfalsepositives/negatives ratherthan proposing broadexceptionignores. The exactsixrealserverruns are root's job, currentlyinprogress, notworker evidence.

## Actual file: tools/rltest.py
~~~python
"""Smoke test RakunLoots: python tools/rltest.py <server> <rakunloots.jar> <bot version> [--after-reload]

The default makes a fresh install. --after-reload preserves the existing plugin config/database and verifies the
installed jar matches, then starts it and reloads before repeating the checks. Both modes reset only the stopped
test bots' player files to keep their positions and inventories reproducible.

Restarts the server with fresh RakunLoots defaults, then checks: startup, the packet adapter, admin commands, a summon
of every loot, a timer summon, the summon item, drop open, inventory open, a break, the lock against a second player,
the claim menu and claim-all command, wiki pages, reload, a restart that keeps the boxes, and removal. Each check prints PASS, FAIL, or INFO. Every
RakunLoots line at WARN or above, every RakunLoots warning code, and every exception from the whole run is printed at
the end. The report also goes to servers/<server>/rltest.txt.

Two test settings differ from the shipped defaults, and are set after the clean startup is checked: config.yml
debug: true, so each summon and loot end is logged, and worlds.yml unloaded_chunks: generate, because a fresh world has
almost no generated chunks for a summon to land in.
"""
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import uuid
from rltest_startup import classify_startup

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONF = dict(l.strip().split('=', 1) for l in open(os.path.join(HERE, 'mc.conf')) if '=' in l)
SERVER, JAR, BOTVER = sys.argv[1], sys.argv[2], sys.argv[3]
AFTER_RELOAD = '--after-reload' in sys.argv[4:]
SDIR = os.path.join(CONF['SERVERS_DIR'], SERVER)
LOG = os.path.join(SDIR, 'logs', 'latest.log')
PORT = int(re.search(r'^server-port=(\d+)', open(os.path.join(SDIR, 'server.properties')).read(), re.M).group(1))
BASH = r'C:\Program Files\Git\bin\bash.exe'
LOOTS = ['airdrops', 'treasure_chest', 'head_trophy', 'buried_stash', 'deep_vault', 'sky_lantern', 'sunken_treasure']
report = []
results = {'PASS': 0, 'FAIL': 0}


def out(line):
    print(line, flush=True)
    report.append(line)


def check(ok, what, detail=''):
    tag = 'PASS' if ok else 'FAIL'
    results[tag] += 1
    out(f'{tag} {what}' + (f'  [{detail}]' if detail else ''))
    return ok


def sh(*args, timeout=600):
    # Output goes through a file: a server that mc.sh starts keeps a pipe open, so reading a pipe would never end.
    path = os.path.join(SDIR, 'rltest.sh.out')
    with open(path, 'w') as f:
        subprocess.run([BASH, *args], cwd=ROOT, stdin=subprocess.DEVNULL, stdout=f, stderr=subprocess.STDOUT,
                       timeout=timeout)
    return open(path, encoding='utf-8', errors='replace').read()


def cmd(c):
    return re.sub(r'§.', '', sh('tools/mc.sh', SERVER, 'cmd', c, timeout=60)).strip()


def mark(label):
    cmd(f'probe mark {label}')
    return label


def log_since(label):
    text = open(LOG, encoding='utf-8', errors='replace').read()
    i = text.rfind(f'"label":"{label}"')
    return re.sub(r'§.', '', text[i:] if i >= 0 else text)


def probe(c, kind):
    """A probe read. Its records are read from the log, because on Folia they arrive after the command returns."""
    lab = mark(f'probe-{time.time_ns()}')
    reply = cmd(c)
    deadline = time.time() + 15
    while time.time() < deadline:
        lines = [l for l in log_since(lab).splitlines() if '[PROBE] ' in l and '"label"' not in l]
        if any(f'[PROBE] {kind} ' in l or '[PROBE] error ' in l or '[PROBE] none ' in l for l in lines):
            time.sleep(1)
            return '\n'.join(l for l in log_since(lab).splitlines() if '[PROBE] ' in l and '"label"' not in l)
        time.sleep(1)
    return reply


def bot(script, name='ProbeBot', timeout=90):
    node = subprocess.run(['node', 'tools/bot/bot.js', '--port', str(PORT), '--version', BOTVER, '--name', name,
                           '--timeout', str(timeout), '--script', script], cwd=ROOT, capture_output=True, text=True,
                          encoding='utf-8', errors='replace', timeout=timeout + 30)
    recs = []
    for line in node.stdout.splitlines():
        try:
            recs.append(json.loads(line))
        except ValueError:
            pass
    return recs


def bot_async(script, name, timeout=90):
    return subprocess.Popen(['node', 'tools/bot/bot.js', '--port', str(PORT), '--version', BOTVER, '--name', name,
                             '--timeout', str(timeout), '--script', script], cwd=ROOT, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, encoding='utf-8', errors='replace')


def chats(recs):
    return [r['text'] for r in recs if r.get('kind') == 'chat']


def placed(text, loot=None):
    pat = r'summon placed loot=(\w+) world=\w+ x=(-?\d+) y=(-?\d+) z=(-?\d+) source=([^\n]+)'
    return [(m[0], int(m[1]), int(m[2]), int(m[3]), m[4].strip()) for m in re.findall(pat, text)
            if loot is None or m[0] == loot]


def edit(path, old, new):
    p = os.path.join(SDIR, 'plugins', 'RakunLoots', path)
    s = open(p, encoding='utf-8').read()
    open(p, 'w', encoding='utf-8').write(s.replace(old, new))


def forget_bots():
    """The bots log in where they last stood, which after a few runs can be under water or inside a cave, so the bot
    steps (open, break, drown) fail for a reason that is not RakunLoots'. Delete their player files with the server
    stopped, so each run starts them at the world spawn."""
    for name in ('ProbeBot', 'Other1'):
        h = bytearray(hashlib.md5(f'OfflinePlayer:{name}'.encode()).digest())
        h[6] = h[6] & 0x0f | 0x30
        h[8] = h[8] & 0x3f | 0x80
        for f in glob.glob(os.path.join(SDIR, 'world*', '**', f'{uuid.UUID(bytes=bytes(h))}.*'), recursive=True):
            os.remove(f)


# 1. Fresh startup, or a second run using the same installed jar and config after reload.
if AFTER_RELOAD:
    installed = os.path.join(SDIR, 'plugins', 'RakunLoots.jar')
    if not os.path.isfile(installed) or not os.path.isdir(os.path.join(SDIR, 'plugins', 'RakunLoots')):
        raise SystemExit('--after-reload requires an existing tested RakunLoots install')
    if hashlib.sha256(open(installed, 'rb').read()).digest() != hashlib.sha256(open(JAR, 'rb').read()).digest():
        raise SystemExit('--after-reload requires the same jar as the installed first run')
sh('tools/mc.sh', SERVER, 'stop', timeout=120)
forget_bots()
out(f'== {SERVER}  jar={os.path.basename(JAR)}  bot version={BOTVER}  port={PORT}  '
    f'mode={"after-reload" if AFTER_RELOAD else "fresh"}')
start = (sh('tools/mc.sh', SERVER, 'start', timeout=900) if AFTER_RELOAD
         else sh('tools/fresh.sh', SERVER, JAR, timeout=900))
if AFTER_RELOAD:
    check('Reloaded.' in cmd('rkl reload'), 'reload the existing install before repeating the smoke test')
boot = open(LOG, encoding='utf-8', errors='replace').read()
check('Done (' in start, 'server started')
check('RakunLoots 1.0.0-SNAPSHOT enabled.' in boot, 'RakunLoots enabled')
check('[RakunProbe] RakunProbe enabled' in boot, 'RakunProbe enabled')
# A RakunLoots warning code line may name an exception as its cause; those are listed at the end, not counted here.
errs, external_startup = classify_startup(boot)
for diagnostic in external_startup:
    out('INFO external Windows OSHI bootstrap diagnostic (full trace retained below): ' + diagnostic.splitlines()[0])
check(not errs, 'no unexpected ERROR or exception at startup', f'{len(errs)} lines' if errs else '')
codes = sorted(set(re.findall(r'\[RakunLoots\] ([A-Z_]{4,}) ', boot)))
out(f'INFO startup warning codes: {", ".join(codes) or "none"}')
fresh_warns = [l for l in boot.splitlines() if re.search(r'WARN\]: \[RakunLoots\]', l)]
check(not fresh_warns, 'no RakunLoots WARN at startup', f'{len(fresh_warns)} lines')
check(all(os.path.isfile(os.path.join(SDIR, 'plugins', 'RakunLoots', 'menus', name))
          for name in ('claim.yml', 'wiki.yml')), 'both shipped menu files were written')
holo = cmd('probe holo adapter')
check('"adapter"' in holo, 'packet hologram adapter picked', holo[:160])
r = bot('wait 1000; chat /loots; wait 1000; window; close; '
        'chat /claimsummon; wait 1000; window', 'Other1', timeout=30)
check(any(x.get('open') and x.get('size') == 54 for x in r if x.get('kind') == 'window'),
      'wiki opens after reload' if AFTER_RELOAD else 'wiki opens before the first reload')
check(any('no summon items waiting' in c for c in chats(r)),
      'empty claim works after reload' if AFTER_RELOAD else 'empty claim works before the first reload')
before_reload_windows = [x for x in r if x.get('kind') == 'window']
check(bool(before_reload_windows) and not before_reload_windows[-1].get('open'),
      'an empty claim does not open a menu')

# 2. Admin commands from the console.
edit('config.yml', 'debug: false', 'debug: true')
edit('worlds.yml', 'unloaded_chunks: load', 'unloaded_chunks: generate')
check('Reloaded.' in cmd('rkl reload'), 'rkl reload')
check('airdrops' in cmd('rkl list'), 'rkl list')
check('/rkl summon' in cmd('rkl help'), 'rkl help')
check('Did you mean airdrops' in cmd('rkl summon airdrop world'), 'a mistyped loot suggests a close match')
for player_command in ('claimsummon', 'claimsummon all', 'loots'):
    reply = cmd(player_command)
    check('player' in reply.lower() and 'unknown command' not in reply.lower(),
          f'{player_command} is player only', reply)

# 3. Summon every loot, and one timer summon.
lab = mark('rltest-summons')
for loot in LOOTS:
    cmd(f'rkl summon {loot} world')
cmd('rkl timer world now --force')
deadline = time.time() + 90
while time.time() < deadline:
    t = log_since(lab)
    if len(re.findall(r'source=admin command', t)) >= len(LOOTS) and 'timer world=world' in t:
        break
    time.sleep(3)
t = log_since(lab)
spots = placed(t)
for loot in LOOTS:
    hit = [s for s in spots if s[0] == loot and s[4] == 'admin command']
    miss = re.search(rf'summon abandoned loot={loot} reason=(\w+) source=admin', t)
    check(bool(hit), f'summon {loot}', f'{hit[0][1:4]}' if hit else (miss.group(1) if miss else 'no outcome logged'))
timer = re.search(r'timer world=world (summoned loot=\w+|abandoned reason=\w+|refused reason=\w+)', t)
check(bool(timer) and 'summoned' in timer.group(1), 'timer world now --force', timer.group(1) if timer else 'none')
for loot, x, y, z, _ in spots:
    b = probe(f'probe block world {x} {y} {z}', 'block')
    check('minecraft:air' not in b, f'block of {loot} is there', b[b.find('"data"'):][:70])

# 4. The bot: summon item, drop open, inventory open, break.
cmd('op ProbeBot')
cmd('deop Other1')
lab = mark('rltest-bot')
r = bot('chat /clear ProbeBot; pos; chat /rkl give airdrops ProbeBot 1; wait 1500; inv; hold 0; use; wait 7000; inv; '
        'chat /rkl summon treasure_chest ProbeBot; wait 6000; chat /rkl summon head_trophy ProbeBot; wait 5000', timeout=60)
check(any(x.get('kind') == 'join' for x in r), 'bot joined', next((x.get('message') for x in r if x.get('kind') == 'error'), ''))
t = log_since(lab)
item = placed(t, 'airdrops')
check(bool(item) and item[0][4].startswith('summon item'), 'summon item summons its loot', str(item[:1]))
chest = placed(t, 'treasure_chest')
head = placed(t, 'head_trophy')
script = []
if item:
    _, x, y, z, _ = item[0]
    script += [f'chat /tp ProbeBot {x + .5} {y + 1} {z + 2.5}', 'wait 1500', f'rightclick {x} {y} {z}', 'wait 1500',
               f'block {x} {y} {z}']
if chest:
    _, x, y, z, _ = chest[0]
    script += [f'chat /tp ProbeBot {x + .5} {y + 1} {z + 2.5}', 'wait 1500', f'rightclick {x} {y} {z}', 'wait 1000',
               'window', 'close']
if head:
    _, x, y, z, _ = head[0]
    script += [f'chat /tp ProbeBot {x + .5} {y + 1} {z + 2.5}', 'wait 1500', f'break {x} {y} {z}', 'wait 800',
               f'block {x} {y} {z}']
lab = mark('rltest-open')
cmd('probe events on ItemSpawn')
r = bot('; '.join(script) or 'wait 100', timeout=80)
t = log_since(lab)
blocks = [x for x in r if x.get('kind') == 'block']
check('how=opened (drop open)' in t, 'drop open (airdrops) ends the box', str(blocks[:1]))
cmd('probe events off')
# The bot stands next to the box and picks the drops up within seconds, so a later look for item entities finds none.
# The ItemSpawn event is logged when each drop appears.
check(bool(item) and 'ItemSpawnEvent' in t, 'drop open dropped items')
win = [x for x in r if x.get('kind') == 'window' and x.get('open')]
check(bool(win) and bool(win[0].get('slots')), 'inventory open (treasure_chest) shows its items',
      f"{win[0].get('title')} size {win[0].get('size')} {len(win[0].get('slots'))} stacks" if win else 'no window')
brk = [x for x in r if x.get('kind') == 'break']
check('how=broken by a player' in t, 'break (head_trophy) ends the box', str(brk[:1]))

# 5. The lock against a player who is not the owner.
lab = mark('rltest-lock')
# A treasure_chest summoned to ProbeBot is ProbeBot's and stays locked for 30 s. Other1 is not an operator, so it has
# no lock bypass; the console teleports it next to the box once it is online.
owner = bot_async('wait 1000; chat /rkl summon treasure_chest ProbeBot; wait 40000', 'ProbeBot', timeout=60)
deadline = time.time() + 25
while time.time() < deadline and not placed(log_since(lab), 'treasure_chest'):
    time.sleep(1)
box = placed(log_since(lab), 'treasure_chest')
# The hologram over ProbeBot's own box refreshes each second, so its entity data packets reach ProbeBot.
cmd('probe packets ProbeBot on')
time.sleep(4)
cmd('probe packets ProbeBot off')
pk = re.findall(r'\[PROBE\] packet \{[^\n]*"type":"([A-Za-z$]+)"', log_since(lab))
holo_pk = [p for p in pk if re.search(r'SetEntityData|EntityMetadata|AddEntity|SpawnEntity', p)]
check(bool(holo_pk), 'hologram packets reach the player', f'{len(holo_pk)} of {len(pk)} packets: {sorted(set(holo_pk))}')
if box:
    _, x, y, z, _ = box[0]
    other = bot_async(f'wait 4000; rightclick {x} {y} {z}; wait 800; break {x} {y} {z}; wait 500', 'Other1', timeout=40)
    time.sleep(3)
    cmd(f'tp Other1 {x + .5} {y + 1} {z + 2.5}')
    stdout, _ = other.communicate(timeout=60)
    r = [json.loads(l) for l in stdout.splitlines() if l.startswith('{')]
    t = log_since(lab)
    check(any('still locked' in c for c in chats(r)), 'a locked box refuses a player who is not its owner', str(chats(r)[-2:]))
    check(f'x={x} y={y} z={z} how=' not in t, 'a locked box is not ended by that player')
    b = probe(f'probe block world {x} {y} {z}', 'block')
    check('minecraft:chest' in b, 'the locked box is still there', b[b.find('"data"'):][:60])
else:
    check(False, 'lock test summon', 'no treasure_chest placed')
owner.kill()

# 6. Claim: summon items given while offline.
cmd('rkl give treasure_chest Other1 2')
r = bot('wait 1500; chat /claimsummon; wait 1000; window; click 0; wait 1000; window; inv',
        'Other1', timeout=30)
inv = [x for x in r if x.get('kind') == 'inv']
check(any('waiting' in c for c in chats(r)), 'join message names the claim command', str(chats(r)[:2]))
claim_windows = [x for x in r if x.get('kind') == 'window']
check(any(w.get('open') and w.get('size') == 54
          and any(s['slot'] == 0 and s['name'] == 'compass' and s['count'] == 2 for s in w.get('slots', []))
          for w in claim_windows), 'claim command opens the shipped menu with the owed items')
check(any('You took 2' in c for c in chats(r)), 'claim menu row gives the summon items', str(chats(r)[-2:]))
check(bool(inv) and sum(s['count'] for s in inv[-1]['slots'] if s['name'] == 'compass') == 2,
      'claim row gives exactly two summon items')
check(bool(claim_windows) and not claim_windows[-1].get('open'), 'claim menu closes when nothing is owed')
cmd('rkl give treasure_chest Other1 1')
r = bot('wait 1000; chat /claimsummon all; wait 1000; window; inv', 'Other1', timeout=30)
check(any('You took 1' in c for c in chats(r)), 'claim all keeps the direct claim behaviour', str(chats(r)[-2:]))
check(not any(x.get('open') for x in r if x.get('kind') == 'window'), 'claim all does not open a menu')

# The bot observes real inventory packets; client-only colours and sounds still need the owner's check.
r = bot('wait 1000; chat /loots; wait 1000; window; click 3; wait 1000; window; '
        'click 48; wait 1000; window; close', 'Other1', timeout=40)
wiki_windows = [x for x in r if x.get('kind') == 'window' and x.get('open')]
expected_names = ['Deep Vault', 'Head Trophy', 'Buried Stash', 'Treasure Chest', 'Air Supply',
                  'Sky Lantern', 'Sunken Treasure']
first_slots = {s['slot']: s for s in wiki_windows[0].get('slots', [])} if wiki_windows else {}
names = [re.sub(r'§.', '', first_slots.get(i, {}).get('customName') or '') for i in range(7)]
check(bool(wiki_windows) and wiki_windows[0].get('size') == 54, 'wiki opens the shipped list menu')
check(all(expected in actual for expected, actual in zip(expected_names, names)),
      'wiki orders the shipped loots by timer chance', str(names))
loot_pages = [w for w in wiki_windows if any(s['slot'] == 49 and s['name'] == 'book'
                                           for s in w.get('slots', []))]
info = next((s for w in loot_pages for s in w.get('slots', []) if s['slot'] == 49), {})
info_text = re.sub(r'§.', '', '\n'.join(info.get('lore') or []))
check(bool(loot_pages) and 'inventory' in info_text.lower() and '0:30' in info_text and '10:00' in info_text,
      'wiki loot page shows treasure chest information', info_text)
last_slots = {s['slot']: s for s in wiki_windows[-1].get('slots', [])} if wiki_windows else {}
check(bool(loot_pages) and 'Deep Vault' in re.sub(r'§.', '', last_slots.get(0, {}).get('customName') or ''),
      'wiki back returns to the list')

# 7. Reload, restart, removal.
lab = mark('rltest-restart')
check('Reloaded.' in cmd('rkl reload'), 'reload with live boxes')
sh('tools/mc.sh', SERVER, 'stop', timeout=120)
stoplog = open(LOG, encoding='utf-8', errors='replace').read()
check('RakunLoots 1.0.0-SNAPSHOT disabled.' in stoplog, 'RakunLoots disabled cleanly')
whole = stoplog
sh('tools/mc.sh', SERVER, 'start', timeout=900)
boot2 = open(LOG, encoding='utf-8', errors='replace').read()
check('RakunLoots 1.0.0-SNAPSHOT enabled.' in boot2, 'RakunLoots enabled again after a restart')
removed = cmd('rkl remove all')
m = re.search(r'Removed (\d+)', removed)
check(bool(m) and int(m.group(1)) > 0, 'boxes survived the restart and remove all ended them', removed)
time.sleep(2)
whole += open(LOG, encoding='utf-8', errors='replace').read()

# 8. Everything RakunLoots or an exception said during the run.
out('---- RakunLoots warnings, errors, and exceptions during the run')
seen = set()
for l in whole.splitlines():
    if (re.search(r'(WARN|ERROR)\]: \[RakunLoots', l) or re.search(r'Exception|^\s+at |ERROR', l)
            or re.search(r'\[RakunLoots\] [A-Z_]{4,} ', l)):
        key = re.sub(r'^\[[^\]]*\] ', '', l)
        if key not in seen:
            seen.add(key)
            out('  ' + l[:300])
out(f"== {SERVER}: {results['PASS']} passed, {results['FAIL']} failed")
open(os.path.join(SDIR, 'rltest.txt'), 'w', encoding='utf-8').write('\n'.join(report) + '\n')
sh('tools/mc.sh', SERVER, 'stop', timeout=120)

~~~


## Actual file: tools/rltest_startup.py
~~~python
"""Attribute the known Windows OSHI bootstrap diagnostics without hiding plugin errors."""
import re


def classify_startup(text):
    unexpected, external = [], []
    for record in re.split(r'(?m)(?=^\[\d{2}:\d{2}:\d{2}\])', text):
        lines = record.splitlines()
        if not lines:
            continue
        problems = [line for line in lines if re.search(r'ERROR|Exception', line)
                    and not (re.search(r'\[RakunLoots\] [A-Z_]{4,} ', line)
                             and 'ERROR]' not in line)]
        if not problems:
            continue
        header = lines[0]
        plugin = '[RakunLoots]' in record or 'me.rakkoon69.rakunloots' in record
        registry = ('[CrashReport preload thread/ERROR]' in header
                    and '[oshi.driver.windows.registry.HkeyPerformanceDataUtil]' in header
                    and 'Unable to locate English counter names in registry Perflib 009.' in header
                    and len(problems) == 2
                    and problems[1] == 'com.sun.jna.platform.win32.Win32Exception: The parameter is incorrect.')
        process = ('[CrashReport preload thread/WARN]' in header
                   and re.search(r'Failed to get system info for Process '
                                 r'(Loads|Virtual Size \(MiB\)|Resident Size \(MiB\))$', header)
                   and 'Cannot invoke "oshi.software.os.OSProcess.' in record
                   and 'because "process" is null' in record
                   and 'net.minecraft.SystemReport.' in record
                   and len(problems) == 1)
        if not plugin and (registry or process):
            external.append(record)
        else:
            unexpected.extend(problems)
    return unexpected, external

~~~


## Actual file: tools/test_rltest_startup.py
~~~python
import unittest

from rltest_startup import classify_startup


REGISTRY = '''[00:29:05] [CrashReport preload thread/ERROR]: [oshi.driver.windows.registry.HkeyPerformanceDataUtil] Unable to locate English counter names in registry Perflib 009. Counters may need to be rebuilt:
com.sun.jna.platform.win32.Win32Exception: The parameter is incorrect.
 at oshi.driver.windows.registry.HkeyPerformanceDataUtil.mapCounterIndicesFromRegistry(HkeyPerformanceDataUtil.java:274)
'''
PROCESS = '''[00:29:06] [CrashReport preload thread/WARN]: Failed to get system info for Process Loads
java.lang.NullPointerException: Cannot invoke "oshi.software.os.OSProcess.getUserTime()" because "process" is null
 at net.minecraft.SystemReport.putProcessDetails(SystemReport.java:188)
'''


class StartupAttributionTest(unittest.TestCase):
    def test_known_external_records_stay_visible(self):
        errors, external = classify_startup(REGISTRY + PROCESS)
        self.assertEqual([], errors)
        self.assertEqual(2, len(external))
        self.assertIn('Win32Exception', external[0])
        self.assertIn('NullPointerException', external[1])

    def test_plugin_frame_never_gets_the_external_exception(self):
        errors, external = classify_startup(PROCESS + ' at me.rakkoon69.rakunloots.Plugin.onEnable(Plugin.java:1)\n')
        self.assertTrue(errors)
        self.assertEqual([], external)

    def test_unknown_or_plugin_errors_still_fail(self):
        for text in ('[00:00:00] [Server thread/ERROR]: [RakunLoots] Could not enable\n',
                     '[00:00:00] [Server thread/ERROR]: [RakunLoots] UNUSABLE_MENU broken\n',
                     '[00:00:00] [Server thread/ERROR]: Unknown startup error\n',
                     REGISTRY + 'java.lang.IllegalStateException: unexpected nested problem\n',
                     PROCESS + 'java.lang.IllegalStateException: unexpected nested problem\n',
                     PROCESS.replace('Process Loads', 'Something else')):
            errors, external = classify_startup(text)
            self.assertTrue(errors)
            self.assertEqual([], external)


if __name__ == '__main__':
    unittest.main()

~~~

## Exact diff from pre-task helper
~~~diff
diff --git a/tools/rltest.py b/tools/rltest.py
index 3c0652c..a50e32e 100644
--- a/tools/rltest.py
+++ b/tools/rltest.py
@@ -1,8 +1,12 @@
-"""Smoke test RakunLoots on one server: python tools/rltest.py <server> <rakunloots.jar> <bot version>
+"""Smoke test RakunLoots: python tools/rltest.py <server> <rakunloots.jar> <bot version> [--after-reload]
+
+The default makes a fresh install. --after-reload preserves the existing plugin config/database and verifies the
+installed jar matches, then starts it and reloads before repeating the checks. Both modes reset only the stopped
+test bots' player files to keep their positions and inventories reproducible.
 
 Restarts the server with fresh RakunLoots defaults, then checks: startup, the packet adapter, admin commands, a summon
 of every loot, a timer summon, the summon item, drop open, inventory open, a break, the lock against a second player,
-the claim command, reload, a restart that keeps the boxes, and removal. Each check prints PASS, FAIL, or INFO. Every
+the claim menu and claim-all command, wiki pages, reload, a restart that keeps the boxes, and removal. Each check prints PASS, FAIL, or INFO. Every
 RakunLoots line at WARN or above, every RakunLoots warning code, and every exception from the whole run is printed at
 the end. The report also goes to servers/<server>/rltest.txt.
 
@@ -19,11 +23,13 @@ import subprocess
 import sys
 import time
 import uuid
+from rltest_startup import classify_startup
 
 HERE = os.path.dirname(os.path.abspath(__file__))
 ROOT = os.path.dirname(HERE)
 CONF = dict(l.strip().split('=', 1) for l in open(os.path.join(HERE, 'mc.conf')) if '=' in l)
 SERVER, JAR, BOTVER = sys.argv[1], sys.argv[2], sys.argv[3]
+AFTER_RELOAD = '--after-reload' in sys.argv[4:]
 SDIR = os.path.join(CONF['SERVERS_DIR'], SERVER)
 LOG = os.path.join(SDIR, 'logs', 'latest.log')
 PORT = int(re.search(r'^server-port=(\d+)', open(os.path.join(SDIR, 'server.properties')).read(), re.M).group(1))
@@ -130,22 +136,47 @@ def forget_bots():
             os.remove(f)
 
 
-# 1. Fresh startup with the shipped defaults.
+# 1. Fresh startup, or a second run using the same installed jar and config after reload.
+if AFTER_RELOAD:
+    installed = os.path.join(SDIR, 'plugins', 'RakunLoots.jar')
+    if not os.path.isfile(installed) or not os.path.isdir(os.path.join(SDIR, 'plugins', 'RakunLoots')):
+        raise SystemExit('--after-reload requires an existing tested RakunLoots install')
+    if hashlib.sha256(open(installed, 'rb').read()).digest() != hashlib.sha256(open(JAR, 'rb').read()).digest():
+        raise SystemExit('--after-reload requires the same jar as the installed first run')
 sh('tools/mc.sh', SERVER, 'stop', timeout=120)
 forget_bots()
-out(f'== {SERVER}  jar={os.path.basename(JAR)}  bot version={BOTVER}  port={PORT}')
-start = sh('tools/fresh.sh', SERVER, JAR, timeout=900)
+out(f'== {SERVER}  jar={os.path.basename(JAR)}  bot version={BOTVER}  port={PORT}  '
+    f'mode={"after-reload" if AFTER_RELOAD else "fresh"}')
+start = (sh('tools/mc.sh', SERVER, 'start', timeout=900) if AFTER_RELOAD
+         else sh('tools/fresh.sh', SERVER, JAR, timeout=900))
+if AFTER_RELOAD:
+    check('Reloaded.' in cmd('rkl reload'), 'reload the existing install before repeating the smoke test')
 boot = open(LOG, encoding='utf-8', errors='replace').read()
 check('Done (' in start, 'server started')
 check('RakunLoots 1.0.0-SNAPSHOT enabled.' in boot, 'RakunLoots enabled')
 check('[RakunProbe] RakunProbe enabled' in boot, 'RakunProbe enabled')
 # A RakunLoots warning code line may name an exception as its cause; those are listed at the end, not counted here.
-errs = [l for l in boot.splitlines() if re.search(r'ERROR|Exception', l) and not re.search(r'\[RakunLoots\] [A-Z_]{4,} ', l)]
-check(not errs, 'no ERROR or exception at startup', f'{len(errs)} lines' if errs else '')
+errs, external_startup = classify_startup(boot)
+for diagnostic in external_startup:
+    out('INFO external Windows OSHI bootstrap diagnostic (full trace retained below): ' + diagnostic.splitlines()[0])
+check(not errs, 'no unexpected ERROR or exception at startup', f'{len(errs)} lines' if errs else '')
 codes = sorted(set(re.findall(r'\[RakunLoots\] ([A-Z_]{4,}) ', boot)))
 out(f'INFO startup warning codes: {", ".join(codes) or "none"}')
+fresh_warns = [l for l in boot.splitlines() if re.search(r'WARN\]: \[RakunLoots\]', l)]
+check(not fresh_warns, 'no RakunLoots WARN at startup', f'{len(fresh_warns)} lines')
+check(all(os.path.isfile(os.path.join(SDIR, 'plugins', 'RakunLoots', 'menus', name))
+          for name in ('claim.yml', 'wiki.yml')), 'both shipped menu files were written')
 holo = cmd('probe holo adapter')
 check('"adapter"' in holo, 'packet hologram adapter picked', holo[:160])
+r = bot('wait 1000; chat /loots; wait 1000; window; close; '
+        'chat /claimsummon; wait 1000; window', 'Other1', timeout=30)
+check(any(x.get('open') and x.get('size') == 54 for x in r if x.get('kind') == 'window'),
+      'wiki opens after reload' if AFTER_RELOAD else 'wiki opens before the first reload')
+check(any('no summon items waiting' in c for c in chats(r)),
+      'empty claim works after reload' if AFTER_RELOAD else 'empty claim works before the first reload')
+before_reload_windows = [x for x in r if x.get('kind') == 'window']
+check(bool(before_reload_windows) and not before_reload_windows[-1].get('open'),
+      'an empty claim does not open a menu')
 
 # 2. Admin commands from the console.
 edit('config.yml', 'debug: false', 'debug: true')
@@ -154,6 +185,10 @@ check('Reloaded.' in cmd('rkl reload'), 'rkl reload')
 check('airdrops' in cmd('rkl list'), 'rkl list')
 check('/rkl summon' in cmd('rkl help'), 'rkl help')
 check('Did you mean airdrops' in cmd('rkl summon airdrop world'), 'a mistyped loot suggests a close match')
+for player_command in ('claimsummon', 'claimsummon all', 'loots'):
+    reply = cmd(player_command)
+    check('player' in reply.lower() and 'unknown command' not in reply.lower(),
+          f'{player_command} is player only', reply)
 
 # 3. Summon every loot, and one timer summon.
 lab = mark('rltest-summons')
@@ -253,10 +288,43 @@ owner.kill()
 
 # 6. Claim: summon items given while offline.
 cmd('rkl give treasure_chest Other1 2')
-r = bot('wait 1500; chat /claimsummon; wait 1500; inv', 'Other1', timeout=30)
+r = bot('wait 1500; chat /claimsummon; wait 1000; window; click 0; wait 1000; window; inv',
+        'Other1', timeout=30)
 inv = [x for x in r if x.get('kind') == 'inv']
 check(any('waiting' in c for c in chats(r)), 'join message names the claim command', str(chats(r)[:2]))
-check(any('You took 2' in c for c in chats(r)), 'claim gives the summon items', str(chats(r)[-1:]))
+claim_windows = [x for x in r if x.get('kind') == 'window']
+check(any(w.get('open') and w.get('size') == 54
+          and any(s['slot'] == 0 and s['name'] == 'compass' and s['count'] == 2 for s in w.get('slots', []))
+          for w in claim_windows), 'claim command opens the shipped menu with the owed items')
+check(any('You took 2' in c for c in chats(r)), 'claim menu row gives the summon items', str(chats(r)[-2:]))
+check(bool(inv) and sum(s['count'] for s in inv[-1]['slots'] if s['name'] == 'compass') == 2,
+      'claim row gives exactly two summon items')
+check(bool(claim_windows) and not claim_windows[-1].get('open'), 'claim menu closes when nothing is owed')
+cmd('rkl give treasure_chest Other1 1')
+r = bot('wait 1000; chat /claimsummon all; wait 1000; window; inv', 'Other1', timeout=30)
+check(any('You took 1' in c for c in chats(r)), 'claim all keeps the direct claim behaviour', str(chats(r)[-2:]))
+check(not any(x.get('open') for x in r if x.get('kind') == 'window'), 'claim all does not open a menu')
+
+# The bot observes real inventory packets; client-only colours and sounds still need the owner's check.
+r = bot('wait 1000; chat /loots; wait 1000; window; click 3; wait 1000; window; '
+        'click 48; wait 1000; window; close', 'Other1', timeout=40)
+wiki_windows = [x for x in r if x.get('kind') == 'window' and x.get('open')]
+expected_names = ['Deep Vault', 'Head Trophy', 'Buried Stash', 'Treasure Chest', 'Air Supply',
+                  'Sky Lantern', 'Sunken Treasure']
+first_slots = {s['slot']: s for s in wiki_windows[0].get('slots', [])} if wiki_windows else {}
+names = [re.sub(r'§.', '', first_slots.get(i, {}).get('customName') or '') for i in range(7)]
+check(bool(wiki_windows) and wiki_windows[0].get('size') == 54, 'wiki opens the shipped list menu')
+check(all(expected in actual for expected, actual in zip(expected_names, names)),
+      'wiki orders the shipped loots by timer chance', str(names))
+loot_pages = [w for w in wiki_windows if any(s['slot'] == 49 and s['name'] == 'book'
+                                           for s in w.get('slots', []))]
+info = next((s for w in loot_pages for s in w.get('slots', []) if s['slot'] == 49), {})
+info_text = re.sub(r'§.', '', '\n'.join(info.get('lore') or []))
+check(bool(loot_pages) and 'inventory' in info_text.lower() and '0:30' in info_text and '10:00' in info_text,
+      'wiki loot page shows treasure chest information', info_text)
+last_slots = {s['slot']: s for s in wiki_windows[-1].get('slots', [])} if wiki_windows else {}
+check(bool(loot_pages) and 'Deep Vault' in re.sub(r'§.', '', last_slots.get(0, {}).get('customName') or ''),
+      'wiki back returns to the list')
 
 # 7. Reload, restart, removal.
 lab = mark('rltest-restart')
~~~
