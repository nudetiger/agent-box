Final narrowly scoped recheck after your complete review. Actual Spigot26.2 log confirmed same four OSHI diagnostics run on ServerMain, with logger name omitted; callchain still includes OSHI HkeyPerformanceDataUtil and net.minecraft.CrashReport.preload. Root corrected classifier to accept only named external records on either CrashReport preload thread or ServerMain AND require actual preload frame. It still requires exact registry text/Win32Exception and onlyknownproblemlinecounts; process diagnostics require exactthreeheaders+OSProcessnull+SystemReportframe+preload. Anypluginframe, pluginERROR, unknownnestedexception or missingpreload remainsFAIL. New4thunitcase checksactualSpigotstyle. ActualSpigotbootstrap classified0unexpected/4external; Paper semantics unchanged. Fulltracesremaininreport, no JVMoption orWindowsregistrychange.

Review ONLY this module/testdelta versus the attached prior snapshot, not another full project review. rltest.py itself unchanged since your first reviewed snapshot. MANUAL gained descriptions of menus, afterreload and externaldiagnostic attribution. Root final full product check passed all135tasks7m54:root1480tests0fail/errors35existing skips,Folia126Fancy24Java17Test17,18adapters506green. Paperfinalfresh58andafterreload59alreadyPASS; correctedSpigotfreshandFoliafreshcurrentlyrunning. Productcodeunchanged.

Finalmodule/tests and an actual Spigot bootstrap excerpt follow. Reconstructin/tmpifneeded; run4unittests. Finish your prior findings and verify onlycorrection. Returnvalid agent-box-findings []ifnoactionableissues, withoutre-reviewing unrelatedproductfeaturecode.
## Final actual file: tools/rltest_startup.py
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
        startup_thread = re.search(r'\[(CrashReport preload thread|ServerMain)/(ERROR|WARN)\]', header)
        preload = 'net.minecraft.CrashReport.preload(' in record
        registry = (startup_thread and '/ERROR]' in header and preload
                    and 'oshi.driver.windows.registry.HkeyPerformanceDataUtil.' in record
                    and 'Unable to locate English counter names in registry Perflib 009.' in header
                    and len(problems) == 2
                    and problems[1] == 'com.sun.jna.platform.win32.Win32Exception: The parameter is incorrect.')
        process = (startup_thread and '/WARN]' in header and preload
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

## Final actual file: tools/test_rltest_startup.py
~~~python
import unittest

from rltest_startup import classify_startup


REGISTRY = '''[00:29:05] [CrashReport preload thread/ERROR]: [oshi.driver.windows.registry.HkeyPerformanceDataUtil] Unable to locate English counter names in registry Perflib 009. Counters may need to be rebuilt:
com.sun.jna.platform.win32.Win32Exception: The parameter is incorrect.
 at oshi.driver.windows.registry.HkeyPerformanceDataUtil.mapCounterIndicesFromRegistry(HkeyPerformanceDataUtil.java:274)
 at net.minecraft.CrashReport.preload(CrashReport.java:240)
'''
PROCESS = '''[00:29:06] [CrashReport preload thread/WARN]: Failed to get system info for Process Loads
java.lang.NullPointerException: Cannot invoke "oshi.software.os.OSProcess.getUserTime()" because "process" is null
 at net.minecraft.SystemReport.putProcessDetails(SystemReport.java:188)
 at net.minecraft.CrashReport.preload(CrashReport.java:240)
'''


class StartupAttributionTest(unittest.TestCase):
    def test_known_external_records_stay_visible(self):
        errors, external = classify_startup(REGISTRY + PROCESS)
        self.assertEqual([], errors)
        self.assertEqual(2, len(external))
        self.assertIn('Win32Exception', external[0])
        self.assertIn('NullPointerException', external[1])

    def test_spigot_preloads_on_server_main_without_a_logger_name(self):
        registry = REGISTRY.replace('CrashReport preload thread', 'ServerMain').replace(
            '[oshi.driver.windows.registry.HkeyPerformanceDataUtil] ', '')
        process = PROCESS.replace('CrashReport preload thread', 'ServerMain')
        errors, external = classify_startup(registry + process)
        self.assertEqual([], errors)
        self.assertEqual(2, len(external))

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
                     PROCESS.replace('CrashReport.preload', 'Unrelated.method'),
                     PROCESS.replace('Process Loads', 'Something else')):
            errors, external = classify_startup(text)
            self.assertTrue(errors)
            self.assertEqual([], external)


if __name__ == '__main__':
    unittest.main()

~~~

## Actual Spigot bootstrap excerpt
~~~text
[01:04:15] [ServerMain/ERROR]: Unable to locate English counter names in registry Perflib 009. Counters may need to be rebuilt: 
com.sun.jna.platform.win32.Win32Exception: The parameter is incorrect.
	at com.sun.jna.platform.win32.Advapi32Util.registryGetStringArray(Advapi32Util.java:921)
	at com.sun.jna.platform.win32.Advapi32Util.registryGetStringArray(Advapi32Util.java:898)
	at oshi.driver.windows.registry.HkeyPerformanceDataUtil.mapCounterIndicesFromRegistry(HkeyPerformanceDataUtil.java:274)
	at oshi.driver.windows.registry.HkeyPerformanceDataUtil.<clinit>(HkeyPerformanceDataUtil.java:51)
	at oshi.driver.windows.registry.ProcessPerformanceData.buildProcessMapFromRegistry(ProcessPerformanceData.java:45)
	at oshi.software.os.windows.WindowsOperatingSystem.queryProcessMapFromRegistry(WindowsOperatingSystem.java:328)
	at oshi.util.Memoizer$1.get(Memoizer.java:65)
	at oshi.software.os.windows.WindowsOperatingSystem.processMapToList(WindowsOperatingSystem.java:298)
	at oshi.software.os.windows.WindowsOperatingSystem.getProcess(WindowsOperatingSystem.java:292)
	at oshi.software.os.OperatingSystem.getCurrentProcess(OperatingSystem.java:246)
	at net.minecraft.SystemReport.lambda$putSoftware$0(SystemReport.java:116)
	at net.minecraft.SystemReport.ignoreErrors(SystemReport.java:121)
	at net.minecraft.SystemReport.putSoftware(SystemReport.java:116)
	at net.minecraft.SystemReport.lambda$new$7(SystemReport.java:68)
	at net.minecraft.SystemReport.ignoreErrors(SystemReport.java:121)
	at net.minecraft.SystemReport.<init>(SystemReport.java:68)
	at net.minecraft.CrashReport.<init>(CrashReport.java:34)
	at net.minecraft.CrashReport.preload(CrashReport.java:268)
	at net.minecraft.server.Main.main(Main.java:121)
	at org.bukkit.craftbukkit.Main.main(Main.java:210)
	at org.bukkit.craftbukkit.bootstrap.Main.lambda$run$0(Main.java:60)
	at java.base/java.lang.Thread.run(Thread.java:1474)
[01:04:15] [ServerMain/WARN]: Unable to locate English counter names in registry Perflib 009. Assuming English counters. Error 0x80070057. See https://support.microsoft.com/en-us/help/300956/how-to-manually-rebuild-performance-counter-library-values
[01:04:16] [ServerMain/WARN]: Failed to get system info for Process Loads
java.lang.NullPointerException: Cannot invoke "oshi.software.os.OSProcess.getUserTime()" because "process" is null
	at net.minecraft.SystemReport.lambda$putProcessDetails$0(SystemReport.java:190)
	at net.minecraft.SystemReport.setDetail(SystemReport.java:96)
	at net.minecraft.SystemReport.putProcessDetails(SystemReport.java:189)
	at net.minecraft.SystemReport.lambda$putSoftware$0(SystemReport.java:116)
	at net.minecraft.SystemReport.ignoreErrors(SystemReport.java:121)
	at net.minecraft.SystemReport.putSoftware(SystemReport.java:116)
	at net.minecraft.SystemReport.lambda$new$7(SystemReport.java:68)
	at net.minecraft.SystemReport.ignoreErrors(SystemReport.java:121)
	at net.minecraft.SystemReport.<init>(SystemReport.java:68)
	at net.minecraft.CrashReport.<init>(CrashReport.java:34)
	at net.minecraft.CrashReport.preload(CrashReport.java:268)
	at net.minecraft.server.Main.main(Main.java:121)
	at org.bukkit.craftbukkit.Main.main(Main.java:210)
	at org.bukkit.craftbukkit.bootstrap.Main.lambda$run$0(Main.java:60)
	at java.base/java.lang.Thread.run(Thread.java:1474)
[01:04:16] [ServerMain/WARN]: Failed to get system info for Process Virtual Size (MiB)
java.lang.NullPointerException: Cannot invoke "oshi.software.os.OSProcess.getVirtualSize()" because "process" is null
	at net.minecraft.SystemReport.lambda$putProcessDetails$1(SystemReport.java:202)
	at net.minecraft.SystemReport.setDetail(SystemReport.java:96)
	at net.minecraft.SystemReport.putProcessDetails(SystemReport.java:202)
	at net.minecraft.SystemReport.lambda$putSoftware$0(SystemReport.java:116)
	at net.minecraft.SystemReport.ignoreErrors(SystemReport.java:121)
	at net.minecraft.SystemReport.putSoftware(SystemReport.java:116)
	at net.minecraft.SystemReport.lambda$new$7(SystemReport.java:68)
	at net.minecraft.SystemReport.ignoreErrors(SystemReport.java:121)
	at net.minecraft.SystemReport.<init>(SystemReport.java:68)
	at net.minecraft.CrashReport.<init>(CrashReport.java:34)
	at net.minecraft.CrashReport.preload(CrashReport.java:268)
	at net.minecraft.server.Main.main(Main.java:121)
	at org.bukkit.craftbukkit.Main.main(Main.java:210)
	at org.bukkit.craftbukkit.bootstrap.Main.lambda$run$0(Main.java:60)
	at java.base/java.lang.Thread.run(Thread.java:1474)
[01:04:16] [ServerMain/WARN]: Failed to get system info for Process Resident Size (MiB)
java.lang.NullPointerException: Cannot invoke "oshi.software.os.OSProcess.getResidentSetSize()" because "process" is null
	at net.minecraft.SystemReport.lambda$putProcessDetails$2(SystemReport.java:203)
	at net.minecraft.SystemReport.setDetail(SystemReport.java:96)
	at net.minecraft.SystemReport.putProcessDetails(SystemReport.java:203)
	at net.minecraft.SystemReport.lambda$putSoftware$0(SystemReport.java:116)
	at net.minecraft.SystemReport.ignoreErrors(SystemReport.java:121)
	at net.minecraft.SystemReport.putSoftware(SystemReport.java:116)
	at net.minecraft.SystemReport.lambda$new$7(SystemReport.java:68)
	at net.minecraft.SystemReport.ignoreErrors(SystemReport.java:121)
	at net.minecraft.SystemReport.<init>(SystemReport.java:68)
	at net.minecraft.CrashReport.<init>(CrashReport.java:34)
	at net.minecraft.CrashReport.preload(CrashReport.java:268)
	at net.minecraft.server.Main.main(Main.java:121)
	at org.bukkit.craftbukkit.Main.main(Main.java:210)
	at org.bukkit.craftbukkit.bootstrap.Main.lambda$run$0(Main.java:60)
	at java.base/java.lang.Thread.run(Thread.java:1474)
~~~
