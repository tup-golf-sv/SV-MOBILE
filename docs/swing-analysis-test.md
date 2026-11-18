# SV‑MOBILE Android AI 스윙 분석 테스트

Android 기준 소스는 `android-release-build`의 `a6a79b1`이다. 이 기준의 `index.html`은 운영 `main`의 `1c75e4d`와 같은 파일이다. 기존 촬영 화면, 카메라·녹화·리플레이 처리와 Android 저장 연결 코드는 그대로 사용한다. AI 화면과 모델은 디버그 소스 세트에만 포함한다. 테스트 앱 ID는 `kr.co.tupgolf.svmobile.aitest`다.

## 첨부 APK 정적 분석

SwingProfile 15.5.5 (210), `com.swingprofile.swingprofile_android`. ZIP CRC 전체 검사와 APK v3 서명 검증을 통과했다. 첨부본은 ABI·화면 밀도 분할을 요구하는 base APK다. Flutter 코드의 네이티브 라이브러리가 포함된 분할은 제공되지 않았다.

| 기능 | 첨부 APK 또는 제작사 문서에서 확인한 근거 |
|---|---|
| 관절 인식 | `pose_landmarker_lite.task` 내부의 사람 검출 모델(224×224)과 관절 모델(256×256), DEX의 PoseLandmarker 참조 |
| 골프채 | `shaftend_gripshaft_320.tflite`는 320×320×3 입력과 후보별 박스·분류 출력 19,125개를 포함한다. 모델 라벨은 `background`, `hand and shaft`다. |
| 스윙 구간 | 내장 영상 세 개에 각 7개 기준 프레임 인덱스, 프레임 속도, 참조 좌표가 있다. 실제 시간 경계나 판정 임계값은 정적 근거로 확인할 수 없다. |
| 영상 분석 · A/B | 내장 데이터에 클럽 벡터, 기준 좌표와 한 샘플의 볼 추적 배열이 있다. 제작사 문서는 자동 녹화 영상의 동기화와 기준 프레임 수동 보정을 안내한다. |

APK의 실행 타이밍, 학습 모델 정확도, 실제 채 끝 궤적과 A/B 동기화 내부 계산은 확인 대상에 남아 있다. 첨부 앱의 코드, 모델, 샘플 영상, 디자인은 테스트 앱이나 저장소에 포함하지 않는다.

## 테스트 앱 사용

홈 화면의 **T.UP AI 스윙 분석**을 열고 0.65~12초의 저장 영상 한 개를 A에 추가한다. 갤러리의 **공유**에서도 열 수 있다. 같은 각도의 스윙 영상을 B에 추가하면 같은 구간의 두 자세를 비교할 수 있다.

Google ML Kit Pose Detection SDK가 프레임의 신체 관절을 기기에서 검출한다. 관절 판독에 성공한 프레임에서 손과 골반의 상대 이동으로 어드레스, 백스윙 시작, 톱, 다운스윙, 임팩트 추정, 피니시를 찾는다. 템포는 어드레스→톱과 톱→임팩트 추정의 시간 비율이다. 노란색 선은 연속 프레임의 영상 대비를 이용한 샤프트 후보이며, 클럽헤드 3D 좌표나 볼 접촉을 측정하지 않는다. A/B는 구간별 정지 프레임을 맞춰 비교한다.

- [Google ML Kit Android Pose Detection](https://developers.google.com/ml-kit/vision/pose-detection/android)
- [Google ML Kit 사용 조건 및 개인정보](https://developers.google.com/ml-kit/terms)
- [SwingProfile A/B 동기화 안내](https://www.swingprofile.com/tutorials/analyzing-swings/why-are-my-compared-swings-not-syncing/)

## 빌드와 회귀 테스트

JDK 17 이상, Gradle 8.11.1, Android SDK 36에서 실행한다.

```sh
gradle -p androidapp assembleDebug assembleDebugAndroidTest
classes=$(mktemp -d)
base=androidapp/app/src/debug/java/kr/co/tupgolf/svmobile
javac --release 17 -d "$classes" "$base/SwingPhases.java" "$base/ShaftTracker.java" scripts/tests/SwingAnalysisRegression.java
java -cp "$classes" kr.co.tupgolf.svmobile.SwingAnalysisRegression
cmp index.html androidapp/app/src/main/assets/index.html
```

Android 기기에서 `SwingAnalysisSmokeTest`로 분석 화면을 확인한다. 디코딩과 모델 추론을 확인하려면 대상 앱의 캐시에 테스트 동영상을 넣고 instrumentation에 `-e fixtures blank.mp4,swing.mp4`를 전달한다. `blank`로 시작하는 영상은 무인 판독을, 그 외 영상은 분석 구간 6개의 생성과 시간 순서를 검사한다. 실제 촬영 자세와 클럽 샤프트 정확도는 구간 타임스탬프를 눈으로 확인한 데이터로 별도 평가한다.
