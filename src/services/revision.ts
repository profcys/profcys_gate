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

  if (config.firebase.projectId && config.firebase.apiKey) {
    void (async () => {
      try {
        const [{ initializeApp, getApps }, { getFirestore, doc, onSnapshot }] = await Promise.all([import('firebase/app'), import('firebase/firestore')]);
        const app = getApps()[0] || initializeApp({ projectId: config.firebase.projectId, apiKey: config.firebase.apiKey, appId: config.firebase.appId || undefined });
        const db = getFirestore(app);
        if (stopped) return;
        unsub = onSnapshot(doc(db, 'public', 'revision'), (snap) => emit(Number(snap.get('rev')) || 0), () => startPolling());
      } catch {
        startPolling();
      }
    })();
  } else {
    startPolling();
  }

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
