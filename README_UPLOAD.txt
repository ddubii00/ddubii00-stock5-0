stock5-0 GitHub 업로드용 수정본

업로드/교체 파일:
1. src/App.jsx
2. src/marketPresets.js
3. src/stock5-0-overrides.css  (새 파일)

핵심 변경:
- 헤더 아래 두 번째 컨트롤 줄 제거
- 풀다운 메뉴를 BB 바로 왼쪽으로 배치
- 헤더 지수 값 사이 간격 축소
- 1. 지수: KOSPI/KOSDAQ/환율/NASDAQ/S&P500/다우/SOX/달러인덱스/금/WTI/VIX/중국/홍콩/일본/유럽 지수
- 2~5: 프리셋 종목 차트 전체 표시
- KOSPI100/KOSDAQ100은 기존 /api/search를 이용해 실제 종목명 자동 표시
- 프리셋 전환 시 ChartColumn localStorage가 과거 종목을 덮어쓰지 않도록 reset
- 기존 ChartColumn.jsx와 server.js는 수정 불필요

GitHub에 위 3개 파일을 경로 그대로 올린 뒤 Oracle에서:
cd /var/www/stock5-0
git fetch origin
git reset --hard origin/main
npm ci
npm run build
sudo systemctl restart stock5-0
