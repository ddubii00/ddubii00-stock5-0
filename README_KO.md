# stock5-0 종목 공유 기록

## 현재 버전 사용법

- 처음 접속하면 기존 서버 비밀번호로 로그인합니다. 저장된 비밀번호가 유효하면 다음 접속 시 자동 로그인하며, 헤더의 별도 기록 연결 버튼은 없습니다.
- 로그인할 때 저장된 종목 기록을 불러오고, 이후 기록 버튼 변경은 별도 저장 버튼 없이 서버에 자동 저장합니다.
- Top 100 / 니케이 Top 50 종목명 앞에는 전일 시가총액 순위가 `1. 삼성전자`처럼 표시됩니다. 카드에서 다른 종목을 검색하면 원래 종목의 순위는 표시하지 않습니다.
- 캔들 레전드 아래 한 줄에 PER / F.PER / ROE / F.ROE / PBR / PEG / 시총 / 매출 / 영업이익을 표시합니다. 좁은 화면에서는 줄바꿈 없이 해당 줄만 가로 스크롤합니다.
- 금액은 각 제공 통화의 조 단위이며, 국내는 조원, 해외는 조USD·조JPY 등으로 표시합니다. 국내 실적은 최근 확정 연간, 예상은 다음 제공 연간 컨센서스이며 해외 매출·영업이익은 TTM 기준입니다. 미제공 값은 `—`, 예상 EPS 성장률로 계산한 국내 `PEG*`와 해외 마진 기반 `영업이익*`는 추정값입니다. 각 값에 마우스를 대면 기준을 확인할 수 있습니다.
- 재무정보는 종목별 6시간 캐시·최대 2종목 동시 조회를 사용합니다. 차트의 기존 15초 REST 갱신은 유지하며 재무정보는 15초마다 요청하지 않습니다.
- KOSPI100 / KOSDAQ100 / NASDAQ100 / 니케이 Top 50의 종목 카드에 `롱 보유`, `롱 관심`, `숏 관심`, `숏 보유`, `주의!` 버튼이 표시됩니다.
- 네 가지 롱·숏 상태는 한 번에 하나만 선택됩니다. 활성화된 버튼을 다시 누르면 해제됩니다.
- `주의!`는 기본 **꺼짐**입니다. 누르면 노란색으로 켜지고, 다시 누르면 꺼집니다. 롱·숏 상태와 독립적으로 저장됩니다.
- 기록은 브라우저가 아니라 서버에 저장됩니다. 다른 컴퓨터에서도 같은 서버 비밀번호로 연결하면 기록이 보이며, 15초마다 또는 창에 다시 포커스할 때 갱신됩니다.
- 기존 분류와 평균가 데이터는 유지됩니다. 상태 변경은 해당 종목의 변경된 필드만 저장하므로 다른 기기에서 저장한 종목을 덮어쓰지 않습니다.
- Oracle은 기본 `data/stock5-0-state.json`을 사용합니다. `STOCK5_DATA_DIR`로 영구 저장 경로를 지정할 수 있습니다. 업데이트할 때 기존 `data/`를 삭제하지 마세요.
- 서버리스 배포는 영구 공유 저장을 위해 `KV_REST_API_URL`, `KV_REST_API_TOKEN`을 함께 설정해야 합니다.

이 기능은 이미 소스에 적용되어 있습니다. 최신 소스를 가져와 빌드하고 서비스를 재시작하면 됩니다. 아래의 예전 `apply-stock5-0-*.mjs` 패치 절차를 다시 실행하지 마세요.

## 이전 패치 문서 (참고용, 현재 버전에 실행하지 않음)

기준 저장소: `ddubii00/ddubii00-stock5-0` main

## 추가 기능

- 비밀번호 로그인: 기본 비밀번호 `1222`
  - 서버 환경변수 `STOCK5_PASSWORD`가 있으면 그 값을 우선 사용합니다.
- 서버 공유 저장
  - Oracle: `data/stock5-0-state.json`
  - 한 컴퓨터에서 지정한 롱/숏 분류와 평균가가 다른 컴퓨터에서도 보입니다.
  - 로그인 후 10초마다 서버 상태를 다시 확인합니다.
- KOSPI100 / KOSDAQ100 / NASDAQ100 / Nikkei100 카드에 작은 버튼 추가
  - `입력`, `롱보유`, `롱관심`, `숏관심`, `숏보유`
  - 기본 배경은 모두 흰색
  - 네 상태 버튼은 동시에 하나만 선택 가능
  - 롱보유: 선택 시 빨강
  - 롱관심: 선택 시 반투명 빨강
  - 숏관심: 선택 시 반투명 파랑
  - 숏보유: 선택 시 파랑
- 롱보유/숏보유 선택 시 평균가 팝업
  - 평균가 저장 시 메인 캔들차트에 빨간 수평 점선 표시
  - 보유 버튼 또는 `입력`을 다시 눌러 수정 가능
  - 팝업의 `삭제`를 누르면 평균가와 수평선 제거
- NASDAQ/Nikkei 프리셋의 임시 이름을 Yahoo에서 영어 종목명으로 자동 조회
- `니케이 Top 50` -> `니케이100`
- Nikkei 프리셋을 100개 종목으로 확대

## GitHub에 수동 업로드할 파일

ZIP을 풀고 아래 경로를 그대로 유지해서 GitHub 저장소에 올리세요.

- `apply-stock5-0-update.mjs` (저장소 루트)
- `api/_state.js`
- `api/state.js`
- `api/name.js`

`data/`는 실제 사용자 데이터이므로 GitHub에 올리지 않습니다. 패치 실행 시 `.gitignore`에 `data/`가 자동 추가됩니다.

## Oracle에서 한 번에 반영

GitHub에 위 파일들을 올린 다음 Oracle에서 아래 한 줄을 실행합니다.

```bash
cd /var/www/stock5-0 && git fetch origin && git checkout origin/main -- apply-stock5-0-update.mjs api/_state.js api/state.js api/name.js && node apply-stock5-0-update.mjs && node --check scripts/server.js && npm install && npm run build && mkdir -p data && sudo systemctl restart stock5-0 && sudo nginx -t && sudo systemctl reload nginx && curl -I http://127.0.0.1:3050/
```

이 방식은 Oracle에 이미 있는 최신 `src/App.jsx`, `ChartColumn.jsx`, `server.js` 전체를 GitHub의 예전 버전으로 덮어쓰지 않고, 현재 파일에 필요한 변경만 적용합니다.

## 패치 후 GitHub에 완성본까지 반영하려면

Oracle에서 패치 적용 후 아래 파일들이 변경됩니다.

- `.gitignore`
- `scripts/server.js`
- `src/App.jsx`
- `src/components/ChartColumn.jsx`
- `src/index.css`
- `src/marketPresets.js`

기능 확인 후 이 6개 파일도 GitHub에 수동 업로드하면 GitHub 자체도 완성된 최신 소스가 됩니다. 새 API 3개 파일도 그대로 유지하세요.

## 공유 데이터 파일

Oracle의 실제 입력 데이터는 기본적으로 아래에 저장됩니다.

`/var/www/stock5-0/data/stock5-0-state.json`

서버 재시작이나 브라우저 변경으로 지워지지 않습니다. 소스 업데이트 때 `data/` 폴더를 삭제하지 마세요.
