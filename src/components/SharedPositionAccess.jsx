import { useState } from 'react';
import { closePositionLogin, connectSharedPositions, openPositionLogin, useSharedPositions } from '../state/sharedPositions';

export default function SharedPositionAccess() {
  const state = useSharedPositions();
  const [password, setPassword] = useState('');
  return <>
    <button type="button" className="shared-record-button" onClick={openPositionLogin}
      title="종목 기록을 서버에 저장하고 다른 기기와 공유합니다">
      {state.connected ? '기록 연결됨' : '기록 로그인'}
    </button>
    {state.loginOpen && <div className="position-login-backdrop">
      <form className="position-login-card" role="dialog" aria-modal="true" aria-labelledby="position-login-title"
        onSubmit={async event => { event.preventDefault(); await connectSharedPositions(password); }}>
        <h2 id="position-login-title">공유 기록 로그인</h2>
        <p>기존 비밀번호로 연결하면 모든 기기에서 같은 종목 기록을 볼 수 있습니다.</p>
        <label htmlFor="position-password">비밀번호</label>
        <input id="position-password" type="password" autoComplete="current-password"
          value={password} onChange={event => setPassword(event.target.value)} required />
        {state.authError && <small role="alert">{state.authError}</small>}
        <div className="position-login-actions">
          <button type="button" onClick={closePositionLogin}>닫기</button>
          <button type="submit" disabled={state.connecting}>{state.connecting ? '연결 중...' : '연결'}</button>
        </div>
      </form>
    </div>}
  </>;
}
