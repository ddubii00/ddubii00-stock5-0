import { useState } from 'react';

export function applyGlobalVisibility(state, enabled) {
  return state.globalVisible === enabled ? state : { globalVisible: enabled, visible: enabled };
}

export function toggleChartVisibility(state) {
  return { ...state, visible: !state.visible };
}

// A new header command affects all charts; subsequent local toggles stay local.
export function useChartVisibility(globalVisible) {
  const [state, setState] = useState(() => ({ globalVisible, visible: globalVisible }));
  const current = applyGlobalVisibility(state, globalVisible);
  if (current !== state) setState(current);
  return [current.visible, () => setState(toggleChartVisibility)];
}
