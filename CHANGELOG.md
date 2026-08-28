# 변경 기록

이 문서는 사용자에게 영향을 주는 주요 변경을 기록합니다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 참고하고, 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [Unreleased]

### 추가됨

- 디자인 설정만 담는 공유용 TOML 테마의 가져오기·내보내기·목록 적용
- 테마와 같은 폴더의 선택적 배경 이미지 공유 및 안전한 경로·형식 검증
- TOML에서 팔레트·타이포그래피·애니메이션·반경·간격·그림자를 세밀하게 조절하는 고급 디자인 토큰

### 변경됨

- 다음 개발 버전을 `0.1.1`로 올림

## [0.1.0] - 2026-08-28

### 추가됨

- 비밀번호·개인키 인증을 지원하는 SSH 접속과 SFTP 파일관리자
- 파일과 폴더의 재귀 업로드, 파일 다운로드, 서버 내 복사, 이동, 이름 변경과 삭제
- xterm.js 터미널과 CodeMirror 원격 코드 편집기
- 파일관리자·터미널·편집기·대시보드를 조합하는 분할 pane 작업 공간
- CPU, 메모리, 디스크, 네트워크 I/O, 프로세스와 Docker 상태 대시보드
- 간단/상세 대시보드 보기, 사용자 정의 위젯과 매크로
- 한국어·영어 UI와 배경·강조색·글꼴·동작 효과 테마 설정
- GitHub Actions 빌드·테스트·의존성 감사와 Dependabot 업데이트

### 보안

- 최초 연결 지문 승인과 이후 변경 감지를 포함한 SSH 호스트 키 검증
- 외부 스크립트, 프레임과 임의 네트워크 연결을 차단하는 Tauri CSP
- 비밀번호와 개인키 암호를 디스크에 저장하지 않는 접속 설정

### 참고

- 첫 공개 프리릴리스입니다.
- Windows를 주 개발 환경으로 사용하며 Fedora Linux에서 수동 실행을 확인했습니다. macOS는 아직 검증하지 않았습니다.

[Unreleased]: https://github.com/q09009/sshland/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/q09009/sshland/releases/tag/v0.1.0
