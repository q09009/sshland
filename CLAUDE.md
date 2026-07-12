# SSHland

초보자용 SSH/SFTP GUI 클라이언트. Tauri 2 (Rust) + React + TypeScript + Vite + Tailwind + zustand.

## 핵심 철학

- **가벼움 우선**: 무거운 의존성 추가 전 반드시 필요성을 따진다.
- **초보자 타겟**: 사용자에게 보이는 모든 에러는 기술 용어 없이 자연스러운 한글 문장이어야 한다 (`src-tauri/src/error.rs`에서 중앙 관리).
- **UI**: 미니멀 다크 테마. 색/여백/폰트/radius 리터럴은 **디자인 토큰(`src/index.css`의 `:root`) 한 곳**에만 둔다 — 아래 "디자인 토큰" 섹션 참고. 컴포넌트에 hex/px 직접 박기 금지.
- **파괴적 작업**(삭제 등)은 반드시 확인 다이얼로그를 거친다.
- **비밀번호는 메모리에만**: 디스크 저장 금지, 로그 출력 금지 (secret을 담는 타입엔 `Debug` derive 금지).
- **유저 설정은 선언적만, 코드 실행 금지**: 유저가 편집하는 설정 파일(명령어 GUI TOML 등)에 임의 JS/스크립트를 실행하는 구조는 절대 만들지 않는다 — 이 앱은 SSH 자격증명·서버 접근을 다루므로 서드파티 설정을 신뢰 없이 실행하면 안 된다. 파싱/렌더 규칙은 선언적 데이터로만 표현한다.
- **틀려도 조용히 fallback**: 파싱/매칭 실패나 미등록 케이스는 에러로 취급하지 말고 원본(raw)으로 자연스럽게 되돌아간다. GUI 변환은 항상 원본과 토글 가능해야 한다.

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

### OS 드래그인 업로드 (로컬 → 서버)

OS 파일 드롭은 브라우저 표준 `ondrop`이 **안 오고**, Tauri 네이티브 이벤트 `getCurrentWebview().onDragDropEvent(...)`로만 온다 (`FilesScreen.tsx`에서 마운트 시 1회 구독). `dragDropEnabled`는 `tauri.conf.json` 기본값 true여야 이벤트가 온다.

**타겟 pane은 포커스가 아니라 커서 위치로 정한다.** 이벤트는 창(webview) 단위로 한 번 발생 → 열려 있는 모든 `FilesScreen` 리스너가 다 실행되므로, 각 pane이 **자기 루트 rect 안에 커서가 있는지**(`rootRef.getBoundingClientRect()` 포함검사) 확인해 그 pane만 반응한다. 터미널 pane엔 `FilesScreen`이 없어 자동으로 무시되고, 드롭은 포커스를 옮기지 않으므로 위치 검사가 유일하게 올바른 방법이다. (예전엔 포커스 기반이라 pane 두 개일 때 엉뚱한 pane으로 업로드되던 문제가 있었다.)

- payload `position`은 **물리 픽셀**(`PhysicalPosition`)이라 `window.devicePixelRatio`로 나눠 CSS 좌표로 변환해야 `getBoundingClientRect`와 맞는다 (Windows 배율 100%가 아니면 안 그러면 어긋남).
- 여러 파일은 순차 업로드. `>1`개면 `store.uploadBatches`에 배치를 만들어 `TransfersPanel`이 "N개 중 M개 완료" 전체 진행률을 개별 카드 위에 표시. 개별 진행률은 기존 `transfer-progress` 흐름 그대로.
- **폴더는 백엔드(`upload_file`)가 거부** — `std::fs::metadata`로 dir이면 "폴더는 업로드할 수 없어요…" 반환. 프론트에서 로컬 경로가 폴더인지 알 방법이 마땅찮아(fs 플러그인 추가 회피) 백엔드에서 막고 에러 카드로 안내한다.
- hover 하이라이트는 **해당 pane에 국한**(pane 루트가 `relative`, 오버레이가 `absolute inset-0` + 점선 테두리). 창 전체 `fixed` 오버레이 아님.

### 상단 상태바 + 설정 (pane 타일링과 분리된 레이어)

파일 화면(`App.tsx`)은 **세로 flex**: `StatusBar`(고정 높이 `h-8`, `shrink-0`) 위 + 타일링 영역(`flex-1 min-h-0`) 아래. 타일링 시스템은 이 아래 영역만 차지한다. 설정은 `flex` 밖의 모달 오버레이(`fixed inset-0`)로 타일링을 덮는다.

- **상태바(`StatusBar.tsx`)는 서버에 아무것도 요청하지 않는다** (원칙). 표시 항목: 왼쪽 `user@host` + 연결상태 인디케이터(색 점: 연결됨=emerald / 재연결중=amber pulse / 끊김=red), 오른쪽 세션 경과시간·로컬 시계·설정 톱니바퀴.
  - 세션 경과시간 = `now - connection.connectedAt`(둘 다 로컬 `Date`). 시계 = `new Date(now)`. **1초 로컬 인터벌 하나**로 `now`(=`Date.now()`)만 갱신해 둘 다 파생. 서버 시간 요청 절대 없음.
  - `connectionStatus`는 store에 있고 지금은 `connected`만 실제로 보인다(끊기면 즉시 접속화면 복귀). `reconnecting`은 **향후 자동재연결용 예약값**(`setConnectionStatus`로 세팅).
  - 가운데 영역은 **향후 서버 리소스(CPU/메모리) 위젯 자리로 비워둠**(3분할 레이아웃이라 리플로우 없이 삽입 가능).
- **설정(`SettingsPanel.tsx`)**: 카테고리 사이드네비 + 콘텐츠. 카테고리는 **데이터주도 `SECTIONS` 배열**(`{id,label,render}`)이라 "명령어 로그/단축키/테마" 같은 섹션은 배열에 한 줄 추가하면 끝. 현재 `일반`(시계 초표시 토글)·`정보`(앱 이름/버전, `@tauri-apps/api/app`의 `getVersion`/`getName`/`getTauriVersion`) 두 섹션. Esc·배경클릭·✕로 닫힘.
- **설정 영속화**: `lib/settings.ts`(zustand)가 `AppSettings`(타입+기본값)를 들고, 앱 시작 시 `load()`(백엔드 `load_settings`)로 디스크 값을 기본값 위에 머지, `set(key,val)`마다 전체 객체를 `save_settings`로 즉시 기록. 백엔드는 `<app_config_dir>/settings.json`(레포 바깥, Windows면 `%APPDATA%\com.sshland.app\`)에 opaque JSON blob으로 저장 — git에 안 올라가고, **설정 추가 시 Rust 수정 불필요**. 설정 추가 절차: `AppSettings`에 필드 + `DEFAULTS`에 기본값 + 패널에 컨트롤, 3곳만.
- **최근 접속정보 저장**(`AppSettings.lastConnection`): 접속 성공 시 host/port/username/authKind/keyPath를 저장해 다음 실행 때 접속 폼을 자동 채운다(`ConnectScreen`이 settings 로드 후 1회 prefill). **비밀번호·개인키 passphrase는 절대 저장 안 함**(핵심 철학 "비밀번호는 메모리에만" 준수 — `LastConnection`엔 secret 필드 자체가 없음).

### 명령어 로그 바 (화면 맨 아래)

파일관리자 조작을 **실제 터미널 명령어 문자열**로 바꿔 학습용으로 보여주는 얇은 한 줄 바. `App.tsx` 세로 flex에서 타일링 아래(`StatusBar`와 대칭)에 위치.

- **변환은 순수 함수 `lib/commandLog.ts`의 `operationToCommandString(op, {user,host})`** 하나로 재사용: 업로드/다운로드=`scp`, 삭제=`rm`(디렉토리는 `-r`), 새폴더=`mkdir`, 이름변경·이동=`mv`, 복사=`cp -r`. 경로에 공백/특수문자 있을 때만 따옴표(학습용이라 실제 동작하는 명령어가 되도록). 실제 조작은 SFTP로 하고 이 문자열은 **표시 전용**.
- 로그는 **세션 전용**(`store.commandLog`, 최신순, 최근 20개 cap) — 영속 저장 안 함, 재시작 시 초기화.
- 각 조작 성공 지점(`FilesScreen`의 handleDrop/doDownload/performMove/doRename/doDelete/doNewFolder/doPaste)에서 `logOp(op)` 호출. **터미널 pane 입력은 로그에 안 올라감** — 파일관리자 조작만 명시적으로 훅을 걸었으므로 자동으로 중복 안 됨.
- 바 클릭 시 위로 펼쳐지는 **히스토리 팝업**(최근 20개, 바깥클릭·Esc로 닫힘). 기록 없으면 클릭 무반응.
- 설정 `commandLogEnabled`(기본 켜짐, 설정 탭 **첫 섹션** "명령어 로그")를 끄면 `CommandLogBar`가 `null` 반환 → 바 자체가 사라짐(숙련자용).

### 명령어 GUI (터미널 출력 → 위젯) — 핵심 기능

터미널에서 명령을 치면 raw 텍스트 대신(토글로 전환 가능) 사람이 읽기 쉬운 GUI 위젯으로 보여준다. **파싱/렌더 규칙은 하드코딩이 아니라 선언적 TOML**로 정의 → 유저가 추가/수정 가능. **코드 실행 없는 선언적 방식만** 지원(임의 JS 실행 절대 금지 — SSH 자격증명·서버 접근을 다루므로). 매치 안 되면 조용히 raw로 fallback, 파싱 실패도 에러 아님.

- **셸 경계 감지(`lib/shellIntegration.ts`)**: 터미널 열릴 때 bash에 **OSC 133 마커**를 emit하는 setup을 주입(`SHELL_INTEGRATION_SETUP`, `PROMPT_COMMAND`+`PS1`+`DEBUG trap`). xterm `parser.registerOscHandler(133,…)`로 마커를 **보이지 않게** 가로채, 명령어(B→C)·출력(C→D)·exit code(D;n)를 **버퍼에서** 읽음(wrapped 줄 재결합). bash 아니면 마커 없어 raw fallback. 명령 파싱과 무관한 공통 기반 레이어.
- **설정 로더(백엔드 `commands_config.rs`)**: 바이너리에 임베드된 **기본 제공(읽기전용, `default_commands/*.toml`)** + **유저 폴더(`<app_config_dir>/commands/*.toml`, 읽기/쓰기)** 두 곳 스캔, 같은 파일명은 **유저가 override**. 잘못된 TOML/스펙 위반은 그 파일만 스킵(stderr 로그), 앱 안 죽음. `load_command_configs`가 병합 목록을 JSON으로 반환. 프론트 `lib/commandConfigs.ts`가 시작 시 로드 + 순수 `matchCommand(configs, command)`(첫 매치, 잘못된 정규식 스킵).
- **TOML 스펙**: `match`(명령 전체와 매칭할 정규식) / `parser`(`columns`|`keyvalue`|`regex`) / `render`(`table`|`keyvalue-card`|`list`) / `capture_pattern`(regex 파서 필수, named group) / `highlight_column`(table 선택). TOML **literal string(작은따옴표)**으로 정규식 백슬래시 이스케이프 회피.
- **파서(`lib/parsers.ts`, 순수)**: `columns`(첫 줄 헤더, 마지막 컬럼은 헤더 시작 위치로 슬라이스해 공백 포함 COMMAND 보존, 앞 컬럼은 공백 split로 우측정렬 숫자 안전; df의 두 단어 `Mounted on` 헤더는 데이터 토큰 수로 감지해 병합) / `keyvalue`(`:` 또는 다중공백, `●`·트리줄 스킵) / `regex`(named group per line). 안 맞으면 null → raw.
- **렌더(`components/CommandWidgetPanel.tsx`)**: `config.parser`로 파싱 → `config.render`로 렌더(자연스러운 짝만, 나머진 raw). `table`(정렬 가능, `highlight_column` 값 크기별 빨강 그라데이션 — 토큰 `rgb(var(--color-red-500)/α)`) / `keyvalue-card`(카드 그리드) / `list`(필드 행). `asNumber`는 선두 숫자 파싱(`25%`,`1.2G`).
- **터미널 인라인 통합(하이브리드)**: 매치되면 shellIntegration이 출력 시작줄에 만든 **마커**에 xterm **decoration**(`allowProposedApi` 필요)으로 작은 **"▦" 아이콘**만 인라인 표시 → 클릭 시 터미널 pane **아래 패널**(`CommandWidgetPanel`)에 위젯 오픈. 패널에 **원본↔GUI 토글**. decoration 렌더는 애니메이션 프레임 의존이라 헤드리스 검증 불가(실앱 확인). *decoration으로 멀티행 인터랙티브 오버레이를 직접 그리는 방식은 rAF 의존+복잡해서 피하고, 무거운 위젯은 일반 React 패널로 뺀 게 이 하이브리드의 핵심.*
- **설정**: `commandGuiEnabled`(기본 켜짐, 설정 탭 "명령어 GUI" 섹션) 끄면 `TerminalPane`이 매칭 자체를 스킵 → 전부 raw. 섹션에 등록 명령 목록(읽기전용)·유저 폴더 경로+열기 버튼(`open_commands_dir`)·다시 불러오기 버튼(재-`load()`). 파일 변경 watch는 미구현(스펙 허용 — 다시 불러오기 버튼으로 대체).

### 디자인 토큰 (단일 소스)

색상·타이포·radius 리터럴은 전부 **`src/index.css`의 `:root`** 한 곳에 CSS 변수로 있다. `tailwind.config.js`는 값을 담지 않고 유틸 이름 → CSS 변수로 **연결만** 한다. 즉 `bg-ink-900` / `text-slate-400` / `rounded-lg` / `text-2xs` 같은 클래스가 전부 중앙 토큰을 가리킨다. 나중에 디자인을 갈아엎을 땐 `:root` 값만 바꾸면 되고 컴포넌트는 안 건드린다.

- **색은 RGB 채널("15 23 42")로 저장** → Tailwind 투명도 modifier가 동작하도록 config에서 `rgb(var(--color-x) / <alpha-value>)`로 매핑. 그래서 `bg-sky-500/20` 같은 것도 그대로 됨.
- 팔레트 이름(`ink`/`slate`/`sky`/`emerald`/`amber`/`red`)과 클래스명은 **일부러 그대로 유지**했다(이번은 리팩터지 리디자인이 아님 — 값만 `:root`로 이동, 시각적 변화 0). 실제로 색 32종·폰트크기·radius·터미널 색을 리팩터 전후 computed-style로 비교해 **완전 동일** 확인함.
- **폰트 크기**: `text-2xs`(11px, line-height 없음 — 옛 `text-[11px]`과 동일)만 새로 추가. 나머지 `text-xs~2xl`은 Tailwind 기본 스케일 값을 `:root` 변수로 옮겨 config에서 참조(라인하이트 포함 기본값 그대로).
- **spacing 스케일**은 Tailwind 기본 스케일을 그대로 쓴다(이미 일관된 스케일이라 굳이 :root로 안 옮김). 컴포넌트에 남은 one-off 레이아웃 px(드롭다운 `min-w-[140px]`/`[160px]`, 설정 모달 `max-h-[560px]`)는 디자인 토큰이 아니라 개별 치수라 그대로 둠.
- **CSS 클래스를 못 쓰는 곳(xterm 터미널의 JS theme 객체)**은 `src/lib/theme.ts`의 `token()`/`colorToken()`으로 `:root` 변수를 런타임에 읽어 쓴다 — 터미널도 hex 중복 없이 같은 소스를 참조(`--font-terminal` 포함).

## 파일 구조

```
src-tauri/src/
  ssh.rs      SSH/SFTP 세션 관리자 + 워커 루프 + 모든 Tauri command (connect, list_dir,
              download, upload, rename, mkdir, delete, copy, open/write/resize/close_terminal, disconnect)
  settings.rs 설정 영속화 command (load_settings/save_settings) — 앱 config 폴더의 settings.json
              에 JSON blob으로 읽고 씀. 스키마는 프론트가 소유(백엔드는 opaque).
  commands_config.rs 명령어 GUI 설정 로더 (load_command_configs: 임베드 기본+유저폴더 스캔·병합·검증,
              commands_dir_path/open_commands_dir) — toml 크레이트
  default_commands/*.toml  기본 제공 명령어 규칙 (ps-aux/systemctl-status/df-h/du-sh/free-h/ip-addr), include_str!로 임베드
  error.rs    기술 에러 → 친절한 한글 메시지 변환 (중앙 관리)
  lib.rs      Tauri Builder 설정, command 등록

src/
  store.ts              zustand: 연결(상태·경과기준시각 포함)/연결상태/설정오버레이/명령어로그/화면 전환/pane 트리/전송목록/업로드배치/클립보드/드래그/fsVersion
  api.ts                Tauri invoke 타입 래퍼 (설정 load/save 포함)
  lib/panes.ts           pane 트리 순수 함수 (분할/삭제/전환/비율/레이아웃/포커스탐색)
  lib/path.ts            경로 유틸 (join, parent, breadcrumb, baseName)
  lib/files.ts           sortEntries (폴더 우선 정렬)
  lib/format.ts          사람이 읽는 크기/날짜/경과시간/시계 포맷
  lib/commandLog.ts      파일 조작 → CLI 명령어 문자열 변환 (operationToCommandString, 순수/재사용)
  lib/shellIntegration.ts OSC 133 셸 경계 감지 (setup 주입 + 명령/출력/exit 캡처) — 명령 파싱과 분리된 기반
  lib/commandConfigs.ts   명령어 GUI 설정 zustand 스토어 (load) + 순수 matchCommand
  lib/parsers.ts          columns/keyvalue/regex 파서 (순수, 안 맞으면 null → raw)
  lib/settings.ts        설정 zustand 스토어 (AppSettings 타입 + 기본값 + load/set, 변경 시 자동 영속화)
  lib/theme.ts           :root 디자인 토큰을 JS에서 읽는 헬퍼 (token/colorToken) — CSS 클래스 못 쓰는 xterm용
  index.css              디자인 토큰 :root 정의 (색/타이포/radius 단일 소스) + 전역 스타일
  ../tailwind.config.js  토큰 → Tailwind 유틸 이름 연결 (값 없음, var 매핑만)
  screens/ConnectScreen.tsx   접속 화면 (비밀번호/개인키, 로딩, 에러)
  screens/FilesScreen.tsx     파일관리자 pane 본체 (완전히 로컬 상태)
  components/StatusBar.tsx    상단 GNOME식 상태바 (user@host / 연결상태 / 세션경과 / 로컬시계 / 설정아이콘) — 전부 로컬 계산, 서버 호출 없음
  components/CommandLogBar.tsx 하단 명령어 로그 바 (최근 1줄 + 클릭 시 히스토리 팝업, 설정으로 on/off)
  components/CommandWidgetPanel.tsx 명령어 GUI 위젯 패널 (parser로 파싱→render로 표/카드/목록, 원본 토글) — 터미널 pane 아래
  components/SettingsPanel.tsx 설정 모달 (카테고리 사이드네비 + 섹션, 데이터주도 SECTIONS 배열로 확장; 현재 명령어로그/명령어GUI/일반/정보)
  components/TilingShell.tsx  pane 트리 루트 + 전역 단축키 + 전역 이벤트 리스너(전송진행률/연결끊김)
  components/PaneView.tsx     pane 트리 → 평면 절대배치 렌더러 + 분할선 드래그
  components/TerminalPane.tsx xterm.js 터미널 (PTY 연결, 렌더 스로틀링, 셸통합·명령어GUI 인라인 아이콘+패널)
  components/FileView.tsx     목록/자세히/큰아이콘 3가지 보기 (선택, 드래그시작, 우클릭 지원)
  components/Menu.tsx         메뉴바 드롭다운 (파일/편집/보기)
  components/ContextMenu.tsx  우클릭 컨텍스트 메뉴
  components/Modal.tsx        확인 다이얼로그 / 입력 다이얼로그
  components/DragLayer.tsx    드래그 중 커서 따라다니는 고스트 라벨
  components/TransfersPanel.tsx  업/다운로드 진행률 패널 (완료된 카드·배치는 3초 뒤 페이드아웃 자동 정리, 에러는 수동 닫기)
  components/ShortcutsHelp.tsx   우하단 단축키 도움말
```

## 현재 상태 (2026-07-12 기준)

**Phase 1 — SSH 접속 + SFTP 파일관리자: 완료**
접속 화면, 목록(3가지 보기모드), 경로이동/breadcrumb/숨김파일, 다운로드/업로드(드래그앤드롭)/이름변경/삭제/새폴더/복사, 연결끊김 감지.

**Phase 2 — 터미널 + Hyprland식 타일링: 완료 (9단계 전부)**
PTY 스트리밍 → xterm pane → pane 트리+렌더러 → 분할 단축키 → 포커스이동 → 닫기 → 분할선 드래그 → pane 전환 → 비활성 pane 렌더 스로틀링.

**Phase 3 — 상단 상태바 + 설정 탭: 완료**
pane와 분리된 GNOME식 상단 상태바(user@host / 연결상태 / 세션경과 / 로컬시계 / 설정아이콘, 전부 로컬 계산), 설정 모달(카테고리 사이드네비, 데이터주도 확장구조), 로컬 JSON 영속화(`settings.json`). 위 "상단 상태바 + 설정" 아키텍처 섹션 참고.

**Phase 4 — 명령어 로그 바: 완료**
화면 맨 아래 얇은 바에 파일관리자 조작을 실제 CLI 명령어(scp/rm/mkdir/mv/cp)로 표시(최근 1줄 + 클릭 시 히스토리 팝업), 세션 전용. 설정 탭 첫 섹션 "명령어 로그" 토글로 on/off(끄면 바 사라짐). 위 "명령어 로그 바" 아키텍처 섹션 참고. 향후 단축키/테마 섹션은 같은 설정 구조에 추가로 확장 예정.

**Phase 5 — 명령어 GUI (핵심 기능): 완료 (8단계 전부)**
셸통합(OSC 133) 경계 감지 → 선언적 TOML 설정 로더(기본+유저, override) → columns/keyvalue/regex 파서 + table/keyvalue-card/list 렌더 → 터미널 인라인 "▦" 아이콘(decoration)+아래 패널(원본 토글) → 기본 제공 6종(ps aux/systemctl status/df -h/du -sh/free -h/ip addr) → 다시 불러오기·폴더 열기 → 설정 마스터 토글. 위 "명령어 GUI" 아키텍처 섹션 참고. 파서/렌더 검증은 실제 xterm·React 컴포넌트로 브라우저에서 완료, 인라인 decoration 표시는 실앱에서 확인(rAF 의존). **미구현(향후): 파일변경 watch(현재 다시불러오기 버튼), zsh/fish 셸 통합(현재 bash만), decoration 아이콘 위치 다듬기(현재 출력 첫 줄 좌측 3칸 덮음).**

**추가 개선 (사용자 피드백 기반, 완료):**
- 파일관리자 메뉴바(파일/편집/보기)로 툴바 정리, 단일 선택, 빈공간 우클릭(새폴더/붙여넣기), 파일 우클릭(복사/다운로드/이름변경/삭제)
- 앱 내부 드래그로 파일/폴더 아이콘을 다른 폴더나 다른 pane으로 옮기기 (SFTP rename)
- **OS 파일 드래그인 업로드**(로컬 → 서버): 탐색기/Finder에서 파일관리자 pane으로 드래그하면 그 pane의 현재 폴더에 업로드. 아래 "OS 드래그인 업로드" 섹션 참고. (반대 방향 드래그아웃은 Tauri 웹뷰가 크로스플랫폼으로 지원 안 해서 만들지 않음 — 다운로드는 버튼 흐름 유지.)
- **디자인 토큰 중앙화**(리팩터, 시각 변화 0): 모든 색/타이포/radius 리터럴을 `:root`(`index.css`) 단일 소스로 이동, Tailwind는 매핑만. 위 "디자인 토큰" 섹션 참고. 미래 리디자인 대비 구조 정리.

**수정된 버그:**
- pane 닫을 때 살아남아야 할 형제 터미널까지 죽던 문제 (렌더링을 트리 재귀 → 평면 절대배치로 전환)
- 파일관리자 pane 두 개가 상태를 공유해서 같이 움직이던 문제 (전역 상태 → pane별 로컬 상태)
- 최초 진입 시 "불러오는 중..."에서 멈추는 문제 (React StrictMode 이중 실행 + `fsVersion` 가드가 불리언이라 생긴 경쟁 상태 → 값 비교 가드로 수정)

**남은 작업:** 사용자가 명시적으로 요청한 항목은 모두 구현 완료. 다만 명령어 GUI(Phase 5)는 **실앱(실 SSH 서버) 확인이 남아 있고**(각 기본 명령의 아이콘→패널 동작, 마스터 토글 off 시 raw, 폴더 열기/다시 불러오기), 사용자 우선순위 대기 중인 **향후 항목**이 있다: 파일변경 watch(현재 다시불러오기 버튼), zsh/fish 셸 통합(현재 bash만), decoration 아이콘 위치 다듬기. 그 외엔 새 기능 요청·버그 리포트 대기 상태.

## 알아두면 좋은 것

- 이 환경(Windows)에서 `create-tauri-app` CLI는 비대화형(non-TTY)에서 거부되어 프로젝트를 수동으로 스캐폴딩했다.
- 빌드: `npm run build` (프론트), `cd src-tauri && cargo build` (백엔드). 실행: `npm run tauri dev` (PowerShell에서 `$env:Path`에 `~/.cargo/bin` 추가 필요할 수 있음).
- React `<StrictMode>`가 켜져 있어(`src/main.tsx`) 개발 모드에서 마운트 이펙트가 두 번 실행된다 — 마운트 시 부수효과를 넣을 때 이 점을 반드시 고려할 것 (ref 기반 가드 사용, 불리언 "이미 마운트했나" 플래그 말고 **값 비교**로).

### 작업 방식 & 검증 (이번까지 확립된 규칙)

- **큰 기능은 단계로 쪼개 단계마다 "빌드 확인 → 논리 단위 커밋"**. 한 번에 다 만들지 말고, 먼저 대표 케이스 하나(예: 명령어 GUI는 `ps aux`)로 파이프라인 전체를 끝까지 검증한 뒤 나머지를 확장한다. 커밋 메시지 끝에 `Co-Authored-By: Claude ...` 유지.
- **shell integration / PTY / xterm 같은 라이브러리 제약이 의심되는 부분은 임의로 우회하지 말고, 정공법이 되는지 먼저 프로토타입으로 확인**한다. (예: xterm decoration이 인터랙티브 멀티행 오버레이로 되는지 실제 xterm에 붙여보고 → rAF 의존/복잡성 확인 → "인라인 아이콘 + 아래 패널" 하이브리드로 결정.)
- **이 개발 환경에선 실제 SSH 접속이 불가** → 서버가 필요한 부분(bash 마커 실제 emit, 실 명령 출력, 인라인 decoration 표시 등)은 사용자가 실앱에서 확인한다. 대신 **프론트 순수 로직은 브라우저에서 "실제 컴파일된 모듈"로 실측 검증**한다: `npm run dev`(vite)를 띄우고 브라우저에서 `import('/src/lib/xxx.ts')`로 실제 모듈을, `import('/node_modules/.vite/deps/@xterm_xterm.js?v=…')`·`react`/`react-dom_client`로 실제 xterm/React를 동적 import해서 합성 입력으로 파서·렌더·정렬·매칭을 검증했다(재타이핑한 복제본 말고 진짜 모듈). Rust는 `cargo test`로 설정 파싱 유닛 테스트.
  - **주의(브라우저 검증 함정)**: ① `import('/src/store.ts?t=…')`처럼 캐시버스트를 붙이면 앱이 쓰는 zustand 싱글톤과 **다른 인스턴스**가 되어 `setState`가 안 먹힌다 — 앱 상태를 조작·관찰하려면 캐시버스트 없이 임포트. ② vite dep의 `@xterm/xterm`·`react-dom_client`는 `default`에 실제 export가 걸려 있다(`m.default.Terminal`, `rd.default.createRoot`). ③ decoration 등 rAF 기반 렌더는 백그라운드 탭에서 프레임이 안 돌아 검증 불가.
- **xterm 버퍼 마커/decoration을 쓰려면 `Terminal({ allowProposedApi: true })`** 필요(proposed API).
- Bash 툴로 `cd src-tauri` 하면 그 셸의 cwd가 유지되니, 프론트 명령(`npx tsc`/`npm run build`)은 **절대경로로 cwd를 루트로 되돌리고** 실행할 것(안 그러면 엉뚱한 폴더에서 돎).
- 커밋 시 `LF will be replaced by CRLF` 경고는 Windows 줄바꿈 정규화 알림일 뿐 무해(레포엔 LF 저장).
