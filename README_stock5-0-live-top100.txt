stock5-0 live Top100 / immediate stock-name fix

GitHub에 올릴 파일:
1) /apply-stock5-0-live-top100-fix.mjs
2) /api/top100.js

기능:
- KOSPI100 / KOSDAQ100 선택 시 네이버 국내주식 API의 marketCapDesc 기준으로 현재 시가총액 상위 100종목을 다시 조회
- 50개씩 2페이지를 조회하여 100개 구성
- 응답에 포함된 itemName을 그대로 사용하므로 "KOSDAQ100 2 · 263750" placeholder가 차트에 먼저 나타나지 않음
- 앱 시작 시 KOSPI/KOSDAQ Top100을 미리 prefetch
- 해당 메뉴를 다시 선택할 때마다 새로 조회
- Oracle Express용 /api/top100 route와 Vercel용 api/top100.js를 함께 제공

Oracle 적용 순서:
node apply-stock5-0-update.mjs
node apply-stock5-0-controls-fix.mjs
node apply-stock5-0-live-top100-fix.mjs
npm install
npm run build
sudo systemctl restart stock5-0
