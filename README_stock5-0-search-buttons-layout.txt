stock5-0 검색창/포지션 버튼 배치 수정

변경:
- "입력 / 롱보유 / 롱관심 / 숏관심 / 숏보유" 버튼을 종목 검색창 오른쪽으로 이동
- 검색창은 남는 공간만 사용하므로 기존보다 짧아짐
- 좁은 휴대폰 화면에서는 겹침 방지를 위해 자동으로 다음 줄로 배치
- 버튼의 선택/색상/평단가 저장 동작은 기존 그대로 유지

GitHub 저장소 최상위에 업로드:
- /apply-stock5-0-search-buttons-layout-fix.mjs

Oracle 적용 순서:
node apply-stock5-0-update.mjs
node apply-stock5-0-controls-fix.mjs
node apply-stock5-0-live-top100-fix.mjs
node apply-stock5-0-hold-toggle-fix.mjs
node apply-stock5-0-search-buttons-layout-fix.mjs
npm run build
sudo systemctl restart stock5-0
