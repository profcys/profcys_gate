/**
 * 변경 알림 구독 (20장 실시간 갱신)
 *
 * 관리자가 서비스·권한·UI 설정을 바꾸면 서버가 공개 문서 public/revision 의 rev 값을 올린다.
 * 이 문서에는 숫자와 시각만 있으며 비밀정보가 없다.
 *  - Firebase 설정이 있으면: Firestore 실시간 구독 1개만 사용 (사용자당 문서 1개 → 무료 할당량 절약)
 *  - 없으면(로컬 개발): 화면이 보일 때만 sync 요청으로 주기 확인
 * 변경이 감지되면 화면 전체를 새로고침하지 않고, 필요한 데이터만 다시 불러온다.
 */
import { config } from '../config/env';
import { api } from './api';

type Listener = (rev: number) => void;
type FirebaseWebConfig = { projectId: string; apiKey: string; appId?: string };

/**
 * 빌드 시 VITE_FIREBASE_* 값이 있으면 그것을, 없으면 Firebase Hosting 이 자동 제공하는 /__/firebase/init.json 을 사용한다.
 * (Hosting 예약 경로이며 공개 클라이언트 설정만 담긴다. 로컬 개발 서버에서는 없으므로 폴링으로 대체)
 */
async function resolveFirebaseConfig(): Promise<FirebaseWebConfig | null> {
  if (config.firebase.projectId && config.firebase.apiKey) return config.firebase;
  if (!import.meta.env.PROD) return null;
  try {
    const r = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as Partial<FirebaseWebConfig>;
    return j.projectId && j.apiKey ? { projectId: j.projectId, apiKey: j.apiKey, appId: j.appId } : null;
  } catch {
    return null;
  }
}

export function subscribeRevision(onChange: Listener): () => void {
  let stopped = false;
  let timer: number | null = null;
  let last = -1;
  const emit = (rev: number) => {
    if (stopped) return;
    if (last !== -1 && rev !== last) onChange(rev);
    last = rev;
  };
  let unsub: (() => void) | null = null;

  void (async () => {
    const fb = await resolveFirebaseConfig();
    if (!fb) {
      startPolling();
      return;
    }
    try {
      const [{ initializeApp, getApps }, { getFirestore, doc, onSnapshot }] = await Promise.all([import('firebase/app'), import('firebase/firestore')]);
      const app = getApps()[0] || initializeApp({ projectId: fb.projectId, apiKey: fb.apiKey, appId: fb.appId || undefined });
      const db = getFirestore(app);
      if (stopped) return;
      unsub = onSnapshot(doc(db, 'public', 'revision'), (snap) => emit(Number(snap.get('rev')) || 0), () => startPolling());
    } catch {
      startPolling();
    }
  })();

  function startPolling() {
    if (timer || stopped) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      api<{ rev: number }>('sync').then((r) => emit(r.rev)).catch(() => undefined);
    };
    tick();
    timer = window.setInterval(tick, config.pollIntervalMs);
  }

  // 탭으로 돌아오면 한 번 확인
  const onVisible = () => {
    if (document.visibilityState === 'visible' && timer) api<{ rev: number }>('sync').then((r) => emit(r.rev)).catch(() => undefined);
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    if (unsub) unsub();
    if (timer) window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
