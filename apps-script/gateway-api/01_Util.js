/**
 * PROFCYS Gateway API — 공통 유틸리티
 * 파일: apps-script/gateway-api/01_Util.js
 *
 * 런타임 의존 기능(해시, 난수, 시간)은 platform_() 어댑터를 통해서만 사용한다.
 * 덕분에 동일한 코드를 Apps Script 와 Node.js(테스트·로컬 개발 서버)에서 실행할 수 있다.
 */

/** API 오류. code 는 프런트엔드가 한글 메시지로 변환하는 키이다. */
class ApiError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.code = code;
    this.details = details || null;
  }
}

function fail_(code, message, details) {
  throw new ApiError(code, message, details);
}

function now_() {
  return platform_().now();
}

function sha256Hex_(text) {
  return platform_().sha256Hex(String(text));
}

/** 암호학적으로 안전한 난수 16진 문자열 (bytes * 2 글자) */
function randomHex_(bytes) {
  return platform_().randomHex(bytes || 32);
}

/** 고정 길이 비교 (타이밍 공격 완화) */
function safeEqual_(a, b) {
  a = String(a == null ? '' : a);
  b = String(b == null ? '' : b);
  const ha = sha256Hex_('cmp:' + a);
  const hb = sha256Hex_('cmp:' + b);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0 && a.length === b.length;
}

/** 사용자 아이디 정규화: 앞뒤 공백 제거 + 소문자 (8장 대소문자 정규화 정책) */
function normalizeUsername_(username) {
  return String(username == null ? '' : username).trim().toLowerCase();
}

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

function validateUsername_(normalized) {
  if (!USERNAME_PATTERN.test(normalized)) {
    fail_('INVALID_USERNAME', '아이디는 영문 소문자·숫자로 시작하는 3~32자이며 . _ - 만 사용할 수 있습니다.');
  }
}

/**
 * 비밀번호 정책 검증 (23장). 위반 사항 목록을 반환한다. (빈 배열이면 통과)
 */
function passwordPolicyViolations_(password, opts) {
  opts = opts || {};
  const minLength = Math.max(8, Number(opts.minLength) || 12);
  const v = [];
  const pw = String(password == null ? '' : password);
  if (pw.length < minLength) v.push('최소 ' + minLength + '자 이상이어야 합니다.');
  if (pw.length > 128) v.push('128자 이하여야 합니다.');
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^A-Za-z0-9]/.test(pw)) classes++;
  if (classes < 3) v.push('영문 대문자, 소문자, 숫자, 특수문자 중 3종류 이상을 포함해야 합니다.');
  const lower = pw.toLowerCase();
  if (COMMON_PASSWORDS.indexOf(lower) >= 0) v.push('흔히 사용되는 취약한 비밀번호입니다.');
  if (/^(.)\1+$/.test(pw)) v.push('같은 문자만 반복할 수 없습니다.');
  if (opts.username && opts.username.length >= 3 && lower.indexOf(String(opts.username).toLowerCase()) >= 0) {
    v.push('비밀번호에 아이디를 포함할 수 없습니다.');
  }
  return v;
}

function assertPasswordPolicy_(password, opts) {
  const v = passwordPolicyViolations_(password, opts);
  if (v.length) fail_('WEAK_PASSWORD', v.join(' '), { violations: v });
}

/**
 * 안전한 임시 비밀번호 생성 (헷갈리는 문자 0/O, 1/l/I 제외). 4종류 문자를 모두 포함한다.
 */
function generateTemporaryPassword_(length) {
  length = Math.max(12, length || 16);
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+?'];
  const all = sets.join('');
  // 16비트 난수 2*length 개 (앞 절반: 문자 선택, 뒤 절반: 섞기)
  const hex = randomHex_(length * 4);
  const nums = [];
  for (let i = 0; i + 4 <= hex.length; i += 4) nums.push(parseInt(hex.substr(i, 4), 16));
  const chars = [];
  for (let i = 0; i < sets.length; i++) chars.push(sets[i][nums[i] % sets[i].length]);
  for (let i = sets.length; i < length; i++) chars.push(all[nums[i] % all.length]);
  // Fisher–Yates 섞기
  for (let i = chars.length - 1; i > 0; i--) {
    const r = nums[length + i] % (i + 1);
    const t = chars[i]; chars[i] = chars[r]; chars[r] = t;
  }
  const out = chars.join('');
  return passwordPolicyViolations_(out).length ? generateTemporaryPassword_(length) : out;
}

/** 'YYYY-MM-DD' → 한국시간 기준 해당 일 00:00 (ms) */
function kstDayStartMs_(dateStr) {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) - 9 * 3600 * 1000;
}

/** 'YYYY-MM-DD' → 한국시간 기준 해당 일 23:59:59.999 (ms) */
function kstDayEndMs_(dateStr) {
  const s = kstDayStartMs_(dateStr);
  return s == null ? null : s + 24 * 3600 * 1000 - 1;
}

/** ms → 한국시간 'YYYY-MM-DD' */
function kstDateKey_(ms) {
  const d = new Date(ms + 9 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const mo = ('0' + (d.getUTCMonth() + 1)).slice(-2);
  const da = ('0' + d.getUTCDate()).slice(-2);
  return y + '-' + mo + '-' + da;
}

function isValidDateStr_(s) {
  return s == null || s === '' || kstDayStartMs_(s) != null;
}

/** 문자열 입력 정리: 길이 제한 + 제어문자 제거 */
function cleanText_(value, maxLen) {
  if (value == null) return '';
  let s = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (maxLen && s.length > maxLen) s = s.substring(0, maxLen);
  return s;
}

function cleanList_(value, maxItems, maxLen) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (let i = 0; i < value.length && out.length < (maxItems || 200); i++) {
    const s = cleanText_(value[i], maxLen || 100);
    if (s && out.indexOf(s) < 0) out.push(s);
  }
  return out;
}

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
function cleanColor_(value, fallback) {
  const s = cleanText_(value, 7);
  return COLOR_PATTERN.test(s) ? s.toUpperCase() : fallback;
}

const ICON_PATTERN = /^[a-z0-9_]{1,40}$/;
function cleanIcon_(value, fallback) {
  const s = cleanText_(value, 40).toLowerCase().replace(/\s+/g, '_');
  return ICON_PATTERN.test(s) ? s : fallback;
}

function pick_(obj, keys) {
  const out = {};
  keys.forEach(function (k) { if (obj && obj[k] !== undefined) out[k] = obj[k]; });
  return out;
}

function clone_(obj) {
  return obj == null ? obj : JSON.parse(JSON.stringify(obj));
}

/** 객체에서 store 메타필드(_id, _v)를 제거한 사본 */
function stripMeta_(doc) {
  if (!doc) return doc;
  const out = {};
  Object.keys(doc).forEach(function (k) { if (k !== '_id' && k !== '_v') out[k] = doc[k]; });
  return out;
}

/** 두 객체의 변경된 최상위 키 목록 */
function changedKeys_(before, after) {
  const keys = {};
  Object.keys(before || {}).forEach(function (k) { keys[k] = 1; });
  Object.keys(after || {}).forEach(function (k) { keys[k] = 1; });
  return Object.keys(keys).filter(function (k) {
    if (k === '_id' || k === '_v' || k === 'updatedAt' || k === 'updatedBy' || k === 'version') return false;
    return JSON.stringify((before || {})[k]) !== JSON.stringify((after || {})[k]);
  });
}

/** 한국어 슬러그가 불가능하므로 영문명 기반 ID, 없으면 무작위 ID */
function slugify_(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 40);
}
