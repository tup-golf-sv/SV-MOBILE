# SV MOBILE verification — 2026-10-29 (KST)

Starting source: android-release-build, def404bce552c7d50847a281379c8b2563fe796f, PR #3.

## Implemented and executed

- Reject checkout before opening Play if server productId differs from APK PRO_PRODUCT.
- Java regression: matching accepted; wrong, empty and null IDs rejected.
- Backend: 29 tests passed, using mocked Google responses. Added active/draft/inactive plan and acknowledgement-failure checks.
- Android build: assembleDebug, bundleRelease, assembleDebugAndroidTest, lintDebug passed with Java 17 / Gradle 8.11.1 / Android SDK 36. APK v2 signature verification passed.
- Existing web index.html remains byte-identical to packaged assets and starting source.
- New APK SHA256: d00d48bf8e71cea0caf7eda9784cff5e1bc1ec81f61fc50c351746cc7916ac7a.
- Emulator script now isolates each test method and collects ANR/CPU/memory/camera evidence on failure. Shell syntax passed; updated instrumentation execution is pending CI.

## Evidence limits

Previous CI 40740288282 build succeeded; full emulator job failed. Direct artifact inspection confirms unpaid cloud denial and canvas recording/replay/MediaStore save (28,377 bytes). Camera connection and model callback occurred before timeout. Root cause remains UNKNOWN; no camera or detection algorithm changed.

No Android physical device is attached (`adb devices` empty). Actual golfer detection, skeleton/trajectory rendering and automatic replay on physical Android remain UNKNOWN. Synthetic landmark regression passed 8 cases; this is not a golfer test.

FREE in existing implementation: current web features and local saves. PRO implementation: private video vault. Commercial feature/price approval remains pending. Google Play purchases, renewals, restore, cancellation/refund, paid customers and revenue are UNKNOWN; no actual payment or release was executed.

Play Console was read after authentication. The owner subsequently confirmed address evidence has been submitted and Google review is pending. Do not resubmit or treat the earlier screen as current. No consent/upload was executed by this agent.

Firebase, private HTTPS backend, Play service identity/RTDN, release signing and internal testing must be connected before real billing validation. No credentials committed.

Daily 30-run measurement scheduling was attempted but rejected by the five-active-task plan limit. Existing tasks were left intact. No background work is claimed.

No WMC/Sheets/Apps Script, production URLs, Friends or sensor settings were changed. PR stays draft; no merge or public release.

## Work continued during address review

- Real local HTTP startup with SV/Google credentials removed: health 200; seven protected paths 503 (fail closed). Raw non-sensitive results are in http-unconfigured-results-2026-10-29.json. Server stopped after test.
- Added scripts/check-release-config.py: read-only checks for missing settings, HTTPS backend, RTDN audience and package/product identity. Current environment is BLOCKED; script prints no secret values and does not make external requests.
- Android instrumentation now uses WebView.post with bounded callback waits and explicit stage logs. Per-method shell limits include all sequential stage budgets; overall CI limit is 30 minutes.
- Updated instrumentation APK compiled successfully in an isolated copy: assembleDebugAndroidTest, 45 tasks, 27 seconds. Shell syntax, YAML parse, simulated all-pass exit 0 and simulated assertion-failure exit 1 passed. This does not demonstrate physical camera/golfer success.
- Remote push was rejected by automatic approval review: broad continuation was not accepted as specific remote-write authorization. Changes remain local; no workaround attempted. Remote PR head remains unmodified as last verified.

## 0.2.1-dev follow-up

- VersionCode 3 / versionName 0.2.1-dev; assembleDebug, bundleRelease,
  assembleDebugAndroidTest and lintDebug all succeeded (115 tasks, 1m34s).
- APK SHA256: 98ed84be12db6a5063092bee1f1ef590cd7c3ac629f317b7e04309e752da53ab.
  APK signature verification passed and packaged index.html equals the original.
- Checkout now selects only non-installment, single-phase, auto-renewing base
  plans. Other plan types are rejected instead of being mislabeled auto-renewing.
- LifecycleTasks guards queued/late Billing callbacks after Activity destruction.
  Removed readiness early returns that prevented Billing auto-reconnection APIs.
- Password-reset menu invokes Firebase PASSWORD_RESET only on the user's action.
  No recovery email was sent during development.
- Pure Java: five plan-selection cases and three lifecycle scenarios passed.
  Existing backend suite remains 29 passing mocked-Google tests.
- Actual Play checkout/reconnection, password-reset delivery and physical golfer
  testing remain UNKNOWN. Account deletion request/processing remains missing.
  Official requirement reference: https://support.google.com/googleplay/android-developer/answer/13327111
- Internal-only marketing/store drafts and official B2B comparison are in
  marketing-draft.md and b2b-reference-2026-10-29.md. No publication or outreach.

### Alternative Android execution attempt

Official emulator and API29 image downloads (870,710,076 bytes) were checksum
verified. A headless x86 AVD was actually started using software TCG without KVM.
After 300 seconds it remained `emulator-5554 offline`, with no boot completion.
App installation and instrumentation were not reached; the guest boot root cause
is UNKNOWN. Available host resources did not establish memory/disk exhaustion.
Owned emulator/adb processes were terminated after the bounded attempt.
This is an execution-environment failure, not evidence that the app passed or
failed its camera/golfer workflow.

## 0.2.2-dev — work continued on blocked items

- Added docs/blocked-work.md with ten blocked work items, evidence, resolution
  paths and dependencies. No blocked remote operation was retried or bypassed.
- Implemented authenticated deletion request receipts, public request page,
  Android account-menu link and admin-only receipt listing. Confirmation must be
  literal true; client-supplied UID is rejected; repeat requests are idempotent.
  Pro subscription is not required. Receipt status is RECEIVED and
  deletionCompleted is false; no actual account/video deletion or cancellation.
- Backend tests: 41 passed (Google/Firebase mocked). UI test: seven simulated
  request/authentication/error scenarios passed with no external requests.
- Real localhost HTTP verified receipt, duplicate receipt, authentication denial,
  UID injection rejection and admin isolation using test authentication only.
  Evidence: http-deletion-results-2026-10-29.json.
- VersionCode4 / 0.2.2-dev: APK/AAB/instrumentation APK/lintDebug all succeeded in
  1m03s (115 tasks). APK signature verified, web source remains byte-identical.
- Physical camera, real Firebase connection, actual Play payment and actual
  deletion processing remain UNKNOWN / unfinished as listed in blocked-work.md.

## Approved remote CI17

The owner explicitly authorized development-branch upload and CI. Shell push had
no credentials, so connected GitHub APIs uploaded the same 25 files. Remote tree
0682b027bc061e6853dbc88efa90a6cb9f7f05f7 equals the local verified tree exactly.
Commit 9af2fde6e753ac784da5a73151f90001fcd5fd8b, run 40817518315.

Remote build passed: backend 41, simulated UI 7, product guard and plan/lifecycle
regressions; APK/AAB/test APK/lint and signature/original-source checks passed.
Emulator unpaid-cloud denial and canvas record/replay/MediaStore save passed.
Camera test failed after roughly 12 seconds during model wait: 10-second
JavaScript callback timeout. Earlier evidence showed model callback approximately
21 seconds after camera connection. Renderer crash logged after teardown is not
evidence of the initiating cause. No ANR or memory exhaustion was established.

Next test-only correction: model startup uses a 60-second callback budget within
the unchanged 120-second total deadline. Other stages retain 10 seconds; timeout
logs UI queue entry, evaluation return and main-thread stack. Added forced-trigger
production pre-roll encoding test. This does not validate real golfer detection.

The disabled deletion worker now has local simulated-Google state-transition,
retry/isolation and RTDN-race tests: total backend suite 56 passed. Real Google
deletion and operational retention/backup/notification policy remain unverified.
