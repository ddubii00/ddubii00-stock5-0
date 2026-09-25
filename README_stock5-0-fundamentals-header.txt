stock5-0 헤더/재무지표 표시 패치

변경 사항
1. 상단 헤더
   - 지수/환율 숫자: 소수점 제거
   - 절대 변화량: 소수점 제거
   - 등락률: 소수점 1자리
   - 지수 사이 간격 소폭 확대

2. 각 주식 종목명 바로 아래 한 줄 재무지표
   - 시총
   - 매출
   - 영업익
   - PER
   - PBR
   - ROE
   - EPS
   - 영업이익률(영업M)
   - 매출성장률

3. 통화별 단위
   - 한국(KRW): 조/억, EPS는 원
   - 미국(USD): $T/$B/$M
   - 일본(JPY): ¥T/¥B/¥M
   - 기타 통화도 통화코드 + T/B/M

4. 영업익 표시
   - Yahoo Finance가 직접 영업익을 주지 않는 경우 TTM 매출 × 영업이익률 또는 EBIT를 사용하며
     화면에서 '영업익≈'로 표시해 근사값임을 구분

GitHub에 올릴 파일
- /apply-stock5-0-fundamentals-header-fix.mjs
- /api/fundamentals.js

Oracle에서는 기존 패치들을 적용한 뒤 이 패치를 마지막에 실행하세요.
