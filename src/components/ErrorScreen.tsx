import { Link } from 'react-router-dom';
import { Icon, Logo } from './ui';

export function ErrorScreen({ code, title, message }: { code: string; title: string; message: string }) {
  return (
    <div className="center-fill" style={{ minHeight: '80vh', textAlign: 'center', padding: 16 }}>
      <Logo />
      <div style={{ fontSize: 56, fontWeight: 700, color: 'var(--navy)', fontFamily: 'Roboto' }}>{code}</div>
      <h1 style={{ fontSize: 20 }}>{title}</h1>
      <p className="muted">{message}</p>
      <Link className="btn" to="/"><Icon name="home" /> 통합 포털 홈으로</Link>
    </div>
  );
}
