# SSHland

초보자용 SSH/SFTP GUI 클라이언트. Tauri 2 (Rust) + React + TypeScript + Vite + Tailwind + zustand.

## 핵심 철학

- **가벼움 우선**: 무거운 의존성 추가 전 반드시 필요성을 따진다.
- **초보자 타겟**: 사용자에게 보이는 모든 에러는 기술 용어 없이 자연스러운 한글 문장이어야 한다 (`src-tauri/src/error.rs`에서 중앙 관리).
- **UI**: 미니멀 다크 테마.
- **파괴적 작업**(삭제 등)은 반드시 확인 다이얼로그를 거친다.
- **비밀번호는 메모리에만**: 디스크 저장 금지, 로그 출력 금지 (secret을 담는 타입엔 `Debug` derive 금지).

## 아키텍처

### 연결은 하나, 워커 스레드가 전부 소유

`ssh2` 크레이트(Windows에서 WinCNG 백엔드로 빌드되어 OpenSSL/Perl/NASM 불필요)는 세션이 **단일 스레드 전용**이라, SSH `Session` + `Sftp` + 모든 PTY 터미널 채널을 **하나의 Rust 워커 스레드**가 소유한다 (`src-tauri/src/ssh.rs`의 `worker_loop`).

- 프론트(Tauri async command)는 `std::sync::mpsc::Sender<Req>`로 요청을 보내고, `tokio::sync::oneshot`으로 응답을 받는다.
- 워커는 **협조적 폴링 루프**로 동작:
  - 열린 터미널이 없으면 `cmd_rx.recv()`로 블로킹 대기 (CPU 0%).
  - 터미널이 하나라도 열려 있으면 세션을 non-blocking으로 전환해 ~15ms(`TERMINAL_POLL`)마다 모든 채널을 폴링, 채널당 출력을 배치해서 `terminal-output` 이벤트로 한 번에 emit.
- SFTP 작업(목록/다운로드/업로드/이름변경/삭제/복사/mkdir)은 이 워커 안에서 블로킹으로 처리된다.
- 연결 끊김 감지: 아무 작업이 실패하면 `sftp.realpath(".")`로 저비용 왕복을 시도해 진짜 끊겼는지 확인 → 끊겼으면 `connection-lost` 이벤트 emit, 워커 종료.
- `copy`는 데이터가 클라이언트를 거치지 않도록 **서버 사이드에서 `cp -r`을 exec 채널로 실행**한다 (SFTP로 다운로드 후 재업로드하는 방식이 아님).

### 프론트엔드 상태 분리 원칙

- **전역 스토어(zustand, `src/store.ts`)**: 연결 정보, pane 트리(타일링), 전송(업/다운로드) 목록, 클립보드(복사), 드래그 상태, `fsVersion`(파일시스템 변경 브로드캐스트용 카운터).
- **파일관리자 pane별 로컬 상태**: 현재 경로, 목록, 로딩/에러, 보기모드, 숨김파일 토글은 각 `FilesScreen` 컴포넌트의 로컬 `useState`에 있다. **절대 전역 스토어에 두지 말 것** — 예전에 이걸 전역에 뒀다가 "파일관리자 두 개 열면 같이 움직이는" 버그가 났었다 (커밋 `78b3e13`).
  - 한 pane에서 파일 조작(삭제/이동/복사 등)을 하면 `bumpFs()`로 `fsVersion`을 올리고, 모든 `FilesScreen` 인스턴스가 이를 감지해 조용히 새로고침(`reloadSilently`)한다.

### 타일링 pane 트리 (Hyprland식, 일부 기능만)

`src/lib/panes.ts`에 순수 함수로 구현:
- `PaneNode` = `LeafNode`(`file-manager` | `terminal`) 또는 `SplitNode`(`horizontal`/`vertical`, `ratio`, 자식 2개인 이진 트리).
- `splitLeaf`/`removeLeaf`/`setLeafContent`/`updateRatio`: 트리 불변 연산.
- `collectRects`/`findNeighbor`: 방향키 포커스 이동용 기하 계산.
- `collectLayout`: 트리를 **평면 leaf 목록 + 절대좌표(%)**로 변환.

**중요 — 렌더링은 반드시 평면 구조로:** `src/components/PaneView.tsx`는 트리를 재귀적으로 중첩 렌더링하지 **않는다**. 대신 `collectLayout`으로 얻은 leaf들을 `key={leaf.id}`인 flat `<div>` 목록으로 절대 위치 배치한다. 이렇게 안 하면 트리 재구성(pane 닫기 등) 시 React가 컴포넌트 타입 변경으로 오인해 살아있어야 할 형제 터미널까지 언마운트(=PTY 채널 파괴)해버린다 (커밋 `cdd64a2`에서 수정한 실제 버그).

단축키 (`src/components/TilingShell.tsx`, capture phase로 등록):
- `Alt+Shift+H` / `Alt+Shift+V`: 포커스된 pane을 좌우/상하로 분할, 새 pane은 터미널로 열림
- `Alt+방향키`: 포커스를 인접 pane으로 이동
- `Alt+Shift+W`: 포커스된 pane 닫기 (마지막 pane은 안 닫힘)
- 분할선 드래그로 비율 조정, pane 헤더의 ⇄ 버튼으로 파일관리자 ↔ 터미널 전환

### 터미널 (xterm.js)

`src/components/TerminalPane.tsx`: PTY를 마운트 시 열고(`open_terminal`), 언마운트 시 채널만 닫는다(`close_terminal`, SSH 연결은 유지). 성능을 위해 **포커스 없는 터미널은 출력을 버퍼링해 ~200ms(5fps)마다 배치 flush**, 포커스된 터미널은 즉시 반영. 포커스를 받으면 즉시 flush.

## 파일 구조

```
src-tauri/src/
  ssh.rs      SSH/SFTP 세션 관리자 + 워커 루프 + 모든 Tauri command (connect, list_dir,
              download, upload, rename, mkdir, delete, copy, open/write/resize/close_terminal, disconnect)
  error.rs    기술 에러 → 친절한 한글 메시지 변환 (중앙 관리)
  lib.rs      Tauri Builder 설정, command 등록

src/
  store.ts              zustand: 연결/화면 전환/pane 트리/전송목록/클립보드/드래그/fsVersion
  api.ts                Tauri invoke 타입 래퍼
  lib/panes.ts           pane 트리 순수 함수 (분할/삭제/전환/비율/레이아웃/포커스탐색)
  lib/path.ts            경로 유틸 (join, parent, breadcrumb, baseName)
  lib/files.ts           sortEntries (폴더 우선 정렬)
  lib/format.ts          사람이 읽는 크기/날짜 포맷
  screens/ConnectScreen.tsx   접속 화면 (비밀번호/개인키, 로딩, 에러)
  screens/FilesScreen.tsx     파일관리자 pane 본체 (paneId prop, 완전히 로컬 상태)
  components/TilingShell.tsx  pane 트리 루트 + 전역 단축키 + 전역 이벤트 리스너(전송진행률/연결끊김)
  components/PaneView.tsx     pane 트리 → 평면 절대배치 렌더러 + 분할선 드래그
  components/TerminalPane.tsx xterm.js 터미널 (PTY 연결, 렌더 스로틀링)
  components/FileView.tsx     목록/자세히/큰아이콘 3가지 보기 (선택, 드래그시작, 우클릭 지원)
  components/Menu.tsx         메뉴바 드롭다운 (파일/편집/보기)
  components/ContextMenu.tsx  우클릭 컨텍스트 메뉴
  components/Modal.tsx        확인 다이얼로그 / 입력 다이얼로그
  components/DragLayer.tsx    드래그 중 커서 따라다니는 고스트 라벨
  components/TransfersPanel.tsx  업/다운로드 진행률 패널
  components/ShortcutsHelp.tsx   우하단 단축키 도움말
```

## 현재 상태 (2026-07-11 기준)

**Phase 1 — SSH 접속 + SFTP 파일관리자: 완료**
접속 화면, 목록(3가지 보기모드), 경로이동/breadcrumb/숨김파일, 다운로드/업로드(드래그앤드롭)/이름변경/삭제/새폴더/복사, 연결끊김 감지.

**Phase 2 — 터미널 + Hyprland식 타일링: 완료 (9단계 전부)**
PTY 스트리밍 → xterm pane → pane 트리+렌더러 → 분할 단축키 → 포커스이동 → 닫기 → 분할선 드래그 → pane 전환 → 비활성 pane 렌더 스로틀링.

**추가 개선 (사용자 피드백 기반, 완료):**
- 파일관리자 메뉴바(파일/편집/보기)로 툴바 정리, 단일 선택, 빈공간 우클릭(새폴더/붙여넣기), 파일 우클릭(복사/다운로드/이름변경/삭제)
- 앱 내부 드래그로 파일/폴더 아이콘을 다른 폴더나 다른 pane으로 옮기기 (SFTP rename)

**수정된 버그:**
- pane 닫을 때 살아남아야 할 형제 터미널까지 죽던 문제 (렌더링을 트리 재귀 → 평면 절대배치로 전환)
- 파일관리자 pane 두 개가 상태를 공유해서 같이 움직이던 문제 (전역 상태 → pane별 로컬 상태)
- 최초 진입 시 "불러오는 중..."에서 멈추는 문제 (React StrictMode 이중 실행 + `fsVersion` 가드가 불리언이라 생긴 경쟁 상태 → 값 비교 가드로 수정)

**남은 작업: 없음.** 사용자가 명시적으로 요청한 항목은 모두 구현·검증 완료. 다음 세션은 새 기능 요청이나 버그 리포트를 기다리는 상태.

## 알아두면 좋은 것

- 이 환경(Windows)에서 `create-tauri-app` CLI는 비대화형(non-TTY)에서 거부되어 프로젝트를 수동으로 스캐폴딩했다.
- 빌드: `npm run build` (프론트), `cd src-tauri && cargo build` (백엔드). 실행: `npm run tauri dev` (PowerShell에서 `$env:Path`에 `~/.cargo/bin` 추가 필요할 수 있음).
- React `<StrictMode>`가 켜져 있어(`src/main.tsx`) 개발 모드에서 마운트 이펙트가 두 번 실행된다 — 마운트 시 부수효과를 넣을 때 이 점을 반드시 고려할 것 (ref 기반 가드 사용, 불리언 "이미 마운트했나" 플래그 말고 **값 비교**로).
