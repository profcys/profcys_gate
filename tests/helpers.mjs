import { loadGateway } from '../dev/memory-platform.mjs';

export const ADMIN_PW = 'Adm1n!Secure#2026';
export const USER_PW = 'User!Passw0rd#22';

/** 초기화된 게이트웨이 + 최고관리자 세션 */
export function setup() {
  const g = loadGateway();
  g.platform.props.set('SETUP_TOKEN', 'setup-token-for-tests');
  const b = g.call('bootstrap', { setupToken: 'setup-token-for-tests', password: 'Init!Passw0rd#01' });
  if (!b.ok) throw new Error('bootstrap failed ' + JSON.stringify(b.error));
  let r = g.call('login', { username: 'profcys', password: 'Init!Passw0rd#01' });
  r = g.call('changePassword', { currentPassword: 'Init!Passw0rd#01', newPassword: ADMIN_PW }, r.data.token);
  if (!r.ok) throw new Error('admin password change failed ' + JSON.stringify(r.error));
  const admin = r.data.token;
  const ok = (action, params, token = admin) => {
    const res = g.call(action, params, token);
    if (!res.ok) throw new Error(`${action} failed: ${JSON.stringify(res.error)}`);
    return res.data;
  };
  /** 사용자 생성 + 최초 비밀번호 변경까지 완료한 세션 토큰 반환 */
  const createUser = (username, fields = {}) => {
    const c = ok('admin.users.create', { username, displayName: username, generatePassword: true, ...fields, reauthPassword: ADMIN_PW });
    const l = g.call('login', { username, password: c.temporaryPassword });
    const p = g.call('changePassword', { currentPassword: c.temporaryPassword, newPassword: USER_PW }, l.data.token);
    if (!p.ok) throw new Error('user pw change failed ' + JSON.stringify(p.error));
    return { uid: c.user.uid, token: p.data.token, temporaryPassword: c.temporaryPassword };
  };
  const publish = (serviceId) => ok('admin.services.setStatus', { serviceId, status: 'ACTIVE', approve: true });
  /** 기본 관리자 토큰으로 호출 (실패 응답도 그대로 반환) */
  const call = (action, params, token = admin) => g.call(action, params, token);
  return { g, admin, ok, call, createUser, publish };
}
