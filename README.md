# Copycat · 필터 실험실

이미지를 불러와 iOS로 이식 가능한 색감 필터를 실험하는 로컬 웹 도구입니다. React 19, Astryx neutral 다크 테마, WebGL2를 사용합니다. 서버 업로드, DB, 분석 도구, 외부 CDN 요청은 없습니다.

## 실행

Node.js 22.13 이상이 필요합니다.

```sh
npm install
npm run dev
```

터미널에 표시되는 `http://127.0.0.1:3000`을 Chrome 또는 Safari에서 엽니다. 종료는 터미널에서 `Ctrl+C`입니다. HTML 파일 더블클릭이 아닌 로컬 개발 서버 방식이며, 파일을 외부에 전송하지 않습니다. 의존성을 설치한 뒤에는 인터넷 없이 사용할 수 있습니다.

```sh
npm run build
npm start
```

위 명령은 로컬 production 빌드 실행입니다. 배포 설정이나 계정은 필요하지 않습니다.

## GitHub Pages 배포

기존 서버 빌드와 별도로 `npm run build:pages`가 `dist-pages/`에 정적 사이트를 생성합니다.
`npm run preview:pages`로 http://127.0.0.1:4173/ 에서 결과를 확인할 수 있습니다.
현재 Pages 빌드는 `https://kapyket.github.io/` 루트 경로용입니다.

배포 설정은 별도 [Kapyket/kapyket.github.io](https://github.com/Kapyket/kapyket.github.io)
저장소에서 관리합니다. 이 저장소의 변경을 먼저 `main`에 push한 뒤,
사이트 저장소의 Actions에서 **Deploy Filter-Web to GitHub Pages → Run workflow**를 실행하세요.
`filter_ref`로 배포할 브랜치·태그·커밋을 선택할 수 있습니다. 앱 저장소의 push만으로 사이트가 갱신되지는 않습니다.

정적 진입점은 `index.html`, `pages/main.tsx`이며 기존 `app/page.tsx`와 필터 코드를 그대로 재사용합니다.
HTML 제목·설명·테마를 변경할 때는 `app/layout.tsx`와 `index.html`을 함께 수정하세요.

## 사용 방법

1. JPEG·PNG·WebP·HEIC 파일 한 장을 선택하거나 미리보기 영역에 놓습니다.
2. 프리셋을 선택하거나 7가지 슬라이더·숫자 입력을 조정합니다. 숫자는 Enter 또는 포커스를 옮길 때 확정됩니다.
3. 원본 비교 스위치와 비교 위치 슬라이더로 차이를 확인합니다.
4. 보정 이미지를 PNG/JPEG로 저장하거나 JSON 설정을 저장합니다. 저장한 JSON은 다른 사진에서도 불러올 수 있습니다.

사진과 설정은 메모리에만 유지되므로 새로고침 전에 필요한 결과를 저장하세요. 다른 사진을 불러오면 현재 필터 설정이 유지됩니다. PNG는 투명도를 유지하고 JPEG는 흰색 배경·품질 95%로 저장합니다. 원본 메타데이터는 내보내지 않습니다.

파일 제한은 80MB, 디코딩 후 8천만 픽셀입니다. 미리보기는 긴 변 2,048px까지 축소합니다. 저장은 GPU 최대 크기와 2,400만 픽셀의 보수적인 메모리 한도를 사용하며, 초과하면 출력 크기를 표시하고 명시적인 축소 선택을 받습니다. 저장 실패 시 2,048px 축소 재시도를 제안합니다.

HEIC는 첫 정지 이미지만 8비트 SDR로 변환합니다. HDR·광색역·gain map을 사진 앱과 동일하게 재현하는 도구는 아닙니다. 디코더가 지원하지 않는 파일은 오류로 안내합니다. 브라우저의 WebGL2 그래픽 가속이 필요합니다.

## iOS 이식

[필터 계약과 수식](docs/ios-porting.md), [기준 입출력 벡터](docs/reference-vectors.json)를 참고하세요. 같은 수식을 Metal/Core Image 커스텀 커널로 구현하는 방식을 전제로 합니다. iOS 내장 필터 이름을 일대일 매핑하는 방식은 아닙니다. Swift/Metal 앱 코드는 포함하지 않습니다.

## 검증

```sh
npm run typecheck
npm run lint
npm test
npm run test:browser
```

브라우저 테스트는 macOS에 설치된 Google Chrome을 우선 사용합니다. 없는 환경에서는 `npx playwright install chromium`으로 테스트 브라우저를 설치합니다. WebKit 테스트는 `npx playwright install webkit` 후 `npm run test:webkit`으로 실행합니다.

테스트 데이터는 직접 생성한 색상 패턴으로, 개인 사진을 포함하지 않습니다. `tests/fixtures/README.md`에 각 파일의 목적을 기록했습니다. UI는 데스크톱 우선이며 좁은 화면에서는 조정 패널이 아래로 이동합니다.

표준 WebMCP를 지원하는 브라우저에서는 `get_filter_recipe`, `set_filter_settings` 도구도 같은 설정 상태에 연결됩니다. 미지원 브라우저에서는 일반 UI를 사용합니다.

## 주요 코드

- `app/page.tsx`: 업로드·비교·조정·저장 작업 화면
- `lib/filter/`: 설정 계약, CPU/GPU 수식, 이미지 디코딩과 HEIC Worker
- `docs/ios-porting.md`: iOS 이식 규칙과 디코딩 제한

Astryx는 MIT, heic-to는 LGPL-3.0 라이선스로 제공됩니다. 패키지 원본은 node_modules 및 각 프로젝트 저장소에서 확인할 수 있습니다.
