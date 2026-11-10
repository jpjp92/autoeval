# 프론트 의존성 보안 검토

검토일: 2026-11-09. npm registry와 npm audit 조회 결과 기준이며 이후 공지는 재확인한다.

## Next.js

- 설치·lock 버전: 16.4.5, npm latest 태그와 일치.
- package.json 최소 범위: ^16.4.5.
- 공식 2026-11-03 보안 공지의 패치 버전은 16.4.5이다.
- 현재 npm audit 결과에는 next 직접 취약점 항목이 없다.
- App Router를 사용하며 운영·개발 모두 현재 환경 호환을 위해 Webpack 옵션을 사용한다.
  번들러 선택 자체가 보안 패치를 대신하지는 않는다.

공식 근거: [November 2026 Security Release](https://nextjs.org/blog/november-2026-security-release),
[October upstream security update](https://nextjs.org/blog/nextjs-security-update-october-14-2026).

## 남은 audit 항목

| 패키지 | 심각도 | 사용 경로 |
| --- | --- | --- |
| xlsx | High | 브라우저 XLSX 내보내기 |
| browserslist | High | autoprefixer 개발 의존성 |
| baseline-browser-mapping | Moderate | Next.js 및 browserslist의 전이 의존성 |
| esbuild | Low | tsx 개발 의존성 |

총 4개 패키지 항목이다. Next.js의 패치 확인과 전체 의존성 취약점 해소는 구분한다.
현재 xlsx 코드는 파일 읽기 없이 내보내기에 사용하지만 audit 경고를 해소한 것은 아니다.
자동 수정 가능한 항목은 별도 업데이트 후 검증하고, xlsx는 audit 기준 자동 수정 대상이 없다.
이번 검토에서는 위 의존성 버전을 변경하지 않았다.

## 재검토 명령

frontend 디렉터리에서 실행한다.

```bash
npm ci
npm audit
npm view next dist-tags --json
npm run lint
npm run build
```

Docker 배포 시 기존 이미지를 재사용하면 새 lock 파일이 반영되지 않으므로
client 이미지를 재빌드한다. 실제 배포 플랫폼의 버전과 환경변수도 확인한다.
