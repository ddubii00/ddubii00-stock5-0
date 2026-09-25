import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/components/ChartColumn.jsx';
let s = await readFile(path, 'utf8');

if (s.includes('STOCK5_HOLD_TOGGLE_V4')) {
  console.log('OK: stock5-0 hold toggle V4 already applied');
  process.exit(0);
}

const oldBlock = `    if (isHoldStatus(status)) {
      // 보유 버튼은 색상/분류만 지정한다. 평균가 입력창은 열지 않는다.
      if (positionStatus !== status) {
        emitPositionChange({ status, averagePrice: null });
      }
      return;
    }
`;

const newBlock = `    if (isHoldStatus(status)) {
      // STOCK5_HOLD_TOGGLE_V4
      // 같은 보유 버튼을 다시 누르면 선택을 해제해 흰색으로 되돌린다.
      // 선택 해제 시 저장된 평균가와 평균가 수평선도 함께 제거된다.
      if (positionStatus === status) {
        emitPositionChange(null);
      } else {
        emitPositionChange({ status, averagePrice: null });
      }
      return;
    }
`;

if (!s.includes(oldBlock)) {
  throw new Error('ChartColumn.jsx: hold button handler target not found. apply-stock5-0-controls-fix.mjs 를 먼저 실행하세요.');
}

s = s.replace(oldBlock, newBlock);
await writeFile(path, s, 'utf8');

console.log('updated: src/components/ChartColumn.jsx');
console.log('OK: 롱보유/숏보유 재클릭 시 선택 해제(흰색) 적용');
