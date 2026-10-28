# SV MOBILE Android development

This branch is isolated from production. Do not merge or publish without owner approval.
The Gradle `syncWebApp` task copies the repository's existing `index.html` byte-for-byte.
No camera, swing detection, skeleton, trajectory, ghost or replay algorithm was rewritten.
Native additions: origin-restricted message channel, scoped MediaStore storage, Play Billing
8.3 subscription flow, Firebase account login, server verification and private Pro video vault.
Existing web features and local saves remain free. The vault is an added Pro feature, not a
claim about a previously agreed commercial plan or price.

## Build

Java 17, Android SDK 35, Gradle 8.10.2:

    gradle -p androidapp assembleDebug bundleRelease assembleDebugAndroidTest lintDebug
    gradle -p androidapp connectedDebugAndroidTest

Android 10+; debug signing is development-only. Release AAB is unsigned.
`SV_API_BASE` (HTTPS) and `SV_FIREBASE_API_KEY` configure billing-account connectivity
at build time. Defaults are blank: free features work; purchases and vault fail closed.
No production credentials, private keys, signing keys or paid accounts are created here.

## Owner-controlled integrations

- Play Console app for `kr.co.tupgolf.svmobile`, signing identity and internal testers.
- Active subscription ID `sv_mobile_pro`, base plan and owner-approved price/terms.
- Firebase project with email/password authentication, Android API restrictions and account recovery.
- Private HTTPS deployment of `server/`, persistent `/data`, backups, storage policies,
  workload identity with Play access. Firebase project ID and API key must match Android.
- Authenticated Pub/Sub push to `/v1/play/rtdn`, audience and service-account email.
- `SV_ADMIN_UIDS` defines operator access; `/operator` displays Google order data.
- Privacy policy, data deletion, store declarations, identity verification and release signing
  remain release prerequisites. No publicly deployed service or production release is implied.

## Test evidence scope

Python tests mock Google responses to verify access enforcement and state transitions.
Android instrumentation uses an emulated camera to check model callbacks, camera video
encoding, replay and actual MediaStore writes. It is not a real golfer or real purchase test.
A passing build is not proof of installation on a customer's phone, automatic swing detection,
Play checkout, refund delivery, server availability or settled revenue.
