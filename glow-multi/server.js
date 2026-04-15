const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── HMAC 자체서명 토큰 시스템 ──
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'glow-multi-secret-key-2024';

function createToken(payload) {
  const data = {
    userId: payload.userId,
    role: payload.role,
    siteId: payload.siteId,
    exp: Date.now() + 7*24*60*60*1000
  };
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url');
  return encoded + '.' + sig;
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url');
    if (sig !== expected) return null;
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (Date.now() > data.exp) return null;
    return { userId: data.userId, role: data.role, siteId: data.siteId };
  } catch(e) { return null; }
}

// ── PostgreSQL 연결 ──
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

// ── DB 초기화 ──
async function initDB() {
  await query(`
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
      created TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      pw TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      balance REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      joined TIMESTAMP DEFAULT NOW(),
      UNIQUE(site_id, email)
    )
  `);

  await query(`
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
    )
  `);

  await query(`
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
      created TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS charges (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      uid TEXT NOT NULL,
      uname TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS global_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 기본 설정
  const defaults = {
    peakerr_api_key: process.env.PEAKERR_API_KEY || '',
    tg_token: process.env.TG_TOKEN || '',
    tg_chat: process.env.TG_CHAT || ''
  };
  for (const [k, v] of Object.entries(defaults)) {
    await query(`INSERT INTO global_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING`, [k, v]);
  }

  // 기본 사이트
  const siteExists = await query(`SELECT id FROM sites WHERE id='default'`);
  if (siteExists.rows.length === 0) {
    await query(`INSERT INTO sites(id,domain,name,logo,primary_color,accent_color,kakao,bank,margin,exrate,credit)
      VALUES('default','localhost','GLOW','✨','#7209B7','#F72585',
      'https://open.kakao.com/o/sphCuRed',
      '우리은행 1002-160-164625 (예금주: 조인호)',
      50,1380,999999999)`);
  }

  // 슈퍼어드민
  const superAdmin = await query(`SELECT id FROM users WHERE role='superadmin'`);
  if (superAdmin.rows.length === 0) {
    const hash = bcrypt.hashSync('6933', 10);
    await query(`INSERT INTO users(id,site_id,name,email,pw,role,balance) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      ['superadmin', 'default', '슈퍼관리자', 'leestones@naver.com', hash, 'superadmin', 0]);
  }

  // 기본 서비스
  await query(`DELETE FROM services WHERE id LIKE 'api_%'`);
  const svcCount = await query(`SELECT COUNT(*) as c FROM services WHERE id NOT LIKE 'api_%'`);
  if (parseInt(svcCount.rows[0].c) === 0) {
    const svcs = [
      {id:'yt1',name:'YouTube 조회수 — 일반 (빠른 처리)',pl:'youtube',rate:0.50,min:1000,max:1000000,desc:'실제 사용자 기반의 자연스러운 조회수입니다.'},
      {id:'yt2',name:'YouTube 조회수 — 고유지율 (30초+)',pl:'youtube',rate:1.20,min:500,max:500000,desc:'평균 시청 시간 30초 이상의 고품질 조회수입니다.'},
      {id:'yt3',name:'YouTube 조회수 — 미국/영어권',pl:'youtube',rate:2.50,min:500,max:100000,desc:'미국, 캐나다, 영국 등 영어권 시청자 조회수입니다.'},
      {id:'yt4',name:'YouTube 구독자 — 실계정',pl:'youtube',rate:3.00,min:100,max:50000,desc:'실제 활성 계정의 구독자를 늘려드립니다.'},
      {id:'yt5',name:'YouTube 좋아요',pl:'youtube',rate:0.80,min:50,max:100000,desc:'영상의 좋아요 수를 빠르게 증가시켜 드립니다.'},
      {id:'yt6',name:'YouTube 시청시간 (시간)',pl:'youtube',rate:5.00,min:100,max:10000,desc:'유튜브 수익화 필수 조건인 4,000시간 달성을 도와드립니다.'},
      {id:'yt7',name:'YouTube 댓글 (커스텀)',pl:'youtube',rate:8.00,min:10,max:500,desc:'원하는 내용의 댓글을 달아드립니다.'},
      {id:'yt8',name:'YouTube 라이브 시청자',pl:'youtube',rate:10.00,min:100,max:10000,desc:'유튜브 라이브 방송의 동시 시청자 수를 늘려드립니다.'},
      {id:'yt9',name:'YouTube 쇼츠 조회수',pl:'youtube',rate:0.15,min:1000,max:5000000,desc:'유튜브 쇼츠 영상의 조회수를 빠르게 증가시켜 드립니다.'},
      {id:'yt10',name:'YouTube 저장 (플레이리스트)',pl:'youtube',rate:1.50,min:100,max:50000,desc:'영상 저장 및 플레이리스트 추가 수를 늘려드립니다.'},
      {id:'ig1',name:'Instagram 팔로워 — 글로벌 실계정',pl:'instagram',rate:1.50,min:100,max:100000,desc:'전 세계 실제 활성 계정의 팔로워를 늘려드립니다.'},
      {id:'ig2',name:'Instagram 팔로워 — 한국인',pl:'instagram',rate:5.00,min:50,max:10000,desc:'국내 타겟 마케팅에 최적화된 한국인 팔로워입니다.'},
      {id:'ig3',name:'Instagram 팔로워 — 미국/영어권',pl:'instagram',rate:4.50,min:50,max:20000,desc:'미국, 영국 등 영어권 실계정 팔로워입니다.'},
      {id:'ig4',name:'Instagram 좋아요 — 빠른 처리',pl:'instagram',rate:0.30,min:50,max:500000,desc:'게시물 좋아요 수를 빠르게 높여드립니다.'},
      {id:'ig5',name:'Instagram 릴스 조회수',pl:'instagram',rate:0.25,min:1000,max:10000000,desc:'릴스 영상의 조회수를 대량으로 증가시켜 드립니다.'},
      {id:'ig6',name:'Instagram 스토리 조회수',pl:'instagram',rate:0.35,min:100,max:1000000,desc:'인스타그램 스토리 조회수를 높여드립니다.'},
      {id:'ig7',name:'Instagram 게시물 저장',pl:'instagram',rate:0.50,min:100,max:100000,desc:'게시물 저장 수를 증가시켜 드립니다.'},
      {id:'ig8',name:'Instagram 댓글 (커스텀)',pl:'instagram',rate:10.00,min:5,max:300,desc:'원하는 내용의 댓글을 달아드립니다.'},
      {id:'ig9',name:'Instagram 팔로워 — 여성 타겟',pl:'instagram',rate:3.50,min:50,max:20000,desc:'여성 계정 위주의 팔로워입니다.'},
      {id:'ig10',name:'Instagram 라이브 시청자',pl:'instagram',rate:8.00,min:100,max:5000,desc:'인스타그램 라이브의 실시간 시청자 수를 늘려드립니다.'},
      {id:'ig11',name:'Instagram 인상 수 (Impressions)',pl:'instagram',rate:0.20,min:1000,max:5000000,desc:'게시물 인상 수를 증가시켜 드립니다.'},
      {id:'ig12',name:'Instagram 팔로우 + 언팔',pl:'instagram',rate:2.00,min:100,max:10000,desc:'팔로우 후 일정 시간 뒤 언팔하는 자연스러운 방식입니다.'},
      {id:'tt1',name:'TikTok 팔로워 — 실계정',pl:'tiktok',rate:1.80,min:100,max:100000,desc:'실제 틱톡 사용자 팔로워를 늘려드립니다.'},
      {id:'tt2',name:'TikTok 조회수 — 초고속',pl:'tiktok',rate:0.15,min:1000,max:10000000,desc:'틱톡 영상의 조회수를 매우 빠르게 대량으로 증가시켜 드립니다.'},
      {id:'tt3',name:'TikTok 조회수 — 고유지율',pl:'tiktok',rate:0.80,min:500,max:1000000,desc:'평균 시청 완료율이 높은 고품질 조회수입니다.'},
      {id:'tt4',name:'TikTok 좋아요',pl:'tiktok',rate:0.40,min:100,max:500000,desc:'틱톡 영상의 좋아요 수를 빠르게 증가시켜 드립니다.'},
      {id:'tt5',name:'TikTok 공유 수',pl:'tiktok',rate:1.20,min:100,max:50000,desc:'영상 공유 수를 증가시켜 드립니다.'},
      {id:'tt6',name:'TikTok 저장 수',pl:'tiktok',rate:1.00,min:100,max:50000,desc:'영상 저장 수를 늘려드립니다.'},
      {id:'tt7',name:'TikTok 댓글 (커스텀)',pl:'tiktok',rate:12.00,min:5,max:200,desc:'원하는 내용의 댓글을 달아드립니다.'},
      {id:'tt8',name:'TikTok 라이브 시청자',pl:'tiktok',rate:9.00,min:100,max:5000,desc:'틱톡 라이브 방송의 동시 시청자 수를 늘려드립니다.'},
      {id:'tt9',name:'TikTok 팔로워 — 미국 타겟',pl:'tiktok',rate:4.00,min:50,max:10000,desc:'미국 기반 틱톡 사용자 팔로워입니다.'},
      {id:'tt10',name:'TikTok 프로필 방문 수',pl:'tiktok',rate:0.30,min:1000,max:500000,desc:'프로필 방문 수를 증가시켜 드립니다.'},
      {id:'tw1',name:'Twitter/X 팔로워 — 글로벌',pl:'twitter',rate:2.00,min:100,max:100000,desc:'X(트위터) 글로벌 팔로워를 늘려드립니다.'},
      {id:'tw2',name:'Twitter/X 팔로워 — 미국 타겟',pl:'twitter',rate:5.00,min:50,max:20000,desc:'미국 기반 X 팔로워입니다.'},
      {id:'tw3',name:'Twitter/X 좋아요',pl:'twitter',rate:0.80,min:50,max:100000,desc:'X 게시물의 좋아요 수를 증가시켜 드립니다.'},
      {id:'tw4',name:'Twitter/X 리트윗',pl:'twitter',rate:1.50,min:50,max:50000,desc:'게시물 리트윗 수를 늘려드립니다.'},
      {id:'tw5',name:'Twitter/X 조회수',pl:'twitter',rate:0.30,min:1000,max:5000000,desc:'X 수익화는 조회수 기반입니다.'},
      {id:'tw6',name:'Twitter/X 북마크',pl:'twitter',rate:1.00,min:100,max:50000,desc:'게시물 북마크 수를 증가시켜 드립니다.'},
      {id:'tw7',name:'Twitter/X 댓글',pl:'twitter',rate:10.00,min:10,max:300,desc:'X 게시물에 댓글을 달아드립니다.'},
      {id:'tw8',name:'Twitter/X 인용 트윗',pl:'twitter',rate:2.00,min:20,max:5000,desc:'게시물 인용 트윗 수를 늘려드립니다.'},
      {id:'th1',name:'Threads 팔로워',pl:'threads',rate:3.00,min:100,max:50000,desc:'메타의 Threads 팔로워를 늘려드립니다.'},
      {id:'th2',name:'Threads 좋아요',pl:'threads',rate:0.80,min:50,max:100000,desc:'Threads 게시물 좋아요 수를 증가시켜 드립니다.'},
      {id:'th3',name:'Threads 리포스트',pl:'threads',rate:1.50,min:50,max:20000,desc:'Threads 게시물 리포스트 수를 늘려드립니다.'},
      {id:'th4',name:'Threads 조회수',pl:'threads',rate:0.20,min:1000,max:1000000,desc:'Threads 게시물 조회수를 빠르게 증가시켜 드립니다.'},
      {id:'tg1',name:'Telegram 채널 멤버 — 글로벌',pl:'telegram',rate:1.50,min:100,max:100000,desc:'텔레그램 채널의 멤버 수를 늘려드립니다.'},
      {id:'tg2',name:'Telegram 채널 멤버 — 한국어권',pl:'telegram',rate:4.00,min:50,max:10000,desc:'한국어 사용자 위주의 텔레그램 멤버입니다.'},
      {id:'tg3',name:'Telegram 포스트 조회수',pl:'telegram',rate:0.25,min:1000,max:5000000,desc:'텔레그램 채널 게시물의 조회수를 증가시켜 드립니다.'},
      {id:'tg4',name:'Telegram 리액션',pl:'telegram',rate:0.80,min:100,max:50000,desc:'게시물에 이모지 리액션을 달아드립니다.'},
      {id:'tg5',name:'Telegram 그룹 멤버',pl:'telegram',rate:2.00,min:100,max:50000,desc:'텔레그램 그룹의 멤버 수를 늘려드립니다.'},
      {id:'tg6',name:'Telegram 봇 사용자',pl:'telegram',rate:3.00,min:100,max:10000,desc:'텔레그램 봇의 사용자 수를 늘려드립니다.'},
      {id:'fb1',name:'Facebook 페이지 좋아요',pl:'facebook',rate:1.20,min:100,max:100000,desc:'페이스북 페이지 좋아요 수를 늘려드립니다.'},
      {id:'fb2',name:'Facebook 팔로워',pl:'facebook',rate:1.00,min:100,max:100000,desc:'페이스북 계정 팔로워를 늘려드립니다.'},
      {id:'fb3',name:'Facebook 게시물 좋아요',pl:'facebook',rate:0.50,min:50,max:200000,desc:'페이스북 게시물 좋아요 수를 빠르게 증가시켜 드립니다.'},
      {id:'fb4',name:'Facebook 동영상 조회수',pl:'facebook',rate:0.20,min:1000,max:5000000,desc:'페이스북 동영상 조회수를 늘려드립니다.'},
      {id:'fb5',name:'Facebook 공유 수',pl:'facebook',rate:2.00,min:50,max:20000,desc:'게시물 공유 수를 증가시켜 드립니다.'},
      {id:'fb6',name:'Facebook 리뷰 (별점 5점)',pl:'facebook',rate:15.00,min:5,max:200,desc:'페이스북 비즈니스 페이지에 긍정적인 리뷰를 달아드립니다.'},
      {id:'sp1',name:'Spotify 재생수 — 글로벌',pl:'spotify',rate:0.40,min:1000,max:1000000,desc:'스포티파이 트랙의 재생수를 늘려드립니다.'},
      {id:'sp2',name:'Spotify 팔로워',pl:'spotify',rate:2.00,min:100,max:20000,desc:'스포티파이 아티스트 팔로워를 늘려드립니다.'},
      {id:'sp3',name:'Spotify 월간 리스너',pl:'spotify',rate:3.00,min:100,max:10000,desc:'월간 리스너 수를 증가시켜 드립니다.'},
      {id:'sp4',name:'Spotify 플레이리스트 추가',pl:'spotify',rate:5.00,min:50,max:5000,desc:'트랙을 플레이리스트에 추가해드립니다.'},
      {id:'sp5',name:'Spotify 저장 수',pl:'spotify',rate:2.50,min:100,max:10000,desc:'트랙 저장 수를 늘려드립니다.'},
      {id:'nv1',name:'네이버 블로그 방문자',pl:'naver',rate:1.00,min:100,max:10000,desc:'네이버 블로그 일일 방문자 수를 늘려드립니다.'},
      {id:'nv2',name:'네이버 블로그 좋아요',pl:'naver',rate:0.80,min:50,max:5000,desc:'블로그 게시물 좋아요 수를 증가시켜 드립니다.'},
      {id:'nv3',name:'네이버 플레이스 저장',pl:'naver',rate:5.00,min:10,max:1000,desc:'네이버 지도/플레이스 저장 수를 늘려드립니다.'},
      {id:'nv4',name:'네이버 카페 회원',pl:'naver',rate:3.00,min:50,max:5000,desc:'네이버 카페 회원 수를 늘려드립니다.'},
      {id:'etc1',name:'Discord 서버 멤버',pl:'other',rate:2.00,min:100,max:50000,desc:'디스코드 서버 멤버를 늘려드립니다.'},
      {id:'etc2',name:'YouTube Music 재생수',pl:'youtube',rate:0.50,min:1000,max:500000,desc:'유튜브 뮤직 트랙의 재생수를 늘려드립니다.'},
      {id:'etc3',name:'LinkedIn 팔로워',pl:'other',rate:3.00,min:50,max:10000,desc:'링크드인 프로필 팔로워를 늘려드립니다.'},
      {id:'etc4',name:'Pinterest 팔로워',pl:'other',rate:1.50,min:100,max:20000,desc:'핀터레스트 팔로워를 늘려드립니다.'},
      {id:'etc5',name:'Google 지도 리뷰 (별점 5점)',pl:'other',rate:20.00,min:5,max:100,desc:'구글 지도 비즈니스에 긍정적인 리뷰를 달아드립니다.'},
    ];
    for (const s of svcs) {
      await query(`INSERT INTO services(id,name,pl,rate,min,max,desc,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING`,
        [s.id, s.name, s.pl, s.rate, s.min, s.max, s.desc, 1]);
    }
  }

  console.log('✅ DB 초기화 완료');
}

// ── 미들웨어 ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function getToken(req) {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

// 도메인 매핑
app.use(async (req, res, next) => {
  let host = req.headers.host || 'localhost';
  host = host.split(':')[0];
  try {
    let r = await query(`SELECT * FROM sites WHERE domain=$1 AND active=1`, [host]);
    let site = r.rows[0];
    if (!site) {
      r = await query(`SELECT * FROM sites WHERE id='default'`);
      site = r.rows[0];
      if (site && host !== 'localhost' && !host.includes('127.0.0.1')) {
        await query(`UPDATE sites SET domain=$1 WHERE id='default'`, [host]);
      }
    }
    req.site = site;
    req.siteId = site ? site.id : 'default';
  } catch(e) {
    req.site = null;
    req.siteId = 'default';
  }
  next();
});

// 유틸
async function getGlobalSetting(key) {
  const r = await query(`SELECT value FROM global_settings WHERE key=$1`, [key]);
  return r.rows[0] ? r.rows[0].value : '';
}
async function setGlobalSetting(key, value) {
  await query(`INSERT INTO global_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2`, [key, value]);
}

function requireAuth(req, res, next) {
  const token = getToken(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: '로그인 필요' });
  req.session = payload;
  next();
}
function requireAdmin(req, res, next) {
  const token = getToken(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: '로그인 필요' });
  if (!['admin','superadmin'].includes(payload.role)) return res.status(403).json({ error: '관리자 권한 필요' });
  req.session = payload;
  next();
}
function requireSuperAdmin(req, res, next) {
  const token = getToken(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: '로그인 필요' });
  if (payload.role !== 'superadmin') return res.status(403).json({ error: '슈퍼관리자 권한 필요' });
  req.session = payload;
  next();
}

async function tgAlert(msg) {
  const token = await getGlobalSetting('tg_token');
  const chat = await getGlobalSetting('tg_chat');
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: msg, parse_mode: 'HTML' })
    });
  } catch(e) { console.log('TG 오류:', e.message); }
}

async function tgChargeAlert(chargeId, userName, amount, note, siteName) {
  const token = await getGlobalSetting('tg_token');
  const chat = await getGlobalSetting('tg_chat');
  if (!token || !chat) return;
  const msg = `💳 <b>충전 요청</b> [${siteName}]\n👤 ${userName}\n💰 ₩${Math.round(amount).toLocaleString()}\n📝 ${note || '-'}\n⏰ ${new Date().toLocaleString('ko-KR')}`;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat, text: msg, parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ 승인', callback_data: `approve_${chargeId}` },
            { text: '❌ 거절', callback_data: `reject_${chargeId}` }
          ]]
        }
      })
    });
  } catch(e) { console.log('TG 오류:', e.message); }
}

// ── API 라우트 ──

app.get('/api/site-config', (req, res) => {
  const site = req.site;
  if (!site) return res.json({ error: '사이트를 찾을 수 없습니다' });
  res.json({
    name: site.name, logo: site.logo,
    primaryColor: site.primary_color, accentColor: site.accent_color,
    kakao: site.kakao, bank: site.bank,
    margin: site.margin, exrate: site.exrate
  });
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, pw } = req.body;
    let r = await query(`SELECT * FROM users WHERE site_id=$1 AND email=$2`, [req.siteId, email]);
    let targetUser = r.rows[0];
    if (!targetUser) {
      r = await query(`SELECT * FROM users WHERE role='superadmin' AND email=$1`, [email]);
      targetUser = r.rows[0];
    }
    if (!targetUser || !bcrypt.compareSync(pw, targetUser.pw))
      return res.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' });
    if (targetUser.status === 'banned')
      return res.json({ error: '정지된 계정입니다. 관리자에게 문의하세요.' });
    const token = createToken({ userId: targetUser.id, role: targetUser.role, siteId: req.siteId });
    res.json({ ok: true, token, user: { id: targetUser.id, name: targetUser.name, email: targetUser.email, role: targetUser.role, balance: targetUser.balance }});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, pw } = req.body;
    if (!name || !email || !pw) return res.json({ error: '모든 항목을 입력하세요' });
    if (pw.length < 6) return res.json({ error: '비밀번호는 6자 이상이어야 합니다' });
    const exists = await query(`SELECT id FROM users WHERE site_id=$1 AND email=$2`, [req.siteId, email]);
    if (exists.rows.length > 0) return res.json({ error: '이미 사용 중인 이메일입니다' });
    const hash = bcrypt.hashSync(pw, 10);
    const id = 'u' + Date.now();
    await query(`INSERT INTO users(id,site_id,name,email,pw,role,balance) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [id, req.siteId, name, email, hash, 'user', 0]);
    const token = createToken({ userId: id, role: 'user', siteId: req.siteId });
    res.json({ ok: true, token, user: { id, name, email, role: 'user', balance: 0 }});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => { res.json({ ok: true }); });

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const r = await query(`SELECT id,name,email,role,balance,status FROM users WHERE id=$1`, [req.session.userId]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/services', async (req, res) => {
  try {
    const site = req.site;
    const mg = site ? site.margin : 50;
    const ex = site ? site.exrate : 1380;
    const r = await query(`SELECT * FROM services WHERE active=1 ORDER BY id`);
    res.json(r.rows.map(s => ({
      ...s,
      sell: Math.round(s.rate / 1000 * 1000 * ex * (1 + mg / 100))
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders', requireAuth, async (req, res) => {
  try {
    const { sid, link, qty } = req.body;
    const svcR = await query(`SELECT * FROM services WHERE id=$1 AND active=1`, [sid]);
    const svc = svcR.rows[0];
    if (!svc) return res.json({ error: '서비스를 찾을 수 없습니다' });
    const qtyNum = parseInt(qty);
    if (qtyNum < svc.min || qtyNum > svc.max)
      return res.json({ error: `수량은 ${svc.min.toLocaleString()} ~ ${svc.max.toLocaleString()} 사이여야 합니다` });
    const site = req.site;
    const mg = site ? site.margin : 50;
    const ex = site ? site.exrate : 1380;
    const charge = svc.rate / 1000 * qtyNum * ex * (1 + mg / 100);
    const userR = await query(`SELECT * FROM users WHERE id=$1`, [req.session.userId]);
    const user = userR.rows[0];
    if ((user.balance || 0) < charge)
      return res.json({ error: `잔액 부족. 현재 ₩${Math.round(user.balance || 0).toLocaleString()}` });
    const apiCost = svc.rate / 1000 * qtyNum;
    if (site && site.credit < apiCost && site.id !== 'default')
      return res.json({ error: '사이트 API 크레딧이 부족합니다.' });
    await query(`UPDATE users SET balance=balance-$1 WHERE id=$2`, [charge, user.id]);
    if (site && site.id !== 'default')
      await query(`UPDATE sites SET credit=GREATEST(0,credit-$1) WHERE id=$2`, [apiCost, site.id]);
    let apiOrderId = null;
    const apiKey = await getGlobalSetting('peakerr_api_key');
    if (apiKey && svc.api_id) {
      try {
        const resp = await fetch('https://peakerr.com/api/v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ key: apiKey, action: 'add', service: svc.api_id, link, quantity: String(qty) })
        });
        const data = await resp.json();
        if (data.order) apiOrderId = String(data.order);
      } catch(e) { console.log('API 오류:', e.message); }
    }
    const orderId = 'O' + Date.now();
    await query(`INSERT INTO orders(id,site_id,uid,uname,sid,sname,pl,api_order_id,link,qty,charge,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [orderId, req.siteId, user.id, user.name, svc.id, svc.name, svc.pl, apiOrderId, link, qtyNum, charge, apiOrderId ? 'processing' : 'pending']);
    const updR = await query(`SELECT * FROM users WHERE id=$1`, [user.id]);
    tgAlert(`📦 <b>새 주문</b> [${site?.name || 'GLOW'}]\n👤 ${user.name}\n✦ ${svc.name}\n🔢 ${qtyNum.toLocaleString()}개\n💰 ₩${Math.round(charge).toLocaleString()}\n🔗 ${link}`);
    res.json({ ok: true, orderId, apiOrderId, balance: updR.rows[0].balance });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders/my', requireAuth, async (req, res) => {
  try {
    const r = await query(`SELECT * FROM orders WHERE uid=$1 ORDER BY created DESC`, [req.session.userId]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/charges', requireAuth, async (req, res) => {
  try {
    const { amount, note } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt < 5000) return res.json({ error: '최소 ₩5,000 이상' });
    const userR = await query(`SELECT * FROM users WHERE id=$1`, [req.session.userId]);
    const user = userR.rows[0];
    const id = 'C' + Date.now();
    await query(`INSERT INTO charges(id,site_id,uid,uname,amount,note,status) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [id, req.siteId, user.id, user.name, amt, note || '', 'pending']);
    tgChargeAlert(id, user.name, amt, note, req.site?.name || 'GLOW');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/charges/my', requireAuth, async (req, res) => {
  try {
    const r = await query(`SELECT * FROM charges WHERE uid=$1 ORDER BY created DESC`, [req.session.userId]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/charges/cancel', requireAuth, async (req, res) => {
  try {
    const { id } = req.body;
    const r = await query(`SELECT * FROM charges WHERE id=$1 AND uid=$2`, [id, req.session.userId]);
    const charge = r.rows[0];
    if (!charge) return res.json({ error: '충전 요청을 찾을 수 없습니다' });
    if (charge.status !== 'pending') return res.json({ error: '대기 중인 요청만 취소할 수 있습니다' });
    await query(`UPDATE charges SET status='cancelled' WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 관리자 API ──
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const siteId = req.session.role === 'superadmin' ? null : req.siteId;
    let users, orders, revenue, pending;
    if (siteId) {
      users   = await query(`SELECT COUNT(*) as c FROM users WHERE role=$1 AND site_id=$2`, ['user', siteId]);
      orders  = await query(`SELECT COUNT(*) as c FROM orders WHERE site_id=$1`, [siteId]);
      revenue = await query(`SELECT SUM(charge) as s FROM orders WHERE site_id=$1`, [siteId]);
      pending = await query(`SELECT COUNT(*) as c FROM charges WHERE status=$1 AND site_id=$2`, ['pending', siteId]);
    } else {
      users   = await query(`SELECT COUNT(*) as c FROM users WHERE role=$1`, ['user']);
      orders  = await query(`SELECT COUNT(*) as c FROM orders`);
      revenue = await query(`SELECT SUM(charge) as s FROM orders`);
      pending = await query(`SELECT COUNT(*) as c FROM charges WHERE status=$1`, ['pending']);
    }
    const credit = req.session.role === 'superadmin' ? null : (req.site?.credit || 0);
    res.json({
      users: parseInt(users.rows[0].c),
      orders: parseInt(orders.rows[0].c),
      revenue: revenue.rows[0].s || 0,
      pendingCharges: parseInt(pending.rows[0].c),
      credit
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    const siteId = req.session.role === 'superadmin' ? null : req.siteId;
    const r = siteId
      ? await query(`SELECT * FROM orders WHERE site_id=$1 ORDER BY created DESC`, [siteId])
      : await query(`SELECT * FROM orders ORDER BY created DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/orders/status', requireAdmin, async (req, res) => {
  try {
    const { id, status } = req.body;
    await query(`UPDATE orders SET status=$1 WHERE id=$2`, [status, id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const siteId = req.session.role === 'superadmin' ? null : req.siteId;
    const r = siteId
      ? await query(`SELECT * FROM users WHERE site_id=$1 AND role!='superadmin' ORDER BY joined DESC`, [siteId])
      : await query(`SELECT * FROM users WHERE role!='superadmin' ORDER BY joined DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/balance', requireAdmin, async (req, res) => {
  try {
    const { uid, delta } = req.body;
    await query(`UPDATE users SET balance=GREATEST(0,balance+$1) WHERE id=$2`, [parseFloat(delta), uid]);
    const r = await query(`SELECT * FROM users WHERE id=$1`, [uid]);
    res.json({ ok: true, balance: r.rows[0].balance });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/ban', requireAdmin, async (req, res) => {
  try {
    const { uid } = req.body;
    const r = await query(`SELECT * FROM users WHERE id=$1`, [uid]);
    const user = r.rows[0];
    if (!user || user.role === 'superadmin') return res.json({ error: '처리할 수 없습니다' });
    const newStatus = user.status === 'banned' ? 'active' : 'banned';
    await query(`UPDATE users SET status=$1 WHERE id=$2`, [newStatus, uid]);
    res.json({ ok: true, status: newStatus });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/delete', requireAdmin, async (req, res) => {
  try {
    const { uid } = req.body;
    const r = await query(`SELECT * FROM users WHERE id=$1`, [uid]);
    const user = r.rows[0];
    if (!user || ['admin','superadmin'].includes(user.role)) return res.json({ error: '삭제할 수 없습니다' });
    await query(`DELETE FROM users WHERE id=$1`, [uid]);
    await query(`DELETE FROM orders WHERE uid=$1`, [uid]);
    await query(`DELETE FROM charges WHERE uid=$1`, [uid]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/resetpw', requireAdmin, async (req, res) => {
  try {
    const { uid, newpw } = req.body;
    if (!newpw || newpw.length < 6) return res.json({ error: '6자 이상 입력하세요' });
    const hash = bcrypt.hashSync(newpw, 10);
    await query(`UPDATE users SET pw=$1 WHERE id=$2`, [hash, uid]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/role', requireAdmin, async (req, res) => {
  try {
    const { uid, role } = req.body;
    if (uid === req.session.userId) return res.json({ error: '본인 등급은 변경 불가' });
    await query(`UPDATE users SET role=$1 WHERE id=$2`, [role, uid]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users/:uid/detail', requireAdmin, async (req, res) => {
  try {
    const userR = await query(`SELECT id,name,email,role,balance,status,joined FROM users WHERE id=$1`, [req.params.uid]);
    if (!userR.rows[0]) return res.json({ error: '회원을 찾을 수 없습니다' });
    const orders = await query(`SELECT * FROM orders WHERE uid=$1 ORDER BY created DESC`, [req.params.uid]);
    const charges = await query(`SELECT * FROM charges WHERE uid=$1 ORDER BY created DESC`, [req.params.uid]);
    res.json({ user: userR.rows[0], orders: orders.rows, charges: charges.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/charges', requireAdmin, async (req, res) => {
  try {
    const siteId = req.session.role === 'superadmin' ? null : req.siteId;
    const r = siteId
      ? await query(`SELECT * FROM charges WHERE site_id=$1 ORDER BY created DESC`, [siteId])
      : await query(`SELECT * FROM charges ORDER BY created DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/charges/process', requireAdmin, async (req, res) => {
  try {
    const { id, action } = req.body;
    const r = await query(`SELECT * FROM charges WHERE id=$1`, [id]);
    const charge = r.rows[0];
    if (!charge) return res.json({ error: '충전 요청을 찾을 수 없습니다' });
    const status = action === 'approve' ? 'approved' : 'rejected';
    await query(`UPDATE charges SET status=$1 WHERE id=$2`, [status, id]);
    if (action === 'approve') {
      await query(`UPDATE users SET balance=balance+$1 WHERE id=$2`, [charge.amount, charge.uid]);
      tgAlert(`✅ 충전승인 [${req.site?.name}]\n👤 ${charge.uname}\n💰 ₩${Math.round(charge.amount).toLocaleString()}`);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const site = req.site;
    const isSuperAdmin = req.session.role === 'superadmin';
    const apikey = await getGlobalSetting('peakerr_api_key');
    const tg_token = await getGlobalSetting('tg_token');
    const tg_chat = await getGlobalSetting('tg_chat');
    res.json({
      name: site?.name || '', kakao: site?.kakao || '',
      bank: site?.bank || '', margin: site?.margin || 50,
      exrate: site?.exrate || 1380, credit: site?.credit || 0,
      apikey: isSuperAdmin ? (apikey ? '••••(설정됨)' : '') : '(슈퍼관리자 전용)',
      tg_token: isSuperAdmin ? (tg_token ? '••••(설정됨)' : '') : '',
      tg_chat: isSuperAdmin ? tg_chat : '',
      isSuperAdmin
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/settings/save', requireAdmin, async (req, res) => {
  try {
    const { key, value } = req.body;
    const isSuperAdmin = req.session.role === 'superadmin';
    const superOnly = ['peakerr_api_key', 'tg_token', 'tg_chat'];
    if (superOnly.includes(key)) {
      if (!isSuperAdmin) return res.json({ error: '슈퍼관리자 전용 설정입니다' });
      await setGlobalSetting(key, value);
      return res.json({ ok: true });
    }
    const siteFields = ['name','kakao','bank','margin','exrate','primary_color','accent_color','logo'];
    if (siteFields.includes(key)) {
      await query(`UPDATE sites SET ${key}=$1 WHERE id=$2`, [value, req.siteId]);
      return res.json({ ok: true });
    }
    res.json({ error: '잘못된 설정 키' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/api-test', requireSuperAdmin, async (req, res) => {
  try {
    const apiKey = await getGlobalSetting('peakerr_api_key');
    if (!apiKey) return res.json({ error: 'API 키가 설정되지 않았습니다' });
    const resp = await fetch('https://peakerr.com/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key: apiKey, action: 'balance' })
    });
    const data = await resp.json();
    if (data.balance !== undefined) res.json({ ok: true, balance: data.balance });
    else res.json({ error: JSON.stringify(data) });
  } catch(e) { res.json({ error: e.message }); }
});

app.get('/api/admin/api-sync', requireSuperAdmin, async (req, res) => {
  try {
    const apiKey = await getGlobalSetting('peakerr_api_key');
    if (!apiKey) return res.json({ error: 'API 키가 설정되지 않았습니다' });
    const resp = await fetch('https://peakerr.com/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key: apiKey, action: 'services' })
    });
    const data = await resp.json();
    if (!Array.isArray(data)) return res.json({ error: 'API 응답 오류' });
    await query(`DELETE FROM services`);
    for (const s of data) {
      await query(`INSERT INTO services(id,name,pl,rate,min,max,desc,api_id,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`,
        ['api_'+s.service, s.name, detectPlat(s.name+' '+(s.category||'')),
          parseFloat(s.rate||0), parseInt(s.min||100), parseInt(s.max||1000000),
          s.type||'', String(s.service), 1]);
    }
    res.json({ ok: true, count: data.length });
  } catch(e) { res.json({ error: e.message }); }
});

// 텔레그램 웹훅
app.post('/api/tg-webhook', async (req, res) => {
  try {
    const data = req.body;
    if (!data.callback_query) return res.json({ ok: true });
    const cbData = data.callback_query.data;
    const msgId = data.callback_query.message.message_id;
    const chatId = data.callback_query.message.chat.id;
    const token = await getGlobalSetting('tg_token');
    if (!token) return res.json({ ok: true });
    const parts = cbData.split('_');
    const action = parts[0];
    const chargeId = parts.slice(1).join('_');
    const r = await query(`SELECT * FROM charges WHERE id=$1`, [chargeId]);
    const charge = r.rows[0];
    if (!charge || charge.status !== 'pending') {
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: data.callback_query.id, text: '이미 처리된 요청입니다' })
      });
      return res.json({ ok: true });
    }
    if (action === 'approve') {
      await query(`UPDATE charges SET status='approved' WHERE id=$1`, [chargeId]);
      await query(`UPDATE users SET balance=balance+$1 WHERE id=$2`, [charge.amount, charge.uid]);
      await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })
      });
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `✅ 승인 완료!\n👤 ${charge.uname}\n💰 ₩${Math.round(charge.amount).toLocaleString()} 충전됨`, parse_mode: 'HTML' })
      });
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: data.callback_query.id, text: '✅ 승인 완료!' })
      });
    } else if (action === 'reject') {
      await query(`UPDATE charges SET status='rejected' WHERE id=$1`, [chargeId]);
      await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })
      });
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `❌ 거절 완료!\n👤 ${charge.uname}\n💰 ₩${Math.round(charge.amount).toLocaleString()}`, parse_mode: 'HTML' })
      });
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: data.callback_query.id, text: '❌ 거절 완료!' })
      });
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tg-test', requireSuperAdmin, async (req, res) => {
  try {
    const token = await getGlobalSetting('tg_token');
    const chat = await getGlobalSetting('tg_chat');
    if (!token || !chat) return res.json({ error: '텔레그램 설정을 먼저 저장하세요' });
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: '✅ GLOW 멀티 알림 테스트 성공! ✨' })
    });
    const data = await resp.json();
    if (data.ok) res.json({ ok: true });
    else res.json({ error: data.description });
  } catch(e) { res.json({ error: e.message }); }
});

// ── 슈퍼어드민 API ──
app.get('/api/super/sites', requireSuperAdmin, async (req, res) => {
  try {
    const r = await query(`SELECT * FROM sites ORDER BY created DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/sites/create', requireSuperAdmin, async (req, res) => {
  try {
    const { domain, name, logo, primaryColor, accentColor, adminEmail, adminPw, margin, exrate, credit } = req.body;
    if (!domain || !name || !adminEmail || !adminPw)
      return res.json({ error: '필수 항목을 입력하세요' });
    const siteId = 'site_' + Date.now();
    await query(`INSERT INTO sites(id,domain,name,logo,primary_color,accent_color,margin,exrate,credit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [siteId, domain, name, logo||'✨', primaryColor||'#7209B7', accentColor||'#F72585',
        parseFloat(margin||50), parseFloat(exrate||1380), parseFloat(credit||0)]);
    const hash = bcrypt.hashSync(adminPw, 10);
    await query(`INSERT INTO users(id,site_id,name,email,pw,role,balance) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      ['admin_'+siteId, siteId, '관리자', adminEmail, hash, 'admin', 0]);
    res.json({ ok: true, siteId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/sites/credit', requireSuperAdmin, async (req, res) => {
  try {
    const { siteId, amount } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.json({ error: '금액을 입력하세요' });
    await query(`UPDATE sites SET credit=credit+$1 WHERE id=$2`, [amt, siteId]);
    const r = await query(`SELECT * FROM sites WHERE id=$1`, [siteId]);
    res.json({ ok: true, credit: r.rows[0].credit });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/sites/update', requireSuperAdmin, async (req, res) => {
  try {
    const { siteId, name, domain, logo, primaryColor, accentColor, margin, exrate, active } = req.body;
    await query(`UPDATE sites SET name=$1,domain=$2,logo=$3,primary_color=$4,accent_color=$5,margin=$6,exrate=$7,active=$8 WHERE id=$9`,
      [name, domain, logo, primaryColor, accentColor, parseFloat(margin), parseFloat(exrate), active?1:0, siteId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


app.post('/api/super/sites/delete', requireSuperAdmin, async (req, res) => {
  try {
    const { siteId } = req.body;
    if (!siteId || siteId === 'default') return res.json({ error: '기본 사이트는 삭제할 수 없습니다' });
    await query(`DELETE FROM orders WHERE site_id=$1`, [siteId]);
    await query(`DELETE FROM charges WHERE site_id=$1`, [siteId]);
    await query(`DELETE FROM users WHERE site_id=$1`, [siteId]);
    await query(`DELETE FROM sites WHERE id=$1`, [siteId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/super/dashboard', requireSuperAdmin, async (req, res) => {
  try {
    const sites = await query(`SELECT * FROM sites ORDER BY created DESC`);
    const totalUsers = await query(`SELECT COUNT(*) as c FROM users WHERE role='user'`);
    const totalOrders = await query(`SELECT COUNT(*) as c FROM orders`);
    const totalRevenue = await query(`SELECT SUM(charge) as s FROM orders`);
    const pendingCharges = await query(`SELECT COUNT(*) as c FROM charges WHERE status='pending'`);
    let apiBalance = null;
    try {
      const apiKey = await getGlobalSetting('peakerr_api_key');
      if (apiKey) {
        const balResp = await fetch('https://peakerr.com/api/v2', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ key: apiKey, action: 'balance' })
        });
        const balData = await balResp.json();
        if (balData.balance) apiBalance = parseFloat(balData.balance).toFixed(2);
      }
    } catch(e) {}
    const siteStats = await Promise.all(sites.rows.map(async s => {
      const uc = await query(`SELECT COUNT(*) as c FROM users WHERE site_id=$1 AND role='user'`, [s.id]);
      const oc = await query(`SELECT COUNT(*) as c FROM orders WHERE site_id=$1`, [s.id]);
      const rv = await query(`SELECT SUM(charge) as v FROM orders WHERE site_id=$1`, [s.id]);
      const pc = await query(`SELECT COUNT(*) as c FROM charges WHERE site_id=$1 AND status='pending'`, [s.id]);
      return { ...s, userCount: parseInt(uc.rows[0].c), orderCount: parseInt(oc.rows[0].c), revenue: rv.rows[0].v || 0, pendingCharge: parseInt(pc.rows[0].c) };
    }));
    res.json({
      sites: siteStats,
      totalUsers: parseInt(totalUsers.rows[0].c),
      totalOrders: parseInt(totalOrders.rows[0].c),
      totalRevenue: totalRevenue.rows[0].s || 0,
      pendingCharges: parseInt(pendingCharges.rows[0].c),
      apiBalance
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
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

app.post('/api/super/admin/resetpw', requireSuperAdmin, async (req, res) => {
  try {
    const { uid, newpw } = req.body;
    if (!newpw || newpw.length < 6) return res.json({ error: '6자 이상 입력하세요' });
    const r = await query(`SELECT * FROM users WHERE id=$1`, [uid]);
    if (!r.rows[0] || r.rows[0].role !== 'admin') return res.json({ error: '관리자만 변경 가능합니다' });
    const hash = bcrypt.hashSync(newpw, 10);
    await query(`UPDATE users SET pw=$1 WHERE id=$2`, [hash, uid]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/admin/ban', requireSuperAdmin, async (req, res) => {
  try {
    const { uid } = req.body;
    const r = await query(`SELECT * FROM users WHERE id=$1`, [uid]);
    const user = r.rows[0];
    if (!user || user.role !== 'admin') return res.json({ error: '관리자만 변경 가능합니다' });
    const newStatus = user.status === 'banned' ? 'active' : 'banned';
    await query(`UPDATE users SET status=$1 WHERE id=$2`, [newStatus, uid]);
    res.json({ ok: true, status: newStatus });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/admin/delete', requireSuperAdmin, async (req, res) => {
  try {
    const { uid } = req.body;
    const r = await query(`SELECT * FROM users WHERE id=$1`, [uid]);
    if (!r.rows[0] || r.rows[0].role !== 'admin') return res.json({ error: '관리자만 삭제 가능합니다' });
    await query(`DELETE FROM users WHERE id=$1`, [uid]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/super/orders', requireSuperAdmin, async (req, res) => {
  try {
    const r = await query(`SELECT * FROM orders ORDER BY created DESC LIMIT 200`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/super/charges', requireSuperAdmin, async (req, res) => {
  try {
    const r = await query(`SELECT * FROM charges ORDER BY created DESC LIMIT 200`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/super/users', requireSuperAdmin, async (req, res) => {
  try {
    const r = await query(`SELECT id,site_id,name,email,role,balance,status,joined FROM users ORDER BY joined DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/services/clean', requireSuperAdmin, async (req, res) => {
  try {
    const r = await query(`DELETE FROM services WHERE id LIKE 'api_%'`);
    res.json({ ok: true, deleted: r.rowCount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 시작
app.listen(PORT, async () => {
  console.log(`✨ GLOW Multi-Tenant 서버 실행 중: http://localhost:${PORT}`);
  await initDB();

  // 텔레그램 웹훅 자동 등록
  try {
    const token = await getGlobalSetting('tg_token');
    const renderUrl = process.env.RENDER_EXTERNAL_URL;
    if (token && renderUrl) {
      await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `${renderUrl}/api/tg-webhook` })
      });
      console.log('✅ 텔레그램 웹훅 등록 완료');
    }
  } catch(e) { console.log('웹훅 등록 실패:', e.message); }
});
