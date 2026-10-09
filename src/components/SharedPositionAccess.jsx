import { useState } from 'react';
import { connectSharedPositions, useSharedPositions } from '../state/sharedPositions';

export default function SharedPositionAccess() {
  const state = useSharedPositions();
  const [password, setPassword] = useState('');
  if (state.connected) return null;
  return <div className="position-login-backdrop">
    <form className="position-login-card" role="dialog" aria-modal="true" aria-labelledby="position-login-title"
      onSubmit={async event => { event.preventDefault(); await connectSharedPositions(password); }}>
      <h2 id="position-login-title">stock5-0 로그인</h2>
      <p>비밀번호로 들어오면 저장된 종목 기록을 불러옵니다. 변경한 기록은 자동 저장되어 다른 기기에서도 볼 수 있습니다.</p>
      <label htmlFor="position-password">비밀번호</label>
      <input id="position-password" type="password" autoComplete="current-password"
        value={password} onChange={event => setPassword(event.target.value)} disabled={state.connecting} required />
      {state.authError && <small role="alert">{state.authError}</small>}
      <div className="position-login-actions">
        <button type="submit" disabled={state.connecting}>{state.connecting ? '로그인 중...' : '들어가기'}</button>
      </div>
    </form>
  </div>;
}
