# iOS 필터 이식 규격

이 문서는 `copycat-linear-v1`의 고정 계약이다. 웹 구현은 WebGL2, iOS 이식 대상은 Metal 또는 Core Image 커스텀 커널이다. 같은 이름의 내장 CIFilter로 대체하면 수식이 달라질 수 있으므로 아래 연산을 그대로 구현한다. iOS 앱 코드와 실기기 교차 검증은 이 프로젝트에 포함하지 않는다.

## 입력과 출력

- 입력: 방향 보정 및 SDR sRGB 정규화가 끝난 이미지. 채널 순서 RGBA, 각 값 0~1, **straight/unassociated alpha**.
- 출력: SDR sRGB RGBA. 알파를 변경하지 않는다. 연산 도중 알파를 RGB에 곱하지 않는다.
- GPU 텍스처: 웹은 RGBA8에 **sRGB 부호화 값**을 업로드하고 셰이더에서 직접 선형화한다. Metal에서 같은 방식으로 옮긴다면 `rgba8Unorm`을 사용하고 `rgba8Unorm_srgb`의 자동 변환과 수동 변환을 중복하지 않는다.
- Core Image를 사용한다면 작업 색 공간을 명시하고, 커널에 들어오는 값이 이미 선형인지 확인한다. Core Image의 premultiplied alpha 입력은 연산 전에 unpremultiply, 출력 시 premultiply한다. alpha=0이면 RGB는 0으로 취급한다.
- 좌표 `u=(x+0.5)/width`, `v=(y+0.5)/height`. 원점은 이미지 왼쪽 위이며 픽셀 중심을 샘플링한다. iOS의 좌표 원점이 다르면 변환한다.
- 8비트 입력/출력 양자화 외에는 float32로 계산하고, 지정된 마지막 단계 전까지 clamp하지 않는다. 웹은 GPU 디더링과 블렌딩을 끈다.

## 설정 파일

```json
{
  "version": 1,
  "pipeline": "copycat-linear-v1",
  "colorSpace": "srgb",
  "settings": {
    "exposure": 0,
    "contrast": 1,
    "saturation": 1,
    "temperature": 0,
    "tint": 0,
    "fade": 0,
    "vignette": 0
  }
}
```

`version`은 파일 구조 버전, `pipeline`은 처리 수식 버전이다. 수식이나 순서 변경은 새 pipeline ID로 구분한다. 모든 옵션은 필수이며 NaN, Infinity, 문자열 숫자, 누락·추가 옵션, 범위를 벗어난 값은 거부한다. 알려지지 않은 버전·파이프라인·색 공간도 거부한다. 잘못된 파일을 가져와도 현재 설정은 보존한다. 숫자 입력의 표시 자릿수와 관계없이 JSON은 실제 내부 값을 저장한다.

| 옵션        |    범위 | 기본값 | UI 간격 |
| ----------- | ------: | -----: | ------: |
| exposure    | -3~3 EV |      0 |    0.05 |
| contrast    |     0~2 |      1 |    0.01 |
| saturation  |     0~2 |      1 |    0.01 |
| temperature |    -1~1 |      0 |    0.01 |
| tint        |    -1~1 |      0 |    0.01 |
| fade        |     0~1 |      0 |    0.01 |
| vignette    |     0~1 |      0 |    0.01 |

색온도는 Kelvin이 아닌 상대 조정값이다. 양수는 빨강 증가/파랑 감소, 틴트 양수는 마젠타 방향이다. UI 간격은 슬라이더 이동 단위이며 JSON의 합법적인 중간값을 반올림하지 않는다.

## 고정 처리 순서

`c`는 RGB 벡터다. 스칼라 덧셈·곱셈은 각 채널에 적용한다.

1. **sRGB → 선형 RGB**: 채널 `s ≤ 0.04045`이면 `s/12.92`, 그 외 `((s+0.055)/1.055)^2.4`.
2. **노출**: `c = c * 2^exposure`.
3. **색온도·틴트**: 아래 gain을 채널별로 곱한다.
   - R: `2^(0.35*temperature + 0.15*tint)`
   - G: `2^(-0.30*tint)`
   - B: `2^(-0.35*temperature + 0.15*tint)`
4. **대비**: `c = (c - 0.18) * contrast + 0.18`.
5. **채도**: `y = dot(c, [0.2126, 0.7152, 0.0722])`, `c = y + (c-y)*saturation`.
6. **페이드**: `c = c*(1-0.5*fade) + 0.18*0.5*fade`.
7. **비네팅**: `r = length([2u-1, 2v-1])/sqrt(2)`, `t = clamp((r-0.25)/0.75, 0, 1)`, `c = c*(1-vignette*t*t*(3-2*t))`.
8. **출력 범위 제한**: `c = clamp(c, 0, 1)`.
9. **선형 RGB → sRGB**: 채널 `c ≤ 0.0031308`이면 `12.92*c`, 그 외 `1.055*c^(1/2.4)-0.055`.
10. 입력 알파를 그대로 붙인다. RGBA8 저장 시 `round(channel*255)`에 해당하는 정규화 변환을 한다.

비네팅은 이미지 종횡비에 맞춰 늘어난 타원 형태이며 해상도와 무관하다. 원본/보정 비교는 표시 전용이다. JSON과 저장 결과에는 분할 위치가 반영되지 않는다.

## 기준 데이터와 비교 방법

- `docs/reference-vectors.json`: 정규화된 입력 RGBA, UV, 설정, 예상 출력 float 및 RGBA8.
- `lib/filter/reference.ts`: CPU 기준 구현.
- `lib/filter/renderer.ts`: 웹 GPU 구현.
- 브라우저 테스트는 모든 옵션의 양 끝값과 프리셋을 CPU와 비교한다. 허용 차이는 8비트 채널당 1이다. 알파는 보존되어야 한다.
- iOS에서는 **같은 입력 픽셀**을 커널에 넣고 렌더 결과를 읽어서 비교한다. 사진 앱의 화면 캡처끼리 비교하는 방식은 색 관리와 화면 밝기 차이를 포함한다.
- 기본 설정은 RGB 항등 변환이다. Canvas의 premultiplication 왕복 때문에 반투명 픽셀은 소량 반올림될 수 있으며 완전 투명 픽셀의 숨겨진 RGB는 보존 대상이 아니다.

## 사진 디코딩의 한계

JPEG/PNG/WebP는 브라우저 디코더가 EXIF 방향과 색 프로필을 처리하고 sRGB Canvas로 정규화한다. HEIC는 `heic-to` 1.5.2가 libheif로 첫 최상위 정지 이미지를 RGBA8로 디코딩한다. gain map, depth, Live Photo 동영상은 사용하지 않는다.

**HEIC 변환 결과는 SDR 실험용이다.** heic-to가 제공하는 RGBA8에는 원본 ICC/NCLX 프로필과 HDR gain map 처리 계약이 노출되지 않는다. 따라서 모든 HDR/P3 HEIC를 사진 앱과 동일하게 톤 매핑·색 관리한다고 보장할 수 없다. 웹은 이 제한을 화면에 표시한다. 네이티브와 필터 자체를 비교할 때는 웹에서 정규화한 SDR 원본 PNG를 기준 입력으로 사용하거나, 양쪽에 동일한 SDR 입력 픽셀을 제공해야 한다.

미리보기는 긴 변 최대 2,048px로 먼저 축소한 뒤 필터를 적용한다. 저장은 원본 크기에 필터를 적용한다. 축소 리샘플링과 비선형 필터의 처리 순서 때문에 픽셀 단위 미리보기/저장 결과의 완전 일치는 요구하지 않는다. 공통 UV에서의 수식과 연산 순서가 동일해야 한다.

## 관련 공식 문서

- [Apple: Writing Custom Kernels](https://developer.apple.com/documentation/coreimage/writing-custom-kernels)
- [Apple: workingColorSpace](https://developer.apple.com/documentation/coreimage/cicontext/workingcolorspace)
- [heic-to 소스 및 사용법](https://github.com/hoppergee/heic-to)
