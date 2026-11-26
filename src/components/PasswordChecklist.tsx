/** 비밀번호 정책 안내 (23장). 서버가 최종 검증하며, 이 화면 검사는 입력 편의를 위한 것이다. */
import { Icon } from './ui';

const COMMON = ['password', 'password1', 'password123', 'qwerty123', '123456789012', 'admin1234', 'profcys123', 'profcys1234', '1q2w3e4r5t6y', 'welcome123'];

export function passwordRules(pw: string, minLength: number, username?: string) {
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^A-Za-z0-9]/.test(pw)) classes++;
  const lower = pw.toLowerCase();
  return [
    { ok: pw.length >= minLength, text: `${minLength}자 이상` },
    { ok: classes >= 3, text: '대문자·소문자·숫자·특수문자 중 3종류 이상' },
    { ok: !!pw && !COMMON.includes(lower) && !/^(.)\1+$/.test(pw), text: '흔한 비밀번호·반복 문자 금지' },
    { ok: !username || username.length < 3 || !lower.includes(username.toLowerCase()), text: '아이디 포함 금지' },
  ];
}

export function passwordProblems(pw: string, minLength: number, username?: string): string[] {
  return passwordRules(pw, minLength, username).filter((r) => !r.ok).map((r) => r.text);
}

export function PasswordChecklist({ password, minLength, username }: { password: string; minLength: number; username?: string }) {
  return (
    <ul className="small" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 2 }} aria-label="비밀번호 조건">
      {passwordRules(password, minLength, username).map((r) => (
        <li key={r.text} style={{ color: r.ok ? 'var(--success)' : 'var(--text-2)' }}>
          <Icon name={r.ok ? 'check_circle' : 'radio_button_unchecked'} /> {r.text}
          <span className="sr-only">{r.ok ? ' 충족' : ' 미충족'}</span>
        </li>
      ))}
    </ul>
  );
}
