stock5-0 재무지표/2칼럼 V2

핵심 수정
- 한국 주식 PER/PBR/EPS는 Yahoo 값 대신 네이버 integration의 현재 지표 사용.
- 한국 주식 매출/영업익/ROE/영업이익률은 네이버 finance/annual의 최신 확정 실적 사용.
- 따라서 삼성전자에서 PBR 0.00, EPS 0, 비정상 PER(F) 같은 값이 나오던 문제를 제거.
- 미국/일본 주식은 Yahoo Finance 재무지표 유지.
- MacBook Pro 기준 2칼럼이 화면 안에 들어오도록 grid를 minmax(0,1fr)로 고정.
- chart-column min-width:0 추가.
- 종목 입력창을 최대 150px, 최소 90px로 축소.
- 입력/롱보유/롱관심/숏관심/숏보유 버튼은 검색창 오른쪽 유지.

GitHub에 덮어쓰기
1. /apply-stock5-0-fundamentals-header-fix.mjs
2. /api/fundamentals.js
