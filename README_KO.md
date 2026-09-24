# stock5-0 공유 포지션/평균가/Nikkei100 패치

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
