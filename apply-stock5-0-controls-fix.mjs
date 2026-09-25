import { readFile, writeFile } from 'node:fs/promises';

async function read(path) {
  return readFile(path, 'utf8');
}

async function write(path, text) {
  await writeFile(path, text, 'utf8');
  console.log(`updated: ${path}`);
}

function replaceRegex(text, regex, replacement, label) {
  if (!regex.test(text)) throw new Error(`${label}: target not found`);
  return text.replace(regex, replacement);
}

async function patchChartColumn() {
  const path = 'src/components/ChartColumn.jsx';
  let s = await read(path);

  if (!s.includes('STOCK5_POSITION_CONTROLS_PATCH')) {
    throw new Error(`${path}: 먼저 apply-stock5-0-update.mjs 를 실행해야 합니다.`);
  }

  // 1) 평균가 수평선: 캔들 데이터가 실제로 로드될 때까지 기다렸다가
  //    createPriceLine을 생성한다. 초기 렌더 타이밍 때문에 선이 누락되던 문제를 방지한다.
  //    V3: "매입가" 태그를 숨기고, 선 두께를 지원 최소값(1px)으로 줄인다.
  const oldPriceLineEffect = /  \/\/ STOCK5_AVERAGE_PRICE_LINE_PATCH(?:_V2)?\n  useEffect\(\(\) => \{[\s\S]*?\n  \}, \[chartsReady, positionState\?\.averagePrice, symbol(?:, mainTf\?\.interval)?\]\);\n/;
  const newPriceLineEffect = `  // STOCK5_AVERAGE_PRICE_LINE_PATCH_V3\n  useEffect(() => {\n    let cancelled = false;\n    let retryTimer = null;\n\n    const removeAveragePriceLine = () => {\n      const candleSeries = ser.current.candle;\n      if (averagePriceLineRef.current && candleSeries) {\n        try { candleSeries.removePriceLine(averagePriceLineRef.current); } catch {}\n      }\n      averagePriceLineRef.current = null;\n    };\n\n    const drawAveragePriceLine = () => {\n      if (cancelled) return;\n      removeAveragePriceLine();\n\n      const price = Number(positionState?.averagePrice);\n      if (!Number.isFinite(price) || price <= 0) return;\n\n      const candleSeries = ser.current.candle;\n      const hasCandleData = Array.isArray(mainCandlesRef.current) && mainCandlesRef.current.length > 0;\n\n      if (!chartsReady || !candleSeries || !hasCandleData) {\n        retryTimer = setTimeout(drawAveragePriceLine, 250);\n        return;\n      }\n\n      try {\n        averagePriceLineRef.current = candleSeries.createPriceLine({\n          price,\n          color: '#dc2626',\n          lineWidth: 1,\n          lineStyle: 2,\n          axisLabelVisible: false,\n          title: '',\n        });\n\n        // 평균가가 현재 가격 범위와 조금 떨어져 있어도 보이도록 가격축을 다시 맞춘다.\n        try { charts.current.price?.priceScale('right').applyOptions({ autoScale: true }); } catch {}\n      } catch (error) {\n        console.warn('매입가 수평선 생성 실패:', error);\n        retryTimer = setTimeout(drawAveragePriceLine, 500);\n      }\n    };\n\n    drawAveragePriceLine();\n\n    return () => {\n      cancelled = true;\n      if (retryTimer) clearTimeout(retryTimer);\n      removeAveragePriceLine();\n    };\n  }, [chartsReady, positionState?.averagePrice, symbol, mainTf?.interval]);\n`;

  if (!s.includes('STOCK5_AVERAGE_PRICE_LINE_PATCH_V3')) {
    s = replaceRegex(s, oldPriceLineEffect, newPriceLineEffect, 'average price line effect');
  }

  // 2) 롱보유/숏보유 클릭은 분류 색상만 변경한다.
  //    평균가 팝업은 오직 "입력" 버튼으로만 연다.
  const oldHandlers = /  const openAveragePriceModal = useCallback\(\(status = positionStatus\) => \{[\s\S]*?\n  \}, \[positionStatus, emitPositionChange, openAveragePriceModal\]\);\n/;
  const newHandlers = `  const openAveragePriceModal = useCallback(() => {\n    if (!isHoldStatus(positionStatus)) {\n      window.alert('롱보유 또는 숏보유를 먼저 선택해 주세요.');\n      return;\n    }\n    setEditingHoldStatus(positionStatus);\n    setAveragePriceInput(Number.isFinite(Number(positionState?.averagePrice)) ? String(positionState.averagePrice) : '');\n    setPositionModalOpen(true);\n  }, [positionStatus, positionState?.averagePrice]);\n\n  const handlePositionButton = useCallback((status) => {\n    if (isHoldStatus(status)) {\n      // 보유 버튼은 색상/분류만 지정한다. 평균가 입력창은 열지 않는다.\n      if (positionStatus !== status) {\n        emitPositionChange({ status, averagePrice: null });\n      }\n      return;\n    }\n\n    if (positionStatus === status) {\n      emitPositionChange(null);\n    } else {\n      emitPositionChange({ status, averagePrice: null });\n    }\n  }, [positionStatus, emitPositionChange]);\n`;

  if (!s.includes("window.alert('롱보유 또는 숏보유를 먼저 선택해 주세요.')")) {
    s = replaceRegex(s, oldHandlers, newHandlers, 'position handlers');
  }

  // 3) 입력 버튼은 항상 활성화한다. 보유 상태가 아니면 클릭 시 안내만 한다.
  const oldInputButton = /                <button\n                  type="button"\n                  className="position-mini-btn position-input-btn"\n                  onClick=\{\(\) => openAveragePriceModal\(\)\}\n                  disabled=\{!holdingSelected\}\n                  title=\{holdingSelected \? '평균가 입력\/수정' : '롱보유 또는 숏보유를 먼저 선택하세요'\}\n                >\n                  입력\n                <\/button>/;
  const newInputButton = `                <button\n                  type="button"\n                  className="position-mini-btn position-input-btn"\n                  onClick={() => openAveragePriceModal()}\n                  title={holdingSelected ? '평균가 입력/수정' : '롱보유 또는 숏보유 선택 후 평균가 입력'}\n                >\n                  입력\n                </button>`;

  if (s.includes('disabled={!holdingSelected}')) {
    s = replaceRegex(s, oldInputButton, newInputButton, 'input button');
  }

  await write(path, s);
}

async function patchCss() {
  const path = 'src/index.css';
  let s = await read(path);

  // 기존 9px 버튼을 살짝 키운다. 모든 버튼의 기본 배경은 계속 흰색이다.
  const oldButtonCss = /\.position-mini-btn \{ appearance: none; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; color: #4b5563; padding: 2px 5px; font: 700 9px\/1\.35 Inter, sans-serif; cursor: pointer; white-space: nowrap; \}/;
  const newButtonCss = `.position-mini-btn { appearance: none; border: 1px solid #d1d5db; border-radius: 5px; background: #fff; color: #4b5563; padding: 3px 7px; min-height: 24px; font: 700 10px/1.35 Inter, sans-serif; cursor: pointer; white-space: nowrap; }`;

  if (oldButtonCss.test(s)) {
    s = s.replace(oldButtonCss, newButtonCss);
  } else if (!s.includes('min-height: 24px; font: 700 10px/1.35 Inter')) {
    throw new Error(`${path}: position button CSS target not found`);
  }

  // 입력 버튼은 언제나 일반 활성 버튼처럼 보이도록 명시한다.
  if (!s.includes('STOCK5_INPUT_ALWAYS_ACTIVE_V2')) {
    s += `\n/* STOCK5_INPUT_ALWAYS_ACTIVE_V2 */\n.position-input-btn { opacity: 1 !important; cursor: pointer !important; }\n`;
  }

  await write(path, s);
}

async function main() {
  await patchChartColumn();
  await patchCss();
  console.log('OK: stock5-0 controls / average-price line V3 fix applied');
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
