const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ══════════════════════════════
//  DB 초기화
// ══════════════════════════════
const db = new Database('glow.db');
db.pragma('journal_mode = WAL');

db.exec(`
  -- 사이트(테넌트) 테이블
  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    domain TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    logo TEXT DEFAULT '✨',
    primary_color TEXT DEFAULT '#7209B7',
    accent_color TEXT DEFAULT '#F72585',
    kakao TEXT DEFAULT '',
    bank TEXT DEFAULT '',
    margin REAL DEFAULT 50,
    exrate REAL DEFAULT 1380,
    credit REAL DEFAULT 0,
    active INTEGER DEFAULT 1,
    created TEXT DEFAULT (datetime('now'))
  );

  -- 회원 테이블 (siteId 포함)
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    pw TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    balance REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    joined TEXT DEFAULT (datetime('now')),
    UNIQUE(site_id, email)
  );

  -- 서비스 테이블 (글로벌 - 슈퍼어드민 관리)
  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pl TEXT DEFAULT 'other',
    rate REAL DEFAULT 0,
    min INTEGER DEFAULT 100,
    max INTEGER DEFAULT 1000000,
    desc TEXT DEFAULT '',
    api_id TEXT DEFAULT NULL,
    active INTEGER DEFAULT 1
  );

  -- 주문 테이블 (siteId 포함)
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    uid TEXT NOT NULL,
    uname TEXT NOT NULL,
    sid TEXT NOT NULL,
    sname TEXT NOT NULL,
    pl TEXT DEFAULT 'other',
    api_order_id TEXT DEFAULT NULL,
    link TEXT NOT NULL,
    qty INTEGER NOT NULL,
    charge REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    created TEXT DEFAULT (datetime('now'))
  );

  -- 충전 테이블 (siteId 포함)
  CREATE TABLE IF NOT EXISTS charges (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    uid TEXT NOT NULL,
    uname TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    created TEXT DEFAULT (datetime('now'))
  );

  -- 글로벌 설정 (슈퍼어드민 전용)
  CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── 기본 데이터 ──
const defaults = {
  peakerr_api_key: '',
  tg_token: '',
  tg_chat: ''
};
for (const [k, v] of Object.entries(defaults)) {
  const exists = db.prepare('SELECT key FROM global_settings WHERE key=?').get(k);
  if (!exists) db.prepare('INSERT INTO global_settings(key,value) VALUES(?,?)').run(k, v);
}

// 기본 사이트 생성 (localhost 및 render 도메인)
const defaultSite = db.prepare('SELECT id FROM sites WHERE id=?').get('default');
if (!defaultSite) {
  db.prepare(`INSERT INTO sites(id,domain,name,logo,primary_color,accent_color,kakao,bank,margin,exrate,credit)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run('default', 'localhost', 'GLOW', '✨', '#7209B7', '#F72585',
      'https://open.kakao.com/o/sphCuRed',
      '우리은행 1002-160-164625 (예금주: 조인호)',
      50, 1380, 999999999);
}

// 슈퍼어드민 생성
const superAdmin = db.prepare("SELECT id FROM users WHERE role='superadmin'").get();
if (!superAdmin) {
  const hash = bcrypt.hashSync('6933', 10);
  db.prepare('INSERT INTO users(id,site_id,name,email,pw,role,balance) VALUES(?,?,?,?,?,?,?)')
    .run('superadmin', 'default', '슈퍼관리자', 'leestones@naver.com', hash, 'superadmin', 0);
}

// 기본 서비스 데이터
const svcCount = db.prepare('SELECT COUNT(*) as c FROM services').get().c;
if (svcCount === 0) {
  const svcs = [
    {id:'yt1',name:'YouTube 조회수 — 일반',pl:'youtube',rate:0.50,min:1000,max:1000000,desc:'실제 사용자 기반 자연스러운 조회수. 빠른 시작과 안전한 처리.',active:1},
    {id:'yt2',name:'YouTube 조회수 — 고유지율',pl:'youtube',rate:1.20,min:500,max:500000,desc:'평균 시청 시간 30초 이상 고품질 조회수.',active:1},
    {id:'yt4',name:'YouTube 좋아요',pl:'youtube',rate:0.80,min:50,max:100000,desc:'영상 좋아요 수 빠르게 증가.',active:1},
    {id:'yt5',name:'YouTube 시청시간 (시간)',pl:'youtube',rate:5.00,min:100,max:10000,desc:'수익화 4,000시간 달성.',active:1},
    {id:'ig1',name:'Instagram 팔로워 — 실계정',pl:'instagram',rate:1.50,min:100,max:100000,desc:'실제 활성 계정 팔로워. 드롭 보충 제공.',active:1},
    {id:'ig2',name:'Instagram 팔로워 — 한국인',pl:'instagram',rate:5.00,min:50,max:10000,desc:'국내 타겟 한국인 팔로워.',active:1},
    {id:'ig3',name:'Instagram 좋아요',pl:'instagram',rate:0.30,min:50,max:500000,desc:'게시물 좋아요 빠르게 증가.',active:1},
    {id:'ig4',name:'Instagram 릴스 조회수',pl:'instagram',rate:0.25,min:1000,max:10000000,desc:'릴스 조회수 대량 증가.',active:1},
    {id:'ig5',name:'Instagram 스토리 조회수',pl:'instagram',rate:0.35,min:100,max:1000000,desc:'스토리 조회수 증가.',active:1},
    {id:'tt1',name:'TikTok 팔로워 — 실계정',pl:'tiktok',rate:1.80,min:100,max:100000,desc:'실제 틱톡 사용자 팔로워.',active:1},
    {id:'tt2',name:'TikTok 조회수 — 빠른',pl:'tiktok',rate:0.20,min:1000,max:5000000,desc:'틱톡 조회수 빠르게 대량 증가.',active:1},
    {id:'tt3',name:'TikTok 좋아요',pl:'tiktok',rate:0.40,min:100,max:500000,desc:'영상 좋아요 빠르게 증가.',active:1},
    {id:'tw1',name:'Twitter/X 팔로워',pl:'twitter',rate:2.00,min:100,max:100000,desc:'X 계정 팔로워 증가.',active:1},
    {id:'tw2',name:'Twitter/X 좋아요',pl:'twitter',rate:0.80,min:50,max:100000,desc:'X 게시물 좋아요 증가.',active:1},
    {id:'tw4',name:'Twitter/X 조회수',pl:'twitter',rate:0.30,min:1000,max:1000000,desc:'X 조회수 수익화.',active:1},
    {id:'tg1',name:'Telegram 채널 멤버',pl:'telegram',rate:1.50,min:100,max:100000,desc:'텔레그램 채널 멤버 증가.',active:1},
    {id:'tg2',name:'Telegram 포스트 뷰',pl:'telegram',rate:0.30,min:1000,max:5000000,desc:'채널 게시물 조회수 증가.',active:1},
    {id:'sp1',name:'Spotify 재생수',pl:'spotify',rate:0.40,min:1000,max:1000000,desc:'트랙 재생수 증가.',active:1},
  ];
  const ins = db.prepare('INSERT INTO services(id,name,pl,rate,min,max,desc,active) VALUES(?,?,?,?,?,?,?,?)');
  for (const s of svcs) ins.run(s.id, s.name, s.pl, s.rate, s.min, s.max, s.desc, s.active);
}

// ══════════════════════════════
//  미들웨어
// ══════════════════════════════
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'glow-multi-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ── 1. 도메인 매핑 미들웨어 (핵심!) ──
app.use((req, res, next) => {
  // API 경로가 아닌 경우만
  let host = req.headers.host || 'localhost';
  host = host.split(':')[0]; // 포트 제거

  // 도메인으로 사이트 찾기
  let site = db.prepare('SELECT * FROM sites WHERE domain=? AND active=1').get(host);

  // 못 찾으면 localhost/default로 폴백
  if (!site) {
    site = db.prepare("SELECT * FROM sites WHERE id='default'").get();
  }

  req.site = site;
  req.siteId = site ? site.id : 'default';
  next();
});

// ── 유틸 ──
function getGlobalSetting(key) {
  const row = db.prepare('SELECT value FROM global_settings WHERE key=?').get(key);
  return row ? row.value : '';
}
function setGlobalSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO global_settings(key,value) VALUES(?,?)').run(key, value);
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  if (!['admin','superadmin'].includes(req.session.role))
    return res.status(403).json({ error: '관리자 권한 필요' });
  next();
}
function requireSuperAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '로그인 필요' });
  if (req.session.role !== 'superadmin')
    return res.status(403).json({ error: '슈퍼관리자 권한 필요' });
  next();
}
async function tgAlert(msg) {
  const token = getGlobalSetting('tg_token');
  const chat = getGlobalSetting('tg_chat');
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: msg, parse_mode: 'HTML' })
    });
  } catch (e) { console.log('TG 오류:', e.message); }
}

// ══════════════════════════════
//  3. 동적 UI 변수 API (프론트에서 사이트 테마 로드)
// ══════════════════════════════
app.get('/api/site-config', (req, res) => {
  const site = req.site;
  if (!site) return res.json({ error: '사이트를 찾을 수 없습니다' });
  res.json({
    name: site.name,
    logo: site.logo,
    primaryColor: site.primary_color,
    accentColor: site.accent_color,
    kakao: site.kakao,
    bank: site.bank,
    margin: site.margin,
    exrate: site.exrate
  });
});

// ══════════════════════════════
//  AUTH API
// ══════════════════════════════
app.post('/api/login', (req, res) => {
  const { email, pw } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE site_id=? AND email=?').get(req.siteId, email);

  // 슈퍼어드민은 모든 사이트에서 로그인 가능
  const superAdmin = db.prepare("SELECT * FROM users WHERE role='superadmin' AND email=?").get(email);
  const targetUser = user || superAdmin;

  if (!targetUser || !bcrypt.compareSync(pw, targetUser.pw))
    return res.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' });
  if (targetUser.status === 'banned')
    return res.json({ error: '정지된 계정입니다. 관리자에게 문의하세요.' });

  req.session.userId = targetUser.id;
  req.session.role = targetUser.role;
  req.session.siteId = req.siteId;

  res.json({ ok: true, user: {
    id: targetUser.id, name: targetUser.name,
    email: targetUser.email, role: targetUser.role,
    balance: targetUser.balance
  }});
});

app.post('/api/register', (req, res) => {
  const { name, email, pw } = req.body;
  if (!name || !email || !pw) return res.json({ error: '모든 항목을 입력하세요' });
  if (pw.length < 6) return res.json({ error: '비밀번호는 6자 이상이어야 합니다' });
  const exists = db.prepare('SELECT id FROM users WHERE site_id=? AND email=?').get(req.siteId, email);
  if (exists) return res.json({ error: '이미 사용 중인 이메일입니다' });
  const hash = bcrypt.hashSync(pw, 10);
  const id = 'u' + Date.now();
  db.prepare('INSERT INTO users(id,site_id,name,email,pw,role,balance) VALUES(?,?,?,?,?,?,?)')
    .run(id, req.siteId, name, email, hash, 'user', 0);
  const newUser = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  req.session.userId = newUser.id;
  req.session.role = newUser.role;
  req.session.siteId = req.siteId;
  res.json({ ok: true, user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, balance: newUser.balance }});
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id,name,email,role,balance,status FROM users WHERE id=?').get(req.session.userId);
  res.json(user);
});

// ══════════════════════════════
//  SERVICES API
// ══════════════════════════════
app.get('/api/services', (req, res) => {
  const site = req.site;
  const mg = site ? site.margin : 50;
  const ex = site ? site.exrate : 1380;
  const svcs = db.prepare('SELECT * FROM services WHERE active=1 ORDER BY rowid').all();
  res.json(svcs.map(s => ({
    ...s,
    sell: Math.round(s.rate / 1000 * 1000 * ex * (1 + mg / 100))
  })));
});

// ══════════════════════════════
//  ORDERS API
// ══════════════════════════════
app.post('/api/orders', requireAuth, async (req, res) => {
  const { sid, link, qty } = req.body;
  const svc = db.prepare('SELECT * FROM services WHERE id=? AND active=1').get(sid);
  if (!svc) return res.json({ error: '서비스를 찾을 수 없습니다' });

  const qtyNum = parseInt(qty);
  if (qtyNum < svc.min || qtyNum > svc.max)
    return res.json({ error: `수량은 ${svc.min.toLocaleString()} ~ ${svc.max.toLocaleString()} 사이여야 합니다` });

  const site = req.site;
  const mg = site ? site.margin : 50;
  const ex = site ? site.exrate : 1380;
  const charge = svc.rate / 1000 * qtyNum * ex * (1 + mg / 100);

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  if ((user.balance || 0) < charge)
    return res.json({ error: `잔액 부족. 현재 ₩${Math.round(user.balance || 0).toLocaleString()}` });

  // ── 2. 크레딧 시스템: 사이트 크레딧 차감 ──
  const apiCost = svc.rate / 1000 * qtyNum; // 달러 원가
  if (site && site.credit < apiCost && site.id !== 'default') {
    return res.json({ error: '사이트 API 크레딧이 부족합니다. 관리자에게 문의하세요.' });
  }

  // 유저 잔액 차감
  db.prepare('UPDATE users SET balance=balance-? WHERE id=?').run(charge, user.id);

  // 사이트 크레딧 차감 (달러 원가만큼)
  if (site && site.id !== 'default') {
    db.prepare('UPDATE sites SET credit=MAX(0,credit-?) WHERE id=?').run(apiCost, site.id);
  }

  // Peakerr API 주문
  let apiOrderId = null;
  const apiKey = getGlobalSetting('peakerr_api_key');
  if (apiKey && svc.api_id) {
    try {
      const resp = await fetch('https://peakerr.com/api/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ key: apiKey, action: 'add', service: svc.api_id, link, quantity: String(qty) })
      });
      const data = await resp.json();
      if (data.order) apiOrderId = String(data.order);
    } catch (e) { console.log('API 오류:', e.message); }
  }

  const orderId = 'O' + Date.now();
  db.prepare('INSERT INTO orders(id,site_id,uid,uname,sid,sname,pl,api_order_id,link,qty,charge,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(orderId, req.siteId, user.id, user.name, svc.id, svc.name, svc.pl, apiOrderId, link, qtyNum, charge, apiOrderId ? 'processing' : 'pending');

  const updatedUser = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  tgAlert(`📦 <b>새 주문</b> [${site?.name || 'GLOW'}]\n👤 ${user.name}\n✦ ${svc.name}\n🔢 ${qtyNum.toLocaleString()}개\n💰 ₩${Math.round(charge).toLocaleString()}\n🔗 ${link}`);

  res.json({ ok: true, orderId, apiOrderId, balance: updatedUser.balance });
});

app.get('/api/orders/my', requireAuth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE uid=? ORDER BY created DESC').all(req.session.userId);
  res.json(orders);
});

// ══════════════════════════════
//  CHARGES API
// ══════════════════════════════
app.post('/api/charges', requireAuth, async (req, res) => {
  const { amount, note } = req.body;
  const amt = parseFloat(amount);
  if (!amt || amt < 5000) return res.json({ error: '최소 ₩5,000 이상' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  const id = 'C' + Date.now();
  db.prepare('INSERT INTO charges(id,site_id,uid,uname,amount,note,status) VALUES(?,?,?,?,?,?,?)')
    .run(id, req.siteId, user.id, user.name, amt, note || '', 'pending');
  tgAlert(`💳 <b>충전요청</b> [${req.site?.name || 'GLOW'}]\n👤 ${user.name}\n💰 ₩${Math.round(amt).toLocaleString()}\n📝 ${note || '-'}`);
  res.json({ ok: true });
});

app.get('/api/charges/my', requireAuth, (req, res) => {
  const charges = db.prepare('SELECT * FROM charges WHERE uid=? ORDER BY created DESC').all(req.session.userId);
  res.json(charges);
});

// ══════════════════════════════
//  ADMIN API (사이트별)
// ══════════════════════════════
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const siteId = req.session.role === 'superadmin' ? null : req.siteId;
  const where = siteId ? 'WHERE site_id=?' : '';
  const params = siteId ? [siteId] : [];

  const users = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role='user' ${siteId?'AND site_id=?':''}`).get(...params).c;
  const orders = db.prepare(`SELECT COUNT(*) as c FROM orders ${where}`).get(...params).c;
  const revenue = db.prepare(`SELECT SUM(charge) as s FROM orders ${where}`).get(...params).s || 0;
  const pendingCharges = db.prepare(`SELECT COUNT(*) as c FROM charges WHERE status='pending' ${siteId?'AND site_id=?':''}`).get(...params).c;
  const credit = req.session.role === 'superadmin' ? null : (req.site?.credit || 0);

  res.json({ users, orders, revenue, pendingCharges, credit });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const siteId = req.session.role === 'superadmin' ? null : req.siteId;
  const orders = siteId
    ? db.prepare('SELECT * FROM orders WHERE site_id=? ORDER BY created DESC').all(siteId)
    : db.prepare('SELECT * FROM orders ORDER BY created DESC').all();
  res.json(orders);
});

app.post('/api/admin/orders/status', requireAdmin, (req, res) => {
  const { id, status } = req.body;
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, id);
  res.json({ ok: true });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const siteId = req.session.role === 'superadmin' ? null : req.siteId;
  const users = siteId
    ? db.prepare("SELECT * FROM users WHERE site_id=? ORDER BY joined DESC").all(siteId)
    : db.prepare("SELECT * FROM users ORDER BY joined DESC").all();
  res.json(users);
});

app.post('/api/admin/users/balance', requireAdmin, (req, res) => {
  const { uid, delta } = req.body;
  db.prepare('UPDATE users SET balance=MAX(0,balance+?) WHERE id=?').run(parseFloat(delta), uid);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  res.json({ ok: true, balance: user.balance });
});

app.post('/api/admin/users/ban', requireAdmin, (req, res) => {
  const { uid } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  if (!user || user.role === 'superadmin') return res.json({ error: '처리할 수 없습니다' });
  const newStatus = user.status === 'banned' ? 'active' : 'banned';
  db.prepare('UPDATE users SET status=? WHERE id=?').run(newStatus, uid);
  res.json({ ok: true, status: newStatus });
});

app.post('/api/admin/users/delete', requireAdmin, (req, res) => {
  const { uid } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  if (!user || ['admin','superadmin'].includes(user.role)) return res.json({ error: '삭제할 수 없습니다' });
  db.prepare('DELETE FROM users WHERE id=?').run(uid);
  db.prepare('DELETE FROM orders WHERE uid=?').run(uid);
  db.prepare('DELETE FROM charges WHERE uid=?').run(uid);
  res.json({ ok: true });
});

app.post('/api/admin/users/resetpw', requireAdmin, (req, res) => {
  const { uid, newpw } = req.body;
  if (!newpw || newpw.length < 6) return res.json({ error: '6자 이상 입력하세요' });
  const hash = bcrypt.hashSync(newpw, 10);
  db.prepare('UPDATE users SET pw=? WHERE id=?').run(hash, uid);
  res.json({ ok: true });
});

app.post('/api/admin/users/role', requireAdmin, (req, res) => {
  const { uid, role } = req.body;
  if (uid === req.session.userId) return res.json({ error: '본인 등급은 변경 불가' });
  db.prepare('UPDATE users SET role=? WHERE id=?').run(role, uid);
  res.json({ ok: true });
});

app.get('/api/admin/users/:uid/detail', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT id,name,email,role,balance,status,joined FROM users WHERE id=?').get(req.params.uid);
  if (!user) return res.json({ error: '회원을 찾을 수 없습니다' });
  const orders = db.prepare('SELECT * FROM orders WHERE uid=? ORDER BY created DESC').all(req.params.uid);
  const charges = db.prepare('SELECT * FROM charges WHERE uid=? ORDER BY created DESC').all(req.params.uid);
  res.json({ user, orders, charges });
});

app.get('/api/admin/charges', requireAdmin, (req, res) => {
  const siteId = req.session.role === 'superadmin' ? null : req.siteId;
  const charges = siteId
    ? db.prepare('SELECT * FROM charges WHERE site_id=? ORDER BY created DESC').all(siteId)
    : db.prepare('SELECT * FROM charges ORDER BY created DESC').all();
  res.json(charges);
});

app.post('/api/admin/charges/process', requireAdmin, (req, res) => {
  const { id, action } = req.body;
  const charge = db.prepare('SELECT * FROM charges WHERE id=?').get(id);
  if (!charge) return res.json({ error: '충전 요청을 찾을 수 없습니다' });
  const status = action === 'approve' ? 'approved' : 'rejected';
  db.prepare('UPDATE charges SET status=? WHERE id=?').run(status, id);
  if (action === 'approve') {
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(charge.amount, charge.uid);
    tgAlert(`✅ 충전승인 [${req.site?.name}]\n👤 ${charge.uname}\n💰 ₩${Math.round(charge.amount).toLocaleString()}`);
  }
  res.json({ ok: true });
});

// 사이트 설정 (일반 어드민 - 자기 사이트만)
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const site = req.site;
  const isSuperAdmin = req.session.role === 'superadmin';
  res.json({
    name: site?.name || '',
    kakao: site?.kakao || '',
    bank: site?.bank || '',
    margin: site?.margin || 50,
    exrate: site?.exrate || 1380,
    credit: site?.credit || 0,
    // 슈퍼어드민만 API 키 볼 수 있음
    apikey: isSuperAdmin ? (getGlobalSetting('peakerr_api_key') ? '••••(설정됨)' : '') : '(슈퍼관리자 전용)',
    tg_token: isSuperAdmin ? (getGlobalSetting('tg_token') ? '••••(설정됨)' : '') : '',
    tg_chat: isSuperAdmin ? getGlobalSetting('tg_chat') : '',
    isSuperAdmin
  });
});

app.post('/api/admin/settings/save', requireAdmin, (req, res) => {
  const { key, value } = req.body;
  const isSuperAdmin = req.session.role === 'superadmin';

  // 슈퍼어드민 전용 설정
  const superOnly = ['peakerr_api_key', 'tg_token', 'tg_chat'];
  if (superOnly.includes(key)) {
    if (!isSuperAdmin) return res.json({ error: '슈퍼관리자 전용 설정입니다' });
    setGlobalSetting(key, value);
    return res.json({ ok: true });
  }

  // 사이트별 설정
  const siteFields = ['name','kakao','bank','margin','exrate','primary_color','accent_color','logo'];
  if (siteFields.includes(key)) {
    db.prepare(`UPDATE sites SET ${key}=? WHERE id=?`).run(value, req.siteId);
    return res.json({ ok: true });
  }

  res.json({ error: '잘못된 설정 키' });
});

// Peakerr API 테스트 (슈퍼어드민 전용)
app.get('/api/admin/api-test', requireSuperAdmin, async (req, res) => {
  const apiKey = getGlobalSetting('peakerr_api_key');
  if (!apiKey) return res.json({ error: 'API 키가 설정되지 않았습니다' });
  try {
    const resp = await fetch('https://peakerr.com/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key: apiKey, action: 'balance' })
    });
    const data = await resp.json();
    if (data.balance !== undefined) res.json({ ok: true, balance: data.balance });
    else res.json({ error: JSON.stringify(data) });
  } catch (e) { res.json({ error: e.message }); }
});

// 서비스 동기화 (슈퍼어드민 전용)
app.get('/api/admin/api-sync', requireSuperAdmin, async (req, res) => {
  const apiKey = getGlobalSetting('peakerr_api_key');
  if (!apiKey) return res.json({ error: 'API 키가 설정되지 않았습니다' });
  try {
    const resp = await fetch('https://peakerr.com/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key: apiKey, action: 'services' })
    });
    const data = await resp.json();
    if (!Array.isArray(data)) return res.json({ error: 'API 응답 오류' });
    db.prepare('DELETE FROM services').run();
    const ins = db.prepare('INSERT INTO services(id,name,pl,rate,min,max,desc,api_id,active) VALUES(?,?,?,?,?,?,?,?,?)');
    for (const s of data) {
      ins.run('api_'+s.service, s.name, detectPlat(s.name+' '+(s.category||'')),
        parseFloat(s.rate||0), parseInt(s.min||100), parseInt(s.max||1000000),
        s.type||'', String(s.service), 1);
    }
    res.json({ ok: true, count: data.length });
  } catch (e) { res.json({ error: e.message }); }
});

// 텔레그램 테스트
app.post('/api/admin/tg-test', requireSuperAdmin, async (req, res) => {
  const token = getGlobalSetting('tg_token');
  const chat = getGlobalSetting('tg_chat');
  if (!token || !chat) return res.json({ error: '텔레그램 설정을 먼저 저장하세요' });
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: '✅ GLOW 멀티 알림 테스트 성공! ✨' })
    });
    const data = await resp.json();
    if (data.ok) res.json({ ok: true });
    else res.json({ error: data.description });
  } catch (e) { res.json({ error: e.message }); }
});

// ══════════════════════════════
//  슈퍼어드민 전용 - 사이트 관리
// ══════════════════════════════

// 전체 사이트 목록
app.get('/api/super/sites', requireSuperAdmin, (req, res) => {
  const sites = db.prepare('SELECT * FROM sites ORDER BY created DESC').all();
  res.json(sites);
});

// 사이트 생성
app.post('/api/super/sites/create', requireSuperAdmin, (req, res) => {
  const { domain, name, logo, primaryColor, accentColor, adminEmail, adminPw, margin, exrate, credit } = req.body;
  if (!domain || !name || !adminEmail || !adminPw)
    return res.json({ error: '필수 항목을 입력하세요' });

  const siteId = 'site_' + Date.now();

  // 사이트 생성
  db.prepare(`INSERT INTO sites(id,domain,name,logo,primary_color,accent_color,margin,exrate,credit)
    VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(siteId, domain, name, logo||'✨', primaryColor||'#7209B7', accentColor||'#F72585',
      parseFloat(margin||50), parseFloat(exrate||1380), parseFloat(credit||0));

  // 사이트 어드민 계정 생성
  const hash = bcrypt.hashSync(adminPw, 10);
  db.prepare('INSERT INTO users(id,site_id,name,email,pw,role,balance) VALUES(?,?,?,?,?,?,?)')
    .run('admin_'+siteId, siteId, '관리자', adminEmail, hash, 'admin', 0);

  res.json({ ok: true, siteId });
});

// 사이트 크레딧 충전 (2. 크레딧 시스템)
app.post('/api/super/sites/credit', requireSuperAdmin, (req, res) => {
  const { siteId, amount } = req.body;
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.json({ error: '금액을 입력하세요' });
  db.prepare('UPDATE sites SET credit=credit+? WHERE id=?').run(amt, siteId);
  const site = db.prepare('SELECT * FROM sites WHERE id=?').get(siteId);
  res.json({ ok: true, credit: site.credit });
});

// 사이트 수정
app.post('/api/super/sites/update', requireSuperAdmin, (req, res) => {
  const { siteId, name, domain, logo, primaryColor, accentColor, margin, exrate, active } = req.body;
  db.prepare('UPDATE sites SET name=?,domain=?,logo=?,primary_color=?,accent_color=?,margin=?,exrate=?,active=? WHERE id=?')
    .run(name, domain, logo, primaryColor, accentColor, parseFloat(margin), parseFloat(exrate), active?1:0, siteId);
  res.json({ ok: true });
});

// 슈퍼어드민 전체 현황
app.get('/api/super/dashboard', requireSuperAdmin, (req, res) => {
  const sites = db.prepare('SELECT * FROM sites ORDER BY created DESC').all();
  const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='user'").get().c;
  const totalOrders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const totalRevenue = db.prepare('SELECT SUM(charge) as s FROM orders').get().s || 0;
  const pendingCharges = db.prepare("SELECT COUNT(*) as c FROM charges WHERE status='pending'").get().c;
  const apiBalance = null; // 런타임에 Peakerr에서 가져옴

  // 사이트별 통계
  const siteStats = sites.map(s => ({
    ...s,
    userCount: db.prepare("SELECT COUNT(*) as c FROM users WHERE site_id=? AND role='user'").get(s.id).c,
    orderCount: db.prepare('SELECT COUNT(*) as c FROM orders WHERE site_id=?').get(s.id).c,
    revenue: db.prepare('SELECT SUM(charge) as v FROM orders WHERE site_id=?').get(s.id).v || 0,
    pendingCharge: db.prepare("SELECT COUNT(*) as c FROM charges WHERE site_id=? AND status='pending'").get(s.id).c,
  }));

  res.json({ sites: siteStats, totalUsers, totalOrders, totalRevenue, pendingCharges });
});

function detectPlat(n) {
  n = n.toLowerCase();
  if (n.includes('youtube')) return 'youtube';
  if (n.includes('instagram')) return 'instagram';
  if (n.includes('tiktok')) return 'tiktok';
  if (n.includes('threads')) return 'threads';
  if (n.includes('twitter') || n.includes(' x ')) return 'twitter';
  if (n.includes('telegram')) return 'telegram';
  if (n.includes('facebook')) return 'facebook';
  if (n.includes('spotify')) return 'spotify';
  if (n.includes('naver')) return 'naver';
  return 'other';
}

// SPA 라우팅
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✨ GLOW Multi-Tenant 서버 실행 중: http://localhost:${PORT}`);
});
