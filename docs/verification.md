# 검증 결과

검증일: 2026-09-08. macOS에서 실행.

| 검사                          | 결과                                 |
| ----------------------------- | ------------------------------------ |
| TypeScript                    | 통과                                 |
| Oxlint                        | 통과                                 |
| Vitest 단위 테스트            | 11개 통과                            |
| Chrome 브라우저 테스트        | 10개 통과                            |
| Playwright WebKit 26.6 테스트 | 10개 통과                            |
| production build              | 통과                                 |
| production Chrome             | PNG·HEIC 불러오기 및 PNG 저장 통과   |
| production WebKit             | PNG·HEIC 불러오기 및 PNG 저장 통과   |
| production 외부 네트워크 차단 | 두 브라우저 모두 외부 요청 없이 동작 |

브라우저 테스트 범위: Astryx UI, 프리셋·숫자 조정, JSON 왕복 및 잘못된 설정 보존, CPU/GPU 색상 비교, EXIF 방향, 반복 업로드, WebP, 손상 파일, SDR HEIC, PNG 투명도, JPEG 흰색 배경, GPU 제한·미지원, 축소 저장 동의, HEIC 작업 교체, 좁은 화면, 선택적 WebMCP 계약.

GPU 기준 비교는 옵션 최솟값·최댓값 및 모든 프리셋에 대해 8비트 채널 오차 1 이내로 통과했다. iOS 이식용 고정 벡터 30개도 CPU 기준과 일치한다.

WebKit 테스트는 Safari와 같은 엔진 계열을 사용하지만 설치된 Safari 앱 자체의 자동화 테스트는 아니다. 실제 iOS 앱 코드와 실기기 검증은 포함하지 않는다.

실제 아이폰의 HDR/gain-map/P3 HEIC 샘플은 제공되지 않아 검증하지 않았다. 일반 SDR HEIC fixture로 디코딩·저장 경로를 검증했으며, HDR/P3 색 관리 일치는 보장하지 않는다. 이 제한은 UI와 iOS 이식 문서에도 명시되어 있다.
