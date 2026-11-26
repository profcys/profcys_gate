/**
 * 업무 서비스 실행 (16·21장)
 *
 * - 클릭 즉시 빈 탭을 열고(팝업 차단 방지), 서버가 권한을 재검증해 돌려준 URL 로 이동한다.
 * - 새 탭에는 opener 를 제거해 역방향 탭 가로채기(reverse tabnabbing)를 막는다.
 * - SSO 서비스: 일회용 인증 코드를 URL 이 아닌 POST 본문으로 전달(기본) → 브라우저 기록·리퍼러·서버 로그 노출 최소화.
 */
import { api } from './api';
import type { LaunchResult } from '../types';

function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function postInto(win: Window, url: string, field: string, value: string) {
  const d = win.document;
  d.open();
  d.write(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>PROFCYS — 연결 중</title></head>` +
      `<body style="font-family:sans-serif;color:#1e293b;padding:40px">업무 서비스로 안전하게 연결하는 중입니다…` +
      `<form id="f" method="POST" action="${escapeAttr(url)}"><input type="hidden" name="${escapeAttr(field)}" value="${escapeAttr(value)}"></form></body></html>`,
  );
  d.close();
  (d.getElementById('f') as HTMLFormElement).submit();
}

function withQuery(url: string, key: string, value: string) {
  return url + (url.includes('?') ? '&' : '?') + encodeURIComponent(key) + '=' + encodeURIComponent(value);
}

/**
 * @returns 'opened' | 'embed' (임베딩 경로로 이동해야 함)
 */
export async function launchService(serviceId: string, preferredMode?: string): Promise<{ result: LaunchResult; mode: 'opened' | 'embed' | 'same-tab' }> {
  const sameTab = preferredMode === 'SAME_TAB';
  const embed = preferredMode === 'EMBED';
  const win = !sameTab && !embed ? window.open('about:blank', '_blank') : null;
  let result: LaunchResult;
  try {
    result = await api<LaunchResult>('launch', { serviceId });
  } catch (e) {
    win?.close();
    throw e;
  }
  if (result.openMode === 'EMBED' && !result.sso) {
    win?.close();
    return { result, mode: 'embed' };
  }
  // 팝업이 차단된 경우 현재 탭에서 실행 (SSO 코드는 같은 방식으로 전달)
  const target: Window = (result.openMode === 'SAME_TAB' ? window : win || window.open('about:blank', '_blank')) || window;
  if (target !== window) {
    try { target.opener = null; } catch { /* noop */ }
  }
  if (result.sso) {
    if (result.sso.transport === 'POST') {
      if (target === window) {
        const f = document.createElement('form');
        f.method = 'POST';
        f.action = result.url;
        const i = document.createElement('input');
        i.type = 'hidden';
        i.name = result.sso.param;
        i.value = result.sso.code;
        f.appendChild(i);
        document.body.appendChild(f);
        f.submit();
      } else {
        postInto(target, result.url, result.sso.param, result.sso.code);
      }
    } else {
      target.location.replace(withQuery(result.url, result.sso.param, result.sso.code));
    }
  } else {
    target.location.replace(result.url);
  }
  return { result, mode: target === window ? 'same-tab' : 'opened' };
}
