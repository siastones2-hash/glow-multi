const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const https = require('https');
const dns = require('dns');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const { startDailyReportScheduler } = require('./lib/daily-site-report');
const { buildOgShareSvg, buildOgSharePng } = require('./lib/og-image');
const {
  isHismarketingShowcaseRequest,
  getShowcaseStats,
  getShowcaseOrders,
  getShowcaseCharges,
  isShowcaseId,
} = require('./lib/hismarketing-showcase');

if (dns.setDefaultResultOrder) dns.setDefaultResultOrder('ipv4first');

const peakerrHttpsAgent = new https.Agent({ keepAlive: true, family: 4, maxSockets: 8 });
const smmkingsHttpsAgent = new https.Agent({ keepAlive: true, family: 4, maxSockets: 8 });
const PANEL_HOSTS = { peakerr: 'peakerr.com', smmkings: 'smmkings.com' };
const PANEL_AGENTS = { peakerr: peakerrHttpsAgent, smmkings: smmkingsHttpsAgent };

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

/** GLOW 본사(default) 전용 — 파트너·지인 사이트에 HQ 디자인 적용 방지 */
function getEffectiveSitePresentation(site) {
  if (!site) return { uiLayout: 'classic', theme: 'glow', isDefault: false };
  const isDefault = site.id === 'default';
  let uiLayout = String(site.ui_layout || 'classic').trim();
  let theme = String(site.theme || 'glow').trim();
  if (!isDefault) {
    if (uiLayout === 'glow-hq') uiLayout = 'classic';
    if (theme === 'glow-blue' || theme === 'anonymous') theme = 'glow';
  }
  return { uiLayout, theme, isDefault };
}

function escapeHtmlAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 카카오·채팅 공유용 OG 메타 (무사시·고기몰처럼 링크 미리보기) */
function buildSiteOgHtml(site, req) {
  const name = escapeHtmlAttr(site?.name || 'GLOW');
  const slogan = escapeHtmlAttr(site?.slogan || '콘텐츠가 빛나도록');
  const sloganSub = escapeHtmlAttr(site?.slogan_sub || '우리가 성장시킵니다');
  const descRaw = (site?.description || `${slogan} — ${sloganSub}`).replace(/\s+/g, ' ').trim();
  const desc = escapeHtmlAttr(descRaw.slice(0, 160));
  const host = String(req?.headers?.host || site?.domain || '').split(',')[0].trim();
  const proto = (req?.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const base = host ? `${proto}://${host}` : '';
  const url = escapeHtmlAttr(base ? `${base}/` : '');
  const img = escapeHtmlAttr(base ? `${base}/og-share.png?v=3` : '/og-share.png?v=3');
  return [
    `<meta name="description" content="${desc}"/>`,
    `<meta property="og:type" content="website"/>`,
    `<meta property="og:site_name" content="${name}"/>`,
    `<meta property="og:title" content="${name} — 채널 성장 플랫폼"/>`,
    `<meta property="og:description" content="${desc}"/>`,
    url ? `<meta property="og:url" content="${url}"/>` : '',
    `<meta property="og:image" content="${img}"/>`,
    `<meta property="og:image:secure_url" content="${img}"/>`,
    `<meta property="og:image:type" content="image/png"/>`,
    `<meta property="og:image:width" content="1200"/>`,
    `<meta property="og:image:height" content="630"/>`,
    `<meta property="og:image:alt" content="${name}"/>`,
    `<meta property="og:locale" content="ko_KR"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<meta name="twitter:title" content="${name} — 채널 성장 플랫폼"/>`,
    `<meta name="twitter:description" content="${desc}"/>`,
    `<meta name="twitter:image" content="${img}"/>`
  ].filter(Boolean).join('\n');
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
      margin REAL DEFAULT 0,
      exrate REAL DEFAULT 1380,
      credit REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      tg_token TEXT DEFAULT '',
      tg_chat TEXT DEFAULT '',
      super_margin REAL DEFAULT -1,
      slogan TEXT DEFAULT '콘텐츠가 빛나도록',
      slogan_sub TEXT DEFAULT '우리가 성장시킵니다',
      description TEXT DEFAULT '유튜브·인스타·틱톡·X까지 모든 소셜 채널의 성장을 자동화합니다',
      stat1_num TEXT DEFAULT '10K+',
      stat1_label TEXT DEFAULT '서비스 종류',
      stat2_num TEXT DEFAULT '24H',
      stat2_label TEXT DEFAULT '빠른 처리',
      stat3_num TEXT DEFAULT '50%+',
      stat3_label TEXT DEFAULT '마진 보장',
      stat4_num TEXT DEFAULT '100%',
      stat4_label TEXT DEFAULT '안전 보장',
      notice TEXT DEFAULT '',
      footer_text TEXT DEFAULT '소셜 미디어 플랫폼과 공식 제휴된 서비스가 아닙니다.',
      login_welcome TEXT DEFAULT '다시 만나서 반가워요',
      login_sub TEXT DEFAULT '계정에 로그인하세요',
      register_welcome TEXT DEFAULT '지금 시작하세요',
      register_sub TEXT DEFAULT '무료로 계정을 만들어보세요',
      kakao_btn_text TEXT DEFAULT '카카오톡 문의',
      charge_guide TEXT DEFAULT '입금 후 아래 양식을 작성해주세요. 확인 후 빠르게 처리해드립니다.',
      order_guide TEXT DEFAULT '주문 후 취소가 어려울 수 있습니다. 신중하게 주문해주세요.',
      hero_badge TEXT DEFAULT '소셜 성장 자동화 플랫폼',
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
      description TEXT DEFAULT '',
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
      starts_count INTEGER DEFAULT 0,
      remains INTEGER DEFAULT 0,
      created TIMESTAMP DEFAULT NOW()
    )
  `);
  // 기존 테이블에 컬럼 추가 (없으면)
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS starts_count INTEGER DEFAULT 0`).catch(()=>{});
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS remains INTEGER DEFAULT 0`).catch(()=>{});
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cost REAL DEFAULT 0`).catch(()=>{});
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS api_cost REAL DEFAULT 0`).catch(()=>{});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0`).catch(()=>{});
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_earned INTEGER DEFAULT 0`).catch(()=>{});
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid INTEGER DEFAULT 0`).catch(()=>{});
  await query(`UPDATE orders SET paid=1 WHERE status IN ('processing','completed','cancelled','canceled','refunded','partial_refunded') AND COALESCE(paid,0)=0`).catch(()=>{});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT DEFAULT NULL`).catch(()=>{});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by TEXT DEFAULT NULL`).catch(()=>{});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_bonus INTEGER DEFAULT 0`).catch(()=>{});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT ''`).catch(()=>{});
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS margin REAL DEFAULT NULL`); } catch(e) {}
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`); } catch(e) {}
  try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by TEXT`); } catch(e) {}
  try { await query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS refill_guaranteed INTEGER DEFAULT 0`); } catch(e) {}
  try { await query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS inactive_note TEXT DEFAULT ''`); } catch(e) {}
  try { await query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS replace_service_id TEXT DEFAULT NULL`); } catch(e) {}
  try { await query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS inactive_at TIMESTAMP`); } catch(e) {}
  try { await query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'peakerr'`); } catch(e) {}
  try { await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS target_count INTEGER DEFAULT 0`); } catch(e) {}
  try { await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS refill_count INTEGER DEFAULT 0`); } catch(e) {}
  try { await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS refill_last_at TIMESTAMP`); } catch(e) {}
  try { await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`); } catch(e) {}
  try { await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS api_provider TEXT DEFAULT 'peakerr'`); } catch(e) {}
  try { await query(`UPDATE services SET provider='peakerr' WHERE provider IS NULL OR TRIM(provider)=''`); } catch(e) {}
  try { await query(`UPDATE orders SET api_provider='peakerr' WHERE api_provider IS NULL OR TRIM(api_provider)=''`); } catch(e) {}

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
  await query(`
    CREATE TABLE IF NOT EXISTS credit_requests (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created TIMESTAMP DEFAULT NOW()
    )
  `);

  // 기본 설정
  const defaults = {
    peakerr_api_key: process.env.PEAKERR_API_KEY || '',
    smmkings_api_key: process.env.SMMKINGS_API_KEY || '',
    tg_token: process.env.TG_TOKEN || '',
    tg_chat: process.env.TG_CHAT || '',
    super_margin: '50',  // 슈퍼관리자 마진율 (%)
    global_site_margin: '50',  // 글로벌 기본 사이트 마진율 (GLOW 판매가 계산용)
    global_exrate: '1500'  // 글로벌 기본 환율
  };
  for (const [k, v] of Object.entries(defaults)) {
    await query(`INSERT INTO global_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING`, [k, v]);
  }

  // 기본 사이트 (계좌번호 포함)
  const BANK_INFO = '우리은행 1002-160-164625 (예금주: 조인호)';
  
  // GLOW 본사 도메인 (Render 커스텀 도메인 · env로 변경 가능)
  const GLOW_DOMAIN = (process.env.GLOW_DOMAIN || 'glowsiax.com').split(':')[0].replace(/^www\./, '');

  // GLOW 본사 — glow-blue 다크 블루 (파트너 사이트와 분리)
  const GLOW_BRAND = {
    logo: '✦',
    primary: '#00B4FF',
    accent: '#0096FF',
    theme: 'glow-blue',
    uiLayout: 'glow-hq',
    heroBadge: 'GLOW HEADQUARTERS',
    heroPrefix: '소셜 성장',
    slogan: '성장 플랫폼',
    sloganSub: '채널·브랜드·파트너를 하나로',
    description: '채널을 키우거나, 같은 방식으로 내 브랜드 사이트를 독립 운영할 수 있습니다. 가입 후 링크만 넣으면 전 채널 자동 처리.',
    loginWelcome: '다시 만나요',
    loginSub: '계정에 로그인',
    registerWelcome: '지금 시작',
    registerSub: '무료 가입 · 30초',
    stat1Num: '10K+', stat1Label: '서비스',
    stat2Num: '24H', stat2Label: '빠른 처리',
    stat3Num: 'LINK', stat3Label: '만 입력',
    stat4Num: '100%', stat4Label: '자동화',
  };

  const siteExists = await query(`SELECT id FROM sites WHERE id='default'`);
  if (siteExists.rows.length === 0) {
    await query(`INSERT INTO sites(id,domain,name,logo,primary_color,accent_color,theme,ui_layout,
      hero_badge,hero_prefix,slogan,slogan_sub,description,
      login_welcome,login_sub,register_welcome,register_sub,
      stat1_num,stat1_label,stat2_num,stat2_label,stat3_num,stat3_label,stat4_num,stat4_label,
      kakao,bank,margin,exrate,credit,super_margin)
      VALUES('default',$1,'GLOW',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
      '',$25,100,1500,0,100)`, [
      GLOW_DOMAIN, GLOW_BRAND.logo, GLOW_BRAND.primary, GLOW_BRAND.accent,
      GLOW_BRAND.theme, GLOW_BRAND.uiLayout,
      GLOW_BRAND.heroBadge, GLOW_BRAND.heroPrefix, GLOW_BRAND.slogan, GLOW_BRAND.sloganSub, GLOW_BRAND.description,
      GLOW_BRAND.loginWelcome, GLOW_BRAND.loginSub, GLOW_BRAND.registerWelcome, GLOW_BRAND.registerSub,
      GLOW_BRAND.stat1Num, GLOW_BRAND.stat1Label, GLOW_BRAND.stat2Num, GLOW_BRAND.stat2Label,
      GLOW_BRAND.stat3Num, GLOW_BRAND.stat3Label, GLOW_BRAND.stat4Num, GLOW_BRAND.stat4Label,
      BANK_INFO,
    ]);
  } else {
    await query(`UPDATE sites SET bank=$1, margin=100, super_margin=100 WHERE id='default'`, [BANK_INFO]);
    await query(`UPDATE sites SET domain=$1 WHERE id='default'`, [GLOW_DOMAIN]);
    const curTheme = await query(`SELECT theme FROM sites WHERE id='default'`);
    const th = (curTheme.rows[0]?.theme || 'glow').trim();
    if (!th || th === 'glow' || th === 'anonymous' || th === 'neon' || th === 'glow-blue') {
      await query(`
        UPDATE sites SET
          logo=$1, primary_color=$2, accent_color=$3, theme=$4, ui_layout=$5,
          hero_badge=$6, hero_prefix=$7, slogan=$8, slogan_sub=$9, description=$10,
          login_welcome=$11, login_sub=$12, register_welcome=$13, register_sub=$14,
          stat1_num=$15, stat1_label=$16, stat2_num=$17, stat2_label=$18,
          stat3_num=$19, stat3_label=$20, stat4_num=$21, stat4_label=$22
        WHERE id='default'
      `, [
        GLOW_BRAND.logo, GLOW_BRAND.primary, GLOW_BRAND.accent, GLOW_BRAND.theme, GLOW_BRAND.uiLayout,
        GLOW_BRAND.heroBadge, GLOW_BRAND.heroPrefix, GLOW_BRAND.slogan, GLOW_BRAND.sloganSub, GLOW_BRAND.description,
        GLOW_BRAND.loginWelcome, GLOW_BRAND.loginSub, GLOW_BRAND.registerWelcome, GLOW_BRAND.registerSub,
        GLOW_BRAND.stat1Num, GLOW_BRAND.stat1Label, GLOW_BRAND.stat2Num, GLOW_BRAND.stat2Label,
        GLOW_BRAND.stat3Num, GLOW_BRAND.stat3Label, GLOW_BRAND.stat4Num, GLOW_BRAND.stat4Label,
      ]);
    }
  }

  // 파트너·지인 사이트에 본사 HQ 디자인이 붙어 있으면 원복
  try {
    await query(`UPDATE sites SET ui_layout='classic' WHERE id <> 'default' AND ui_layout='glow-hq'`);
    await query(`UPDATE sites SET theme='glow' WHERE id <> 'default' AND theme IN ('glow-blue','anonymous')`);
  } catch (e) { /* ignore */ }

  // 모든 사이트 환율 = USD/KRW 시장 환율 자동 반영
  try {
    await autoSyncGlobalExrate({ notify: false });
  } catch (e) { /* ignore */ }

  await normalizeAbnormalCredits();
  reconcileAllPartnerCreditsFromLedger().catch(e => console.log('크레딧 장부 동기화:', e.message));
  await fixLegacyPartnerAdminOrders();
  await backfillPartnerOrderCosts();
  reconcileOrphanPeakerrOrders().catch(e => console.log('Peakerr ID 복구:', e.message));
  reconcilePeakerrApiKey({ silent: true }).catch(e => console.log('Peakerr 키 점검:', e.message));
  const mislabel = await repairMislabeledServiceNames().catch(() => ({ count: 0 }));
  if (mislabel.count > 0) console.log(`✓ 잘못 분류된 상품명 ${mislabel.count}건 수정`);

  // 파트너 관리자에게 잘못 승인된 잔액 충전 자동 회수
  try {
    const wrongR = await query(`
      SELECT c.* FROM charges c
      JOIN users u ON c.uid = u.id
      WHERE c.site_id <> 'default' AND u.role IN ('admin','partner') AND c.status = 'approved'`);
    for (const charge of wrongR.rows) {
      const r = await reverseApprovedCharge(charge, 'system', { reason: '관리자 잔액충전 오류 자동 회수' });
      if (r.ok) console.log(`✓ 충전 회수: ${charge.site_id} ${charge.uname} ₩${charge.amount}`);
    }
  } catch (e) { console.log('관리자 잔액충전 회수:', e.message); }

  // 나인스토리
  const no9Exists = await query(`SELECT id FROM sites WHERE domain='no9story.com'`);
  if (no9Exists.rows.length === 0) {
    await query(`INSERT INTO sites(id,domain,name,logo,primary_color,accent_color,bank,margin,exrate,credit,super_margin)
      VALUES('no9story','no9story.com','나인스토리','🔥','#DC143C','#FF8C00','',40,1500,0,100)`);
  } else {
    await query(`UPDATE sites SET super_margin=100 WHERE domain='no9story.com'`);
  }

  // 이그니트리스
  const ignitrisExists = await query(`SELECT id FROM sites WHERE domain='ignitris.co.kr'`);
  if (ignitrisExists.rows.length === 0) {
    await query(`INSERT INTO sites(id,domain,name,logo,primary_color,accent_color,bank,margin,exrate,credit,super_margin)
      VALUES('ignitris','ignitris.co.kr','이그니트리스','💕','#7209B7','#B5179E','',40,1500,0,100)`);
  } else {
    await query(`UPDATE sites SET super_margin=100 WHERE domain='ignitris.co.kr'`);
  }

  // 슈퍼어드민
  const superAdmin = await query(`SELECT id FROM users WHERE role='superadmin'`);
  if (superAdmin.rows.length === 0) {
    const hash = bcrypt.hashSync('6933', 10);
    await query(`INSERT INTO users(id,site_id,name,email,pw,role,balance) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      ['superadmin', 'default', '슈퍼관리자', 'leestones@naver.com', hash, 'superadmin', 0]);
  }

  // 나인스토리 관리자 계정
  const no9Admin = await query(`SELECT id FROM users WHERE email='no9story@admin.com'`);
  if (no9Admin.rows.length === 0) {
    const no9Site = await query(`SELECT id FROM sites WHERE domain='no9story.com'`);
    if (no9Site.rows.length > 0) {
      const hash = bcrypt.hashSync('1234', 10);
      await query(`INSERT INTO users(id,site_id,name,email,pw,role,balance) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [require('crypto').randomUUID(), no9Site.rows[0].id, '나인스토리관리자', 'no9story@admin.com', hash, 'admin', 0]);
    }
  }

  // 이그니트리스 관리자 계정
  const ignitrisAdmin = await query(`SELECT id FROM users WHERE email='ignitris@admin.com'`);
  if (ignitrisAdmin.rows.length === 0) {
    const ignitrisSite = await query(`SELECT id FROM sites WHERE domain='ignitris.co.kr'`);
    if (ignitrisSite.rows.length > 0) {
      const hash = bcrypt.hashSync('1234', 10);
      await query(`INSERT INTO users(id,site_id,name,email,pw,role,balance) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [require('crypto').randomUUID(), ignitrisSite.rows[0].id, '이그니트리스관리자', 'ignitris@admin.com', hash, 'admin', 0]);
    }
  }

  // 기본 서비스 최신화 (삭제하지 않고 UPSERT만 - site_services 정합성 보존)
  // ⚠️ DELETE 제거: 매 재시작마다 services를 비우면 site_services 레코드가 고아가 되어
  //    지인 사이트 고객 화면에 서비스가 안 보이는 버그 발생 (페이스북만 뜨던 원인)
  if (true) {
    const svcs = [
      {id:'pkr8',name:'YouTube 좋아요 — 한국 (평생 보장)',pl:'youtube',rate:0.98,min:100,max:50000,description:'한국 기반 YouTube 좋아요 서비스로, 평생 보장 리필이 제공됩니다. 국내 타겟 채널에서 한국인 좋아요 비율이 높으면 국내 추천 탭과 홈 피드 노출이 증가합니다. 일 5만개 고속 처리로 빠르게 영상 참여도를 높이고 한국 시청자 대상 알고리즘 부스트 효과를 극대화합니다.',api_id:'13810'},
      {id:'pyt1',name:'YouTube 댓글 — 프리미엄 글로벌 (드롭 보상)',pl:'youtube',rate:0.84,min:10,max:5000,description:'전 세계 실계정 기반으로 제공되는 고품질 YouTube 댓글 서비스입니다. 원하는 내용으로 댓글을 작성해드려 영상 활성도를 높입니다. 댓글이 많은 영상은 알고리즘이 높은 참여도로 인식해 더 넓게 배포하며 긍정적 댓글은 신규 방문자 신뢰도를 높입니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29796'},
      {id:'pyt10',name:'YouTube 조회수 — 프리미엄 글로벌 (드롭 보상)',pl:'youtube',rate:1.68,min:500,max:10000000,description:'전 세계 실계정 기반으로 제공되는 고품질 YouTube 조회수 서비스입니다. 영상 업로드 직후 조회수를 빠르게 채워 유튜브 알고리즘에 강한 신호를 보냅니다. 초기 조회수가 빠를수록 추천·홈피드 배포 확률이 높아지며 실제 사용자 패턴으로 처리되어 계정 안전성이 보장됩니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'24039'},
      {id:'pyt11',name:'YouTube 시청시간 — 프리미엄 글로벌 (드롭 보상)',pl:'youtube',rate:42.0,min:10,max:4000,description:'전 세계 실계정 기반으로 제공되는 고품질 YouTube 시청시간 서비스입니다. 유튜브 수익화 조건인 연간 4,000시간을 빠르게 달성하세요. 신규 채널이나 재활성화 채널의 수익화 신청 기준을 단기간에 충족할 수 있으며, 실제 시청 패턴으로 안전하게 처리됩니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'31339'},
      {id:'pyt12',name:'YouTube 구독자 — 프리미엄 (평생 보장) 🔥',pl:'youtube',rate:37.66,min:10,max:10000,description:'일 100명 슬로우 속도로 자연스럽게 유튜브 구독자를 늘리는 최상급 서비스입니다. 빠른 증가보다 안전한 장기 성장을 원하는 채널에 최적화되어 있으며, 평생 드롭 보장이 제공되어 한 번 쌓인 구독자가 영구적으로 유지됩니다. 유튜브 파트너 프로그램(YPP) 1천명 조건 달성과 채널 수익화 승인률을 높이는 데 가장 효과적입니다.',api_id:'27929'},
      {id:'pyt13',name:'YouTube 구독자 — 고속 성장 (30일 보장)',pl:'youtube',rate:41.99,min:50,max:100000,description:'실제 활동 중인 전 세계 유저 기반 YouTube 구독자를 일 2,500명 속도로 자연스럽게 늘립니다. 구독자 수는 채널의 권위와 신뢰도를 결정하는 가장 중요한 지표로, 광고주와 스폰서십 협상 단가에 직접적인 영향을 미칩니다. 평생 보장 리필로 드롭 걱정 없이 장기적인 채널 성장을 유지할 수 있는 프리미엄 서비스입니다.',api_id:'27905'},
      {id:'pyt14',name:'YouTube 조회수 — 리얼 네이티브 (200K+/일) 🔥',pl:'youtube',rate:1.05,min:1000,max:10000000,description:'실제 유저 기반 프리미엄 유튜브 조회수 서비스로, 일 20만 이상 초고속 처리가 가능합니다. 리얼 네이티브 뷰로 분류되어 유튜브 알고리즘이 조회수 가치를 100% 인정해 추천 영상·인기 급상승 피드 노출에 가장 강력한 효과를 발휘합니다. 드롭 없는 평생 보장으로 영상 가치가 영구 유지됩니다.',api_id:'28692'},
      {id:'pyt15',name:'YouTube 조회수 — 안정형 슬로우 (평생 보장)',pl:'youtube',rate:2.45,min:1000,max:50000,description:'일 4~5만 조회수를 안정적으로 지속 유입시키는 슬로우 페이스 프리미엄 서비스입니다. 빠른 스파이크보다 장기적·자연스러운 조회수 곡선을 원하는 브랜드 채널에 최적화되어 있으며, 유튜브 알고리즘이 "꾸준히 인기 있는 콘텐츠"로 판단해 장기 노출 효과가 이어집니다. 평생 보장 리필 포함.',api_id:'30743'},
      {id:'pyt16',name:'YouTube 조회수 — 저가 대량형',pl:'youtube',rate:1.036,min:10000,max:10000000,description:'대량 주문에 최적화된 저가형 유튜브 조회수 서비스입니다. 실제 유저 기반이지만 최소 10,000개부터 주문 가능한 대량형 옵션으로, 영상 초기 부스팅에 필요한 방대한 조회수를 가장 비용 효율적으로 확보할 수 있습니다. 신규 채널의 급성장이나 다수 영상 동시 관리에 적합합니다.',api_id:'28695'},
      {id:'pyt2',name:'YouTube 구독자 — 프리미엄 글로벌 (평생 보장)',pl:'youtube',rate:41.99,min:50,max:100000,description:'실제 활동 중인 전 세계 유저 기반 YouTube 구독자를 일 2,500명 속도로 자연스럽게 늘립니다. 구독자 수는 채널의 권위와 신뢰도를 결정하는 가장 중요한 지표로, 광고주와 스폰서십 협상 단가에 직접적인 영향을 미칩니다. 평생 보장 리필로 드롭 걱정 없이 장기적인 채널 성장을 유지할 수 있는 프리미엄 서비스입니다.',api_id:'27905'},
      {id:'pyt3',name:'YouTube 구독자 — 미국 타겟',pl:'youtube',rate:37.51,min:100,max:1000000,description:'미국 기반 실제 YouTube 구독자를 확보하는 서비스입니다. 미국 광고 RPM이 세계 최고 수준이므로 미국 구독자 비율이 높을수록 유튜브 수익창출 단가가 크게 오릅니다. 일 1만 5천~2만명 고속 처리되며 30일 드롭 보상이 제공되어 미국 시장을 타겟으로 하는 채널 운영자에게 가장 강력한 성장 엔진입니다.',api_id:'28717'},
      {id:'pyt4',name:'YouTube 좋아요 — 프리미엄 글로벌',pl:'youtube',rate:0.25,min:10,max:20000,description:'전 세계 실계정 기반으로 제공되는 고품질 YouTube 좋아요 서비스입니다. 좋아요 비율은 유튜브 알고리즘이 영상 품질을 판단하는 핵심 지표입니다. 이 비율이 높을수록 검색 결과 상위와 추천 피드 노출 확률이 높아져 유기적 조회수 성장으로 이어집니다.',api_id:'20329'},
      {id:'pyt5',name:'YouTube 좋아요 — 태국 타겟 (드롭 보상)',pl:'youtube',rate:0.5,min:10,max:50000,description:'태국 기반 고품질 YouTube 좋아요 서비스로, 태국은 동남아 핵심 이커머스 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요 비율은 유튜브 알고리즘이 영상 품질을 판단하는 핵심 지표입니다. 이 비율이 높을수록 검색 결과 상위와 추천 피드 노출 확률이 높아져 유기적 조회수 성장으로 이어집니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'19626'},
      {id:'pyt6',name:'YouTube 라이브 좋아요 — 프리미엄 글로벌 (드롭 보상)',pl:'youtube',rate:0.45,min:10,max:50000,description:'유튜브 라이브 스트리밍 중 실시간으로 좋아요 반응을 즉시 붙여드립니다. 라이브 방송 초반 좋아요가 많이 쌓이면 유튜브 알고리즘이 해당 스트림을 인기 라이브로 인식해 추천 섹션과 홈 피드에 우선 노출시킵니다. 실시간 시청자 유입 효과가 뛰어나며, 30일 드롭 보상으로 방송 종료 후에도 좋아요가 안정적으로 유지됩니다.',api_id:'19372'},
      {id:'pyt7',name:'YouTube 쇼츠 좋아요 — 프리미엄 글로벌 (드롭 보상)',pl:'youtube',rate:4.69,min:30,max:50000,description:'전 세계 실계정 기반으로 제공되는 고품질 YouTube 쇼츠 좋아요 서비스입니다. 쇼츠 영상의 좋아요를 빠르게 늘려 알고리즘 배포를 가속화합니다. 좋아요 비율이 높은 쇼츠는 더 넓은 피드에 배포되어 조회수와 팔로워 동반 성장으로 이어집니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'27925'},
      {id:'pyt8',name:'YouTube 쇼츠 조회수 — 프리미엄 글로벌 (드롭 보상)',pl:'youtube',rate:1.68,min:100,max:1000000,description:'전 세계 실계정 기반으로 제공되는 고품질 YouTube 쇼츠 조회수 서비스입니다. 유튜브에서 지금 가장 빠르게 성장하는 쇼츠 포맷의 조회수를 늘립니다. 초기 조회수가 빠르게 쌓이면 쇼츠 피드 알고리즘의 바이럴 루프에 진입하여 수백만 조회수까지 자연 성장이 가능합니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'27924'},
      {id:'pyt9',name:'YouTube 조회수 — 아랍 타겟',pl:'youtube',rate:4.69,min:500,max:100000,description:'아랍 기반 고품질 YouTube 조회수 서비스로, 중동 광고 RPM은 세계 최상위 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 영상 업로드 직후 조회수를 빠르게 채워 유튜브 알고리즘에 강한 신호를 보냅니다. 초기 조회수가 빠를수록 추천·홈피드 배포 확률이 높아지며 실제 사용자 패턴으로 처리되어 계정 안전성이 보장됩니다.',api_id:'2866'},
      {id:'pig11',name:'Instagram 노출 — 한국 타겟',pl:'instagram',rate:12.54,min:5,max:10000,description:'한국 기반 고품질 Instagram 노출 서비스로, 국내 타겟 마케팅의 핵심으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 게시물 총 노출 횟수를 늘려 캠페인 리포트의 설득력을 높입니다. 협찬 제안서 작성이나 광고 효율 보고에서 인상 수는 도달 범위를 증명하는 가장 직접적인 지표입니다.',api_id:'29158'},
      {id:'pig17',name:'Instagram 좋아요 — 한국 타겟',pl:'instagram',rate:1.19,min:10,max:20000,description:'한국 기반 고품질 Instagram 좋아요 서비스로, 국내 타겟 마케팅의 핵심으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요가 많은 게시물은 알고리즘이 인기 게시물로 분류하여 팔로워 외 사용자의 탐색 탭에도 대규모 노출됩니다. 유기적 도달 범위를 빠르게 확장하는 가장 효과적인 방법입니다.',api_id:'30710'},
      {id:'pig6',name:'Instagram 팔로워 — 한국 타겟',pl:'instagram',rate:40.32,min:10,max:20000,description:'한국 기반 고품질 Instagram 팔로워 서비스로, 국내 타겟 마케팅의 핵심으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 팔로워 수는 계정 신뢰도의 핵심 지표로, 팔로워가 많을수록 탐색 탭 노출이 증가하고 브랜드 협찬 제안 가능성이 크게 높아집니다. 자연스러운 성장 패턴으로 처리되며 드롭 시 보상받을 수 있어 장기적인 계정 자산으로 활용됩니다.',api_id:'28308'},
      {id:'pkr1',name:'Instagram 팔로워 — 한국 (30일 드롭보상) ⭐',pl:'instagram',rate:59.6409,min:10,max:20000,description:'한국인 실계정 기반 Instagram 팔로워 프리미엄 서비스로, 30일간 드롭 발생 시 자동 보상이 제공됩니다. 국내 타겟 마케팅의 핵심 자산인 한국인 팔로워는 브랜드 협찬 단가와 국내 소비자 대상 마케팅 효율을 크게 높여주며, 30일 리필 보장으로 장기적인 계정 신뢰도를 안정적으로 유지할 수 있습니다.',api_id:'27334'},
      {id:'pkr2',name:'Instagram 팔로워 — 한국 (슬로우 속도)',pl:'instagram',rate:59.6409,min:10,max:50000,description:'한국인 실계정 Instagram 팔로워를 일 1천명 슬로우 속도로 자연스럽게 증가시킵니다. 빠른 증가가 부담스러운 신규 계정이나 알고리즘 페널티를 피하고 싶은 계정에 최적화된 서비스입니다. 느린 속도로 쌓여 실제 유기적 성장처럼 보이며 장기 안정성이 가장 뛰어납니다.',api_id:'27334'},
      {id:'pkr3',name:'Instagram 좋아요 — 한국 (드롭보상)',pl:'instagram',rate:1.4,min:10,max:20000,description:'한국인 실계정 기반 Instagram 좋아요 서비스로, 30일간 드롭 보상이 제공됩니다. 국내 타겟 게시물의 탐색 탭 노출을 강화하며, 한국인 좋아요 비율이 높을수록 인스타그램이 국내 사용자에게 우선 노출시켜 실제 국내 고객 유입으로 이어집니다.',api_id:'30711'},
      {id:'pkr4',name:'Instagram 좋아요 — 한국 (저가형)',pl:'instagram',rate:2.38,min:50,max:1000,description:'한국인 계정 기반 Instagram 좋아요를 저렴한 가격으로 제공합니다. 국내 타겟 소규모 게시물이나 여러 게시물에 분산 주문할 때 유용하며, 한국 IP 기반 계정에서 좋아요가 발생하여 국내 탐색 탭 노출 알고리즘에 긍정적 신호를 전달합니다.',api_id:'27077'},
      {id:'pkr5',name:'Instagram 좋아요 — 한국 프리미엄 (365일 보상)',pl:'instagram',rate:1.4,min:10,max:1000000,description:'한국 기반 Instagram 좋아요 프리미엄 서비스로, 무려 365일간 드롭 보상이 제공됩니다. 1년 내 좋아요가 빠지면 자동으로 보충되어 장기적인 게시물 가치를 유지합니다. 브랜드 계정, 인플루언서 주요 게시물, 이벤트 게시물 등 장기 노출이 중요한 콘텐츠에 최적입니다.',api_id:'30711'},
      {id:'pkr6',name:'Instagram 댓글 — 한국 리얼 액티브 (10개)',pl:'instagram',rate:4.73,min:10,max:10,description:'한국 실계정 활성 사용자 10명이 자연스러운 한국어 댓글을 달아드립니다. 2시간 내 빠르게 처리되며, 실제 한국인이 다는 댓글이라 자연어 품질이 매우 높고 인스타그램 알고리즘도 국내 참여 신호로 강하게 인식합니다. 신제품 출시, 이벤트 게시물의 초기 댓글 확보에 가장 강력한 효과를 발휘합니다.',api_id:'29271'},
      {id:'pkr7',name:'Instagram 댓글 — 한국 리얼 액티브 (20개)',pl:'instagram',rate:7.45,min:20,max:20,description:'한국 실계정 활성 사용자 20명이 자연스러운 한국어 댓글을 작성합니다. 2시간 내 처리되며, 국내 인플루언서 마케팅에서 가장 중요한 "초기 댓글 군집 효과"를 만들어냅니다. 댓글 간 자연스러운 대화 흐름까지 연출되어 알고리즘이 화제의 게시물로 인식하게 만드는 프리미엄 서비스입니다.',api_id:'29272'},
      {id:'pig1',name:'Instagram 댓글 — 프리미엄 글로벌',pl:'instagram',rate:10.0,min:10,max:10000,description:'전 세계 실계정 기반으로 제공되는 고품질 Instagram 댓글 서비스입니다. 댓글이 많은 게시물은 알고리즘이 높은 참여도로 인식해 탐색 탭 노출을 늘립니다. 긍정적 댓글은 브랜드 이미지를 강화하고, 질문형 댓글은 추가 참여를 유발하는 연쇄 효과를 만듭니다.',api_id:'2544'},
      {id:'pig10',name:'Instagram 노출 — 프리미엄 글로벌 (드롭 보상)',pl:'instagram',rate:0.41,min:10,max:300000,description:'전 세계 실계정 기반으로 제공되는 고품질 Instagram 노출 서비스입니다. 게시물 총 노출 횟수를 늘려 캠페인 리포트의 설득력을 높입니다. 협찬 제안서 작성이나 광고 효율 보고에서 인상 수는 도달 범위를 증명하는 가장 직접적인 지표입니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'17506'},
      {id:'pig12',name:'Instagram 노출 — 미국 타겟 (드롭 보상)',pl:'instagram',rate:0.35,min:10,max:20000,description:'미국 기반 고품질 Instagram 노출 서비스로, 미국 광고 RPM이 세계 최고 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 게시물 총 노출 횟수를 늘려 캠페인 리포트의 설득력을 높입니다. 협찬 제안서 작성이나 광고 효율 보고에서 인상 수는 도달 범위를 증명하는 가장 직접적인 지표입니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29617'},
      {id:'pig13',name:'Instagram 좋아요 — 아랍 타겟',pl:'instagram',rate:0.62,min:10,max:100000,description:'아랍 기반 고품질 Instagram 좋아요 서비스로, 중동 광고 RPM은 세계 최상위 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요가 많은 게시물은 알고리즘이 인기 게시물로 분류하여 팔로워 외 사용자의 탐색 탭에도 대규모 노출됩니다. 유기적 도달 범위를 빠르게 확장하는 가장 효과적인 방법입니다.',api_id:'28283'},
      {id:'pig14',name:'Instagram 팔로워 — 터키 여성 타겟 (리얼)',pl:'instagram',rate:34.02,min:10,max:30000,description:'터키 실제 여성 사용자 기반 Instagram 팔로워 프리미엄 서비스입니다. 여성 타겟 브랜드(뷰티·패션·라이프스타일)의 국제 마케팅에 특화되어 있으며, 터키는 중동·유럽 시장 진입의 전략 요충지로 여성 중심 뷰티·패션 브랜드의 글로벌 확장에 가장 강력한 자산이 됩니다.',api_id:'29835'},
      {id:'pig15',name:'Instagram 좋아요 — 프리미엄 글로벌 (드롭 보상)',pl:'instagram',rate:0.09,min:10,max:1000000,description:'전 세계 실계정 기반으로 제공되는 고품질 Instagram 좋아요 서비스입니다. 좋아요가 많은 게시물은 알고리즘이 인기 게시물로 분류하여 팔로워 외 사용자의 탐색 탭에도 대규모 노출됩니다. 유기적 도달 범위를 빠르게 확장하는 가장 효과적인 방법입니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'31244'},
      {id:'pig16',name:'Instagram 좋아요 — 인도 타겟 (드롭 보상)',pl:'instagram',rate:0.6855,min:10,max:1000000,description:'인도 기반 고품질 Instagram 좋아요 서비스로, 인도는 글로벌 최대 사용자 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요가 많은 게시물은 알고리즘이 인기 게시물로 분류하여 팔로워 외 사용자의 탐색 탭에도 대규모 노출됩니다. 유기적 도달 범위를 빠르게 확장하는 가장 효과적인 방법입니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'17541'},
      {id:'pig18',name:'Instagram 좋아요 — 나이지리아 타겟 (드롭 보상)',pl:'instagram',rate:1.72,min:20,max:100000,description:'나이지리아 기반 고품질 Instagram 좋아요 서비스로, 나이지리아는 아프리카 최대 디지털 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요가 많은 게시물은 알고리즘이 인기 게시물로 분류하여 팔로워 외 사용자의 탐색 탭에도 대규모 노출됩니다. 유기적 도달 범위를 빠르게 확장하는 가장 효과적인 방법입니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29759'},
      {id:'pig19',name:'Instagram 좋아요 — 터키 타겟 (드롭 보상)',pl:'instagram',rate:0.7,min:20,max:1000,description:'터키 기반 고품질 Instagram 좋아요 서비스로, 터키 사용자는 참여율이 매우 높으며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요가 많은 게시물은 알고리즘이 인기 게시물로 분류하여 팔로워 외 사용자의 탐색 탭에도 대규모 노출됩니다. 유기적 도달 범위를 빠르게 확장하는 가장 효과적인 방법입니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'30040'},
      {id:'pig2',name:'Instagram 댓글 — 미국 타겟',pl:'instagram',rate:262.76,min:5,max:2500,description:'미국 기반 고품질 Instagram 댓글 서비스로, 미국 광고 RPM이 세계 최고 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 댓글이 많은 게시물은 알고리즘이 높은 참여도로 인식해 탐색 탭 노출을 늘립니다. 긍정적 댓글은 브랜드 이미지를 강화하고, 질문형 댓글은 추가 참여를 유발하는 연쇄 효과를 만듭니다.',api_id:'22623'},
      {id:'pig20',name:'Instagram 좋아요 — 미국 타겟',pl:'instagram',rate:18.77,min:50,max:9000,description:'미국 기반 고품질 Instagram 좋아요 서비스로, 미국 광고 RPM이 세계 최고 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요가 많은 게시물은 알고리즘이 인기 게시물로 분류하여 팔로워 외 사용자의 탐색 탭에도 대규모 노출됩니다. 유기적 도달 범위를 빠르게 확장하는 가장 효과적인 방법입니다.',api_id:'22626'},
      {id:'pig21',name:'Instagram 프로필 방문 — 프리미엄 글로벌',pl:'instagram',rate:0.1,min:100,max:5000000,description:'전 세계 실계정 기반으로 제공되는 고품질 Instagram 프로필 방문 서비스입니다. 프로필 방문 수를 늘려 계정 인지도를 높입니다. 방문자가 많은 계정은 인스타그램 알고리즘이 더 많은 사람에게 추천하며, 팔로워 전환율을 높이는 효과도 있어 신규 계정 초기 노출에 특히 효과적입니다.',api_id:'3359'},
      {id:'pig22',name:'Instagram 릴스 좋아요 — 인도 리얼',pl:'instagram',rate:0.252,min:100,max:500000,description:'인도 실제 유저 기반 Instagram 릴스 인터랙티브 좋아요입니다. 릴스는 인스타그램이 가장 공격적으로 밀고 있는 포맷으로, 좋아요가 많을수록 탐색 탭과 릴스 피드 상단 노출이 크게 증가합니다. 최대 50만개 대량 주문으로 릴스 바이럴 부스팅에 최적화된 서비스입니다.',api_id:'30671'},
      {id:'pig23',name:'Instagram 릴스 좋아요 — 인도 타겟',pl:'instagram',rate:1.61,min:10,max:30000,description:'인도 기반 고품질 Instagram 릴스 좋아요 서비스로, 인도는 글로벌 최대 사용자 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 릴스 좋아요를 빠르게 늘려 탐색 탭과 릴스 피드 상위 노출을 유도합니다. 좋아요가 많은 릴스는 알고리즘이 더 넓은 사용자층에게 배포하여 팔로워 급증 효과로 이어집니다.',api_id:'17529'},
      {id:'pig24',name:'Instagram 저장 — 프리미엄 글로벌',pl:'instagram',rate:1.84,min:100,max:10000,description:'전 세계 실계정 기반으로 제공되는 고품질 Instagram 저장 서비스입니다. 저장 수는 인스타그램 알고리즘에서 가장 높은 가중치를 받는 참여 지표입니다. 저장이 많은 게시물은 탐색 탭과 추천 피드에 장기간 지속 노출됩니다.',api_id:'2573'},
      {id:'pig25',name:'Instagram 공유 — 프리미엄 글로벌',pl:'instagram',rate:0.56,min:10,max:5000,description:'전 세계 실계정 기반으로 제공되는 고품질 Instagram 공유 서비스입니다. 공유·리포스트 수를 늘립니다. 공유가 많은 게시물은 알고리즘에서 외부 확산 신호로 평가되어 탐색 탭 노출이 강화되고 신규 팔로워 유입이 가속화됩니다.',api_id:'31255'},
      {id:'pig26',name:'Instagram 스토리 조회수 — 프리미엄 글로벌',pl:'instagram',rate:15.0,min:10,max:10000,description:'전 세계 실계정 기반으로 제공되는 고품질 Instagram 스토리 조회수 서비스입니다. 스토리 조회수는 계정 활성도와 팔로워 참여도를 알고리즘에 알리는 신호입니다. 조회수가 높은 스토리는 팔로워 피드 상단에 우선 표시되어 더 많은 노출을 확보합니다.',api_id:'14571'},
      {id:'pig27',name:'Instagram 조회수 — 프리미엄 글로벌',pl:'instagram',rate:3.52,min:10,max:100000,description:'전 세계 실계정 기반으로 제공되는 고품질 Instagram 조회수 서비스입니다. 영상 조회수가 빠르게 쌓이면 인스타그램 알고리즘의 바이럴 루프에 진입하여 탐색 탭과 팔로워 외 사용자에게도 대규모 노출됩니다. 신규 팔로워 유입의 가장 빠른 경로입니다.',api_id:'14576'},
      {id:'pig3',name:'Instagram 팔로워 — 아랍 타겟 (드롭 보상)',pl:'instagram',rate:34.58,min:20,max:50000,description:'아랍 기반 고품질 Instagram 팔로워 서비스로, 중동 광고 RPM은 세계 최상위 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 팔로워 수는 계정 신뢰도의 핵심 지표로, 팔로워가 많을수록 탐색 탭 노출이 증가하고 브랜드 협찬 제안 가능성이 크게 높아집니다. 자연스러운 성장 패턴으로 처리되며 드롭 시 보상받을 수 있어 장기적인 계정 자산으로 활용됩니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29762'},
      {id:'pig4',name:'Instagram 팔로워 — 브라질 타겟 (드롭 보상)',pl:'instagram',rate:2.4192,min:10,max:5000000,description:'브라질 기반 고품질 Instagram 팔로워 서비스로, 브라질은 중남미 최대 콘텐츠 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 팔로워 수는 계정 신뢰도의 핵심 지표로, 팔로워가 많을수록 탐색 탭 노출이 증가하고 브랜드 협찬 제안 가능성이 크게 높아집니다. 자연스러운 성장 패턴으로 처리되며 드롭 시 보상받을 수 있어 장기적인 계정 자산으로 활용됩니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'28284'},
      {id:'pig5',name:'Instagram 팔로워 — 프리미엄 글로벌 (드롭 보상)',pl:'instagram',rate:0.57,min:1,max:10000000,description:'전 세계 실계정 기반으로 제공되는 고품질 Instagram 팔로워 서비스입니다. 팔로워 수는 계정 신뢰도의 핵심 지표로, 팔로워가 많을수록 탐색 탭 노출이 증가하고 브랜드 협찬 제안 가능성이 크게 높아집니다. 자연스러운 성장 패턴으로 처리되며 드롭 시 보상받을 수 있어 장기적인 계정 자산으로 활용됩니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'30505'},
      {id:'pig7',name:'Instagram 팔로워 — 나이지리아 타겟 (드롭 보상)',pl:'instagram',rate:34.58,min:20,max:100000,description:'나이지리아 기반 고품질 Instagram 팔로워 서비스로, 나이지리아는 아프리카 최대 디지털 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 팔로워 수는 계정 신뢰도의 핵심 지표로, 팔로워가 많을수록 탐색 탭 노출이 증가하고 브랜드 협찬 제안 가능성이 크게 높아집니다. 자연스러운 성장 패턴으로 처리되며 드롭 시 보상받을 수 있어 장기적인 계정 자산으로 활용됩니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29756'},
      {id:'pig8',name:'Instagram 팔로워 — 터키 타겟 (드롭 보상)',pl:'instagram',rate:34.02,min:10,max:500000,description:'터키 기반 고품질 Instagram 팔로워 서비스로, 터키 사용자는 참여율이 매우 높으며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 팔로워 수는 계정 신뢰도의 핵심 지표로, 팔로워가 많을수록 탐색 탭 노출이 증가하고 브랜드 협찬 제안 가능성이 크게 높아집니다. 자연스러운 성장 패턴으로 처리되며 드롭 시 보상받을 수 있어 장기적인 계정 자산으로 활용됩니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29835'},
      {id:'pig9',name:'Instagram 팔로워 — 미국 타겟',pl:'instagram',rate:48.91,min:50,max:6000,description:'미국 기반 고품질 Instagram 팔로워 서비스로, 미국 광고 RPM이 세계 최고 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 팔로워 수는 계정 신뢰도의 핵심 지표로, 팔로워가 많을수록 탐색 탭 노출이 증가하고 브랜드 협찬 제안 가능성이 크게 높아집니다. 자연스러운 성장 패턴으로 처리되며 드롭 시 보상받을 수 있어 장기적인 계정 자산으로 활용됩니다.',api_id:'22628'},
      {id:'ptt1',name:'TikTok 댓글 — 프리미엄 글로벌',pl:'tiktok',rate:1.4,min:1,max:50000,description:'전 세계 실계정 기반으로 제공되는 고품질 TikTok 댓글 서비스입니다. 댓글이 많은 영상은 알고리즘이 높은 인게이지먼트로 인식해 포유 탭 노출을 늘립니다. 질문 형태의 댓글은 다른 시청자들의 댓글 참여를 유발하는 연쇄 효과가 있어 영상 활성도를 자연스럽게 높여줍니다.',api_id:'23882'},
      {id:'ptt10',name:'TikTok 공유 — 프리미엄 글로벌',pl:'tiktok',rate:1.13,min:1,max:5000,description:'전 세계 실계정 기반으로 제공되는 고품질 TikTok 공유 서비스입니다. 공유는 틱톡에서 가장 강력한 바이럴 신호입니다. 공유가 많은 영상은 외부 트래픽을 유입시키고 알고리즘이 바이럴 콘텐츠로 판단해 대규모 배포합니다.',api_id:'30998'},
      {id:'ptt11',name:'TikTok 스토리 조회수 — 프리미엄 글로벌',pl:'tiktok',rate:0.18,min:10,max:10000000,description:'전 세계 실계정 기반으로 제공되는 고품질 TikTok 스토리 조회수 서비스입니다. 틱톡 스토리 조회수를 늘려 계정 활성도를 높입니다. 활발한 스토리 활동은 알고리즘이 활성 크리에이터로 인식하게 만들어 콘텐츠 노출 범위를 확대합니다.',api_id:'25820'},
      {id:'ptt12',name:'TikTok 조회수 — 브라질 타겟 (드롭 보상)',pl:'tiktok',rate:0.08,min:1,max:1000000,description:'브라질 기반 고품질 TikTok 조회수 서비스입니다. 틱톡 조회수 대표 상품으로, 초기 조회수가 빠르게 쌓이면 포유 탭 배포가 넓어집니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'31183'},
      {id:'ptt13',name:'TikTok 조회수 — 프리미엄 글로벌 (중단)',pl:'tiktok',rate:0.44,min:10,max:1000000,description:'[판매 중단] 반복 취소·실패 — TikTok 조회수 브라질 타겟(ptt12) 사용 권장. 영상(/video/) 링크만 가능.',api_id:'20976',active:0},
      {id:'ptt14',name:'TikTok 공유 — 무제한 (평생 보장)',pl:'tiktok',rate:0.0182,min:100,max:1000000,description:'틱톡 게시물 공유를 무제한으로 유입시키는 평생 보장 프리미엄 서비스입니다. 공유는 틱톡 알고리즘이 "진짜 가치 있는 콘텐츠"로 판단하는 가장 강력한 신호로, 포유(For You) 탭 바이럴 확률을 급격히 높입니다. 평생 보장 리필로 장기 가치가 영구 유지됩니다.',api_id:'29453'},
      {id:'ptt15',name:'TikTok 맞춤 댓글 — 리얼 HQ 계정',pl:'tiktok',rate:2.03,min:10,max:500,description:'원하는 문구로 틱톡 댓글을 작성해주는 맞춤형 프리미엄 서비스입니다. 실제 HQ 계정이 자연스러운 댓글을 남기며, 초기 댓글 군집은 영상의 "인기 콘텐츠" 신호로 작용해 탐색 탭 노출 우선순위를 극대화합니다. 브랜드 캠페인이나 이벤트 영상의 초기 반응 유도에 가장 효과적입니다.',api_id:'27194'},
      {id:'ptt2',name:'TikTok 팔로워 — 아랍 타겟 (드롭 보상)',pl:'tiktok',rate:1.82,min:10,max:1000000,description:'아랍 기반 고품질 TikTok 팔로워 서비스로, 중동 광고 RPM은 세계 최상위 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 틱톡 팔로워는 포유(For You) 탭 배포의 기본 신뢰도 지표로, 팔로워가 많을수록 알고리즘이 새 영상을 더 넓은 범위에 먼저 배포합니다. 실계정 기반으로 계정 안전성을 유지하며 인플루언서 레벨로 성장할 기반을 만들어드립니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'26191'},
      {id:'ptt3',name:'TikTok 팔로워 — 브라질 타겟 (드롭 보상)',pl:'tiktok',rate:1.65,min:10,max:10000000,description:'브라질 기반 고품질 TikTok 팔로워 서비스로, 브라질은 중남미 최대 콘텐츠 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 틱톡 팔로워는 포유(For You) 탭 배포의 기본 신뢰도 지표로, 팔로워가 많을수록 알고리즘이 새 영상을 더 넓은 범위에 먼저 배포합니다. 실계정 기반으로 계정 안전성을 유지하며 인플루언서 레벨로 성장할 기반을 만들어드립니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'26182'},
      {id:'ptt4',name:'TikTok 팔로워 — 프리미엄 글로벌 (드롭 보상)',pl:'tiktok',rate:2.1,min:10,max:1000000,description:'전 세계 실계정 기반으로 제공되는 고품질 TikTok 팔로워 서비스입니다. 틱톡 팔로워는 포유(For You) 탭 배포의 기본 신뢰도 지표로, 팔로워가 많을수록 알고리즘이 새 영상을 더 넓은 범위에 먼저 배포합니다. 실계정 기반으로 계정 안전성을 유지하며 인플루언서 레벨로 성장할 기반을 만들어드립니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'26176'},
      {id:'ptt5',name:'TikTok 팔로워 — 미국 타겟 (드롭 보상)',pl:'tiktok',rate:3.08,min:10,max:100000,description:'미국 기반 고품질 TikTok 팔로워 서비스로, 미국 광고 RPM이 세계 최고 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 틱톡 팔로워는 포유(For You) 탭 배포의 기본 신뢰도 지표로, 팔로워가 많을수록 알고리즘이 새 영상을 더 넓은 범위에 먼저 배포합니다. 실계정 기반으로 계정 안전성을 유지하며 인플루언서 레벨로 성장할 기반을 만들어드립니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'25057'},
      {id:'ptt6',name:'TikTok 좋아요 — 브라질 타겟',pl:'tiktok',rate:0.15,min:10,max:1000000,description:'브라질 기반 고품질 TikTok 좋아요 서비스로, 브라질은 중남미 최대 콘텐츠 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요는 틱톡 알고리즘의 핵심 참여 신호입니다. 조회수 대비 좋아요 비율이 높은 영상은 포유 탭 배포가 대폭 가속화되며, 초기 알고리즘 점수를 빠르게 끌어올려 바이럴 진입 확률을 높입니다.',api_id:'23588'},
      {id:'ptt7',name:'TikTok 좋아요 — 프리미엄 글로벌 (드롭 보상)',pl:'tiktok',rate:0.09,min:10,max:50000000,description:'전 세계 실계정 기반으로 제공되는 고품질 TikTok 좋아요 서비스입니다. 좋아요는 틱톡 알고리즘의 핵심 참여 신호입니다. 조회수 대비 좋아요 비율이 높은 영상은 포유 탭 배포가 대폭 가속화되며, 초기 알고리즘 점수를 빠르게 끌어올려 바이럴 진입 확률을 높입니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'26305'},
      {id:'ptt8',name:'TikTok 좋아요 — 미국 타겟 (드롭 보상)',pl:'tiktok',rate:0.21,min:100,max:100000,description:'미국 기반 고품질 TikTok 좋아요 서비스로, 미국 광고 RPM이 세계 최고 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요는 틱톡 알고리즘의 핵심 참여 신호입니다. 조회수 대비 좋아요 비율이 높은 영상은 포유 탭 배포가 대폭 가속화되며, 초기 알고리즘 점수를 빠르게 끌어올려 바이럴 진입 확률을 높입니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'25063'},
      {id:'ptt9',name:'TikTok 저장 — 프리미엄 글로벌',pl:'tiktok',rate:0.01,min:10,max:10000000,description:'전 세계 실계정 기반으로 제공되는 고품질 TikTok 저장 서비스입니다. 저장 수는 틱톡 알고리즘에서 "다시 보고 싶은 영상" 신호로 높은 가중치를 받습니다. 저장이 많은 영상은 포유 탭에 장기간 지속 노출되어 튜토리얼·정보성 콘텐츠에 특히 효과적입니다.',api_id:'25343'},
      {id:'ptw1',name:'Twitter/X 팔로워 — 아랍 타겟',pl:'twitter',rate:21.84,min:10,max:10000,description:'아랍 기반 고품질 Twitter/X 팔로워 서비스로, 중동 광고 RPM은 세계 최상위 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. X 팔로워 수는 계정 영향력의 핵심 지표이자 수익화 프로그램 조건 달성의 필수 요소입니다. 팔로워가 많을수록 트윗 도달 범위가 넓어지고 알고리즘 추천 노출이 증가합니다.',api_id:'29068'},
      {id:'ptw2',name:'Twitter/X 좋아요 — 아랍 타겟',pl:'twitter',rate:9.83,min:20,max:100000,description:'아랍 기반 고품질 Twitter/X 좋아요 서비스로, 중동 광고 RPM은 세계 최상위 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요가 많은 트윗은 X 알고리즘의 추천 탭과 탐색 탭에 우선 노출됩니다. 중요한 공지·신제품·캠페인 트윗의 유기적 도달 범위를 크게 확장시키는 사회적 증명 효과도 있습니다.',api_id:'29069'},
      {id:'ptw3',name:'Twitter/X 조회수+임프레션 — 올인원',pl:'twitter',rate:0.0061,min:100,max:10000000,description:'트위터/X 게시물의 조회수와 임프레션을 동시에 증가시키는 올인원 프리미엄 서비스입니다. 조회수 대비 임프레션 비율은 X 알고리즘이 "가치 있는 트윗"을 판단하는 핵심 지표로, 주문 하나로 핵심 참여 지표 2개가 동시 개선됩니다. 취소 가능 옵션 포함.',api_id:'29865'},
      {id:'pfb1',name:'Facebook 댓글 — 브라질 타겟',pl:'facebook',rate:210.0,min:10,max:200,description:'브라질 기반 고품질 Facebook 댓글 서비스로, 브라질은 중남미 최대 콘텐츠 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 게시물에 댓글을 달아 참여도를 높입니다. 댓글이 많은 게시물은 알고리즘이 인기 콘텐츠로 분류하여 뉴스피드 상단 노출이 늘어납니다.',api_id:'28905'},
      {id:'pfb2',name:'Facebook 페이지 좋아요+팔로워 — 30일 보장 (2-in-1)',pl:'facebook',rate:1.26,min:100,max:2000000,description:'페이스북 페이지 좋아요와 팔로워가 동시에 증가하는 2-in-1 프리미엄 서비스입니다. 일 1만~2만 속도로 빠르게 성장하며 30일 드롭 보장이 제공됩니다. 하나의 주문으로 두 개 지표가 동시에 올라가 비즈니스 페이지의 신뢰도와 도달률을 한 번에 끌어올릴 수 있습니다.',api_id:'29350'},
      {id:'pfb3',name:'Facebook 팔로워 — 브라질 타겟 (드롭 보상)',pl:'facebook',rate:3.36,min:50,max:200000,description:'브라질 기반 고품질 Facebook 팔로워 서비스로, 브라질은 중남미 최대 콘텐츠 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 페이스북 페이지 좋아요·팔로워는 비즈니스 신뢰도의 핵심 지표로, 광고 집행 시 클릭률과 전환율에 직접적인 영향을 주고 방문자에게 신뢰감을 형성합니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'28903'},
      {id:'pfb4',name:'Facebook 팔로워 — 프리미엄 글로벌 (드롭 보상)',pl:'facebook',rate:0.27,min:10,max:500000,description:'전 세계 실계정 기반으로 제공되는 고품질 Facebook 팔로워 서비스입니다. 페이스북 페이지 좋아요·팔로워는 비즈니스 신뢰도의 핵심 지표로, 광고 집행 시 클릭률과 전환율에 직접적인 영향을 주고 방문자에게 신뢰감을 형성합니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'31397'},
      {id:'pfb5',name:'Facebook 팔로워 — 태국 타겟',pl:'facebook',rate:3.09,min:10,max:100000,description:'태국 기반 고품질 Facebook 팔로워 서비스로, 태국은 동남아 핵심 이커머스 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 페이스북 페이지 좋아요·팔로워는 비즈니스 신뢰도의 핵심 지표로, 광고 집행 시 클릭률과 전환율에 직접적인 영향을 주고 방문자에게 신뢰감을 형성합니다.',api_id:'30863'},
      {id:'pfb6',name:'Facebook 좋아요 — 브라질 타겟 (드롭 보상)',pl:'facebook',rate:4.2,min:20,max:10000,description:'브라질 기반 고품질 Facebook 좋아요 서비스로, 브라질은 중남미 최대 콘텐츠 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 게시물 좋아요로 페이스북 알고리즘 노출을 높입니다. 좋아요가 많은 게시물은 뉴스피드 상단에 우선 표시되고 친구들에게도 노출되어 유기적 도달이 크게 증가합니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'28902'},
      {id:'pfb7',name:'Facebook 페이지 팔로워 — 평생 보장 (고속)',pl:'facebook',rate:0.5887,min:100,max:1000000,description:'페이스북 페이지 팔로워를 일 50만 속도로 유입시키는 평생 보장 최상급 서비스입니다. 페이지 팔로워는 비즈니스 계정의 신뢰도 척도이며, 메타 광고 매니저에서 룩어라이크 오디언스(유사 타겟) 생성의 기반이 됩니다. 평생 드롭 보장으로 오래 쌓인 자산이 영구 유지됩니다.',api_id:'22328'},
      {id:'pfb8',name:'Facebook 좋아요 — 태국 타겟',pl:'facebook',rate:1.55,min:10,max:100000,description:'태국 기반 고품질 Facebook 좋아요 서비스로, 태국은 동남아 핵심 이커머스 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 게시물 좋아요로 페이스북 알고리즘 노출을 높입니다. 좋아요가 많은 게시물은 뉴스피드 상단에 우선 표시되고 친구들에게도 노출되어 유기적 도달이 크게 증가합니다.',api_id:'30865'},
      {id:'pfb9',name:'Facebook 멤버 — 프리미엄 글로벌 (드롭 보상)',pl:'facebook',rate:0.35,min:10,max:100000,description:'전 세계 실계정 기반으로 제공되는 고품질 Facebook 멤버 서비스입니다. 페이스북 그룹 멤버를 늘려 커뮤니티 규모와 활성도를 높입니다. 멤버가 많은 그룹은 신규 참여자에게 활성화된 커뮤니티로 인식되어 자연 유입이 증가합니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29607'},
      {id:'ptg1',name:'Telegram 긍정 반응 👍 — 평생 보장',pl:'telegram',rate:0.0364,min:10,max:1000000,description:'텔레그램 채널 게시물에 👍 긍정 반응을 즉시 붙여드리는 평생 보장 프리미엄 서비스입니다. 반응 수가 많은 게시물은 채널 활성도의 핵심 지표로, 신규 멤버 유입 시 채널 신뢰도를 보여주는 1차 근거가 됩니다. 최대 100만개 대량 주문이 가능해 이벤트성 게시물에 특히 효과적입니다.',api_id:'23335'},
      {id:'ptg2',name:'Telegram 멤버 — 프리미엄 글로벌 (드롭 보상)',pl:'telegram',rate:0.71,min:10,max:1000000,description:'전 세계 실계정 기반으로 제공되는 고품질 Telegram 멤버 서비스입니다. 텔레그램 채널 멤버 수는 채널 신뢰도와 광고 단가에 직접 영향을 줍니다. 멤버가 많을수록 광고주 제안 단가가 올라가며 자연 유입도 가속화됩니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29546'},
      {id:'ptg4',name:'Telegram 멤버 — 리얼 (365일 보장)',pl:'telegram',rate:0.658,min:100,max:1000000,description:'텔레그램 채널 리얼 멤버를 365일 초장기 보장으로 제공하는 프리미엄 서비스입니다. 1년 내 드롭 발생 시 자동 보충되며, 실제 활성 계정 기반이라 채널 신뢰도와 활성도 지표에 긍정적으로 작용합니다. 장기 채널 성장이나 비즈니스 채널 구축에 가장 강력한 자산입니다.',api_id:'29545'},
      {id:'ptg5',name:'Telegram 멤버 — 리얼 (30일 보장, 저가)',pl:'telegram',rate:0.434,min:100,max:1000000,description:'텔레그램 채널 리얼 멤버 30일 보장 저가형 서비스입니다. 30일간 드롭 발생 시 자동 보충되며, 채널 초기 멤버 확보나 단기 프로모션에 비용 효율적입니다. 대량 주문(최대 100만)이 가능해 신규 채널 부스트에 최적화되어 있습니다.',api_id:'29541'},
      {id:'pth1',name:'Threads 팔로워 — 프리미엄 글로벌 (드롭 보상)',pl:'threads',rate:21.0,min:100,max:50000,description:'전 세계 실계정 기반 Threads 팔로워 서비스입니다. 인스타그램과 연동된 계정의 신뢰도·노출을 함께 높입니다. 드롭 발생 시 자동 보상되어 장기 운영에 적합합니다.',api_id:'29558'},
      {id:'pth2',name:'Threads 좋아요 — 프리미엄 글로벌 (드롭 보상)',pl:'threads',rate:12.6,min:50,max:50000,description:'전 세계 실계정 기반 Threads 좋아요 서비스입니다. 게시물 참여도를 높여 피드 상위 노출을 유도합니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29560'},
      {id:'pth3',name:'Threads 공유 — 프리미엄 글로벌 (드롭 보상)',pl:'threads',rate:28.0,min:50,max:50000,description:'전 세계 실계정 기반으로 제공되는 고품질 Threads 공유 서비스입니다. Threads 리포스트는 강력한 확산 신호로, 리포스트가 많은 게시물은 알고리즘에서 화제 콘텐츠로 분류되어 피드 상단 노출이 크게 증가합니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29562'},
      {id:'psp1',name:'Spotify 재생수 — 프리미엄 글로벌',pl:'spotify',rate:1.029,min:1000,max:1000000,description:'스포티파이 프리미엄 계정 기반 재생수를 빠르게 늘립니다. 재생수가 기준치를 넘으면 Discover Weekly·Release Radar 등 개인화 추천 플레이리스트에 포함될 가능성이 크게 높아집니다. 즉시 시작되며 일 1천 스트림 속도로 자연스럽게 처리되어 아티스트 페이지 신뢰도와 월간 리스너 수 동반 상승 효과를 만들어냅니다.',api_id:'28251'},
      {id:'psp2',name:'Spotify 재생수 — 프리 계정 (고속)',pl:'spotify',rate:0.4368,min:1000,max:1000000,description:'스포티파이 프리 계정 기반 재생수로 빠르고 저렴하게 스트림 수를 확보합니다. 일 5천 스트림 속도로 대량 처리가 가능하여 신곡 발매 초기 알고리즘 부스트 효과를 극대화할 수 있습니다. 차트 진입과 편집팀 플레이리스트 선정을 목표로 하는 아티스트에게 가장 비용 효율적인 서비스입니다.',api_id:'28250'},
      {id:'psp3',name:'Spotify 팟캐스트 재생수 — 프리미엄 글로벌',pl:'spotify',rate:0.462,min:1000,max:1000000,description:'스포티파이 팟캐스트 에피소드 재생수를 빠르게 늘립니다. 재생수가 높은 팟캐스트는 스포티파이 추천 섹션에 노출되어 새 에피소드마다 더 많은 청취자를 확보합니다. 팟캐스트 인기 순위 진입과 광고주 스폰서십 유치에 가장 직접적인 효과를 주는 서비스입니다.',api_id:'28252'},
      {id:'psp4',name:'Spotify 월간 리스너 — 프리미엄 글로벌',pl:'spotify',rate:2.45,min:1000,max:50000,description:'월간 리스너 수는 스포티파이 차트 진입의 핵심 지표이며 아티스트 페이지에 공개 표시됩니다. 수치가 높을수록 레이블·에이전시·브랜드 협업 제안 시 강력한 근거 자료가 됩니다. 스포티파이 알고리즘도 월간 리스너를 기준으로 추천 비율을 조정하여 유기적 성장 선순환을 만들어냅니다.',api_id:'28253'},
      {id:'ptv1',name:'Twitch 라이브 동시 시청자 — 60분 유지',pl:'twitch',rate:2.4696,min:10,max:1000,description:'트위치 라이브 방송 동시 시청자 수를 60분간 안정적으로 유지해드립니다. 시청자가 많은 채널은 트위치 디렉토리 상위에 노출되어 신규 시청자 유입이 크게 증가합니다. 실제 동시 접속자처럼 자연스럽게 처리되어 채널 파트너십 조건 충족과 스폰서십 단가 상승에 가장 직접적인 효과를 주는 서비스입니다.',api_id:'21850'},
      {id:'ptv2',name:'Twitch 라이브 동시 시청자 — 120분 유지',pl:'twitch',rate:4.7417,min:10,max:1000,description:'트위치 라이브 방송 동시 시청자 수를 120분간 안정적으로 유지합니다. 장시간 방송에 최적화된 서비스로, 중장시간 스트리밍에서 꾸준히 높은 시청자 수를 유지하여 트위치 알고리즘의 인기 채널 우선 배포 혜택을 받을 수 있습니다.',api_id:'21851'},
      {id:'ptv3',name:'Twitch 라이브 동시 시청자 — 180분 유지',pl:'twitch',rate:7.1126,min:10,max:1000,description:'트위치 라이브 방송 동시 시청자 수를 180분간 유지하는 장시간 프리미엄 서비스입니다. 대회·이벤트·특별 방송 등 3시간 이상 진행되는 콘텐츠에 최적화되어 있으며, 긴 시간 동안 높은 동시 시청자 수를 유지하여 트위치 파트너 승급과 스폰서십 유치에 가장 강력한 효과를 발휘합니다.',api_id:'21852'},
      {id:'ptv4',name:'Twitch 라이브 동시 시청자 — 6시간 유지',pl:'twitch',rate:14.225,min:10,max:1000,description:'트위치 라이브 방송 동시 시청자를 6시간(360분) 동안 유지하는 최상급 서비스입니다. 장시간 스트리밍 대회나 24시간 챌린지 등 대형 이벤트에 최적화되어 있으며, 긴 시간 동안 안정적인 시청자 수 유지로 트위치 메인 페이지 피처링과 고액 스폰서십 유치에 결정적인 역할을 합니다.',api_id:'21854'},
      {id:'ptr1',name:'웹사이트 직접 방문 트래픽 — 글로벌',pl:'traffic',rate:0.1596,min:1000,max:1000000,description:'웹사이트에 직접 방문 트래픽을 글로벌로 유입시킵니다. 방문자 수가 많을수록 구글 애널리틱스 지표가 개선되고 광고 수익과 브랜드 신뢰도가 높아집니다. 직접 트래픽 증가는 도메인 신뢰도를 높여 검색 엔진에서 더 높은 권위 점수를 받는 데도 기여하며, 즉시 시작되어 SEO 부스트 효과를 빠르게 확인할 수 있습니다.',api_id:'9125'},
      {id:'ptr2',name:'구글 검색 유입 트래픽 (SEO 강화)',pl:'traffic',rate:0.266,min:1000,max:1000000,description:'구글 검색 결과를 통한 오가닉 트래픽을 웹사이트로 유입시킵니다. 키워드 설정이 가능하여 특정 검색어에 대한 클릭률(CTR)이 올라가고, 구글 알고리즘이 해당 페이지를 검색 의도에 맞는 페이지로 평가하게 됩니다. 광고 없이 지속적인 무료 트래픽을 만들어내는 SEO 강화의 가장 효과적인 방법입니다.',api_id:'13996'},
      {id:'ptr3',name:'소셜미디어 유입 트래픽 — 글로벌',pl:'traffic',rate:0.2793,min:1000,max:10000000,description:'페이스북·트위터·인스타그램 등 소셜 네트워크를 통한 웹사이트 유입 트래픽을 늘립니다. 소셜 미디어 레퍼러(referrer)가 기록되어 구글 애널리틱스에서 소셜 유입 지표가 개선되며, 다양한 트래픽 소스 분포는 SEO 관점에서 자연스러운 도메인 프로필을 만들어 검색 엔진 신뢰도 향상에 기여합니다.',api_id:'9116'},
      {id:'ptr4',name:'니치 키워드 타겟 트래픽',pl:'traffic',rate:0.2793,min:1000,max:1000000,description:'특정 니치 키워드에 관심 있는 사용자 기반의 타겟 트래픽을 유입시킵니다. 무차별 트래픽과 달리 방문자 관심사가 웹사이트 주제와 일치하여 이탈률(Bounce Rate)이 낮고, 체류 시간이 길어져 구글 알고리즘의 품질 점수가 개선됩니다. 전문 블로그·쇼핑몰의 구매 전환율 향상에 특히 효과적입니다.',api_id:'9117'},
      {id:'ptr5',name:'국가별 타겟 구글 오가닉 트래픽',pl:'traffic',rate:0.5187,min:1000,max:10000000,description:'원하는 국가 타겟으로 구글 오가닉 검색 트래픽을 유입시킵니다. 특정 시장을 공략하는 웹사이트에 최적화되어 있으며, 지역 기반 SEO 강화와 현지 검색 순위 향상에 효과적입니다. 해당 국가 사용자의 클릭과 체류 시간이 쌓이면 구글이 그 지역의 검색 결과에서 페이지를 우선 노출시키는 효과가 나타납니다.',api_id:'9120'},
      {id:'pli1',name:'LinkedIn 좋아요 — 프리미엄 글로벌',pl:'other',rate:35.69,min:5,max:100000,description:'전 세계 실계정 기반으로 제공되는 고품질 LinkedIn 좋아요 서비스입니다. 링크드인 게시물 좋아요를 늘려 비즈니스 네트워크 내 노출을 강화합니다. 좋아요가 많은 게시물은 링크드인 피드 상단에 노출되어 더 많은 비즈니스 관계자에게 도달합니다.',api_id:'20938'},
      {id:'pli2',name:'LinkedIn 공유 — 프리미엄 글로벌',pl:'other',rate:48.04,min:5,max:100000,description:'전 세계 실계정 기반으로 제공되는 고품질 LinkedIn 공유 서비스입니다. 링크드인 게시물 공유는 B2B 네트워크에서 가장 강력한 확산 지표입니다. 공유가 많은 게시물은 업계 전문가들에게 대규모 도달하여 개인 브랜딩과 회사 인지도를 동시에 강화합니다.',api_id:'20944'},
    ];

    for (const s of svcs) {
      const active = s.active != null ? s.active : 1;
      await query(`INSERT INTO services(id,name,pl,rate,min,max,description,api_id,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, pl=EXCLUDED.pl, rate=EXCLUDED.rate, min=EXCLUDED.min, max=EXCLUDED.max, api_id=EXCLUDED.api_id`,
        [s.id, s.name, s.pl, s.rate, s.min, s.max, s.description||'', s.api_id||null, active]);
      if (active === 0) {
        await query(`UPDATE services SET active=0 WHERE id=$1`, [s.id]);
      }
    }
  }

  // 마이그레이션
  try { await query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS tg_token TEXT DEFAULT ''`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS super_margin REAL DEFAULT -1`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS tg_chat TEXT DEFAULT ''`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS slogan TEXT DEFAULT '콘텐츠가 빛나도록'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS slogan_sub TEXT DEFAULT '우리가 성장시킵니다'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '유튜브·인스타·틱톡·X까지 모든 소셜 채널의 성장을 자동화합니다'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS stat1_num TEXT DEFAULT '10K+'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS stat1_label TEXT DEFAULT '서비스 종류'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS stat2_num TEXT DEFAULT '24H'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS stat2_label TEXT DEFAULT '빠른 처리'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS stat3_num TEXT DEFAULT '50%+'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS stat3_label TEXT DEFAULT '마진 보장'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS stat4_num TEXT DEFAULT '100%'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS stat4_label TEXT DEFAULT '안전 보장'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS notice TEXT DEFAULT ''`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS banner_text TEXT DEFAULT ''`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS banner_image TEXT DEFAULT ''`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS banner_link TEXT DEFAULT ''`); } catch(e) {}
  // 충전 보너스 — 금액 구간별 보너스율 JSON 저장 (예: {"10000":0,"30000":0,"50000":1,"100000":5,"200000":6})
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS charge_bonus_tiers TEXT DEFAULT ''`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS footer_text TEXT DEFAULT '소셜 미디어 플랫폼과 공식 제휴된 서비스가 아닙니다.'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS login_welcome TEXT DEFAULT '다시 만나서 반가워요'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS login_sub TEXT DEFAULT '계정에 로그인하세요'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS register_welcome TEXT DEFAULT '지금 시작하세요'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS register_sub TEXT DEFAULT '무료로 계정을 만들어보세요'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS kakao_btn_text TEXT DEFAULT '카카오톡 문의'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS charge_guide TEXT DEFAULT '입금 후 아래 양식을 작성해주세요. 확인 후 빠르게 처리해드립니다.'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS order_guide TEXT DEFAULT '주문 후 취소가 어려울 수 있습니다. 신중하게 주문해주세요.'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS hero_badge TEXT DEFAULT '소셜 성장 자동화 플랫폼'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'glow'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS ui_layout TEXT DEFAULT 'classic'`); } catch(e) {}
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS hero_prefix TEXT DEFAULT '콘텐츠가'`); } catch(e) {}
  // 사이트별 서비스 활성화 설정
  try { await query(`CREATE TABLE IF NOT EXISTS site_services (
    site_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    PRIMARY KEY(site_id, service_id)
  )`); } catch(e) {}

  try { await query(`CREATE TABLE IF NOT EXISTS credit_requests (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, site_name TEXT NOT NULL, amount REAL NOT NULL, note TEXT DEFAULT '', status TEXT DEFAULT 'pending', created TIMESTAMP DEFAULT NOW())`); } catch(e) {}
  
  // 🔐 비밀번호 재설정 토큰 테이블
  try { await query(`CREATE TABLE IF NOT EXISTS password_resets (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    email TEXT NOT NULL,
    expires TIMESTAMP NOT NULL,
    used INTEGER DEFAULT 0,
    created TIMESTAMP DEFAULT NOW()
  )`); } catch(e) {}
  
  // 📝 관리자 활동 로그
  try { await query(`CREATE TABLE IF NOT EXISTS activity_logs (
    id SERIAL PRIMARY KEY,
    site_id TEXT NOT NULL,
    admin_id TEXT NOT NULL,
    admin_name TEXT DEFAULT '',
    action TEXT NOT NULL,
    target_type TEXT DEFAULT '',
    target_id TEXT DEFAULT '',
    details TEXT DEFAULT '',
    created TIMESTAMP DEFAULT NOW()
  )`); } catch(e) {}
  
  // 💰 잔액 변동 로그
  try { await query(`CREATE TABLE IF NOT EXISTS balance_logs (
    id SERIAL PRIMARY KEY,
    site_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT DEFAULT '',
    delta REAL NOT NULL,
    before_balance REAL DEFAULT 0,
    after_balance REAL DEFAULT 0,
    reason TEXT DEFAULT '',
    admin_id TEXT DEFAULT '',
    created TIMESTAMP DEFAULT NOW()
  )`); } catch(e) {}
  
  // 🚦 Rate Limit 추적
  try { await query(`CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER DEFAULT 0,
    window_start TIMESTAMP DEFAULT NOW()
  )`); } catch(e) {}
  
  await repairAllPartnerSiteServices();
  const nameFix = await localizeAllSitesServiceNames().catch(() => ({ count: 0 }));
  if (nameFix.count > 0) console.log(`🇰🇷 영문 상품명 ${nameFix.count}건 한글화 (GLOW·지인 사이트 전체)`);
  await reconcileServiceCatalog({ notify: false }).catch(e => console.log('카탈로그 정리:', e.message));
  await backfillPartnerOrderCosts();
  console.log('✅ DB 초기화 완료');
}

/** 지인 사이트 site_services 깨짐 복구 (고아 레코드·전체 OFF·극소 활성) */
async function repairSiteServices(siteId, force = false, opts = {}) {
  const totalR = await query(`SELECT COUNT(*)::int AS c FROM services WHERE active=1`);
  const totalActive = totalR.rows[0]?.c || 0;
  if (totalActive === 0) return { repaired: false, reason: 'no_active_services' };

  await query(
    `DELETE FROM site_services WHERE site_id=$1 AND service_id NOT IN (SELECT id FROM services)`,
    [siteId]
  );

  const enabledR = await query(`
    SELECT COUNT(*)::int AS c FROM services s
    INNER JOIN site_services ss ON s.id = ss.service_id
    WHERE s.active=1 AND ss.site_id=$1 AND ss.active=1
  `, [siteId]);
  const enabled = enabledR.rows[0]?.c || 0;
  const minHealthy = Math.max(5, Math.floor(totalActive * 0.1));
  const shouldRepair = force || enabled === 0 || enabled < minHealthy;
  if (!shouldRepair) return { repaired: false, enabled, totalActive };

  const curatedOnly = !!opts.curatedOnly;
  const allSvcs = await query(
    curatedOnly
      ? `SELECT id FROM services WHERE active=1 AND id ~ '^[a-z]{2,3}[0-9]+'`
      : `SELECT id FROM services WHERE active=1`
  );
  for (const s of allSvcs.rows) {
    await query(`
      INSERT INTO site_services(site_id, service_id, active)
      VALUES($1, $2, 1)
      ON CONFLICT(site_id, service_id) DO UPDATE SET active=1
    `, [siteId, s.id]);
  }
  if (curatedOnly) {
    await query(`DELETE FROM site_services WHERE site_id=$1 AND service_id ~ '^(pk_|api_|svc_)'`, [siteId]);
    await query(`
      DELETE FROM site_services ss
      USING services s
      WHERE ss.site_id=$1 AND ss.service_id=s.id AND s.active=0
    `, [siteId]);
  }
  return { repaired: true, before: enabled, after: allSvcs.rows.length, totalActive };
}

/** 미작동·자동등록(pk_) 상품 제거 — 주문 기록은 services 비활성으로 보존 */
async function purgeUnsellableServices() {
  const autoR = await query(`
    UPDATE services SET active=0
    WHERE active=1 AND id ~ '^(pk_|api_|svc_)'
    RETURNING id
  `);
  const ssR = await query(`
    DELETE FROM site_services ss
    USING services s
    WHERE ss.service_id = s.id AND (s.active = 0 OR s.id ~ '^(pk_|api_|svc_)')
    RETURNING ss.service_id
  `);
  const orphanR = await query(`
    DELETE FROM site_services WHERE service_id NOT IN (SELECT id FROM services)
  `);
  await repairAllPartnerSiteServices();
  const n = (autoR.rowCount || 0) + (ssR.rowCount || 0) + (orphanR.rowCount || 0);
  if (n > 0) console.log(`🗑️ 미판매·미작동 정리: 자동등록 ${autoR.rowCount || 0}개, site_services ${(ssR.rowCount || 0) + (orphanR.rowCount || 0)}건`);
  return { autoImport: autoR.rowCount || 0, siteLinks: (ssR.rowCount || 0) + (orphanR.rowCount || 0) };
}

async function repairAllPartnerSiteServices() {
  const sites = await query(`SELECT id, name, domain FROM sites WHERE id != 'default' AND active=1`);
  const results = [];
  for (const site of sites.rows) {
    try {
      const r = await repairSiteServices(site.id, true, { curatedOnly: true });
      results.push({ siteId: site.id, name: site.name, domain: site.domain, ...r });
      console.log(`✅ site_services 동기화: ${site.name} (${site.domain}) → ${r.after ?? r.enabled}/${r.totalActive} 활성`);
    } catch (e) {
      results.push({ siteId: site.id, name: site.name, domain: site.domain, error: e.message });
      console.log(`site_services 동기화 실패 ${site.id}:`, e.message);
    }
  }
  return results;
}

/** DB=credit(USD), 화면=USD×exrate(원). 비정상적으로 큰 값 일괄 0 정리 */
async function normalizeAbnormalCredits() {
  const KRW_LIMIT = 10000000; // 화면 1천만 원 초과 시 버그로 간주
  const r = await query(`
    UPDATE sites SET credit = 0
    WHERE credit >= 999999999
       OR (credit * COALESCE(NULLIF(exrate, 0), 1500)) > $1
    RETURNING id, name
  `, [KRW_LIMIT]);
  if (r.rowCount > 0) {
    console.log(`🔧 비정상 크레딧 ${r.rowCount}개 사이트 → 0원 정리:`, r.rows.map(s => s.name).join(', '));
  }
  return r.rowCount;
}

// ── 미들웨어 ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// index.html은 제외하고 정적 파일만 서빙 (index.html은 동적 렌더링용)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// 카카오 광고 전용 랜딩 (파트너·마케팅 안내 — SNS 어뷰징 표현 없음)
app.get(['/ads', '/ads/'], (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(__dirname, 'public', 'ads.html'));
});

function getToken(req) {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

// 도메인 매핑
app.use(async (req, res, next) => {
  let host = req.headers.host || 'localhost';
  host = host.split(':')[0].toLowerCase();
  req.siteSuspended = false;
  try {
    // active 여부와 무관하게 도메인으로 먼저 찾음 (비활성=정지 안내, 본사로 넘어가지 않음)
    let r = await query(`SELECT * FROM sites WHERE LOWER(domain)=$1`, [host]);
    let site = r.rows[0];
    if (!site) {
      const bareHost = host.replace(/^www\./, '');
      if (bareHost !== host) {
        r = await query(`SELECT * FROM sites WHERE LOWER(domain)=$1`, [bareHost]);
        site = r.rows[0];
      }
    }
    if (site) {
      const isActive = Number(site.active) === 1;
      if (!isActive && site.id !== 'default') {
        req.site = site;
        req.siteId = site.id;
        req.siteSuspended = true;
      } else {
        req.site = site;
        req.siteId = site.id;
      }
    } else {
      // 등록된 도메인 없음 → 본사(default). Render 기본 도메인 등
      r = await query(`SELECT * FROM sites WHERE id='default'`);
      req.site = r.rows[0] || null;
      req.siteId = 'default';
    }
  } catch(e) {
    req.site = null;
    req.siteId = 'default';
    req.siteSuspended = false;
  }
  next();
});

// 관리비 미납 등으로 비활성화된 파트너 사이트 — API 차단
app.use((req, res, next) => {
  if (!req.siteSuspended) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(503).json({
      ok: false,
      suspended: true,
      error: '관리비 미납으로 이용이 중단되었습니다. 관리비 입금 후 재개됩니다.',
      siteName: req.site?.name || '',
      feeKrw: 70000,
      bank: '우리은행 1002-160-164625 (예금주: 조인호)'
    });
  }
  next();
});

/** 카카오톡·SNS 공유 미리보기 이미지 (사이트별 · 도메인 매핑 이후) */
app.get('/og-share.svg', (req, res) => {
  try {
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buildOgShareSvg(req.site));
  } catch (e) {
    res.status(500).send('og error');
  }
});
app.get('/og-share.png', (req, res) => {
  try {
    const png = buildOgSharePng(req.site);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.send(png);
  } catch (e) {
    console.log('OG PNG 오류:', e.message);
    res.status(500).send('og error');
  }
});

// 유틸
async function getGlobalSetting(key) {
  const r = await query(`SELECT value FROM global_settings WHERE key=$1`, [key]);
  return r.rows[0] ? r.rows[0].value : '';
}
async function setGlobalSetting(key, value) {
  await query(`INSERT INTO global_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2`, [key, value]);
}

function isValidPeakerrApiKey(key) {
  const k = String(key || '').trim();
  if (!k || k.includes('설정') || k.includes('••')) return false;
  return k.length >= 16 && k.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(k);
}
const isValidPanelApiKey = isValidPeakerrApiKey;

function normalizeProvider(p) {
  return String(p || 'peakerr').toLowerCase() === 'smmkings' ? 'smmkings' : 'peakerr';
}
function serviceProvider(svc) {
  return normalizeProvider(svc?.provider || svc?.api_provider);
}
function orderProvider(order) {
  return normalizeProvider(order?.api_provider || order?.provider);
}

const PEAKERR_KEY_BACKUP = 'peakerr_api_key_backup';
const PEAKERR_KEY_VERIFIED = 'peakerr_api_key_verified_at';
const SMMKINGS_KEY_BACKUP = 'smmkings_api_key_backup';
const SMMKINGS_KEY_VERIFIED = 'smmkings_api_key_verified_at';
/** 메모리 캐시 — DB 조회·연결 실패 시에도 작업 키 유지 */
let _peakerrWorkingKey = '';
let _smmkingsWorkingKey = '';

async function readPeakerrKeyRaw(settingKey) {
  const r = await query(`SELECT value FROM global_settings WHERE key=$1`, [settingKey]);
  return String(r.rows[0]?.value || '').trim();
}

async function getPeakerrApiKey() {
  if (isValidPeakerrApiKey(_peakerrWorkingKey)) return _peakerrWorkingKey;
  const candidates = [
    await readPeakerrKeyRaw('peakerr_api_key'),
    await readPeakerrKeyRaw(PEAKERR_KEY_BACKUP),
    String(process.env.PEAKERR_API_KEY || '').trim()
  ];
  for (const c of candidates) {
    if (isValidPeakerrApiKey(c)) {
      _peakerrWorkingKey = c;
      return c;
    }
  }
  return '';
}

/** 🔒 Peakerr 키 — 연결 테스트 성공 후에만 저장 (실패 시 기존 키 유지) */
async function savePeakerrApiKeySafely(newKey) {
  const v = String(newKey || '').trim();
  if (!isValidPeakerrApiKey(v)) {
    return { ok: false, error: '공급 API 키 형식이 올바르지 않습니다. 키 전체를 다시 붙여넣으세요.' };
  }

  const current = await getPeakerrApiKey();
  const test = await fetchPeakerrBalance(v);
  if (!test.ok) {
    return {
      ok: false,
      error: (test.error || '공급 API 연결 실패') + ' — 키가 저장되지 않았습니다. 기존 연동은 유지됩니다.'
    };
  }

  if (current && current !== v && isValidPeakerrApiKey(current)) {
    await setGlobalSetting(PEAKERR_KEY_BACKUP, current);
  }
  await setGlobalSetting('peakerr_api_key', v);
  await setGlobalSetting(PEAKERR_KEY_BACKUP, v);
  await setGlobalSetting(PEAKERR_KEY_VERIFIED, new Date().toISOString());
  _peakerrWorkingKey = v;
  console.log(`🔒 Peakerr API 키 잠금 저장 (…${v.slice(-4)}) · $${test.balance.toFixed(2)}`);
  return { ok: true, balance: test.balance, unchanged: current === v };
}

/** 서버 시작·주기 점검 — 키 깨지면 백업/ENV에서 자동 복구 */
async function reconcilePeakerrApiKey(opts = {}) {
  const silent = !!opts.silent;
  const primary = await readPeakerrKeyRaw('peakerr_api_key');
  if (isValidPeakerrApiKey(primary)) {
    const test = await fetchPeakerrBalance(primary);
    if (test.ok) {
      _peakerrWorkingKey = primary;
      await setGlobalSetting(PEAKERR_KEY_BACKUP, primary);
      if (!silent) console.log(`✓ Peakerr API 정상 · $${test.balance.toFixed(2)}`);
      return { ok: true, balance: test.balance, source: 'primary' };
    }
  }

  const backup = await readPeakerrKeyRaw(PEAKERR_KEY_BACKUP);
  if (isValidPeakerrApiKey(backup) && backup !== primary) {
    const test = await fetchPeakerrBalance(backup);
    if (test.ok) {
      await setGlobalSetting('peakerr_api_key', backup);
      _peakerrWorkingKey = backup;
      console.log(`🔒 Peakerr API 키 백업에서 자동 복구 (…${backup.slice(-4)}) · $${test.balance.toFixed(2)}`);
      return { ok: true, balance: test.balance, source: 'backup', restored: true };
    }
  }

  const envKey = String(process.env.PEAKERR_API_KEY || '').trim();
  if (isValidPeakerrApiKey(envKey)) {
    const test = await fetchPeakerrBalance(envKey);
    if (test.ok) {
      await setGlobalSetting('peakerr_api_key', envKey);
      await setGlobalSetting(PEAKERR_KEY_BACKUP, envKey);
      _peakerrWorkingKey = envKey;
      console.log(`🔒 Peakerr API 키 ENV에서 자동 복구 · $${test.balance.toFixed(2)}`);
      return { ok: true, balance: test.balance, source: 'env', restored: true };
    }
  }

  if (!silent) console.log('⚠️ Peakerr API 키 없거나 연결 실패');
  return { ok: false, error: 'API 키 미설정 또는 연결 실패' };
}

async function getSmmkingsApiKey() {
  if (isValidPanelApiKey(_smmkingsWorkingKey)) return _smmkingsWorkingKey;
  const candidates = [
    await readPeakerrKeyRaw('smmkings_api_key'),
    await readPeakerrKeyRaw(SMMKINGS_KEY_BACKUP),
    String(process.env.SMMKINGS_API_KEY || '').trim()
  ];
  for (const c of candidates) {
    if (isValidPanelApiKey(c)) {
      _smmkingsWorkingKey = c;
      return c;
    }
  }
  return '';
}

async function saveSmmkingsApiKeySafely(newKey) {
  const v = String(newKey || '').trim();
  if (!isValidPanelApiKey(v)) {
    return { ok: false, error: '연동 B 키 형식이 올바르지 않습니다. 키 전체를 다시 붙여넣으세요.' };
  }
  const current = await getSmmkingsApiKey();
  const test = await fetchPanelBalance('smmkings', v);
  if (!test.ok) {
    return {
      ok: false,
      error: (test.error || '연동 B 연결 실패') + ' — 키가 저장되지 않았습니다.'
    };
  }
  if (current && current !== v && isValidPanelApiKey(current)) {
    await setGlobalSetting(SMMKINGS_KEY_BACKUP, current);
  }
  await setGlobalSetting('smmkings_api_key', v);
  await setGlobalSetting(SMMKINGS_KEY_BACKUP, v);
  await setGlobalSetting(SMMKINGS_KEY_VERIFIED, new Date().toISOString());
  _smmkingsWorkingKey = v;
  console.log(`🔒 SMMKings API 키 저장 (…${v.slice(-4)}) · $${test.balance.toFixed(2)}`);
  return { ok: true, balance: test.balance, unchanged: current === v };
}

async function reconcileSmmkingsApiKey(opts = {}) {
  const silent = !!opts.silent;
  const primary = await readPeakerrKeyRaw('smmkings_api_key');
  if (isValidPanelApiKey(primary)) {
    const test = await fetchPanelBalance('smmkings', primary);
    if (test.ok) {
      _smmkingsWorkingKey = primary;
      await setGlobalSetting(SMMKINGS_KEY_BACKUP, primary);
      if (!silent) console.log(`✓ SMMKings API 정상 · $${test.balance.toFixed(2)}`);
      return { ok: true, balance: test.balance, source: 'primary' };
    }
  }
  const backup = await readPeakerrKeyRaw(SMMKINGS_KEY_BACKUP);
  if (isValidPanelApiKey(backup) && backup !== primary) {
    const test = await fetchPanelBalance('smmkings', backup);
    if (test.ok) {
      await setGlobalSetting('smmkings_api_key', backup);
      _smmkingsWorkingKey = backup;
      console.log(`🔒 SMMKings API 키 백업 복구 (…${backup.slice(-4)}) · $${test.balance.toFixed(2)}`);
      return { ok: true, balance: test.balance, source: 'backup', restored: true };
    }
  }
  const envKey = String(process.env.SMMKINGS_API_KEY || '').trim();
  if (isValidPanelApiKey(envKey)) {
    const test = await fetchPanelBalance('smmkings', envKey);
    if (test.ok) {
      await setGlobalSetting('smmkings_api_key', envKey);
      await setGlobalSetting(SMMKINGS_KEY_BACKUP, envKey);
      _smmkingsWorkingKey = envKey;
      console.log(`🔒 SMMKings API 키 ENV 복구 · $${test.balance.toFixed(2)}`);
      return { ok: true, balance: test.balance, source: 'env', restored: true };
    }
  }
  if (!silent) console.log('⚠️ 연동 B 키 없거나 연결 실패');
  return { ok: false, error: '연동 B 키 미설정 또는 연결 실패' };
}

async function getPanelApiKey(provider) {
  return normalizeProvider(provider) === 'smmkings' ? getSmmkingsApiKey() : getPeakerrApiKey();
}

function peakerrBalanceErrorKo(msg) {
  const s = String(msg || '');
  if (/invalid.*key|api key/i.test(s)) return 'API 키가 올바르지 않습니다. 공급 API 키를 다시 저장하세요.';
  if (/키|설정/.test(s)) return s;
  if (/timeout|abort|network|fetch|ECONN|ETIMED|ENOTFOUND/i.test(s)) {
    return '서버 연결 실패. 잠시 후 다시 시도하세요.';
  }
  return s || '조회 실패';
}

async function getGlobalExrateNum() {
  return parseFloat((await getGlobalSetting('global_exrate')) || '1500');
}

/** 글로벌 환율 → 모든 사이트 sites.exrate 일괄 동기화 */
async function syncAllSitesExrate(ex) {
  const rate = parseFloat(ex);
  if (isNaN(rate) || rate < 100 || rate > 5000) return { ok: false, count: 0 };
  const r = await query(`UPDATE sites SET exrate=$1`, [rate]);
  return { ok: true, count: r.rowCount || 0 };
}

/** USD/KRW 시장 환율 조회 (ECB·open.er-api 순 폴백) */
async function fetchKrwUsdRate() {
  const pick = (n) => {
    const rate = Math.round(parseFloat(n));
    return rate >= 1000 && rate <= 2000 ? rate : null;
  };
  const sources = [
    { name: 'frankfurter', url: 'https://api.frankfurter.app/latest?from=USD&to=KRW', parse: d => pick(d?.rates?.KRW) },
    { name: 'open.er-api', url: 'https://open.er-api.com/v6/latest/USD', parse: d => pick(d?.rates?.KRW) },
  ];
  for (const src of sources) {
    try {
      const resp = await fetch(src.url, { headers: { Accept: 'application/json' } });
      const data = await resp.json();
      const rate = src.parse(data);
      if (rate) return { rate, source: src.name };
    } catch (e) {
      console.log(`환율 API(${src.name}) 실패:`, e.message);
    }
  }
  return null;
}

/** 글로벌 환율 자동 갱신 → 전 사이트 동기화 */
async function autoSyncGlobalExrate(opts = {}) {
  const notify = opts.notify === true;
  const force = opts.force === true;
  const prev = await getGlobalExrateNum();
  const fetched = await fetchKrwUsdRate();

  if (!fetched) {
    if (prev >= 100) await syncAllSitesExrate(prev);
    return { ok: false, rate: prev, skipped: true };
  }

  const changed = force || Math.abs(fetched.rate - prev) >= 1;
  if (!changed) {
    await syncAllSitesExrate(prev);
    return { ok: true, rate: prev, unchanged: true, source: fetched.source };
  }

  await setGlobalSetting('global_exrate', String(fetched.rate));
  await setGlobalSetting('exrate_sync_at', new Date().toISOString());
  await setGlobalSetting('exrate_sync_source', fetched.source);
  const sync = await syncAllSitesExrate(fetched.rate);
  console.log(`💱 환율 자동 갱신: ₩${prev} → ₩${fetched.rate}/USD (${fetched.source})`);

  if (notify && prev >= 100 && Math.abs(fetched.rate - prev) / prev >= 0.01) {
    await sendTelegramToSuper(
      `💱 <b>환율 자동 갱신</b>\n\n₩${prev.toLocaleString()} → <b>₩${fetched.rate.toLocaleString()}</b>/USD\n출처: ${fetched.source}\n전체 ${sync.count || 0}개 사이트 동기화`
    ).catch(() => {});
  }

  return { ok: true, rate: fetched.rate, previous: prev, source: fetched.source, sitesSynced: sync.count };
}

/** credit_requests.amount = 원화(₩) → sites.credit = 달러($) */
async function krwToCreditUsd(siteId, krwAmount) {
  const krw = parseFloat(krwAmount);
  if (!krw || krw <= 0) return 0;
  const siteR = await query(`SELECT exrate FROM sites WHERE id=$1`, [siteId]);
  const exrate = parseFloat(siteR.rows[0]?.exrate) || parseFloat(await getGlobalSetting('global_exrate')) || 1500;
  return krw / exrate;
}

/** 크레딧 차감·예약 집계에 포함하지 않는 주문 상태 */
const CREDIT_ORDER_EXCLUDE = `status NOT IN ('cancelled','canceled','failed','refunded','partial_refunded')`;

/** 확정 차감(paid) + 미결제 예약(pending·미지급) 주문 cost 합 — excludeOrderId: 확정 시 자기 주문 제외 */
async function sumSiteCreditUsedKrw(siteId, opts = {}) {
  const excludeOrderId = opts.excludeOrderId || null;
  let sql = `
    SELECT COALESCE(SUM(cost),0) as s FROM orders
    WHERE site_id=$1 AND ${CREDIT_ORDER_EXCLUDE}
    AND COALESCE(cost,0) > 0
    AND (
      COALESCE(paid,0)=1
      OR (status='pending' AND COALESCE(paid,0)=0)
    )`;
  const params = [siteId];
  if (excludeOrderId) {
    sql += ` AND id <> $2`;
    params.push(excludeOrderId);
  }
  const r = await query(sql, params);
  return parseFloat(r.rows[0]?.s) || 0;
}

/** sites.credit(USD) 동기화용 — 실제 확정 차감(paid)만 */
async function sumSiteCreditPaidKrw(siteId) {
  const r = await query(`
    SELECT COALESCE(SUM(cost),0) as s FROM orders
    WHERE site_id=$1 AND ${CREDIT_ORDER_EXCLUDE}
    AND COALESCE(paid,0)=1 AND COALESCE(cost,0) > 0
  `, [siteId]);
  return parseFloat(r.rows[0]?.s) || 0;
}

/** 크레딧 잔액 원화 표시 — 충전 당시 원화 기준(지급합−사용합). 환율 변경해도 ₩10만 충전은 ₩10만으로 보임 */
async function getCreditBalanceKrw(siteId, creditUsd, siteEx, opts = {}) {
  const crAp = await query(`SELECT COALESCE(SUM(amount),0) as s FROM credit_requests WHERE site_id=$1 AND status='approved'`, [siteId]);
  const received = parseFloat(crAp.rows[0].s) || 0;
  const used = await sumSiteCreditUsedKrw(siteId, opts);
  if (received > 0) return Math.max(0, Math.round(received - used));
  return Math.round((parseFloat(creditUsd) || 0) * siteEx);
}

/** 승인된 크레딧 장부(원화)와 sites.credit(USD) 불일치 시 동기화 — 화면·주문 판단 일치 */
async function reconcileSiteCreditUsdFromLedger(siteId) {
  const siteR = await query(`SELECT credit, exrate FROM sites WHERE id=$1`, [siteId]);
  const site = siteR.rows[0];
  if (!site || siteId === 'default') return null;
  const globalEx = parseFloat(await getGlobalSetting('global_exrate')) || 1500;
  const siteEx = parseFloat(site.exrate) > 0 ? parseFloat(site.exrate) : globalEx;
  const crAp = await query(`SELECT COALESCE(SUM(amount),0) as s FROM credit_requests WHERE site_id=$1 AND status='approved'`, [siteId]);
  const received = parseFloat(crAp.rows[0].s) || 0;
  if (received <= 0) return null;
  const usedPaid = await sumSiteCreditPaidKrw(siteId);
  const krwBal = Math.max(0, received - usedPaid);
  const expectedUsd = krwBal / siteEx;
  const currentUsd = parseFloat(site.credit) || 0;
  if (Math.abs(currentUsd - expectedUsd) > 0.0001) {
    await query(`UPDATE sites SET credit=$1 WHERE id=$2`, [expectedUsd, siteId]);
    return { before: currentUsd, after: expectedUsd, krwBal };
  }
  return null;
}

/** 파트너 사이트 주문 — 화면과 동일한 원화 크레딧 기준으로 충분한지 확인 */
async function assertPartnerCreditForOrder(site, margins, requiredKrw, opts = {}) {
  if (!site || site.id === 'default') return null;
  await reconcileSiteCreditUsdFromLedger(site.id);
  const siteR = await query(`SELECT credit, exrate FROM sites WHERE id=$1`, [site.id]);
  const row = siteR.rows[0] || site;
  const siteEx = parseFloat(row.exrate) > 0 ? parseFloat(row.exrate) : margins.ex;
  const creditUsd = parseFloat(row.credit) || 0;
  const available = await getCreditBalanceKrw(site.id, creditUsd, siteEx, opts);
  const need = Math.ceil(parseFloat(requiredKrw) || 0);
  if (need > 0 && available < need) {
    const shortfall = need - available;
    return `크레딧이 약 ₩${shortfall.toLocaleString()} 더 필요합니다. 관리자 → 크레딧 요청에서 충전 후 다시 주문해 주세요.`;
  }
  return null;
}

/** 주문 전 화면·서버 동일 금액 미리보기 (크레딧/잔액 부족 사전 안내) */
async function buildOrderEstimate(req, sid, qtyNum) {
  const svc = await resolveOrderService(sid);
  if (!svc) return { error: '선택한 상품을 찾을 수 없습니다. 페이지를 새로고침(F5) 후 다시 선택해 주세요.' };
  if (qtyNum < (svc.min || 1) || qtyNum > (svc.max || 999999999)) {
    return { error: `수량은 ${svc.min.toLocaleString()} ~ ${svc.max.toLocaleString()} 사이여야 합니다.` };
  }
  const site = req.site;
  const userR = await query(`SELECT * FROM users WHERE id=$1`, [req.session.userId]);
  const user = userR.rows[0];
  const margins = await getSiteMargins(site, user);
  const adminCreditOnly = site && site.id !== 'default' && ['admin', 'partner'].includes(user?.role || '');
  const { charge, orderCostKrw } = computeOrderAmounts(svc, qtyNum, site, margins);
  const requiredKrw = Math.ceil(adminCreditOnly ? orderCostKrw : charge);

  if (adminCreditOnly) {
    await reconcileSiteCreditUsdFromLedger(site.id).catch(() => null);
    const siteR = await query(`SELECT credit, exrate FROM sites WHERE id=$1`, [site.id]);
    const siteEx = parseFloat(siteR.rows[0]?.exrate) > 0 ? parseFloat(siteR.rows[0].exrate) : margins.ex;
    const available = await getCreditBalanceKrw(site.id, parseFloat(siteR.rows[0]?.credit) || 0, siteEx);
    const shortfall = Math.max(0, requiredKrw - available);
    return {
      ok: shortfall <= 0,
      adminCreditOnly: true,
      requiredKrw,
      availableKrw: available,
      shortfallKrw: shortfall,
      message: shortfall > 0
        ? `크레딧이 약 ₩${shortfall.toLocaleString()} 더 필요합니다. 관리자 → 크레딧 요청에서 충전 후 다시 주문해 주세요.`
        : null
    };
  }

  const available = Math.round(user?.balance || 0);
  const shortfall = Math.max(0, requiredKrw - available);
  return {
    ok: shortfall <= 0,
    adminCreditOnly: false,
    requiredKrw,
    availableKrw: available,
    shortfallKrw: shortfall,
    message: shortfall > 0
      ? `잔액이 약 ₩${shortfall.toLocaleString()} 부족합니다. 충전 탭에서 충전 후 다시 주문해 주세요.`
      : null
  };
}

async function reconcileAllPartnerCreditsFromLedger() {
  const r = await query(`SELECT id, name FROM sites WHERE id <> 'default' AND active=1`);
  let fixed = 0;
  for (const s of r.rows) {
    try {
      const res = await reconcileSiteCreditUsdFromLedger(s.id);
      if (res) {
        fixed++;
        console.log(`✓ 크레딧 장부 동기화: ${s.name} $${res.before.toFixed(4)} → $${res.after.toFixed(4)} (₩${Math.round(res.krwBal).toLocaleString()})`);
      }
    } catch (e) {
      console.log(`크레딧 동기화 실패 ${s.id}:`, e.message);
    }
  }
  return fixed;
}

/** 휴대전화 정규화 (숫자만 · 010 형식) */
function normalizePhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('82') && d.length >= 11) d = '0' + d.slice(2);
  if (d.length === 10 && d.startsWith('10')) d = '0' + d;
  if (!/^01\d{8,9}$/.test(d)) return null;
  return d;
}

/** 추천 보너스 — 사이트당 전화번호 1회만 */
async function assertPhoneAvailableForReferral(siteId, phone, excludeUserId) {
  const norm = normalizePhone(phone);
  if (!norm) return { ok: false, error: '올바른 휴대전화 번호를 입력하세요 (예: 010-1234-5678)' };
  const r = await query(`
    SELECT id FROM users
    WHERE site_id=$1 AND referred_by IS NOT NULL
      AND regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g') = $2
      AND id <> $3
    LIMIT 1
  `, [siteId, norm, excludeUserId || '']);
  if (r.rows.length) return { ok: false, error: '이 전화번호는 이미 추천 보너스를 받았습니다.' };
  return { ok: true, norm };
}

/** 외부 노출 문구 — 외부 연동·업체 브랜드명·금지어 제거 (누구에게도 노출 금지) */
function stripSupplierBrand(msg) {
  if (msg == null || msg === '') return msg;
  let t = String(msg);
  t = t.replace(/Peakerr\s*→\s*GLOW/gi, '자동 동기화');
  t = t.replace(/Peakerr\s*#\d*/gi, '');
  t = t.replace(/Peakerr\s+ID/gi, '작업 번호');
  t = t.replace(/Peakerr/gi, '');
  t = t.replace(/peakerr\.com/gi, '');
  t = t.replace(/피커/g, '');
  t = t.replace(/SMM\s*Kings?/gi, '');
  t = t.replace(/SMMKings?/gi, '');
  t = t.replace(/smmkings\.com/gi, '');
  t = t.replace(/Perfect\s*Panel/gi, '');
  t = t.replace(/\bSMM\b/gi, '');
  t = t.replace(/킹즈/g, '');
  t = t.replace(/패널/g, '');
  t = t.replace(/\b[Pp]anels?\b/g, '');
  t = t.replace(/공급사/g, '시스템');
  t = t.replace(/API\s*크레딧/gi, '크레딧');
  t = t.replace(/사이트\s*API/gi, '사이트');
  t = t.replace(/API\s*연동/gi, '연동');
  t = t.replace(/API\s*키/gi, '연동 설정');
  t = t.replace(/공급\s*API/gi, '');
  t = t.replace(/API\s*미/gi, '미');
  t = t.replace(/공급\s*연동/gi, '연동');
  t = t.replace(/공급\s*#/g, '');
  t = t.replace(/공급/g, '');
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}

/** 지인 사이트 관리자 API — 슈퍼·본사·공급사 브랜드 표현 제거 */
function neutralAdminMsg(msg, isSuperAdmin) {
  if (isSuperAdmin || msg == null || msg === '') return msg;
  let t = String(msg);
  t = t.replace(/\(본사 전용\)/gi, '');
  t = t.replace(/슈퍼관리자/gi, '');
  t = t.replace(/GLOW 본사(\([^)]*\))?/gi, '');
  t = t.replace(/본사 HQ[^.]*\.?\s*/gi, '');
  t = t.replace(/본사형[^.]*\.?\s*/gi, '');
  t = t.replace(/본사에서만[^.]*\.?/gi, '이 설정은 변경할 수 없습니다.');
  t = t.replace(/본사/gi, '');
  t = t.replace(/슈퍼/gi, '');
  t = t.replace(/\s{2,}/g, ' ').trim();
  t = stripSupplierBrand(t);
  return t || '처리할 수 없습니다';
}

/** 고객·파트너 API — 연동 원가($)·상품코드·내부메모 제거 */
function sanitizeServiceForClient(svc, priceExtras = {}) {
  return {
    id: svc.id,
    name: stripSupplierBrand(svc.name),
    pl: svc.pl,
    min: svc.min,
    max: svc.max,
    description: stripSupplierBrand(svc.description || ''),
    active: svc.active,
    global_active: svc.global_active,
    site_active: svc.site_active,
    ...priceExtras
  };
}

/** 슈퍼관리자 전용 — 원가·api_id 포함 (금지어는 설명/이름에서 제거) */
function sanitizeServiceForSuper(svc, priceExtras = {}) {
  return {
    id: svc.id,
    name: stripSupplierBrand(svc.name),
    pl: svc.pl,
    rate: svc.rate,
    min: svc.min,
    max: svc.max,
    description: stripSupplierBrand(svc.description || ''),
    active: svc.active,
    api_id: svc.api_id || '',
    ...priceExtras
  };
}

function sanitizeHiddenServiceNote(note) {
  return stripSupplierBrand(String(note || '')
    .replace(/공급\s*API\s*연동\s*코드\s*없음/gi, '연동 코드 없음'));
}

/** 주문 API — 외부 작업번호·USD 원가 제거 (슈퍼만 유지) */
function sanitizeOrderForClient(order, isSuperAdmin) {
  if (!order) return order;
  const o = { ...order };
  if (!isSuperAdmin) {
    delete o.api_order_id;
    delete o.api_cost;
    delete o.api_provider;
    delete o.provider;
  }
  return o;
}

/** 회원 개별 마진 → 없으면 사이트 기본 마진 */
function resolveSiteMargin(site, user) {
  if (user && user.margin != null && user.margin >= 0) return user.margin;
  return site ? (site.margin != null ? site.margin : 0) : 0;
}

/** 사이트별 마진·환율 (주문/환불 공통). user 있으면 회원 개별 마진 우선 */
async function getSiteMargins(site, user = null) {
  const globalExrateStr = await getGlobalSetting('global_exrate');
  const ex = (site && site.exrate > 0) ? site.exrate : parseFloat(globalExrateStr || '1500');
  let superMg;
  if (site && site.super_margin >= 0) superMg = site.super_margin;
  else superMg = parseFloat((await getGlobalSetting('super_margin')) || '50');
  const globalSiteMg = parseFloat((await getGlobalSetting('global_site_margin')) || '50');
  const siteMg = resolveSiteMargin(site, user);
  return { ex, superMg, globalSiteMg, siteMg };
}

/** 주문 금액·크레딧 차감액 계산 (서버 단일 진실) */
function computeOrderAmounts(svc, qtyNum, site, margins) {
  const { ex, superMg, globalSiteMg, siteMg } = margins;
  const isDefaultSite = !site || site.id === 'default';
  let charge, apiCost;
  if (isDefaultSite) {
    const sellPer1000 = svc.rate * ex * (1 + superMg / 100) * (1 + siteMg / 100);
    const sellPerUnit = Math.max(Math.round(sellPer1000 / 1000), 1);
    charge = sellPerUnit * qtyNum;
    apiCost = svc.rate / 1000 * qtyNum * (1 + superMg / 100);
  } else {
    const glowPricePer1000 = svc.rate * (1 + superMg / 100) * (1 + globalSiteMg / 100);
    const sellPer1000 = glowPricePer1000 * ex * (1 + siteMg / 100);
    const sellPerUnit = Math.max(Math.round(sellPer1000 / 1000), 1);
    charge = sellPerUnit * qtyNum;
    apiCost = glowPricePer1000 / 1000 * qtyNum;
  }
  const orderCostKrw = isDefaultSite ? 0 : apiCost * ex;
  return { charge, apiCost, orderCostKrw, isDefaultSite };
}

/** 파트너 사이트 — api_order_id 있는데 cost/api_cost 없음 → 크레딧 사용량 보정 (화면 잔액 반영) */
async function backfillPartnerOrderCosts() {
  try {
    const EXCLUDE = `o.status NOT IN ('cancelled','canceled','failed','refunded','partial_refunded')`;
    const r = await query(`
      SELECT o.*, u.role
      FROM orders o
      JOIN users u ON o.uid = u.id
      JOIN sites s ON o.site_id = s.id
      WHERE s.id <> 'default'
        AND o.api_order_id IS NOT NULL AND TRIM(o.api_order_id) <> ''
        AND ${EXCLUDE}
        AND (COALESCE(o.cost,0) = 0 OR COALESCE(o.api_cost,0) = 0)
    `);
    let fixed = 0;
    for (const o of r.rows) {
      const svcR = await query(`SELECT rate FROM services WHERE id=$1`, [o.sid]);
      if (!svcR.rows[0]) continue;
      const siteR = await query(`SELECT * FROM sites WHERE id=$1`, [o.site_id]);
      const margins = await getSiteMargins(siteR.rows[0]);
      const { apiCost, orderCostKrw } = computeOrderAmounts(
        { rate: parseFloat(svcR.rows[0].rate) }, o.qty, siteR.rows[0], margins);
      if (apiCost <= 0 && orderCostKrw <= 0) continue;
      const isAdmin = ['admin', 'partner'].includes(o.role);
      await query(
        `UPDATE orders SET charge=$1, cost=$2, api_cost=$3 WHERE id=$4`,
        [isAdmin ? 0 : o.charge, Math.round(orderCostKrw), apiCost, o.id]
      );
      fixed++;
    }
    if (fixed > 0) console.log(`✓ 파트너 주문 크레딧 기록 보정: ${fixed}건`);
    return fixed;
  } catch (e) { console.log('파트너 주문 크레딧 보정:', e.message); return 0; }
}

async function fixLegacyPartnerAdminOrders() {
  return backfillPartnerOrderCosts();
}

/** 환불 시 크레딧 USD 복구량 (저장된 api_cost 우선) */
async function computeCreditRefundUsd(order, refundPercent) {
  const pct = Math.min(Math.max(parseFloat(refundPercent) || 0, 0), 100) / 100;
  if (order.api_cost > 0) return order.api_cost * pct;
  const svcR = await query(`SELECT rate FROM services WHERE id=$1`, [order.sid]);
  if (!svcR.rows[0]) return 0;
  const siteR = await query(`SELECT * FROM sites WHERE id=$1`, [order.site_id]);
  const margins = await getSiteMargins(siteR.rows[0]);
  const { apiCost } = computeOrderAmounts({ rate: svcR.rows[0].rate }, order.qty, siteR.rows[0], margins);
  return apiCost * pct;
}

/** 주문 환불 — 잔액·크레딧·orders.cost 동시 복구 (이중 환불 방지) */
async function restoreRefundFinancials(order, refundPercent, opts = {}) {
  const pct = Math.min(Math.max(parseFloat(refundPercent) || 0, 0), 100);
  if (pct <= 0) return { ok: true, refundAmount: 0, creditRefund: 0, newCost: order.cost || 0, pct: 0 };
  const settled = ['refunded', 'cancelled', 'canceled', 'partial_refunded'];
  if (settled.includes(order.status) && !opts.allowRetry) {
    return { ok: true, refundAmount: 0, creditRefund: 0, costRefund: 0, newCost: order.cost || 0, pct: 0, alreadyRefunded: true };
  }
  const refundAmount = Math.round((order.charge || 0) * pct / 100);
  const costRefund = Math.round((order.cost || 0) * pct / 100);
  if (refundAmount > 0) {
    const userR = await query(`SELECT * FROM users WHERE id=$1`, [order.uid]);
    const user = userR.rows[0];
    if (user) {
      const beforeBal = user.balance || 0;
      await query(`UPDATE users SET balance=balance+$1 WHERE id=$2`, [refundAmount, order.uid]);
      const afterR = await query(`SELECT * FROM users WHERE id=$1`, [order.uid]);
      await logBalance(order.site_id, order.uid, user.name, refundAmount, beforeBal, afterR.rows[0]?.balance || 0,
        opts.reason || `주문 환불 (${pct}%)`, opts.adminId || 'system');
    }
  }
  let creditRefund = 0;
  if (order.site_id && order.site_id !== 'default') {
    creditRefund = await computeCreditRefundUsd(order, pct);
    if (creditRefund > 0)
      await query(`UPDATE sites SET credit=credit+$1 WHERE id=$2`, [creditRefund, order.site_id]);
  }
  const newCost = Math.max(0, (order.cost || 0) - costRefund);
  if (refundAmount > 0 && order.points_earned > 0) {
    await query(`UPDATE users SET points=GREATEST(0,COALESCE(points,0)-$1) WHERE id=$2`, [order.points_earned, order.uid]);
    await query(`UPDATE orders SET points_earned=0 WHERE id=$1`, [order.id]);
  }
  return { ok: true, refundAmount, creditRefund, costRefund, newCost, pct };
}

/** 슈퍼 수동 크레딧 지급 → credit_requests에도 기록 (원화 표시 정합) */
async function recordManualCreditGrant(siteId, krwAmount, note) {
  const krw = parseFloat(krwAmount);
  if (!krw || krw <= 0) return;
  const siteR = await query(`SELECT name FROM sites WHERE id=$1`, [siteId]);
  const id = 'CR' + Date.now();
  await query(`INSERT INTO credit_requests(id,site_id,site_name,amount,note,status) VALUES($1,$2,$3,$4,$5,$6)`,
    [id, siteId, siteR.rows[0]?.name || siteId, krw, note || '슈퍼관리자 직접 충전', 'approved']);
}

// 🛡️ ── 보안 & 검증 유틸 ──

// 📝 활동 로그 기록
async function logActivity(siteId, adminId, adminName, action, targetType, targetId, details) {
  try {
    await query(
      `INSERT INTO activity_logs(site_id, admin_id, admin_name, action, target_type, target_id, details) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [siteId || 'default', adminId || '', adminName || '', action, targetType || '', targetId || '', details || '']
    );
  } catch(e) { console.log('로그 기록 실패:', e.message); }
}

// 💰 잔액 변동 로그
async function logBalance(siteId, userId, userName, delta, beforeBalance, afterBalance, reason, adminId) {
  try {
    await query(
      `INSERT INTO balance_logs(site_id, user_id, user_name, delta, before_balance, after_balance, reason, admin_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [siteId || 'default', userId, userName || '', delta, beforeBalance || 0, afterBalance || 0, reason || '', adminId || '']
    );
  } catch(e) { console.log('잔액 로그 실패:', e.message); }
}

// 🚦 Rate Limit 체크 (분당 요청 수 제한)
async function checkRateLimit(key, maxPerMinute = 60) {
  try {
    const now = new Date();
    const r = await query(`SELECT * FROM rate_limits WHERE key=$1`, [key]);
    if (!r.rows[0]) {
      await query(`INSERT INTO rate_limits(key, count, window_start) VALUES($1, 1, $2) ON CONFLICT(key) DO UPDATE SET count=1, window_start=$2`, [key, now]);
      return { ok: true };
    }
    const row = r.rows[0];
    const windowStart = new Date(row.window_start);
    const diffSec = (now - windowStart) / 1000;
    
    if (diffSec > 60) {
      // 윈도우 리셋
      await query(`UPDATE rate_limits SET count=1, window_start=$1 WHERE key=$2`, [now, key]);
      return { ok: true };
    }
    
    if (row.count >= maxPerMinute) {
      return { ok: false, retry: Math.ceil(60 - diffSec) };
    }
    
    await query(`UPDATE rate_limits SET count=count+1 WHERE key=$1`, [key]);
    return { ok: true };
  } catch(e) { 
    console.log('Rate limit 체크 실패:', e.message);
    return { ok: true }; // 오류 시 통과 (서비스 중단 방지)
  }
}

/** Peakerr 카탈로그 캐시 (주문 대체·min/max 검증용) */
let peakerrCatalogCache = new Map();
let smmkingsCatalogCache = new Map();
function catalogCacheFor(provider) {
  return normalizeProvider(provider) === 'smmkings' ? smmkingsCatalogCache : peakerrCatalogCache;
}
/** 동시 주문 방지 — site+link 단위 (Peakerr 중복 전송 차단) */
const orderPlacementLocks = new Map();
const cancelOrderLocks = new Map();

function orderLockKey(siteId, svc, link) {
  const bucket = svc ? serviceBucketKey(svc) : 'any';
  return `${siteId}:${bucket}:${String(link || '').toLowerCase().replace(/\/+$/, '').split('?')[0]}`;
}

/** 진행 중인 동일 상품(플랫폼+유형) 또는 동일 sid 주문 충돌 검사 */
async function findActiveOrderConflict(siteId, linkNorm, svc) {
  const bucketKey = serviceBucketKey(svc);
  const r = await query(`
    SELECT o.id, o.sid, o.sname FROM orders o
    WHERE o.site_id=$1 AND o.link=$2
    AND o.status IN ('pending','processing')
    ORDER BY o.created DESC
    LIMIT 20
  `, [siteId, linkNorm]);
  for (const o of r.rows) {
    if (o.sid === svc.id) {
      return { orderId: o.id, name: o.sname, bucket: serviceOrderBucket(svc), exact: true };
    }
    const sR = await query(`SELECT pl, name, description FROM services WHERE id=$1`, [o.sid]);
    const existing = sR.rows[0];
    if (existing && `${existing.pl}:${serviceOrderBucket(existing)}` === bucketKey) {
      return { orderId: o.id, name: o.sname, bucket: serviceOrderBucket(svc), exact: false };
    }
  }
  return null;
}

function normalizeOrderLink(url, platform) {
  let s = String(url || '').trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
    // 한글 @핸들 등 %인코딩 → Peakerr가 못 읽는 경우 방지
    try {
      let path = u.pathname || '/';
      for (let i = 0; i < 3; i++) {
        try {
          const d = decodeURIComponent(path);
          if (d === path) break;
          path = d;
        } catch { break; }
      }
      u.pathname = path;
    } catch (_) {}
    if (platform === 'tiktok') {
      u.search = '';
      u.hash = '';
    } else if (platform === 'instagram') {
      // igsh 등 추적 파라미터만 제거 (게시물 경로는 pathname에 있음)
      u.search = '';
      u.hash = '';
    } else if (platform === 'youtube') {
      // ⚠️ watch?v=VIDEO_ID 의 v= 는 절대 지우면 안 됨 (조회수·좋아요 대상)
      const v = u.searchParams.get('v');
      const list = u.searchParams.get('list');
      u.search = '';
      u.hash = '';
      if (v) u.searchParams.set('v', v);
      // 쇼츠/라이브 등 경로형이면 pathname만으로 충분
      if (/\/watch\/?$/i.test(u.pathname) && v) {
        u.pathname = '/watch';
      }
      // youtu.be/ID → 그대로 pathname 유지
    }
    return u.href;
  } catch {
    return s;
  }
}

function serviceOrderBucket(svc) {
  // 상품명만 사용 — 설명에 "조회수 대비 좋아요" 등이 섞여 종류가 바뀌는 오탐 방지
  const fromName = detectServiceTypeKo(svc.name || '');
  if (fromName && fromName !== '서비스') return fromName;
  return detectServiceTypeKo(`${svc.name || ''} ${svc.description || ''}`);
}

function isPeakerrServiceDeadError(msg) {
  if (!msg) return false;
  return /not\s*found|invalid\s*service|service\s*(id|does|disabled)|no\s*service|unavailable|doesn.t exist|존재|없/i.test(msg);
}

function isPeakerrLinkError(msg) {
  if (!msg) return false;
  return /invalid\s*(link|url)|incorrect\s*(link|url)|wrong\s*(link|url)|link\s*(is\s*)?(invalid|required|not)|must be a valid (link|url)|profile\s*(link|url)|username\s*required/i.test(msg);
}

function isPeakerrQuantityError(msg) {
  if (!msg) return false;
  return /quantity|amount|min|max|minimum|maximum|less than|more than|수량/i.test(msg);
}

function peakerrNetworkErrorKo(err) {
  const m = String(err?.message || err || '');
  if (/abort|timeout|timed out/i.test(m)) return '시스템 응답이 지연되고 있습니다. 1~2분 후 다시 시도해주세요.';
  if (/fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|socket|network|TLS/i.test(m)) {
    return '서버 연결이 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.';
  }
  return '연결 오류입니다. 잠시 후 다시 시도해주세요.';
}

/** PerfectPanel API — node-fetch 대신 https 직접 호출 (Render에서 안정적) */
function panelHttpsPost(provider, params, timeoutMs = 30000) {
  const prov = normalizeProvider(provider);
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: PANEL_HOSTS[prov],
      port: 443,
      path: '/api/v2',
      method: 'POST',
      agent: PANEL_AGENTS[prov],
      family: 4,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'GLOW/1.0',
        'Accept': 'application/json'
      },
      timeout: timeoutMs
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: async () => raw,
          json: async () => JSON.parse(raw || '{}')
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('ETIMEDOUT')); });
    req.write(body);
    req.end();
  });
}
function peakerrHttpsPost(params, timeoutMs = 30000) {
  return panelHttpsPost('peakerr', params, timeoutMs);
}

/** PerfectPanel API — 타임아웃·재시도 */
async function panelFetch(provider, params, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const retries = opts.retries ?? 2;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await panelHttpsPost(provider, params, timeoutMs);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}
async function peakerrFetch(params, opts = {}) {
  return panelFetch('peakerr', params, opts);
}

function serviceBucketKey(svc) {
  return `${svc.pl}:${serviceOrderBucket(svc)}`;
}

function isCuratedServiceId(id) {
  return /^[a-z]{2,3}\d/i.test(String(id || ''));
}

/** 시드 중 영구 판매 중단 — 사유·대체 상품 메모 포함.
 *  Peakerr에 동국가·동종 SKU가 없어 재연결 불가한 상품도 포함(재활성화 방지). */
const DISABLED_SEED_META = {
  ptt13: {
    note: 'TikTok 조회수 주문이 반복 취소·실패하여 판매를 중단했습니다. 사진(/photo/) 링크로는 조회수 작업이 불가합니다.',
    replaceId: 'ptt12',
    replaceHint: 'TikTok 조회수 — 브라질 타겟 (드롭 보상)'
  },
  pig11: { note: 'Peakerr에서 한국 Instagram 노출 상품이 삭제되어 판매를 중단했습니다.', replaceId: 'pig10' },
  pkr6: { note: 'Peakerr에서 한국 Instagram 댓글 상품이 삭제되어 판매를 중단했습니다.', replaceId: 'pig1' },
  pkr7: { note: 'Peakerr에서 한국 Instagram 댓글 상품이 삭제되어 판매를 중단했습니다.', replaceId: 'pig1' },
  pkr8: { note: 'Peakerr에서 한국 YouTube 좋아요 상품이 삭제되어 판매를 중단했습니다.', replaceId: 'pyt4' },
  pfb1: { note: 'Peakerr에서 브라질 Facebook 댓글 상품이 삭제되어 판매를 중단했습니다.', replaceId: null },
  pfb3: { note: 'Peakerr에서 브라질 Facebook 팔로워 상품이 삭제되어 판매를 중단했습니다.', replaceId: 'pfb4' },
  pfb6: { note: 'Peakerr에서 브라질 Facebook 좋아요 상품이 삭제되어 판매를 중단했습니다.', replaceId: 'pfb8' },
  ptr4: { note: 'Peakerr에서 해당 트래픽 상품이 삭제되어 판매를 중단했습니다.', replaceId: 'ptr1' },
  // Peakerr "Korean Followers" 실측: 외국인 계정만 유입 (2026-07-31 테스트 O1785464742025)
  pig6: {
    note: 'Peakerr 한국 팔로워 상품이 실제로는 외국인 계정을 보내 판매를 중단했습니다.',
    replaceId: 'skg1',
    replaceHint: 'Instagram 팔로워 — 한국 HQ'
  },
  pkr1: {
    note: 'Peakerr 한국 팔로워 상품이 실제로는 외국인 계정을 보내 판매를 중단했습니다.',
    replaceId: 'skg1',
  },
  pkr2: {
    note: 'Peakerr 한국 팔로워 상품이 실제로는 외국인 계정을 보내 판매를 중단했습니다.',
    replaceId: 'skg1',
  },
  // Peakerr 한국 타겟 전체 — 팔로워 실측 불량으로 한국 SKU 판매 중단 (검증 전 재오픈 금지)
  pig17: { note: 'Peakerr 한국 타겟 품질이 검증되지 않아 판매를 중단했습니다.', replaceId: 'skg3' },
  pkr3: { note: 'Peakerr 한국 타겟 품질이 검증되지 않아 판매를 중단했습니다.', replaceId: 'skg3' },
  pkr4: { note: 'Peakerr 한국 타겟 품질이 검증되지 않아 판매를 중단했습니다.', replaceId: 'skg3' },
  pkr5: { note: 'Peakerr 한국 타겟 품질이 검증되지 않아 판매를 중단했습니다.', replaceId: 'skg3' },
  // pyt13은 pyt2와 동일 SKU(27905) — 중복 판매 방지
  pyt13: {
    note: '동일 공급 SKU 상품과 통합되어 판매를 중단했습니다.',
    replaceId: 'pyt2',
  },
};
const PERMANENTLY_DISABLED_SEEDS = new Set(Object.keys(DISABLED_SEED_META));

async function hideServiceWithNote(serviceId, note, replaceId = null) {
  const repR = replaceId ? await query(`SELECT name FROM services WHERE id=$1`, [replaceId]) : { rows: [] };
  const repName = repR.rows[0]?.name || '';
  let fullNote = String(note || '').trim();
  if (replaceId && repName && !fullNote.includes(repName)) {
    fullNote += (fullNote ? ' ' : '') + `→ 대체 상품: ${repName}`;
  }
  await query(`
    UPDATE services SET active=0, inactive_note=$1, replace_service_id=$2, inactive_at=COALESCE(inactive_at, NOW())
    WHERE id=$3
  `, [fullNote, replaceId || null, serviceId]);
  await query(`
    UPDATE site_services SET active=0
    WHERE service_id=$1
  `, [serviceId]);
}

async function applyDisabledSeedMeta() {
  for (const [id, meta] of Object.entries(DISABLED_SEED_META)) {
    await hideServiceWithNote(id, meta.note, meta.replaceId || null);
  }
}

async function getUnreliableServiceDetails(opts = {}) {
  const minOrders = opts.minOrders ?? 2;
  const days = opts.days ?? 30;
  const r = await query(`
    SELECT sid,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status IN ('cancelled','canceled'))::int AS cancelled,
      COUNT(*) FILTER (WHERE status IN ('failed','refunded'))::int AS failed
    FROM orders
    WHERE created >= NOW() - ($2 || ' days')::interval
    GROUP BY sid
    HAVING COUNT(*) >= $1
       AND COUNT(*) FILTER (WHERE status IN ('completed','processing','pending')) = 0
  `, [minOrders, days]);
  return r.rows;
}

async function ensurePeakerrCatalogLoaded(opts = {}) {
  if (peakerrCatalogCache.size > 0) return;
  if (opts.background) {
    syncPeakerrServices().catch(e => console.log('Peakerr 카탈로그 백그라운드 로드:', e.message));
    return;
  }
  const r = await syncPeakerrServices();
  if (r?.skipped || peakerrCatalogCache.size === 0) {
    console.log('Peakerr 카탈로그 로드 실패 — API 키 또는 연결 확인');
  }
}

async function syncSmmkingsCatalog() {
  try {
    const apiKey = await getSmmkingsApiKey();
    if (!apiKey) return { skipped: true };
    const resp = await panelFetch('smmkings', { key: apiKey, action: 'services' }, { timeoutMs: 90000 });
    const services = await resp.json();
    if (!Array.isArray(services)) return { skipped: true };
    const map = new Map();
    services.forEach(s => map.set(String(s.service), s));
    smmkingsCatalogCache = map;

    const glowR = await query(`
      SELECT id, name, api_id, rate, min, max, active FROM services
      WHERE api_id IS NOT NULL AND api_id != ''
        AND COALESCE(provider,'peakerr')='smmkings'
    `);
    let disabled = 0, priceChanged = 0;
    for (const glowSvc of glowR.rows) {
      const remote = map.get(String(glowSvc.api_id));
      if (!remote) {
        if (glowSvc.active === 1) {
          await hideServiceWithNote(glowSvc.id, '공급 목록에서 삭제·중단됨');
          disabled++;
        }
        continue;
      }
      const newRate = parseFloat(remote.rate);
      const oldRate = parseFloat(glowSvc.rate);
      const pMin = Math.max(1, parseInt(remote.min, 10) || glowSvc.min || 1);
      const pMax = parseInt(remote.max, 10) || glowSvc.max || 10000000;
      await query(`UPDATE services SET min=$1, max=$2 WHERE id=$3`, [pMin, pMax, glowSvc.id]);
      if (oldRate > 0 && Math.abs(newRate - oldRate) / oldRate > 0.05) {
        await query(`UPDATE services SET rate=$1 WHERE id=$2`, [newRate, glowSvc.id]);
        priceChanged++;
      }
      const nameHint = `${remote.name || ''} ${remote.category || ''}`;
      const hasRefill = peakerrServiceHasRefill(remote) || /refill|보장|드롭/i.test(nameHint) ? 1 : 0;
      await query(`UPDATE services SET refill_guaranteed=$1 WHERE id=$2`, [hasRefill, glowSvc.id]);
    }
    if (disabled || priceChanged) {
      console.log(`✅ SMMKings 동기화: 비활성 ${disabled} · 가격 ${priceChanged}`);
    }
    return { disabled, priceChanged, checked: glowR.rows.length };
  } catch (e) {
    console.log('SMMKings 카탈로그 동기화:', e.message);
    return { skipped: true, error: e.message };
  }
}

async function ensureSmmkingsCatalogLoaded(opts = {}) {
  if (smmkingsCatalogCache.size > 0) return;
  if (opts.background) {
    syncSmmkingsCatalog().catch(e => console.log('SMMKings 카탈로그 백그라운드:', e.message));
    return;
  }
  await syncSmmkingsCatalog();
}

/** 최근 주문이 전부 실패·취소인 상품 (성공 0건) — 시드 상품도 숨김 대상 */
async function getUnreliableServiceIds(opts = {}) {
  const minOrders = opts.minOrders ?? 2;
  const days = opts.days ?? 30;
  const r = await query(`
    SELECT sid FROM orders
    WHERE created >= NOW() - ($2 || ' days')::interval
    GROUP BY sid
    HAVING COUNT(*) >= $1
       AND COUNT(*) FILTER (WHERE status IN ('completed','processing','pending')) = 0
  `, [minOrders, days]);
  return new Set(r.rows.map(row => row.sid));
}

async function deactivateUnreliableServices(opts = {}) {
  const details = await getUnreliableServiceDetails(opts);
  let n = 0;
  for (const row of details) {
    const parts = [`최근 ${opts.days ?? 30}일 주문 ${row.total}건 전부 미완료`];
    if (row.cancelled > 0) parts.push(`취소 ${row.cancelled}건`);
    if (row.failed > 0) parts.push(`실패·환불 ${row.failed}건`);
    parts.push('자동 판매 중단');
    const note = parts.join(' · ');
    const u = await query(`
      UPDATE services SET active=0, inactive_note=$1, inactive_at=COALESCE(inactive_at, NOW())
      WHERE id=$2 AND active=1 RETURNING id, name
    `, [note, row.sid]);
    if (u.rowCount) {
      n++;
      await query(`UPDATE site_services SET active=0 WHERE service_id=$1`, [row.sid]);
      console.log(`⚠️ 미작동 상품 숨김: ${row.sid} (${u.rows[0]?.name || ''})`);
    }
  }
  return n;
}

async function reactivateCuratedSeedServices() {
  await ensurePeakerrCatalogLoaded();
  await ensureSmmkingsCatalogLoaded().catch(() => null);
  const unreliable = await getUnreliableServiceIds();
  const r = await query(`
    SELECT id, api_id, provider FROM services
    WHERE id ~ '^[a-z]{2,3}[0-9]+' AND api_id IS NOT NULL AND TRIM(api_id) <> ''
  `);
  let n = 0;
  for (const row of r.rows) {
    if (unreliable.has(row.id)) continue;
    if (PERMANENTLY_DISABLED_SEEDS.has(row.id)) continue;
    const prov = serviceProvider(row);
    const catalog = catalogCacheFor(prov);
    if (catalog.size === 0 || !catalog.has(String(row.api_id))) continue;
    const u = await query(`UPDATE services SET active=1 WHERE id=$1 AND active=0 RETURNING id`, [row.id]);
    if (u.rowCount) n++;
  }
  if (n > 0) console.log(`✅ 검증 시드 상품 ${n}개 재활성화`);
  return n;
}

function peakerrCatalogCacheHas(apiId) {
  return peakerrCatalogCache.has(String(apiId));
}

function peakerrServiceHasRefill(s) {
  if (!s) return false;
  const v = s.refill;
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

function peakerrBucketKeyFromService(s) {
  const full = `${s.name || ''} ${s.category || ''} ${s.type || ''}`;
  const pl = detectPlat(full);
  const bucket = detectServiceTypeKo(full);
  return `${pl}:${bucket}`;
}

/** 국가·지역 타겟 키 — 한국/미국 등이 글로벌 리필 SKU로 덮이지 않게 분리 */
function detectMarketGeoKey(full) {
  const t = String(full || '').toLowerCase();
  if (/korea|korean|\bkr\b|south korea|한국/.test(t)) return 'korea';
  if (/united states|\busa\b|\bus\b|america|american|미국/.test(t)) return 'usa';
  if (/brazil|brazilian|brasil|브라질/.test(t)) return 'brazil';
  if (/india|indian|i̇ndian|ındian|🇮🇳|인도/.test(t)) return 'india';
  if (/turkey|turkish|türk|🇹🇷|터키/.test(t)) return 'turkey';
  if (/arab|arabic|middle east|아랍|중동/.test(t)) return 'arab';
  if (/thailand|thai|태국|🇹🇭/.test(t)) return 'thailand';
  if (/vietnam|vietnamese|việt\s*nam|viet\s*nam|\bvn\b|베트남|🇻🇳/.test(t)) return 'vietnam';
  if (/nigeria|nigerian|나이지리아/.test(t)) return 'nigeria';
  if (/japan|japanese|일본|🇯🇵/.test(t)) return 'japan';
  if (/global|worldwide|world wide|premium global|프리미엄 글로벌|전 세계|글로벌|world\s*wide/.test(t)) return 'global';
  return 'other';
}

function serviceMarketGeoKey(svc) {
  return detectMarketGeoKey(`${svc.name || ''} ${svc.description || ''}`);
}

function peakerrMarketGeoKey(s) {
  return detectMarketGeoKey(`${s.name || ''} ${s.category || ''} ${s.type || ''}`);
}

/** Peakerr 종류 — 상품명 우선 (카테고리 Followers가 Like 상품을 덮는 오탐 방지) */
function peakerrServiceTypeKo(s) {
  const fromName = detectServiceTypeKo(String(s?.name || ''));
  if (fromName && fromName !== '서비스') return fromName;
  return detectServiceTypeKo(`${s?.name || ''} ${s?.category || ''} ${s?.type || ''}`);
}

function bucketsCompatible(glowBucket, peakBucket, peakName = '') {
  if (!glowBucket || !peakBucket) return false;
  if (glowBucket === peakBucket) return true;
  const pn = String(peakName || '').toLowerCase();
  // Likes + Views 복합 SKU는 좋아요·조회수 모두 허용
  if (/likes?\s*\+\s*views?|views?\s*\+\s*likes?/i.test(pn)) {
    if (glowBucket === '좋아요' || glowBucket === '조회수') return true;
  }
  // 2-in-1 likes+followers
  if (/2-?in-?1|likes?\s*\+?\s*followers?|followers?\s*\+?\s*likes?/i.test(pn)) {
    if (glowBucket === '좋아요' || glowBucket === '팔로워') return true;
  }
  return false;
}

function geoKeysCompatible(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // Peakerr 영문에 국가 표기 없는 Worldwide ≈ GLOW 글로벌
  if ((a === 'global' && b === 'other') || (a === 'other' && b === 'global')) return true;
  return false;
}

/** 공급 카탈로그에서 리필 보장·고품질 SKU 선택 (동일 플랫폼·종류·국가만) */
function findBestRefillPeakerrService(pl, bucket, excludeApiIds = new Set(), geoKey = null) {
  let best = null;
  let bestScore = -1;
  for (const s of peakerrCatalogCache.values()) {
    if (excludeApiIds.has(String(s.service))) continue;
    const key = peakerrBucketKeyFromService(s);
    if (key !== `${pl}:${bucket}`) continue;
    if (geoKey && !geoKeysCompatible(geoKey, peakerrMarketGeoKey(s))) continue;
    if (!peakerrServiceHasRefill(s)) continue;
    const score = scorePeakerrService(s);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/** 시드 상품 — 동일 국가 안에서만 리필 SKU 교체. 검증 시드(api 고정)는 api_id 변경 금지 */
async function upgradeEngagementSeedsFromPeakerr() {
  // Peakerr 상품 그대로: 한국→한국 api, 브라질→브라질 api (섞인 매핑 먼저 복구)
  await restoreCuratedSeedApiLocks().catch(e => console.log('시드 api 복구:', e.message));
  // Peakerr에서 삭제된 국가 시드 → 동종·동국가 살아 있는 SKU로 재연결
  await remapMissingGeoSeedServices().catch(e => console.log('geo 재연결:', e.message));

  await ensurePeakerrCatalogLoaded();
  if (peakerrCatalogCache.size === 0) return { upgraded: 0, disabled: 0 };

  const ENGAGEMENT = new Set(['팔로워', '좋아요', '조회수']);
  const PLATFORMS = new Set(['tiktok', 'threads', 'instagram', 'facebook']);
  const r = await query(`
    SELECT id, name, pl, api_id, active, description, provider FROM services
    WHERE id ~ '^[a-z]{2,3}[0-9]+' AND api_id IS NOT NULL AND TRIM(api_id) <> ''
      AND COALESCE(provider,'peakerr')='peakerr'
  `);

  let upgraded = 0, disabled = 0;
  const refillBuckets = new Set();
  const upgradedIds = new Set();

  for (const row of r.rows) {
    if (!PLATFORMS.has(row.pl)) continue;
    const bucket = serviceOrderBucket(row);
    if (!ENGAGEMENT.has(bucket)) continue;
    const geo = serviceMarketGeoKey(row);
    const geoBucket = `${row.pl}:${bucket}:${geo}`;

    const peak = peakerrCatalogCache.get(String(row.api_id));
    const hasRefill = peakerrServiceHasRefill(peak);
    await query(`UPDATE services SET refill_guaranteed=$1 WHERE id=$2`, [hasRefill ? 1 : 0, row.id]);

    if (hasRefill) {
      refillBuckets.add(geoBucket);
      continue;
    }

    // 검증 시드(pig6/pkr1 등)는 국가 라벨·api_id 고정 — 글로벌 리필로 덮어쓰지 않음
    if (isCuratedServiceId(row.id)) continue;

    const alt = findBestRefillPeakerrService(row.pl, bucket, new Set([String(row.api_id)]), geo);
    if (alt) {
      await query(`UPDATE services SET api_id=$1, refill_guaranteed=1, active=1, rate=$2, min=$3, max=$4,
        inactive_note='', replace_service_id=NULL
        WHERE id=$5`, [
        String(alt.service),
        parseFloat(alt.rate || 0),
        Math.max(1, parseInt(alt.min, 10) || 10),
        parseInt(alt.max, 10) || 1000000,
        row.id
      ]);
      refillBuckets.add(geoBucket);
      upgraded++;
      upgradedIds.add(row.id);
      console.log(`🔄 리필 SKU 교체: ${row.id} [${geo}] → api ${alt.service} (${(alt.name || '').slice(0, 40)})`);
    }
  }

  for (const row of r.rows) {
    if (upgradedIds.has(row.id)) continue;
    if (isCuratedServiceId(row.id)) continue; // 검증 시드 숨김 금지
    if (!PLATFORMS.has(row.pl)) continue;
    const bucket = serviceOrderBucket(row);
    if (!ENGAGEMENT.has(bucket)) continue;
    const geo = serviceMarketGeoKey(row);
    const geoBucket = `${row.pl}:${bucket}:${geo}`;
    if (!refillBuckets.has(geoBucket)) continue;

    const peak = peakerrCatalogCache.get(String(row.api_id));
    if (peakerrServiceHasRefill(peak)) continue;
    const altExists = findBestRefillPeakerrService(row.pl, bucket, new Set(), geo);
    if (!altExists || String(altExists.service) === String(row.api_id)) continue;

    const rep = r.rows.find(x => {
      if (x.id === row.id || x.pl !== row.pl) return false;
      if (serviceOrderBucket(x) !== bucket) return false;
      if (serviceMarketGeoKey(x) !== geo) return false;
      if (upgradedIds.has(x.id)) return true;
      return peakerrServiceHasRefill(peakerrCatalogCache.get(String(x.api_id)));
    });
    const note = rep
      ? '리필 보장이 없는 동일 종류·동일 국가 상품 — 리필 SKU로 통합하여 판매 중단'
      : '리필 보장 없음 · 동일 국가 리필 상품 없음 — 판매 중단';
    await hideServiceWithNote(row.id, note, rep?.id || null);
    disabled++;
  }

  if (upgraded || disabled) {
    console.log(`✅ 참여형 시드 정리: 리필 교체 ${upgraded} · 리필 없음 숨김 ${disabled}`);
  }
  await syncServiceDescriptionFooters();
  return { upgraded, disabled };
}

async function syncServiceRefillFlagsFromPeakerr(peakerrMap) {
  const r = await query(`
    SELECT id, api_id FROM services
    WHERE api_id IS NOT NULL AND TRIM(api_id) <> ''
      AND COALESCE(provider,'peakerr')='peakerr'
  `);
  for (const row of r.rows) {
    const peak = peakerrMap.get(String(row.api_id));
    const hasRefill = peakerrServiceHasRefill(peak);
    await query(`UPDATE services SET refill_guaranteed=$1 WHERE id=$2`, [hasRefill ? 1 : 0, row.id]);
  }
}

async function submitPanelRefill(provider, apiKey, apiOrderId) {
  if (!apiKey || !apiOrderId) return { ok: false, error: 'missing' };
  try {
    const resp = await panelFetch(provider, { key: apiKey, action: 'refill', order: String(apiOrderId) });
    const data = await resp.json();
    if (data?.error) return { ok: false, error: String(data.error) };
    if (/success|refill/i.test(String(data?.status || data?.message || ''))) {
      return { ok: true, data };
    }
    if (data?.refill) return { ok: true, data };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
async function submitPeakerrRefill(apiKey, apiOrderId) {
  return submitPanelRefill('peakerr', apiKey, apiOrderId);
}

/** 완료 주문 — 드롭 보장 상품: 실제 감소 확인 후 자동 보충 */
async function processEligibleRefills(opts = {}) {
  const maxPerRun = opts.maxPerRun ?? 15;
  const r = await query(`
    SELECT o.*, s.refill_guaranteed, s.provider AS service_provider
    FROM orders o
    INNER JOIN services s ON s.id = o.sid
    WHERE o.status = 'completed'
      AND COALESCE(s.refill_guaranteed, 0) = 1
      AND o.api_order_id IS NOT NULL AND TRIM(o.api_order_id) <> ''
      AND o.created >= NOW() - INTERVAL '30 days'
      AND COALESCE(o.refill_count, 0) < 5
      AND (
        o.refill_last_at IS NULL
        OR o.refill_last_at < NOW() - INTERVAL '48 hours'
      )
      AND COALESCE(o.completed_at, o.created) <= NOW() - INTERVAL '24 hours'
    ORDER BY o.created ASC
    LIMIT $1
  `, [maxPerRun]);

  let processed = 0, ok = 0, skipped = 0;
  const checkpoints = [1, 3, 7, 14, 21];
  for (const order of r.rows) {
    processed++;
    const daysSince = (Date.now() - new Date(order.completed_at || order.created).getTime()) / 86400000;
    const checkRound = parseInt(order.refill_count || 0, 10);
    const checkIdx = Math.min(checkRound, checkpoints.length - 1);
    if (daysSince < checkpoints[checkIdx]) continue;

    const drop = await detectOrderDrop(order);
    await query(`
      UPDATE orders SET refill_count=COALESCE(refill_count,0)+1, refill_last_at=NOW() WHERE id=$1
    `, [order.id]);

    if (!drop.needsRefill) {
      skipped++;
      const why = drop.reason === 'unmeasured' ? '숫자 확인 불가' : `감소 없음 (${drop.current ?? '?'}/${drop.target ?? '?'})`;
      console.log(`♻️ 리필 보류 ${order.id}: ${why}`);
      await new Promise(res => setTimeout(res, 200));
      continue;
    }

    const prov = orderProvider(order) || normalizeProvider(order.service_provider);
    const apiKey = await getPanelApiKey(prov);
    if (!apiKey) { skipped++; continue; }
    const result = await submitPanelRefill(prov, apiKey, order.api_order_id);
    if (result.ok) {
      ok++;
      const detail = `목표 ${drop.target.toLocaleString()} → 현재 ${drop.current.toLocaleString()} (${drop.drop.toLocaleString()} 감소)`;
      await logActivity(order.site_id, 'system', '자동리필',
        `드롭 자동 보충`, 'order', order.id, `${order.sname} · ${detail}`);
      console.log(`♻️ 자동 보충: ${order.id} · ${detail}`);
      await tgOrderNotify('♻️ <b>드롭 자동 보충</b>', order, {
        actorId: 'system',
        extra: `📉 ${detail}\n✅ 보충 작업 요청 완료`
      }).catch(() => null);
      await sendTelegramToSuper(
        `♻️ <b>드롭 자동 보충</b>\n\n주문 <code>${order.id}</code>\n${order.sname}\n${detail}`
      ).catch(() => null);
    } else {
      const errKo = stripSupplierBrand(result.error || '보충 요청 실패');
      console.log(`♻️ 보충 실패 ${order.id}: ${errKo}`);
      await sendTelegramToSuper(
        `⚠️ <b>드롭 보충 실패</b>\n\n주문 <code>${order.id}</code>\n${order.sname}\n${errKo}`
      ).catch(() => null);
    }
    await new Promise(res => setTimeout(res, 400));
  }
  return { processed, ok, skipped };
}

async function resolveOrderService(sid) {
  const activeR = await query(`SELECT * FROM services WHERE id=$1 AND active=1`, [sid]);
  if (activeR.rows[0]) return activeR.rows[0];
  const inactR = await query(`SELECT * FROM services WHERE id=$1`, [sid]);
  const row = inactR.rows[0];
  if (!row) return null;
  // 영구 중단 시드는 Peakerr에 살아 있어도 절대 재활성화하지 않음
  if (PERMANENTLY_DISABLED_SEEDS.has(row.id)) return null;
  if (isCuratedServiceId(row.id) && row.api_id) {
    const prov = serviceProvider(row);
    if (prov === 'smmkings') {
      await ensureSmmkingsCatalogLoaded().catch(() => null);
      if (smmkingsCatalogCache.has(String(row.api_id))) {
        await query(`UPDATE services SET active=1 WHERE id=$1`, [row.id]);
        return { ...row, active: 1 };
      }
    } else {
      await ensurePeakerrCatalogLoaded();
      if (peakerrCatalogCache.has(String(row.api_id))) {
        await query(`UPDATE services SET active=1 WHERE id=$1`, [row.id]);
        return { ...row, active: 1 };
      }
    }
  }
  const bucket = serviceOrderBucket(row);
  const altR = await query(`
    SELECT * FROM services WHERE active=1 AND pl=$1 AND id <> $2
      AND api_id IS NOT NULL AND TRIM(api_id) <> ''
  `, [row.pl, row.id]);
  const geo = serviceMarketGeoKey(row);
  const curated = altR.rows
    .filter(s => isCuratedServiceId(s.id) && serviceOrderBucket(s) === bucket)
    .filter(s => geoKeysCompatible(geo, serviceMarketGeoKey(s)))
    .sort((a, b) => scoreServiceRow(b) - scoreServiceRow(a));
  return curated[0] || null;
}

async function getMaxPeakerrOrderIdInDb() {
  try {
    const r = await query(`
      SELECT MAX(CAST(api_order_id AS BIGINT)) AS m FROM orders
      WHERE api_order_id ~ '^[0-9]+$'
        AND COALESCE(api_provider,'peakerr')='peakerr'
    `);
    return parseInt(r.rows[0]?.m || 0, 10) || 0;
  } catch (e) { return 0; }
}

/** Peakerr 응답 유실(네트워크 끊김) 후 순번 스캔으로 주문 ID 복구 */
async function recoverPeakerrOrderAfterNetworkError(apiKey, baselineId, expectedChargeUsd, maxScan = 35, opts = {}) {
  await new Promise(r => setTimeout(r, opts.waitMs ?? 1800));
  const expected = parseFloat(expectedChargeUsd) || 0;
  const loose = !!opts.loose;
  let looseMatch = null;
  for (let id = baselineId + 1; id <= baselineId + maxScan; id++) {
    const st = await fetchPeakerrOrderStatus(apiKey, String(id));
    if (!st || st.error) continue;
    const charge = parseFloat(st.charge || 0);
    if (charge <= 0) continue;
    const s = (st.status || '').toLowerCase();
    if (['canceled', 'cancelled'].includes(s)) continue;
    if (!loose && expected > 0 && Math.abs(charge - expected) / Math.max(expected, 0.0001) > 0.65) {
      if (!looseMatch) looseMatch = { ok: true, apiOrderId: String(id) };
      continue;
    }
    return { ok: true, apiOrderId: String(id) };
  }
  return looseMatch;
}

async function reconcileOrderMissingApiId(order) {
  if (!order || order.api_order_id) return null;
  const apiKey = await getPeakerrApiKey();
  if (!apiKey) return null;
  const beforeR = await query(`
    SELECT MAX(CAST(api_order_id AS BIGINT)) AS m FROM orders
    WHERE api_order_id ~ '^[0-9]+$' AND created < $1 AND id <> $2
  `, [order.created, order.id]);
  const baseline = parseInt(beforeR.rows[0]?.m || 0, 10) || 0;
  const svcR = await query(`SELECT rate FROM services WHERE id=$1`, [order.sid]);
  const expected = parseFloat(svcR.rows[0]?.rate || 0) / 1000 * (order.qty || 1);
  const rec = await recoverPeakerrOrderAfterNetworkError(apiKey, baseline, expected, 45);
  if (!rec?.apiOrderId) return null;
  await query(`UPDATE orders SET api_order_id=$1 WHERE id=$2 AND (api_order_id IS NULL OR api_order_id='')`,
    [rec.apiOrderId, order.id]);
  const freshR = await query(`SELECT * FROM orders WHERE id=$1`, [order.id]);
  const fresh = freshR.rows[0];
  if (fresh && fresh.status === 'pending' && !parseInt(fresh.paid || 0, 10)) {
    await confirmPendingOrderPayment(fresh);
  } else if (fresh && fresh.status !== 'processing' && parseInt(fresh.paid || 0, 10)) {
    await query(`UPDATE orders SET status='processing' WHERE id=$1`, [order.id]);
  }
  return rec.apiOrderId;
}

async function reconcileOrphanPeakerrOrders() {
  try {
    const r = await query(`
      SELECT * FROM orders
      WHERE (api_order_id IS NULL OR api_order_id='')
      AND status IN ('processing', 'pending', 'failed')
      AND created > NOW() - INTERVAL '7 days'
      ORDER BY created ASC
      LIMIT 30
    `);
    let fixed = 0;
    for (const o of r.rows) {
      const id = await reconcileOrderMissingApiId(o);
      if (!id) continue;
      const freshR = await query(`SELECT * FROM orders WHERE id=$1`, [o.id]);
      const fresh = freshR.rows[0];
      if (fresh?.status === 'pending' && !parseInt(fresh.paid || 0, 10)) {
        await confirmPendingOrderPayment(fresh);
        fixed++;
        console.log(`✓ Peakerr ID 복구+결제: ${o.id} → #${id}`);
        continue;
      }
      if (o.status === 'failed') {
        const siteR = await query(`SELECT * FROM sites WHERE id=$1`, [o.site_id]);
        const svcR = await query(`SELECT * FROM services WHERE id=$1`, [o.sid]);
        const userR = await query(`SELECT * FROM users WHERE id=$1`, [o.uid]);
        if (siteR.rows[0] && svcR.rows[0] && userR.rows[0]) {
          const margins = await getSiteMargins(siteR.rows[0]);
          const adminCredit = o.site_id !== 'default' && ['admin', 'partner'].includes(userR.rows[0].role);
          const { charge, apiCost, orderCostKrw } = computeOrderAmounts(svcR.rows[0], o.qty, siteR.rows[0], margins);
          if (!adminCredit && (o.charge || 0) === 0 && charge > 0) {
            await query(`UPDATE users SET balance=GREATEST(0,balance-$1) WHERE id=$2`, [charge, o.uid]);
          }
          if (o.site_id !== 'default' && (o.cost || 0) === 0) {
            await query(`UPDATE sites SET credit=GREATEST(0,credit-$1) WHERE id=$2`, [apiCost, o.site_id]);
            await query(`UPDATE orders SET status='processing', cost=$1, api_cost=$2, charge=$3 WHERE id=$4`,
              [Math.round(orderCostKrw), apiCost, adminCredit ? 0 : charge, o.id]);
          } else {
            await query(`UPDATE orders SET status='processing' WHERE id=$1`, [o.id]);
          }
        } else {
          await query(`UPDATE orders SET status='processing' WHERE id=$1`, [o.id]);
        }
      }
      fixed++;
      console.log(`✓ Peakerr ID 복구: ${o.id} → #${id}`);
    }
    return fixed;
  } catch (e) { console.log('Peakerr ID 복구:', e.message); return 0; }
}

/** api_order_id 없이 오래 멈춘 주문 — Peakerr 미전송으로 간주 후 환불 (손실 방지) */
async function refundStuckOrdersWithoutApiId() {
  try {
    const r = await query(`
      SELECT * FROM orders
      WHERE (api_order_id IS NULL OR api_order_id='')
      AND status IN ('processing', 'pending')
      AND COALESCE(paid,0)=1
      AND created < NOW() - INTERVAL '2 hours'
      AND created > NOW() - INTERVAL '7 days'
      ORDER BY created ASC
      LIMIT 15
    `);
    let refunded = 0;
    for (const o of r.rows) {
      if (!parseInt(o.paid || 0, 10)) continue;
      const recovered = await reconcileOrderMissingApiId(o);
      if (recovered) continue;
      const fin = await restoreRefundFinancials(o, 100, {
        reason: `미전송 주문 자동 환불 - ${o.id}`,
        adminId: 'system'
      });
      if (fin.alreadyRefunded) continue;
      await query(`UPDATE orders SET status='refunded', cost=$1 WHERE id=$2`, [fin.newCost, o.id]);
      await logActivity(o.site_id, 'system', '자동환불', '미전송 주문 환불', 'order', o.id,
        `공급 미연동 · ₩${(fin.refundAmount || 0).toLocaleString()} 환불`);
      refunded++;
    }
    if (refunded > 0) console.log(`💸 미전송 주문 ${refunded}건 자동 환불`);
    return refunded;
  } catch (e) { console.log('미전송 주문 환불:', e.message); return 0; }
}

/**
 * Peakerr에 접수됐지만 장시간 시작숫자 0·잔여=주문수량인 주문
 * → 공급 미작업으로 보고 자동 환불 + 해당 상품 누적 시 판매 중단
 * (없는 SKU가 아니라 "받아놓고 안 돌리는" 불량 공급 대응)
 */
async function refundZeroProgressStuckOrders(opts = {}) {
  const hours = opts.hours ?? 12;
  try {
    const r = await query(`
      SELECT * FROM orders
      WHERE status='processing'
        AND api_order_id IS NOT NULL AND TRIM(api_order_id) <> ''
        AND COALESCE(paid,0)=1
        AND COALESCE(starts_count,0)=0
        AND COALESCE(remains, qty)=qty
        AND created < NOW() - ($1 || ' hours')::interval
        AND created > NOW() - INTERVAL '14 days'
      ORDER BY created ASC
      LIMIT 20
    `, [String(hours)]);
    let refunded = 0;
    const hitSids = new Set();
    for (const o of r.rows) {
      // 공급사 최신 상태 재확인 — 이미 돌기 시작했으면 스킵
      const prov = orderProvider(o);
      const apiKey = await getPanelApiKey(prov);
      if (apiKey) {
        const st = await fetchPanelOrderStatus(prov, apiKey, o.api_order_id).catch(() => null);
        if (st && !st.error) {
          const sc = parsePeakerrStartCount(st);
          const rem = parseInt(st.remains ?? st.remains_count ?? o.remains ?? o.qty, 10);
          const pst = String(st.status || '').toLowerCase();
          if (sc > 0 || (Number.isFinite(rem) && rem < o.qty) || pst === 'completed') {
            await autoRefundOrder(o, st, { notifyTg: false }).catch(() => null);
            continue;
          }
          if (['pending', 'in progress', 'processing', 'awaiting'].includes(pst)) {
            await submitPanelCancel(prov, apiKey, o.api_order_id).catch(() => null);
          }
        }
      }
      const fin = await restoreRefundFinancials(o, 100, {
        reason: `미진행(시작0) 자동 환불 ${hours}h+ - ${o.id}`,
        adminId: 'system'
      });
      if (fin.alreadyRefunded) continue;
      await query(`UPDATE orders SET status='refunded', cost=$1 WHERE id=$2`, [fin.newCost, o.id]);
      await logActivity(o.site_id, 'system', '자동환불', '미진행 주문 환불', 'order', o.id,
        `시작0 · ${hours}시간+ · 크레딧 $${(fin.creditRefund || 0).toFixed(4)}`);
      await tgOrderNotify('💸 <b>미진행 자동 환불</b>', o, {
        actorId: 'system',
        extra: `⏱ ${hours}시간 이상 작업 시작 없음\n💰 크레딧 $${(fin.creditRefund || 0).toFixed(4)} 복구`
      }).catch(() => null);
      refunded++;
      if (o.sid) hitSids.add(o.sid);
    }
    // 같은 상품에서 최근 14일 미진행 환불 2건 이상 → 판매 중단
    for (const sid of hitSids) {
      if (PERMANENTLY_DISABLED_SEEDS.has(sid)) continue;
      const cntR = await query(`
        SELECT COUNT(*)::int AS c FROM orders
        WHERE sid=$1 AND status='refunded'
          AND COALESCE(starts_count,0)=0
          AND created > NOW() - INTERVAL '14 days'
      `, [sid]);
      if ((cntR.rows[0]?.c || 0) >= 2) {
        await hideServiceWithNote(sid,
          '최근 주문에서 작업이 시작되지 않아 판매를 중단했습니다. 다른 상품을 이용해 주세요.');
        console.log(`⚠️ 미진행 반복 상품 숨김: ${sid}`);
      }
    }
    if (refunded > 0) console.log(`💸 미진행(시작0) 주문 ${refunded}건 자동 환불`);
    return refunded;
  } catch (e) {
    console.log('미진행 주문 환불:', e.message);
    return 0;
  }
}

async function submitPanelOrder(provider, apiKey, apiId, link, qty) {
  try {
    // add는 재시도 금지 — 응답 유실 시 재전송하면 공급사에 중복 주문 생성됨
    const resp = await panelFetch(provider, {
      key: apiKey, action: 'add', service: String(apiId), link, quantity: String(qty)
    }, { timeoutMs: 45000, retries: 0 });
    const data = await resp.json();
    if (data.order) return { ok: true, apiOrderId: String(data.order) };
    return { ok: false, error: data.error || '주문 접수 실패' };
  } catch (e) {
    return { ok: false, networkError: true, error: peakerrNetworkErrorKo(e) };
  }
}
async function submitPeakerrOrder(apiKey, apiId, link, qty) {
  return submitPanelOrder('peakerr', apiKey, apiId, link, qty);
}

async function findAlternateServices(primary, siteId, qty, excludeIds = new Set(), limit = 8) {
  const bucket = serviceOrderBucket(primary);
  const geo = serviceMarketGeoKey(primary);
  const prov = serviceProvider(primary);
  const r = await query(`
    SELECT s.* FROM services s
    WHERE s.active=1 AND s.pl=$1 AND s.id<>$2
      AND s.api_id IS NOT NULL AND TRIM(s.api_id) <> ''
      AND COALESCE(s.provider,'peakerr')=$3
  `, [primary.pl, primary.id, prov]);
  const catalog = catalogCacheFor(prov);
  const sameBucket = (s) => !bucket || bucket === '서비스' || serviceOrderBucket(s) === bucket;
  const sameGeo = (s) => geoKeysCompatible(geo, serviceMarketGeoKey(s));
  return r.rows
    .filter(s => !excludeIds.has(s.id))
    .filter(sameBucket)
    .filter(sameGeo)
    .filter(s => qty >= (s.min || 1) && qty <= (s.max || 999999999))
    .filter(s => catalog.size === 0 || catalog.has(String(s.api_id)))
    .sort((a, b) => {
      const pa = serviceIdPriority(a.id) - serviceIdPriority(b.id);
      if (pa !== 0) return pa;
      if (bucket && bucket !== '서비스') {
        const ba = serviceOrderBucket(a) === bucket ? 0 : 1;
        const bb = serviceOrderBucket(b) === bucket ? 0 : 1;
        if (ba !== bb) return ba - bb;
      }
      return scoreServiceRow(b) - scoreServiceRow(a) || parseFloat(a.rate) - parseFloat(b.rate);
    })
    .slice(0, limit);
}

async function placeOrderWithFallback(apiKey, primary, link, qty, siteId) {
  const prov = serviceProvider(primary);
  const baselineId = prov === 'peakerr' ? await getMaxPeakerrOrderIdInDb() : 0;
  const tried = new Set();
  // 검증 상품(ig1, yt2 등)은 선택한 SKU만 — 대체 전송 시 중복·혼선 방지
  const alternates = isCuratedServiceId(primary.id)
    ? []
    : await findAlternateServices(primary, siteId, qty, tried, 8);
  const candidates = [primary, ...alternates];
  let lastError = null;
  let lastLinkError = null;
  let hadNetworkError = false;
  const expectedPrimaryUsd = parseFloat(primary.rate) / 1000 * qty;
  const catalog = catalogCacheFor(prov);

  for (const svc of candidates) {
    if (!svc.api_id || tried.has(svc.id)) continue;
    if (serviceProvider(svc) !== prov) continue;
    tried.add(svc.id);
    const cached = catalog.get(String(svc.api_id));
    if (cached) {
      const cMin = parseInt(cached.min, 10) || svc.min || 1;
      const cMax = parseInt(cached.max, 10) || svc.max || 999999999;
      if (qty < cMin || qty > cMax) continue;
    }
    const result = await submitPanelOrder(prov, apiKey, svc.api_id, link, qty);
    if (result.ok) return { ok: true, apiOrderId: result.apiOrderId, usedSvc: svc, provider: prov };
    if (result.networkError) {
      hadNetworkError = true;
      lastError = result.error;
      if (prov === 'peakerr') {
        const expectedUsd = parseFloat(svc.rate) / 1000 * qty;
        const rec = await recoverPeakerrOrderAfterNetworkError(apiKey, baselineId, expectedUsd, 50)
          || await recoverPeakerrOrderAfterNetworkError(apiKey, baselineId, expectedUsd, 50, { loose: true, waitMs: 0 });
        if (rec?.apiOrderId) return { ok: true, apiOrderId: rec.apiOrderId, usedSvc: svc, recovered: true, provider: prov };
      }
      // ⚠️ 네트워크 오류 시 다른 SKU로 재전송하면 중복 주문 — 여기서 중단
      break;
    }
    lastError = result.error;
    if (isPeakerrLinkError(result.error)) {
      lastLinkError = result.error;
      continue;
    }
    if (isPeakerrServiceDeadError(result.error) || isPeakerrQuantityError(result.error)) {
      if (!isCuratedServiceId(svc.id)) {
        const why = isPeakerrQuantityError(result.error) ? '수량·최소주문 조건 불일치' : '서비스 중단·거절';
        await hideServiceWithNote(svc.id, `${why}: ${stripSupplierBrand(result.error)}`).catch(() => null);
      }
      continue;
    }
    continue;
  }

  if (hadNetworkError && !lastLinkError) {
    if (prov === 'peakerr') {
      const rec = await recoverPeakerrOrderAfterNetworkError(apiKey, baselineId, expectedPrimaryUsd, 50);
      if (rec?.apiOrderId) return { ok: true, apiOrderId: rec.apiOrderId, usedSvc: primary, recovered: true, provider: prov };
    }
    return { ok: true, uncertain: true, usedSvc: primary, apiOrderId: null, provider: prov };
  }
  return { ok: false, error: lastLinkError || lastError || '주문 접수 실패', linkError: !!lastLinkError, provider: prov };
}

// 🔗 URL 검증 (플랫폼·상품 유형별)
function peakerrStatusKo(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'partial') return '일부 완료 (미달분 환불)';
  if (s === 'completed') return '완료';
  if (s === 'canceled' || s === 'cancelled') return '취소';
  if (s === 'in progress' || s === 'processing') return '처리중';
  if (s === 'pending') return '대기';
  if (s === 'error' || s === 'failed') return '실패';
  return status || '—';
}

const FB_RESERVED_PATHS = new Set([
  'reel', 'watch', 'videos', 'video', 'photo', 'photos', 'posts', 'groups', 'people',
  'share', 'sharer', 'gaming', 'marketplace', 'events', 'notes', 'login', 'help',
  'privacy', 'policies', 'business', 'ads', 'l.php', 'story.php', 'permalink.php',
]);

/** facebook.com URL — page / post·reel·video / group */
function facebookPathKind(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'fb.watch') return 'video';
    const p = u.pathname.toLowerCase();
    if (/\/reel\//.test(p)) return 'reel';
    if (/\/watch\//.test(p) || /\/videos\//.test(p)) return 'video';
    if (/\/photo/.test(p) || /\/posts\//.test(p) || /story\.php/.test(p) || /permalink\.php/.test(p)) return 'post';
    if (/\/groups\//.test(p)) return 'group';
    if (/\/pages\//.test(p) || /profile\.php/.test(p)) return 'page';
    const m = p.match(/^\/([^/?#]+)\/?$/);
    if (m && !FB_RESERVED_PATHS.has(m[1])) return 'page';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 상품명 기준 필요 링크 종류 */
function facebookServiceLinkKind(svc) {
  const label = `${svc?.name || ''} ${svc?.description || ''}`;
  if (/멤버|member/i.test(label)) return 'group';
  if (/페이지/.test(label) && (/좋아요|팔로워|like|follow/i.test(label))) return 'page';
  if (/조회수|view|play|릴|reel/i.test(label)) return 'media';
  if (/댓글|comment/i.test(label)) return 'media';
  if (/좋아요|like/i.test(label)) return 'media';
  if (/팔로워|follow/i.test(label)) return 'page';
  return 'any';
}

function validateFacebookLink(svc, url) {
  const need = facebookServiceLinkKind(svc);
  if (need === 'any') return { ok: true };
  const kind = facebookPathKind(url);
  if (need === 'page') {
    if (['reel', 'video', 'post', 'group'].includes(kind)) {
      return {
        ok: false,
        error: '페이스북 페이지 상품은 페이지 URL이 필요합니다. (facebook.com/페이지이름) 릴·게시물 링크는 사용할 수 없습니다.',
      };
    }
    if (kind !== 'page') {
      return { ok: false, error: '페이스북 페이지 링크를 입력해주세요. (facebook.com/페이지이름 또는 pages/...)' };
    }
    return { ok: true };
  }
  if (need === 'group') {
    if (kind !== 'group') {
      return { ok: false, error: '페이스북 그룹 링크(groups/...)를 입력해주세요.' };
    }
    return { ok: true };
  }
  if (need === 'media') {
    if (kind === 'page') {
      return {
        ok: false,
        error: '게시물·릴·동영상 공유 링크를 입력해주세요. (reel / watch / videos / posts) 페이지 링크는 불가합니다.',
      };
    }
    if (!['reel', 'video', 'post'].includes(kind)) {
      return { ok: false, error: '페이스북 게시물·릴·동영상 공유 링크를 입력해주세요.' };
    }
    return { ok: true };
  }
  return { ok: true };
}

/** SMMKings 큐레이션 상품 — GLOW 판매 · 작업은 smmkings.com */
const SMMKINGS_CURATED_SEEDS = [
  {
    id: 'skg1', pl: 'instagram', api_id: '5165', rate: 25.50, min: 20, max: 10000, refill: 0,
    name: 'Instagram 팔로워 — 한국 HQ ⭐',
    description: '한국 타겟 Instagram HQ 팔로워입니다. 국내 마케팅·브랜드 신뢰도에 적합합니다. 프로필 링크 또는 사용자명을 입력하세요.'
  },
  {
    id: 'skg2', pl: 'instagram', api_id: '3770', rate: 97.50, min: 10, max: 35000, refill: 1,
    name: 'Instagram 팔로워 — 한국 리얼 (30일 보장)',
    description: '한국 리얼 계정 기반 Instagram 팔로워 (30일 자동 리필 표기). 국내 타겟 계정 성장에 사용하세요. 프로필 링크 또는 사용자명을 입력하세요.'
  },
  {
    id: 'skg3', pl: 'instagram', api_id: '2859', rate: 8.45, min: 50, max: 12000, refill: 0,
    name: 'Instagram 좋아요 — 한국 (노출 포함)',
    description: '한국 타겟 Instagram 좋아요+노출입니다. 게시물·릴스 URL을 입력하세요.'
  },
  {
    id: 'skg4', pl: 'instagram', api_id: '5226', rate: 0.03, min: 100, max: 1000000, refill: 0,
    name: 'Instagram 조회수 — 한국',
    description: '한국 타겟 Instagram 조회수입니다. 릴스·영상 게시물 URL을 입력하세요.'
  },
  {
    id: 'sky1', pl: 'youtube', api_id: '7303', rate: 5.76, min: 1000, max: 1000000, refill: 0,
    name: 'YouTube 조회수 — 한국 모바일',
    description: '한국 타겟 YouTube 모바일 조회수입니다. watch?v= 또는 youtu.be 영상 링크를 입력하세요.'
  },
  {
    id: 'sky2', pl: 'youtube', api_id: '2594', rate: 6.72, min: 500, max: 100000, refill: 0,
    name: 'YouTube 조회수 — 한국 Unique',
    description: '한국 Unique Viewer 기반 YouTube 조회수입니다. watch?v= 또는 youtu.be 영상 링크를 입력하세요.'
  },
  {
    id: 'skt1', pl: 'tiktok', api_id: '3693', rate: 4.13, min: 10, max: 1000000, refill: 1,
    name: 'TikTok 팔로워 — HQ (30일 보장)',
    description: '고품질 TikTok 팔로워 (30일 리필). 프로필 링크를 입력하세요.'
  },
  {
    id: 'skt2', pl: 'tiktok', api_id: '3734', rate: 0.38, min: 50, max: 200000, refill: 1,
    name: 'TikTok 좋아요 — HQ (30일 보장)',
    description: '고품질 TikTok 좋아요 (30일 리필). 영상 링크를 입력하세요.'
  },
];

async function ensureSmmkingsSeedServices() {
  let n = 0;
  for (const s of SMMKINGS_CURATED_SEEDS) {
    await query(`
      INSERT INTO services(id,name,pl,rate,min,max,description,api_id,active,refill_guaranteed,provider)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,'smmkings')
      ON CONFLICT(id) DO UPDATE SET
        name=EXCLUDED.name, pl=EXCLUDED.pl, rate=EXCLUDED.rate, min=EXCLUDED.min, max=EXCLUDED.max,
        description=EXCLUDED.description, api_id=EXCLUDED.api_id, active=1,
        refill_guaranteed=EXCLUDED.refill_guaranteed, provider='smmkings',
        inactive_note='', replace_service_id=NULL
    `, [s.id, s.name, s.pl, s.rate, s.min, s.max, s.description, s.api_id, s.refill ? 1 : 0]);
    await linkServiceToAllSites(s.id);
    n++;
  }
  await applyDisabledSeedMeta().catch(() => null);
  if (n > 0) console.log(`✅ SMMKings 큐레이션 상품 ${n}개 등록·갱신`);
  return n;
}

/** 공급 카탈로그에서 Facebook 조회수 시드(pfb10) 자동 등록 */
async function ensureFacebookViewsSeed() {
  if (peakerrCatalogCache.size === 0) return 0;
  const hasR = await query(`
    SELECT id FROM services WHERE pl='facebook' AND active=1
      AND (name LIKE '%조회%' OR description LIKE '%조회%')
    LIMIT 1
  `);
  if (hasR.rows.length) return 0;

  let best = null;
  let bestScore = -1;
  for (const s of peakerrCatalogCache.values()) {
    const full = `${s.name || ''} ${s.category || ''} ${s.type || ''}`;
    if (detectPlat(full) !== 'facebook') continue;
    if (BAD_SERVICE_NAME.test(full)) continue;
    const bucket = detectServiceTypeKo(full);
    if (!['조회수', '릴스 조회수'].includes(bucket)) continue;
    const score = scorePeakerrService(s) + (peakerrServiceHasRefill(s) ? 40 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  if (!best || bestScore < 50) return 0;

  const id = 'pfb10';
  const baseName = formatPeakerrServiceName(best.name, 'facebook');
  const displayName = /조회/.test(baseName)
    ? baseName
    : `Facebook 릴·동영상 조회수 — ${baseName.replace(/^Facebook\s*/i, '').slice(0, 72)}`;
  const desc = '페이스북 릴·동영상·게시물 조회수 서비스입니다. 릴(/reel/) 또는 동영상(/watch/, /videos/) 공유 링크를 입력해주세요. 페이지 링크는 사용할 수 없습니다.';
  const hasRefill = peakerrServiceHasRefill(best) ? 1 : 0;
  await query(`
    INSERT INTO services(id,name,pl,rate,min,max,description,api_id,active,refill_guaranteed)
    VALUES($1,$2,'facebook',$3,$4,$5,$6,$7,1,$8)
    ON CONFLICT(id) DO UPDATE SET
      name=EXCLUDED.name, rate=EXCLUDED.rate, min=EXCLUDED.min, max=EXCLUDED.max,
      description=EXCLUDED.description, api_id=EXCLUDED.api_id, active=1,
      refill_guaranteed=EXCLUDED.refill_guaranteed,
      inactive_note='', replace_service_id=NULL
  `, [
    id, displayName,
    parseFloat(best.rate || 0),
    Math.max(1, parseInt(best.min, 10) || 10),
    parseInt(best.max, 10) || 1000000,
    desc, String(best.service), hasRefill,
  ]);
  await linkServiceToAllSites(id);
  await syncServiceDescriptionFooters();
  console.log(`✅ Facebook 조회수 시드 등록: ${id} (api ${best.service})`);
  return 1;
}

function validateUrl(url, platform, svc = null) {
  if (!url || typeof url !== 'string') return { ok: false, error: 'URL을 입력해주세요' };
  try {
    const u = new URL(url);
    const domain = u.hostname.replace(/^www\./, '').toLowerCase();
    
    const validDomains = {
      youtube: ['youtube.com', 'youtu.be', 'm.youtube.com'],
      instagram: ['instagram.com', 'instagr.am'],
      tiktok: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com'],
      twitter: ['twitter.com', 'x.com'],
      facebook: ['facebook.com', 'fb.com', 'fb.watch', 'm.facebook.com'],
      telegram: ['t.me', 'telegram.me'],
      threads: ['threads.com', 'threads.net'],
      spotify: ['spotify.com', 'open.spotify.com'],
      twitch: ['twitch.tv'],
    };
    
    const expectedDomains = validDomains[platform];
    if (!expectedDomains) return { ok: true };
    
    const isValid = expectedDomains.some(d => domain === d || domain.endsWith('.' + d));
    if (!isValid) {
      return { ok: false, error: `잘못된 URL입니다. ${platform} 서비스는 ${expectedDomains[0]} 링크를 입력해주세요.` };
    }
    if (platform === 'tiktok' && svc) {
      const bucket = serviceOrderBucket(svc);
      const pathHost = u.pathname + u.hostname;
      if (bucket === '팔로워') {
        if (!/@/.test(u.pathname)) {
          return { ok: false, error: '틱톡 팔로워는 프로필 링크(@username)를 입력해주세요.' };
        }
        return { ok: true };
      }
      if (bucket === '스토리 조회수' || bucket === '스토리') {
        return { ok: true };
      }
      if (bucket === '조회수' && /\/photo\//.test(u.pathname)) {
        return { ok: false, error: '틱톡 조회수는 영상(/video/) 링크를 입력해주세요. 사진(/photo/) 링크는 조회수 작업이 불가합니다.' };
      }
      const isVideo = /\/video\/|\/t\/|vm\.tiktok|vt\.tiktok/.test(pathHost);
      const isPhotoLike = /\/photo\//.test(u.pathname);
      if (bucket === '좋아요' && isPhotoLike) {
        return { ok: true };
      }
      if (!isVideo && !isPhotoLike) {
        return { ok: false, error: '틱톡 영상·좋아요·조회수는 영상 공유 링크를 입력해주세요. (vm·vt 단축 URL 가능)' };
      }
    }
    if (platform === 'instagram' && svc && serviceOrderBucket(svc) === '팔로워') {
      if (/\/p\/|\/reel\/|\/tv\//.test(u.pathname)) {
        return { ok: false, error: '인스타 팔로워는 프로필 링크를 입력해주세요. (게시물 링크 불가)' };
      }
    }
    if (platform === 'youtube' && svc) {
      const bucket = serviceOrderBucket(svc);
      const path = u.pathname || '';
      const vid = u.searchParams.get('v') || '';
      const isYoutuBe = domain === 'youtu.be' && /^\/[A-Za-z0-9_-]{6,}/.test(path);
      const isShorts = /\/shorts\/[A-Za-z0-9_-]{6,}/.test(path);
      const isLive = /\/live\/[A-Za-z0-9_-]{6,}/.test(path);
      const isWatch = /\/watch/.test(path) && /^[A-Za-z0-9_-]{6,}$/.test(vid);
      const isChannel = /\/@|\/channel\/|\/c\/|\/user\//.test(path);
      if (bucket === '구독자') {
        if (!isChannel && !isYoutuBe) {
          // 채널 URL 권장 — @핸들 또는 channel
          if (!isChannel) {
            return { ok: false, error: '유튜브 구독자는 채널 링크를 입력해주세요. (예: youtube.com/@채널명)' };
          }
        }
      } else if (['조회수', '좋아요', '쇼츠 조회수', '쇼츠 좋아요', '댓글', '라이브 좋아요', '시청시간'].includes(bucket)) {
        if (!(isWatch || isYoutuBe || isShorts || isLive)) {
          return { ok: false, error: '유튜브 영상 링크를 입력해주세요. (예: youtube.com/watch?v=영상ID 또는 youtu.be/영상ID)' };
        }
      }
    }
    if (platform === 'facebook' && svc) {
      const fbCheck = validateFacebookLink(svc, url);
      if (!fbCheck.ok) return fbCheck;
    }
    return { ok: true };
  } catch(e) {
    return { ok: false, error: '올바른 URL 형식이 아닙니다 (예: https://...)' };
  }
}

/** 지인 사이트: 검증된 시드 상품 우선, 자동등록(pk_)은 동일 종류 시드가 있으면 숨김 */
function filterPartnerServiceRows(rows) {
  const curatedBuckets = new Set(
    rows.filter(s => isCuratedServiceId(s.id)).map(serviceBucketKey)
  );
  const refillBuckets = new Set(
    rows.filter(s => isCuratedServiceId(s.id) && parseInt(s.refill_guaranteed || 0, 10) === 1).map(serviceBucketKey)
  );
  const ENGAGEMENT = new Set(['팔로워', '좋아요']);
  const ENG_PL = new Set(['tiktok', 'threads']);
  return rows.filter(s => {
    if (isCuratedServiceId(s.id)) {
      const bucket = serviceBucketKey(s);
      if (ENG_PL.has(s.pl) && ENGAGEMENT.has(serviceOrderBucket(s))) {
        if (refillBuckets.has(bucket) && !parseInt(s.refill_guaranteed || 0, 10)) return false;
      }
      return true;
    }
    if (/^pk_|^api_|^svc_/.test(s.id)) return !curatedBuckets.has(serviceBucketKey(s));
    return true;
  });
}

function linkHintForService(svc) {
  const bucket = serviceOrderBucket(svc);
  if (svc.pl === 'tiktok') {
    if (bucket === '팔로워') return '틱톡 팔로워는 프로필(@username) 링크를 입력해주세요.';
    if (bucket === '스토리 조회수' || bucket === '스토리') return '틱톡 스토리 링크를 입력해주세요.';
    if (bucket === '조회수') return '틱톡 조회수는 영상(/video/) 공유 링크를 입력해주세요. 사진(/photo/) 링크는 불가합니다.';
    return '틱톡 영상·좋아요는 영상 공유 링크를 입력해주세요. (vm·vt 단축 URL 가능)';
  }
  if (svc.pl === 'instagram' && bucket === '팔로워') return '인스타 팔로워는 프로필 링크를 입력해주세요.';
  if (svc.pl === 'youtube' && bucket === '구독자') return '유튜브 구독자는 채널 링크를 입력해주세요.';
  if (svc.pl === 'threads') {
    if (bucket === '팔로워') return 'Threads 프로필 링크를 입력해주세요.';
    if (bucket === '좋아요' || bucket === '공유') return 'Threads 게시물 링크를 입력해주세요.';
  }
  if (svc.pl === 'facebook') {
    const need = facebookServiceLinkKind(svc);
    if (need === 'page') return '페이스북 페이지 URL을 입력해주세요. (facebook.com/페이지이름) 릴·게시물 링크 불가.';
    if (need === 'group') return '페이스북 그룹 링크(groups/...)를 입력해주세요.';
    if (need === 'media') return '페이스북 릴·동영상·게시물 공유 링크를 입력해주세요. (reel / watch / videos)';
  }
  return '링크 형식을 확인해주세요. 공유 → 링크 복사로 다시 시도해주세요.';
}

/** 상품 설명 하단 자동 안내 (고객 주문 화면 description에 표시) */
function stripAutoDescriptionFooters(desc) {
  const d = String(desc || '');
  const idx = d.indexOf('\n\n---\n');
  return (idx >= 0 ? d.slice(0, idx) : d).trim();
}

function buildServiceDescriptionFooters(svc) {
  const blocks = [];
  const bucket = serviceOrderBucket(svc);
  const hasRefill = parseInt(svc.refill_guaranteed || 0, 10) === 1;

  if (hasRefill) {
    blocks.push('【드롭보상】작업 완료 후 숫자가 줄어들면 본사에서 자동으로 보충 작업을 진행합니다. 플랫폼 정책에 따라 1~7일 안에 회복되며, 즉시 반영되지 않을 수 있습니다.');
  } else if (['팔로워', '좋아요', '조회수'].includes(bucket) && ['tiktok', 'threads', 'instagram'].includes(svc.pl)) {
    blocks.push('【안내】작업 후 며칠 뒤 숫자가 일시적으로 줄어들 수 있습니다. 「드롭 보상」표시 상품은 줄어든 만큼 자동 보충됩니다.');
  }

  const linkHint = linkHintForService(svc);
  if (linkHint && !linkHint.startsWith('링크 형식')) {
    blocks.push(`【링크안내】${linkHint}`);
  }

  if (!blocks.length) return '';
  return '\n\n---\n' + blocks.join('\n');
}

async function syncServiceDescriptionFooters() {
  const r = await query(`
    SELECT id, name, pl, description, refill_guaranteed FROM services WHERE active=1
  `);
  let n = 0;
  for (const row of r.rows) {
    const base = stripAutoDescriptionFooters(row.description);
    const footers = buildServiceDescriptionFooters(row);
    const next = base + footers;
    if (next !== (row.description || '')) {
      await query(`UPDATE services SET description=$1 WHERE id=$2`, [next, row.id]);
      n++;
    }
  }
  if (n > 0) console.log(`📝 상품 설명 안내 갱신: ${n}건`);
  return n;
}

// 🤖 텔레그램 알림 발송 (통합 함수)
async function sendTelegramToSuper(message) {
  try {
    const token = await getGlobalSetting('tg_token');
    const chat = await getGlobalSetting('tg_chat');
    if (!token || !chat) return false;
    const text = stripSupplierBrand(message);
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML' })
    });
    return true;
  } catch(e) { console.log('텔레그램 발송 실패:', e.message); return false; }
}

/** PerfectPanel USD 잔액 조회 */
async function fetchPanelBalance(provider, apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, error: 'API 키 미설정' };
  if (!isValidPanelApiKey(key)) return { ok: false, error: 'API 키 형식 오류 — 공급 API 키를 다시 저장하세요.' };

  const params = { key, action: 'balance' };
  let lastErr = '조회 실패';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await panelHttpsPost(provider, params, 35000);
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch {
        lastErr = '공급사 응답 오류';
        continue;
      }
      if (data?.error) {
        lastErr = peakerrBalanceErrorKo(data.error);
        break;
      }
      if (data?.balance !== undefined && data?.balance !== null && !isNaN(parseFloat(data.balance))) {
        return { ok: true, balance: parseFloat(data.balance) };
      }
      lastErr = '잔액 응답 없음';
    } catch (e) {
      lastErr = peakerrBalanceErrorKo(e.message || peakerrNetworkErrorKo(e));
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return { ok: false, error: lastErr };
}
async function fetchPeakerrBalance(apiKey) {
  return fetchPanelBalance('peakerr', apiKey);
}

// 💵 Peakerr 잔액 체크 (주문 시마다)
async function checkPeakerrBalance() {
  try {
    const apiKey = await getPeakerrApiKey();
    const result = await fetchPeakerrBalance(apiKey);
    if (!result.ok) return null;
    const balance = result.balance;
    
    // 잔액 $50 이하면 알림 (하루 최대 1번만)
    if (balance < 50) {
      const lastAlert = await getGlobalSetting('peakerr_low_balance_alert');
      const today = new Date().toDateString();
      if (lastAlert !== today) {
        await sendTelegramToSuper(`⚠️ <b>공급 API 잔액 부족</b>\n\n현재 잔액: <b>$${balance.toFixed(2)}</b>\n\n공급 API에서 충전해주세요.`);
        await setGlobalSetting('peakerr_low_balance_alert', today);
      }
    }
    return balance;
  } catch(e) { console.log('Peakerr 잔액 체크 실패:', e.message); return null; }
}

async function refreshUserSession(payload) {
  if (!payload?.userId) return null;
  const r = await query(`SELECT id, role, status FROM users WHERE id=$1`, [payload.userId]);
  const user = r.rows[0];
  if (!user || user.status === 'banned' || user.status === 'deleted') return null;
  return { userId: payload.userId, role: user.role, siteId: payload.siteId };
}

/** 관리자가 해당 회원을 다룰 수 있는지 (다른 사이트·탈퇴·슈퍼 차단) */
function adminUserManageDenied(req, user) {
  if (!user) return '회원을 찾을 수 없습니다';
  if (user.role === 'superadmin') return '처리할 수 없습니다';
  if (req.session.role !== 'superadmin' && user.site_id !== req.siteId) {
    return '다른 사이트 회원은 수정할 수 없습니다';
  }
  if (user.status === 'deleted') return '이미 탈퇴 처리된 회원입니다';
  return null;
}

async function requireAuth(req, res, next) {
  const token = getToken(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: '로그인 필요' });
  try {
    const session = await refreshUserSession(payload);
    if (!session) return res.status(401).json({ error: '로그인 필요' });
    req.session = session;
    attachPartnerAdminJsonMask(req, res);
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
async function requireAdmin(req, res, next) {
  const token = getToken(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: '로그인 필요' });
  try {
    const session = await refreshUserSession(payload);
    if (!session) return res.status(401).json({ error: '로그인 필요' });
    if (!['admin','partner','superadmin'].includes(session.role)) {
      return res.status(403).json({ error: '관리자 권한이 없습니다. 로그아웃 후 관리자 계정으로 다시 로그인해 주세요.' });
    }
    req.session = session;
    attachPartnerAdminJsonMask(req, res);
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
async function requireSuperAdmin(req, res, next) {
  const token = getToken(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: '로그인 필요' });
  try {
    const session = await refreshUserSession(payload);
    if (!session) return res.status(401).json({ error: '로그인 필요' });
    if (session.role !== 'superadmin') return res.status(403).json({ error: '접근 권한이 없습니다' });
    req.session = session;
    attachPartnerAdminJsonMask(req, res);
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/** 전원 — 금지어·외부 브랜드 표현 JSON 마스킹 (슈퍼 포함) */
function attachPartnerAdminJsonMask(req, res) {
  if (res._partnerJsonWrapped) return;
  res._partnerJsonWrapped = true;
  const role = req.session?.role;
  const orig = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object') {
      const scrub = (v) => {
        if (v == null) return v;
        if (typeof v !== 'string') return v;
        if (role === 'superadmin' || req.siteId === 'default') return stripSupplierBrand(v);
        return stripSupplierBrand(
          ['admin', 'partner'].includes(role) ? neutralAdminMsg(v, false) : v
        );
      };
      if (body.error) body.error = scrub(body.error);
      if (body.message) body.message = scrub(body.message);
      if (body.note) body.note = scrub(body.note);
      if (Array.isArray(body.services)) {
        body.services = body.services.map(s => {
          if (!s || typeof s !== 'object') return s;
          const o = { ...s };
          if (o.description) o.description = scrub(o.description);
          if (o.name) o.name = scrub(o.name);
          if (o.inactive_note) o.inactive_note = scrub(o.inactive_note);
          if (role !== 'superadmin') {
            delete o.provider;
            delete o.api_id;
            delete o.apiId;
          }
          return o;
        });
      }
    }
    return orig(body);
  };
}

// ═══════════════════════════════════════
// 🔄 Peakerr 자동 동기화 시스템
// ═══════════════════════════════════════

// PerfectPanel 주문 상태 조회
async function fetchPanelOrderStatus(provider, apiKey, apiOrderId) {
  try {
    const resp = await panelFetch(provider, { key: apiKey, action: 'status', order: apiOrderId });
    return await resp.json();
  } catch(e) { console.log(`${normalizeProvider(provider)} 상태 조회 실패:`, e.message); return null; }
}
async function fetchPeakerrOrderStatus(apiKey, apiOrderId) {
  return fetchPanelOrderStatus('peakerr', apiKey, apiOrderId);
}

function parsePeakerrStartCount(data) {
  if (!data || data.error) return 0;
  const raw = data.start_count ?? data.startCount ?? data.start ?? data.starts ?? 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Peakerr start_count + TikTok 등 실제 플랫폼 숫자 보조 (0으로 덮어쓰기 방지) */
async function scrapePlatformStartCount(order) {
  try {
    let pl = order.pl;
    let label = order.sname || '';
    if (order.sid) {
      const r = await query(`SELECT pl, name, description FROM services WHERE id=$1`, [order.sid]);
      if (r.rows[0]) {
        pl = pl || r.rows[0].pl;
        label = `${r.rows[0].name || ''} ${r.rows[0].description || ''}`;
      }
    }
    const bucket = detectServiceTypeKo(label);
    const isTikTokViews = (pl === 'tiktok' || order.pl === 'tiktok') &&
      (bucket === '조회수' || /조회수|view/i.test(label));
    if (isTikTokViews && order.link) {
      return await fetchTikTokPlayCount(order.link);
    }
  } catch (e) { console.log('플랫폼 시작 숫자 조회:', e.message); }
  return null;
}

async function fetchTikTokMediaFromTikwm(pageUrl) {
  try {
    const data = await new Promise((resolve, reject) => {
      const path = `/api/?url=${encodeURIComponent(pageUrl)}`;
      const req = https.request({
        hostname: 'www.tikwm.com',
        port: 443,
        path,
        method: 'GET',
        agent: peakerrHttpsAgent,
        family: 4,
        headers: { 'User-Agent': 'GLOW/1.0', Accept: 'application/json' },
        timeout: 25000
      }, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('ETIMEDOUT')); });
      req.end();
    });
    return data?.data || null;
  } catch (e) { console.log('TikTok tikwm:', e.message); }
  return null;
}

async function fetchTikTokPlayCountFromTikwm(pageUrl) {
  const media = await fetchTikTokMediaFromTikwm(pageUrl);
  if (!media) return null;
  const n = parseInt(media.play_count ?? media.view_count ?? 0, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function fetchTikTokUserFromTikwm(uniqueId) {
  const uid = String(uniqueId || '').replace(/^@/, '').trim();
  if (!uid) return null;
  try {
    const data = await new Promise((resolve, reject) => {
      const path = `/api/user/info?unique_id=${encodeURIComponent(uid)}`;
      const req = https.request({
        hostname: 'www.tikwm.com',
        port: 443,
        path,
        method: 'GET',
        agent: peakerrHttpsAgent,
        family: 4,
        headers: { 'User-Agent': 'GLOW/1.0', Accept: 'application/json' },
        timeout: 25000
      }, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('ETIMEDOUT')); });
      req.end();
    });
    return data?.data?.stats || data?.data || null;
  } catch (e) { console.log('TikTok user tikwm:', e.message); }
  return null;
}

function extractTikTokUsername(link) {
  const m = String(link || '').match(/tiktok\.com\/@([^/?#]+)/i);
  return m ? m[1] : null;
}

async function fetchTikTokFollowerCount(link) {
  const user = extractTikTokUsername(link);
  if (!user) return null;
  const stats = await fetchTikTokUserFromTikwm(user);
  if (!stats) return null;
  const n = parseInt(stats.followerCount ?? stats.follower_count ?? stats.fans ?? 0, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function fetchThreadsMetricFromHtml(url, patterns) {
  try {
    const resp = await fetch(url, {
      timeout: 18000,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    for (const re of patterns) {
      const m = html.match(re);
      if (m) {
        const n = parseInt(String(m[1]).replace(/,/g, ''), 10);
        if (Number.isFinite(n) && n >= 0) return n;
      }
    }
  } catch (e) { console.log('Threads HTML:', e.message); }
  return null;
}

async function fetchThreadsFollowerCount(link) {
  const normalized = normalizeOrderLink(link, 'threads');
  return fetchThreadsMetricFromHtml(normalized, [
    /"follower_count"\s*:\s*(\d+)/,
    /"followerCount"\s*:\s*(\d+)/,
    /followers?\\":\\"([\d,]+)/i
  ]);
}

async function fetchThreadsLikeCount(link) {
  const normalized = normalizeOrderLink(link, 'threads');
  return fetchThreadsMetricFromHtml(normalized, [
    /"like_count"\s*:\s*(\d+)/,
    /"likeCount"\s*:\s*(\d+)/,
    /likes?\\":\\"([\d,]+)/i
  ]);
}

function getOrderTargetCount(order) {
  const tc = parseInt(order.target_count || 0, 10);
  if (tc > 0) return tc;
  const start = parseInt(order.starts_count || 0, 10);
  const qty = parseInt(order.qty || 0, 10);
  return start + qty;
}

/** 완료 주문 — 현재 플랫폼 숫자 (드롭 감지용) */
async function measureOrderCurrentCount(order) {
  try {
    let pl = order.pl;
    let label = order.sname || '';
    if (order.sid) {
      const r = await query(`SELECT pl, name, description FROM services WHERE id=$1`, [order.sid]);
      if (r.rows[0]) {
        pl = pl || r.rows[0].pl;
        label = `${r.rows[0].name || ''} ${r.rows[0].description || ''}`;
      }
    }
    const bucket = detectServiceTypeKo(label);
    const link = order.link;
    if (!link) return null;

    if (pl === 'tiktok') {
      const norm = normalizeOrderLink(link, 'tiktok');
      if (bucket === '조회수' || /조회수|view/i.test(label)) {
        return await fetchTikTokPlayCount(link);
      }
      if (bucket === '좋아요' || /좋아요|like/i.test(label)) {
        const media = await fetchTikTokMediaFromTikwm(norm);
        const n = parseInt(media?.digg_count ?? media?.like_count ?? 0, 10);
        return Number.isFinite(n) && n >= 0 ? n : null;
      }
      if (bucket === '팔로워' || /팔로워|follower/i.test(label)) {
        return await fetchTikTokFollowerCount(link);
      }
    }
    if (pl === 'threads') {
      if (bucket === '팔로워' || /팔로워|follower/i.test(label)) {
        return await fetchThreadsFollowerCount(link);
      }
      if (bucket === '좋아요' || /좋아요|like/i.test(label)) {
        return await fetchThreadsLikeCount(link);
      }
    }
  } catch (e) { console.log('현재 숫자 조회:', e.message); }
  return null;
}

/** 목표 대비 실제 감소 여부 — 확인 불가 시 보충 안 함 */
async function detectOrderDrop(order) {
  const target = getOrderTargetCount(order);
  if (target <= 0) return { needsRefill: false, reason: 'no_target', target };
  const current = await measureOrderCurrentCount(order);
  if (current == null) return { needsRefill: false, reason: 'unmeasured', target };
  const drop = target - current;
  const minDrop = Math.max(3, Math.floor(target * 0.02));
  if (drop >= minDrop) {
    return { needsRefill: true, current, target, drop };
  }
  return { needsRefill: false, reason: 'no_drop', current, target, drop };
}

async function fetchTikTokPlayCount(url) {
  const normalized = normalizeOrderLink(url, 'tiktok');
  const candidates = [normalized];
  if (!normalized.includes('www.tiktok.com')) {
    candidates.push(normalized.replace('://tiktok.com', '://www.tiktok.com'));
  }
  for (const tryUrl of candidates) {
    const n = await fetchTikTokPlayCountFromTikwm(tryUrl);
    if (n != null && n >= 0) return n;
  }
  try {
    const resp = await fetch(normalized, {
      timeout: 18000,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const patterns = [
      /"playCount"\s*:\s*(\d+)/,
      /"viewCount"\s*:\s*(\d+)/,
      /"play_count"\s*:\s*(\d+)/,
      /playCount\\":(\d+)/,
      /"stats"\s*:\s*\{[^}]*"playCount"\s*:\s*(\d+)/
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n >= 0) return n;
      }
    }
  } catch (e) { console.log('TikTok HTML fetch:', e.message); }
  return null;
}

const START_COUNT_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

async function shouldAlertMissingStartCount(orderId) {
  const last = await getGlobalSetting(`start_alert_${orderId}`);
  if (!last) return true;
  const t = parseInt(last, 10);
  return !Number.isFinite(t) || Date.now() - t >= START_COUNT_ALERT_COOLDOWN_MS;
}

async function markStartCountAlerted(orderId) {
  await setGlobalSetting(`start_alert_${orderId}`, String(Date.now()));
}

async function clearStartCountAlert(orderId) {
  await query(`DELETE FROM global_settings WHERE key=$1`, [`start_alert_${orderId}`]).catch(() => null);
}

/** Peakerr/TikTok에서 시작 숫자 미수집 시 DB 직접 보정 */
async function backfillOrderStartCount(order) {
  if (!order?.id) return 0;
  const prev = parseInt(order.starts_count || 0, 10);
  if (prev > 0) return prev;
  const scraped = await scrapePlatformStartCount(order);
  if (scraped == null || scraped < 0) return 0;
  await query(
    `UPDATE orders SET starts_count=$1 WHERE id=$2 AND COALESCE(starts_count,0)=0`,
    [scraped, order.id]
  );
  await clearStartCountAlert(order.id);
  console.log(`✓ 시작 숫자 보정: ${order.id} → ${scraped}`);
  return scraped;
}

/** pending + Peakerr ID 확정 → 차감 후 processing (미확인 시 차감 금지) */
async function confirmPendingOrderPayment(order) {
  if (!order?.id || !order.api_order_id) return null;
  if (parseInt(order.paid || 0, 10) === 1) {
    if (order.status === 'pending') await query(`UPDATE orders SET status='processing' WHERE id=$1`, [order.id]);
    return order;
  }
  const userR = await query(`SELECT * FROM users WHERE id=$1`, [order.uid]);
  const user = userR.rows[0];
  if (!user) return null;
  const siteR = await query(`SELECT * FROM sites WHERE id=$1`, [order.site_id]);
  const site = siteR.rows[0];
  const adminCreditOnly = order.site_id && order.site_id !== 'default' &&
    ['admin', 'partner'].includes(user.role || '');
  const charge = parseFloat(order.charge || 0);
  const apiCost = parseFloat(order.api_cost || 0);
  if (!adminCreditOnly && charge > 0 && (user.balance || 0) < charge) {
    const shortfall = Math.ceil(charge - (user.balance || 0));
    const siteName = site?.name || 'GLOW';
    await tgAlert(
      `⚠️ <b>주문 결제 보류 (잔액 부족)</b>\n\n🏷 <b>${siteName}</b>\n📋 <code>${order.id}</code>\n✦ ${order.sname}\n\n잔액이 약 ₩${shortfall.toLocaleString()} 부족합니다. 충전 후 자동 확정됩니다.\n⏰ ${tgKstNow()}`,
      site
    ).catch(() => null);
    return null;
  }
  if (!adminCreditOnly && charge > 0) {
    const before = user.balance || 0;
    await query(`UPDATE users SET balance=balance-$1 WHERE id=$2`, [charge, order.uid]);
    const afterR = await query(`SELECT balance FROM users WHERE id=$1`, [order.uid]);
    await logBalance(order.site_id, order.uid, user.name, -charge, before, afterR.rows[0]?.balance || 0,
      `주문 확정 차감 - ${order.id}`, 'system');
  }
  if (order.site_id && order.site_id !== 'default' && apiCost > 0) {
    const margins = await getSiteMargins(site, user);
    const siteEx = parseFloat(site.exrate) > 0 ? parseFloat(site.exrate) : margins.ex;
    const orderCostKrw = parseFloat(order.cost || 0) > 0 ? parseFloat(order.cost) : apiCost * siteEx;
    const creditErr = await assertPartnerCreditForOrder(site, margins, orderCostKrw, { excludeOrderId: order.id });
    if (creditErr) {
      const siteName = site?.name || order.site_id || '사이트';
      await tgAlert(
        `⚠️ <b>크레딧 부족 — 주문 확정 보류</b>\n\n🏷 <b>${siteName}</b>\n📋 <code>${order.id}</code>\n✦ ${order.sname}\n\n${creditErr}\n\n크레딧 충전 후 자동 확정됩니다.\n⏰ ${tgKstNow()}`,
        site
      ).catch(() => null);
      return null;
    }
    await query(`UPDATE sites SET credit=GREATEST(0,credit-$1) WHERE id=$2`, [apiCost, order.site_id]);
  }
  await query(`UPDATE orders SET status='processing', paid=1 WHERE id=$1`, [order.id]);
  const fresh = (await query(`SELECT * FROM orders WHERE id=$1`, [order.id])).rows[0];
  await backfillOrderStartCount(fresh).catch(() => null);
  return fresh;
}

async function confirmAllPendingPayments() {
  const r = await query(`
    SELECT * FROM orders WHERE status='pending' AND COALESCE(paid,0)=0
    AND api_order_id IS NOT NULL AND api_order_id != ''
    ORDER BY created ASC LIMIT 20
  `);
  let n = 0;
  for (const o of r.rows) {
    const ok = await confirmPendingOrderPayment(o);
    if (ok) n++;
  }
  return n;
}

async function backfillAllMissingStartCounts() {
  const r = await query(`
    SELECT * FROM orders
    WHERE status IN ('pending','processing')
    AND COALESCE(starts_count,0)=0
    AND api_order_id IS NOT NULL AND api_order_id != ''
    AND created > NOW() - INTERVAL '30 days'
    ORDER BY created DESC LIMIT 25
  `);
  let fixed = 0;
  for (const o of r.rows) {
    if (await backfillOrderStartCount(o) > 0) fixed++;
  }
  return fixed;
}

async function alertMissingStartCounts() {
  await backfillAllMissingStartCounts();
  const r = await query(`
    SELECT id, sname, link, qty, uname, site_id, created
    FROM orders
    WHERE status='processing'
    AND COALESCE(starts_count,0)=0
    AND api_order_id IS NOT NULL AND api_order_id != ''
    AND created < NOW() - INTERVAL '12 minutes'
    AND created > NOW() - INTERVAL '3 days'
    ORDER BY created DESC LIMIT 8
  `);
  if (!r.rows.length) return 0;
  const toAlert = [];
  for (const o of r.rows) {
    if (await shouldAlertMissingStartCount(o.id)) toAlert.push(o);
  }
  if (!toAlert.length) return 0;
  let msg = `⚠️ <b>시작 숫자 미확인 ${toAlert.length}건</b>\n\n`;
  for (const o of toAlert) {
    const siteName = (await fetchSiteForTg(o.site_id)).name;
    msg += `🏷 <b>${siteName}</b> · 👤 ${o.uname || '—'}\n`;
    msg += `📋 <code>${o.id}</code> ${(o.sname || '').slice(0, 20)} ×${o.qty}\n`;
    if (o.link) msg += `🔗 ${String(o.link).slice(0, 50)}\n\n`;
  }
  msg += `\n🔄 주문 내역 새로고침 · 24시간 내 재알림 없음`;
  await sendTelegramToSuper(msg).catch(() => null);
  for (const o of toAlert) await markStartCountAlerted(o.id);
  return toAlert.length;
}

/** 공급 전량 전달(remains=0)인데 failed로 남은 주문 보정 */
async function repairDeliveredButFailedOrders() {
  const r = await query(`
    UPDATE orders SET status='completed'
    WHERE status='failed'
    AND remains=0 AND qty > 0
    AND api_order_id IS NOT NULL AND TRIM(api_order_id) <> ''
    RETURNING id
  `);
  return r.rowCount || 0;
}

async function cleanupUnpaidPendingOrders() {
  const r = await query(`
    SELECT * FROM orders
    WHERE status='pending' AND COALESCE(paid,0)=0
    AND (api_order_id IS NULL OR api_order_id='')
    AND created < NOW() - INTERVAL '2 hours'
    AND created > NOW() - INTERVAL '7 days'
    LIMIT 20
  `);
  for (const o of r.rows) {
    const recovered = await reconcileOrderMissingApiId(o);
    if (recovered) continue;
    await query(`UPDATE orders SET status='failed' WHERE id=$1`, [o.id]);
    console.log(`✓ 미결제 pending 정리: ${o.id}`);
  }
}

/** 🛡️ 서버 기동·주기 사전 점검 */
async function runPreflightHealthCheck(opts = {}) {
  const issues = [];
  try {
    const keyOk = await reconcilePeakerrApiKey({ silent: true }).catch(() => null);
    const apiKey = await getPeakerrApiKey();
    if (!apiKey) issues.push('❌ 공급 API 키 없음');
    else {
      const resp = await peakerrFetch({ key: apiKey, action: 'balance' }).catch(() => null);
      if (resp) {
        const data = await resp.json().catch(() => ({}));
        const bal = parseFloat(data.balance ?? data.balance_usd ?? 0);
        if (Number.isFinite(bal) && bal < 10) issues.push(`⚠️ 공급 API 잔액 $${bal.toFixed(2)}`);
      }
    }
    const orphan = await reconcileOrphanPeakerrOrders();
    const confirmed = await confirmAllPendingPayments();
    const backfilled = await backfillAllMissingStartCounts();
    await cleanupUnpaidPendingOrders();
    await refundStuckOrdersWithoutApiId();
    await refundZeroProgressStuckOrders({ hours: 12 }).catch(e => console.log('미진행 환불:', e.message));
    const repairedDelivered = await repairDeliveredButFailedOrders();
    await query(`UPDATE orders SET completed_at=created WHERE status='completed' AND completed_at IS NULL`).catch(() => null);
    console.log(`🛡️ 사전점검: orphan=${orphan} 결제확정=${confirmed} 시작숫자=${backfilled} 전달보정=${repairedDelivered}`);
    if (issues.length && opts.notify !== false) {
      await sendTelegramToSuper(`🛡️ <b>GLOW 사전점검</b>\n\n${issues.join('\n')}`).catch(() => null);
    }
    return { issues, orphan, confirmed, backfilled };
  } catch (e) {
    console.log('사전점검 오류:', e.message);
    return { issues: [e.message] };
  }
}

async function enrichPeakerrStartCount(order, peakerrData) {
  const peak = parsePeakerrStartCount(peakerrData);
  const prev = parseInt(order.starts_count || 0, 10);
  let start = peak > 0 ? peak : prev;
  if (start <= 0) {
    const scraped = await scrapePlatformStartCount(order);
    if (scraped != null && scraped >= 0) start = scraped;
  }
  return { ...peakerrData, start_count: start };
}

function parsePeakerrCancelResult(data, apiOrderId) {
  const id = String(apiOrderId);
  if (Array.isArray(data)) {
    const row = data.find(r => String(r.order) === id) || data[0];
    if (!row) return { ok: false, error: '취소 응답 없음' };
    const c = row.cancel;
    if (c === 1 || c === true) return { ok: true };
    if (typeof c === 'object' && c?.error) return { ok: false, error: String(c.error) };
    return { ok: false, error: '취소 불가' };
  }
  if (data?.error) return { ok: false, error: String(data.error) };
  return { ok: false, error: '취소 응답 형식 오류' };
}

async function submitPanelCancel(provider, apiKey, apiOrderId) {
  const resp = await panelFetch(provider, { key: apiKey, action: 'cancel', orders: String(apiOrderId) });
  const data = await resp.json();
  return parsePeakerrCancelResult(data, apiOrderId);
}
async function submitPeakerrCancel(apiKey, apiOrderId) {
  return submitPanelCancel('peakerr', apiKey, apiOrderId);
}

async function pollPanelStatus(provider, apiKey, apiOrderId, tries = 5, delayMs = 1500) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await fetchPanelOrderStatus(provider, apiKey, apiOrderId);
    if (!last || last.error) break;
    const s = (last.status || '').toLowerCase();
    if (['canceled', 'cancelled', 'partial', 'completed', 'error', 'failed'].includes(s)) return last;
    if (i < tries - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  return last;
}
async function pollPeakerrStatus(apiKey, apiOrderId, tries = 5, delayMs = 1500) {
  return pollPanelStatus('peakerr', apiKey, apiOrderId, tries, delayMs);
}

function peakerrCancelErrorKo(msg) {
  const m = String(msg || '');
  if (/progress|processing|started|cannot|can't|unable|not allow|already/i.test(m))
    return '이미 처리가 시작되어 취소할 수 없습니다.';
  return m ? `취소 실패: ${stripSupplierBrand(m)}` : '취소 요청이 거절되었습니다.';
}

async function pullPeakerrOrderSnapshot(order, apiKey, opts = {}) {
  if (!order?.api_order_id || !apiKey) return null;
  const prov = opts.provider || orderProvider(order);
  if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs));
  const pollTries = opts.startPollTries ?? 1;
  let peakerrData = null;
  let currentOrder = order;
  for (let i = 0; i < pollTries; i++) {
    peakerrData = await fetchPanelOrderStatus(prov, apiKey, currentOrder.api_order_id);
    if (!peakerrData || peakerrData.error) return null;
    const sc = parsePeakerrStartCount(peakerrData);
    const prev = parseInt(currentOrder.starts_count || 0, 10);
    if (sc > 0 || prev > 0 || i >= pollTries - 1) break;
    await new Promise(r => setTimeout(r, 2000));
    const freshR = await query(`SELECT * FROM orders WHERE id=$1`, [currentOrder.id]);
    currentOrder = freshR.rows[0] || currentOrder;
  }
  peakerrData = await enrichPeakerrStartCount(currentOrder, peakerrData);
  return autoRefundOrder(currentOrder, peakerrData);
}

async function findOrderForCancel(orderId, req) {
  const r = await query(`SELECT * FROM orders WHERE id=$1`, [orderId]);
  const order = r.rows[0];
  if (!order) return null;
  if (order.uid === req.session.userId) return order;
  const role = req.session?.role;
  if (['admin', 'partner', 'superadmin'].includes(role)) {
    if (role === 'superadmin' || order.site_id === req.siteId) return order;
  }
  return null;
}

/** Peakerr 취소 + GLOW 환불 (고객·관리자 공통) — Peakerr 취소 확인 전 환불 금지 */
async function cancelOrderWithPeakerr(order, opts = {}) {
  const adminId = opts.adminId || 'system';
  const lockKey = `cancel:${order.id}`;
  if (cancelOrderLocks.has(lockKey)) {
    return { ok: false, error: '취소 처리 중입니다. 잠시 후 다시 시도해주세요.' };
  }
  cancelOrderLocks.set(lockKey, Date.now());
  try {
    const done = ['completed', 'refunded', 'partial_refunded', 'cancelled', 'canceled'];
    if (done.includes(order.status)) {
      return { ok: false, error: '이미 완료·취소·환불된 주문입니다' };
    }

    if (!order.api_order_id) {
      if (!parseInt(order.paid || 0, 10)) {
        await query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [order.id]);
        await tgOrderNotify('🚫 <b>주문 취소</b>', order, { actorId: adminId, extra: '💰 차감 없음 (확인 중 취소)' });
        return { ok: true, message: '확인 중이던 주문이 취소됐습니다. (차감 없음)', refundPercent: 0, status: 'cancelled' };
      }
      const fin = await restoreRefundFinancials(order, 100, {
        reason: `주문 취소 (API 미전송) - ${order.id}`,
        adminId
      });
      if (fin.alreadyRefunded) {
        return { ok: true, message: '이미 취소·환불된 주문입니다.', status: order.status };
      }
      await query(`UPDATE orders SET status='refunded', cost=$1 WHERE id=$2`, [fin.newCost, order.id]);
      await tgOrderNotify('🚫 <b>주문 취소·환불</b>', order, {
        actorId: adminId,
        extra: `💰 환불 ₩${Math.round(fin.refundAmount || 0).toLocaleString()}`
      });
      return {
        ok: true, message: '주문이 취소되고 전액 환불되었습니다',
        refundPercent: 100, refundAmount: fin.refundAmount, creditRefund: fin.creditRefund, status: 'refunded'
      };
    }

    const prov = orderProvider(order);
    const apiKey = await getPanelApiKey(prov);
    if (!apiKey) return { ok: false, error: 'API 키 미설정' };

    const cancelResult = await submitPanelCancel(prov, apiKey, order.api_order_id);
    if (!cancelResult.ok) {
      return { ok: false, error: peakerrCancelErrorKo(cancelResult.error) };
    }

    const statusData = await pollPanelStatus(prov, apiKey, order.api_order_id, 10, 2000);
    if (!statusData || statusData.error) {
      return {
        ok: false,
        error: '취소 확인 실패. 1~2분 후 🔄 새로고침하면 자동 반영됩니다.',
        pendingCancel: true
      };
    }

    const apiStatus = (statusData.status || '').toLowerCase();
    if (['in progress', 'processing', 'pending'].includes(apiStatus)) {
      return {
        ok: false,
        error: '아직 작업 중입니다. 취소 반영 후 자동 환불됩니다. 잠시 후 🔄 새로고침해주세요.',
        pendingCancel: true
      };
    }
    if (apiStatus === 'completed') {
      return { ok: false, error: '이미 완료된 주문은 취소·환불할 수 없습니다.' };
    }

    const result = await autoRefundOrder(order, statusData, { notifyTg: false });
    const freshR = await query(`SELECT * FROM orders WHERE id=$1`, [order.id]);
    const fresh = freshR.rows[0] || order;

    const tgExtra = (pct, fin) => {
      let e = '';
      if (fin?.refundAmount) e += `💰 환불 ₩${Math.round(fin.refundAmount).toLocaleString()} (${pct}%)`;
      if (fin?.creditRefund) e += `\n💳 크레딧 $${fin.creditRefund.toFixed(4)} 복구`;
      return e;
    };

    if (result?.refundPercent > 0) {
      const pct = result.refundPercent;
      await tgOrderNotify('🚫 <b>주문 취소</b>', fresh, {
        actorId: adminId,
        extra: tgExtra(pct, result)
      });
      return {
        ok: true,
        message: pct >= 100 ? '취소 완료. 전액 환불되었습니다.' : `취소 완료. ${pct}% 환불되었습니다.`,
        refundPercent: pct,
        refundAmount: result.refundAmount,
        creditRefund: result.creditRefund,
        status: fresh.status,
        apiStatus: statusData.status
      };
    }

    if (['refunded', 'partial_refunded', 'cancelled', 'canceled'].includes(fresh.status)) {
      await tgOrderNotify('🚫 <b>주문 취소</b>', fresh, { actorId: adminId });
      return { ok: true, message: '취소·환불이 완료되었습니다.', status: fresh.status };
    }

    return {
      ok: false,
      error: '취소는 접수됐지만 환불 조건을 확인하지 못했습니다. 🔄 새로고침 후 다시 확인해주세요.',
      pendingCancel: true
    };
  } finally {
    cancelOrderLocks.delete(lockKey);
  }
}

// 💸 주문 자동 환불 처리 (Peakerr 기반)
async function autoRefundOrder(order, peakerrData, opts = {}) {
  try {
    // Peakerr 상태 확인
    const status = (peakerrData.status || '').toLowerCase();
    const remains = parseInt(peakerrData.remains ?? peakerrData.remains_count ?? 0, 10);
    const peakStart = parsePeakerrStartCount(peakerrData);
    const prevStart = parseInt(order.starts_count || 0, 10);
    const startsCount = peakStart > 0 ? peakStart : prevStart;
    
    let refundPercent = 0;
    let newStatus = order.status;
    
    if (status === 'completed') {
      newStatus = 'completed';
    } else if (status === 'canceled' || status === 'cancelled') {
      refundPercent = 100;
      newStatus = 'cancelled';
    } else if (status === 'partial') {
      if (remains > 0 && order.qty > 0) {
        refundPercent = Math.round((remains / order.qty) * 100);
        newStatus = refundPercent >= 100 ? 'refunded' : 'partial_refunded';
      }
    } else if (status === 'in progress' || status === 'processing' || status === 'pending') {
      newStatus = 'processing';
    } else if (status === 'error' || status === 'failed') {
      // 공급사가 failed 표시해도 remains=0이면 실제 전량 전달된 경우가 많음
      if (remains === 0 && order.qty > 0) {
        newStatus = 'completed';
      } else {
        refundPercent = 100;
        newStatus = 'refunded';
      }
    }
    
    const targetCount = startsCount + parseInt(order.qty || 0, 10);
    const justCompleted = newStatus === 'completed' && order.status !== 'completed';

    // 진행률 저장 (starts_count, remains)
    if (justCompleted) {
      await query(`UPDATE orders SET status=$1, starts_count=$2, remains=$3, target_count=$4, completed_at=NOW() WHERE id=$5`,
        [newStatus, startsCount, remains, targetCount, order.id]);
    } else {
      await query(`UPDATE orders SET status=$1, starts_count=$2, remains=$3 WHERE id=$4`,
        [newStatus, startsCount, remains, order.id]);
    }
    if (startsCount > 0) await clearStartCountAlert(order.id);
    
    // 🎁 완료 시 포인트 적립
    if (justCompleted) {
      await earnPoints({ ...order, status: 'processing' }); // status를 completed 이전으로 전달
    }
    
    // 환불 처리 (이미 환불된 주문 중복 방지)
    let fin = null;
    if (refundPercent > 0 && !['refunded', 'partial_refunded', 'cancelled', 'canceled'].includes(order.status)) {
      fin = await restoreRefundFinancials(order, refundPercent, {
        reason: `자동 환불 (공급 ${status}) - 주문 ${order.id}`,
        adminId: 'system'
      });
      if (!fin.alreadyRefunded) {
        await query(`UPDATE orders SET cost=$1 WHERE id=$2`, [fin.newCost, order.id]);
        await logActivity(
          order.site_id, 'system', '자동환불',
          `자동 환불 (${refundPercent}%)`, 'order', order.id,
          `공급 ${status} → ₩${(fin.refundAmount || 0).toLocaleString()} 환불` +
            (fin.creditRefund ? ` · 크레딧 $${fin.creditRefund.toFixed(4)} 복구` : '')
        );
        if (opts.notifyTg !== false) {
          let extra = `💰 환불 ₩${(fin.refundAmount || 0).toLocaleString()} (${refundPercent}%)`;
          if (fin.creditRefund) extra += `\n💳 크레딧 $${fin.creditRefund.toFixed(4)} 복구`;
          extra += `\n📡 상태: ${peakerrStatusKo(peakerrData.status || status)}`;
          await tgOrderNotify('💸 <b>자동 환불</b>', order, { actorId: 'system', extra });
        }
      }
    }

    if (newStatus === 'completed' && order.status !== 'completed' && opts.notifyTg !== false) {
      await tgOrderNotify('✅ <b>작업 완료</b>', { ...order, starts_count: startsCount, status: 'completed' }, { actorId: 'system' });
    }
    
    return {
      status: newStatus, refundPercent,
      refundAmount: fin?.refundAmount || 0,
      creditRefund: fin?.creditRefund || 0
    };
  } catch(e) { console.log('자동 환불 실패:', e.message); return null; }
}

/** 포인트 → 잔액 전환 가능 여부 (일반 회원은 충전 승인 1회 이상 필요) */
async function userCanUsePoints(uid, siteId, role) {
  if (['admin', 'partner', 'superadmin'].includes(role)) return true;
  const r = await query(
    `SELECT 1 FROM charges WHERE uid=$1 AND site_id=$2 AND status='approved' LIMIT 1`,
    [uid, siteId]
  );
  return r.rows.length > 0;
}

// 🎁 포인트 적립 (주문 완료 시 결제금액의 1%)
async function earnPoints(order) {
  try {
    if (order.status === 'completed' || order.points_earned > 0) return;
    const points = Math.floor(order.charge / 100); // 1% 포인트
    if (points <= 0) return;
    await query(`UPDATE users SET points=COALESCE(points,0)+$1 WHERE id=$2`, [points, order.uid]);
    await query(`UPDATE orders SET points_earned=$1 WHERE id=$2`, [points, order.id]);
  } catch(e) { console.log('포인트 적립 실패:', e.message); }
}

// 🔄 공급사 ↔ GLOW 주문 상태 동기화 (공통)
async function syncOrdersWithPeakerr(orders, _apiKeyIgnored, opts = {}) {
  if (!orders?.length) return { synced: 0, cancelled: 0, completed: 0, errors: 0 };
  let synced = 0, cancelled = 0, completed = 0, errors = 0;
  const delay = opts.delayMs ?? 80;
  for (const order of orders) {
    let o = order;
    const prov = orderProvider(o);
    const apiKey = await getPanelApiKey(prov);
    if (!apiKey) { errors++; continue; }
    if (!o.api_order_id) {
      if (prov !== 'peakerr') { errors++; continue; }
      const recovered = await reconcileOrderMissingApiId(o);
      if (recovered) {
        await query(`UPDATE orders SET api_order_id=$1 WHERE id=$2`, [recovered, o.id]);
        o = (await query(`SELECT * FROM orders WHERE id=$1`, [o.id])).rows[0];
      } else { errors++; continue; }
    }
    const result = await pullPeakerrOrderSnapshot(o, apiKey, { startPollTries: 3, provider: prov });
    if (result) {
      synced++;
      if (result.status === 'completed') completed++;
      if (result.refundPercent > 0 || result.status === 'cancelled' || result.status === 'canceled') cancelled++;
    } else errors++;
    const freshR = await query(`SELECT * FROM orders WHERE id=$1`, [o.id]);
    const fresh = freshR.rows[0];
    if (fresh && parseInt(fresh.starts_count || 0, 10) <= 0) {
      await backfillOrderStartCount(fresh);
    }
    if (delay) await new Promise(r => setTimeout(r, delay));
  }
  return { synced, cancelled, completed, errors };
}

async function syncActiveOrdersForUser(userId) {
  const r = await query(`
    SELECT * FROM orders WHERE uid=$1
    AND status IN ('pending','processing')
    AND created > NOW() - INTERVAL '30 days'
    ORDER BY created DESC LIMIT 15
  `, [userId]);
  return syncOrdersWithPeakerr(r.rows);
}

async function syncActiveOrdersForSite(siteId) {
  const r = siteId
    ? await query(`SELECT * FROM orders WHERE site_id=$1 AND status IN ('pending','processing') AND created > NOW() - INTERVAL '30 days' ORDER BY created DESC LIMIT 40`, [siteId])
    : await query(`SELECT * FROM orders WHERE status IN ('pending','processing') AND created > NOW() - INTERVAL '30 days' ORDER BY created DESC LIMIT 40`);
  return syncOrdersWithPeakerr(r.rows);
}

// 🔄 진행중인 모든 주문 상태 동기화
async function syncAllOrderStatuses() {
  try {
    await reconcileOrphanPeakerrOrders();
    await confirmAllPendingPayments();
    await refundStuckOrdersWithoutApiId();
    await refundZeroProgressStuckOrders({ hours: 12 }).catch(e => console.log('미진행 환불:', e.message));
    await cleanupUnpaidPendingOrders();
    await backfillAllMissingStartCounts();

    const r = await query(`
      SELECT * FROM orders 
      WHERE api_order_id IS NOT NULL 
      AND api_order_id != ''
      AND status IN ('pending','processing')
      AND created > NOW() - INTERVAL '30 days'
      ORDER BY created DESC
      LIMIT 100
    `);
    
    if (r.rows.length === 0) return;
    console.log(`🔄 주문 상태 동기화 시작: ${r.rows.length}건`);
    
    const { synced, cancelled, completed, errors } = await syncOrdersWithPeakerr(r.rows, null, { delayMs: 100 });
    await backfillAllMissingStartCounts();
    await refundZeroProgressStuckOrders({ hours: 12 }).catch(() => null);
    console.log(`✅ 동기화 완료: 완료 ${completed}건, 취소·환불 ${cancelled}건, 오류 ${errors}건`);
    
    if (cancelled > 0) {
      await sendTelegramToSuper(`🔄 <b>주문 자동 동기화</b>\n\n완료: ${completed}건\n취소·환불: ${cancelled}건\n오류: ${errors}건`);
    }
  } catch(e) { console.log('주문 동기화 실패:', e.message); }
}

// 🔄 Peakerr 서비스 자동 동기화 (삭제된/변경된 서비스 체크)
async function syncPeakerrServices() {
  try {
    const apiKey = await getPeakerrApiKey();
    if (!apiKey) return { skipped: true };
    
    // Peakerr 전체 서비스 목록 가져오기
    const resp = await peakerrFetch({ key: apiKey, action: 'services' });
    const services = await resp.json();
    if (!Array.isArray(services)) return;
    
    const peakerrMap = new Map();
    services.forEach(s => peakerrMap.set(String(s.service), s));
    peakerrCatalogCache = peakerrMap;
    await syncServiceRefillFlagsFromPeakerr(peakerrMap);
    
    // GLOW DB의 Peakerr 서비스만 (SMMKings SKU와 api_id 충돌 방지)
    const glowR = await query(`
      SELECT id, name, api_id, rate, min, max, active FROM services
      WHERE api_id IS NOT NULL AND api_id != ''
        AND COALESCE(provider,'peakerr')='peakerr'
    `);
    
    let disabled = 0, priceChanged = 0, checked = 0;
    const priceChangedList = [];
    
    for (const glowSvc of glowR.rows) {
      const peakerrSvc = peakerrMap.get(glowSvc.api_id);
      checked++;
      
      if (!peakerrSvc) {
        // Peakerr에서 삭제됨 → 비활성화
        if (glowSvc.active === 1) {
          await hideServiceWithNote(glowSvc.id, '카탈로그에서 삭제·중단됨');
          disabled++;
          console.log(`  ⚠️ 비활성화: ${glowSvc.name}`);
        }
      } else {
        const newRate = parseFloat(peakerrSvc.rate);
        const oldRate = parseFloat(glowSvc.rate);
        const pMin = Math.max(1, parseInt(peakerrSvc.min, 10) || glowSvc.min || 1);
        const pMax = parseInt(peakerrSvc.max, 10) || glowSvc.max || 10000000;
        await query(`UPDATE services SET min=$1, max=$2 WHERE id=$3`, [pMin, pMax, glowSvc.id]);
        if (oldRate > 0 && Math.abs(newRate - oldRate) / oldRate > 0.2) {
          priceChangedList.push({
            name: glowSvc.name,
            old: oldRate,
            new: newRate,
            change: ((newRate - oldRate) / oldRate * 100).toFixed(1)
          });
        }
        if (oldRate > 0 && Math.abs(newRate - oldRate) / oldRate > 0.05) {
          await query(`UPDATE services SET rate=$1 WHERE id=$2`, [newRate, glowSvc.id]);
          priceChanged++;
        }
      }
    }
    
    console.log(`✅ 서비스 동기화: 체크 ${checked}개, 비활성화 ${disabled}개, 가격변경 ${priceChanged}개`);

    // ⚠️ Peakerr 전송에 실패해 멈춰있는 주문 자동 환불
    //    (api_order_id 없이 pending 상태로 남은 주문 = 돈은 빠졌는데 작업 안 된 건)
    let stuckRefunded = 0;
    try {
      const stuckR = await query(`
        SELECT * FROM orders
        WHERE status='pending' AND COALESCE(paid,0)=1
        AND (api_order_id IS NULL OR api_order_id='')
      `);
      for (const o of stuckR.rows) {
        const uR = await query(`SELECT * FROM users WHERE id=$1`, [o.uid]);
        const u = uR.rows[0];
        if (u) {
          const before = u.balance || 0;
          await query(`UPDATE users SET balance=balance+$1 WHERE id=$2`, [o.charge, o.uid]);
          await logBalance(o.site_id, o.uid, u.name, o.charge, before, before + o.charge,
            `미처리 주문 자동 환불 - ${o.sname}`, 'system');
        }
        // 지인 크레딧 복구
        if (o.site_id && o.site_id !== 'default') {
          const svcR = await query(`SELECT rate FROM services WHERE id=$1`, [o.sid]);
          if (svcR.rows[0]) {
            const superMgStr = await getGlobalSetting('super_margin');
            const superMg = parseFloat(superMgStr || '50');
            const globalSiteMgStr = await getGlobalSetting('global_site_margin');
            const globalSiteMg = parseFloat(globalSiteMgStr || '50');
            const creditRefund = svcR.rows[0].rate / 1000 * o.qty * (1 + superMg/100) * (1 + globalSiteMg/100);
            await query(`UPDATE sites SET credit=credit+$1 WHERE id=$2`, [creditRefund, o.site_id]);
          }
        }
        await query(`UPDATE orders SET status='failed' WHERE id=$1`, [o.id]);
        stuckRefunded++;
      }
    } catch(e) { console.log('미처리 주문 환불 실패:', e.message); }
    if (stuckRefunded > 0) console.log(`💸 미처리 주문 ${stuckRefunded}건 자동 환불`);
    
    // 슈퍼관리자 알림 (변경사항 있을 때만)
    if (disabled > 0 || priceChanged > 0 || stuckRefunded > 0) {
      let msg = `🔄 <b>서비스 자동 동기화</b>\n\n`;
      if (disabled > 0) msg += `⚠️ 비활성화: ${disabled}개 (목록에서 삭제·중단)\n`;
      if (stuckRefunded > 0) msg += `💸 미처리 주문 자동 환불: ${stuckRefunded}건\n`;
      if (priceChanged > 0) {
        msg += `💰 가격 업데이트: ${priceChanged}개\n`;
        priceChangedList
          .sort((a, b) => Math.abs(parseFloat(b.change)) - Math.abs(parseFloat(a.change)))
          .slice(0, 5)
          .forEach(p => {
            const pct = parseFloat(p.change);
            const pctLabel = Math.abs(pct) >= 500 ? (pct > 0 ? '대폭 인상' : '대폭 인하') : `${p.change}%`;
            msg += `  • ${p.name.substring(0, 30)}: $${p.old} → $${p.new} (${pctLabel})\n`;
          });
        if (priceChanged > 5) msg += `  … 외 ${priceChanged - 5}개\n`;
      }
      await sendTelegramToSuper(msg);
    }

    await query(`
      UPDATE site_services ss SET active=0
      FROM services s WHERE ss.service_id = s.id AND s.active=0 AND ss.active=1
    `);
    await repairAllPartnerSiteServices();
    await ensureFacebookViewsSeed().catch(() => null);
    await pruneServiceCatalog({ maxPerPlatform: 28, notify: false }).catch(e => console.log('상품 정리:', e.message));
    return { disabled, priceChanged, stuckRefunded, checked };
  } catch(e) { console.log('서비스 동기화 실패:', e.message); return { error: e.message }; }
}

/** 공급사 기준 작동 상품만 남기고 중복·미연동·반복실패 상품 숨김 */
async function reconcileServiceCatalog(opts = {}) {
  const notify = opts.notify !== false;
  let noApi = 0, failHide = 0;
  try {
    const noApiR = await query(`
      SELECT id FROM services
      WHERE active=1 AND (api_id IS NULL OR TRIM(api_id) = '')
    `);
    for (const row of noApiR.rows) {
      await hideServiceWithNote(row.id, '연동 코드 없음 — 판매 불가');
    }
    noApi = noApiR.rowCount || 0;

    const sync = await syncPeakerrServices();
    await syncSmmkingsCatalog().catch(e => console.log('SMMKings 동기화:', e.message));
    await ensureSmmkingsSeedServices().catch(e => console.log('SMMKings 시드:', e.message));
    await pruneServiceCatalog({ maxPerPlatform: 28, notify: false }).catch(() => null);
    await reactivateCuratedSeedServices();
    await upgradeEngagementSeedsFromPeakerr();
    await ensureFacebookViewsSeed().catch(() => null);
    const purged = await purgeUnsellableServices();
    await backfillPartnerOrderCosts();

    failHide = await deactivateUnreliableServices();

    await applyDisabledSeedMeta();

    await syncServiceDescriptionFooters();

    await query(`
      UPDATE site_services ss SET active=0
      FROM services s WHERE ss.service_id = s.id AND s.active=0 AND ss.active=1
    `);
    await repairAllPartnerSiteServices();

    const activeR = await query(`SELECT COUNT(*)::int AS c FROM services WHERE active=1`);
    const activeCount = activeR.rows[0]?.c || 0;
    console.log(`✅ 카탈로그 정리: 활성 ${activeCount}개 (미연동 ${noApi}, 반복실패 ${failHide})`);

    if (notify && (noApi || failHide || sync?.disabled > 0)) {
      let msg = `🧹 <b>상품 카탈로그 정리</b>\n\n`;
      if (sync?.disabled) msg += `⚠️ 삭제·중단: ${sync.disabled}개 숨김\n`;
      if (noApi) msg += `🔗 API 미연동: ${noApi}개 숨김\n`;
      if (failHide) msg += `❌ 최근 주문 전부 실패·취소: ${failHide}개 숨김\n`;
      msg += `\n✅ 활성 상품 ${activeCount}개 (작동 가능만 노출)`;
      await sendTelegramToSuper(msg);
    }

    return { ok: true, noApi, failHide, sync, activeCount, purged };
  } catch (e) {
    console.log('카탈로그 정리 실패:', e.message);
    return { error: e.message };
  }
}

/** Peakerr 상품 품질 점수 (높을수록 HQ·Real·한국·리필 등) */
function scorePeakerrService(s) {
  const name = (s.name || '').toLowerCase();
  const cat = (s.category || '').toLowerCase();
  const full = `${name} ${cat}`;
  if (cat.includes('testing')) return -1;
  if (/\bbot\b|\bfake\b|cheat|adult|porn|gambling|casino/.test(full)) return -1;

  let score = 0;
  if (/\bhq\b|high quality|premium/.test(full)) score += 100;
  if (/\breal\b|organic/.test(full)) score += 80;
  if (/non[- ]?drop|no drop/.test(full)) score += 60;
  if (/lifetime|guarantee/.test(full)) score += 50;
  if (s.refill || /refill/.test(full)) score += 30;
  if (/instant|fast|speed|🔥/.test(full)) score += 25;
  if (/monetiz|korea|korean|\bkr\b|한국|south korea/.test(full)) score += 50;
  if (/vietnam|vietnamese|việt\s*nam|viet\s*nam|\bvn\b|베트남/.test(full)) score += 45;
  if (/instagram|youtube|tiktok|threads|pinterest/.test(full)) score += 20;
  if (/follow|subscriber|view|like|comment|share|watch hour|reel|story/.test(full)) score += 15;
  const pl = detectPlat(full);
  if (['youtube', 'instagram', 'tiktok'].includes(pl)) score += 30;
  return score;
}

async function linkServiceToAllSites(serviceId) {
  const sitesR = await query(`SELECT id FROM sites`);
  for (const st of sitesR.rows) {
    await query(`
      INSERT INTO site_services(site_id, service_id, active) VALUES($1,$2,1)
      ON CONFLICT(site_id, service_id) DO UPDATE SET active=1
    `, [st.id, serviceId]);
  }
}

const PL_DISPLAY_KO = {
  youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok',
  threads: 'Threads', twitter: 'X', facebook: 'Facebook',
  telegram: 'Telegram', spotify: 'Spotify', twitch: 'Twitch',
  pinterest: 'Pinterest', naver: '네이버', kakao: '카카오',
  coupang: '쿠팡', amazon: 'Amazon', ecommerce: '이커머스',
  traffic: '웹 트래픽', appstore: '앱스토어', other: 'SNS'
};

function detectServiceTypeKo(full) {
  const raw = full || '';
  const n = raw.toLowerCase();
  // 한글 상품명 (GLOW 시드·한글화 catalog)
  if (/조회수/.test(raw)) {
    if (/쇼츠|shorts/i.test(raw)) return '쇼츠 조회수';
    if (/스토리|story/i.test(raw)) return '스토리 조회수';
    if (/릴스|reel/i.test(raw)) return '릴스 조회수';
    return '조회수';
  }
  if (/좋아요/.test(raw)) {
    if (/쇼츠|shorts/i.test(raw)) return '쇼츠 좋아요';
    if (/라이브|live/i.test(raw)) return '라이브 좋아요';
    if (/릴스|reel/i.test(raw)) return '릴스 좋아요';
    return '좋아요';
  }
  if (/팔로워/.test(raw)) return '팔로워';
  if (/구독자/.test(raw)) return '구독자';
  if (/댓글/.test(raw)) return '댓글';
  if (/공유/.test(raw)) return '공유';
  if (/저장/.test(raw)) return '저장';
  if (/시청시간/.test(raw)) return '시청시간';
  if (/스토리/.test(raw)) return '스토리';
  if (/노출|임프레션/.test(raw)) return '노출';
  if (/watch\s*time|watchtime|watch hour|4000 hour/.test(n)) return '시청시간';
  if (/shorts/.test(n)) return /like/.test(n) ? '쇼츠 좋아요' : '쇼츠 조회수';
  if (/\blive\b/.test(n) && /like/.test(n)) return '라이브 좋아요';
  if (/reel/.test(n)) return /like/.test(n) ? '릴스 좋아요' : /view|play/.test(n) ? '릴스 조회수' : '릴스';
  if (/story/.test(n)) return /view/.test(n) ? '스토리 조회수' : '스토리';
  if (/comment/.test(n)) return '댓글';
  if (/share|repost|reshare|re-?post/.test(n)) return '공유';
  if (/\bsaves?\b|bookmark/.test(n)) return '저장';
  if (/impression|reach|\bexpose/.test(n)) return '노출';
  if (/member|group member/.test(n)) return '멤버';
  if (/subscriber|subscription|\bsubs?\b/.test(n)) return '구독자';
  // Like가 상품명에 있으면 카테고리 Followers보다 우선 (예: "Twitter Arab Like" + category Followers)
  if (/\blikes?\b/.test(n) && !/\bfollowers?\b/.test(n.split('|')[0] || n)) return '좋아요';
  if (/\blikes?\b/.test(n) && /arab like|korea like|brazil like|usa like|turkish like|india like/i.test(n)) return '좋아요';
  if (/likes?\s*\+\s*views?|views?\s*\+\s*likes?/i.test(n)) return '좋아요'; // 복합 — 조회수용으로도 사용
  if (/follower|\bfollow\b/.test(n)) return '팔로워';
  if (/like/.test(n)) return '좋아요';
  if (/review|rating|\bstars?\b|\[\d+\s*star\]|google map|gmb\b|maps custom/.test(n)) return '리뷰';
  if (/\bviews?\b|\bplay\b|\bwatch\b/.test(n)) return '조회수';
  if (/seo|search|organic|keyword/.test(n)) return '검색 유입';
  if (/profile visit|profile view/.test(n)) return '프로필 방문';
  if (/stream|listen|play count|monthly listener/.test(n)) return '재생';
  return '서비스';
}

function extractQualityTagsKo(full) {
  const n = (full || '').toLowerCase();
  const tags = [];
  if (/korea|korean|\bkr\b|south korea|한국/.test(n)) tags.push('한국');
  else if (/vietnam|vietnamese|việt\s*nam|viet\s*nam|\bvn\b|베트남/.test(n)) tags.push('베트남');
  else if (/global|world|worldwide|geo/.test(n)) tags.push('글로벌');
  if (/\bhq\b|high quality|high-quality/.test(n)) tags.push('HQ');
  if (/\breal\b|organic|native|active/.test(n)) tags.push('리얼');
  if (/premium|mq\b|server/.test(n)) tags.push('프리미엄');
  if (/lifetime|life time/.test(n)) tags.push('평생 보장');
  if (/refill|♻/.test(n)) tags.push('드롭 보상');
  else if (/non[- ]?drop|non drop|almost non drop|no drop/.test(n)) tags.push('논드롭');
  if (/instant|instant start|0-5\s*min/.test(n)) tags.push('즉시');
  if (/\bslow\b/.test(n)) tags.push('슬로우');
  if (/fast|super fast|speed|100k\/d|50k\/d/.test(n)) tags.push('고속');
  if (/30\s*day/.test(n)) tags.push('30일 보장');
  if (/365/.test(n)) tags.push('365일 보장');
  return [...new Set(tags)];
}

/** Peakerr 영문 상품명 → GLOW 한글 상품명 (큐레이션 스타일) */
function formatPeakerrServiceName(name, pl, prefixLabel) {
  const n = (name || '').trim();
  if (!n) return `${PL_DISPLAY_KO[pl] || 'SNS'} 서비스 — 프리미엄`;
  if (/[\uAC00-\uD7AF]/.test(n)) return n.substring(0, 120);

  const plLabel = prefixLabel || PL_DISPLAY_KO[pl] || pl;
  const typeKo = detectServiceTypeKo(n);
  const tags = extractQualityTagsKo(n);

  let mid = '프리미엄';
  if (tags.includes('한국')) mid = '한국';
  else if (tags.includes('베트남')) mid = '베트남';
  else if (tags.includes('글로벌')) mid = '글로벌';
  else if (tags.includes('HQ')) mid = 'HQ';
  else if (tags.includes('리얼')) mid = '리얼';

  const extras = tags.filter(t => !['한국', '글로벌', 'HQ', '리얼', '프리미엄'].includes(t));
  let title = `${plLabel} ${typeKo} — ${mid}`;
  if (extras.length) title += ` (${extras.slice(0, 3).join(' · ')})`;
  return title.substring(0, 120);
}

function formatPeakerrServiceDescription(name, pl, fallback) {
  if (fallback && /[\uAC00-\uD7AF]/.test(fallback) && (fallback || '').length > 50) return fallback;
  const plKo = {
    youtube: '유튜브', instagram: '인스타그램', tiktok: '틱톡', threads: '스레드',
    twitter: 'X(트위터)', facebook: '페이스북', telegram: '텔레그램', traffic: '웹사이트',
    naver: '네이버', kakao: '카카오', amazon: 'Amazon', coupang: '쿠팡'
  }[pl] || 'SNS';
  const typeKo = detectServiceTypeKo(name || '');
  const tags = extractQualityTagsKo(name || '');
  const target = tags.includes('한국') ? '한국 타겟 ' : tags.includes('베트남') ? '베트남 타겟 ' : tags.includes('글로벌') ? '글로벌 ' : '';
  let desc = `${target}${plKo} ${typeKo} 고품질 서비스입니다.`;
  if (tags.includes('드롭 보상') || tags.includes('평생 보장')) desc += ' 드롭 발생 시 보상·리필이 제공됩니다.';
  else if (tags.includes('논드롭')) desc += ' 안정적인 논드롭 처리로 장기 유지에 유리합니다.';
  if (tags.includes('즉시')) desc += ' 주문 후 즉시 시작됩니다.';
  if (tags.includes('고속')) desc += ' 고속 처리로 빠른 성장이 가능합니다.';
  return desc.substring(0, 500);
}

/** 잘못 한글화된 상품명 수정 (Reviews→조회수 오인, 트래픽 탭 Google Maps 리뷰 등) */
async function repairMislabeledServiceNames() {
  const r = await query(`SELECT id, name, pl, description FROM services WHERE active=1`);
  let count = 0;
  for (const row of r.rows) {
    const full = `${row.name} ${row.description || ''}`;
    const src = (row.description && /[a-zA-Z]/.test(row.description)) ? row.description : row.name;
    let newName = null, newPl = null;
    if (/google map|gmb\b|maps custom|custom review|\[\d+\s*star\]/i.test(full)) {
      newPl = 'other';
      newName = formatPeakerrServiceName(src, 'other');
    } else if (/웹 트래픽 조회수/.test(row.name) && /review|rating|\[\d+\s*star\]/i.test(full)) {
      newPl = row.pl === 'traffic' ? 'other' : row.pl;
      newName = formatPeakerrServiceName(src, newPl);
    }
    if (newName && (newName !== row.name || (newPl && newPl !== row.pl))) {
      await query(`UPDATE services SET name=$1, pl=COALESCE($2, pl) WHERE id=$3`, [newName.substring(0, 120), newPl, row.id]);
      count++;
    }
  }
  return { count };
}

/** API 자동등록(pk_/api_) 영문 상품명 일괄 한글화 — GLOW·no9story 등 전 사이트 공통 DB */
async function repairEnglishServiceNames() {
  const r = await query(`
    SELECT id, name, pl, description FROM services
    WHERE (api_id IS NOT NULL AND api_id != '')
       OR id LIKE 'pk_%' OR id LIKE 'api_%'
  `);
  let count = 0;
  for (const row of r.rows) {
    const nameNeedsFix = !/[\uAC00-\uD7AF]/.test(row.name || '');
    const descNeedsFix = !/[\uAC00-\uD7AF]/.test(row.description || '');
    if (!nameNeedsFix && !descNeedsFix) continue;
    const newName = nameNeedsFix
      ? formatPeakerrServiceName(row.name, row.pl)
      : row.name;
    const newDesc = descNeedsFix
      ? formatPeakerrServiceDescription(row.name, row.pl, row.description)
      : row.description;
    if (newName !== row.name || newDesc !== row.description) {
      await query(`UPDATE services SET name=$1, description=$2 WHERE id=$3`, [newName, newDesc, row.id]);
      count++;
    }
  }
  return { count };
}

/** 상품명 한글화 후 지인 사이트 site_services까지 동기화 */
async function localizeAllSitesServiceNames() {
  const localized = await repairEnglishServiceNames();
  await repairAllPartnerSiteServices();
  return localized;
}

/** Peakerr에서 HQ·Real 등 핫상품만 골라 DB에 추가 (기존 상품은 유지) */
async function importHotPeakerrServices(opts = {}) {
  const maxPerPlatform = opts.maxPerPlatform ?? 3;
  const minScore = opts.minScore ?? 120;
  const dryRun = !!opts.dryRun;

  const apiKey = await getPeakerrApiKey();
  if (!apiKey) return { error: 'API 키가 설정되지 않았습니다', added: [], count: 0 };

  const resp = await peakerrFetch({ key: apiKey, action: 'services' });
  const services = await resp.json();
  if (!Array.isArray(services)) return { error: '공급 API 응답 오류', added: [], count: 0 };

  const existingR = await query(`SELECT api_id FROM services WHERE api_id IS NOT NULL AND api_id != ''`);
  const existing = new Set(existingR.rows.map(r => String(r.api_id)));

  const priorityPls = ['youtube', 'instagram', 'tiktok', 'threads', 'twitter', 'facebook', 'telegram'];
  const byPl = {};
  for (const s of services) {
    if (existing.has(String(s.service))) continue;
    const score = scorePeakerrService(s);
    if (score < minScore) continue;
    const pl = detectPlat(`${s.name || ''} ${s.category || ''}`);
    const bucket = priorityPls.includes(pl) ? pl : null;
    if (!bucket) continue;
    if (!byPl[bucket]) byPl[bucket] = [];
    byPl[bucket].push({ ...s, qs: score, pl });
  }

  const toAdd = [];
  for (const pl of priorityPls) {
    const list = (byPl[pl] || []).sort((a, b) => b.qs - a.qs);
    toAdd.push(...list.slice(0, maxPerPlatform));
  }

  const added = [];
  if (!dryRun) {
    for (const s of toAdd) {
      const id = `pk_${s.service}`;
      const displayName = formatPeakerrServiceName(s.name, s.pl);
      const desc = formatPeakerrServiceDescription(s.name, s.pl, s.type || s.category || '');
      await query(`
        INSERT INTO services(id,name,pl,rate,min,max,description,api_id,active)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,1)
        ON CONFLICT(id) DO UPDATE SET
          name=EXCLUDED.name, pl=EXCLUDED.pl, rate=EXCLUDED.rate,
          min=EXCLUDED.min, max=EXCLUDED.max, description=EXCLUDED.description,
          api_id=EXCLUDED.api_id, active=1
      `, [
        id, displayName, s.pl,
        parseFloat(s.rate || 0), parseInt(s.min || 100), parseInt(s.max || 1000000),
        desc, String(s.service)
      ]);
      await linkServiceToAllSites(id);
      added.push({ id, name: displayName, pl: s.pl, rate: s.rate, score: s.qs, apiId: s.service });
    }
    if (added.length) {
      await repairAllPartnerSiteServices();
      await pruneServiceCatalog({ maxPerPlatform: 28, notify: false }).catch(() => {});
    }
    await repairEnglishServiceNames();
  }

  return { ok: true, added, count: added.length, candidates: toAdd.length };
}

const BAD_SERVICE_NAME = /\bbot\b|\bfake\b|cheat|adult|porn|gambling|casino|testing/i;

const NICHE_PLATFORMS = ['amazon', 'coupang', 'ecommerce', 'naver', 'kakao'];

const BONUS_SERVICE_PATTERNS = [
  { re: /linkedin/i, pl: 'other', bucket: 'linkedin' },
  { re: /pinterest/i, pl: 'pinterest', bucket: 'pinterest' },
  { re: /snapchat/i, pl: 'other', bucket: 'snapchat' },
  { re: /discord/i, pl: 'other', bucket: 'discord' },
  { re: /reddit/i, pl: 'other', bucket: 'reddit' },
  { re: /soundcloud/i, pl: 'other', bucket: 'soundcloud' },
  { re: /google my business|google map|gmb |google review/i, pl: 'traffic', bucket: 'google' },
  { re: /quora/i, pl: 'other', bucket: 'quora' },
  { re: /clubhouse/i, pl: 'other', bucket: 'clubhouse' },
  { re: /vimeo/i, pl: 'other', bucket: 'vimeo' },
  { re: /bluesky/i, pl: 'other', bucket: 'bluesky' },
];

function classifyBonusService(full) {
  for (const p of BONUS_SERVICE_PATTERNS) {
    if (p.re.test(full)) return p;
  }
  return null;
}

function formatNicheServiceName(name, pl) {
  return formatPeakerrServiceName(name, pl);
}

function nicheServiceDescription(name, pl, type) {
  const base = {
    amazon: '아마zon 셀러·상품 마케팅 서비스입니다. 상품 URL을 입력해 주세요.',
    coupang: '쿠팡 상품·스토어 마케팅 서비스입니다. 상품 링크를 입력해 주세요.',
    ecommerce: '쇼피·라자다·알리·이베이 등 이커머스 상품 마케팅 서비스입니다.',
    naver: '네이버 스마트스토어·플레이스·블로그 마케팅 서비스입니다.',
    kakao: '카카오 채널·스토어 마케팅 서비스입니다.',
  };
  const d = base[pl] || `${name} — 프리미엄 마케팅 서비스`;
  return type ? `${d} (${type})` : d;
}

const DOMESTIC_PLATFORM_RULES = [
  { test: /naver|smartstore|스마트스토어|네이버|naver blog|blog neighbor|서로이웃|naver place|플레이스|naver cafe|naver kin|place review|blog view|blog visit/i, pl: 'naver', bucket: 'dom_naver', label: '네이버' },
  { test: /kakao|카카오|kakaotalk|ch channel|kakao channel|카톡|kakao talk/i, pl: 'kakao', bucket: 'dom_kakao', label: '카카오' },
  { test: /coupang|쿠팡/i, pl: 'coupang', bucket: 'dom_coupang', label: '쿠팡' },
  { test: /tistory|티스토리|brunch|브런치|band\.naver|naver band|네이버밴드|밴드/i, pl: 'naver', bucket: 'dom_naver_blog', label: '네이버블로그' },
];

function qualifiesDomesticPlatformImport(s) {
  const full = `${s.name || ''} ${s.category || ''} ${s.type || ''}`;
  if (BAD_SERVICE_NAME.test(full)) return null;
  for (const rule of DOMESTIC_PLATFORM_RULES) {
    if (!rule.test.test(full)) continue;
    const score = scorePeakerrService(s);
    if (score < 0) return null;
    const low = full.toLowerCase();
    const useful = /\bhq\b|real|premium|refill|review|follow|like|view|visit|neighbor|scrap|save|member|subscriber|rank|traffic|comment|share|place|store|channel|blog/.test(low)
      || score >= 80;
    if (!useful) continue;
    return { pl: rule.pl, bucket: rule.bucket, qs: score + 250, label: rule.label };
  }
  return null;
}

function qualifiesForNicheImport(s) {
  const domestic = qualifiesDomesticPlatformImport(s);
  if (domestic) return domestic;

  const full = `${s.name || ''} ${s.category || ''} ${s.type || ''}`;
  if (BAD_SERVICE_NAME.test(full)) return null;
  const badScore = scorePeakerrService(s);
  if (badScore < 0) return null;

  const pl = detectPlat(full);
  if (NICHE_PLATFORMS.includes(pl)) {
    return { pl, bucket: pl, qs: badScore + 200 };
  }

  const bonus = classifyBonusService(full);
  if (bonus) {
    const low = full.toLowerCase();
    const useful = badScore >= 50 || /\bhq\b|\breal\b|review|follow|like|subscriber|member|view|rank|install|rating/.test(low);
    if (useful) return { pl: bonus.pl, bucket: bonus.bucket, qs: badScore + 80 };
  }
  return null;
}

/** Peakerr에서 아마zon·쿠팡·네이버 등 + 보너스(LinkedIn 등) — 실제 있을 때만 추가 */
async function importNichePeakerrServices(opts = {}) {
  const maxNiche = opts.maxNichePerPlatform ?? 5;
  const maxDomestic = opts.maxDomesticPerBucket ?? 8;
  const maxBonus = opts.maxBonusPerBucket ?? 3;
  const dryRun = !!opts.dryRun;
  const notify = opts.notify !== false;

  const apiKey = await getPeakerrApiKey();
  if (!apiKey) return { error: 'API 키가 설정되지 않았습니다', added: [], count: 0, scanned: 0 };

  const resp = await peakerrFetch({ key: apiKey, action: 'services' });
  const services = await resp.json();
  if (!Array.isArray(services)) return { error: '공급 API 응답 오류', added: [], count: 0, scanned: 0 };

  const existingR = await query(`SELECT api_id FROM services WHERE api_id IS NOT NULL AND api_id != ''`);
  const existing = new Set(existingR.rows.map(r => String(r.api_id)));

  const byBucket = {};
  let scanned = 0;
  for (const s of services) {
    if (existing.has(String(s.service))) continue;
    const hit = qualifiesForNicheImport(s);
    if (!hit) continue;
    scanned++;
    if (!byBucket[hit.bucket]) byBucket[hit.bucket] = [];
    byBucket[hit.bucket].push({ ...s, ...hit });
  }

  const toAdd = [];
  const domesticBuckets = ['dom_naver', 'dom_kakao', 'dom_coupang', 'dom_naver_blog'];
  for (const bucket of domesticBuckets) {
    const list = (byBucket[bucket] || []).sort((a, b) => b.qs - a.qs);
    toAdd.push(...list.slice(0, maxDomestic));
  }
  for (const pl of NICHE_PLATFORMS) {
    const list = (byBucket[pl] || []).sort((a, b) => b.qs - a.qs);
    toAdd.push(...list.slice(0, maxNiche));
  }
  for (const bucket of Object.keys(byBucket)) {
    if (NICHE_PLATFORMS.includes(bucket) || domesticBuckets.includes(bucket)) continue;
    const list = byBucket[bucket].sort((a, b) => b.qs - a.qs);
    toAdd.push(...list.slice(0, maxBonus));
  }

  const added = [];
  if (!dryRun) {
    for (const s of toAdd) {
      const id = `pk_${s.service}`;
      const displayName = s.label
        ? formatPeakerrServiceName(s.name, s.pl, s.label)
        : formatPeakerrServiceName(s.name, s.pl);
      const desc = nicheServiceDescription(s.name, s.pl, s.type || s.category || '');
      await query(`
        INSERT INTO services(id,name,pl,rate,min,max,description,api_id,active)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,1)
        ON CONFLICT(id) DO UPDATE SET
          name=EXCLUDED.name, pl=EXCLUDED.pl, rate=EXCLUDED.rate,
          min=EXCLUDED.min, max=EXCLUDED.max, description=EXCLUDED.description,
          api_id=EXCLUDED.api_id, active=1
      `, [
        id, displayName, s.pl,
        parseFloat(s.rate || 0), parseInt(s.min || 100), parseInt(s.max || 1000000),
        desc, String(s.service)
      ]);
      await linkServiceToAllSites(id);
      added.push({ id, name: displayName, pl: s.pl, rate: s.rate, bucket: s.bucket, apiId: s.service });
    }
    if (added.length) {
      await repairAllPartnerSiteServices();
      await pruneServiceCatalog({ maxPerPlatform: 30, notify: false }).catch(() => {});
    }
    await repairEnglishServiceNames();
  }

  if (notify && added.length && !dryRun) {
    let msg = `🛒 <b>이커머스·보너스 상품 추가</b>\n\n`;
    added.forEach((s, i) => {
      msg += `${i + 1}. [${s.pl}] ${(s.name || '').substring(0, 45)}\n   💰 $${s.rate}/1K\n`;
    });
    msg += `\n총 ${added.length}개 · 전체 사이트 연결`;
    await sendTelegramToSuper(msg);
  }

  return { ok: true, added, count: added.length, scanned, candidates: toAdd.length };
}

const KR_IMPORT_PLATFORMS = ['youtube', 'instagram', 'tiktok', 'threads', 'twitter', 'facebook', 'telegram', 'naver', 'kakao'];

function isKoreanMarketService(full) {
  return /korea|korean|\bkr\b|south korea|한국|\bkr[\s-]target\b|\bkr[\s-]only\b/i.test(full);
}

function hasImportQualitySignal(full, score) {
  const low = full.toLowerCase();
  return /\bhq\b|high quality|\breal\b|premium|non[- ]?drop|refill|lifetime|organic|instant|guarantee|🔥/.test(low)
    || score >= 130;
}

function qualifiesKoreanImport(s) {
  const full = `${s.name || ''} ${s.category || ''} ${s.type || ''}`;
  if (BAD_SERVICE_NAME.test(full)) return null;
  if (!isKoreanMarketService(full)) return null;
  const score = scorePeakerrService(s);
  if (score < 0 || !hasImportQualitySignal(full, score)) return null;
  const pl = detectPlat(full);
  if (!KR_IMPORT_PLATFORMS.includes(pl)) return null;
  return { pl, bucket: `kr_${pl}`, qs: score + 120 };
}

function qualifiesPinterestImport(s) {
  const full = `${s.name || ''} ${s.category || ''} ${s.type || ''}`;
  if (BAD_SERVICE_NAME.test(full)) return null;
  if (!/pinterest/i.test(full)) return null;
  const score = scorePeakerrService(s);
  if (score < 0) return null;
  const low = full.toLowerCase();
  const useful = /\bhq\b|real|premium|non drop|refill|organic|follow|follower|pin|save|repin|board|like|view|impression/.test(low);
  if (!useful) return null;
  if (score < 70 && !/\bhq\b|\breal\b|premium|refill/.test(low)) return null;
  return { pl: 'pinterest', bucket: 'pinterest', qs: score + 90 };
}

function formatKoreanImportName(name, pl) {
  const n = (name || '').trim();
  if (/[\uAC00-\uD7AF]/.test(n)) return n.substring(0, 120);
  return formatPeakerrServiceName(n, pl);
}

function koreanImportDescription(pl, type) {
  const base = {
    youtube: '한국 타겟 유튜브 — 조회·구독·좋아요 등 국내 노출에 유리한 고품질 상품입니다.',
    instagram: '한국 타겟 인스타 — 팔로워·좋아요·릴스 등 국내 탐색 노출에 최적화된 상품입니다.',
    tiktok: '한국 타겟 틱톡 — 포유·팔로워·좋아요 등 국내 바이럴용 고품질 상품입니다.',
    threads: '한국 타겟 스레드 — 팔로워·좋아요 등 국내 참여 강화용 상품입니다.',
    twitter: '한국 타겟 X(트위터) — 팔로워·좋아요·조회 등 국내 도달 확대용입니다.',
    facebook: '한국 타겟 페이스북 — 페이지·좋아요·팔로워 등 국내 마케팅용입니다.',
    telegram: '한국 타겟 텔레그램 — 멤버·반응 등 채널 성장용 고품질 상품입니다.',
    naver: '네이버·한국 타겟 — 스마트스토어·플레이스·블로그 등 국내 검색·쇼핑 연동용입니다.',
    kakao: '카카오·한국 타겟 — 채널·스토어 등 국내 메신저 마케팅용입니다.',
  };
  const d = base[pl] || '한국 타겟 고품질 마케팅 상품입니다.';
  return type ? `${d} (${type})` : d;
}

async function insertPeakerrImport(s, displayName, pl, description) {
  const id = `pk_${s.service}`;
  await query(`
    INSERT INTO services(id,name,pl,rate,min,max,description,api_id,active)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,1)
    ON CONFLICT(id) DO UPDATE SET
      name=EXCLUDED.name, pl=EXCLUDED.pl, rate=EXCLUDED.rate,
      min=EXCLUDED.min, max=EXCLUDED.max, description=EXCLUDED.description,
      api_id=EXCLUDED.api_id, active=1
  `, [
    id, displayName, pl,
    parseFloat(s.rate || 0), parseInt(s.min || 100), parseInt(s.max || 1000000),
    description, String(s.service)
  ]);
  await linkServiceToAllSites(id);
  return { id, name: displayName, pl, rate: s.rate, apiId: s.service };
}

/** Peakerr — 한국 타겟 HQ·Real + Pinterest 고품질만 (있을 때만 추가) */
async function importKoreanAndPinterestServices(opts = {}) {
  // Peakerr 한국 타겟 실측 불량(외국인 유입) — 한국 자동 수입 중단, 핀터레스트만
  const maxKrPerPlatform = 0;
  const maxPinterest = opts.maxPinterest ?? 5;
  const dryRun = !!opts.dryRun;
  const notify = opts.notify !== false;

  const apiKey = await getPeakerrApiKey();
  if (!apiKey) return { error: 'API 키가 설정되지 않았습니다', added: [], count: 0, korean: 0, pinterest: 0 };

  const resp = await peakerrFetch({ key: apiKey, action: 'services' });
  const services = await resp.json();
  if (!Array.isArray(services)) return { error: '공급 API 응답 오류', added: [], count: 0, korean: 0, pinterest: 0 };

  const existingR = await query(`SELECT api_id FROM services WHERE api_id IS NOT NULL AND api_id != ''`);
  const existing = new Set(existingR.rows.map(r => String(r.api_id)));

  const byBucket = {};
  for (const s of services) {
    if (existing.has(String(s.service))) continue;
    const kr = qualifiesKoreanImport(s);
    const pin = qualifiesPinterestImport(s);
    const hit = kr || pin;
    if (!hit) continue;
    if (!byBucket[hit.bucket]) byBucket[hit.bucket] = [];
    byBucket[hit.bucket].push({ ...s, ...hit, isKr: !!kr });
  }

  const toAdd = [];
  for (const pl of KR_IMPORT_PLATFORMS) {
    const list = (byBucket[`kr_${pl}`] || []).sort((a, b) => b.qs - a.qs);
    toAdd.push(...list.slice(0, maxKrPerPlatform));
  }
  const pinList = (byBucket.pinterest || []).sort((a, b) => b.qs - a.qs);
  toAdd.push(...pinList.slice(0, maxPinterest));

  const added = [];
  if (!dryRun) {
    for (const s of toAdd) {
      let displayName, desc;
      if (s.isKr) {
        displayName = formatKoreanImportName(s.name, s.pl);
        desc = koreanImportDescription(s.pl, s.type || s.category || '');
      } else {
        displayName = /[\uAC00-\uD7AF]/.test(s.name || '') ? s.name : `Pinterest — ${(s.name || '').substring(0, 90)}`;
        desc = `핀터레스트 고품질 — 팔로워·핀·저장·보드 등 노출·트래픽 강화용입니다.${s.type ? ' (' + s.type + ')' : ''}`;
      }
      const row = await insertPeakerrImport(s, displayName.substring(0, 120), s.pl, desc);
      added.push({ ...row, bucket: s.bucket, isKr: s.isKr });
    }
    if (added.length) {
      await repairAllPartnerSiteServices();
      await pruneServiceCatalog({ maxPerPlatform: 32, notify: false }).catch(() => {});
    }
    await repairEnglishServiceNames();
  }

  const korean = added.filter(a => a.isKr).length;
  const pinterest = added.filter(a => !a.isKr).length;

  if (notify && added.length && !dryRun) {
    let msg = `🇰🇷 <b>한국·Pinterest 상품 추가</b>\n\n`;
    msg += `한국 ${korean}개 · Pinterest ${pinterest}개\n\n`;
    added.slice(0, 8).forEach((s, i) => {
      msg += `${i + 1}. [${s.pl}] ${(s.name || '').substring(0, 42)}\n`;
    });
    if (added.length > 8) msg += `…외 ${added.length - 8}개\n`;
    msg += `\n전체 사이트 연결 완료`;
    await sendTelegramToSuper(msg);
  }

  return { ok: true, added, count: added.length, korean, pinterest, candidates: toAdd.length };
}

const VN_IMPORT_PLATFORMS = ['instagram', 'tiktok'];

function isVietnamMarketService(full) {
  return /vietnam|vietnamese|việt\s*nam|viet\s*nam|\bvn\b|베트남|vietnam\s+only|from vietnam|geo.*\bvn\b|target.*\bvn\b|\bvn[\s-]target|\bvn[\s-]only|country.*vietnam/i.test(full);
}

function qualifiesVietnamImport(s) {
  const full = `${s.name || ''} ${s.category || ''} ${s.type || ''}`;
  if (BAD_SERVICE_NAME.test(full)) return null;
  if (!isVietnamMarketService(full)) return null;
  if (isKoreanMarketService(full)) return null;
  const low = full.toLowerCase();
  const usefulType = /follow|like|view|comment|share|reel|story|subscriber|save|member|impression|live/.test(low);
  if (!usefulType) return null;
  const score = scorePeakerrService(s);
  if (score < 0) return null;
  if (!hasImportQualitySignal(full, score) && score < 70) return null;
  const pl = detectPlat(full);
  if (!VN_IMPORT_PLATFORMS.includes(pl)) return null;
  return { pl, bucket: `vn_${pl}`, qs: score + 130 };
}

function formatVietnamImportName(name, pl) {
  const typeKo = detectServiceTypeKo(name || '');
  const plLabel = PL_DISPLAY_KO[pl] || pl;
  const tags = extractQualityTagsKo(name || '');
  let suffix = '베트남 타겟';
  const extras = [];
  if (tags.includes('드롭 보상')) extras.push('드롭 보상');
  if (tags.includes('평생 보장')) extras.push('평생 보장');
  if (tags.includes('리얼')) extras.push('리얼');
  if (tags.includes('HQ')) extras.push('HQ');
  if (extras.length) suffix += ` (${extras.slice(0, 2).join(' · ')})`;
  return `${plLabel} ${typeKo} — ${suffix}`.substring(0, 120);
}

function vietnamImportDescription(pl, type) {
  const market = '베트남은 동남아 핵심 디지털·이커머스 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다.';
  const base = {
    instagram: `베트남 기반 고품질 Instagram 서비스입니다. ${market} 팔로워·좋아요·릴스 등 현지 탐색 노출과 브랜드 신뢰도 향상에 유리합니다.`,
    tiktok: `베트남 기반 고품질 TikTok 서비스입니다. ${market} 포유 탭·팔로워·좋아요 등 현지 바이럴 성장에 최적화되어 있습니다.`,
  };
  const d = base[pl] || `베트남 타겟 고품질 마케팅 상품입니다. ${market}`;
  return type ? `${d} (${type})` : d;
}

/** Peakerr — 베트남 타겟 Instagram·TikTok (전 사이트 연결) */
async function importVietnamInstagramTiktokServices(opts = {}) {
  const maxPerPlatform = opts.maxPerPlatform ?? 10;
  const dryRun = !!opts.dryRun;
  const notify = opts.notify !== false;

  const apiKey = await getPeakerrApiKey();
  if (!apiKey) return { error: 'API 키가 설정되지 않았습니다', added: [], count: 0, instagram: 0, tiktok: 0 };

  const resp = await peakerrFetch({ key: apiKey, action: 'services' });
  const services = await resp.json();
  if (!Array.isArray(services)) return { error: '공급 API 응답 오류', added: [], count: 0, instagram: 0, tiktok: 0 };

  const existingR = await query(`SELECT api_id FROM services WHERE api_id IS NOT NULL AND api_id != ''`);
  const existing = new Set(existingR.rows.map(r => String(r.api_id)));

  const byBucket = {};
  let scanned = 0;
  for (const s of services) {
    if (existing.has(String(s.service))) continue;
    const hit = qualifiesVietnamImport(s);
    if (!hit) continue;
    scanned++;
    if (!byBucket[hit.bucket]) byBucket[hit.bucket] = [];
    byBucket[hit.bucket].push({ ...s, ...hit });
  }

  const toAdd = [];
  for (const pl of VN_IMPORT_PLATFORMS) {
    const list = (byBucket[`vn_${pl}`] || []).sort((a, b) => b.qs - a.qs);
    toAdd.push(...list.slice(0, maxPerPlatform));
  }

  const added = [];
  if (!dryRun) {
    for (const s of toAdd) {
      const displayName = formatVietnamImportName(s.name, s.pl);
      const desc = vietnamImportDescription(s.pl, s.type || s.category || '');
      const row = await insertPeakerrImport(s, displayName, s.pl, desc);
      added.push({ ...row, bucket: s.bucket });
    }
    if (added.length) {
      await repairAllPartnerSiteServices();
      await pruneServiceCatalog({ maxPerPlatform: 34, notify: false }).catch(() => {});
    }
    await repairEnglishServiceNames();
  }

  const instagram = added.filter(a => a.pl === 'instagram').length;
  const tiktok = added.filter(a => a.pl === 'tiktok').length;

  if (notify && added.length && !dryRun) {
    let msg = `🇻🇳 <b>베트남 Instagram·TikTok 상품 추가</b>\n\n`;
    msg += `인스타 ${instagram}개 · 틱톡 ${tiktok}개\n\n`;
    added.slice(0, 8).forEach((s, i) => {
      msg += `${i + 1}. [${s.pl}] ${(s.name || '').substring(0, 42)}\n`;
    });
    if (added.length > 8) msg += `…외 ${added.length - 8}개\n`;
    msg += `\nGLOW·지인 사이트 전체 연결 완료`;
    await sendTelegramToSuper(msg);
  }

  return { ok: true, added, count: added.length, instagram, tiktok, scanned, candidates: toAdd.length };
}

async function scanNewServices(opts = {}) {
  try {
    const maxPerPlatform = opts.maxPerPlatform ?? 2;
    const result = await importHotPeakerrServices({ maxPerPlatform, minScore: 150 });
    if (result.error) {
      console.log('신규 서비스 스캔:', result.error);
      return result;
    }
    if (result.added.length > 0) {
      let msg = `🔥 <b>핫상품 자동 추가</b>\n\n`;
      result.added.forEach((s, i) => {
        msg += `${i + 1}. [${s.pl}] ${(s.name || '').substring(0, 45)}\n`;
        msg += `   💰 $${s.rate}/1K\n\n`;
      });
      msg += `총 ${result.count}개 · 전체 사이트 연결 완료`;
      await sendTelegramToSuper(msg);
    }
    return result;
  } catch (e) { console.log('신규 서비스 스캔 실패:', e.message); return { error: e.message, added: [], count: 0 }; }
}

function scoreServiceRow(row) {
  let score = scorePeakerrService({
    name: row.name,
    category: row.description || '',
    refill: /refill/i.test(`${row.name} ${row.description || ''}`)
  });
  if (/베트남|vietnam/i.test(`${row.name} ${row.description || ''}`)) score += 55;
  return score;
}

function serviceIdPriority(id) {
  if (/^[a-z]{2,3}\d/i.test(id)) return 0;
  if (id.startsWith('pk_')) return 2;
  if (id.startsWith('api_')) return 3;
  if (id.startsWith('svc_')) return 4;
  return 1;
}

/** 저품질·중복·과다 상품 비활성화 (DB 삭제 없음 — 주문 기록 보존) */
async function pruneServiceCatalog(opts = {}) {
  const maxPerPlatform = opts.maxPerPlatform ?? 28;
  const dryRun = !!opts.dryRun;
  const notify = opts.notify !== false;

  const protR = await query(`
    SELECT DISTINCT sid FROM orders
    WHERE created >= NOW() - INTERVAL '30 days'
      AND status NOT IN ('cancelled','canceled','failed','refunded','partial_refunded')
  `);
  const protectedIds = new Set(protR.rows.map(r => r.sid));

  const toDeactivate = new Map();
  const mark = (id, reason, name) => {
    if (protectedIds.has(id) || toDeactivate.has(id)) return;
    if (isCuratedServiceId(id) && ['typeoverflow', 'overflow', 'autimport', 'namedup'].includes(reason)) return;
    toDeactivate.set(id, { reason, name });
  };

  const allR = await query(`
    SELECT id, name, pl, rate, api_id, active, description FROM services WHERE active=1
  `);

  for (const row of allR.rows) {
    const full = `${row.name} ${row.description || ''}`;
    if (BAD_SERVICE_NAME.test(full) || scoreServiceRow(row) < 0) {
      mark(row.id, 'bad', row.name);
    }
    if (parseFloat(row.rate) <= 0) mark(row.id, 'bad', row.name);
    // 트래픽 탭에 섞인 Google Maps 리뷰(건당 고가) — 웹 트래픽과 혼동 방지
    if (row.pl === 'traffic' && /google map|gmb\b|maps custom|custom review|\[\d+\s*star\]/i.test(full)) {
      mark(row.id, 'miscat', row.name);
    }
  }

  const dupR = await query(`
    SELECT api_id, array_agg(id) AS ids
    FROM services WHERE api_id IS NOT NULL AND api_id != '' AND active=1
    GROUP BY api_id HAVING COUNT(*) > 1
  `);
  for (const dup of dupR.rows) {
    const rowsR = await query(`
      SELECT id, name, pl, rate, description FROM services WHERE id = ANY($1) AND active=1
    `, [dup.ids]);
    const sorted = rowsR.rows.sort((a, b) => {
      const pa = serviceIdPriority(a.id);
      const pb = serviceIdPriority(b.id);
      if (pa !== pb) return pa - pb;
      return scoreServiceRow(b) - scoreServiceRow(a) || parseFloat(a.rate) - parseFloat(b.rate);
    });
    for (let i = 1; i < sorted.length; i++) {
      mark(sorted[i].id, 'duplicate', sorted[i].name);
    }
  }

  // 동일 한글 상품명 중복 (서로 다른 api_id → 가격·주문 혼란 방지)
  const liveForName = allR.rows.filter(r => !toDeactivate.has(r.id));
  const byDisplayName = new Map();
  for (const row of liveForName) {
    const key = `${row.pl}\0${(row.name || '').trim()}`;
    if (!byDisplayName.has(key)) byDisplayName.set(key, []);
    byDisplayName.get(key).push(row);
  }
  for (const rows of byDisplayName.values()) {
    if (rows.length <= 1) continue;
    const sorted = rows.sort((a, b) => {
      if (protectedIds.has(a.id) && !protectedIds.has(b.id)) return -1;
      if (!protectedIds.has(a.id) && protectedIds.has(b.id)) return 1;
      const sc = scoreServiceRow(b) - scoreServiceRow(a);
      if (sc !== 0) return sc;
      return parseFloat(a.rate) - parseFloat(b.rate);
    });
    for (let i = 1; i < sorted.length; i++) {
      mark(sorted[i].id, 'namedup', sorted[i].name);
    }
  }

  // 자동등록(pk_/api_/svc_) — 동일 플랫폼·종류에 검증 시드(ptt/pyt/pig)가 있으면 숨김
  const liveForAuto = allR.rows.filter(r => !toDeactivate.has(r.id));
  const curatedBuckets = new Map();
  for (const row of liveForAuto) {
    if (!isCuratedServiceId(row.id)) continue;
    const key = serviceBucketKey(row);
    if (!curatedBuckets.has(key)) curatedBuckets.set(key, []);
    curatedBuckets.get(key).push(row);
  }
  for (const row of liveForAuto) {
    if (!/^pk_|^api_|^svc_/.test(row.id)) continue;
    if (curatedBuckets.has(serviceBucketKey(row))) {
      mark(row.id, 'autimport', row.name);
    }
  }

  const platforms = ['youtube', 'instagram', 'tiktok', 'threads', 'twitter', 'facebook', 'telegram', 'spotify', 'twitch', 'amazon', 'coupang', 'ecommerce', 'naver', 'kakao', 'pinterest', 'traffic', 'appstore', 'other'];
  for (const pl of platforms) {
    const activeR = await query(`
      SELECT id, name, pl, rate, description FROM services
      WHERE active=1 AND pl=$1
    `, [pl]);
    const live = activeR.rows.filter(r => !toDeactivate.has(r.id));
    if (live.length <= maxPerPlatform) continue;
    const scored = live.map(r => ({ ...r, sc: scoreServiceRow(r) }))
      .sort((a, b) => {
        if (protectedIds.has(a.id) && !protectedIds.has(b.id)) return -1;
        if (!protectedIds.has(a.id) && protectedIds.has(b.id)) return 1;
        return b.sc - a.sc || parseFloat(a.rate) - parseFloat(b.rate);
      });
    scored.slice(maxPerPlatform).forEach(r => mark(r.id, 'overflow', r.name));
  }

  const typeCaps = {
    '조회수': 3, '쇼츠 조회수': 2, '스토리 조회수': 2, '릴스 조회수': 2,
    '좋아요': 4, '쇼츠 좋아요': 2, '팔로워': 3, '구독자': 3, '댓글': 2
  };
  for (const pl of ['tiktok', 'youtube', 'instagram']) {
    const live = allR.rows.filter(r => r.pl === pl && !toDeactivate.has(r.id));
    const byType = new Map();
    for (const row of live) {
      const t = detectServiceTypeKo(`${row.name} ${row.description || ''}`);
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(row);
    }
    for (const [type, rows] of byType) {
      const cap = typeCaps[type];
      if (!cap || rows.length <= cap) continue;
      const sorted = rows.sort((a, b) => {
        if (protectedIds.has(a.id) && !protectedIds.has(b.id)) return -1;
        if (!protectedIds.has(a.id) && protectedIds.has(b.id)) return 1;
        return scoreServiceRow(b) - scoreServiceRow(a) || parseFloat(a.rate) - parseFloat(b.rate);
      });
      for (let i = cap; i < sorted.length; i++) mark(sorted[i].id, 'typeoverflow', sorted[i].name);
    }
  }

  const stats = { bad: 0, duplicate: 0, namedup: 0, overflow: 0, typeoverflow: 0, autimport: 0 };
  const PRUNE_REASON_KO = {
    bad: '저품질·테스트·무효 상품으로 판매 중단',
    duplicate: '동일 공급 코드 중복 — 품질·가격 우수한 상품만 유지',
    namedup: '동일 한글 상품명 중복 — 하나만 판매',
    overflow: '플랫폼별 판매 상품 수 상한(28개) 초과',
    typeoverflow: '동일 종류(팔로워·좋아요 등) 상품 수 상한 초과',
    autimport: '검증 시드와 동일 종류 — 자동등록(pk_) 상품 숨김',
    miscat: '카테고리 오분류(웹 트래픽·지도 리뷰 혼동 등)'
  };
  const items = [];
  for (const [id, info] of toDeactivate) {
    stats[info.reason] = (stats[info.reason] || 0) + 1;
    items.push({ id, name: info.name, reason: info.reason });
  }
  const total = items.length;

  if (!dryRun && total > 0) {
    for (const item of items) {
      await hideServiceWithNote(item.id, PRUNE_REASON_KO[item.reason] || `카탈로그 정리 (${item.reason})`);
    }
    await query(`DELETE FROM site_services WHERE service_id NOT IN (SELECT id FROM services)`);
    await repairAllPartnerSiteServices();
  }

  if (notify && total > 0 && !dryRun) {
    let msg = `🧹 <b>상품 정리</b>\n\n`;
    if (stats.bad) msg += `❌ 저품질·무효: ${stats.bad}개\n`;
    if (stats.duplicate) msg += `📋 중복 api_id: ${stats.duplicate}개\n`;
    if (stats.namedup) msg += `📋 동일 상품명: ${stats.namedup}개\n`;
    if (stats.overflow) msg += `📦 플랫폼별 상한 초과: ${stats.overflow}개\n`;
    msg += `\n총 ${total}개 숨김 (주문 기록 유지)`;
    items.slice(0, 5).forEach(s => { msg += `\n• ${(s.name || '').substring(0, 40)}`; });
    await sendTelegramToSuper(msg);
  }

  const activeR = await query(`SELECT COUNT(*)::int AS c FROM services WHERE active=1`);
  return { ok: true, deactivated: stats, total, items: items.slice(0, 30), activeCount: activeR.rows[0]?.c || 0 };
}

/** 지인 사이트 상품 노출·공급사 연결 상태 점검 (문제 시 자동 복구 + 텔레그램) */
async function runCatalogHealthCheck(autoRepair = true) {
  const issues = [];
  const totalR = await query(`SELECT COUNT(*)::int AS c FROM services WHERE active=1`);
  const totalActive = totalR.rows[0]?.c || 0;
  if (totalActive < 10) issues.push(`활성 상품 극소 (${totalActive}개)`);

  const apiKey = await getPeakerrApiKey();
  if (!apiKey) issues.push('공급 API 키 미설정');

  const sitesR = await query(`SELECT id, name, domain FROM sites WHERE id != 'default' AND active=1`);
  const minHealthy = Math.max(5, Math.floor(totalActive * 0.1));
  for (const site of sitesR.rows) {
    const enR = await query(`
      SELECT COUNT(*)::int AS c FROM services s
      INNER JOIN site_services ss ON s.id = ss.service_id
      WHERE s.active=1 AND ss.site_id=$1 AND ss.active=1
    `, [site.id]);
    const enabled = enR.rows[0]?.c || 0;
    if (totalActive > 0 && enabled < minHealthy) {
      issues.push(`${site.name}: ${enabled}/${totalActive}개만 노출`);
      if (autoRepair) await repairSiteServices(site.id, true);
    }
  }

  const orphanR = await query(`
    SELECT COUNT(*)::int AS c FROM site_services WHERE service_id NOT IN (SELECT id FROM services)
  `);
  if (orphanR.rows[0]?.c > 0) {
    issues.push(`고아 site_services ${orphanR.rows[0].c}건`);
    if (autoRepair) await repairAllPartnerSiteServices();
  }

  const balance = await checkPeakerrBalance().catch(() => null);
  if (balance !== null && balance < 10) issues.push(`공급 API 잔액 위험 ($${balance.toFixed(2)})`);

  if (issues.length > 0) {
    const today = new Date().toDateString();
    const last = await getGlobalSetting('catalog_health_alert');
    if (last !== today) {
      let msg = `⚠️ <b>상품 카탈로그 점검</b>\n\n${issues.join('\n')}`;
      if (autoRepair) msg += `\n\n✅ 자동 복구 시도 완료`;
      await sendTelegramToSuper(msg);
      await setGlobalSetting('catalog_health_alert', today);
    }
  }

  return { ok: issues.length === 0, issues, totalActive };
}

// 💰 충전 보너스 계산 — 금액이 도달한 가장 높은 구간의 보너스율(%)을 적용
// tiersJson: {"10000":0,"30000":0,"50000":1,"100000":5,"200000":6} 형태
function calcChargeBonus(amount, tiersJson) {
  try {
    if (!tiersJson) return 0;
    const tiers = typeof tiersJson === 'string' ? JSON.parse(tiersJson) : tiersJson;
    if (!tiers || typeof tiers !== 'object') return 0;
    // 충전액 이하의 구간 중 가장 높은 금액 구간을 찾음
    let bestRate = 0;
    let bestThreshold = -1;
    for (const key in tiers) {
      const threshold = parseFloat(key);
      const rate = parseFloat(tiers[key]) || 0;
      if (amount >= threshold && threshold > bestThreshold && rate > 0) {
        bestThreshold = threshold;
        bestRate = rate;
      }
    }
    if (bestRate <= 0) return 0;
    return Math.round(amount * bestRate / 100);
  } catch(e) { return 0; }
}

/** 승인된 충전 회수 — 잔액 차감 + 상태 reversed */
async function reverseApprovedCharge(charge, adminId, opts = {}) {
  if (!charge || charge.status !== 'approved') return { error: '승인된 충전만 회수 가능' };
  const userR = await query(`SELECT * FROM users WHERE id=$1`, [charge.uid]);
  const user = userR.rows[0];
  if (!user) return { error: '회원 없음' };
  const chargerRole = user.role || 'user';
  let bonus = 0;
  if (chargerRole === 'user') {
    const bSiteR = await query(`SELECT charge_bonus_tiers FROM sites WHERE id=$1`, [charge.site_id]);
    bonus = calcChargeBonus(charge.amount, bSiteR.rows[0]?.charge_bonus_tiers);
  }
  const totalRevoke = charge.amount + bonus;
  const beforeBal = user.balance || 0;
  const afterBal = Math.max(0, beforeBal - totalRevoke);
  await query(`UPDATE users SET balance=$1 WHERE id=$2`, [afterBal, charge.uid]);
  if (opts.markReversed !== false)
    await query(`UPDATE charges SET status='reversed' WHERE id=$1`, [charge.id]);
  await logBalance(
    charge.site_id, charge.uid, charge.uname, -totalRevoke,
    beforeBal, afterBal,
    opts.reason || '충전 승인 회수',
    adminId || 'system'
  );
  return { ok: true, revoked: totalRevoke, balance: afterBal };
}

async function tgAlert(msg, site) {
  const siteObj = typeof site === 'object' ? site : null;
  const isDefaultSite = !siteObj || siteObj.id === 'default';

  const superToken = await getGlobalSetting('tg_token');
  const superChat = await getGlobalSetting('tg_chat');
  const siteToken = siteObj?.tg_token || '';
  const siteChat = siteObj?.tg_chat || '';

  const sendList = [];

  // 주문 알림은 조인호한테 항상 옴 (전체 현황 파악용)
  if (superToken && superChat) {
    sendList.push({ token: superToken, chat: superChat, label: 'super' });
  }

  // 사이트 관리자한테도 전송 (설정된 경우, 중복 제외)
  if (siteToken && siteChat &&
      (siteToken !== superToken || siteChat !== superChat)) {
    sendList.push({ token: siteToken, chat: siteChat, label: 'site' });
  }

  await Promise.all(sendList.map(async ({ token, chat }) => {
    try {
      const text = stripSupplierBrand(msg);
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML' })
      });
    } catch(e) { console.log('TG 오류:', e.message); }
  }));
}

function tgKstNow() {
  return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function tgRoleLabel(role) {
  return { admin: '관리자', partner: '파트너', superadmin: '슈퍼관리자', user: '고객' }[role] || '고객';
}

async function fetchSiteForTg(siteId) {
  if (!siteId || siteId === 'default') return { id: 'default', name: 'GLOW' };
  const r = await query(`SELECT * FROM sites WHERE id=$1`, [siteId]);
  return r.rows[0] || { id: siteId, name: siteId };
}

/** 주문·취소·환불·완료 — 누가 / 어떤 작업 / 어느 사이트 텔레그램 */
async function tgOrderNotify(title, order, opts = {}) {
  try {
    if (!order?.id) return;
    const site = opts.site || await fetchSiteForTg(order.site_id);
    const customerR = await query(`SELECT name, email, role FROM users WHERE id=$1`, [order.uid]);
    const customer = customerR.rows[0] || { name: order.uname || '—', email: '', role: 'user' };
    const actorId = opts.actorId || order.uid;
    let actorBlock;
    if (actorId === 'system') {
      actorBlock = '🤖 <b>처리:</b> 자동 동기화';
    } else if (actorId === order.uid) {
      actorBlock = `👤 <b>주문자:</b> ${customer.name} (${tgRoleLabel(customer.role)})`;
    } else {
      const actorR = await query(`SELECT name, email, role FROM users WHERE id=$1`, [actorId]);
      const actor = actorR.rows[0] || { name: '관리자', role: 'admin' };
      actorBlock = `👮 <b>처리:</b> ${actor.name} (${tgRoleLabel(actor.role)})\n👤 <b>주문자:</b> ${customer.name} (${tgRoleLabel(customer.role)})`;
    }
    if (customer.email) actorBlock += `\n📧 ${customer.email}`;

    let msg = `${title}\n\n🏷 <b>${site.name || 'GLOW'}</b>\n${actorBlock}\n\n`;
    msg += `📋 <code>${order.id}</code>`;
    msg += `\n✦ ${order.sname || '—'} ×${(order.qty || 0).toLocaleString()}`;
    if (order.link) msg += `\n🔗 ${String(order.link).slice(0, 68)}`;
    const sc = parseInt(order.starts_count || 0, 10);
    if (sc > 0) msg += `\n📊 시작 ${sc.toLocaleString()} → 목표 ${(sc + (order.qty || 0)).toLocaleString()}`;
    if (opts.extra) msg += `\n${opts.extra}`;
    msg += `\n⏰ ${tgKstNow()}`;
    await tgAlert(msg, site);
  } catch (e) { console.log('주문 TG 알림:', e.message); }
}

/** 신규 회원가입 — 사이트명·도메인 포함 (슈퍼 + 해당 사이트 TG) */
async function tgSignupNotify(user, site, opts = {}) {
  try {
    if (!user?.email) return;
    const siteObj = site || { name: 'GLOW', id: 'default' };
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const domain = siteObj.domain && siteObj.domain !== siteObj.id ? siteObj.domain : '';

    let msg = `👤 <b>신규 가입</b>\n\n`;
    msg += `🏷 <b>${esc(siteObj.name || 'GLOW')}</b>`;
    if (domain) msg += `\n🌐 ${esc(domain)}`;
    msg += `\n\n닉네임: ${esc(user.name)}\n📧 ${esc(user.email)}`;
    if (user.phone) msg += `\n📱 ${esc(user.phone)}`;
    if (opts.referralCode) msg += `\n🔗 추천코드: ${esc(opts.referralCode)}`;
    if (opts.signupBonus) msg += `\n🎁 가입 보너스: ${opts.signupBonus}P`;
    msg += `\n⏰ ${tgKstNow()}`;

    await tgAlert(msg, siteObj);
  } catch (e) { console.log('가입 TG 알림:', e.message); }
}

async function tgChargeAlert(chargeId, userName, amount, note, site, requesterRole, currentBalance) {
  const siteName = typeof site === 'object' ? site.name : site;
  const siteObj = typeof site === 'object' ? site : null;
  const isDefaultSite = !siteObj || siteObj.id === 'default';

  const balLine = (currentBalance !== undefined && currentBalance !== null)
    ? `\n💳 현재 잔액: ₩${Math.round(currentBalance).toLocaleString()}` : '';
  const msg = `💳 <b>충전 요청</b> [${siteName}]\n👤 ${userName}\n💰 ₩${Math.round(amount).toLocaleString()}${balLine}\n📝 ${note || '-'}\n⏰ ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`;

  const sendList = [];

  // 📌 충전 알림 라우팅 정책
  //  · 지인 사이트 관리자/파트너 본인이 충전 요청 → 슈퍼관리자에게 알림
  //    (지인이 GLOW 본사에 입금하는 개념이므로 슈퍼관리자가 승인)
  //  · 지인 사이트의 일반 회원이 충전 요청 → 해당 사이트 관리자에게만 알림
  //    (슈퍼관리자는 받지 않음)
  //  · GLOW 본사(default) 사이트의 요청 → 항상 슈퍼관리자에게
  const isAdminRequester = requesterRole === 'admin' || requesterRole === 'partner';

  if (isDefaultSite || isAdminRequester) {
    // 슈퍼관리자에게 전송
    const superToken = await getGlobalSetting('tg_token');
    const superChat = await getGlobalSetting('tg_chat');
    if (superToken && superChat) {
      sendList.push({ token: superToken, chat: superChat });
    }
  } else {
    // 지인 사이트 일반 회원 → 해당 사이트 관리자에게만 전송
    const siteToken = (siteObj?.tg_token) || '';
    const siteChat = (siteObj?.tg_chat) || '';
    if (siteToken && siteChat) {
      sendList.push({ token: siteToken, chat: siteChat });
    }
    // 사이트 관리자 텔레그램 미설정 시: 누락 방지 위해 슈퍼관리자에게 폴백
    else {
      const superToken = await getGlobalSetting('tg_token');
      const superChat = await getGlobalSetting('tg_chat');
      if (superToken && superChat) {
        sendList.push({ token: superToken, chat: superChat });
      }
    }
  }

  const body = {
    text: msg, parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ 승인', callback_data: `approve_${chargeId}` },
        { text: '❌ 거절', callback_data: `reject_${chargeId}` }
      ]]
    }
  };
  
  await Promise.all(sendList.map(async ({ token, chat }) => {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, ...body })
      });
    } catch(e) { console.log('TG 오류:', e.message); }
  }));
}

// ── API 라우트 ──

app.get('/api/site-config', async (req, res) => {
  try {
  const site = req.site;
  if (!site) return res.json({ error: '사이트를 찾을 수 없습니다' });
  
  // 슈퍼관리자(조인호) 계좌 가져오기
  let superBank = '';
  if (site.id === 'default') {
    superBank = site.bank || '';
  } else {
    try {
      const def = await query(`SELECT bank FROM sites WHERE id='default'`);
      superBank = def.rows[0]?.bank || '';
    } catch(e) { superBank = ''; }
  }

  const pres = getEffectiveSitePresentation(site);

  res.json({
    siteId: site.id,
    isDefault: pres.isDefault,
    name: site.name, logo: site.logo,
    primaryColor: site.primary_color, accentColor: site.accent_color,
    kakao: site.kakao, bank: site.bank,
    margin: site.margin, exrate: site.exrate,
    superMargin: site.super_margin >= 0 ? site.super_margin : null,
    slogan: site.slogan || '콘텐츠가 빛나도록',
    sloganSub: site.slogan_sub || '우리가 성장시킵니다',
    description: site.description || '유튜브·인스타·틱톡·X까지 모든 소셜 채널의 성장을 자동화합니다',
    stat1Num: site.stat1_num || '10K+', stat1Label: site.stat1_label || '서비스 종류',
    stat2Num: site.stat2_num || '24H', stat2Label: site.stat2_label || '빠른 처리',
    stat3Num: site.stat3_num || '50%+', stat3Label: site.stat3_label || '마진 보장',
    stat4Num: site.stat4_num || '100%', stat4Label: site.stat4_label || '안전 보장',
    notice: site.notice || '',
    chargeBonusTiers: site.charge_bonus_tiers || '',
    bannerText: site.banner_text || '',
    bannerImage: site.banner_image || '',
    bannerLink: site.banner_link || '',
    footerText: site.footer_text || '소셜 미디어 플랫폼과 공식 제휴된 서비스가 아닙니다.',
    loginWelcome: site.login_welcome || '다시 만나서 반가워요',
    loginSub: site.login_sub || '계정에 로그인하세요',
    registerWelcome: site.register_welcome || '지금 시작하세요',
    registerSub: site.register_sub || '무료로 계정을 만들어보세요',
    kakaoBtnText: site.kakao_btn_text || '카카오톡 문의',
    chargeGuide: site.charge_guide || '입금 후 아래 양식을 작성해주세요.',
    orderGuide: site.order_guide || '주문 후 취소가 어려울 수 있습니다.',
    heroBadge: site.hero_badge || '소셜 성장 자동화 플랫폼',
    heroPrefix: site.hero_prefix || '콘텐츠가',
    uiLayout: pres.uiLayout,
    theme: pres.theme,
    themeIsCustom: !!(pres.theme && String(pres.theme).trim().startsWith('{')),
    superBank: superBank
  });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    // 🚦 로그인 시도 제한: IP+이메일 기준 분당 5회
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const { email, pw } = req.body;
    if (!email || !pw) return res.json({ error: '이메일과 비밀번호를 입력하세요' });
    
    const rateCheck = await checkRateLimit(`login:${ip}:${email}`, 5);
    if (!rateCheck.ok) {
      return res.json({ error: `로그인 시도가 너무 많습니다. ${rateCheck.retry}초 후 다시 시도해주세요.` });
    }
    
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
    if (targetUser.status === 'deleted')
      return res.json({ error: '탈퇴 처리된 계정입니다.' });
    
    // 레퍼럴 코드 없으면 자동 생성
    if (!targetUser.referral_code) {
      const refCode = Math.random().toString(36).substring(2,8).toUpperCase();
      await query(`UPDATE users SET referral_code=$1 WHERE id=$2`, [refCode, targetUser.id]);
      targetUser.referral_code = refCode;
    }
    
    const token = createToken({ userId: targetUser.id, role: targetUser.role, siteId: req.siteId });
    const pointsUsable = await userCanUsePoints(targetUser.id, req.siteId, targetUser.role);
    res.json({ ok: true, token, user: {
      id: targetUser.id,
      name: targetUser.name,
      email: targetUser.email,
      role: targetUser.role,
      balance: targetUser.balance,
      points: targetUser.points || 0,
      referral_code: targetUser.referral_code,
      points_usable: pointsUsable
    }});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/register', async (req, res) => {
  try {
    // 🚦 회원가입 스팸 방지: IP 기준 분당 3회
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const rateCheck = await checkRateLimit(`register:${ip}`, 3);
    if (!rateCheck.ok) {
      return res.json({ error: `회원가입 시도가 너무 많습니다. ${rateCheck.retry}초 후 다시 시도해주세요.` });
    }
    
    const { name, email, pw } = req.body;
    if (!name || !email || !pw) return res.json({ error: '모든 항목을 입력하세요' });
    if (pw.length < 6) return res.json({ error: '비밀번호는 6자 이상이어야 합니다' });
    // 이메일 형식 검증
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ error: '올바른 이메일 형식이 아닙니다' });
    // 이름 길이 제한 (봇 스팸 방지)
    if (name.length < 2 || name.length > 50) return res.json({ error: '이름은 2~50자 사이여야 합니다' });
    // 전화번호 (선택 입력)
    const phone = (req.body.phone || '').trim();
    
    const exists = await query(`SELECT id FROM users WHERE site_id=$1 AND email=$2`, [req.siteId, email]);
    if (exists.rows.length > 0) return res.json({ error: '이미 사용 중인 이메일입니다' });
    const hash = bcrypt.hashSync(pw, 10);
    const id = 'u' + Date.now();
    // 레퍼럴 코드 생성 (6자리 랜덤)
    const refCode = Math.random().toString(36).substring(2,8).toUpperCase();
    // 추천인 코드 처리
    const { referral_code } = req.body;
    let referredBy = null;
    let signupBonus = 0;
    const refNorm = String(referral_code || '').trim().toUpperCase();
    let phoneNorm = phone ? normalizePhone(phone) : null;
    if (refNorm) {
      const refUser = await query(
        `SELECT id FROM users WHERE site_id=$1 AND UPPER(referral_code)=$2`,
        [req.siteId, refNorm]
      );
      if (!refUser.rows.length) {
        const siteLabel = req.site?.name || '이 사이트';
        return res.json({ error: `유효하지 않은 추천 코드입니다. ${siteLabel} 회원 코드인지 확인하세요.` });
      }
      if (phoneNorm) {
        const phoneChk = await assertPhoneAvailableForReferral(req.siteId, phoneNorm, id);
        if (!phoneChk.ok) return res.json({ error: phoneChk.error });
        phoneNorm = phoneChk.norm;
        referredBy = refUser.rows[0].id;
        signupBonus = 500;
        await query(
          `UPDATE users SET points=COALESCE(points,0)+500, referral_bonus=COALESCE(referral_bonus,0)+500 WHERE id=$1`,
          [referredBy]
        );
      }
      // 추천코드만 있고 전화번호 없음 → 가입은 허용, 500P는 나중에 전화번호+코드 등록 시
    }
    await query(`INSERT INTO users(id,site_id,name,email,pw,role,balance,referral_code,referred_by,points,phone) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, req.siteId, name, email, hash, 'user', 0, refCode, referredBy, signupBonus, phoneNorm || phone]);
    const token = createToken({ userId: id, role: 'user', siteId: req.siteId });
    tgSignupNotify(
      { name, email, phone: phoneNorm || phone },
      req.site,
      { referralCode: refNorm || null, signupBonus: signupBonus || 0 }
    ).catch(() => null);
    res.json({ ok: true, token, user: { id, name, email, role: 'user', balance: 0, points: signupBonus, referral_code: refCode, points_usable: false }});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => { res.json({ ok: true }); });

// ═══════════════════════════════════════
// 🔐 비밀번호 재설정 (이메일 기반)
// ═══════════════════════════════════════

async function getResendApiKey() {
  const envKey = String(process.env.RESEND_API_KEY || '').trim();
  if (envKey) return envKey;
  try {
    return String(await getGlobalSetting('resend_api_key') || '').trim();
  } catch (e) {
    return '';
  }
}

async function getEmailFromAddress(siteName) {
  const envFrom = String(process.env.EMAIL_FROM || '').trim();
  if (envFrom) return envFrom;
  try {
    const dbFrom = String(await getGlobalSetting('email_from') || '').trim();
    if (dbFrom) return dbFrom;
  } catch (e) {}
  // Resend 무료 온보딩 발신 (도메인 인증 전에도 발송 가능)
  const label = String(siteName || 'GLOW').replace(/[<>"]/g, '').slice(0, 40) || 'GLOW';
  return `${label} <beth.t@example.com>`;
}

/** Resend 이메일 발송 — env 또는 슈퍼관리자 설정(resend_api_key) */
async function sendEmail(to, subject, html, opts = {}) {
  const apiKey = await getResendApiKey();
  if (!apiKey) {
    console.log('⚠️ RESEND_API_KEY 미설정 - 이메일 발송 스킵');
    return { ok: false, error: 'no_api_key' };
  }
  try {
    const from = opts.from || await getEmailFromAddress(opts.siteName);
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.log('❌ 이메일 발송 실패:', data);
      return { ok: false, error: data?.message || data?.error || 'send_failed', detail: data };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    console.log('❌ 이메일 오류:', e.message);
    return { ok: false, error: e.message };
  }
}

async function createPasswordResetToken(user, siteId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 60 * 1000);
  await query(
    `INSERT INTO password_resets(token, user_id, site_id, email, expires) VALUES($1,$2,$3,$4,$5)`,
    [token, user.id, siteId, user.email, expires]
  );
  return token;
}

function buildPasswordResetUrl(site, token) {
  const siteDomain = String(site?.domain || 'glow-0wdh.onrender.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${siteDomain}/reset-password?token=${token}`;
}

function buildPasswordResetEmailHtml(siteName, userName, resetUrl) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>비밀번호 재설정</title></head>
    <body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;margin:0">
      <div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;padding:40px 30px;box-shadow:0 2px 10px rgba(0,0,0,0.08)">
        <h1 style="color:#7209B7;margin:0 0 24px 0;font-size:24px">🔐 ${siteName} 비밀번호 재설정</h1>
        <p style="color:#333;font-size:15px;line-height:1.7">안녕하세요 <strong>${userName || '고객'}</strong>님,</p>
        <p style="color:#333;font-size:15px;line-height:1.7">비밀번호 재설정 요청을 받았습니다. 아래 버튼을 클릭하여 새 비밀번호를 설정해주세요.</p>
        <div style="text-align:center;margin:32px 0">
          <a href="${resetUrl}" style="background:linear-gradient(135deg,#7209B7,#F72585);color:white;padding:14px 32px;border-radius:100px;text-decoration:none;font-weight:700;display:inline-block">비밀번호 재설정하기</a>
        </div>
        <p style="color:#666;font-size:13px;line-height:1.6;background:#f9f9f9;padding:16px;border-radius:8px">
          ⚠️ <strong>이 링크는 30분 동안만 유효</strong>합니다.<br>
          만약 본인이 요청하지 않았다면 이 메일을 무시하셔도 안전합니다.
        </p>
        <p style="color:#999;font-size:12px;text-align:center;margin-top:32px;line-height:1.6">
          링크가 열리지 않을 경우 아래 주소를 복사해서 브라우저에 붙여넣으세요:<br>
          <span style="word-break:break-all;color:#7209B7">${resetUrl}</span>
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:32px 0"/>
        <p style="color:#aaa;font-size:11px;text-align:center">이 메일은 ${siteName}에서 자동 발송되었습니다.</p>
      </div>
    </body>
    </html>`;
}

// Step 1: 비밀번호 재설정 요청 (이메일 입력)
// 메일 실패 시 관리자 개입(텔레그램/카톡 전달) 없이 고객 본인확인으로만 처리
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.json({ error: '이메일을 입력하세요' });
    const emailNorm = String(email).trim().toLowerCase();
    const siteId = req.siteId || 'default';
    const userR = await query(
      `SELECT * FROM users WHERE site_id=$1 AND LOWER(email)=$2 AND COALESCE(status,'active') NOT IN ('deleted')`,
      [siteId, emailNorm]
    );
    const user = userR.rows[0];

    const identityFallback = (u) => {
      const hasPhone = !!(u && u.phone && normalizePhone(u.phone));
      return {
        ok: true,
        needIdentity: true,
        hasPhone,
        pendingAdmin: false,
        message: hasPhone
          ? '메일 대신 가입 이메일·닉네임·전화번호로 본인 확인 후 바로 재설정하세요.'
          : '메일 대신 가입 이메일·닉네임으로 본인 확인 후 바로 재설정하세요.'
      };
    };

    // 보안: 사용자 없으면 동일 본인확인 안내 (존재 여부 유출 방지)
    if (!user) {
      return res.json(identityFallback(null));
    }

    const siteR = await query(`SELECT * FROM sites WHERE id=$1`, [siteId]);
    const site = siteR.rows[0] || req.site;
    const siteName = site?.name || 'GLOW';
    const apiKey = await getResendApiKey();
    if (!apiKey) {
      return res.json(identityFallback(user));
    }

    const token = await createPasswordResetToken(user, siteId);
    const resetUrl = buildPasswordResetUrl(site, token);
    const html = buildPasswordResetEmailHtml(siteName, user.name, resetUrl);
    const sent = await sendEmail(emailNorm, `[${siteName}] 비밀번호 재설정 안내`, html, { siteName });
    if (sent.ok) {
      return res.json({ ok: true, message: '해당 이메일로 재설정 링크를 보냈습니다. 메일함·스팸함을 확인해주세요.' });
    }

    // 메일 실패 → 고객이 화면에서 바로 본인확인 재설정 (관리자 TG 알림 없음)
    return res.json(identityFallback(user));
  } catch (e) {
    console.log('forgot-password 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

// Step 1b: 메일 없이 본인확인 → 재설정 토큰 발급
// - 전화 없음: 이메일 + 닉네임
// - 전화 있음: 이메일 + 닉네임 + 전화번호
app.post('/api/forgot-password/identity', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const rateCheck = await checkRateLimit(`pwreset-id:${ip}`, 5);
    if (!rateCheck.ok) {
      return res.json({ error: `시도가 너무 많습니다. ${rateCheck.retry}초 후 다시 시도해주세요.` });
    }

    const emailNorm = String(req.body.email || '').trim().toLowerCase();
    const nameNorm = String(req.body.name || '').trim();
    const phoneNorm = normalizePhone(req.body.phone || '');
    if (!emailNorm || !nameNorm) {
      return res.json({ error: '이메일과 닉네임을 입력하세요' });
    }
    if (nameNorm.length < 2) {
      return res.json({ error: '닉네임을 정확히 입력하세요' });
    }

    const siteId = req.siteId || 'default';
    const userR = await query(
      `SELECT * FROM users WHERE site_id=$1 AND LOWER(email)=$2 AND COALESCE(status,'active') NOT IN ('deleted')`,
      [siteId, emailNorm]
    );
    const user = userR.rows[0];
    // 존재 여부·불일치 모두 동일 메시지 (계정 유출 최소화)
    const failMsg = '가입 정보가 일치하지 않습니다. 이메일·닉네임을 확인해주세요.';
    if (!user) return res.json({ error: failMsg });

    if (String(user.name || '').trim().toLowerCase() !== nameNorm.toLowerCase()) {
      return res.json({ error: failMsg });
    }

    const userPhone = normalizePhone(user.phone || '');
    if (userPhone) {
      if (!phoneNorm || userPhone !== phoneNorm) {
        return res.json({ error: '이 계정은 전화번호 확인이 필요합니다. 가입 시 등록한 번호를 입력하세요.' });
      }
    }

    const siteR = await query(`SELECT * FROM sites WHERE id=$1`, [siteId]);
    const site = siteR.rows[0] || req.site;
    const token = await createPasswordResetToken(user, siteId);
    const resetUrl = buildPasswordResetUrl(site, token);
    return res.json({
      ok: true,
      token,
      resetUrl,
      email: user.email,
      message: '본인 확인되었습니다. 새 비밀번호를 설정해 주세요.'
    });
  } catch (e) {
    console.log('forgot-password/identity 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

// Step 2: 토큰 검증 (리셋 페이지 접속 시)
app.get('/api/reset-password/verify', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.json({ error: '유효하지 않은 링크입니다' });
    const r = await query(`SELECT * FROM password_resets WHERE token=$1`, [token]);
    const reset = r.rows[0];
    if (!reset) return res.json({ error: '유효하지 않은 링크입니다' });
    if (reset.used) return res.json({ error: '이미 사용된 링크입니다' });
    if (new Date(reset.expires) < new Date()) return res.json({ error: '링크가 만료되었습니다 (30분 경과). 다시 요청해주세요.' });
    res.json({ ok: true, email: reset.email });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Step 3: 새 비밀번호 설정
app.post('/api/reset-password', async (req, res) => {
  try {
    const { token, newpw } = req.body;
    if (!token || !newpw) return res.json({ error: '모든 정보를 입력해주세요' });
    if (newpw.length < 6) return res.json({ error: '비밀번호는 6자 이상이어야 합니다' });
    
    const r = await query(`SELECT * FROM password_resets WHERE token=$1`, [token]);
    const reset = r.rows[0];
    if (!reset) return res.json({ error: '유효하지 않은 링크입니다' });
    if (reset.used) return res.json({ error: '이미 사용된 링크입니다' });
    if (new Date(reset.expires) < new Date()) return res.json({ error: '링크가 만료되었습니다' });
    
    // 비밀번호 변경
    const hash = bcrypt.hashSync(newpw, 10);
    await query(`UPDATE users SET pw=$1 WHERE id=$2`, [hash, reset.user_id]);
    // 토큰 사용 처리
    await query(`UPDATE password_resets SET used=1 WHERE token=$1`, [token]);
    
    res.json({ ok: true, message: '비밀번호가 재설정되었습니다. 새 비밀번호로 로그인해주세요.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const r = await query(`SELECT id,name,email,role,balance,status,COALESCE(points,0) as points,referral_code,referred_by,COALESCE(phone,'') as phone FROM users WHERE id=$1`, [req.session.userId]);
    const user = r.rows[0];
    if (!user) return res.json({ error: '사용자 없음' });
    // referral_code 없으면 자동 생성
    if (!user.referral_code) {
      const refCode = Math.random().toString(36).substring(2,8).toUpperCase();
      await query(`UPDATE users SET referral_code=$1 WHERE id=$2`, [refCode, req.session.userId]);
      user.referral_code = refCode;
    }
    const out = { ...user };
    out.points_usable = await userCanUsePoints(user.id, req.siteId, user.role);
    if (user.role !== req.session.role) {
      out.token = createToken({ userId: user.id, role: user.role, siteId: req.session.siteId });
      out.roleSynced = true;
    }
    res.json(out);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 내 정보 - 비밀번호 변경 (현재 비밀번호 확인 필수)
app.post('/api/me/password', requireAuth, async (req, res) => {
  try {
    const { currentPw, newPw } = req.body;
    if (!currentPw || !newPw) return res.json({ error: '현재 비밀번호와 새 비밀번호를 모두 입력하세요' });
    if (newPw.length < 6) return res.json({ error: '새 비밀번호는 6자 이상이어야 합니다' });
    const r = await query(`SELECT pw FROM users WHERE id=$1`, [req.session.userId]);
    const user = r.rows[0];
    if (!user) return res.json({ error: '사용자를 찾을 수 없습니다' });
    // 현재 비밀번호 확인
    if (!bcrypt.compareSync(currentPw, user.pw)) {
      return res.json({ error: '현재 비밀번호가 올바르지 않습니다' });
    }
    if (bcrypt.compareSync(newPw, user.pw)) {
      return res.json({ error: '새 비밀번호가 기존 비밀번호와 같습니다' });
    }
    const hash = bcrypt.hashSync(newPw, 10);
    await query(`UPDATE users SET pw=$1 WHERE id=$2`, [hash, req.session.userId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 내 정보 - 전화번호 저장/수정
app.post('/api/me/phone', requireAuth, async (req, res) => {
  try {
    const phone = (req.body.phone || '').trim();
    if (phone.length > 30) return res.json({ error: '전화번호가 너무 깁니다' });
    await query(`UPDATE users SET phone=$1 WHERE id=$2`, [phone, req.session.userId]);
    res.json({ ok: true, phone });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/** 가입 후 추천 코드 등록 (1회) — 신규·기존 회원 모두 */
app.post('/api/referral/apply', requireAuth, async (req, res) => {
  try {
    const userR = await query(`SELECT * FROM users WHERE id=$1`, [req.session.userId]);
    const user = userR.rows[0];
    if (!user) return res.json({ error: '사용자를 찾을 수 없습니다' });
    if (user.role !== 'user') return res.json({ error: '일반 회원만 추천 코드를 등록할 수 있습니다' });
    if (user.referred_by) return res.json({ error: '이미 추천 코드를 등록했습니다' });
    const refNorm = String(req.body.referral_code || '').trim().toUpperCase();
    if (!refNorm) return res.json({ error: '추천 코드를 입력하세요' });
    if (user.referral_code && user.referral_code.toUpperCase() === refNorm) {
      return res.json({ error: '본인 추천 코드는 사용할 수 없습니다' });
    }
    const phoneRaw = (req.body.phone || user.phone || '').trim();
    if (!phoneRaw) return res.json({ error: '추천 보너스(500P)를 받으려면 전화번호를 입력하세요.' });
    const phoneChk = await assertPhoneAvailableForReferral(req.siteId, phoneRaw, user.id);
    if (!phoneChk.ok) return res.json({ error: phoneChk.error });
    const refUser = await query(
      `SELECT id, name FROM users WHERE site_id=$1 AND UPPER(referral_code)=$2 AND id<>$3`,
      [req.siteId, refNorm, user.id]
    );
    if (!refUser.rows.length) {
      const siteLabel = req.site?.name || '이 사이트';
      return res.json({ error: `유효하지 않은 추천 코드입니다. ${siteLabel} 회원 코드인지 확인하세요.` });
    }
    const referrer = refUser.rows[0];
    await query(`UPDATE users SET referred_by=$1, phone=$2, points=COALESCE(points,0)+500 WHERE id=$3`, [referrer.id, phoneChk.norm, user.id]);
    await query(
      `UPDATE users SET points=COALESCE(points,0)+500, referral_bonus=COALESCE(referral_bonus,0)+500 WHERE id=$1`,
      [referrer.id]
    );
    const afterR = await query(`SELECT points FROM users WHERE id=$1`, [user.id]);
    const pointsUsable = await userCanUsePoints(user.id, req.siteId, user.role);
    res.json({
      ok: true,
      points: afterR.rows[0]?.points || 0,
      points_usable: pointsUsable,
      message: pointsUsable ? '500P 지급 완료!' : '500P 지급! 충전 승인 후 잔액으로 전환할 수 있어요.'
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/services', async (req, res) => {
  try {
    attachPartnerAdminJsonMask(req, res);
    const site = req.site;
    let priceUser = null;
    const svcToken = getToken(req);
    const svcPayload = svcToken ? verifyToken(svcToken) : null;
    if (svcPayload?.userId) {
      const uR = await query(`SELECT margin, role FROM users WHERE id=$1`, [svcPayload.userId]);
      priceUser = uR.rows[0] || null;
    }
    const siteMg = resolveSiteMargin(site, priceUser);
    // 환율: 사이트별 → 글로벌 순으로 적용
    const globalExrate = await getGlobalSetting('global_exrate');
    const ex = (site && site.exrate > 0) ? site.exrate : parseFloat(globalExrate || '1500');
    // 슈퍼마진: 사이트별 → 글로벌 순으로 적용
    let superMg;
    if (site && site.super_margin >= 0) {
      superMg = site.super_margin;
    } else {
      const superMgStr = await getGlobalSetting('super_margin');
      superMg = parseFloat(superMgStr || '50');
    }
    // 사이트별 서비스 필터링 (default 사이트는 전체, 다른 사이트는 site_services 기준)
    let serviceRows;
    if (site && site.id !== 'default') {
      const ssR = await query(`
        SELECT s.* FROM services s
        INNER JOIN site_services ss ON s.id = ss.service_id
        WHERE s.active=1 AND ss.site_id=$1 AND ss.active=1
        ORDER BY s.id
      `, [site.id]);
      serviceRows = ssR.rows;
      serviceRows = filterPartnerServiceRows(serviceRows);
      const totalActiveR = await query(`SELECT COUNT(*)::int AS c FROM services WHERE active=1`);
      const totalActive = totalActiveR.rows[0]?.c || 0;
      const minHealthy = Math.max(5, Math.floor(totalActive * 0.1));
      // site_services 없음/전체 OFF/깨진 상태(극소 활성) → 전체 노출 + 자동 복구
      if (serviceRows.length === 0 || (totalActive > 0 && serviceRows.length < minHealthy)) {
        if (serviceRows.length > 0 && serviceRows.length < minHealthy) {
          repairSiteServices(site.id).catch(e => console.log('site_services 자동복구:', e.message));
        }
        const allR = await query(`SELECT * FROM services WHERE active=1 ORDER BY id`);
        serviceRows = filterPartnerServiceRows(allR.rows);
      }
    } else {
      const allR = await query(`SELECT * FROM services WHERE active=1 ORDER BY id`);
      serviceRows = allR.rows;
    }
    const isSuperAdmin = svcPayload?.role === 'superadmin';
    const isPartner = req.session && req.session.role === 'partner';
    const isDefaultSite = !site || site.id === 'default';
    
    // 🎯 플랫폼 우선순위 정렬 (한국 사용자 선호도 기반)
    // YouTube, Instagram, TikTok 먼저 → Twitter, Threads → 기타
    const platformOrder = {
      youtube: 1, instagram: 2, tiktok: 3,
      naver: 4, kakao: 5, coupang: 6, amazon: 7, ecommerce: 8,
      threads: 9, twitter: 10, spotify: 11,
      twitch: 12, facebook: 13, telegram: 14,
      traffic: 15, appstore: 16, pinterest: 17, travel: 18, other: 99,
    };
    serviceRows.sort((a, b) => {
      const oa = platformOrder[a.pl] || 50;
      const ob = platformOrder[b.pl] || 50;
      if (oa !== ob) return oa - ob;
      return (a.id > b.id ? 1 : -1); // 같은 플랫폼 내에서는 id 순
    });
    
    // 글로벌 기본 사이트 마진 (GLOW의 사이트 마진)
    const globalSiteMgStr = await getGlobalSetting('global_site_margin');
    const globalSiteMg = parseFloat(globalSiteMgStr || '50');
    
    res.json(serviceRows.map(s => {
      // 🔧 가격 계산 구조:
      // - GLOW(default): 원가 × 슈퍼마진 × 사이트마진 = 판매가
      // - 지인 사이트: GLOW 판매가 × (1 + 지인마진) = 지인 고객가
      //   → 지인 입장에서는 GLOW 판매가가 "원가"처럼 보임
      
      const origPer1000 = s.rate * ex; // Peakerr 원가 (원화/1000)
      const supplyPer1000 = origPer1000 * (1 + superMg / 100); // 공급가 (원가 + 슈퍼마진)
      
      // GLOW 판매가 = 공급가 × (1 + 글로벌 사이트마진) - 지인에게는 이게 "원가"
      const glowPricePer1000 = supplyPer1000 * (1 + globalSiteMg / 100);
      
      let sellPer1000;
      let baseCostPer1000; // 지인 입장의 "원가"
      
      if (isDefaultSite) {
        // GLOW 본사: 원가 × 슈퍼 × 사이트마진
        sellPer1000 = supplyPer1000 * (1 + siteMg / 100);
        baseCostPer1000 = supplyPer1000; // 공급가
      } else {
        // 지인 사이트: GLOW 판매가 × (1 + 지인마진)
        sellPer1000 = glowPricePer1000 * (1 + siteMg / 100);
        baseCostPer1000 = glowPricePer1000; // 지인에게는 GLOW 판매가가 원가
      }
      
      // 1개당 환산 (최소 1원 보장)
      const originalCost = Math.max(Math.round(origPer1000 / 1000), 1);
      const supplyCost = Math.max(Math.round(supplyPer1000 / 1000), 1);
      const sellPrice = Math.max(Math.round(sellPer1000 / 1000), 1);
      const baseCost = Math.max(Math.round(baseCostPer1000 / 1000), 1);
      
      if (isPartner || !isDefaultSite) {
        return sanitizeServiceForClient(s, {
          sell: sellPrice,
          baseCost,
          sellPer1K: Math.max(Math.round(sellPer1000), 1),
          baseCostPer1K: Math.max(Math.round(baseCostPer1000), 1),
          isPartnerView: true
        });
      }
      if (isSuperAdmin) {
        return sanitizeServiceForSuper(s, {
          sell: sellPrice,
          originalCost,
          supplyCost,
          myProfit: supplyCost - originalCost
        });
      }
      return sanitizeServiceForClient(s, { sell: sellPrice });
    }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders/estimate', requireAuth, async (req, res) => {
  try {
    const { sid, qty } = req.body;
    const qtyNum = parseInt(qty, 10);
    if (!sid || !qtyNum || qtyNum < 1) return res.json({ error: '서비스와 수량을 확인해 주세요.' });
    const est = await buildOrderEstimate(req, sid, qtyNum);
    res.json(est);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders', requireAuth, async (req, res) => {
  try {
    // 🚦 Rate Limit: 분당 10회 주문 제한 (무차별 주문 방지)
    const rateKey = `order:${req.session.userId}`;
    const rateCheck = await checkRateLimit(rateKey, 10);
    if (!rateCheck.ok) {
      return res.json({ error: `너무 빠르게 주문하고 있습니다. ${rateCheck.retry}초 후 다시 시도해주세요.` });
    }
    
    const { sid, link, qty } = req.body;
    const svc = await resolveOrderService(sid);
    if (!svc) return res.json({ error: '선택한 상품을 찾을 수 없습니다. 페이지를 새로고침(F5) 후 다시 선택해주세요.' });
    
    const linkNorm = normalizeOrderLink(link, svc.pl);
    const urlCheck = validateUrl(linkNorm, svc.pl, svc);
    if (!urlCheck.ok) return res.json({ error: urlCheck.error });
    
    const qtyNum = parseInt(qty);
    if (isNaN(qtyNum) || qtyNum < svc.min || qtyNum > svc.max)
      return res.json({ error: `수량은 ${svc.min.toLocaleString()} ~ ${svc.max.toLocaleString()} 사이여야 합니다` });
    
    const dupCheck = await query(
      `SELECT id FROM orders WHERE uid=$1 AND sid=$2 AND link=$3
       AND (status IN ('pending','processing') OR created > NOW() - INTERVAL '30 minutes')
       LIMIT 1`,
      [req.session.userId, sid, linkNorm]
    );
    if (dupCheck.rows.length > 0) {
      return res.json({ error: '동일 상품·링크 주문이 이미 있습니다. 진행 중이거나 30분 내 중복 주문은 불가합니다.' });
    }
    const productConflict = await findActiveOrderConflict(req.siteId, linkNorm, svc);
    if (productConflict) {
      const label = productConflict.bucket || svc.name;
      return res.json({
        error: `이 링크로 ${label} 작업이 진행 중입니다 (#${productConflict.orderId}). 완료·취소 후 다시 주문해주세요.`
      });
    }

    const site = req.site;
    const userR = await query(`SELECT * FROM users WHERE id=$1`, [req.session.userId]);
    const user = userR.rows[0];
    const margins = await getSiteMargins(site, user);
    const isDefaultSite2 = !site || site.id === 'default';
    let { charge: calcCharge, apiCost, orderCostKrw } = computeOrderAmounts(svc, qtyNum, site, margins);
    let charge = calcCharge;
    const adminCreditOnly = !isDefaultSite2 && user && ['admin', 'partner'].includes(user.role);
    if (adminCreditOnly) charge = 0;

    if (!adminCreditOnly && (user.balance || 0) < charge) {
      const shortfall = Math.ceil(charge - (user.balance || 0));
      return res.json({ error: `잔액이 약 ₩${shortfall.toLocaleString()} 부족합니다. 충전 탭에서 충전 후 다시 주문해 주세요.` });
    }

    const prov = serviceProvider(svc);
    const apiKey = await getPanelApiKey(prov);
    if (!apiKey || !svc.api_id) {
      return res.json({ error: '현재 이 상품은 주문을 받을 수 없습니다. 다른 상품을 선택해주세요.' });
    }

    // 공급 카탈로그에 없는(삭제·중단) SKU면 주문 차단 + 상품 숨김
    if (prov === 'smmkings') {
      await ensureSmmkingsCatalogLoaded().catch(() => null);
      if (smmkingsCatalogCache.size > 0 && !smmkingsCatalogCache.has(String(svc.api_id))) {
        await hideServiceWithNote(svc.id, '공급이 중단되어 판매를 중단했습니다.');
        return res.json({ error: '이 상품은 공급이 중단되어 주문할 수 없습니다. 다른 상품을 선택해주세요.' });
      }
    } else {
      await ensurePeakerrCatalogLoaded().catch(() => null);
      if (peakerrCatalogCache.size > 0 && !peakerrCatalogCache.has(String(svc.api_id))) {
        await hideServiceWithNote(svc.id, '공급이 중단되어 판매를 중단했습니다.');
        return res.json({ error: '이 상품은 공급이 중단되어 주문할 수 없습니다. 다른 상품을 선택해주세요.' });
      }
    }

    const lockKey = orderLockKey(req.siteId, svc, linkNorm);
    if (orderPlacementLocks.has(lockKey)) {
      return res.json({ error: '같은 링크 주문이 처리 중입니다. 10초 후 다시 시도해주세요.' });
    }
    orderPlacementLocks.set(lockKey, Date.now());
    try {
      return await placeOrderHandler(req, res, {
        svc, linkNorm, qtyNum, site, margins, charge, apiCost, orderCostKrw,
        user, adminCreditOnly, apiKey, provider: prov
      });
    } finally {
      orderPlacementLocks.delete(lockKey);
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

async function placeOrderHandler(req, res, ctx) {
  try {
    const { svc, linkNorm, qtyNum, site, margins, charge, apiCost, orderCostKrw, user, adminCreditOnly, apiKey } = ctx;
    const provider = ctx.provider || serviceProvider(svc);
    let usedApiCost = apiCost;
    let usedOrderCostKrw = orderCostKrw;

    if (provider === 'smmkings') ensureSmmkingsCatalogLoaded({ background: true });
    else ensurePeakerrCatalogLoaded({ background: true });

    // 선택한 상품 기준만 검사 (대체 SKU는 실제 전환 시에만 재검사 — 과다 차단 방지)
    const creditErr = await assertPartnerCreditForOrder(site, margins, usedOrderCostKrw);
    if (creditErr) return res.json({ error: creditErr });

    const conflict = await findActiveOrderConflict(req.siteId, linkNorm, svc);
    if (conflict) {
      const label = conflict.bucket || svc.name;
      return res.json({ error: `이 링크로 ${label} 작업이 진행 중입니다. 중복 주문을 차단했습니다.` });
    }

    const placement = await placeOrderWithFallback(apiKey, svc, linkNorm, qtyNum, req.siteId);
    if (!placement.ok) {
      const failId = 'O' + Date.now();
      const errMsg = placement.linkError || isPeakerrLinkError(placement.error)
        ? linkHintForService(svc)
        : /balance|insufficient|not enough|잔액|부족/i.test(placement.error || '')
          ? '일시적 사유로 주문이 지연되고 있습니다. 잠시 후 다시 시도해주세요.'
          : `주문 접수에 실패했습니다. (${stripSupplierBrand(placement.error) || '접수 거절'})`;
      try {
        await query(`INSERT INTO orders(id,site_id,uid,uname,sid,sname,pl,api_order_id,link,qty,charge,status,api_provider) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [failId, req.siteId, user.id, user.name, svc.id, svc.name, svc.pl, null, linkNorm, qtyNum, 0, 'failed', provider]);
      } catch (e) {}
      console.log('주문 실패:', svc.id, provider, placement.error);
      return res.json({ error: errMsg });
    }

    const usedSvc = placement.usedSvc || svc;
    const usedProvider = placement.provider || serviceProvider(usedSvc) || provider;
    if (usedSvc.id !== svc.id) {
      const altAmounts = computeOrderAmounts(usedSvc, qtyNum, site, margins);
      usedApiCost = altAmounts.apiCost;
      usedOrderCostKrw = altAmounts.orderCostKrw;
      const altCreditErr = await assertPartnerCreditForOrder(site, margins, usedOrderCostKrw);
      if (altCreditErr) {
        return res.json({ error: altCreditErr });
      }
    }

    let apiOrderId = placement.apiOrderId || null;
    const orderId = 'O' + Date.now();
    const orderCost = usedOrderCostKrw;

    // ① 공급사 ID 확정 전 — pending + 차감 보류 (손실·이중차감 방지)
    try {
      await query(`INSERT INTO orders(id,site_id,uid,uname,sid,sname,pl,api_order_id,link,qty,charge,status,cost,api_cost,paid,api_provider) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [orderId, req.siteId, user.id, user.name, usedSvc.id, usedSvc.name, usedSvc.pl, apiOrderId, linkNorm, qtyNum, charge, 'pending', orderCost, usedApiCost, 0, usedProvider]);
    } catch (insertErr) {
      console.log('주문 INSERT 실패:', insertErr.message);
      return res.json({ error: '주문 저장 실패. 다시 시도해주세요.' });
    }

    let snapOrder = (await query(`SELECT * FROM orders WHERE id=$1`, [orderId])).rows[0];
    if (!apiOrderId && usedProvider === 'peakerr') {
      await new Promise(r => setTimeout(r, 1800));
      apiOrderId = await reconcileOrderMissingApiId(snapOrder);
      if (apiOrderId) {
        await query(`UPDATE orders SET api_order_id=$1 WHERE id=$2`, [apiOrderId, orderId]);
        snapOrder = (await query(`SELECT * FROM orders WHERE id=$1`, [orderId])).rows[0];
      }
    }
    if (!apiOrderId && usedProvider === 'peakerr') {
      await new Promise(r => setTimeout(r, 2500));
      snapOrder = (await query(`SELECT * FROM orders WHERE id=$1`, [orderId])).rows[0];
      apiOrderId = await reconcileOrderMissingApiId(snapOrder);
      if (apiOrderId) {
        await query(`UPDATE orders SET api_order_id=$1 WHERE id=$2`, [apiOrderId, orderId]);
        snapOrder = (await query(`SELECT * FROM orders WHERE id=$1`, [orderId])).rows[0];
      }
    }

    if (!apiOrderId) {
      await tgOrderNotify('⚠️ <b>작업 번호 미확인</b>', {
        id: orderId, site_id: req.siteId, uid: user.id, uname: user.name,
        sid: usedSvc.id, sname: usedSvc.name, link: linkNorm, qty: qtyNum, api_order_id: null
      }, {
        actorId: user.id,
        site,
        extra: '💰 차감 없음 · 자동 복구 시도 중'
      });
      return res.json({
        ok: true, orderId, apiOrderId: null, balance: user.balance,
        message: '작업 번호 확인 중입니다. 확인되면 자동 차감·처리됩니다. (잠시 후 🔄 새로고침)',
        pendingVerify: true,
        adminCreditOnly: !!adminCreditOnly
      });
    }

    // ② ID 확정 → 차감 + processing
    const confirmed = await confirmPendingOrderPayment({ ...snapOrder, api_order_id: apiOrderId });
    if (!confirmed) {
      return res.json({ error: '잔액이 부족해 주문을 확정할 수 없습니다. 충전 탭에서 충전 후 새로고침해 주세요.' });
    }
    snapOrder = confirmed;

    if (snapOrder?.api_order_id) {
      await pullPeakerrOrderSnapshot(snapOrder, apiKey, { delayMs: 1200, startPollTries: 5, provider: usedProvider });
      snapOrder = (await query(`SELECT * FROM orders WHERE id=$1`, [orderId])).rows[0];
      if (!(snapOrder?.starts_count > 0)) {
        await backfillOrderStartCount(snapOrder);
        snapOrder = (await query(`SELECT * FROM orders WHERE id=$1`, [orderId])).rows[0];
      }
    }

    const finalOrder = snapOrder || (await query(`SELECT * FROM orders WHERE id=$1`, [orderId])).rows[0];
    const startCount = parseInt(finalOrder?.starts_count || 0, 10);
    const goalCount = startCount + qtyNum;

    const updR = await query(`SELECT * FROM users WHERE id=$1`, [user.id]);
    const custBal = Math.round(updR.rows[0]?.balance || 0);
    const altNote = usedSvc.id !== svc.id ? `\n↪️ 대체 SKU: ${usedSvc.name}` : '';
    const payLine = adminCreditOnly
      ? `💰 크레딧 $${usedApiCost.toFixed(4)}`
      : `💰 ₩${Math.round(charge).toLocaleString()} · 잔액 ₩${custBal.toLocaleString()}`;
    let extra = payLine + altNote;
    if (startCount > 0) extra += `\n📊 시작 ${startCount.toLocaleString()} → 목표 ${goalCount.toLocaleString()}`;
    await tgOrderNotify('📦 <b>새 주문</b>', finalOrder, {
      actorId: user.id,
      site,
      extra
    });
    
    // 💵 Peakerr 잔액 체크 (비동기, 주문 처리와 별도로)
    checkPeakerrBalance().catch(e => console.log('잔액 체크 실패:', e.message));

    let creditKrwAfter = null;
    if (adminCreditOnly && site && site.id !== 'default') {
      const siteEx = (site.exrate > 0) ? site.exrate : margins.ex;
      const siteR2 = await query(`SELECT credit FROM sites WHERE id=$1`, [site.id]);
      creditKrwAfter = await getCreditBalanceKrw(site.id, siteR2.rows[0]?.credit, siteEx);
    }
    
    res.json({
      ok: true, orderId, balance: updR.rows[0].balance,
      message: apiOrderId
        ? '작업 신청이 접수되었습니다.'
        : '작업 신청이 접수되었습니다. 확인 중입니다.',
      adminCreditOnly: !!adminCreditOnly,
      creditDeductedKrw: adminCreditOnly ? Math.round(usedOrderCostKrw) : null,
      creditKrw: creditKrwAfter,
      pendingVerify: !apiOrderId,
      startCount: startCount > 0 ? startCount : null,
      goalCount: startCount > 0 ? goalCount : null,
      remains: finalOrder?.remains != null ? finalOrder.remains : null
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

app.get('/api/orders/my', requireAuth, async (req, res) => {
  try {
    await syncActiveOrdersForUser(req.session.userId).catch(() => null);
    const r = await query(`SELECT * FROM orders WHERE uid=$1 ORDER BY created DESC`, [req.session.userId]);
    const isSuper = req.session.role === 'superadmin';
    res.json(r.rows.map(o => sanitizeOrderForClient(o, isSuper)));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 🔄 고객이 주문 상태 실시간 새로고침 (Peakerr에서 직접 조회)
app.post('/api/orders/refresh/:orderId', requireAuth, async (req, res) => {
  try {
    let order = await findOrderForCancel(req.params.orderId, req);
    if (!order) return res.json({ error: '주문을 찾을 수 없습니다' });
    if (!order.api_order_id) {
      const recovered = await reconcileOrderMissingApiId(order);
      if (recovered) {
        await query(`UPDATE orders SET api_order_id=$1 WHERE id=$2`, [recovered, order.id]);
        const updR = await query(`SELECT * FROM orders WHERE id=$1`, [order.id]);
        order = updR.rows[0];
      } else {
        return res.json({ error: '작업 번호 확인 중입니다. 1~2분 후 🔄 새로고침 해주세요.' });
      }
    }
    
    const apiKey = await getPeakerrApiKey();
    if (!apiKey) return res.json({ error: 'API 키 미설정' });
    
    await pullPeakerrOrderSnapshot(order, apiKey, { startPollTries: 5 });
    let updR = await query(`SELECT * FROM orders WHERE id=$1`, [order.id]);
    let updated = updR.rows[0];
    if (updated && parseInt(updated.starts_count || 0, 10) <= 0) {
      await backfillOrderStartCount(updated);
      updR = await query(`SELECT * FROM orders WHERE id=$1`, [order.id]);
    }
    res.json({
      ok: true,
      order: sanitizeOrderForClient(updR.rows[0], req.session?.role === 'superadmin'),
      status: updR.rows[0]?.status
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 🚫 주문 취소 (고객 본인 · 사이트 관리자)
app.post('/api/orders/cancel/:orderId', requireAuth, async (req, res) => {
  try {
    const order = await findOrderForCancel(req.params.orderId, req);
    if (!order) return res.json({ error: '주문을 찾을 수 없습니다' });
    const result = await cancelOrderWithPeakerr(order, { adminId: req.session.userId || 'system' });
    if (!result.ok) return res.json({ error: result.error });
    res.json({
      ok: true, message: result.message, refunded: (result.refundPercent || 0) > 0,
      refundAmount: result.refundAmount, creditRefund: result.creditRefund, status: result.status
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 🎁 포인트 → 잔액 전환
app.post('/api/points/convert', requireAuth, async (req, res) => {
  try {
    const userR = await query(`SELECT * FROM users WHERE id=$1`, [req.session.userId]);
    const user = userR.rows[0];
    if (!user) return res.json({ error: '사용자 없음' });
    const points = Math.floor(user.points || 0);
    if (points <= 0) return res.json({ error: '전환할 포인트가 없습니다' });
    const canUse = await userCanUsePoints(user.id, req.siteId, user.role);
    if (!canUse) {
      return res.json({ error: '포인트는 잔액 충전(승인 완료) 후 사용할 수 있습니다. 충전 탭에서 먼저 충전해 주세요.' });
    }
    // 1포인트 = 1원
    await query(`UPDATE users SET balance=balance+$1, points=0 WHERE id=$2`, [points, user.id]);
    await logBalance(user.site_id, user.id, user.name, points,
      user.balance, user.balance + points, `포인트 전환 (${points}P → ₩${points.toLocaleString()})`, 'system');
    res.json({ ok: true, converted: points });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/charges', requireAuth, async (req, res) => {
  try {
    const userR = await query(`SELECT * FROM users WHERE id=$1`, [req.session.userId]);
    const user = userR.rows[0];
    const siteR = await query(`SELECT * FROM sites WHERE id=$1`, [req.siteId]);
    const site = siteR.rows[0];
    if (site && site.id !== 'default' && user && ['admin', 'partner'].includes(user.role))
      return res.json({ error: '관리자는 크레딧으로 주문하세요. 관리자 → 크레딧 요청을 이용해주세요.' });
    const { amount, note } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt < 5000) return res.json({ error: '최소 ₩5,000 이상' });
    const id = 'C' + Date.now();
    await query(`INSERT INTO charges(id,site_id,uid,uname,amount,note,status) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [id, req.siteId, user.id, user.name, amt, note || '', 'pending']);
    // 요청자 role 전달 → 관리자 본인 요청이면 슈퍼관리자에게, 일반 회원이면 사이트 관리자에게
    tgChargeAlert(id, user.name, amt, note, req.site || {name:'GLOW'}, user.role, user.balance || 0);
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
    const isSuper = req.session.role === 'superadmin';
    const siteId = isSuper ? null : req.siteId;
    const validStatuses = `o.status NOT IN ('cancelled','canceled','failed','refunded','partial_refunded')`;
    let users, orders, pending;
    if (siteId) {
      users   = await query(`SELECT COUNT(*) as c FROM users WHERE role=$1 AND site_id=$2`, ['user', siteId]);
      orders  = await query(`SELECT COUNT(*) as c FROM orders WHERE site_id=$1`, [siteId]);
      pending = await query(`SELECT COUNT(*) as c FROM charges WHERE status=$1 AND site_id=$2`, ['pending', siteId]);
    } else {
      users   = await query(`SELECT COUNT(*) as c FROM users WHERE role=$1`, ['user']);
      orders  = await query(`SELECT COUNT(*) as c FROM orders`);
      pending = await query(`SELECT COUNT(*) as c FROM charges WHERE status=$1`, ['pending']);
    }
    // 매출/원가 — 주문자 role별로 분리 집계 (orders ⨝ users)
    // customer = 일반 회원 주문, admin = 관리자 본인 주문
    const siteCond = siteId ? `AND o.site_id = $1` : ``;
    const params = siteId ? [siteId] : [];
    const statQ = await query(`
      SELECT
        COALESCE(u.role,'user') as role,
        SUM(o.charge) as revenue,
        SUM(o.cost) as cost
      FROM orders o
      LEFT JOIN users u ON o.uid = u.id
      WHERE ${validStatuses} ${siteCond}
      GROUP BY COALESCE(u.role,'user')
    `, params);
    let custRev = 0, custCost = 0, admRev = 0, admCost = 0;
    statQ.rows.forEach(r => {
      const rev = parseFloat(r.revenue) || 0;
      const cst = parseFloat(r.cost) || 0;
      if (r.role === 'user') { custRev += rev; custCost += cst; }
      else {
        // 파트너 관리자 본인 작업 = 크레딧(cost)만 집계, charge(구 잔액차감)는 무시
        admCost += cst > 0 ? cst : rev;
      }
    });
    const credit = isSuper ? null : (req.site?.credit || 0);
    const globalEx = parseFloat((await getGlobalSetting('global_exrate')) || '1500');
    const siteEx = (req.site && req.site.exrate > 0) ? req.site.exrate : globalEx;
    if (!isSuper && siteId) await reconcileSiteCreditUsdFromLedger(siteId).catch(() => null);
    const creditKrw = (!isSuper && siteId)
      ? await getCreditBalanceKrw(siteId, credit, siteEx)
      : null;

    // 슈퍼관리자 → 크레딧·마진 기준 / 파트너 → 고객 주문만 매출
    const totalRev = custRev + admRev;
    const totalCost = custCost + admCost;
    let creditSoldKrw = null, totalCreditBalanceKrw = null, superProfitKrw = null, peakerrCostKrw = null;
    if (isSuper) {
      const crAp = await query(`SELECT COALESCE(SUM(amount),0) as s FROM credit_requests WHERE status='approved' AND site_id <> 'default'`);
      creditSoldKrw = Math.round(parseFloat(crAp.rows[0].s) || 0);
      const apiCostR = await query(`
        SELECT COALESCE(SUM(o.qty * s.rate / 1000.0),0) as s
        FROM orders o JOIN services s ON o.sid = s.id
        WHERE ${validStatuses}`);
      const superMgPct = parseFloat((await getGlobalSetting('super_margin')) || '50') / 100;
      peakerrCostKrw = Math.round((parseFloat(apiCostR.rows[0].s) || 0) * globalEx);
      superProfitKrw = Math.round(peakerrCostKrw * superMgPct);
      const partnerSitesR = await query(`SELECT id, credit, exrate FROM sites WHERE id <> 'default' AND active=1`);
      let balSum = 0;
      for (const ps of partnerSitesR.rows) {
        const psEx = parseFloat(ps.exrate) > 0 ? parseFloat(ps.exrate) : globalEx;
        balSum += await getCreditBalanceKrw(ps.id, ps.credit, psEx);
      }
      totalCreditBalanceKrw = balSum;
    }
    let apiBalance = null, apiBalanceError = null;
    if (isSuper) {
      const balR = await fetchPeakerrBalance(await getPeakerrApiKey());
      if (balR.ok) apiBalance = balR.balance.toFixed(2);
      else apiBalanceError = balR.error;
    }

    const payload = {
      users: parseInt(users.rows[0].c),
      orders: parseInt(orders.rows[0].c),
      revenue: isSuper ? custRev : custRev,
      cost: isSuper ? admCost : custCost,
      profit: isSuper ? (superProfitKrw || 0) : (custRev - custCost),
      adminRevenue: admRev,
      adminCost: admCost,
      pendingCharges: parseInt(pending.rows[0].c),
      credit,
      creditKrw,
      exrate: siteEx,
      isSuper,
      creditSoldKrw,
      totalCreditBalanceKrw,
      superProfitKrw,
      peakerrCostKrw,
      partnerRetailRev: custRev,
      apiBalance,
      apiBalanceError,
    };

    if (!isSuper && isHismarketingShowcaseRequest(req)) {
      Object.assign(payload, getShowcaseStats());
    }

    res.json(payload);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    if (isHismarketingShowcaseRequest(req)) {
      return res.json(getShowcaseOrders());
    }
    const siteId = req.session.role === 'superadmin' ? null : req.siteId;
    await syncActiveOrdersForSite(siteId).catch(() => null);
    await backfillPartnerOrderCosts().catch(() => null);
    const r = siteId
      ? await query(`SELECT o.*, u.role AS user_role FROM orders o LEFT JOIN users u ON o.uid=u.id WHERE o.site_id=$1 ORDER BY o.created DESC`, [siteId])
      : await query(`
          SELECT o.*, u.role AS user_role, s.name AS site_name
          FROM orders o
          LEFT JOIN users u ON o.uid=u.id
          LEFT JOIN sites s ON o.site_id=s.id
          ORDER BY o.created DESC
        `);
    const isSuper = req.session.role === 'superadmin';
    res.json(r.rows.map(o => sanitizeOrderForClient(o, isSuper)));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/orders/sync-active', requireAdmin, async (req, res) => {
  try {
    if (isHismarketingShowcaseRequest(req)) {
      return res.json({ ok: true, synced: 2, total: 2 });
    }
    const siteId = req.session.role === 'superadmin' ? null : req.siteId;
    const stats = await syncActiveOrdersForSite(siteId);
    res.json({ ok: true, synced: stats?.synced || 0, total: (stats?.synced || 0) + (stats?.errors || 0) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/orders/status', requireAdmin, async (req, res) => {
  try {
    const { id, status } = req.body;
    if (isShowcaseId(id)) return res.json({ ok: true });
    const orderR = await query(`SELECT * FROM orders WHERE id=$1`, [id]);
    const order = orderR.rows[0];
    if (!order) return res.json({ error: '주문을 찾을 수 없습니다' });

    // 사이트 권한 체크
    if (req.session.role !== 'superadmin' && order.site_id !== req.siteId) {
      return res.json({ error: '다른 사이트 주문은 변경할 수 없습니다' });
    }

    // ⚠️ '취소'로 변경 시 Peakerr 취소 + 자동 환불
    const alreadyDone = ['refunded', 'partial_refunded', 'cancelled', 'canceled'].includes(order.status);
    if ((status === 'cancelled' || status === 'canceled') && !alreadyDone) {
      const result = await cancelOrderWithPeakerr(order, { adminId: req.session.userId });
      if (!result.ok) return res.json({ error: result.error });
      return res.json({
        ok: true, refunded: true,
        refundAmount: result.refundAmount, creditRefund: result.creditRefund,
        message: result.message
      });
    }

    // Peakerr 연동 주문 — 수동 상태 변경 금지 (동기화·취소 API만 허용)
    if (order.api_order_id && status !== order.status) {
      return res.json({ error: '자동 동기화 주문은 수동 상태 변경이 불가합니다. 🔄 새로고침으로 동기화하거나 ✕ 취소를 사용하세요.' });
    }

    // 그 외 상태 변경은 단순 변경 (API 미연동 주문만)
    await query(`UPDATE orders SET status=$1 WHERE id=$2`, [status, id]);
    await logActivity(req.siteId, req.session.userId, '', '주문 상태 변경', 'order', id, `상태: ${status}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 💸 주문 환불 (고객 잔액 복구 + 주문 상태 변경)
app.post('/api/admin/orders/refund', requireAdmin, async (req, res) => {
  try {
    const { id, refundPercent } = req.body;
    if (isShowcaseId(id)) return res.json({ ok: true, refundAmount: 0, creditRefund: 0 });
    const pct = Math.min(Math.max(parseFloat(refundPercent) || 100, 0), 100);
    
    const orderR = await query(`SELECT * FROM orders WHERE id=$1`, [id]);
    const order = orderR.rows[0];
    if (!order) return res.json({ error: '주문을 찾을 수 없습니다' });
    if (['refunded', 'partial_refunded', 'cancelled', 'canceled'].includes(order.status)) {
      return res.json({ error: '이미 환불·취소된 주문입니다' });
    }
    
    // 사이트 권한 체크
    if (req.session.role !== 'superadmin' && order.site_id !== req.siteId) {
      return res.json({ error: '다른 사이트 주문은 환불할 수 없습니다' });
    }

    // Peakerr 연동 주문 — Peakerr 취소 확인 후에만 환불 (손실 방지)
    if (order.api_order_id) {
      if (pct >= 100) {
        const result = await cancelOrderWithPeakerr(order, { adminId: req.session.userId });
        if (!result.ok) return res.json({ error: result.error });
        return res.json({
          ok: true, refundAmount: result.refundAmount, creditRefund: result.creditRefund,
          message: result.message
        });
      }
      return res.json({ error: '자동 동기화 주문은 부분 환불을 수동으로 할 수 없습니다. 🔄 새로고침으로 상태를 동기화해주세요.' });
    }
    
    const fin = await restoreRefundFinancials(order, pct, {
      reason: `주문 환불 (${pct}%) - 주문 ${id}`,
      adminId: req.session.userId
    });
    if (fin.error) return res.json({ error: fin.error });
    if (fin.alreadyRefunded) return res.json({ error: '이미 환불된 주문입니다' });
    
    const newStatus = pct >= 100 ? 'refunded' : 'partial_refunded';
    await query(`UPDATE orders SET status=$1, cost=$2 WHERE id=$3`, [newStatus, fin.newCost, id]);
    
    await logActivity(
      req.siteId, req.session.userId, '',
      '주문 환불', 'order', id,
      `${pct}% 환불 (₩${(fin.refundAmount || 0).toLocaleString()})` +
        (fin.creditRefund ? ` · 크레딧 $${fin.creditRefund.toFixed(4)} 복구` : '')
    );
    
    res.json({ ok: true, refundAmount: fin.refundAmount, creditRefund: fin.creditRefund });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/** 슈퍼 — 완료 주문도 품질 이슈 시 강제 환불 (Peakerr 취소 불가·공급 불량) */
app.post('/api/super/orders/force-refund', requireSuperAdmin, async (req, res) => {
  try {
    const { id, reason } = req.body || {};
    if (!id) return res.json({ error: '주문 ID 필요' });
    const orderR = await query(`SELECT * FROM orders WHERE id=$1`, [id]);
    const order = orderR.rows[0];
    if (!order) return res.json({ error: '주문을 찾을 수 없습니다' });
    if (['refunded', 'partial_refunded', 'cancelled', 'canceled'].includes(order.status)) {
      return res.json({ error: '이미 환불·취소된 주문입니다' });
    }
    const fin = await restoreRefundFinancials(order, 100, {
      reason: reason || `슈퍼 강제 환불 - ${id}`,
      adminId: req.session.userId
    });
    if (fin.alreadyRefunded) return res.json({ error: '이미 환불된 주문입니다' });
    await query(`UPDATE orders SET status='refunded', cost=$1 WHERE id=$2`, [fin.newCost, id]);
    await tgOrderNotify('💸 <b>강제 환불</b>', order, {
      actorId: req.session.userId,
      extra: `💰 크레딧 $${(fin.creditRefund || 0).toFixed(4)} 복구\n📝 ${reason || '품질 이슈'}`
    }).catch(() => null);
    res.json({
      ok: true,
      refundAmount: fin.refundAmount,
      creditRefund: fin.creditRefund,
      message: '강제 환불 완료 (Peakerr 취소 없이 크레딧·잔액 복구)'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 주문 내역 삭제 (관리자 전용 · 끝난 주문만 삭제 가능 · 기록 정리용)
// ⚠️ 처리중(processing)·대기(pending) 주문은 추적이 끊기므로 삭제 불가
//    삭제는 '기록 정리'이며 이미 처리된 환불·정산에는 영향 없음
app.post('/api/admin/orders/delete', requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (isShowcaseId(id)) return res.json({ ok: true });
    if (!id) return res.json({ error: '삭제할 주문을 지정해주세요' });
    const r = await query(`SELECT * FROM orders WHERE id=$1`, [id]);
    const order = r.rows[0];
    if (!order) return res.json({ error: '주문을 찾을 수 없습니다' });
    // 권한: 슈퍼관리자는 전체, 일반 관리자는 자기 사이트 건만
    if (req.session.role !== 'superadmin' && order.site_id !== req.siteId) {
      return res.json({ error: '다른 사이트의 주문은 삭제할 수 없습니다' });
    }
    // 끝난 주문만 삭제 가능 (처리중·대기 주문은 보호)
    const deletable = ['cancelled', 'canceled', 'failed', 'completed', 'refunded', 'partial_refunded'];
    if (!deletable.includes(order.status)) {
      return res.json({ error: '진행 중인 주문은 삭제할 수 없습니다. 완료·취소·환불된 주문만 삭제 가능합니다.' });
    }
    await query(`DELETE FROM orders WHERE id=$1`, [id]);
    await logActivity(req.siteId, req.session.userId, '', '주문 내역 삭제', 'order', id,
      `${order.sname} ₩${Math.round(order.charge).toLocaleString()} (${order.status})`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const siteId = req.session.role === 'superadmin' ? null : req.siteId;
    const r = siteId
      ? await query(`
          SELECT u.*, s.name AS site_name, s.domain AS site_domain
          FROM users u
          LEFT JOIN sites s ON u.site_id = s.id
          WHERE u.site_id=$1 AND u.role!='superadmin' AND COALESCE(u.status,'active') <> 'deleted'
          ORDER BY u.role, u.joined DESC
        `, [siteId])
      : await query(`
          SELECT u.*, s.name AS site_name, s.domain AS site_domain
          FROM users u
          LEFT JOIN sites s ON u.site_id = s.id
          WHERE u.role != 'superadmin' AND COALESCE(u.status,'active') <> 'deleted'
          ORDER BY COALESCE(s.name, u.site_id), u.role, u.joined DESC
        `);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/balance', requireAdmin, async (req, res) => {
  try {
    const { uid, delta, reason } = req.body;
    const deltaNum = parseFloat(delta);
    if (isNaN(deltaNum)) return res.json({ error: '올바른 금액을 입력하세요' });
    if (Math.abs(deltaNum) > 10000000) return res.json({ error: '한 번에 천만원 이상 조정은 불가합니다. 분할 진행해주세요.' });
    
    // 변경 전 잔액 조회
    const beforeR = await query(`SELECT * FROM users WHERE id=$1`, [uid]);
    const beforeUser = beforeR.rows[0];
    if (!beforeUser) return res.json({ error: '회원을 찾을 수 없습니다' });
    const denyBal = adminUserManageDenied(req, beforeUser);
    if (denyBal) return res.json({ error: denyBal });
    const beforeBal = beforeUser.balance || 0;
    
    await query(`UPDATE users SET balance=GREATEST(0,balance+$1) WHERE id=$2`, [deltaNum, uid]);
    const r = await query(`SELECT * FROM users WHERE id=$1`, [uid]);
    const afterBal = r.rows[0].balance || 0;
    
    // 💰 잔액 변동 로그 기록
    await logBalance(
      req.siteId, uid, beforeUser.name, deltaNum, 
      beforeBal, afterBal, 
      reason || '관리자 수동 조정', 
      req.session.userId
    );
    await logActivity(
      req.siteId, req.session.userId, '',
      '잔액 조정', 'user', uid,
      `${deltaNum > 0 ? '+' : ''}${deltaNum.toLocaleString()}원 (사유: ${reason || '없음'})`
    );
    
    res.json({ ok: true, balance: afterBal });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/ban', requireAdmin, async (req, res) => {
  try {
    const { uid } = req.body;
    const r = await query(`SELECT * FROM users WHERE id=$1`, [uid]);
    const user = r.rows[0];
    const deny = adminUserManageDenied(req, user);
    if (deny) return res.json({ error: deny });
    if (['admin', 'partner'].includes(user.role) && req.session.role !== 'superadmin') {
      return res.json({ error: '관리자 계정은 정지할 수 없습니다' });
    }
    const newStatus = user.status === 'banned' ? 'active' : 'banned';
    await query(`UPDATE users SET status=$1 WHERE id=$2`, [newStatus, uid]);
    await logActivity(req.siteId, req.session.userId, '', newStatus === 'banned' ? '회원 정지' : '회원 정지 해제', 'user', uid, user.email);
    res.json({ ok: true, status: newStatus });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/delete', requireAdmin, async (req, res) => {
  try {
    const { uid, confirmEmail } = req.body;
    const r = await query(`SELECT * FROM users WHERE id=$1`, [uid]);
    const user = r.rows[0];
    const deny = adminUserManageDenied(req, user);
    if (deny) return res.json({ error: deny });
    if (['admin', 'partner', 'superadmin'].includes(user.role)) {
      return res.json({ error: '관리자 계정은 탈퇴 처리할 수 없습니다. 정지를 이용하세요.' });
    }
    const emailNorm = String(confirmEmail || '').trim().toLowerCase();
    if (!emailNorm || emailNorm !== String(user.email || '').trim().toLowerCase()) {
      return res.json({ error: '안전 확인: 회원 이메일을 정확히 입력해 주세요.' });
    }
    // 주문·충전·포인트 DB 보존 — 로그인만 차단 (소프트 탈퇴)
    await query(
      `UPDATE users SET status='deleted', deleted_at=NOW(), deleted_by=$1 WHERE id=$2`,
      [req.session.userId, uid]
    );
    await logActivity(
      req.siteId, req.session.userId, '',
      '회원 탈퇴(데이터 보존)', 'user', uid,
      `${user.name} · ${user.email} · 잔액 ₩${Math.round(user.balance || 0).toLocaleString()}`
    );
    res.json({ ok: true, soft: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/resetpw', requireAdmin, async (req, res) => {
  try {
    const { uid, newpw } = req.body;
    if (!newpw || newpw.length < 6) return res.json({ error: '6자 이상 입력하세요' });
    const hash = bcrypt.hashSync(newpw, 10);
    await query(`UPDATE users SET pw=$1 WHERE id=$2`, [hash, uid]);
    // 활동 로그
    await logActivity(req.siteId, req.session.userId, '', '비밀번호 리셋', 'user', uid, '관리자가 비밀번호 변경');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/** 관리자 — 비번 재설정 링크 생성 (관리자 화면에서 URL 확인용, TG 알림 없음) */
app.post('/api/admin/users/reset-link', requireAdmin, async (req, res) => {
  try {
    const { uid } = req.body;
    const r = await query(`SELECT * FROM users WHERE id=$1`, [uid]);
    const user = r.rows[0];
    const deny = adminUserManageDenied(req, user);
    if (deny) return res.json({ error: deny });
    if (!user) return res.json({ error: '회원을 찾을 수 없습니다' });
    if (user.status === 'deleted') return res.json({ error: '탈퇴한 회원입니다' });

    const site = req.site || (await query(`SELECT * FROM sites WHERE id=$1`, [user.site_id])).rows[0];
    const token = await createPasswordResetToken(user, user.site_id || req.siteId);
    const resetUrl = buildPasswordResetUrl(site, token);
    const siteName = site?.name || '사이트';

    let emailed = false;
    const sent = await sendEmail(
      user.email,
      `[${siteName}] 비밀번호 재설정 안내`,
      buildPasswordResetEmailHtml(siteName, user.name, resetUrl),
      { siteName }
    );
    emailed = !!sent.ok;

    await logActivity(req.siteId, req.session.userId, '', '비밀번호 재설정 링크', 'user', uid, user.email);
    res.json({
      ok: true,
      resetUrl,
      emailed,
      expiresMin: 30,
      message: emailed
        ? '메일로 재설정 링크를 보냈습니다.'
        : '재설정 링크를 만들었습니다. (고객은 로그인 화면에서 닉네임으로도 직접 재설정 가능)'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/role', requireAdmin, async (req, res) => {
  try {
    const { uid, role } = req.body;
    if (uid === req.session.userId) return res.json({ error: '본인 등급은 변경 불가' });
    await query(`UPDATE users SET role=$1 WHERE id=$2`, [role, uid]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/margin', requireAdmin, async (req, res) => {
  try {
    if (req.session.role === 'superadmin') {
      return res.json({ error: '회원별 마진은 파트너 사이트 관리자 전용입니다' });
    }
    if (req.siteId === 'default') {
      return res.json({ error: '본사 사이트는 사이트 마진 설정을 사용하세요' });
    }
    const { uid, margin } = req.body;
    if (!uid) return res.json({ error: '회원을 지정해주세요' });

    const userR = await query(`SELECT * FROM users WHERE id=$1`, [uid]);
    const user = userR.rows[0];
    if (!user) return res.json({ error: '회원을 찾을 수 없습니다' });
    if (user.site_id !== req.siteId) return res.json({ error: '다른 사이트 회원은 수정할 수 없습니다' });
    if (user.role !== 'user') return res.json({ error: '일반 회원만 개별 마진을 설정할 수 있습니다' });

    let marginVal = null;
    if (margin !== null && margin !== undefined && String(margin).trim() !== '') {
      marginVal = parseFloat(margin);
      if (isNaN(marginVal) || marginVal < 0 || marginVal > 500) {
        return res.json({ error: '마진율은 0~500% 사이여야 합니다' });
      }
    }

    await query(`UPDATE users SET margin=$1 WHERE id=$2`, [marginVal, uid]);
    const siteR = await query(`SELECT margin FROM sites WHERE id=$1`, [req.siteId]);
    const siteDefaultMargin = siteR.rows[0]?.margin ?? 0;
    await logActivity(
      req.siteId, req.session.userId, '',
      '회원 마진 변경', 'user', uid,
      marginVal == null ? `사이트 기본(${siteDefaultMargin}%)으로 복원` : `${marginVal}%`
    );
    res.json({ ok: true, margin: marginVal, siteDefaultMargin });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users/:uid/detail', requireAdmin, async (req, res) => {
  try {
    const userR = await query(`SELECT id,name,email,phone,role,balance,status,joined,margin,site_id FROM users WHERE id=$1`, [req.params.uid]);
    if (!userR.rows[0]) return res.json({ error: '회원을 찾을 수 없습니다' });
    const user = userR.rows[0];
    const siteR = await query(`SELECT margin FROM sites WHERE id=$1`, [user.site_id]);
    const siteDefaultMargin = siteR.rows[0]?.margin ?? 0;
    const orders = await query(`SELECT * FROM orders WHERE uid=$1 ORDER BY created DESC`, [req.params.uid]);
    const charges = await query(`SELECT * FROM charges WHERE uid=$1 ORDER BY created DESC`, [req.params.uid]);
    // 💰 잔액 변동 로그 포함
    const balanceLogs = await query(`SELECT * FROM balance_logs WHERE user_id=$1 ORDER BY created DESC LIMIT 50`, [req.params.uid]);
    res.json({
      user,
      siteDefaultMargin,
      orders: orders.rows,
      charges: charges.rows,
      balanceLogs: balanceLogs.rows
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 📝 관리자 활동 로그 조회 (슈퍼관리자 또는 해당 사이트 관리자)
app.get('/api/admin/activity-logs', requireAdmin, async (req, res) => {
  try {
    const isSuper = req.session.role === 'superadmin';
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const r = isSuper
      ? await query(`SELECT * FROM activity_logs ORDER BY created DESC LIMIT $1`, [limit])
      : await query(`SELECT * FROM activity_logs WHERE site_id=$1 ORDER BY created DESC LIMIT $2`, [req.siteId, limit]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 💰 잔액 변동 로그 조회
app.get('/api/admin/balance-logs', requireAdmin, async (req, res) => {
  try {
    const isSuper = req.session.role === 'superadmin';
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const r = isSuper
      ? await query(`SELECT * FROM balance_logs ORDER BY created DESC LIMIT $1`, [limit])
      : await query(`SELECT * FROM balance_logs WHERE site_id=$1 ORDER BY created DESC LIMIT $2`, [req.siteId, limit]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/charges', requireAdmin, async (req, res) => {
  try {
    if (isHismarketingShowcaseRequest(req)) {
      return res.json(getShowcaseCharges());
    }
    const siteId = req.session.role === 'superadmin' ? null : req.siteId;
    const r = siteId
      ? await query(`SELECT c.*, s.name as site_name FROM charges c LEFT JOIN sites s ON c.site_id=s.id WHERE c.site_id=$1 ORDER BY c.created DESC`, [siteId])
      : await query(`SELECT c.*, s.name as site_name FROM charges c LEFT JOIN sites s ON c.site_id=s.id ORDER BY c.created DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/charges/process', requireAdmin, async (req, res) => {
  try {
    const { id, action } = req.body;
    if (isShowcaseId(id)) return res.json({ ok: true });
    const r = await query(`SELECT * FROM charges WHERE id=$1`, [id]);
    const charge = r.rows[0];
    if (!charge) return res.json({ error: '충전 요청을 찾을 수 없습니다' });
    if (action === 'approve') {
      const reqUserR = await query(`SELECT role FROM users WHERE id=$1`, [charge.uid]);
      const chargerRole = reqUserR.rows[0]?.role || 'user';
      if (charge.site_id && charge.site_id !== 'default' && ['admin', 'partner'].includes(chargerRole))
        return res.json({ error: '관리자는 크레딧으로 주문합니다. 잔액 충전 승인 불가.' });
    }
    const status = action === 'approve' ? 'approved' : 'rejected';
    await query(`UPDATE charges SET status=$1 WHERE id=$2`, [status, id]);
    if (action === 'approve') {
      // 잔액 변동 로그
      const beforeR = await query(`SELECT * FROM users WHERE id=$1`, [charge.uid]);
      const beforeBal = beforeR.rows[0]?.balance || 0;
      const chargerRole = beforeR.rows[0]?.role || 'user';
      // 💰 충전 보너스 — 금액 구간별, 일반 고객(user)에게만 지급
      let bonus = 0;
      if (chargerRole === 'user') {
        const bSiteR = await query(`SELECT charge_bonus_tiers FROM sites WHERE id=$1`, [charge.site_id]);
        bonus = calcChargeBonus(charge.amount, bSiteR.rows[0]?.charge_bonus_tiers);
      }
      const totalAdd = charge.amount + bonus;
      await query(`UPDATE users SET balance=balance+$1 WHERE id=$2`, [totalAdd, charge.uid]);
      const afterR = await query(`SELECT * FROM users WHERE id=$1`, [charge.uid]);
      const afterBal = afterR.rows[0]?.balance || 0;

      const bonusNote = bonus > 0 ? ` +보너스 ₩${bonus.toLocaleString()}` : '';
      await logBalance(
        charge.site_id, charge.uid, charge.uname, totalAdd,
        beforeBal, afterBal,
        `충전 승인 (${charge.note || '메모 없음'})${bonusNote}`,
        req.session.userId
      );
      tgAlert(`✅ 충전승인 [${req.site?.name}]\n👤 ${charge.uname}\n💰 ₩${Math.round(charge.amount).toLocaleString()}${bonusNote}`, req.site);
    }
    await logActivity(req.siteId, req.session.userId, '', `충전 ${action === 'approve' ? '승인' : '거절'}`, 'charge', id, `₩${Math.round(charge.amount).toLocaleString()}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 충전 내역 삭제 (관리자 전용 · DB 완전 삭제 · 모든 상태 삭제 가능)
// ⚠️ 삭제는 '기록 정리'이며 이미 지급된 잔액은 회수하지 않음
app.post('/api/admin/charges/delete', requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (isShowcaseId(id)) return res.json({ ok: true });
    if (!id) return res.json({ error: '삭제할 항목을 지정해주세요' });
    const r = await query(`SELECT * FROM charges WHERE id=$1`, [id]);
    const charge = r.rows[0];
    if (!charge) return res.json({ error: '충전 내역을 찾을 수 없습니다' });
    // 권한: 슈퍼관리자는 전체, 일반 관리자는 자기 사이트 건만 삭제 가능
    if (req.session.role !== 'superadmin' && charge.site_id !== req.siteId) {
      return res.json({ error: '다른 사이트의 충전 내역은 삭제할 수 없습니다' });
    }
    await query(`DELETE FROM charges WHERE id=$1`, [id]);
    await logActivity(req.siteId, req.session.userId, '', '충전 내역 삭제', 'charge', id,
      `₩${Math.round(charge.amount).toLocaleString()} (${charge.status})`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 관리자 서비스 활성화 목록 조회
app.get('/api/admin/site-services', requireAdmin, async (req, res) => {
  try {
    const siteId = req.siteId;
    if (siteId === 'default') return res.json({ error: '슈퍼관리자는 서비스 관리 탭을 이용하세요' });
    // 사이트 정보 가져오기
    const siteR = await query(`SELECT * FROM sites WHERE id=$1`, [siteId]);
    const site = siteR.rows[0];
    // 환율/슈퍼마진/글로벌 사이트마진
    const globalExrate = await getGlobalSetting('global_exrate');
    const ex = (site && site.exrate > 0) ? site.exrate : parseFloat(globalExrate || '1500');
    let superMg;
    if (site && site.super_margin >= 0) {
      superMg = site.super_margin;
    } else {
      const superMgStr = await getGlobalSetting('super_margin');
      superMg = parseFloat(superMgStr || '50');
    }
    const globalSiteMgStr = await getGlobalSetting('global_site_margin');
    const globalSiteMg = parseFloat(globalSiteMgStr || '50');
    const siteMg = site ? (site.margin != null ? site.margin : 0) : 0;
    
    // 판매중(사이트 ON) 상품만 — 미판매·미작동은 목록에서 제외
    const r = await query(`
      SELECT s.id, s.name, s.pl, s.rate, s.min, s.max, s.active as global_active,
        ss.active as site_active
      FROM services s
      INNER JOIN site_services ss ON s.id = ss.service_id AND ss.site_id = $1 AND ss.active = 1
      WHERE s.active = 1
      ORDER BY s.pl, s.rate ASC
    `, [siteId]);
    
    // 🔒 지인 보호: Peakerr 원가(rate) 숨기고 GLOW 판매가를 "원가"로 노출
    const hiddenServices = r.rows.map(s => {
      // GLOW 판매가 = 원가 × 슈퍼마진 × 글로벌사이트마진 (= 지인 입장의 "원가")
      const glowPricePer1000 = s.rate * ex * (1 + superMg / 100) * (1 + globalSiteMg / 100);
      const sellPer1000 = glowPricePer1000 * (1 + siteMg / 100);
      const baseCostPer1K = Math.max(Math.round(glowPricePer1000), 1);
      const sellPricePer1K = Math.max(Math.round(sellPer1000), 1);
      return {
        id: s.id, name: s.name, pl: s.pl, min: s.min, max: s.max,
        global_active: s.global_active, site_active: s.site_active,
        baseCost: baseCostPer1K,  // GLOW 판매가 (지인 입장의 원가, ₩/1K)
        sellPrice: sellPricePer1K  // 지인의 고객가 (₩/1K)
        // ⚠️ s.rate (Peakerr 진짜 원가)는 절대 내보내지 않음
      };
    });
    const hiddenR = await query(`
      SELECT s.id, s.name, s.pl, s.inactive_note, s.replace_service_id, s.inactive_at,
        rs.name AS replace_name
      FROM services s
      LEFT JOIN services rs ON rs.id = s.replace_service_id
      WHERE s.active = 0
        AND (
          COALESCE(TRIM(s.inactive_note), '') <> ''
          OR s.id = ANY($1::text[])
        )
      ORDER BY s.inactive_at DESC NULLS LAST, s.pl, s.name
      LIMIT 80
    `, [Array.from(PERMANENTLY_DISABLED_SEEDS)]);
    res.json({
      services: hiddenServices,
      hidden: hiddenR.rows.map(h => ({
        id: h.id,
        name: h.name,
        pl: h.pl,
        note: sanitizeHiddenServiceNote(h.inactive_note || '판매 중단'),
        replaceId: h.replace_service_id,
        replaceName: h.replace_name || null,
        inactiveAt: h.inactive_at
      }))
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 관리자 서비스 켜기/끄기
app.post('/api/admin/site-services/toggle', requireAdmin, async (req, res) => {
  try {
    const siteId = req.siteId;
    if (siteId === 'default') return res.json({ error: '슈퍼관리자는 서비스 관리 탭을 이용하세요' });
    const { serviceId, active } = req.body;
    await query(`
      INSERT INTO site_services(site_id, service_id, active)
      VALUES($1, $2, $3)
      ON CONFLICT(site_id, service_id) DO UPDATE SET active=$3
    `, [siteId, serviceId, active ? 1 : 0]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 관리자 서비스 전체 켜기/끄기
app.post('/api/admin/site-services/toggle-all', requireAdmin, async (req, res) => {
  try {
    const siteId = req.siteId;
    if (siteId === 'default') return res.json({ error: '슈퍼관리자 전용' });
    const { active } = req.body;
    // ⚠️ 더 이상 존재하지 않는 서비스를 가리키는 고아 레코드 정리
    //    (과거 services 전체 삭제 버그로 생긴 끊긴 레코드 제거)
    await query(`
      DELETE FROM site_services
      WHERE site_id=$1 AND service_id NOT IN (SELECT id FROM services WHERE active=1)
    `, [siteId]);
    const allSvcs = await query(`
      SELECT id FROM services
      WHERE active=1 AND id ~ '^[a-z]{2,3}[0-9]+'
    `);
    const val = active ? 1 : 0;
    for (const s of allSvcs.rows) {
      await query(`
        INSERT INTO site_services(site_id, service_id, active)
        VALUES($1, $2, $3)
        ON CONFLICT(site_id, service_id) DO UPDATE SET active=$3
      `, [siteId, s.id, val]);
    }
    if (active) await purgeUnsellableServices();
    res.json({ ok: true, count: allSvcs.rows.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 관리자 — 미작동·자동등록 상품 일괄 제거
app.post('/api/admin/site-services/purge', requireAdmin, async (req, res) => {
  try {
    const siteId = req.siteId;
    if (siteId === 'default') return res.json({ error: '슈퍼관리자 전용' });
    await reconcileServiceCatalog({ notify: false });
    const purged = await purgeUnsellableServices();
    res.json({
      ok: true,
      message: `미작동 상품 ${purged.autoImport}개 제거 · 판매 연결 ${purged.siteLinks}건 정리`,
      ...purged
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 슈퍼관리자 - 불필요·저품질 상품 정리 (비활성화만, 삭제 없음)
app.post('/api/super/services/prune', requireSuperAdmin, async (req, res) => {
  try {
    const { maxPerPlatform, dryRun } = req.body || {};
    const result = await pruneServiceCatalog({
      maxPerPlatform: maxPerPlatform || 28,
      dryRun: !!dryRun,
      notify: !dryRun
    });
    const msg = result.total > 0
      ? `${result.total}개 정리 · 활성 ${result.activeCount}개 유지`
      : `정리할 상품 없음 · 활성 ${result.activeCount}개`;
    res.json({ ok: true, message: msg, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 슈퍼관리자 - 서비스 자동 정리 (카테고리별 베스트만 남기기 → prune 통합)
app.post('/api/super/services/auto-clean', requireSuperAdmin, async (req, res) => {
  try {
    const maxPerPlatform = (req.body && req.body.maxPerPlatform) || 25;
    const result = await pruneServiceCatalog({ maxPerPlatform, notify: true });
    res.json({
      ok: true,
      activated: result.activeCount,
      pruned: result.total,
      message: `${result.total}개 정리 · 활성 ${result.activeCount}개`
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const site = req.site;
    const isSuperAdmin = req.session.role === 'superadmin';
    const apikeyRaw = await query(`SELECT value FROM global_settings WHERE key=$1`, ['peakerr_api_key']);
    const apikey = apikeyRaw.rows[0]?.value || '';
    const global_tg_token = await getGlobalSetting('tg_token');
    const global_tg_chat = await getGlobalSetting('tg_chat');
    const super_margin = await getGlobalSetting('super_margin');
    const global_exrate = await getGlobalSetting('global_exrate');

    // 관리자용: 원가 샘플 계산 (지인에게는 GLOW 판매가가 "원가"로 보임)
    let supplyExamples = [];
    if (!isSuperAdmin) {
      try {
        const ex = (site && site.exrate > 0) ? site.exrate : parseFloat(global_exrate || '1500');
        const superMgStr = super_margin || '50';
        const superMg = (site && site.super_margin >= 0) ? site.super_margin : parseFloat(superMgStr);
        const globalSiteMgStr = await getGlobalSetting('global_site_margin');
        const globalSiteMg = parseFloat(globalSiteMgStr || '50');
        const svcs = await query(`SELECT id, name, rate, pl FROM services WHERE active=1 ORDER BY rate ASC LIMIT 5`);
        supplyExamples = svcs.rows.map(s => ({
          name: s.name,
          pl: s.pl,
          // 🔒 지인에게 노출되는 "원가" = GLOW 판매가 (진짜 원가 + 슈퍼마진 + 글로벌 사이트마진)
          supplyPer1000: Math.round(s.rate * ex * (1 + superMg / 100) * (1 + globalSiteMg / 100)),
        }));
      } catch(e) {}
    }

    res.json({
      name: site?.name || '', kakao: site?.kakao || '',
      bank: site?.bank || '', margin: site?.margin ?? 0,
      exrate: site?.exrate || 1380, credit: site?.credit || 0,
      apikey: isSuperAdmin ? (isValidPeakerrApiKey(apikey) ? '••••(설정됨)' : '') : '',
      tg_token: isSuperAdmin ? (global_tg_token ? '••••(설정됨)' : '') : (site?.tg_token ? '••••(설정됨)' : ''),
      tg_chat: isSuperAdmin ? global_tg_chat : (site?.tg_chat || ''),
      site_tg_token: site?.tg_token || '',
      site_tg_chat: site?.tg_chat || '',
      super_margin: isSuperAdmin ? (super_margin || '50') : undefined,
      global_site_margin: isSuperAdmin ? ((await getGlobalSetting('global_site_margin')) || '50') : undefined,
      global_exrate: isSuperAdmin ? (global_exrate || '1500') : undefined,
      exrate_sync_at: isSuperAdmin ? (await getGlobalSetting('exrate_sync_at')) : undefined,
      exrate_sync_source: isSuperAdmin ? (await getGlobalSetting('exrate_sync_source')) : undefined,
      resendConfigured: isSuperAdmin ? !!(await getResendApiKey()) : undefined,
      email_from: isSuperAdmin ? ((await getGlobalSetting('email_from')) || '') : undefined,
      isSuperAdmin,
      supplyExamples  // 관리자용 공급가 샘플
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/settings/save', requireAdmin, async (req, res) => {
  try {
    const { key, value } = req.body;
    const isSuperAdmin = req.session.role === 'superadmin';
    const adminErr = (msg) => res.json({ error: neutralAdminMsg(msg, isSuperAdmin) });
    const superOnly = ['peakerr_api_key', 'smmkings_api_key', 'tg_token', 'tg_chat', 'resend_api_key', 'email_from'];
    if (superOnly.includes(key)) {
      if (isSuperAdmin) {
        const v = String(value || '').trim();
        if (key === 'peakerr_api_key') {
          const saved = await savePeakerrApiKeySafely(v);
          if (!saved.ok) return res.json({ error: saved.error });
          return res.json({
            ok: true,
            peakerrTest: { balance: saved.balance },
            locked: true
          });
        }
        if (key === 'resend_api_key' && v && !v.startsWith('re_')) {
          return res.json({ error: 'Resend API 키 형식이 아닙니다 (re_ 로 시작).' });
        }
        await setGlobalSetting(key, v);
        return res.json({ ok: true });
      }
      // 일반 어드민은 사이트별 tg 저장
      if (key === 'tg_token') {
        await query(`UPDATE sites SET tg_token=$1 WHERE id=$2`, [value, req.siteId]);
        return res.json({ ok: true });
      }
      if (key === 'tg_chat') {
        await query(`UPDATE sites SET tg_chat=$1 WHERE id=$2`, [value, req.siteId]);
        return res.json({ ok: true });
      }
      return adminErr('본사에서만 변경할 수 있는 설정입니다');
    }
    const siteFields = ['name','kakao','bank','margin','exrate','super_margin','primary_color','accent_color','logo','slogan','slogan_sub','description','stat1_num','stat1_label','stat2_num','stat2_label','stat3_num','stat3_label','stat4_num','stat4_label','notice','footer_text','login_welcome','login_sub','register_welcome','register_sub','kakao_btn_text','charge_guide','order_guide','hero_badge','hero_prefix','ui_layout','theme','banner_text','banner_image','banner_link','charge_bonus_tiers'];
    if (siteFields.includes(key)) {
      if (key === 'ui_layout') {
        const allowed = ['classic', 'card', 'split', 'minimal', 'glow-hq'];
        if (!allowed.includes(value)) return res.json({ error: '레이아웃 값이 올바르지 않습니다' });
        if (value === 'glow-hq' && req.siteId !== 'default') {
          return adminErr('본사 HQ 레이아웃은 GLOW 본사(glowsiax.com) 전용입니다');
        }
      }
      if (key === 'theme') {
        const t = String(value || '').trim();
        if (t && !t.startsWith('{')) {
          const allowedThemes = ['glow', 'dark', 'minimal', 'neon', 'gold', 'ocean', 'sunset', 'forest', 'candy', 'glow-blue', 'anonymous'];
          if (!allowedThemes.includes(t)) return res.json({ error: '테마 값이 올바르지 않습니다' });
          if ((t === 'glow-blue' || t === 'anonymous') && req.siteId !== 'default') {
            return adminErr('해당 테마는 GLOW 본사 전용입니다');
          }
        }
      }
      // 🛡️ 숫자 필드 검증
      if (key === 'margin') {
        const mg = parseFloat(value);
        if (isNaN(mg)) return res.json({ error: '올바른 숫자를 입력하세요' });
        if (mg < 0) return res.json({ error: '마진율은 0% 이상이어야 합니다 (공급가 이하 판매 시 손해)' });
        if (mg > 500) return res.json({ error: '마진율이 너무 높습니다 (최대 500%)' });
      }
      if (key === 'super_margin') {
        const sm = parseFloat(value);
        if (isNaN(sm)) return res.json({ error: '올바른 숫자를 입력하세요' });
        if (sm < -1 || sm > 500) return res.json({ error: '슈퍼마진은 -1(글로벌) 또는 0~500 범위여야 합니다' });
      }
      if (key === 'exrate') {
        const ex = await getGlobalExrateNum();
        await query(`UPDATE sites SET exrate=$1 WHERE id=$2`, [ex, req.siteId]);
        return res.json({ ok: true });
      }
      // 문자 필드 길이 제한
      if (typeof value === 'string' && value.length > 10000) {
        return res.json({ error: '입력값이 너무 깁니다 (10000자 이하)' });
      }
      await query(`UPDATE sites SET ${key}=$1 WHERE id=$2`, [value, req.siteId]);
      // 활동 로그
      await logActivity(req.siteId, req.session.userId, '', '설정 변경', 'site', req.siteId, `${key} = ${String(value).substring(0, 100)}`);
      return res.json({ ok: true });
    }
    res.json({ error: '잘못된 설정 키' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/api-test', requireSuperAdmin, async (req, res) => {
  try {
    let apiKey = String(req.query.key || '').trim();
    if (!isValidPeakerrApiKey(apiKey)) apiKey = await getPeakerrApiKey();
    const result = await fetchPeakerrBalance(apiKey);
    if (result.ok) res.json({ ok: true, balance: result.balance });
    else res.json({ error: result.error || '조회 실패' });
  } catch(e) { res.json({ error: e.message }); }
});

/** 연결 테스트 — POST (구버전 호환) */
app.post('/api/admin/api-test', requireSuperAdmin, async (req, res) => {
  try {
    let apiKey = String(req.body?.key || '').trim();
    if (!isValidPeakerrApiKey(apiKey)) apiKey = await getPeakerrApiKey();
    const result = await fetchPeakerrBalance(apiKey);
    if (result.ok) res.json({ ok: true, balance: result.balance });
    else res.json({ error: result.error || '조회 실패' });
  } catch(e) { res.json({ error: e.message }); }
});

app.get('/api/admin/api-sync', requireSuperAdmin, async (req, res) => {
  try {
    const apiKey = await getPeakerrApiKey();
    if (!apiKey) return res.json({ error: 'API 키가 설정되지 않았습니다' });
    const resp = await peakerrFetch({ key: apiKey, action: 'services' });
    const data = await resp.json();
    if (!Array.isArray(data)) return res.json({ error: 'API 응답 오류' });
    let added = 0, updated = 0;
    for (const s of data) {
      const apiId = String(s.service);
      const pl = detectPlat(`${s.name || ''} ${s.category || ''}`);
      const displayName = formatPeakerrServiceName(s.name, pl);
      const desc = formatPeakerrServiceDescription(s.name, pl, s.type || s.category || '');
      const existing = await query(`SELECT id FROM services WHERE api_id=$1 LIMIT 1`, [apiId]);
      if (existing.rows.length) {
        await query(`UPDATE services SET name=$1, pl=$2, rate=$3, min=$4, max=$5, description=$6 WHERE api_id=$7`,
          [displayName, pl, parseFloat(s.rate || 0), parseInt(s.min || 100), parseInt(s.max || 1000000), desc, apiId]);
        updated++;
      } else {
        const id = `api_${s.service}`;
        await query(`
          INSERT INTO services(id,name,pl,rate,min,max,description,api_id,active)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,1)
          ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, rate=EXCLUDED.rate, active=1
        `, [id, displayName, pl, parseFloat(s.rate || 0), parseInt(s.min || 100), parseInt(s.max || 1000000),
          desc, apiId]);
        await linkServiceToAllSites(id);
        added++;
      }
    }
    await repairAllPartnerSiteServices();
    await repairEnglishServiceNames();
    res.json({ ok: true, count: data.length, added, updated });
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

    // 크레딧 요청 처리 (cr_approve_ / cr_reject_)
    if (cbData.startsWith('cr_approve_') || cbData.startsWith('cr_reject_')) {
      const crAction = cbData.startsWith('cr_approve_') ? 'approve' : 'reject';
      const crId = cbData.replace('cr_approve_', '').replace('cr_reject_', '');
      const crR = await query(`SELECT * FROM credit_requests WHERE id=$1`, [crId]);
      const cr = crR.rows[0];
      if (!cr || cr.status !== 'pending') {
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: data.callback_query.id, text: '이미 처리된 요청입니다' })
        });
        return res.json({ ok: true });
      }
      if (crAction === 'approve') {
        await query(`UPDATE credit_requests SET status='approved' WHERE id=$1`, [crId]);
        const creditUsd = await krwToCreditUsd(cr.site_id, cr.amount);
        await query(`UPDATE sites SET credit=credit+$1 WHERE id=$2`, [creditUsd, cr.site_id]);
        await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })
        });
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: `✅ 크레딧 승인 완료!\n🏢 ${cr.site_name}\n💵 ₩${Math.round(cr.amount).toLocaleString()} 충전됨`, parse_mode: 'HTML' })
        });
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: data.callback_query.id, text: '✅ 승인 완료!' })
        });
      } else {
        await query(`UPDATE credit_requests SET status='rejected' WHERE id=$1`, [crId]);
        await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })
        });
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: `❌ 크레딧 거절!\n🏢 ${cr.site_name}\n💵 ₩${Math.round(cr.amount).toLocaleString()}`, parse_mode: 'HTML' })
        });
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: data.callback_query.id, text: '❌ 거절 완료!' })
        });
      }
      return res.json({ ok: true });
    }

    // 고객 충전 요청 처리 (approve_ / reject_)
    const parts = cbData.split('_');
    const action = parts[0];
    const chargeId = parts.slice(1).join('_');
    const r = await query(`SELECT * FROM charges WHERE id=$1`, [chargeId]);
    const charge = r.rows[0];

    // 📌 충전 콜백 토큰 결정: tgChargeAlert와 동일한 라우팅 규칙으로 어느 봇이 보냈는지 재현
    //  · 요청자가 관리자/파트너이거나 default 사이트 → 슈퍼 토큰
    //  · 지인 사이트 일반 회원 → 해당 사이트 토큰 (없으면 슈퍼 토큰 폴백)
    let cbToken = token; // 기본: 슈퍼 글로벌 토큰
    if (charge) {
      let requesterRole = 'user';
      try {
        const reqUserR = await query(`SELECT role FROM users WHERE id=$1`, [charge.uid]);
        requesterRole = reqUserR.rows[0]?.role || 'user';
      } catch(e) {}
      const isAdminReq = requesterRole === 'admin' || requesterRole === 'partner';
      const isDefault = !charge.site_id || charge.site_id === 'default';
      if (!isAdminReq && !isDefault) {
        // 지인 사이트 일반 회원 → 사이트 봇 토큰
        const cbSiteR = await query(`SELECT tg_token FROM sites WHERE id=$1`, [charge.site_id]);
        const cbSiteToken = cbSiteR.rows[0]?.tg_token;
        if (cbSiteToken) cbToken = cbSiteToken;
      }
    }
    if (!cbToken) cbToken = token;

    if (!charge || charge.status !== 'pending') {
      await fetch(`https://api.telegram.org/bot${cbToken}/answerCallbackQuery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: data.callback_query.id, text: '이미 처리된 요청입니다' })
      });
      return res.json({ ok: true });
    }
    if (action === 'approve') {
      let requesterRole = 'user';
      try {
        const reqUserR = await query(`SELECT role FROM users WHERE id=$1`, [charge.uid]);
        requesterRole = reqUserR.rows[0]?.role || 'user';
      } catch(e) {}
      if (charge.site_id && charge.site_id !== 'default' && ['admin', 'partner'].includes(requesterRole)) {
        await fetch(`https://api.telegram.org/bot${cbToken}/answerCallbackQuery`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: data.callback_query.id, text: '관리자는 크레딧으로 주문합니다' })
        });
        return res.json({ ok: true });
      }
      // 잔액 변동 로그 포함 (process 라우트와 동일하게 정합성 유지)
      const beforeR = await query(`SELECT balance, role FROM users WHERE id=$1`, [charge.uid]);
      const beforeBal = beforeR.rows[0]?.balance || 0;
      const chargerRole = beforeR.rows[0]?.role || 'user';
      // 💰 충전 보너스 — 금액 구간별, 일반 고객(user)에게만 지급
      let bonus = 0;
      if (chargerRole === 'user') {
        const bSiteR = await query(`SELECT charge_bonus_tiers FROM sites WHERE id=$1`, [charge.site_id]);
        bonus = calcChargeBonus(charge.amount, bSiteR.rows[0]?.charge_bonus_tiers);
      }
      const totalAdd = charge.amount + bonus;
      const bonusNote = bonus > 0 ? ` +보너스 ₩${bonus.toLocaleString()}` : '';
      await query(`UPDATE charges SET status='approved' WHERE id=$1`, [chargeId]);
      await query(`UPDATE users SET balance=balance+$1 WHERE id=$2`, [totalAdd, charge.uid]);
      try {
        await logBalance(charge.site_id, charge.uid, charge.uname, totalAdd,
          beforeBal, beforeBal + totalAdd, `충전 승인 (텔레그램)${bonusNote}`, 'telegram');
      } catch(e) {}
      await fetch(`https://api.telegram.org/bot${cbToken}/editMessageReplyMarkup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })
      });
      await fetch(`https://api.telegram.org/bot${cbToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `✅ 승인 완료!\n👤 ${charge.uname}\n💰 ₩${Math.round(charge.amount).toLocaleString()}${bonusNote} 충전됨`, parse_mode: 'HTML' })
      });
      await fetch(`https://api.telegram.org/bot${cbToken}/answerCallbackQuery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: data.callback_query.id, text: '✅ 승인 완료!' })
      });
    } else if (action === 'reject') {
      await query(`UPDATE charges SET status='rejected' WHERE id=$1`, [chargeId]);
      await fetch(`https://api.telegram.org/bot${cbToken}/editMessageReplyMarkup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })
      });
      await fetch(`https://api.telegram.org/bot${cbToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `❌ 거절 완료!\n👤 ${charge.uname}\n💰 ₩${Math.round(charge.amount).toLocaleString()}`, parse_mode: 'HTML' })
      });
      await fetch(`https://api.telegram.org/bot${cbToken}/answerCallbackQuery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: data.callback_query.id, text: '❌ 거절 완료!' })
      });
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tg-test', requireAdmin, async (req, res) => {
  try {
    const isSuperAdmin = req.session.role === 'superadmin';
    let token, chat;
    if (isSuperAdmin) {
      token = await getGlobalSetting('tg_token');
      chat = await getGlobalSetting('tg_chat');
    } else {
      const site = req.site;
      token = site?.tg_token || '';
      chat = site?.tg_chat || '';
    }
    if (!token || !chat) return res.json({ error: '텔레그램 설정을 먼저 저장하세요' });
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: `✅ ${req.site?.name || 'GLOW'} 알림 테스트 성공! ✨` })
    });
    const data = await resp.json();
    if (data.ok) res.json({ ok: true });
    else res.json({ error: data.description });
  } catch(e) { res.json({ error: e.message }); }
});


// ── 어드민 크레딧 요청 API ──

// 어드민이 슈퍼관리자에게 크레딧 요청
app.post('/api/admin/credit-request', requireAdmin, async (req, res) => {
  try {
    const { amount, note } = req.body;
    const amt = parseFloat(amount); // 원화 금액
    if (!amt || amt < 1000) return res.json({ error: '최소 ₩1,000 이상 입력하세요' });
    const site = req.site;
    if (!site) return res.json({ error: '사이트 정보를 찾을 수 없습니다' });
    const id = 'CR' + Date.now();
    await query(`INSERT INTO credit_requests(id,site_id,site_name,amount,note,status) VALUES($1,$2,$3,$4,$5,$6)`,
      [id, site.id, site.name, amt, note || '', 'pending']);
    // 슈퍼관리자 텔레그램 알림 (승인/거절 버튼 포함)
    const token = await getGlobalSetting('tg_token');
    const chat = await getGlobalSetting('tg_chat');
    if (token && chat) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat,
          text: `💰 <b>크레딧 요청</b>\n🏢 ${site.name}\n💵 ₩${Math.round(amt).toLocaleString()}\n📝 ${note || '-'}\n⏰ ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ 승인', callback_data: `cr_approve_${id}` },
              { text: '❌ 거절', callback_data: `cr_reject_${id}` }
            ]]
          }
        })
      });
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 어드민이 본인 크레딧 요청 내역 조회
app.get('/api/admin/credit-requests', requireAdmin, async (req, res) => {
  try {
    const r = await query(`SELECT * FROM credit_requests WHERE site_id=$1 ORDER BY created DESC`, [req.siteId]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 슈퍼관리자 - 전체 크레딧 요청 조회
app.get('/api/super/credit-requests', requireSuperAdmin, async (req, res) => {
  try {
    const r = await query(`SELECT * FROM credit_requests ORDER BY created DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 🔄 슈퍼관리자: 수동 주문 동기화 (모든 진행중 주문 체크)
app.post('/api/super/sync-orders', requireSuperAdmin, async (req, res) => {
  try {
    syncAllOrderStatuses().catch(e => console.log(e));
    res.json({ ok: true, message: '주문 동기화를 시작했습니다. 결과는 텔레그램으로 알려드립니다.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 🔄 슈퍼관리자: 수동 서비스 동기화 (작동 상품만 + 중복 제거)
app.post('/api/super/sync-services', requireSuperAdmin, async (req, res) => {
  try {
    reconcileServiceCatalog({ notify: true }).catch(e => console.log(e));
    res.json({ ok: true, message: '상품 정리·동기화를 시작했습니다. 미작동·중복 상품은 숨기고 작동 상품만 남깁니다.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 🆕 슈퍼관리자: Peakerr 핫상품 추가
app.post('/api/super/import-hot-services', requireSuperAdmin, async (req, res) => {
  try {
    const { maxPerPlatform, minScore, dryRun } = req.body || {};
    const result = await importHotPeakerrServices({
      maxPerPlatform: maxPerPlatform || 5,
      minScore: minScore || 120,
      dryRun: !!dryRun
    });
    if (result.error) return res.json({ error: result.error });
    let msg = result.count > 0
      ? `${result.count}개 핫상품 추가 · 전체 사이트 연결 완료`
      : '추가할 신규 핫상품이 없습니다 (이미 등록됨 또는 기준 미달)';
    if (result.count > 0) {
      const pr = await pruneServiceCatalog({ maxPerPlatform: 28, notify: false }).catch(() => null);
      if (pr && pr.total > 0) msg += ` · 중복/과다 ${pr.total}개 정리`;
    }
    res.json({ ok: true, message: msg, added: result.added, count: result.count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 🛒 슈퍼관리자: 아마zon·쿠팡·네이버 등 Peakerr 실존 상품만 추가
app.post('/api/super/import-niche-services', requireSuperAdmin, async (req, res) => {
  try {
    const { maxNichePerPlatform, maxBonusPerBucket, dryRun } = req.body || {};
    const result = await importNichePeakerrServices({
      maxNichePerPlatform: maxNichePerPlatform || 5,
      maxBonusPerBucket: maxBonusPerBucket || 3,
      dryRun: !!dryRun,
      notify: !dryRun
    });
    if (result.error) return res.json({ error: result.error });
    const msg = result.count > 0
      ? `${result.count}개 추가 (후보 ${result.scanned}개)`
      : `추가할 아마zon·이커머스·보너스 상품 없음`;
    res.json({ ok: true, message: msg, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 🇻🇳 슈퍼관리자: Peakerr 베트남 IG·TT 후보 미리보기
app.get('/api/super/peakerr-vietnam-preview', requireSuperAdmin, async (req, res) => {
  try {
    const apiKey = await getPeakerrApiKey();
    if (!apiKey) return res.json({ error: 'API 키가 설정되지 않았습니다' });
    const resp = await peakerrFetch({ key: apiKey, action: 'services' });
    const services = await resp.json();
    if (!Array.isArray(services)) return res.json({ error: '공급 API 응답 오류' });
    const existingR = await query(`SELECT api_id FROM services WHERE api_id IS NOT NULL AND api_id != ''`);
    const existing = new Set(existingR.rows.map(r => String(r.api_id)));
    const items = [];
    let tiktokTotal = 0;
    let tiktokVnLoose = 0;
    const looseTt = [];
    for (const s of services) {
      const full = `${s.name || ''} ${s.category || ''} ${s.type || ''}`;
      const low = full.toLowerCase();
      if (low.includes('tiktok') || low.includes('tik tok')) tiktokTotal++;
      const vnLoose = /vietnam|vietnamese|việt\s*nam|viet\s*nam|\bvn\b|🇻🇳|베트남/.test(full);
      if ((low.includes('tiktok') || low.includes('tik tok')) && vnLoose) {
        tiktokVnLoose++;
        looseTt.push({ apiId: String(s.service), name: s.name, category: s.category || '', rate: s.rate, alreadyInDb: existing.has(String(s.service)) });
      }
      const hit = qualifiesVietnamImport(s);
      if (!hit) continue;
      items.push({
        apiId: String(s.service),
        name: s.name,
        category: s.category || '',
        pl: hit.pl,
        rate: s.rate,
        min: s.min,
        max: s.max,
        displayName: formatVietnamImportName(s.name, hit.pl),
        alreadyInDb: existing.has(String(s.service))
      });
    }
    items.sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate));
    res.json({
      ok: true,
      count: items.length,
      newCount: items.filter(i => !i.alreadyInDb).length,
      peakerrTiktokTotal: tiktokTotal,
      peakerrTiktokVnLoose: tiktokVnLoose,
      looseTiktokVn: looseTt.slice(0, 20),
      items: items.slice(0, 80)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 🇻🇳 슈퍼관리자: 베트남 타겟 Instagram·TikTok (Peakerr 실존 시만)
app.post('/api/super/import-vietnam', requireSuperAdmin, async (req, res) => {
  try {
    const { maxPerPlatform, dryRun } = req.body || {};
    const result = await importVietnamInstagramTiktokServices({
      maxPerPlatform: maxPerPlatform || 10,
      dryRun: !!dryRun,
      notify: !dryRun
    });
    if (result.error) return res.json({ error: result.error });
    const msg = result.count > 0
      ? `베트남 인스타 ${result.instagram}개 · 틱톡 ${result.tiktok}개 추가 (후보 ${result.scanned}개)`
      : '추가할 베트남 Instagram·TikTok 상품 없음 (이미 등록 또는 공급 목록 미제공)';
    res.json({ ok: true, message: msg, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 🇰🇷 슈퍼관리자: 한국 타겟 + Pinterest HQ 상품 (Peakerr 실존 시만)
app.post('/api/super/import-kr-pinterest', requireSuperAdmin, async (req, res) => {
  try {
    const { maxKrPerPlatform, maxPinterest, dryRun } = req.body || {};
    const result = await importKoreanAndPinterestServices({
      maxKrPerPlatform: maxKrPerPlatform || 4,
      maxPinterest: maxPinterest || 5,
      dryRun: !!dryRun,
      notify: !dryRun
    });
    if (result.error) return res.json({ error: result.error });
    const msg = result.count > 0
      ? `한국 ${result.korean}개 · Pinterest ${result.pinterest}개 추가`
      : '추가할 한국·Pinterest HQ 상품 없음 (이미 등록 또는 공급 목록 미제공)';
    res.json({ ok: true, message: msg, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 🇰🇷 슈퍼관리자: 영문 상품명 → 한글 (GLOW·no9story 등 전 사이트 동시)
app.post('/api/super/services/localize-names', requireSuperAdmin, async (req, res) => {
  try {
    const result = await localizeAllSitesServiceNames();
    const msg = result.count > 0
      ? `영문 상품 ${result.count}건 한글화 · GLOW·지인 사이트 전체 반영`
      : '한글화할 영문 상품명 없음 (이미 한글)';
    res.json({ ok: true, message: msg, count: result.count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 🆕 슈퍼관리자: 신규 서비스 스캔 (주간 자동 — 핫상품 추가)
app.post('/api/super/scan-new-services', requireSuperAdmin, async (req, res) => {
  try {
    const result = await scanNewServices({ maxPerPlatform: 2 });
    if (result.error) return res.json({ error: result.error });
    const msg = result.count > 0
      ? `${result.count}개 핫상품 자동 추가 (텔레그램 알림 발송)`
      : '추가할 신규 핫상품 없음';
    res.json({ ok: true, message: msg, count: result.count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 슈퍼관리자 - 크레딧 요청 처리 (승인/거절)
app.post('/api/super/credit-requests/process', requireSuperAdmin, async (req, res) => {
  try {
    const { id, action } = req.body;
    const r = await query(`SELECT * FROM credit_requests WHERE id=$1`, [id]);
    const cr = r.rows[0];
    if (!cr) return res.json({ error: '요청을 찾을 수 없습니다' });
    if (cr.status !== 'pending') return res.json({ error: '이미 처리된 요청입니다' });
    const status = action === 'approve' ? 'approved' : 'rejected';
    await query(`UPDATE credit_requests SET status=$1 WHERE id=$2`, [status, id]);
    if (action === 'approve') {
      const creditUsd = await krwToCreditUsd(cr.site_id, cr.amount);
      await query(`UPDATE sites SET credit=credit+$1 WHERE id=$2`, [creditUsd, cr.site_id]);
      // 해당 사이트 텔레그램 알림
      const siteR = await query(`SELECT * FROM sites WHERE id=$1`, [cr.site_id]);
      const site = siteR.rows[0];
      const exrate = parseFloat(site?.exrate) || 1500;
      if (site?.tg_token && site?.tg_chat) {
        await fetch(`https://api.telegram.org/bot${site.tg_token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: site.tg_chat,
            text: `✅ <b>크레딧 충전 완료</b>\n💵 ₩${Math.round(cr.amount).toLocaleString()} ($${creditUsd.toFixed(2)}) 충전됨\n현재 잔액 확인해주세요`,
            parse_mode: 'HTML'
          })
        });
      }
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 크레딧 요청 내역 삭제 (관리자 전용 · DB 완전 삭제 · 모든 상태 삭제 가능)
// ⚠️ 삭제는 '기록 정리'이며 이미 지급된 크레딧은 회수하지 않음
app.post('/api/admin/credit-requests/delete', requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.json({ error: '삭제할 항목을 지정해주세요' });
    const r = await query(`SELECT * FROM credit_requests WHERE id=$1`, [id]);
    const cr = r.rows[0];
    if (!cr) return res.json({ error: '크레딧 요청 내역을 찾을 수 없습니다' });
    // 권한: 슈퍼관리자는 전체, 일반 관리자는 자기 사이트 건만 삭제 가능
    if (req.session.role !== 'superadmin' && cr.site_id !== req.siteId) {
      return res.json({ error: '다른 사이트의 크레딧 요청은 삭제할 수 없습니다' });
    }
    await query(`DELETE FROM credit_requests WHERE id=$1`, [id]);
    await logActivity(req.siteId, req.session.userId, '', '크레딧 요청 삭제', 'credit', id,
      `₩${Math.round(cr.amount).toLocaleString()} (${cr.status})`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── 서비스 CRUD (슈퍼어드민) ──
app.post('/api/super/services/create', requireSuperAdmin, async (req, res) => {
  try {
    const { name, pl, rate, min, max, description, active, apiId } = req.body;
    if (!name) return res.json({ error: '서비스명을 입력하세요' });
    if (!apiId) return res.json({ error: '공급 상품 번호를 입력하세요' });
    const id = 'svc_' + Date.now();
    await query(`INSERT INTO services(id,name,pl,rate,min,max,description,active,api_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, name, pl||'other', parseFloat(rate||0), parseInt(min||100), parseInt(max||1000000), description||'', active?1:0, String(apiId).trim()]);
    // 🆕 모든 사이트의 site_services에도 자동 연결 — 새 상품이 지인 사이트에도 바로 보이도록
    try {
      await linkServiceToAllSites(id);
    } catch(e) { console.error('site_services 자동 연결 실패:', e.message); }
    res.json({ ok: true, id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/services/update', requireSuperAdmin, async (req, res) => {
  try {
    const { id, name, pl, rate, min, max, description, active, apiId } = req.body;
    if (!id) return res.json({ error: 'ID가 없습니다' });
    await query(`UPDATE services SET name=$1,pl=$2,rate=$3,min=$4,max=$5,description=$6,active=$7,api_id=$8 WHERE id=$9`,
      [name, pl||'other', parseFloat(rate||0), parseInt(min||100), parseInt(max||1000000), description||'', active?1:0, apiId?String(apiId).trim():null, id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/** 검증 시드 — Peakerr 실존 api_id 고정 (국가·상품 그대로). 자동 리필 교체로 덮지 않음 */
const CURATED_SEED_API_LOCK = {
  pyt2: { api_id: '27905', rate: 41.99 },
  pyt13: { api_id: '27905', rate: 41.99 }, // 구 28716 저속·미진행 → Real Lifetime 리필 SKU
  // Instagram 팔로워
  pig4: { api_id: '28284', rate: 2.4192 },  // 브라질 (구 29691 삭제)
  pig5: { api_id: '30505', rate: 0.57 },
  pig6: { api_id: '28308', rate: 40.32 },   // 한국
  pig8: { api_id: '29835', rate: 34.02 },   // 터키 (구 30054 삭제)
  pig9: { api_id: '22628', rate: 48.91 },
  pkr1: { api_id: '27334', rate: 59.6409 }, // 한국 30일 (구 28309 삭제)
  pkr2: { api_id: '27334', rate: 59.6409 }, // 한국 슬로우 → 동일 KR refill SKU
  // Instagram 좋아요
  pig13: { api_id: '28283', rate: 0.62 },
  pig15: { api_id: '31244', rate: 0.09 },
  pig16: { api_id: '17541', rate: 0.6855 }, // 인도 (구 29539 삭제)
  pig17: { api_id: '30710', rate: 1.19 },   // 한국 (구 28306 삭제)
  pig18: { api_id: '29759', rate: 1.72 },
  pig19: { api_id: '30040', rate: 0.7 },
  pig20: { api_id: '22626', rate: 18.77 },
  pkr3: { api_id: '30711', rate: 1.4 },     // 한국 드롭 → 365 refill KR
  pkr4: { api_id: '27077', rate: 2.38 },
  pkr5: { api_id: '30711', rate: 1.4 },
  // Instagram 기타
  pig25: { api_id: '31255', rate: 0.56 },   // 공유 Worldwide
  // TikTok
  ptt1: { api_id: '23882', rate: 1.4 },
  ptt2: { api_id: '26191', rate: 1.82 },
  ptt3: { api_id: '26182', rate: 1.65 },
  ptt4: { api_id: '26176', rate: 2.1 },
  ptt5: { api_id: '25057', rate: 3.08 },
  // Facebook
  pfb2: { api_id: '29350', rate: 1.26 },
  pfb4: { api_id: '31397', rate: 0.27 },
  pfb5: { api_id: '30863', rate: 3.09 },
  pfb7: { api_id: '22328', rate: 0.5887 },
  pfb8: { api_id: '30865', rate: 1.55 },
};

/** Peakerr 상품 그대로 — 국가 라벨과 api_id가 어긋난 검증 시드 복구.
 *  단, Peakerr에서 삭제된 api_id는 잠금값으로 되돌리지 않음(죽은 SKU 재적용 방지). */
async function restoreCuratedSeedApiLocks() {
  await ensurePeakerrCatalogLoaded({ background: false }).catch(() => null);
  let fixed = 0;
  for (const [id, lock] of Object.entries(CURATED_SEED_API_LOCK)) {
    if (PERMANENTLY_DISABLED_SEEDS.has(id)) continue;
    const r = await query(`SELECT id, api_id, rate FROM services WHERE id=$1`, [id]);
    const row = r.rows[0];
    if (!row) continue;
    if (String(row.api_id) === String(lock.api_id) && Math.abs(parseFloat(row.rate) - lock.rate) < 0.0001) continue;
    // 잠금 api가 Peakerr에 없으면 스킵 — remap-missing-geo가 살아 있는 동국가 SKU로 연결
    if (peakerrCatalogCache.size > 0 && !peakerrCatalogCache.has(String(lock.api_id))) {
      console.log(`🔒 시드 api 스킵(Peakerr 삭제됨): ${id} lock=${lock.api_id}`);
      continue;
    }
    await query(`
      UPDATE services SET api_id=$1, rate=$2, active=1, inactive_note='', replace_service_id=NULL
      WHERE id=$3
    `, [lock.api_id, lock.rate, id]);
    fixed++;
    console.log(`🔒 시드 api 복구: ${id} ${row.api_id} → ${lock.api_id}`);
  }
  return fixed;
}

/** 슈퍼 — 국가 타겟 섞인 검증 시드 api_id를 Peakerr 실명과 대조 */
app.get('/api/super/services/geo-audit', requireSuperAdmin, async (req, res) => {
  try {
    await ensurePeakerrCatalogLoaded();
    const r = await query(`
      SELECT id, name, pl, api_id, rate, active FROM services
      WHERE id ~ '^[a-z]{2,3}[0-9]+' AND api_id IS NOT NULL AND TRIM(api_id) <> ''
      ORDER BY pl, id
    `);
    const mismatches = [];
    for (const row of r.rows) {
      const glowGeo = serviceMarketGeoKey(row);
      const glowBucket = serviceOrderBucket(row);
      const peak = peakerrCatalogCache.get(String(row.api_id));
      const peakGeo = peak ? peakerrMarketGeoKey(peak) : null;
      const peakName = peak ? String(peak.name || '') : '';
      const peakBucket = peak ? detectServiceTypeKo(`${peak.name || ''} ${peak.category || ''} ${peak.type || ''}`) : null;
      if (!peak) {
        mismatches.push({
          id: row.id, name: row.name, api_id: row.api_id, glowGeo, glowBucket,
          active: parseInt(row.active, 10), issue: 'peakerr_missing', peakName: ''
        });
        continue;
      }
      if (!geoKeysCompatible(glowGeo, peakGeo)) {
        mismatches.push({
          id: row.id, name: row.name, api_id: row.api_id, rate: row.rate,
          glowGeo, peakGeo, glowBucket, peakBucket,
          active: parseInt(row.active, 10),
          peakName: peakName.slice(0, 80), issue: 'geo_mismatch'
        });
        continue;
      }
      if (glowBucket && glowBucket !== '서비스' && peakBucket && peakBucket !== '서비스' && glowBucket !== peakBucket) {
        mismatches.push({
          id: row.id, name: row.name, api_id: row.api_id, rate: row.rate,
          glowGeo, peakGeo, glowBucket, peakBucket,
          active: parseInt(row.active, 10),
          peakName: peakName.slice(0, 80), issue: 'bucket_mismatch'
        });
      }
    }
    res.json({ ok: true, mismatches, count: mismatches.length, catalog: peakerrCatalogCache.size });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** 슈퍼 — Peakerr 국가별 api_id 시드 고정값으로 즉시 복구 */
app.post('/api/super/services/restore-geo-seeds', requireSuperAdmin, async (req, res) => {
  try {
    const fixed = await restoreCuratedSeedApiLocks();
    await syncServiceDescriptionFooters().catch(() => null);
    res.json({ ok: true, fixed, message: fixed ? `${fixed}개 국가·상품 api 복구` : '이미 Peakerr 시드와 일치' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Peakerr에서 삭제된 국가 시드 → 동종·동국가 SKU로만 재연결 (종류 불일치 금지) */
async function remapMissingGeoSeedServices() {
  await ensurePeakerrCatalogLoaded();
  if (peakerrCatalogCache.size === 0) return { remapped: 0, stillMissing: [], hidden: 0 };

  const r = await query(`
    SELECT id, name, pl, api_id, rate, description, active, provider FROM services
    WHERE id ~ '^[a-z]{2,3}[0-9]+' AND api_id IS NOT NULL AND TRIM(api_id) <> ''
      AND COALESCE(provider,'peakerr')='peakerr'
  `);
  const remapped = [];
  const stillMissing = [];
  let hidden = 0;
  for (const row of r.rows) {
    if (PERMANENTLY_DISABLED_SEEDS.has(row.id)) {
      if (parseInt(row.active, 10) === 1) {
        const meta = DISABLED_SEED_META[row.id];
        await hideServiceWithNote(row.id, meta.note, meta.replaceId || null);
        hidden++;
      }
      continue;
    }
    const glowGeo = serviceMarketGeoKey(row);
    if (peakerrCatalogCache.has(String(row.api_id))) continue;
    // 국가 라벨 없는 기타도 Peakerr 삭제분이면 동종(글로벌/other)으로 재연결 시도
    const bucket = serviceOrderBucket(row);
    if (!bucket || bucket === '서비스') {
      stillMissing.push(row.id);
      continue;
    }
    let best = null;
    let bestScore = -1;
    for (const s of peakerrCatalogCache.values()) {
      const full = `${s.name || ''} ${s.category || ''} ${s.type || ''}`;
      if (detectPlat(full) !== row.pl) continue;
      const peakBucket = detectServiceTypeKo(full);
      if (peakBucket !== bucket) continue;
      if (peakBucket === '서비스') continue;
      const peakGeo = peakerrMarketGeoKey(s);
      if (glowGeo === 'other') {
        if (peakGeo !== 'other' && peakGeo !== 'global') continue;
      } else if (!geoKeysCompatible(glowGeo, peakGeo)) {
        continue;
      }
      const sc = scorePeakerrService(s);
      if (sc < 0) continue;
      if (sc > bestScore) {
        bestScore = sc;
        best = s;
      }
    }
    if (!best) {
      stillMissing.push(row.id);
      if (parseInt(row.active, 10) === 1) {
        await hideServiceWithNote(row.id, 'Peakerr에서 해당 국가·종류 상품이 삭제되어 판매를 중단했습니다.');
        hidden++;
      }
      continue;
    }
    await query(`
      UPDATE services SET api_id=$1, rate=$2, min=$3, max=$4, active=1,
        inactive_note='', replace_service_id=NULL
      WHERE id=$5
    `, [
      String(best.service),
      parseFloat(best.rate || 0),
      Math.max(1, parseInt(best.min, 10) || 10),
      parseInt(best.max, 10) || 1000000,
      row.id
    ]);
    if (CURATED_SEED_API_LOCK[row.id]) {
      CURATED_SEED_API_LOCK[row.id] = { api_id: String(best.service), rate: parseFloat(best.rate || 0) };
    }
    remapped.push({
      id: row.id,
      from: row.api_id,
      to: String(best.service),
      peakName: String(best.name || '').slice(0, 80),
      rate: parseFloat(best.rate || 0),
      geo: glowGeo,
      bucket,
    });
    console.log(`♻️ geo 재연결: ${row.id} [${glowGeo}/${bucket}] ${row.api_id} → ${best.service}`);
  }
  return { remapped: remapped.length, items: remapped, stillMissing, hidden };
}

/** 슈퍼 — Peakerr 카탈로그 검색 (국가·상품 재매핑용) */
app.get('/api/super/peakerr-search', requireSuperAdmin, async (req, res) => {
  try {
    await ensurePeakerrCatalogLoaded();
    const q = String(req.query.q || '').trim().toLowerCase();
    const terms = q.split(/[\s,+|]+/).filter(Boolean);
    const plFilter = String(req.query.pl || '').trim().toLowerCase();
    const geoFilter = String(req.query.geo || '').trim().toLowerCase();
    const hits = [];
    for (const s of peakerrCatalogCache.values()) {
      const full = `${s.name || ''} ${s.category || ''} ${s.type || ''}`;
      const low = full.toLowerCase();
      const apiId = String(s.service);
      if (plFilter && detectPlat(full) !== plFilter) continue;
      const geo = peakerrMarketGeoKey(s);
      if (geoFilter && geo !== geoFilter) continue;
      if (terms.length && !terms.every(t => {
        if (/^\d+$/.test(t)) return apiId === t;
        if (t === 'korea' || t === '한국') return isKoreanMarketService(full);
        if (t === 'like' || t === 'likes' || t === '좋아요') return /like|likes|좋아요/.test(low);
        if (t === 'follow' || t === 'follower' || t === 'followers' || t === '팔로워') return /follow|follower|팔로워/.test(low);
        return low.includes(t);
      })) continue;
      hits.push({
        apiId: String(s.service),
        name: String(s.name || '').slice(0, 120),
        category: String(s.category || '').slice(0, 80),
        rate: parseFloat(s.rate || 0),
        min: parseInt(s.min, 10) || 0,
        max: parseInt(s.max, 10) || 0,
        refill: peakerrServiceHasRefill(s),
        geo,
        pl: detectPlat(full),
        bucket: detectServiceTypeKo(full),
      });
      if (hits.length >= 80) break;
    }
    hits.sort((a, b) => {
      if (a.refill !== b.refill) return a.refill ? -1 : 1;
      return a.rate - b.rate;
    });
    res.json({ ok: true, count: hits.length, catalog: peakerrCatalogCache.size, hits });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Peakerr에 살아 있지만 GLOW 국가 라벨과 어긋난 활성 상품 → 동종·동국가 SKU로 교체 */
async function remapGeoMismatchServices() {
  await ensurePeakerrCatalogLoaded();
  if (peakerrCatalogCache.size === 0) return { remapped: 0, items: [], hidden: 0 };

  const r = await query(`
    SELECT id, name, pl, api_id, rate, description, active, provider FROM services
    WHERE id ~ '^[a-z]{2,3}[0-9]+' AND api_id IS NOT NULL AND TRIM(api_id) <> '' AND active=1
      AND COALESCE(provider,'peakerr')='peakerr'
  `);
  const remapped = [];
  let hidden = 0;
  for (const row of r.rows) {
    if (PERMANENTLY_DISABLED_SEEDS.has(row.id)) {
      const meta = DISABLED_SEED_META[row.id];
      await hideServiceWithNote(row.id, meta.note, meta.replaceId || null);
      hidden++;
      continue;
    }
    const glowGeo = serviceMarketGeoKey(row);
    const peak = peakerrCatalogCache.get(String(row.api_id));
    if (!peak) continue;
    const peakGeo = peakerrMarketGeoKey(peak);
    const glowBucket = serviceOrderBucket(row);
    const peakBucket = detectServiceTypeKo(`${peak.name || ''} ${peak.category || ''} ${peak.type || ''}`);
    // 국가만 강제 교정. 종류(bucket) 자동 교체는 Peakerr "Likes+Views" 등 복합명 때문에
    // 좋아요↔조회수·공유↔팔로워로 잘못 바뀌는 사고가 있어 비활성.
    const geoBad = glowGeo !== 'other' && !geoKeysCompatible(glowGeo, peakGeo);
    if (!geoBad) continue;

    let best = null;
    let bestScore = -1;
    for (const s of peakerrCatalogCache.values()) {
      const full = `${s.name || ''} ${s.category || ''} ${s.type || ''}`;
      if (detectPlat(full) !== row.pl) continue;
      const pb = detectServiceTypeKo(full);
      if (glowBucket && glowBucket !== '서비스' && pb !== glowBucket) continue;
      if (pb === '서비스') continue;
      const sg = peakerrMarketGeoKey(s);
      if (glowGeo === 'other') {
        if (sg !== 'other' && sg !== 'global') continue;
      } else if (!geoKeysCompatible(glowGeo, sg)) {
        continue;
      }
      const sc = scorePeakerrService(s);
      if (sc < 0) continue;
      if (sc > bestScore) {
        bestScore = sc;
        best = s;
      }
    }
    if (!best) {
      await hideServiceWithNote(row.id, 'Peakerr 국가 타겟이 GLOW 상품명과 달라 판매를 중단했습니다.');
      hidden++;
      continue;
    }
    await query(`
      UPDATE services SET api_id=$1, rate=$2, min=$3, max=$4, active=1,
        inactive_note='', replace_service_id=NULL
      WHERE id=$5
    `, [
      String(best.service),
      parseFloat(best.rate || 0),
      Math.max(1, parseInt(best.min, 10) || 10),
      parseInt(best.max, 10) || 1000000,
      row.id
    ]);
    if (CURATED_SEED_API_LOCK[row.id]) {
      CURATED_SEED_API_LOCK[row.id] = { api_id: String(best.service), rate: parseFloat(best.rate || 0) };
    }
    remapped.push({
      id: row.id,
      from: row.api_id,
      to: String(best.service),
      reason: 'geo_mismatch',
      peakName: String(best.name || '').slice(0, 80),
      glowGeo,
      peakGeo,
      glowBucket,
      peakBucket,
    });
    console.log(`♻️ geo 교정: ${row.id} ${row.api_id} → ${best.service}`);
  }
  return { remapped: remapped.length, items: remapped, hidden };
}

/** 슈퍼 — Peakerr에서 사라진 국가 시드를 카탈로그의 동종·동국가 SKU로 재연결 */
app.post('/api/super/services/remap-missing-geo', requireSuperAdmin, async (req, res) => {
  try {
    const result = await remapMissingGeoSeedServices();
    await syncServiceDescriptionFooters().catch(() => null);
    res.json({ ok: true, ...result, missing: (result.stillMissing || []).length + (result.remapped || 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** 슈퍼 — 전체 국가/종류 Peakerr 정합: 재연결 → 미스매치교정 → 잠금복구 → 영구중단 → 감사 */
app.post('/api/super/services/fix-all-geo', requireSuperAdmin, async (req, res) => {
  try {
    const remap = await remapMissingGeoSeedServices();
    const mismatchFix = await remapGeoMismatchServices();
    const fixed = await restoreCuratedSeedApiLocks();
    await applyDisabledSeedMeta();
    await syncServiceDescriptionFooters().catch(() => null);
    await ensurePeakerrCatalogLoaded();
    const r = await query(`
      SELECT id, name, pl, api_id, rate, active FROM services
      WHERE id ~ '^[a-z]{2,3}[0-9]+' AND api_id IS NOT NULL AND TRIM(api_id) <> ''
    `);
    const mismatches = [];
    for (const row of r.rows) {
      if (!parseInt(row.active, 10)) continue;
      if (PERMANENTLY_DISABLED_SEEDS.has(row.id)) continue;
      const glowGeo = serviceMarketGeoKey(row);
      const glowBucket = serviceOrderBucket(row);
      const peak = peakerrCatalogCache.get(String(row.api_id));
      if (!peak) {
        mismatches.push({ id: row.id, name: row.name, api_id: row.api_id, glowGeo, glowBucket, issue: 'peakerr_missing' });
        continue;
      }
      const peakGeo = peakerrMarketGeoKey(peak);
      const peakBucket = detectServiceTypeKo(`${peak.name || ''} ${peak.category || ''} ${peak.type || ''}`);
      if (!geoKeysCompatible(glowGeo, peakGeo) && glowGeo !== 'other') {
        mismatches.push({
          id: row.id, name: row.name, api_id: row.api_id, glowGeo, peakGeo, glowBucket, peakBucket,
          peakName: String(peak.name || '').slice(0, 60), issue: 'geo_mismatch'
        });
        continue;
      }
      if (glowBucket && glowBucket !== '서비스' && peakBucket && peakBucket !== '서비스' && glowBucket !== peakBucket) {
        mismatches.push({
          id: row.id, name: row.name, api_id: row.api_id, glowGeo, peakGeo, glowBucket, peakBucket,
          peakName: String(peak.name || '').slice(0, 60), issue: 'bucket_mismatch'
        });
      }
    }
    res.json({
      ok: true,
      remap,
      mismatchFix,
      lockFixed: fixed,
      activeMismatches: mismatches.length,
      mismatches: mismatches.slice(0, 60),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/services/delete', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM services WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 슈퍼어드민 API ──
app.get('/api/super/sites', requireSuperAdmin, async (req, res) => {
  try {
    const r = await query(`SELECT * FROM sites ORDER BY created DESC`);
    // 크레딧 원화 환산용 글로벌 기본 환율 함께 전달
    const globalExrate = parseFloat((await getGlobalSetting('global_exrate')) || '1500');
    // 사이트별 매출·원가 통계 (취소·실패·환불 제외)
    const validStatuses = `status NOT IN ('cancelled','canceled','failed','refunded','partial_refunded')`;
    const statR = await query(`SELECT site_id, SUM(charge) as revenue, SUM(cost) as cost, COUNT(*) as orders
                               FROM orders WHERE ${validStatuses} GROUP BY site_id`);
    const statMap = {};
    statR.rows.forEach(row => {
      statMap[row.site_id] = {
        revenue: parseFloat(row.revenue) || 0,
        cost: parseFloat(row.cost) || 0,
        orders: parseInt(row.orders) || 0
      };
    });
    // 각 사이트에 통계 부착
    const sites = r.rows.map(s => {
      const st = statMap[s.id] || { revenue: 0, cost: 0, orders: 0 };
      return {
        ...s,
        stat_revenue: st.revenue,        // 파트너 고객 매출 합계 (₩)
        stat_cost: st.cost,              // 파트너가 크레딧으로 쓴 원가 합계 (₩) = 슈퍼시아 판매가
        stat_partner_profit: st.revenue - st.cost,  // 파트너 수익
        stat_orders: st.orders
      };
    });
    res.json({ sites, globalExrate });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

const SITE_PRESET_THEMES = ['dark', 'minimal', 'neon', 'gold', 'ocean', 'sunset', 'forest', 'candy'];

function makeThemeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

function generateUniqueTheme(seed) {
  const rnd = makeThemeRng(seed);
  const bgTypeRnd = rnd();
  const bgType = bgTypeRnd < 0.5 ? 'light' : (bgTypeRnd < 0.75 ? 'mid' : 'dark');
  const palettes = [
    { p: '#FF0080', a: '#7928CA' }, { p: '#00F5FF', a: '#0050FF' }, { p: '#39FF14', a: '#00CC44' },
    { p: '#FFD700', a: '#FF8C00' }, { p: '#FF6B35', a: '#FF0A54' }, { p: '#00E5CC', a: '#0066FF' },
    { p: '#FF85A1', a: '#C9184A' }, { p: '#A855F7', a: '#6D28D9' }, { p: '#F97316', a: '#DC2626' },
    { p: '#10B981', a: '#059669' }, { p: '#3B82F6', a: '#1D4ED8' }, { p: '#EC4899', a: '#9333EA' },
    { p: '#EAB308', a: '#D97706' }, { p: '#14B8A6', a: '#0891B2' }, { p: '#F43F5E', a: '#E11D48' },
    { p: '#8B5CF6', a: '#7C3AED' }, { p: '#06B6D4', a: '#0284C7' }, { p: '#84CC16', a: '#65A30D' },
    { p: '#FB923C', a: '#EA580C' }, { p: '#E879F9', a: '#A21CAF' },
  ];
  const palette = palettes[Math.floor(rnd() * palettes.length)];
  const fonts = [
    "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "'Courier New',monospace", "Georgia,serif",
    "'Helvetica Neue',Helvetica,Arial,sans-serif",
    "Verdana,Geneva,sans-serif", "'Trebuchet MS',sans-serif",
  ];
  const font = fonts[Math.floor(rnd() * fonts.length)];
  const radii = ['4px', '8px', '12px', '20px', '100px'];
  const radius = radii[Math.floor(rnd() * radii.length)];
  const cardStyles = ['flat', 'shadow', 'glow', 'border'];
  const cardStyle = cardStyles[Math.floor(rnd() * cardStyles.length)];
  const hue = Math.floor(rnd() * 360);
  let bg, w, tx, tm, tl, bd, bd2;
  if (bgType === 'dark') {
    bg = `hsl(${hue},20%,6%)`; w = `hsl(${hue},20%,10%)`; tx = `hsl(${hue},10%,90%)`;
    tm = `hsl(${hue},10%,60%)`; tl = `hsl(${hue},10%,40%)`;
    bd = `hsla(${hue},50%,60%,.15)`; bd2 = `hsla(${hue},50%,60%,.35)`;
  } else if (bgType === 'light') {
    bg = `hsl(${hue},30%,97%)`; w = '#ffffff'; tx = `hsl(${hue},40%,10%)`;
    tm = `hsl(${hue},20%,40%)`; tl = `hsl(${hue},15%,60%)`;
    bd = `hsla(${hue},40%,40%,.12)`; bd2 = `hsla(${hue},40%,40%,.28)`;
  } else {
    bg = `hsl(${hue},25%,18%)`; w = `hsl(${hue},20%,24%)`; tx = `hsl(${hue},10%,92%)`;
    tm = `hsl(${hue},15%,65%)`; tl = `hsl(${hue},10%,45%)`;
    bd = `hsla(${hue},40%,70%,.18)`; bd2 = `hsla(${hue},40%,70%,.38)`;
  }
  return { p1: palette.p, p2: palette.a, p3: palette.a, bg, w, tx, tm, tl, bd, bd2, font, radius, cardStyle, bgType };
}

function generateSiteBranding(seed, siteName) {
  const rnd = makeThemeRng(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const logos = ['✨', '🚀', '💎', '⚡', '🔥', '🌟', '💫', '🎯', '📈', '🛡️', '🌊', '🎨', '🏆', '💜', '🧡', '💚', '🔵', '⭐'];
  const heroBadges = [
    '채널 성장 · 마케팅 플랫폼', '소셜 성장 자동화', '크리에이터 성장 파트너',
    '빠른 주문 · 안전 처리', '프리미엄 마케팅 허브', `${siteName} 공식 성장 센터`,
  ];
  const slogans = ['빛나도록', '성장하도록', '터지도록', '올라가도록', '뜨도록', '살아나도록', '확장되도록'];
  const sloganSubs = [
    '우리가 성장시킵니다', '데이터로 키웁니다', '빠르고 안전하게', '목표까지 함께 갑니다',
    '채널 성장의 파트너', '성과가 보이는 마케팅',
  ];
  const descriptions = [
    '유튜브·인스타·틱톡부터 쇼핑몰·블로그까지, 모든 채널의 성장을 지원합니다.',
    '조회수·팔로워·좋아요·트래픽까지 한 곳에서 빠르게 주문하세요.',
    '크리에이터와 브랜드를 위한 올인원 성장 마케팅 플랫폼입니다.',
    '실시간 처리와 투명한 주문 내역으로 안심하고 이용하세요.',
    `${siteName}만의 맞춤 성장 솔루션을 제공합니다.`,
  ];
  const statSets = [
    { n1: '10K+', l1: '서비스 종류', n2: '24H', l2: '빠른 처리', n3: '50%+', l3: '마진 보장', n4: '100%', l4: '안전 보장' },
    { n1: '500+', l1: '활성 서비스', n2: '1H', l2: '평균 시작', n3: '99%', l3: '처리율', n4: '24/7', l4: '자동화' },
    { n1: '3년+', l1: '운영 경험', n2: '10만+', l2: '누적 주문', n3: '실시간', l3: '상태 추적', n4: 'KRW', l4: '원화 결제' },
    { n1: 'ALL', l1: '플랫폼 지원', n2: 'FAST', l2: '즉시 접수', n3: 'SAFE', l3: '안전 처리', n4: 'PRO', l4: '전문 운영' },
  ];
  const stats = pick(statSets);
  const uiLayouts = ['classic', 'card', 'split', 'minimal'];
  const heroPrefixes = ['콘텐츠가', '브랜드가', '채널이', '성과가', `${siteName}는`, '마케팅이'];
  return {
    logo: pick(logos),
    hero_badge: pick(heroBadges),
    hero_prefix: pick(heroPrefixes),
    ui_layout: pick(uiLayouts),
    slogan: pick(slogans),
    slogan_sub: pick(sloganSubs),
    description: pick(descriptions),
    stat1_num: stats.n1, stat1_label: stats.l1,
    stat2_num: stats.n2, stat2_label: stats.l2,
    stat3_num: stats.n3, stat3_label: stats.l3,
    stat4_num: stats.n4, stat4_label: stats.l4,
  };
}

app.post('/api/super/sites/create', requireSuperAdmin, async (req, res) => {
  try {
    const { domain, name, logo, primaryColor, accentColor, adminEmail, adminPw, margin, exrate, credit } = req.body;
    if (!domain || !name || !adminEmail || !adminPw)
      return res.json({ error: '필수 항목을 입력하세요' });
    const siteId = 'site_' + Date.now();
    const superMarginVal = req.body.superMargin !== undefined ? parseFloat(req.body.superMargin) : -1;

    // autoTheme 기본 ON — 사이트마다 색·폰트·문구·로고 자동 차별화
    const useAutoTheme = req.body.autoTheme !== false;
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    let finalTheme, finalPrimary, finalAccent, branding;

    if (useAutoTheme) {
      branding = generateSiteBranding(seed + 17, name);
      const themeData = generateUniqueTheme(seed);
      const rnd = makeThemeRng(seed + 99);
      if (rnd() < 0.35) {
        finalTheme = SITE_PRESET_THEMES[Math.floor(rnd() * SITE_PRESET_THEMES.length)];
      } else {
        finalTheme = JSON.stringify(themeData);
      }
      finalPrimary = themeData.p1;
      finalAccent = themeData.p2;
    } else {
      branding = {
        logo: logo || '✨',
        hero_badge: '소셜 성장 자동화 플랫폼',
        hero_prefix: '콘텐츠가',
        ui_layout: 'classic',
        slogan: '빛나도록',
        slogan_sub: '우리가 성장시킵니다',
        description: '유튜브·인스타·틱톡·X까지 모든 소셜 채널의 성장을 자동화합니다',
        stat1_num: '10K+', stat1_label: '서비스 종류',
        stat2_num: '24H', stat2_label: '빠른 처리',
        stat3_num: '50%+', stat3_label: '마진 보장',
        stat4_num: '100%', stat4_label: '안전 보장',
      };
      finalTheme = 'glow';
      finalPrimary = primaryColor || '#7209B7';
      finalAccent = accentColor || '#F72585';
    }
    const finalLogo = (logo && logo.trim() && logo.trim() !== '✨') ? logo.trim() : branding.logo;

    const newSiteExrate = await getGlobalExrateNum();
    await query(`INSERT INTO sites(
      id,domain,name,logo,primary_color,accent_color,margin,exrate,credit,super_margin,theme,
      hero_badge,hero_prefix,ui_layout,slogan,slogan_sub,description,
      stat1_num,stat1_label,stat2_num,stat2_label,stat3_num,stat3_label,stat4_num,stat4_label
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
      [siteId, domain, name, finalLogo, finalPrimary, finalAccent,
        parseFloat(margin || 0), newSiteExrate, parseFloat(credit || 0), superMarginVal, finalTheme,
        branding.hero_badge, branding.hero_prefix, branding.ui_layout,
        branding.slogan, branding.slogan_sub, branding.description,
        branding.stat1_num, branding.stat1_label, branding.stat2_num, branding.stat2_label,
        branding.stat3_num, branding.stat3_label, branding.stat4_num, branding.stat4_label]);
    const hash = bcrypt.hashSync(adminPw, 10);
    const adminRole = req.body.adminRole || 'admin';
    await query(`INSERT INTO users(id,site_id,name,email,pw,role,balance) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      ['admin_'+siteId, siteId, '관리자', adminEmail, hash, adminRole, 0]);
    // 🆕 새 사이트에 활성 서비스 전체 자동 연결 (ON 상태로 site_services 테이블에 INSERT)
    try {
      await query(`
        INSERT INTO site_services(site_id, service_id, active)
        SELECT $1, id, 1 FROM services WHERE active=1
        ON CONFLICT(site_id, service_id) DO UPDATE SET active=1
      `, [siteId]);
    } catch(e) { console.error('site_services 자동 활성화 실패:', e.message); }
    const themeLabel = finalTheme.startsWith('{') ? '커스텀 조합' : finalTheme;
    res.json({
      ok: true, siteId, autoTheme: useAutoTheme, themeLabel, logo: finalLogo,
      uiLayout: branding.ui_layout || 'classic'
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/sites/credit', requireSuperAdmin, async (req, res) => {
  try {
    const { siteId, amount, krwAmount } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.json({ error: '금액을 입력하세요' });
    await query(`UPDATE sites SET credit=credit+$1 WHERE id=$2`, [amt, siteId]);
    if (krwAmount) await recordManualCreditGrant(siteId, krwAmount, '슈퍼관리자 직접 충전');
    const r = await query(`SELECT * FROM sites WHERE id=$1`, [siteId]);
    res.json({ ok: true, credit: r.rows[0].credit });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 사이트 크레딧 직접 수정 (정확한 값으로 덮어쓰기 · 잘못 충전 정정용)
app.post('/api/super/sites/repair-services', requireSuperAdmin, async (req, res) => {
  try {
    const { siteId, force } = req.body || {};
    if (siteId) {
      const r = await repairSiteServices(siteId, !!force);
      return res.json({ ok: true, ...r });
    }
    const results = await repairAllPartnerSiteServices();
    res.json({ ok: true, message: '모든 지인 사이트 상품 동기화 완료', results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/sites/fix-abnormal-credits', requireSuperAdmin, async (req, res) => {
  try {
    const before = await query(`
      SELECT id, name, credit, exrate FROM sites
      WHERE credit >= 999999999
         OR (credit * COALESCE(NULLIF(exrate, 0), 1500)) > 10000000
    `);
    const fixed = await normalizeAbnormalCredits();
    res.json({ ok: true, fixed, sites: before.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/sites/credit-set', requireSuperAdmin, async (req, res) => {
  try {
    const { siteId, credit } = req.body;
    const newCredit = parseFloat(credit);
    if (isNaN(newCredit) || newCredit < 0) return res.json({ error: '0 이상의 크레딧 값을 입력하세요' });
    const beforeR = await query(`SELECT * FROM sites WHERE id=$1`, [siteId]);
    if (!beforeR.rows[0]) return res.json({ error: '사이트를 찾을 수 없습니다' });
    const before = parseFloat(beforeR.rows[0].credit) || 0;
    await query(`UPDATE sites SET credit=$1 WHERE id=$2`, [newCredit, siteId]);
    // 변경 이력 기록 (추적용)
    try {
      await logActivity('default', req.session.userId, '', '크레딧 직접 수정', 'credit', siteId,
        `$${before.toFixed(2)} → $${newCredit.toFixed(2)} (${beforeR.rows[0].name})`);
    } catch(e) {}
    res.json({ ok: true, credit: newCredit, before });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/super/sites/default-pricing', requireSuperAdmin, async (req, res) => {
  try {
    const r = await query(`SELECT id, name, domain, margin, super_margin FROM sites WHERE id='default'`);
    if (!r.rows[0]) return res.json({ error: 'default 사이트가 없습니다' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** GLOW 본사(default) 고객 마진만 저장 — 지인 사이트와 별개 */
app.post('/api/super/sites/default-pricing', requireSuperAdmin, async (req, res) => {
  try {
    const margin = parseFloat(req.body.margin);
    const superMargin = parseFloat(req.body.superMargin);
    if (isNaN(margin) || margin < 0 || margin > 500) {
      return res.json({ error: '본사 사이트마진은 0~500% 사이여야 합니다' });
    }
    if (isNaN(superMargin) || superMargin < 0 || superMargin > 500) {
      return res.json({ error: '본사 슈퍼마진은 0~500% 사이여야 합니다' });
    }
    await query(`UPDATE sites SET margin=$1, super_margin=$2 WHERE id='default'`, [margin, superMargin]);
    const r = await query(`SELECT id, name, domain, margin, super_margin FROM sites WHERE id='default'`);
    await logActivity('default', req.session.userId, '', '본사 마진 변경', 'site', 'default',
      `사이트마진 ${margin}% / 슈퍼마진 ${superMargin}%`);
    res.json({ ok: true, site: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/sites/update', requireSuperAdmin, async (req, res) => {
  try {
    const { siteId, name, domain, logo, primaryColor, accentColor, margin, exrate, active } = req.body;
    if (!siteId) return res.json({ error: 'siteId가 필요합니다' });

    const beforeR = await query(`SELECT * FROM sites WHERE id=$1`, [siteId]);
    if (!beforeR.rows[0]) return res.json({ error: '사이트를 찾을 수 없습니다' });
    const before = beforeR.rows[0];

    const marginNum = parseFloat(margin);
    if (isNaN(marginNum) || marginNum < 0 || marginNum > 500) {
      return res.json({ error: '사이트마진은 0~500% 사이여야 합니다' });
    }
    const exrateNum = await getGlobalExrateNum();

    let superMarginVal = before.super_margin >= 0 ? before.super_margin : 50;
    if (req.body.superMargin !== undefined && req.body.superMargin !== null && String(req.body.superMargin).trim() !== '') {
      const sm = parseFloat(req.body.superMargin);
      if (isNaN(sm) || sm < 0 || sm > 500) {
        return res.json({ error: '슈퍼마진은 0~500% 사이여야 합니다' });
      }
      superMarginVal = sm;
    }

    // theme은 건드리지 않음 (자동 테마 JSON 보존 · 저장 실패처럼 보이는 현상 방지)
    await query(
      `UPDATE sites SET name=$1,domain=$2,logo=$3,primary_color=$4,accent_color=$5,margin=$6,exrate=$7,active=$8,super_margin=$9 WHERE id=$10`,
      [name, domain, logo || '✨', primaryColor, accentColor, marginNum, exrateNum, active ? 1 : 0, superMarginVal, siteId]
    );

    const afterR = await query(`SELECT id, name, margin, super_margin, domain FROM sites WHERE id=$1`, [siteId]);
    res.json({ ok: true, site: afterR.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


app.post('/api/super/sites/delete', requireSuperAdmin, async (req, res) => {
  try {
    const { siteId, confirmName } = req.body;
    if (!siteId || siteId === 'default') return res.json({ error: '기본 사이트는 삭제할 수 없습니다' });
    const siteR = await query(`SELECT id, name FROM sites WHERE id=$1`, [siteId]);
    const site = siteR.rows[0];
    if (!site) return res.json({ error: '사이트를 찾을 수 없습니다' });
    if (String(confirmName || '').trim() !== String(site.name || '').trim()) {
      return res.json({ error: '사이트 이름 확인이 일치하지 않습니다' });
    }
    const memberR = await query(`SELECT COUNT(*)::int AS c FROM users WHERE site_id=$1 AND role='user' AND COALESCE(status,'active') <> 'deleted'`, [siteId]);
    // 회원·주문·충전 데이터는 유지하고 사이트만 비활성화
    await query(`UPDATE sites SET active=0 WHERE id=$1`, [siteId]);
    await logActivity('default', req.session.userId, '', '사이트 비활성화(데이터 보존)', 'site', siteId,
      `${site.name} · 회원 ${memberR.rows[0]?.c || 0}명 데이터 보존`);
    res.json({ ok: true, deactivated: true, membersPreserved: memberR.rows[0]?.c || 0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/users/restore', requireSuperAdmin, async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) return res.json({ error: '회원을 지정해 주세요' });
    const r = await query(`SELECT * FROM users WHERE id=$1`, [uid]);
    const user = r.rows[0];
    if (!user) return res.json({ error: '회원을 찾을 수 없습니다' });
    if (user.status !== 'deleted') return res.json({ error: '탈퇴 상태가 아닙니다' });
    await query(`UPDATE users SET status='active', deleted_at=NULL, deleted_by=NULL WHERE id=$1`, [uid]);
    await logActivity(user.site_id, req.session.userId, '', '회원 복구', 'user', uid, user.email);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/exrate-sync', requireSuperAdmin, async (req, res) => {
  try {
    const r = await autoSyncGlobalExrate({ force: true, notify: false });
    if (!r.ok && r.skipped) return res.json({ error: '환율 API 연결 실패. 잠시 후 다시 시도하세요.' });
    res.json({
      ok: true,
      rate: r.rate,
      previous: r.previous,
      unchanged: !!r.unchanged,
      source: r.source || (await getGlobalSetting('exrate_sync_source')) || '',
      syncedAt: await getGlobalSetting('exrate_sync_at'),
      sitesSynced: r.sitesSynced
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/settings/save', requireSuperAdmin, async (req, res) => {
  try {
    const { key, value } = req.body;
    const allowed = ['super_margin', 'global_site_margin', 'global_exrate', 'peakerr_api_key', 'smmkings_api_key', 'tg_token', 'tg_chat', 'resend_api_key', 'email_from'];
    if (!allowed.includes(key)) return res.json({ error: '잘못된 설정 키' });
    const v = String(value || '').trim();
    if (key === 'peakerr_api_key') {
      const saved = await savePeakerrApiKeySafely(v);
      if (!saved.ok) return res.json({ error: saved.error });
      return res.json({
        ok: true,
        peakerrTest: { balance: saved.balance },
        locked: true
      });
    }
    if (key === 'smmkings_api_key') {
      const saved = await saveSmmkingsApiKeySafely(v);
      if (!saved.ok) return res.json({ error: saved.error });
      await ensureSmmkingsSeedServices().catch(() => null);
      await syncSmmkingsCatalog().catch(() => null);
      return res.json({
        ok: true,
        smmkingsTest: { balance: saved.balance },
        locked: true
      });
    }
    if (key === 'resend_api_key' && v && !v.startsWith('re_')) {
      return res.json({ error: 'Resend API 키 형식이 아닙니다 (re_ 로 시작).' });
    }
    await setGlobalSetting(key, v);
    if (key === 'global_exrate') {
      const ex = parseFloat(value);
      if (!isNaN(ex) && ex >= 100 && ex <= 5000) {
        const sync = await syncAllSitesExrate(ex);
        return res.json({ ok: true, sitesExrateSynced: sync.count });
      }
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/super/dashboard', requireSuperAdmin, async (req, res) => {
  try {
    // 매출 집계 제외 상태: 취소·실패·환불 주문은 실매출이 아님
    const EXCLUDE = `status NOT IN ('cancelled','canceled','failed','refunded','partial_refunded')`;
    const sites = await query(`SELECT * FROM sites ORDER BY created DESC`);
    const totalUsers = await query(`SELECT COUNT(*) as c FROM users WHERE role='user'`);
    const totalOrders = await query(`SELECT COUNT(*) as c FROM orders WHERE ${EXCLUDE}`);
    const totalRevenue = await query(`SELECT SUM(charge) as s FROM orders WHERE ${EXCLUDE}`);
    const pendingCharges = await query(`SELECT COUNT(*) as c FROM charges WHERE status='pending'`);
    // 순수익 계산: API 원가 합계 (취소·환불 주문 제외)
    const totalApiCost = await query(`SELECT SUM(o.qty * s.rate / 1000.0) as s FROM orders o JOIN services s ON o.sid = s.id WHERE o.${EXCLUDE}`);
    let apiBalance = null, apiBalanceError = null;
    let apiKey = await getPeakerrApiKey();
    let balR = await fetchPeakerrBalance(apiKey);
    if (!balR.ok) {
      const rec = await reconcilePeakerrApiKey({ silent: true });
      if (rec.ok) {
        apiKey = await getPeakerrApiKey();
        balR = await fetchPeakerrBalance(apiKey);
      }
    }
    if (balR.ok) apiBalance = balR.balance.toFixed(2);
    else apiBalanceError = balR.error;
    const peakerrLocked = !!(apiKey && balR.ok);
    const peakerrVerifiedAt = await getGlobalSetting(PEAKERR_KEY_VERIFIED);
    let smmkingsBalance = null, smmkingsBalanceError = null;
    let skKey = await getSmmkingsApiKey();
    let skBal = await fetchPanelBalance('smmkings', skKey);
    if (!skBal.ok) {
      const skRec = await reconcileSmmkingsApiKey({ silent: true });
      if (skRec.ok) {
        skKey = await getSmmkingsApiKey();
        skBal = await fetchPanelBalance('smmkings', skKey);
      }
    }
    if (skBal.ok) smmkingsBalance = skBal.balance.toFixed(2);
    else smmkingsBalanceError = skBal.error;
    const siteStats = await Promise.all(sites.rows.map(async s => {
      const uc = await query(`SELECT COUNT(*) as c FROM users WHERE site_id=$1 AND role='user'`, [s.id]);
      const oc = await query(`SELECT COUNT(*) as c FROM orders WHERE site_id=$1 AND ${EXCLUDE}`, [s.id]);
      const rv = await query(`SELECT SUM(charge) as v FROM orders WHERE site_id=$1 AND ${EXCLUDE}`, [s.id]);
      const pc = await query(`SELECT COUNT(*) as c FROM charges WHERE site_id=$1 AND status='pending'`, [s.id]);
      const chAp = await query(`SELECT COALESCE(SUM(amount),0) as s FROM charges WHERE site_id=$1 AND status='approved'`, [s.id]);
      const chRev = await query(`SELECT COALESCE(SUM(amount),0) as s FROM charges WHERE site_id=$1 AND status='reversed'`, [s.id]);
      const crAp = await query(`SELECT COALESCE(SUM(amount),0) as s FROM credit_requests WHERE site_id=$1 AND status='approved'`, [s.id]);
      const siteEx = parseFloat(s.exrate) || parseFloat(await getGlobalSetting('global_exrate')) || 1500;
      const creditUsd = parseFloat(s.credit) || 0;
      const creditBalanceKrw = await getCreditBalanceKrw(s.id, creditUsd, siteEx);
      return {
        ...s,
        userCount: parseInt(uc.rows[0].c),
        orderCount: parseInt(oc.rows[0].c),
        revenue: rv.rows[0].v || 0,
        pendingCharge: parseInt(pc.rows[0].c),
        chargeApprovedTotal: parseFloat(chAp.rows[0].s) || 0,
        chargeReversedTotal: parseFloat(chRev.rows[0].s) || 0,
        creditReceivedTotal: parseFloat(crAp.rows[0].s) || 0,
        creditBalanceKrw,
        creditUsd,
      };
    }));
    const partnerSites = siteStats.filter(s => s.id !== 'default');
    const totalCreditBalanceKrw = partnerSites.reduce((sum, s) => sum + (s.creditBalanceKrw || 0), 0);
    const totalChargeApprovedKrw = siteStats.reduce((sum, s) => sum + (s.chargeApprovedTotal || 0), 0);
    const totalCreditReceivedKrw = partnerSites.reduce((sum, s) => sum + (s.creditReceivedTotal || 0), 0);
    const superMgForProfit = await getGlobalSetting('super_margin');
    const superMgPct = parseFloat(superMgForProfit || '50') / 100;
    const globalEx = await getGlobalSetting('global_exrate');
    const exRate = parseFloat(globalEx || '1500');
    const totalApiCostUsd = totalApiCost.rows[0].s || 0;
    const totalApiCostKrw = totalApiCostUsd * exRate;
    const myProfitKrw = totalApiCostKrw * superMgPct; // 순수익 = API원가 × 슈퍼마진율

    res.json({
      sites: siteStats,
      totalUsers: parseInt(totalUsers.rows[0].c),
      totalOrders: parseInt(totalOrders.rows[0].c),
      totalRevenue: totalRevenue.rows[0].s || 0,
      pendingCharges: parseInt(pendingCharges.rows[0].c),
      totalCreditBalanceKrw,
      totalChargeApprovedKrw,
      totalCreditReceivedKrw,
      apiBalance,
      apiBalanceError,
      peakerrLocked,
      peakerrVerifiedAt: peakerrVerifiedAt || null,
      smmkingsBalance,
      smmkingsBalanceError,
      smmkingsLocked: !!(skKey && skBal.ok),
      myProfit: Math.round(myProfitKrw),
      globalExrate: parseFloat((await getGlobalSetting('global_exrate')) || '1500')
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
  if (n.includes('twitch')) return 'twitch';
  if (n.includes('amazon')) return 'amazon';
  if (n.includes('coupang') || n.includes('쿠팡')) return 'coupang';
  if (/shopee|lazada|aliexpress|ali express|\bebay\b|etsy|shopify|wish\.com|walmart seller|tokopedia|mercado livre/.test(n)) return 'ecommerce';
  if (/tistory|티스토리|brunch|브런치|band\.naver|naver band|네이버밴드/.test(n)) return 'naver';
  if (/naver|네이버|smartstore|스마트스토어|naver place|naver blog|naver cafe/.test(n)) return 'naver';
  if (/kakao|카카오|kakaotalk|ch channel|kakao channel/.test(n)) return 'kakao';
  if (n.includes('pinterest')) return 'pinterest';
  if (n.includes('discord')) return 'other';
  if (n.includes('linkedin')) return 'other';
  if (n.includes('reddit')) return 'other';
  if (n.includes('soundcloud')) return 'other';
  if (/google my business|google map|gmb |google review/.test(n)) return 'traffic';
  if (n.includes('트래픽') || n.includes('traffic') || n.includes('seo') || n.includes('검색')) return 'traffic';
  if (n.includes('appstore') || n.includes('play store') || n.includes('ios') || n.includes('android')) return 'appstore';
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
    const r = await query(`SELECT o.*, COALESCE(s.name, o.site_id) AS site_name, u.role AS user_role
      FROM orders o
      LEFT JOIN sites s ON o.site_id = s.id
      LEFT JOIN users u ON o.uid = u.id
      ORDER BY o.created DESC LIMIT 200`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/super/charges', requireSuperAdmin, async (req, res) => {
  try {
    const r = await query(`SELECT c.*, COALESCE(s.name, c.site_id) AS site_name
      FROM charges c LEFT JOIN sites s ON c.site_id = s.id
      ORDER BY c.created DESC LIMIT 200`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 승인된 충전 회수 (잔액 차감 + 상태 reversed)
app.post('/api/super/charges/reverse', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.json({ error: '충전 ID 필요' });
    const r = await query(`SELECT * FROM charges WHERE id=$1`, [id]);
    const charge = r.rows[0];
    if (!charge) return res.json({ error: '충전 내역을 찾을 수 없습니다' });
    const result = await reverseApprovedCharge(charge, req.session.userId, { reason: '충전 승인 회수 (관리자 오류 정정)' });
    if (result.error) return res.json({ error: result.error });
    await logActivity(req.siteId, req.session.userId, '', '충전 회수', 'charge', id,
      `₩${Math.round(charge.amount).toLocaleString()} 회수 → 잔액 ₩${Math.round(result.balance || 0).toLocaleString()}`);
    res.json(result);
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

// SPA - 사이트별 브랜딩을 서버사이드에서 삽입 (FOUC 완전 방지)
app.get('*', async (req, res) => {
  try {
    // 비활성(관리비 미납 등) 파트너 도메인 → 본사 GLOW로 넘어가지 않고 정지 안내
    if (req.siteSuspended) {
      const siteName = String(req.site?.name || '사이트').replace(/[<>&"]/g, '');
      const logo = String(req.site?.logo || '⏸').replace(/[<>&"]/g, '');
      const feeKrw = 70000;
      const bankLine = '우리은행 1002-160-164625';
      const bankHolder = '예금주: 조인호';
      const feeLabel = feeKrw.toLocaleString('ko-KR');
      return res.status(503).type('html').send(`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${siteName} — 이용 중단</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    background:#0f0f12;color:#f2f2f5;padding:24px}
  .box{max-width:440px;width:100%;text-align:center;background:#1a1a22;border:1px solid #2e2e3a;
    border-radius:20px;padding:40px 28px}
  .logo{font-size:42px;margin-bottom:12px}
  h1{font-size:22px;margin:0 0 8px;font-weight:800}
  p{margin:0;font-size:14px;line-height:1.65;color:#a8a8b8}
  .badge{display:inline-block;margin-top:18px;padding:8px 14px;border-radius:999px;
    background:#3a1520;color:#ff8a9a;font-size:12px;font-weight:700}
  .pay{margin-top:22px;text-align:left;background:#121218;border:1px solid #2e2e3a;
    border-radius:14px;padding:16px 18px}
  .pay h2{margin:0 0 10px;font-size:13px;color:#ffb4c0;font-weight:700;letter-spacing:.02em}
  .pay .fee{font-size:28px;font-weight:800;color:#fff;margin:0 0 12px}
  .pay .fee span{font-size:14px;font-weight:600;color:#a8a8b8;margin-left:4px}
  .pay .bank{font-size:15px;font-weight:700;color:#e8e8f0;line-height:1.5;word-break:keep-all}
  .pay .holder{font-size:13px;color:#a8a8b8;margin-top:4px}
  .pay .hint{margin-top:12px;font-size:12px;color:#8a8a9a;line-height:1.55}
</style>
</head>
<body>
  <div class="box">
    <div class="logo">${logo}</div>
    <h1>${siteName}</h1>
    <p>현재 이 사이트는 <b style="color:#fff">관리비 미납</b>으로<br>
    이용이 <b style="color:#fff">일시 중단</b>되었습니다.<br><br>
    아래 계좌로 관리비를 입금해 주시면<br>
    확인 후 <b style="color:#fff">바로 정지 해제</b>됩니다.</p>
    <div class="pay">
      <h2>관리비 입금 안내</h2>
      <div class="fee">₩${feeLabel}<span>/월</span></div>
      <div class="bank">${bankLine}</div>
      <div class="holder">${bankHolder}</div>
      <div class="hint">입금자명에 사이트명(또는 상호)을 적어 주세요.<br>입금 확인되면 서비스를 다시 열어 드립니다.</div>
    </div>
    <div class="badge">SERVICE SUSPENDED · 관리비 미납</div>
  </div>
</body>
</html>`);
    }

    // HTML 파일 매번 새로 읽기 (사이트 설정 변경 시 즉시 반영)
    const html_template = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    let html = html_template;
    
    // 현재 요청 도메인의 사이트 정보
    const site = req.site;
    
    // 기본값 (default 사이트 또는 site 없을 경우)
    let siteName = 'GLOW';
    let siteLogo = '✨';
    let primaryColor = '#F72585';
    let accentColor = '#B5179E';
    let p3Color = '#7209B7';
    
    const isDefaultSite = site && site.id === 'default';
    const pres = getEffectiveSitePresentation(site);
    const siteTheme = pres.theme;
    const siteLayout = pres.uiLayout;
    const PRESET_THEME_CSS = {
      'glow-blue': {
        attr: 'glow-blue',
        css: `:root{
  --p1:#00B4FF !important;--p2:#0096FF !important;--p3:#6366F1 !important;
  --g:linear-gradient(120deg,#00E5FF,#00B4FF,#0096FF,#6366F1) !important;
  --bg:#020818 !important;--w:#0A1220 !important;--tx:#E8F4FF !important;
  --tm:#94B8E8 !important;--tl:#5A7A9A !important;
  --bd:rgba(0,180,255,.16) !important;--bd2:rgba(99,102,241,.28) !important;
}
body{
  background:#020818!important;color:#E8F4FF!important;
  background-image:
    radial-gradient(ellipse 100% 80% at 50% -20%,rgba(0,150,255,.16),transparent 55%),
    radial-gradient(circle at 12% 45%,rgba(99,102,241,.1),transparent 38%),
    radial-gradient(circle at 88% 60%,rgba(0,229,255,.07),transparent 40%)!important;
}`,
      },
      anonymous: {
        attr: 'anonymous',
        css: `:root{
  --p1:#D8D8D8 !important;--p2:#8E8E8E !important;--p3:#4A4A4A !important;
  --g:linear-gradient(135deg,#F0F0F0,#9A9A9A,#3A3A3A) !important;
  --bg:#050505 !important;--w:#0E0E0E !important;--tx:#E2E2E2 !important;
  --tm:#8A8A8A !important;--tl:#4E4E4E !important;
  --bd:rgba(255,255,255,.07) !important;--bd2:rgba(255,255,255,.14) !important;
}
body{background:#050505!important;color:#E2E2E2!important}`,
      },
    };
    const presetPack = isDefaultSite ? PRESET_THEME_CSS[siteTheme] : null;

    if (site) {
      siteName = (site.name || 'GLOW').replace(/[<>"']/g, '');
      siteLogo = (site.logo || '✨').replace(/[<>"']/g, '');
      if (site.primary_color) primaryColor = site.primary_color;
      if (site.accent_color) accentColor = site.accent_color;
    }

    if (presetPack) {
      html = html.replace('<html lang="ko">', `<html lang="ko" data-theme="${presetPack.attr}" data-layout="${siteLayout}">`);
    } else if (siteLayout && siteLayout !== 'classic') {
      html = html.replace('<html lang="ko">', `<html lang="ko" data-layout="${siteLayout}">`);
    }
    
    // HTML placeholder를 실제 값으로 치환 (모든 발생 위치)
    html = html.split('__SITE_NAME__').join(siteName);
    html = html.split('__SITE_LOGO__').join(siteLogo);
    html = html.split('__SITE_ID__').join(String(site?.id || 'default').replace(/[<>"']/g, ''));
    const introTag = isDefaultSite ? 'GLOW HEADQUARTERS' : 'CHANNEL GROWTH';
    const introSub = String(site?.slogan_sub || site?.slogan || '소셜 성장 · 마케팅 플랫폼')
      .replace(/[<>"']/g, '').slice(0, 48);
    html = html.split('__INTRO_TAG__').join(introTag);
    html = html.split('__INTRO_SUB__').join(introSub);
    // 인트로 배경색 — head 최상단 CSS에서 즉시 사용 (FOUC 방지)
    let introBg = '#FAFAFA';
    if (presetPack && (siteTheme === 'glow-blue' || siteTheme === 'anonymous')) {
      introBg = siteTheme === 'glow-blue' ? '#020818' : '#050505';
    } else if (site?.theme && String(site.theme).trim().startsWith('{')) {
      try {
        const td = JSON.parse(site.theme);
        if (td.bg) introBg = String(td.bg).replace(/[<>"']/g, '');
      } catch (e) {}
    } else if (['dark', 'neon', 'glow-blue', 'anonymous'].includes(String(siteTheme))) {
      introBg = ({ dark: '#0A0A0F', neon: '#050508', 'glow-blue': '#020818', anonymous: '#050505' })[siteTheme] || introBg;
    } else if (primaryColor) {
      introBg = '#FAFAFA';
    }
    html = html.split('__INTRO_BG__').join(introBg);
    html = html.replace('<!-- __SITE_OG__ -->', buildSiteOgHtml(site, req));
    
    // 커스텀 테마 색상 주입 (FOUC 방지)
    const customTheme = presetPack
      ? `<style id="dynamic-theme">${presetPack.css}</style>`
      : `<style id="dynamic-theme">
:root{
  --p1:${primaryColor} !important;
  --p2:${accentColor} !important;
  --p3:${p3Color} !important;
  --g:linear-gradient(135deg,${primaryColor},${accentColor},${p3Color},#4361EE) !important;
}
</style>`;
    html = html.replace('<!-- __CUSTOM_THEME__ -->', customTheme);
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(html);
  } catch(e) {
    console.log('HTML 렌더 오류:', e.message);
    res.status(500).send('서버 오류');
  }
});

// 서버 시작
app.listen(PORT, async () => {
  console.log(`✨ GLOW Multi-Tenant 서버 실행 중: http://localhost:${PORT}`);
  await initDB();

  // 텔레그램 웹훅 자동 등록 (슈퍼관리자 봇 + 모든 사이트 봇)
  try {
    const renderUrl = process.env.RENDER_EXTERNAL_URL;
    if (renderUrl) {
      const webhookUrl = `${renderUrl}/api/tg-webhook`;
      // 등록할 봇 토큰 수집 (중복 제거)
      const tokens = new Set();
      const superToken = await getGlobalSetting('tg_token');
      if (superToken) tokens.add(superToken);
      // 모든 사이트의 봇 토큰
      try {
        const siteR = await query(`SELECT tg_token FROM sites WHERE tg_token IS NOT NULL AND tg_token != ''`);
        siteR.rows.forEach(s => { if (s.tg_token) tokens.add(s.tg_token); });
      } catch(e) {}
      // 각 봇에 webhook 등록
      let ok = 0;
      for (const tk of tokens) {
        try {
          await fetch(`https://api.telegram.org/bot${tk}/setWebhook`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: webhookUrl })
          });
          ok++;
        } catch(e) { console.log('웹훅 등록 실패(개별):', e.message); }
      }
      console.log(`✅ 텔레그램 웹훅 등록 완료: ${ok}/${tokens.size}개 봇`);
    }
  } catch(e) { console.log('웹훅 등록 실패:', e.message); }
  
  // 🧹 오래된 로그/만료 토큰 정리 (서버 시작 시 + 24시간마다)
  async function cleanup() {
    try {
      // 30일 이상 된 활동 로그 삭제
      await query(`DELETE FROM activity_logs WHERE created < NOW() - INTERVAL '30 days'`);
      // 90일 이상 된 잔액 로그 삭제
      await query(`DELETE FROM balance_logs WHERE created < NOW() - INTERVAL '90 days'`);
      // 만료된 비밀번호 토큰 삭제
      await query(`DELETE FROM password_resets WHERE expires < NOW() OR used=1`);
      // Rate limit 윈도우 오래된 것 삭제
      await query(`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour'`);
      console.log('🧹 로그 정리 완료');
    } catch(e) { console.log('로그 정리 실패:', e.message); }
  }
  cleanup(); // 시작 시 1회
  setInterval(cleanup, 24 * 60 * 60 * 1000); // 24시간마다
  
  // 💵 Peakerr 잔액·키 잠금 점검 (6시간마다)
  setInterval(async () => {
    await reconcilePeakerrApiKey({ silent: true }).catch(() => {});
    await checkPeakerrBalance().catch(() => {});
  }, 6 * 60 * 60 * 1000);
  
  reconcilePeakerrApiKey({ silent: false }).catch(e => console.log('Peakerr 키 시작 점검:', e.message));
  reconcileSmmkingsApiKey({ silent: false }).catch(e => console.log('SMMKings 키 시작 점검:', e.message));
  ensureSmmkingsSeedServices().catch(e => console.log('SMMKings 시드:', e.message));
  
  // 🔄 주문 상태 자동 동기화 (5분마다 — Peakerr 취소·완료 즉시 반영)
  setInterval(async () => {
    await syncAllOrderStatuses().catch(e => console.log('주문 동기화 스케줄러 오류:', e.message));
  }, 5 * 60 * 1000);

  // ♻️ 리필 보장 상품 — 완료 후 드롭 자동 보충 (12시간마다)
  processEligibleRefills({ maxPerRun: 10 }).catch(e => console.log('리필 초기 실행:', e.message));
  setInterval(async () => {
    await processEligibleRefills({ maxPerRun: 15 }).catch(e => console.log('리필 스케줄러:', e.message));
  }, 12 * 60 * 60 * 1000);
  
  // 💱 USD/KRW 환율 자동 갱신 (6시간마다 + 시작 시 1회)
  autoSyncGlobalExrate({ notify: false }).catch(e => console.log('환율 자동 갱신 오류:', e.message));
  setInterval(async () => {
    await autoSyncGlobalExrate({ notify: true }).catch(e => console.log('환율 자동 갱신 스케줄 오류:', e.message));
  }, 6 * 60 * 60 * 1000);

  // 🔄 상품 카탈로그 정리 (6시간마다 + 시작 시 1회 — 미작동·중복 제거)
  //    Render 무료 인스턴스는 잠들었다 깨면 타이머가 리셋되므로 시작 시 실행 필수
  reconcileServiceCatalog({ notify: false }).catch(e => console.log('카탈로그 정리 초기 실행 오류:', e.message));
  setInterval(async () => {
    await reconcileServiceCatalog({ notify: false }).catch(e => console.log('카탈로그 정리 스케줄러 오류:', e.message));
  }, 6 * 60 * 60 * 1000);
  
  // 🆕 신규 서비스 스캔 (일요일마다)
  setInterval(async () => {
    const now = new Date();
    if (now.getDay() === 0 && now.getHours() === 10) { // 일요일 오전 10시
      await scanNewServices().catch(e => console.log('신규 스캔 오류:', e.message));
    }
  }, 60 * 60 * 1000);

  // 🛡️ 상품 카탈로그 건강 점검 (매일 09:00 KST 근사 · UTC 0시)
  setInterval(async () => {
    const now = new Date();
    if (now.getUTCHours() === 0) {
      await runCatalogHealthCheck(true).catch(e => console.log('카탈로그 점검:', e.message));
    }
  }, 60 * 60 * 1000);
  
  // 서버 시작 후 30초 뒤 자동 동기화 (DB 준비 대기)
  setTimeout(async () => {
    console.log('🔄 서버 시작 후 자동 동기화 실행');
    await runPreflightHealthCheck({ notify: true }).catch(() => {});
    await syncAllOrderStatuses().catch(() => {});
    await upgradeEngagementSeedsFromPeakerr().catch(e => console.log('참여형 시드 업그레이드:', e.message));
    await processEligibleRefills({ maxPerRun: 20 }).catch(() => {});
    await runCatalogHealthCheck(true).catch(() => {});
    const niche = await importNichePeakerrServices({ notify: false }).catch(e => ({ error: e.message, count: 0 }));
    if (niche.count > 0) console.log(`🛒 이커머스·보너스 상품 ${niche.count}개 추가`);
    const krPin = await importKoreanAndPinterestServices({ notify: true }).catch(e => ({ error: e.message, count: 0 }));
    if (krPin.count > 0) console.log(`🇰🇷 한국·Pinterest ${krPin.count}개 추가 (한국 ${krPin.korean || 0} / 핀 ${krPin.pinterest || 0})`);
    else if (!krPin.error) console.log('🇰🇷 한국·Pinterest: Peakerr에 추가할 HQ 상품 없음');
    const vn = await importVietnamInstagramTiktokServices({ notify: true }).catch(e => ({ error: e.message, count: 0 }));
    if (vn.count > 0) console.log(`🇻🇳 베트남 IG·TT ${vn.count}개 추가 (인스타 ${vn.instagram || 0} / 틱톡 ${vn.tiktok || 0})`);
    else if (!vn.error) console.log('🇻🇳 베트남 Instagram·TikTok: Peakerr에 추가할 상품 없음');
    else console.log('🇻🇳 베트남 스캔:', vn.error);
    if (!niche.error && niche.count === 0) console.log('🛒 Peakerr 이커머스·보너스: 추가할 상품 없음');
    else if (niche.error) console.log('🛒 이커머스 스캔:', niche.error);
  }, 30 * 1000);

  // 🛡️ 30분마다 사전점검 (시작숫자·orphan·Peakerr)
  setInterval(async () => {
    await runPreflightHealthCheck({ notify: false }).catch(e => console.log('사전점검:', e.message));
  }, 30 * 60 * 1000);

  startDailyReportScheduler(query, getGlobalSetting, setGlobalSetting, sendTelegramToSuper);
});
