import { openPositionLogin, saveSharedPosition, useSharedPositions } from '../state/sharedPositions';

const BUTTONS = [
  ['long-hold', '롱 보유'], ['long-watch', '롱 관심'],
  ['short-watch', '숏 관심'], ['short-hold', '숏 보유'],
];

export default function PositionButtons({ symbol, name }) {
  const state = useSharedPositions();
  const key = String(symbol || '').trim().toUpperCase();
  const position = state.positions[key];
  const saving = Boolean(state.saving[key]);
  const toggle = status => {
    if (saving) return;
    if (!state.connected) { openPositionLogin(); return; }
    void saveSharedPosition(key, { name, status: position?.status === status ? '' : status });
  };
  const toggleFlag = flag => {
    if (saving) return;
    if (!state.connected) { openPositionLogin(); return; }
    void saveSharedPosition(key, { name, [flag]: !position?.[flag] });
  };
  return <div className="position-controls-wrapper">
    <div className="position-mini-controls" aria-label={`${name || symbol} 종목 기록`} aria-busy={saving}>
      {BUTTONS.map(([status, label]) => <button key={status} type="button"
        className={`position-mini-btn ${status}${position?.status === status ? ' active' : ''}`}
        aria-pressed={position?.status === status} aria-disabled={saving}
        onClick={() => toggle(status)}>{label}</button>)}
      <button type="button" className={`position-mini-btn ready${position?.ready ? ' active' : ''}`}
        aria-pressed={position?.ready === true} aria-disabled={saving}
        onClick={() => toggleFlag('ready')}>준비!</button>
      <button type="button" className={`position-mini-btn caution${position?.caution ? ' active' : ''}`}
        aria-pressed={position?.caution === true} aria-disabled={saving}
        onClick={() => toggleFlag('caution')}>주의!</button>
    </div>
    {state.errors[key] && <small className="position-save-error" role="alert" title={state.errors[key]}>{state.errors[key]}</small>}
  </div>;
}
