/**
 * PROFCYS Gateway — Apps Script 서버 코드를 Node.js 에서 실행하기 위한 메모리 플랫폼
 * 파일: dev/memory-platform.mjs
 *
 * 용도: (1) 자동 테스트  (2) 로컬 개발 서버(dev/dev-server.mjs)
 * 실제 운영에서는 사용하지 않는다. 운영 서버는 apps-script/gateway-api 를 Apps Script 에 그대로 배포한다.
 *
 * Firestore REST 어댑터와 같은 의미론을 따른다:
 *  - create: 문서가 있으면 CONFLICT
 *  - update: 문서가 없으면 NOT_FOUND, ifVersion 이 다르면 CONFLICT
 *  - commit: 모든 전제조건을 먼저 검사한 뒤 한꺼번에 적용 (원자성)
 *  - Date 값은 ms 숫자로 저장 (Firestore timestampValue 를 ms 로 읽는 것과 동일)
 */
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const GATEWAY_DIR = path.resolve(__dirname, '../apps-script/gateway-api');

class StoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function normalizeValue(v) {
  if (v instanceof Date) return v.getTime();
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) if (v[k] !== undefined && k !== '_id' && k !== '_v') o[k] = normalizeValue(v[k]);
    return o;
  }
  return v;
}

function getPath(obj, p) {
  return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, p, value) {
  const segs = p.split('.');
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (!cur[segs[i]] || typeof cur[segs[i]] !== 'object') cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = value;
}

function compare(a, b) {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a < b ? -1 : 1;
}

function matches(doc, [field, op, value]) {
  const v = getPath(doc, field);
  switch (op) {
    case '==': return JSON.stringify(v) === JSON.stringify(value);
    case '!=': return v !== undefined && JSON.stringify(v) !== JSON.stringify(value);
    case '<': return v != null && v < value;
    case '<=': return v != null && v <= value;
    case '>': return v != null && v > value;
    case '>=': return v != null && v >= value;
    case 'array-contains': return Array.isArray(v) && v.includes(value);
    case 'in': return value.includes(v);
    case 'array-contains-any': return Array.isArray(v) && v.some((x) => value.includes(x));
    default: throw new Error('unsupported op ' + op);
  }
}

export function createMemoryStore(initial) {
  /** @type {Map<string, Map<string, {data:any, v:string}>>} */
  const cols = new Map();
  let versionCounter = 0;
  const stats = { reads: 0, writes: 0, queries: 0 };
  const col = (name) => {
    if (!cols.has(name)) cols.set(name, new Map());
    return cols.get(name);
  };
  const out = (id, rec) => (rec ? { ...structuredClone(rec.data), _id: id, _v: rec.v } : null);
  const nextVersion = () => `v${Date.now()}-${++versionCounter}`;

  if (initial) {
    for (const [c, docs] of Object.entries(initial)) {
      for (const [id, data] of Object.entries(docs)) col(c).set(id, { data, v: nextVersion() });
    }
  }

  const store = {
    stats,
    get(c, id) { stats.reads++; return out(id, col(c).get(id)); },
    getMany(c, ids) {
      const r = {};
      for (const id of ids || []) { stats.reads++; const d = out(id, col(c).get(id)); if (d) r[id] = d; }
      return r;
    },
    list(c, q = {}) {
      stats.queries++;
      let docs = [...col(c).entries()].map(([id, rec]) => out(id, rec));
      for (const w of q.where || []) docs = docs.filter((d) => matches(d, w));
      if (q.orderBy) {
        docs.sort((a, b) => {
          for (const [f, dir] of q.orderBy) {
            const r = compare(getPath(a, f), getPath(b, f));
            if (r) return dir === 'desc' ? -r : r;
          }
          return compare(a._id, b._id);
        });
      } else {
        docs.sort((a, b) => compare(a._id, b._id));
      }
      if (q.offset) docs = docs.slice(q.offset);
      if (q.limit) docs = docs.slice(0, q.limit);
      stats.reads += Math.max(1, docs.length);
      return docs;
    },
    count(c, where) {
      return store.list(c, { where }).length;
    },
    commit(ops) {
      // 1단계: 전제조건 검사
      for (const op of ops) {
        const cur = col(op.col).get(op.id);
        if (op.type === 'create' && cur) throw new StoreError('CONFLICT', 'already exists');
        if (op.type === 'update') {
          if (!cur) throw new StoreError('NOT_FOUND', 'not found');
          if (op.ifVersion && cur.v !== op.ifVersion) throw new StoreError('CONFLICT', 'version mismatch');
        }
      }
      // 2단계: 적용
      for (const op of ops) {
        stats.writes++;
        const m = col(op.col);
        const cur = m.get(op.id);
        switch (op.type) {
          case 'create':
          case 'set':
            m.set(op.id, { data: normalizeValue(op.data), v: nextVersion() });
            break;
          case 'update':
          case 'upsert':
            m.set(op.id, { data: { ...(cur ? cur.data : {}), ...normalizeValue(op.data) }, v: nextVersion() });
            break;
          case 'increment': {
            const data = cur ? structuredClone(cur.data) : {};
            for (const [p, val] of Object.entries(op.fields || {})) setPath(data, p, normalizeValue(val));
            for (const [p, n] of Object.entries(op.counters || {})) setPath(data, p, (Number(getPath(data, p)) || 0) + n);
            m.set(op.id, { data, v: nextVersion() });
            break;
          }
          case 'delete':
            m.delete(op.id);
            break;
          default:
            throw new Error('unknown op ' + op.type);
        }
      }
    },
    /** 테스트·저장용 */
    dump() {
      const o = {};
      for (const [c, m] of cols) { o[c] = {}; for (const [id, rec] of m) o[c][id] = rec.data; }
      return o;
    },
    raw: cols,
  };
  return store;
}

function scryptHash(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

export function createMemoryAuth(initial) {
  const accounts = new Map(Object.entries(initial || {}));
  const byEmail = () => new Map([...accounts.entries()].map(([uid, a]) => [a.email, uid]));
  const fail = (code, msg) => { const e = new Error(msg); e.code = code; throw e; };
  return {
    accounts,
    createAccount(email, password, displayName) {
      if (byEmail().has(email)) fail('AUTH_ACCOUNT_EXISTS', 'exists');
      if (String(password).length < 6) fail('WEAK_PASSWORD', 'weak');
      const uid = crypto.randomBytes(14).toString('base64url').replace(/[-_]/g, 'x').slice(0, 28);
      const salt = crypto.randomBytes(16).toString('hex');
      accounts.set(uid, { email, salt, hash: scryptHash(password, salt), displayName, disabled: false });
      return { uid };
    },
    verifyPassword(email, password) {
      const uid = byEmail().get(email);
      if (!uid) return { ok: false, reason: 'INVALID' };
      const a = accounts.get(uid);
      if (scryptHash(String(password), a.salt) !== a.hash) return { ok: false, reason: 'INVALID' };
      if (a.disabled) return { ok: false, reason: 'DISABLED' };
      return { ok: true, uid };
    },
    setPassword(uid, password) {
      const a = accounts.get(uid);
      if (!a) fail('AUTH_ACCOUNT_NOT_FOUND', 'not found');
      a.salt = crypto.randomBytes(16).toString('hex');
      a.hash = scryptHash(password, a.salt);
    },
    setDisabled(uid, disabled) {
      const a = accounts.get(uid);
      if (!a) fail('AUTH_ACCOUNT_NOT_FOUND', 'not found');
      a.disabled = !!disabled;
    },
    deleteAccount(uid) { accounts.delete(uid); },
    dump() { return Object.fromEntries(accounts); },
  };
}

export function createMemoryCache() {
  const m = new Map();
  let clock = () => Date.now();
  return {
    setClock(fn) { clock = fn; },
    get(k) {
      const e = m.get(k);
      if (!e) return null;
      if (e.exp < clock()) { m.delete(k); return null; }
      return e.v;
    },
    put(k, v, ttl) { m.set(k, { v: String(v), exp: clock() + (ttl || 600) * 1000 }); },
    remove(k) { m.delete(k); },
    clear() { m.clear(); },
  };
}

/**
 * @param {{props?:Object, persistFile?:string, probe?:Function}} options
 */
export function createMemoryPlatform(options = {}) {
  let offset = 0;
  let persisted = null;
  if (options.persistFile && fs.existsSync(options.persistFile)) {
    persisted = JSON.parse(fs.readFileSync(options.persistFile, 'utf8'));
  }
  const store = createMemoryStore(persisted && persisted.store);
  const auth = createMemoryAuth(persisted && persisted.auth);
  const cache = createMemoryCache();
  const propsMap = new Map(Object.entries({ FIREBASE_PROJECT_ID: 'profcys-dev', FIREBASE_WEB_API_KEY: 'dev-key', ...(persisted && persisted.props), ...(options.props || {}) }));
  const platform = {
    now: () => Date.now() + offset,
    sha256Hex: (t) => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex'),
    randomHex: (n) => crypto.randomBytes(n || 32).toString('hex'),
    props: {
      get: (k) => (propsMap.has(k) ? propsMap.get(k) : null),
      set: (k, v) => propsMap.set(k, String(v)),
      remove: (k) => propsMap.delete(k),
      map: propsMap,
    },
    cache,
    lock: { withLock: (fn) => fn() },
    store,
    auth,
    probeUrl: options.probe || ((url) => {
      if (/^https:\/\/script\.google\.com\//.test(url)) return { status: 302, location: 'https://script.googleusercontent.com/macros/echo?user_content_key=dev' };
      if (/notfound/.test(url)) return { status: 404 };
      return { status: 200 };
    }),
    /** 테스트용 시간 이동 */
    advance(ms) { offset += ms; },
    persist() {
      if (!options.persistFile) return;
      fs.mkdirSync(path.dirname(options.persistFile), { recursive: true });
      fs.writeFileSync(options.persistFile, JSON.stringify({ store: store.dump(), auth: auth.dump(), props: Object.fromEntries(propsMap) }, null, 1));
    },
  };
  cache.setClock(platform.now);
  return platform;
}

/**
 * Apps Script 서버 코드를 vm 컨텍스트에 로드한다.
 * @return {{handle:(body:Object)=>Object, platform:Object, context:Object, call:(action:string, params?:Object, token?:string)=>Object}}
 */
export function loadGateway(options = {}) {
  const platform = options.platform || createMemoryPlatform(options);
  const silent = options.silent !== false;
  const context = vm.createContext({
    console: silent ? { log() {}, warn() {}, error() {}, info() {} } : console,
    __PROFCYS_PLATFORM__: platform,
    structuredClone,
  });
  const files = fs.readdirSync(GATEWAY_DIR).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(GATEWAY_DIR, f), 'utf8'), context, { filename: f });
  }
  if (!platform.__wrapped) {
    const ApiError = vm.runInContext('ApiError', context);
    const rawCommit = platform.store.commit;
    platform.store.commit = (ops) => {
      try { return rawCommit(ops); } catch (e) {
        if (e instanceof StoreError) throw new ApiError(e.code, e.code === 'CONFLICT' ? '다른 변경 사항과 충돌했습니다.' : '데이터를 찾을 수 없습니다.');
        throw e;
      }
    };
    vm.runInContext('addStoreHelpers_', context)(platform.store);
    platform.__wrapped = true;
  }
  const handle = (body) => JSON.parse(JSON.stringify(context.handleRequest_(JSON.stringify(body))));
  const call = (action, params = {}, token) => handle({ action, params, token, meta: { ua: 'test' } });
  return { handle, call, platform, context };
}
