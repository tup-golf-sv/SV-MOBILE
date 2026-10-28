#!/usr/bin/env bash
# Install and test the exact APK bytes produced by the build job.
set -uo pipefail
mkdir -p android-evidence
adb logcat -c
adb logcat > android-evidence/logcat.txt 2>&1 &
sv_logcat_pid=$!
collect_evidence() {
  adb shell dumpsys package kr.co.tupgolf.svmobile > android-evidence/installed-package.txt
  adb shell dumpsys meminfo kr.co.tupgolf.svmobile > android-evidence/memory.txt
  adb shell content query --uri content://media/external/video/media > android-evidence/media-store.txt
  adb shell wm size > android-evidence/display.txt
  adb pull /sdcard/Android/data/kr.co.tupgolf.svmobile/files/android-smoke.png android-evidence/android-smoke.png
  adb exec-out screencap -p > android-evidence/final-screen.png
  kill "$sv_logcat_pid" 2>/dev/null || true
}
trap collect_evidence EXIT
adb shell wm size 480x800
adb shell wm density 160
adb install -r -g ci-artifacts/outputs/apk/debug/app-debug.apk || exit 1
adb install -r -g ci-artifacts/outputs/apk/androidTest/debug/app-debug-androidTest.apk || exit 1
timeout 300 adb shell am instrument -w kr.co.tupgolf.svmobile.test/androidx.test.runner.AndroidJUnitRunner | tee android-evidence/instrumentation.txt
sv_test_result=${PIPESTATUS[0]}
# am instrument may exit zero even when an assertion fails; require explicit JUnit success.
if ! grep -Eq 'OK \([0-9]+ tests?\)' android-evidence/instrumentation.txt; then exit 1; fi
exit "$sv_test_result"
