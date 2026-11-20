# SV-MOBILE — PC R15 Mobile Integration (2026-11-20)

## Source and scope
- Existing `index.html` remained the base. Prior Android/mobile camera, MediaRecorder, replay, WMC postMessage, and UI tabs were preserved.
- Transplanted original PC R15's observed golfer tracker, side-on seven-factor ADDRESS calculation (including actual same-side knee/ankle), and 50 ms side-only temporal gate into isolated JS modules.
- Added the R15 side view FRONT/SIDE visual confirmation and user switch for R15 50ms motion. The mobile R15 motion switch defaults on; disabled uses the legacy strict single-frame gate.
- R15 V-zone checkbox defaults OFF; when selected, replay joint analysis also supplies the same R15 shaft and ball visual evidence module to the replay overlay. No fabricated detected ball.
- Camera 1/2 and replay/recording implementations remain SV-MOBILE's own, not Windows scripts.

## Validation performed
- Node.js parsing of all three extracted modules.
- Chromium synthetic pose fixture: tracked SIDE with 7/7 side ADDRESS and confirmed orientation; tracked FRONT without side gate; 50ms temporal gate triggered only when enabled.
- Existing 24 inline `index.html` JavaScript blocks compiled after 12 minimal integration substitutions.
- GitHub stage branch readback for index + three modules; 10 expected function hooks present.

## Limitations
- Real Android Venus/phone camera test, false-positive controls, two physical cameras, MediaRecorder save, and Google Apps Script production WMC UI verification: UNKNOWN.
- This web deployment does not generate/sign/publish a new APK or Google Play bundle.
- WMC-TAB R6 source already links Personal Training to https://tup-golf-sv.github.io/SV-MOBILE/; keeping the same URL avoids editing WMC member data, coupon or attendance logic.
- R16 experimental recognition thresholds were not introduced.

## Rollback
Revert the integration commit(s) on `main`; no WMC source or database mutation is required.
