# PROFCYS 통합 업무지원 플랫폼 (PROFCYS Gateway)

**PROFCYS Integrated Business Support Platform.** 아이디·비밀번호 하나로 PROFCYS의 업무 서비스(Apps Script 웹앱 등)를 권한에 따라 이용하는 통합 포털입니다.

- 대표 주소(예정): `https://profcys.web.app` (Firebase 무료 기본 도메인)
- 상태: **배포 준비 완료 (미배포)**. 실제 Firebase 프로젝트 배포와 기존 Apps Script 연동은 [설치·배포 가이드](docs/02-설치-배포-가이드.md)에 따라 소유자 계정으로 진행해야 합니다.
- 운영비: **월 0원 구조** (Firebase Spark + Google Apps Script). 결제 계정·유료 API를 사용하지 않습니다.

## 주요 기능
- 관리자 발급 계정만 로그인(자체 회원가입 없음), 최초 관리자 `profcys`는 1회용 설정 토큰으로 비밀번호 직접 지정
- 비밀번호 미저장(Firebase Auth 해시), 5회 실패 잠금, 60분 미사용 자동 로그아웃, 12시간 최대 세션
- 역할(최고관리자·운영관리자·일반 사용자) + 서비스별 권한(개별 지정·관리자·조건·전체) + 거부 목록
- **코드 수정 없이** 업무 서비스 추가·수정·공개·점검·예약·보관·삭제 (초안 → 공개 승인), URL 안전성 검증(SSRF 방지)
- 하나의 `DynamicServiceCard`와 서비스 수·화면 너비 기반 **자동 레이아웃**(PC/태블릿/모바일, 가로 스크롤 없음)
- 화면 구성 편집기(PC·태블릿·모바일 실시간 미리보기, 기본 디자인 복원, 변경 이력)
- 공지사항, NEW 배지, 즐겨찾기·최근 사용·검색·카테고리 필터, 알림
- 접속 기록·관리자 작업 이력·운영 통계·CSV 내보내기, JSON 백업·안전한 복원, 접속 QR코드, PWA
- 기존 Apps Script용 **통합 인증(SSO) 공통 모듈**: 60초 1회용 코드, 서버 간 검증, 권한 회수 5분 내 반영

## 폴더 구조
```
src/                      React + TypeScript 프런트엔드 (사용자·관리자 화면)
apps-script/gateway-api/  게이트웨이 API (Apps Script 웹앱) — 인증·권한·서비스·SSO·로그·통계·백업
apps-script/shared-auth/  기존 업무 Apps Script용 공통 인증 모듈 ProfcysAuth.js + 적용 가이드
dev/                      로컬 개발 서버(메모리 DB로 실제 서버 코드 실행)
tests/                    단위·통합(vitest)·E2E(Playwright) 테스트
docs/                     설계·설치·매뉴얼·보안·운영·테스트 보고서
firebase.json, firestore.rules, firestore.indexes.json, .firebaserc
```

## 빠른 시작 (로컬, Google 계정 불필요)
```bash
npm ci
npm run dev        # http://localhost:5173 → 콘솔의 설정 토큰으로 /setup
npm test           # 단위·통합 105건
npm run build && npm run test:e2e   # 브라우저 E2E 17건
```

## 문서
1. [아키텍처·DB·권한·SSO 설계](docs/01-아키텍처.md)
2. [설치·배포 가이드 (Firebase 무료)](docs/02-설치-배포-가이드.md)
3. [관리자 매뉴얼](docs/03-관리자-매뉴얼.md)
4. [사용자 매뉴얼](docs/04-사용자-매뉴얼.md)
5. [운영·장애 대응·비용](docs/05-운영-장애대응-비용.md)
6. [보안 점검표](docs/06-보안-점검표.md)
7. [테스트 보고서](docs/07-테스트-보고서.md)
8. [기존 Apps Script 통합 인증 적용 가이드](apps-script/shared-auth/README.md)

## 보안 원칙
- 비밀번호·서비스 키·세션 토큰 원문을 코드·DB·로그·문서·저장소에 남기지 않습니다. 이 저장소에도 없습니다.
- 브라우저는 Firestore에 직접 접근하지 않으며, 모든 요청은 서버에서 계정·권한·서비스 상태를 다시 검증합니다.
- 초기 4개 업무 서비스 URL은 명세 그대로 등록되며, 기존 서비스의 데이터·배포·권한 설정은 변경하지 않습니다.
