Spec: #106

Part of #106; discovered while running #113. This is a RakunProbe test-driver attribution defect, not a RakunLoots exception.

On Paper 26.2-129 with the integrated phase-9 jar, rltest reports 57 PASS / 1 FAIL. All claim/wiki/reload/persistence checks pass and RakunLoots has zero WARN/ERROR. The sole failure is the generic startup assertion counting Minecraft's Windows OSHI crash-report diagnostics before RakunLoots enables:

```
[CrashReport preload thread/ERROR]: [oshi.driver.windows.registry.HkeyPerformanceDataUtil] Unable to locate English counter names in registry Perflib 009.
com.sun.jna.platform.win32.Win32Exception: The parameter is incorrect.
[CrashReport preload thread/WARN]: Failed to get system info for Process Loads
java.lang.NullPointerException: Cannot invoke "oshi.software.os.OSProcess.getUserTime()" because "process" is null
```

Two analogous SystemReport diagnostics name Process Virtual Size and Process Resident Size. Stack traces contain Minecraft SystemReport and OSHI/JNA, no RakunLoots frame. With OSHI's documented `oshi.os.windows.hkeyperfdata=false` fallback, the registry ERROR disappears but the same three process-data diagnostics remain; an independent OSHI-only Java probe also returns null with an empty performance-counter map. No global Windows registry repair is in scope.

#113 explicitly requires no ERROR/WARN **from RakunLoots**. The test driver must preserve visibility of these named external diagnostics without attributing them to the plugin or ignoring any plugin exception.

Fix in RakunProbe's rltest startup classification: identify only these exact CrashReport-preload OSHI/SystemReport records as external diagnostics; print them explicitly and retain the final full diagnostics dump. Keep all unexpected startup errors/exceptions failing, including any record containing RakunLoots or its package. Prove the matcher against actual diagnostic records plus synthetic plugin/unknown exceptions. Do not change RakunLoots or any server jar, tolerance, assertion about menu behavior, or Windows registry. Remove temporary OSHI JVM options for final runs.

Then rerun all six #113 fresh/after-reload checks on the final jar and report plugin ERROR/WARN counts separately. #113 remains pending until this is verified.