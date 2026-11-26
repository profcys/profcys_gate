/**
 * PROFCYS Gateway API — 서비스 URL 검증 및 유형 자동 분류 (14·16장)
 * 파일: apps-script/gateway-api/03_UrlCheck.js
 *
 * Apps Script 런타임에는 URL 클래스가 없으므로 자체 파서를 사용한다.
 */

const DANGEROUS_SCHEMES = ['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'ftp:', 'ws:', 'wss:', 'chrome:', 'intent:'];

/**
 * @return {{scheme:string, host:string, port:string, path:string, query:string, hash:string}|null}
 */
function parseUrl_(raw) {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^\/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(raw);
  if (!m) return null;
  const authority = m[2];
  if (authority.indexOf('@') >= 0) return { scheme: m[1].toLowerCase(), host: '', userinfo: true };
  const hp = /^([^:]+)(?::(\d{1,5}))?$/.exec(authority);
  if (!hp) return null;
  return {
    scheme: m[1].toLowerCase(),
    host: hp[1].toLowerCase(),
    port: hp[2] || '',
    path: m[3] || '/',
    query: m[4] || '',
    hash: m[5] || '',
  };
}

function isIpLiteral_(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.indexOf('[') === 0 || host.indexOf(':') >= 0 || /^0x[0-9a-f]+$/i.test(host) || /^\d+$/.test(host);
}

function isInternalHost_(host) {
  return host === 'localhost' || /\.(localhost|local|internal|intranet|lan|home|corp|invalid|test)$/.test(host) ||
    host === 'metadata.google.internal' || host.indexOf('.') < 0;
}

function hostAllowed_(host, allowedDomains) {
  const list = allowedDomains && allowedDomains.length ? allowedDomains : DEFAULT_ALLOWED_SERVICE_DOMAINS;
  for (let i = 0; i < list.length; i++) {
    const d = String(list[i]).toLowerCase().trim();
    if (!d) continue;
    if (d === '*') return true;
    if (host === d || host.slice(-(d.length + 1)) === '.' + d) return true;
  }
  return false;
}

/** URL 비교용 정규화 (호스트 소문자, 끝 슬래시 제거, 해시 제거) */
function normalizeUrlForCompare_(raw) {
  const p = parseUrl_(String(raw || '').trim());
  if (!p || !p.host) return String(raw || '').trim();
  let path = p.path.replace(/\/+$/, '');
  return p.scheme + '://' + p.host + (p.port ? ':' + p.port : '') + path + p.query;
}

/** URL 형식 기반 서비스 유형 자동 분류 */
function classifyServiceType_(raw) {
  const p = parseUrl_(String(raw || '').trim());
  if (!p || !p.host) return 'OTHER';
  const h = p.host;
  const path = p.path;
  if (h === 'script.google.com' && path.indexOf('/macros/') === 0) return 'APPS_SCRIPT';
  if (h === 'script.google.com' && /^\/a\/[^/]+\/macros\//.test(path)) return 'APPS_SCRIPT';
  if (h === 'forms.gle' || (h === 'docs.google.com' && path.indexOf('/forms/') === 0)) return 'GOOGLE_FORMS';
  if (h === 'docs.google.com' && path.indexOf('/spreadsheets/') === 0) return 'GOOGLE_SHEETS';
  if (h === 'docs.google.com' && path.indexOf('/document/') === 0) return 'GOOGLE_DOCS';
  if (h === 'docs.google.com' && path.indexOf('/presentation/') === 0) return 'GOOGLE_SLIDES';
  if (h === 'drive.google.com') return 'GOOGLE_DRIVE';
  if (h === 'sites.google.com') return 'GOOGLE_SITES';
  if (h === 'lookerstudio.google.com' || h === 'datastudio.google.com') return 'LOOKER_STUDIO';
  if (/\.(web\.app|firebaseapp\.com)$/.test(h)) return 'FIREBASE_HOSTING';
  if (/\.(run\.app|appspot\.com|cloudfunctions\.net)$/.test(h)) return 'GOOGLE_CLOUD';
  if (/(gemini\.google\.com|notebooklm\.google\.com|aistudio\.google\.com)$/.test(h)) return 'AI_SERVICE';
  return 'EXTERNAL';
}

/** 서비스 유형별 기본 아이콘·인증 방식 */
const SERVICE_TYPE_DEFAULTS = {
  APPS_SCRIPT: { icon: 'code', authenticationMode: 'SSO_REQUIRED' },
  GOOGLE_FORMS: { icon: 'assignment', authenticationMode: 'GOOGLE_ACCOUNT' },
  GOOGLE_SHEETS: { icon: 'table_chart', authenticationMode: 'GOOGLE_ACCOUNT' },
  GOOGLE_DOCS: { icon: 'description', authenticationMode: 'GOOGLE_ACCOUNT' },
  GOOGLE_SLIDES: { icon: 'slideshow', authenticationMode: 'GOOGLE_ACCOUNT' },
  GOOGLE_DRIVE: { icon: 'folder', authenticationMode: 'GOOGLE_ACCOUNT' },
  GOOGLE_SITES: { icon: 'language', authenticationMode: 'GOOGLE_ACCOUNT' },
  LOOKER_STUDIO: { icon: 'insights', authenticationMode: 'GOOGLE_ACCOUNT' },
  FIREBASE_HOSTING: { icon: 'web', authenticationMode: 'EXTERNAL_SELF' },
  GOOGLE_CLOUD: { icon: 'cloud', authenticationMode: 'EXTERNAL_SELF' },
  AI_SERVICE: { icon: 'smart_toy', authenticationMode: 'EXTERNAL_SELF' },
  EXTERNAL: { icon: 'open_in_new', authenticationMode: 'EXTERNAL_SELF' },
  OTHER: { icon: 'apps', authenticationMode: 'UNVERIFIED' },
};

/**
 * 서비스 URL 정적 검증 (16장)
 * @param {string} raw
 * @param {{allowedDomains?:string[], existing?:Array<{serviceId:string,url:string}>, selfId?:string}} opts
 * @return {{ok:boolean, errors:Array<{code:string,message:string}>, warnings:string[], url:string, serviceType:string, host:string}}
 */
function validateServiceUrl_(raw, opts) {
  opts = opts || {};
  const errors = [];
  const warnings = [];
  const url = String(raw == null ? '' : raw).trim();
  const add = function (code, message) { errors.push({ code: code, message: message }); };
  if (!url) {
    add('URL_REQUIRED', '서비스 연결 URL 을 입력하세요.');
    return { ok: false, errors: errors, warnings: warnings, url: url, serviceType: 'OTHER', host: '' };
  }
  const lower = url.toLowerCase().replace(/[\s\u0000-\u001f]/g, '');
  for (let i = 0; i < DANGEROUS_SCHEMES.length; i++) {
    if (lower.indexOf(DANGEROUS_SCHEMES[i]) === 0) {
      add('URL_DANGEROUS_SCHEME', '허용되지 않는 URL 스킴입니다 (' + DANGEROUS_SCHEMES[i] + ').');
      return { ok: false, errors: errors, warnings: warnings, url: url, serviceType: 'OTHER', host: '' };
    }
  }
  if (url.length > 2048) add('URL_TOO_LONG', 'URL 이 너무 깁니다 (최대 2048자).');
  if (/[\s<>"'`]/.test(url)) add('URL_INVALID', 'URL 에 공백이나 허용되지 않는 문자가 포함되어 있습니다.');
  const p = parseUrl_(url);
  if (!p) {
    add('URL_INVALID', 'URL 형식이 올바르지 않습니다. https:// 로 시작하는 전체 주소를 입력하세요.');
    return { ok: false, errors: errors, warnings: warnings, url: url, serviceType: 'OTHER', host: '' };
  }
  if (p.userinfo) add('URL_USERINFO', 'URL 에 사용자 정보(@)를 포함할 수 없습니다.');
  if (p.scheme !== 'https') add('URL_HTTPS_REQUIRED', 'HTTPS 주소만 등록할 수 있습니다.');
  if (p.host) {
    if (isIpLiteral_(p.host)) add('URL_IP_NOT_ALLOWED', 'IP 주소 형식의 URL 은 등록할 수 없습니다.');
    else if (isInternalHost_(p.host)) add('URL_INTERNAL_HOST', '내부 네트워크 주소는 등록할 수 없습니다.');
    else if (!hostAllowed_(p.host, opts.allowedDomains)) add('URL_DOMAIN_NOT_ALLOWED', '허용되지 않은 도메인입니다 (' + p.host + '). 최고관리자가 허용 도메인 정책에 추가해야 합니다.');
    if (p.port && p.port !== '443') add('URL_PORT_NOT_ALLOWED', '표준 HTTPS 포트(443) 이외의 포트는 허용되지 않습니다.');
  }
  const norm = normalizeUrlForCompare_(url);
  (opts.existing || []).forEach(function (s) {
    if (s.serviceId !== opts.selfId && normalizeUrlForCompare_(s.url) === norm) {
      add('URL_DUPLICATE', '이미 등록된 URL 입니다 (서비스 ID: ' + s.serviceId + ').');
    }
  });
  const type = classifyServiceType_(url);
  if (type === 'APPS_SCRIPT' && !/\/exec$/.test(p.path) && !/\/dev$/.test(p.path)) {
    warnings.push('Apps Script 웹앱 URL 은 보통 /exec 로 끝납니다. 배포 URL 인지 확인하세요.');
  }
  if (type === 'APPS_SCRIPT' && /\/dev$/.test(p.path)) warnings.push('/dev URL 은 테스트용이며 편집 권한자만 접근할 수 있습니다.');
  return { ok: errors.length === 0, errors: errors, warnings: warnings, url: url, serviceType: type, host: p.host || '' };
}
