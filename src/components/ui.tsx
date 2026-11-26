/** 공통 UI 컴포넌트 (24장): 아이콘, 로고, 모달, 확인창, 알림, 로딩, 빈 상태, 페이지 나누기, 입력 필드 */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { BRAND } from '../config/env';

export function Icon({ name, fill, className, label }: { name: string; fill?: boolean; className?: string; label?: string }) {
  return (
    <span className={`ms${fill ? ' fill' : ''}${className ? ' ' + className : ''}`} aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined}>
      {name}
    </span>
  );
}

export function Logo({ subtitle = true, to }: { subtitle?: boolean; to?: string }) {
  const inner = (
    <>
      <span className="logo-mark" aria-hidden="true">P</span>
      <span className="logo-text">
        <strong>{BRAND.name}</strong>
        {subtitle && <span>통합 업무지원 플랫폼</span>}
      </span>
    </>
  );
  return to ? <a className="logo" href={to} aria-label={BRAND.platformKo + ' 홈'}>{inner}</a> : <span className="logo" aria-label={BRAND.platformKo}>{inner}</span>;
}

export function Spinner({ small, label = '불러오는 중' }: { small?: boolean; label?: string }) {
  return <span className={`spinner${small ? ' small' : ''}`} role="status" aria-label={label} />;
}

export function Loading({ text = '불러오는 중입니다…' }: { text?: string }) {
  return (
    <div className="center-fill">
      <Spinner />
      <span>{text}</span>
    </div>
  );
}

export function Empty({ icon = 'inbox', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <div style={{ fontWeight: 500, color: 'var(--text)' }}>{title}</div>
      {children && <div className="small" style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

export function Alert({ kind = 'info', children, icon }: { kind?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode; icon?: string }) {
  const ic = icon || { info: 'info', warn: 'warning', error: 'error', ok: 'check_circle' }[kind];
  return (
    <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon name={ic} />
      <div className="grow">{children}</div>
    </div>
  );
}

export function Badge({ kind, children, icon }: { kind?: 'ok' | 'warn' | 'err' | 'info' | 'navy' | 'new'; children: ReactNode; icon?: string }) {
  return (
    <span className={`badge${kind ? ' ' + kind : ''}`}>
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}

export function Modal({ title, onClose, children, footer, size }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'xwide' }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)');
    (first || el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const f = el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const a = f[0];
        const b = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${size ? ' ' + size : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="닫기"><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** 확인 모달. requirePassword=true 이면 관리자 재인증용 비밀번호 입력란을 표시 */
export function ConfirmDialog(props: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requirePassword?: boolean;
  requireText?: string;
  onConfirm: (password: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [pw, setPw] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ok = (!props.requirePassword || pw.length > 0) && (!props.requireText || text.trim().toLowerCase() === props.requireText.toLowerCase());
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await props.onConfirm(pw);
      props.onClose();
    } catch (e) {
      setError((e as Error).message || '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn secondary" type="button" onClick={props.onClose}>취소</button>
          <button className={`btn${props.danger ? ' danger' : ''}`} type="button" disabled={!ok || busy} onClick={submit}>
            {busy && <Spinner small />} {props.confirmLabel || '확인'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div>{props.message}</div>
        {props.requireText && (
          <TextField label={`확인을 위해 "${props.requireText}" 를 입력하세요`} value={text} onChange={setText} autoComplete="off" />
        )}
        {props.requirePassword && (
          <PasswordField label="현재 관리자 비밀번호 (재인증)" value={pw} onChange={setPw} autoComplete="current-password" onEnter={ok ? submit : undefined} />
        )}
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

export function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const list: number[] = [];
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  for (let i = start; i <= Math.min(pages, start + 4); i++) list.push(i);
  return (
    <nav className="pager" aria-label="페이지 나누기">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="이전 페이지"><Icon name="chevron_left" /></button>
      {list.map((p) => (
        <button type="button" key={p} aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)}>{p}</button>
      ))}
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="다음 페이지"><Icon name="chevron_right" /></button>
      <span className="small muted" style={{ marginLeft: 8 }}>총 {total.toLocaleString()}건</span>
    </nav>
  );
}

/* ───────── 입력 필드 ───────── */

interface BaseField { label: string; hint?: ReactNode; error?: string; required?: boolean; className?: string }

export function TextField(p: BaseField & { value: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoComplete?: string; maxLength?: number; disabled?: boolean; inputMode?: 'text' | 'email' | 'tel' | 'url' | 'numeric'; onEnter?: () => void; min?: string; max?: string }) {
  const id = useId();
  return (
    <div className={`field${p.className ? ' ' + p.className : ''}`}>
      <label htmlFor={id} className={p.required ? 'req' : undefined}>{p.label}</label>
      <input
        id={id}
        className="input"
        type={p.type || 'text'}
        value={p.value}
        placeholder={p.placeholder}
        autoComplete={p.autoComplete}
        maxLength={p.maxLength}
        disabled={p.disabled}
        inputMode={p.inputMode}
        min={p.min}
        max={p.max}
        required={p.required}
        aria-invalid={p.error ? true : undefined}
        aria-describedby={p.hint || p.error ? id + '-d' : undefined}
        onChange={(e) => p.onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && p.onEnter) { e.preventDefault(); p.onEnter(); } }}
      />
      {(p.hint || p.error) && <div id={id + '-d'} className={p.error ? 'err' : 'hint'}>{p.error || p.hint}</div>}
    </div>
  );
}

export function PasswordField(p: BaseField & { value: string; onChange: (v: string) => void; autoComplete?: string; onEnter?: () => void }) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div className={`field${p.className ? ' ' + p.className : ''}`}>
      <label htmlFor={id} className={p.required ? 'req' : undefined}>{p.label}</label>
      <div className="input-group">
        <input
          id={id}
          className="input"
          type={show ? 'text' : 'password'}
          value={p.value}
          autoComplete={p.autoComplete || 'current-password'}
          required={p.required}
          aria-invalid={p.error ? true : undefined}
          aria-describedby={p.hint || p.error ? id + '-d' : undefined}
          onChange={(e) => p.onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && p.onEnter) { e.preventDefault(); p.onEnter(); } }}
          spellCheck={false}
          autoCapitalize="off"
        />
        <button type="button" className="icon-btn small" onClick={() => setShow((s) => !s)} aria-label={show ? '비밀번호 숨기기' : '비밀번호 표시'} aria-pressed={show}>
          <Icon name={show ? 'visibility_off' : 'visibility'} />
        </button>
      </div>
      {(p.hint || p.error) && <div id={id + '-d'} className={p.error ? 'err' : 'hint'}>{p.error || p.hint}</div>}
    </div>
  );
}

export function SelectField<T extends string>(p: BaseField & { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={`field${p.className ? ' ' + p.className : ''}`}>
      <label htmlFor={id} className={p.required ? 'req' : undefined}>{p.label}</label>
      <select id={id} className="input" value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value as T)}>
        {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {(p.hint || p.error) && <div className={p.error ? 'err' : 'hint'}>{p.error || p.hint}</div>}
    </div>
  );
}

export function TextArea(p: BaseField & { value: string; onChange: (v: string) => void; rows?: number; maxLength?: number; placeholder?: string }) {
  const id = useId();
  return (
    <div className={`field${p.className ? ' ' + p.className : ''}`}>
      <label htmlFor={id} className={p.required ? 'req' : undefined}>{p.label}</label>
      <textarea id={id} className="input" rows={p.rows || 4} value={p.value} maxLength={p.maxLength} placeholder={p.placeholder} onChange={(e) => p.onChange(e.target.value)} />
      {(p.hint || p.error) && <div className={p.error ? 'err' : 'hint'}>{p.error || p.hint}</div>}
    </div>
  );
}

export function Check({ label, checked, onChange, disabled, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className="check" title={hint}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/* ───────── 토스트 알림 ───────── */

type Toast = { id: number; text: string; kind: 'info' | 'ok' | 'error' };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-3), { id, text, kind }]);
    window.setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={t.kind === 'error' ? 'error' : t.kind === 'ok' ? 'check_circle' : 'info'} />
            <span className="grow">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** 한 번만 표시되는 비밀값 (임시 비밀번호·통합 인증 키) */
export function SecretOnce({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  return (
    <div className="stack">
      <Alert kind="warn">{label} — 이 화면을 닫으면 다시 확인할 수 없습니다. 지금 복사하여 안전하게 전달하세요.</Alert>
      <div className="secret-box">
        <span className="grow">{value}</span>
        <button type="button" className="btn small secondary" onClick={async () => toast((await copyText(value)) ? '복사했습니다.' : '복사하지 못했습니다.', 'ok')}>
          <Icon name="content_copy" /> 복사
        </button>
      </div>
    </div>
  );
}
