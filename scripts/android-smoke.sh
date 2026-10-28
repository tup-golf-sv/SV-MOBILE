#!/usr/bin/env bash
# Install and test the exact APK bytes produced by the build job.
set -uo pipefail
mkdir -p android-evidence
adb install -r -g ci-artifacts/outputs/apk/debug/app-debug.apk || exit 1
adb install -r -g ci-artifacts/outputs/apk/androidTest/debug/app-debug-androidTest.apk || exit 1
adb shell am instrument -w kr.co.tupgolf.svmobile.test/androidx.test.runner.AndroidJUnitRunner | tee android-evidence/instrumentation.txt
sv_test_result=${PIPESTATUS[0]}
adb shell dumpsys package kr.co.tupgolf.svmobile > android-evidence/installed-package.txt
adb shell content query --uri content://media/external/video/media > android-evidence/media-store.txt
adb logcat -d > android-evidence/logcat.txt
adb pull /sdcard/Android/data/kr.co.tupgolf.svmobile/files/android-smoke.png android-evidence/android-smoke.png
# am instrument may exit zero even when an assertion fails; require explicit JUnit success.
if ! grep -Eq 'OK \([0-9]+ tests?\)' android-evidence/instrumentation.txt; then exit 1; fi
exit "$sv_test_result"
