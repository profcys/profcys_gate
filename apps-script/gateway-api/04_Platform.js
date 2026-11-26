/**
 * PROFCYS Gateway API — 런타임 어댑터
 * 파일: apps-script/gateway-api/04_Platform.js
 *
 * platform_() 은 다음 기능을 제공하는 객체를 반환한다.
 *   now(), sha256Hex(text), randomHex(bytes), props, cache, lock, store, auth, probeUrl(url)
 *
 * - Apps Script: Firestore REST + Identity Toolkit REST (스크립트 소유자 OAuth 토큰 사용, 서비스 계정 키 불필요)
 * - Node.js(테스트·로컬 개발): globalThis.__PROFCYS_PLATFORM__ 에 메모리 구현을 주입한다 (dev/memory-platform.mjs)
 */

let PLATFORM_INSTANCE_ = null;

function platform_() {
  if (typeof globalThis !== 'undefined' && globalThis.__PROFCYS_PLATFORM__) return globalThis.__PROFCYS_PLATFORM__;
  if (!PLATFORM_INSTANCE_) PLATFORM_INSTANCE_ = createGasPlatform_();
  return PLATFORM_INSTANCE_;
}

/** Script Properties 필수 값 */
function requiredProp_(key) {
  const v = platform_().props.get(key);
  if (!v) fail_('SERVER_NOT_CONFIGURED', '서버 설정값(' + key + ')이 없습니다. 설치 가이드의 Script Properties 설정을 확인하세요.');
  return v;
}

/* ═════════════════════════ Apps Script 구현 ═════════════════════════ */

function createGasPlatform_() {
  const props = {
    get: function (k) { return PropertiesService.getScriptProperties().getProperty(k); },
    set: function (k, v) { PropertiesService.getScriptProperties().setProperty(k, String(v)); },
    remove: function (k) { PropertiesService.getScriptProperties().deleteProperty(k); },
  };
  const p = {
    now: function () { return Date.now(); },
    sha256Hex: function (text) {
      const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
      return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
    },
    randomHex: function (bytes) {
      // Utilities.getUuid() 는 Java SecureRandom 기반 UUIDv4 이다. 해시로 섞어 균일한 난수열을 만든다.
      let out = '';
      let i = 0;
      while (out.length < bytes * 2) {
        out += p.sha256Hex(Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + (i++));
      }
      return out.substring(0, bytes * 2);
    },
    props: props,
    cache: createGasCache_(),
    lock: {
      withLock: function (fn) {
        const lock = LockService.getScriptLock();
        if (!lock.tryLock(15000)) fail_('SERVER_BUSY', '요청이 많아 처리하지 못했습니다. 잠시 후 다시 시도하세요.');
        try { return fn(); } finally { lock.releaseLock(); }
      },
    },
    store: null,
    auth: null,
    probeUrl: gasProbeUrl_,
  };
  p.store = createFirestoreStore_(function () { return props.get('FIREBASE_PROJECT_ID'); });
  p.auth = createIdentityToolkitAuth_(
    function () { return props.get('FIREBASE_PROJECT_ID'); },
    function () { return props.get('FIREBASE_WEB_API_KEY'); }
  );
  return p;
}

function createGasCache_() {
  const CHUNK = 25000;
  const c = function () { return CacheService.getScriptCache(); };
  return {
    get: function (key) {
      const cache = c();
      const head = cache.get(key);
      if (head == null) return null;
      if (head.indexOf('#chunks:') !== 0) return head;
      const n = parseInt(head.substring(8), 10);
      const keys = [];
      for (let i = 0; i < n; i++) keys.push(key + '#' + i);
      const parts = cache.getAll(keys);
      let out = '';
      for (let i = 0; i < n; i++) {
        if (parts[keys[i]] == null) return null;
        out += parts[keys[i]];
      }
      return out;
    },
    put: function (key, value, ttlSec) {
      const cache = c();
      const ttl = Math.min(21600, Math.max(1, ttlSec || 600));
      if (value.length <= CHUNK) { cache.put(key, value, ttl); return; }
      const map = {};
      let n = 0;
      for (let i = 0; i < value.length; i += CHUNK) map[key + '#' + (n++)] = value.substring(i, i + CHUNK);
      cache.putAll(map, ttl);
      cache.put(key, '#chunks:' + n, ttl);
    },
    remove: function (key) { c().remove(key); },
  };
}

/**
 * 서비스 연결 확인. SSRF 방지: 정적 검증을 통과한 공개 HTTPS 도메인만 호출하며 리디렉션을 자동으로 따라가지 않는다.
 */
function gasProbeUrl_(url) {
  try {
    const res = UrlFetchApp.fetch(url, { method: 'get', followRedirects: false, muteHttpExceptions: true, validateHttpsCertificates: true });
    const headers = res.getAllHeaders();
    return { status: res.getResponseCode(), location: headers.Location || headers.location || '' };
  } catch (e) {
    return { status: 0, error: String(e && e.message || e).substring(0, 200) };
  }
}

/* ───────────── Firestore REST ───────────── */

const FS_OPS_ = { '==': 'EQUAL', '!=': 'NOT_EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', 'array-contains': 'ARRAY_CONTAINS', 'in': 'IN', 'array-contains-any': 'ARRAY_CONTAINS_ANY' };

function fsQuotePath_(path) {
  return String(path).split('.').map(function (seg) {
    return /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(seg) ? seg : '`' + seg.replace(/[`\\]/g, '\\$&') + '`';
  }).join('.');
}

function fsEncode_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsEncode_) } };
  if (typeof v === 'object') return { mapValue: { fields: fsEncodeFields_(v) } };
  return { stringValue: String(v) };
}

function fsEncodeFields_(obj) {
  const f = {};
  Object.keys(obj).forEach(function (k) {
    if (k === '_id' || k === '_v' || obj[k] === undefined) return;
    f[k] = fsEncode_(obj[k]);
  });
  return f;
}

function fsDecode_(v) {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsDecode_);
  if ('mapValue' in v) return fsDecodeFields_(v.mapValue.fields || {});
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  return null;
}

function fsDecodeFields_(fields) {
  const o = {};
  Object.keys(fields || {}).forEach(function (k) { o[k] = fsDecode_(fields[k]); });
  return o;
}

/** 'a.b.c' 형식의 경로 → 중첩 객체 */
function nestDotted_(flat) {
  const out = {};
  Object.keys(flat || {}).forEach(function (path) {
    const segs = path.split('.');
    let cur = out;
    for (let i = 0; i < segs.length - 1; i++) { cur[segs[i]] = cur[segs[i]] || {}; cur = cur[segs[i]]; }
    cur[segs[segs.length - 1]] = flat[path];
  });
  return out;
}

function createFirestoreStore_(projectIdFn) {
  const base = function () {
    const pid = projectIdFn();
    if (!pid) fail_('SERVER_NOT_CONFIGURED', 'FIREBASE_PROJECT_ID 가 설정되지 않았습니다.');
    return 'https://firestore.googleapis.com/v1/projects/' + pid + '/databases/(default)/documents';
  };
  const docName = function (col, id) {
    const pid = projectIdFn();
    return 'projects/' + pid + '/databases/(default)/documents/' + col + '/' + encodeURIComponent(id);
  };
  const request = function (method, url, body) {
    const opts = {
      method: method,
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    };
    if (body !== undefined) opts.payload = JSON.stringify(body);
    const res = UrlFetchApp.fetch(url, opts);
    const code = res.getResponseCode();
    const text = res.getContentText();
    if (code >= 200 && code < 300) return text ? JSON.parse(text) : {};
    let status = '';
    let msg = '';
    try { const e = JSON.parse(text); status = e.error && e.error.status; msg = e.error && e.error.message; } catch (ignore) { /* noop */ }
    if (code === 404 || status === 'NOT_FOUND') throw new ApiError('NOT_FOUND', '데이터를 찾을 수 없습니다.');
    if (code === 409 || status === 'ALREADY_EXISTS' || status === 'ABORTED') throw new ApiError('CONFLICT', '다른 변경 사항과 충돌했습니다. 새로고침 후 다시 시도하세요.');
    if (status === 'FAILED_PRECONDITION' && /index/i.test(msg)) throw new ApiError('DB_INDEX_REQUIRED', 'Firestore 인덱스가 필요합니다. firestore.indexes.json 을 배포하세요.', { message: msg });
    if (status === 'FAILED_PRECONDITION') throw new ApiError('CONFLICT', '다른 변경 사항과 충돌했습니다. 새로고침 후 다시 시도하세요.');
    console.error('Firestore error', code, text.substring(0, 500));
    throw new ApiError('DB_ERROR', '데이터베이스 요청을 처리하지 못했습니다.', { status: code });
  };
  const fromDoc = function (doc) {
    if (!doc || !doc.name) return null;
    const o = fsDecodeFields_(doc.fields || {});
    o._id = decodeURIComponent(doc.name.substring(doc.name.lastIndexOf('/') + 1));
    o._v = doc.updateTime;
    return o;
  };
  const buildWhere = function (where) {
    if (!where || !where.length) return undefined;
    const filters = where.map(function (w) {
      return { fieldFilter: { field: { fieldPath: fsQuotePath_(w[0]) }, op: FS_OPS_[w[1]], value: fsEncode_(w[2]) } };
    });
    return filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters: filters } };
  };
  const toWrite = function (op) {
    const name = docName(op.col, op.id);
    switch (op.type) {
      case 'create':
        return { update: { name: name, fields: fsEncodeFields_(op.data) }, currentDocument: { exists: false } };
      case 'set':
        return { update: { name: name, fields: fsEncodeFields_(op.data) } };
      case 'update':
      case 'upsert': {
        const keys = Object.keys(op.data).filter(function (k) { return k !== '_id' && k !== '_v' && op.data[k] !== undefined; });
        const w = { update: { name: name, fields: fsEncodeFields_(op.data) }, updateMask: { fieldPaths: keys.map(fsQuotePath_) } };
        if (op.type === 'update') w.currentDocument = op.ifVersion ? { updateTime: op.ifVersion } : { exists: true };
        return w;
      }
      case 'increment': {
        const setFlat = op.fields || {};
        const w = {
          update: { name: name, fields: fsEncodeFields_(nestDotted_(setFlat)) },
          updateMask: { fieldPaths: Object.keys(setFlat).map(fsQuotePath_) },
          updateTransforms: Object.keys(op.counters || {}).map(function (path) {
            return { fieldPath: fsQuotePath_(path), increment: fsEncode_(op.counters[path]) };
          }),
        };
        return w;
      }
      case 'delete':
        return { delete: name };
      default:
        throw new Error('Unknown op ' + op.type);
    }
  };
  const store = {
    get: function (col, id) {
      try { return fromDoc(request('get', base() + '/' + col + '/' + encodeURIComponent(id))); } catch (e) {
        if (e.code === 'NOT_FOUND') return null;
        throw e;
      }
    },
    getMany: function (col, ids) {
      const out = {};
      if (!ids || !ids.length) return out;
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const res = request('post', base() + ':batchGet', { documents: chunk.map(function (id) { return docName(col, id); }) });
        (res || []).forEach(function (r) { if (r.found) { const d = fromDoc(r.found); out[d._id] = d; } });
      }
      return out;
    },
    list: function (col, q) {
      q = q || {};
      const sq = { from: [{ collectionId: col }] };
      const where = buildWhere(q.where);
      if (where) sq.where = where;
      if (q.orderBy) sq.orderBy = q.orderBy.map(function (o) { return { field: { fieldPath: fsQuotePath_(o[0]) }, direction: o[1] === 'desc' ? 'DESCENDING' : 'ASCENDING' }; });
      if (q.limit) sq.limit = q.limit;
      if (q.offset) sq.offset = q.offset;
      const res = request('post', base() + ':runQuery', { structuredQuery: sq });
      return (res || []).filter(function (r) { return r.document; }).map(function (r) { return fromDoc(r.document); });
    },
    count: function (col, where) {
      const sq = { from: [{ collectionId: col }] };
      const w = buildWhere(where);
      if (w) sq.where = w;
      const res = request('post', base() + ':runAggregationQuery', {
        structuredAggregationQuery: { structuredQuery: sq, aggregations: [{ alias: 'n', count: {} }] },
      });
      const r = (res || [])[0];
      return r && r.result ? Number(fsDecode_(r.result.aggregateFields.n)) : 0;
    },
    commit: function (ops) {
      if (!ops || !ops.length) return;
      for (let i = 0; i < ops.length; i += 450) {
        request('post', base() + ':commit', { writes: ops.slice(i, i + 450).map(toWrite) });
      }
    },
  };
  return addStoreHelpers_(store);
}

/** commit 기반 단일 작업 도우미 (메모리 구현과 공용) */
function addStoreHelpers_(store) {
  store.create = function (col, id, data) { store.commit([{ type: 'create', col: col, id: id, data: data }]); };
  store.set = function (col, id, data) { store.commit([{ type: 'set', col: col, id: id, data: data }]); };
  store.update = function (col, id, data, ifVersion) { store.commit([{ type: 'update', col: col, id: id, data: data, ifVersion: ifVersion }]); };
  store.upsert = function (col, id, data) { store.commit([{ type: 'upsert', col: col, id: id, data: data }]); };
  store.remove = function (col, id) { store.commit([{ type: 'delete', col: col, id: id }]); };
  store.increment = function (col, id, counters, fields) { store.commit([{ type: 'increment', col: col, id: id, counters: counters, fields: fields || {} }]); };
  store.add = function (col, data) {
    const id = now_().toString(36) + '-' + randomHex_(6);
    store.create(col, id, data);
    return id;
  };
  return store;
}

/* ───────────── Firebase Authentication (Identity Toolkit REST) ───────────── */

function createIdentityToolkitAuth_(projectIdFn, apiKeyFn) {
  const ADMIN = 'https://identitytoolkit.googleapis.com/v1/projects/';
  const call = function (url, body, useOAuth) {
    const headers = {};
    if (useOAuth) {
      headers.Authorization = 'Bearer ' + ScriptApp.getOAuthToken();
      headers['X-Goog-User-Project'] = projectIdFn();
    }
    const res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: headers, payload: JSON.stringify(body), muteHttpExceptions: true });
    const code = res.getResponseCode();
    const json = JSON.parse(res.getContentText() || '{}');
    if (code >= 200 && code < 300) return { ok: true, data: json };
    const msg = (json.error && json.error.message) || ('HTTP_' + code);
    return { ok: false, message: msg };
  };
  const adminUrl = function (path) {
    const pid = projectIdFn();
    if (!pid) fail_('SERVER_NOT_CONFIGURED', 'FIREBASE_PROJECT_ID 가 설정되지 않았습니다.');
    return ADMIN + pid + path;
  };
  const mapAdminError = function (r) {
    if (/EMAIL_EXISTS|DUPLICATE/.test(r.message)) fail_('AUTH_ACCOUNT_EXISTS', '인증 계정이 이미 존재합니다.');
    if (/WEAK_PASSWORD|PASSWORD_DOES_NOT_MEET_REQUIREMENTS/.test(r.message)) fail_('WEAK_PASSWORD', 'Firebase 비밀번호 정책을 충족하지 않습니다.');
    if (/USER_NOT_FOUND/.test(r.message)) fail_('AUTH_ACCOUNT_NOT_FOUND', '인증 계정을 찾을 수 없습니다.');
    console.error('IdentityToolkit admin error', r.message);
    fail_('AUTH_ERROR', 'Firebase 인증 요청을 처리하지 못했습니다.', { reason: String(r.message).substring(0, 100) });
  };
  return {
    createAccount: function (email, password, displayName) {
      const r = call(adminUrl('/accounts'), { email: email, password: password, displayName: displayName, emailVerified: false, disabled: false }, true);
      if (!r.ok) mapAdminError(r);
      return { uid: r.data.localId };
    },
    verifyPassword: function (email, password) {
      const key = apiKeyFn();
      if (!key) fail_('SERVER_NOT_CONFIGURED', 'FIREBASE_WEB_API_KEY 가 설정되지 않았습니다.');
      const r = call('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(key),
        { email: email, password: password, returnSecureToken: true }, false);
      if (r.ok) return { ok: true, uid: r.data.localId };
      if (/USER_DISABLED/.test(r.message)) return { ok: false, reason: 'DISABLED' };
      if (/TOO_MANY_ATTEMPTS/.test(r.message)) return { ok: false, reason: 'TOO_MANY' };
      if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL/.test(r.message)) return { ok: false, reason: 'INVALID' };
      console.error('signInWithPassword error', r.message);
      return { ok: false, reason: 'ERROR' };
    },
    setPassword: function (uid, password) {
      const r = call(adminUrl('/accounts:update'), { localId: uid, password: password }, true);
      if (!r.ok) mapAdminError(r);
    },
    setDisabled: function (uid, disabled) {
      const r = call(adminUrl('/accounts:update'), { localId: uid, disableUser: !!disabled }, true);
      if (!r.ok) mapAdminError(r);
    },
    deleteAccount: function (uid) {
      const r = call(adminUrl('/accounts:delete'), { localId: uid }, true);
      if (!r.ok && !/USER_NOT_FOUND/.test(r.message)) mapAdminError(r);
    },
  };
}
