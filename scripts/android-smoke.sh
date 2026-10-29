#!/usr/bin/env bash
# Install and test the exact APK bytes produced by the build job.
set -uo pipefail
mkdir -p android-evidence
adb logcat -c
adb logcat > android-evidence/logcat.txt 2>&1 &
sv_logcat_pid=$!
collect_evidence() {
  free -m > android-evidence/host-memory.txt
  ps -eo pid,rss,comm --sort=-rss | head -15 > android-evidence/host-processes.txt
  timeout 15 adb shell dumpsys package kr.co.tupgolf.svmobile > android-evidence/installed-package.txt
  timeout 15 adb shell dumpsys meminfo kr.co.tupgolf.svmobile > android-evidence/memory.txt
  timeout 15 adb shell content query --uri content://media/external/video/media > android-evidence/media-store.txt
  timeout 15 adb shell wm size > android-evidence/display.txt
  timeout 15 adb pull /sdcard/Android/data/kr.co.tupgolf.svmobile/files/android-smoke.png android-evidence/android-smoke.png
  timeout 15 adb exec-out screencap -p > android-evidence/final-screen.png
  kill "$sv_logcat_pid" 2>/dev/null || true
}
trap collect_evidence EXIT
adb shell wm size 480x800
adb shell wm density 160
adb install -r -g ci-artifacts/outputs/apk/debug/app-debug.apk || exit 1
adb install -r -g ci-artifacts/outputs/apk/androidTest/debug/app-debug-androidTest.apk || exit 1
# Isolate each method in a fresh instrumented process. A blocked UI thread must
# not prevent the remaining tests or hide which phase failed.
sv_test_result=0
for sv_method in aUnpaidCloudRequestDoesNotUpload bCanvasRecordingReplayAndNativeSave cCameraReplayAndMediaStoreRoundTrip dActualPreRollCapture; do
  adb shell am force-stop kr.co.tupgolf.svmobile
  # Budgets include all sequential stage maxima, startup and teardown.
  # Camera: 60+60+120+30+60 seconds, plus direct callbacks and lifecycle.
  case "$sv_method" in
    a*) sv_method_budget=180 ;;
    b*) sv_method_budget=300 ;;
    c*) sv_method_budget=540 ;;
    d*) sv_method_budget=600 ;;
  esac
  echo "SV_SMOKE_START_METHOD=$sv_method budget=${sv_method_budget}s"
  # Capture bounded diagnostic snapshots WHILE instrumentation is running.
  # The old script only collected evidence after a 600s timeout, losing
  # the live phase and main-thread state of a stalled pre-roll test.
  (
    for sv_tick in 1 2 3 4 5 6 7 8 9 10 11 12; do
      sleep 30
      echo "SV_WATCHDOG method=$sv_method elapsed=$((sv_tick * 30))s" >> "android-evidence/$sv_method-watchdog.txt"
      timeout 8 adb shell dumpsys activity top >> "android-evidence/$sv_method-watchdog.txt" 2>&1 || true
      timeout 8 adb shell dumpsys meminfo kr.co.tupgolf.svmobile >> "android-evidence/$sv_method-watchdog.txt" 2>&1 || true
      grep -E 'SV_SMOKE_STAGE|SV_JS_TIMEOUT|SV_UI_STACK|SV_PREROLL' android-evidence/logcat.txt | tail -30 > "android-evidence/$sv_method-phases.txt" || true
    done
  ) &
  sv_watchdog_pid=$!
  timeout "$sv_method_budget" adb shell am instrument -w -e class "kr.co.tupgolf.svmobile.AndroidSmokeTest#$sv_method" kr.co.tupgolf.svmobile.test/androidx.test.runner.AndroidJUnitRunner | tee "android-evidence/$sv_method.txt"
  sv_command_result=${PIPESTATUS[0]}
  kill "$sv_watchdog_pid" 2>/dev/null || true
  wait "$sv_watchdog_pid" 2>/dev/null || true
  if [ "$sv_command_result" -ne 0 ] || ! grep -Eq 'OK \([0-9]+ tests?\)' "android-evidence/$sv_method.txt"; then
    sv_test_result=1
    echo "SV_SMOKE_FAILED_METHOD=$sv_method exit=$sv_command_result"
    timeout 15 adb shell dumpsys activity lastanr > "android-evidence/$sv_method-lastanr.txt"
    timeout 15 adb shell dumpsys cpuinfo > "android-evidence/$sv_method-cpu.txt"
    timeout 15 adb shell dumpsys meminfo > "android-evidence/$sv_method-memory.txt"
    timeout 15 adb shell dumpsys media.camera > "android-evidence/$sv_method-camera.txt"
    timeout 15 adb exec-out screencap -p > "android-evidence/$sv_method-screen.png"
  fi
done
cat android-evidence/aUnpaidCloudRequestDoesNotUpload.txt android-evidence/bCanvasRecordingReplayAndNativeSave.txt android-evidence/cCameraReplayAndMediaStoreRoundTrip.txt android-evidence/dActualPreRollCapture.txt > android-evidence/instrumentation.txt
exit "$sv_test_result"
