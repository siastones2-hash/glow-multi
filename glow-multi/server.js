const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

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
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0`).catch(()=>{});
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_earned INTEGER DEFAULT 0`).catch(()=>{});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT DEFAULT NULL`).catch(()=>{});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by TEXT DEFAULT NULL`).catch(()=>{});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_bonus INTEGER DEFAULT 0`).catch(()=>{});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT ''`).catch(()=>{});

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
  
  // GLOW 본사
  const siteExists = await query(`SELECT id FROM sites WHERE id='default'`);
  if (siteExists.rows.length === 0) {
    await query(`INSERT INTO sites(id,domain,name,logo,primary_color,accent_color,kakao,bank,margin,exrate,credit,super_margin)
      VALUES('default','localhost','GLOW','✨','#F72585','#B5179E',
      '',
      $1,
      40,1500,999999999,100)`, [BANK_INFO]);
  } else {
    // 기존 사이트도 계좌번호 업데이트
    await query(`UPDATE sites SET bank=$1, super_margin=100, exrate=1500 WHERE id='default'`, [BANK_INFO]);
  }

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
      {id:'pyt13',name:'YouTube 구독자 — 고속 성장 (30일 보장)',pl:'youtube',rate:28.0,min:10,max:50000,description:'일 500~1000명 고속 속도로 유튜브 구독자를 빠르게 확보하는 서비스입니다. 채널 개설 초기 또는 바이럴 콘텐츠 게시 후 가속 성장이 필요한 경우에 적합하며, 30일 드롭 보상이 제공되어 단기 부스트 후에도 안정적인 구독자 수를 유지합니다. 브랜드 채널이나 이벤트성 프로모션에 강력한 효과를 발휘합니다.',api_id:'28716'},
      {id:'pyt14',name:'YouTube 조회수 — 리얼 네이티브 (200K+/일) 🔥',pl:'youtube',rate:1.05,min:1000,max:10000000,description:'실제 유저 기반 프리미엄 유튜브 조회수 서비스로, 일 20만 이상 초고속 처리가 가능합니다. 리얼 네이티브 뷰로 분류되어 유튜브 알고리즘이 조회수 가치를 100% 인정해 추천 영상·인기 급상승 피드 노출에 가장 강력한 효과를 발휘합니다. 드롭 없는 평생 보장으로 영상 가치가 영구 유지됩니다.',api_id:'28692'},
      {id:'pyt15',name:'YouTube 조회수 — 안정형 슬로우 (평생 보장)',pl:'youtube',rate:2.45,min:1000,max:50000,description:'일 4~5만 조회수를 안정적으로 지속 유입시키는 슬로우 페이스 프리미엄 서비스입니다. 빠른 스파이크보다 장기적·자연스러운 조회수 곡선을 원하는 브랜드 채널에 최적화되어 있으며, 유튜브 알고리즘이 "꾸준히 인기 있는 콘텐츠"로 판단해 장기 노출 효과가 이어집니다. 평생 보장 리필 포함.',api_id:'30743'},
      {id:'pyt16',name:'YouTube 조회수 — 저가 대량형',pl:'youtube',rate:1.036,min:10000,max:10000000,description:'대량 주문에 최적화된 저가형 유튜브 조회수 서비스입니다. 실제 유저 기반이지만 최소 10,000개부터 주문 가능한 도매형 옵션으로, 영상 초기 부스팅에 필요한 방대한 조회수를 가장 비용 효율적으로 확보할 수 있습니다. 신규 채널의 급성장이나 다수 영상 동시 관리에 적합합니다.',api_id:'28695'},
      {id:'pyt2',name:'YouTube 구독자 — 프리미엄 글로벌 (평생 보장)',pl:'youtube',rate:41.99,min:50,max:100000,description:'실제 활동 중인 전 세계 유저 기반 YouTube 구독자를 일 2,500명 속도로 자연스럽게 늘립니다. 구독자 수는 채널의 권위와 신뢰도를 결정하는 가장 중요한 지표로, 광고주와 스폰서십 협상 단가에 직접적인 영향을 미칩니다. 평생 보장 리필로 드롭 걱정 없이 장기적인 채널 성장을 유지할 수 있는 프리미엄 서비스입니다.',api_id:'27905'},
      {id:'pyt3',name:'YouTube 구독자 — 미국 타겟',pl:'youtube',rate:37.51,min:100,max:1000000,description:'미국 기반 실제 YouTube 구독자를 확보하는 서비스입니다. 미국 광고 RPM이 세계 최고 수준이므로 미국 구독자 비율이 높을수록 유튜브 수익창출 단가가 크게 오릅니다. 일 1만 5천~2만명 고속 처리되며 30일 드롭 보상이 제공되어 미국 시장을 타겟으로 하는 채널 운영자에게 가장 강력한 성장 엔진입니다.',api_id:'28717'},
      {id:'pyt4',name:'YouTube 좋아요 — 프리미엄 글로벌',pl:'youtube',rate:0.25,min:10,max:20000,description:'전 세계 실계정 기반으로 제공되는 고품질 YouTube 좋아요 서비스입니다. 좋아요 비율은 유튜브 알고리즘이 영상 품질을 판단하는 핵심 지표입니다. 이 비율이 높을수록 검색 결과 상위와 추천 피드 노출 확률이 높아져 유기적 조회수 성장으로 이어집니다.',api_id:'20329'},
      {id:'pyt5',name:'YouTube 좋아요 — 태국 타겟 (드롭 보상)',pl:'youtube',rate:0.5,min:10,max:50000,description:'태국 기반 고품질 YouTube 좋아요 서비스로, 태국은 동남아 핵심 이커머스 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요 비율은 유튜브 알고리즘이 영상 품질을 판단하는 핵심 지표입니다. 이 비율이 높을수록 검색 결과 상위와 추천 피드 노출 확률이 높아져 유기적 조회수 성장으로 이어집니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'19626'},
      {id:'pyt6',name:'YouTube 라이브 좋아요 — 프리미엄 글로벌 (드롭 보상)',pl:'youtube',rate:0.45,min:10,max:50000,description:'유튜브 라이브 스트리밍 중 실시간으로 좋아요 반응을 즉시 붙여드립니다. 라이브 방송 초반 좋아요가 많이 쌓이면 유튜브 알고리즘이 해당 스트림을 인기 라이브로 인식해 추천 섹션과 홈 피드에 우선 노출시킵니다. 실시간 시청자 유입 효과가 뛰어나며, 30일 드롭 보상으로 방송 종료 후에도 좋아요가 안정적으로 유지됩니다.',api_id:'19372'},
      {id:'pyt7',name:'YouTube 쇼츠 좋아요 — 프리미엄 글로벌 (드롭 보상)',pl:'youtube',rate:4.69,min:30,max:50000,description:'전 세계 실계정 기반으로 제공되는 고품질 YouTube 쇼츠 좋아요 서비스입니다. 쇼츠 영상의 좋아요를 빠르게 늘려 알고리즘 배포를 가속화합니다. 좋아요 비율이 높은 쇼츠는 더 넓은 피드에 배포되어 조회수와 팔로워 동반 성장으로 이어집니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'27925'},
      {id:'pyt8',name:'YouTube 쇼츠 조회수 — 프리미엄 글로벌 (드롭 보상)',pl:'youtube',rate:1.68,min:100,max:1000000,description:'전 세계 실계정 기반으로 제공되는 고품질 YouTube 쇼츠 조회수 서비스입니다. 유튜브에서 지금 가장 빠르게 성장하는 쇼츠 포맷의 조회수를 늘립니다. 초기 조회수가 빠르게 쌓이면 쇼츠 피드 알고리즘의 바이럴 루프에 진입하여 수백만 조회수까지 자연 성장이 가능합니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'27924'},
      {id:'pyt9',name:'YouTube 조회수 — 아랍 타겟',pl:'youtube',rate:4.69,min:500,max:100000,description:'아랍 기반 고품질 YouTube 조회수 서비스로, 중동 광고 RPM은 세계 최상위 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 영상 업로드 직후 조회수를 빠르게 채워 유튜브 알고리즘에 강한 신호를 보냅니다. 초기 조회수가 빠를수록 추천·홈피드 배포 확률이 높아지며 실제 사용자 패턴으로 처리되어 계정 안전성이 보장됩니다.',api_id:'2866'},
      {id:'pig11',name:'Instagram 노출 — 한국 타겟',pl:'instagram',rate:12.54,min:5,max:10000,description:'한국 기반 고품질 Instagram 노출 서비스로, 국내 타겟 마케팅의 핵심으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 게시물 총 노출 횟수를 늘려 캠페인 리포트의 설득력을 높입니다. 협찬 제안서 작성이나 광고 효율 보고에서 인상 수는 도달 범위를 증명하는 가장 직접적인 지표입니다.',api_id:'29158'},
      {id:'pig17',name:'Instagram 좋아요 — 한국 타겟',pl:'instagram',rate:6.45,min:10,max:20000,description:'한국 기반 고품질 Instagram 좋아요 서비스로, 국내 타겟 마케팅의 핵심으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요가 많은 게시물은 알고리즘이 인기 게시물로 분류하여 팔로워 외 사용자의 탐색 탭에도 대규모 노출됩니다. 유기적 도달 범위를 빠르게 확장하는 가장 효과적인 방법입니다.',api_id:'28306'},
      {id:'pig6',name:'Instagram 팔로워 — 한국 타겟',pl:'instagram',rate:40.32,min:10,max:20000,description:'한국 기반 고품질 Instagram 팔로워 서비스로, 국내 타겟 마케팅의 핵심으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 팔로워 수는 계정 신뢰도의 핵심 지표로, 팔로워가 많을수록 탐색 탭 노출이 증가하고 브랜드 협찬 제안 가능성이 크게 높아집니다. 자연스러운 성장 패턴으로 처리되며 드롭 시 보상받을 수 있어 장기적인 계정 자산으로 활용됩니다.',api_id:'28308'},
      {id:'pkr1',name:'Instagram 팔로워 — 한국 (30일 드롭보상) ⭐',pl:'instagram',rate:47.04,min:10,max:20000,description:'한국인 실계정 기반 Instagram 팔로워 프리미엄 서비스로, 30일간 드롭 발생 시 자동 보상이 제공됩니다. 국내 타겟 마케팅의 핵심 자산인 한국인 팔로워는 브랜드 협찬 단가와 국내 소비자 대상 마케팅 효율을 크게 높여주며, 30일 리필 보장으로 장기적인 계정 신뢰도를 안정적으로 유지할 수 있습니다.',api_id:'28309'},
      {id:'pkr2',name:'Instagram 팔로워 — 한국 (슬로우 속도)',pl:'instagram',rate:51.12,min:10,max:50000,description:'한국인 실계정 Instagram 팔로워를 일 1천명 슬로우 속도로 자연스럽게 증가시킵니다. 빠른 증가가 부담스러운 신규 계정이나 알고리즘 페널티를 피하고 싶은 계정에 최적화된 서비스입니다. 느린 속도로 쌓여 실제 유기적 성장처럼 보이며 장기 안정성이 가장 뛰어납니다.',api_id:'30227'},
      {id:'pkr3',name:'Instagram 좋아요 — 한국 (드롭보상)',pl:'instagram',rate:8.06,min:10,max:20000,description:'한국인 실계정 기반 Instagram 좋아요 서비스로, 30일간 드롭 보상이 제공됩니다. 국내 타겟 게시물의 탐색 탭 노출을 강화하며, 한국인 좋아요 비율이 높을수록 인스타그램이 국내 사용자에게 우선 노출시켜 실제 국내 고객 유입으로 이어집니다.',api_id:'28307'},
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
      {id:'pig16',name:'Instagram 좋아요 — 인도 타겟 (드롭 보상)',pl:'instagram',rate:0.21,min:10,max:1000000,description:'인도 기반 고품질 Instagram 좋아요 서비스로, 인도는 글로벌 최대 사용자 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요가 많은 게시물은 알고리즘이 인기 게시물로 분류하여 팔로워 외 사용자의 탐색 탭에도 대규모 노출됩니다. 유기적 도달 범위를 빠르게 확장하는 가장 효과적인 방법입니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29539'},
      {id:'pig18',name:'Instagram 좋아요 — 나이지리아 타겟 (드롭 보상)',pl:'instagram',rate:1.72,min:20,max:100000,description:'나이지리아 기반 고품질 Instagram 좋아요 서비스로, 나이지리아는 아프리카 최대 디지털 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요가 많은 게시물은 알고리즘이 인기 게시물로 분류하여 팔로워 외 사용자의 탐색 탭에도 대규모 노출됩니다. 유기적 도달 범위를 빠르게 확장하는 가장 효과적인 방법입니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29759'},
      {id:'pig19',name:'Instagram 좋아요 — 터키 타겟 (드롭 보상)',pl:'instagram',rate:0.7,min:20,max:1000,description:'터키 기반 고품질 Instagram 좋아요 서비스로, 터키 사용자는 참여율이 매우 높으며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요가 많은 게시물은 알고리즘이 인기 게시물로 분류하여 팔로워 외 사용자의 탐색 탭에도 대규모 노출됩니다. 유기적 도달 범위를 빠르게 확장하는 가장 효과적인 방법입니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'30040'},
      {id:'pig2',name:'Instagram 댓글 — 미국 타겟',pl:'instagram',rate:262.76,min:5,max:2500,description:'미국 기반 고품질 Instagram 댓글 서비스로, 미국 광고 RPM이 세계 최고 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 댓글이 많은 게시물은 알고리즘이 높은 참여도로 인식해 탐색 탭 노출을 늘립니다. 긍정적 댓글은 브랜드 이미지를 강화하고, 질문형 댓글은 추가 참여를 유발하는 연쇄 효과를 만듭니다.',api_id:'22623'},
      {id:'pig20',name:'Instagram 좋아요 — 미국 타겟',pl:'instagram',rate:18.77,min:50,max:9000,description:'미국 기반 고품질 Instagram 좋아요 서비스로, 미국 광고 RPM이 세계 최고 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 좋아요가 많은 게시물은 알고리즘이 인기 게시물로 분류하여 팔로워 외 사용자의 탐색 탭에도 대규모 노출됩니다. 유기적 도달 범위를 빠르게 확장하는 가장 효과적인 방법입니다.',api_id:'22626'},
      {id:'pig21',name:'Instagram 프로필 방문 — 프리미엄 글로벌',pl:'instagram',rate:0.1,min:100,max:5000000,description:'전 세계 실계정 기반으로 제공되는 고품질 Instagram 프로필 방문 서비스입니다. 프로필 방문 수를 늘려 계정 인지도를 높입니다. 방문자가 많은 계정은 인스타그램 알고리즘이 더 많은 사람에게 추천하며, 팔로워 전환율을 높이는 효과도 있어 신규 계정 초기 노출에 특히 효과적입니다.',api_id:'3359'},
      {id:'pig22',name:'Instagram 릴스 좋아요 — 인도 리얼',pl:'instagram',rate:0.252,min:100,max:500000,description:'인도 실제 유저 기반 Instagram 릴스 인터랙티브 좋아요입니다. 릴스는 인스타그램이 가장 공격적으로 밀고 있는 포맷으로, 좋아요가 많을수록 탐색 탭과 릴스 피드 상단 노출이 크게 증가합니다. 최대 50만개 대량 주문으로 릴스 바이럴 부스팅에 최적화된 서비스입니다.',api_id:'30671'},
      {id:'pig23',name:'Instagram 릴스 좋아요 — 인도 타겟',pl:'instagram',rate:1.61,min:10,max:30000,description:'인도 기반 고품질 Instagram 릴스 좋아요 서비스로, 인도는 글로벌 최대 사용자 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 릴스 좋아요를 빠르게 늘려 탐색 탭과 릴스 피드 상위 노출을 유도합니다. 좋아요가 많은 릴스는 알고리즘이 더 넓은 사용자층에게 배포하여 팔로워 급증 효과로 이어집니다.',api_id:'17529'},
      {id:'pig24',name:'Instagram 저장 — 프리미엄 글로벌',pl:'instagram',rate:1.84,min:100,max:10000,description:'전 세계 실계정 기반으로 제공되는 고품질 Instagram 저장 서비스입니다. 저장 수는 인스타그램 알고리즘에서 가장 높은 가중치를 받는 참여 지표입니다. 저장이 많은 게시물은 탐색 탭과 추천 피드에 장기간 지속 노출됩니다.',api_id:'2573'},
      {id:'pig25',name:'Instagram 공유 — 프리미엄 글로벌',pl:'instagram',rate:2.77,min:10,max:5000,description:'전 세계 실계정 기반으로 제공되는 고품질 Instagram 공유 서비스입니다. 공유·리포스트 수를 늘립니다. 공유가 많은 게시물은 알고리즘에서 외부 확산 신호로 평가되어 탐색 탭 노출이 강화되고 신규 팔로워 유입이 가속화됩니다.',api_id:'30758'},
      {id:'pig26',name:'Instagram 스토리 조회수 — 프리미엄 글로벌',pl:'instagram',rate:15.0,min:10,max:10000,description:'전 세계 실계정 기반으로 제공되는 고품질 Instagram 스토리 조회수 서비스입니다. 스토리 조회수는 계정 활성도와 팔로워 참여도를 알고리즘에 알리는 신호입니다. 조회수가 높은 스토리는 팔로워 피드 상단에 우선 표시되어 더 많은 노출을 확보합니다.',api_id:'14571'},
      {id:'pig27',name:'Instagram 조회수 — 프리미엄 글로벌',pl:'instagram',rate:3.52,min:10,max:100000,description:'전 세계 실계정 기반으로 제공되는 고품질 Instagram 조회수 서비스입니다. 영상 조회수가 빠르게 쌓이면 인스타그램 알고리즘의 바이럴 루프에 진입하여 탐색 탭과 팔로워 외 사용자에게도 대규모 노출됩니다. 신규 팔로워 유입의 가장 빠른 경로입니다.',api_id:'14576'},
      {id:'pig3',name:'Instagram 팔로워 — 아랍 타겟 (드롭 보상)',pl:'instagram',rate:34.58,min:20,max:50000,description:'아랍 기반 고품질 Instagram 팔로워 서비스로, 중동 광고 RPM은 세계 최상위 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 팔로워 수는 계정 신뢰도의 핵심 지표로, 팔로워가 많을수록 탐색 탭 노출이 증가하고 브랜드 협찬 제안 가능성이 크게 높아집니다. 자연스러운 성장 패턴으로 처리되며 드롭 시 보상받을 수 있어 장기적인 계정 자산으로 활용됩니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29762'},
      {id:'pig4',name:'Instagram 팔로워 — 브라질 타겟 (드롭 보상)',pl:'instagram',rate:8.26,min:10,max:5000000,description:'브라질 기반 고품질 Instagram 팔로워 서비스로, 브라질은 중남미 최대 콘텐츠 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 팔로워 수는 계정 신뢰도의 핵심 지표로, 팔로워가 많을수록 탐색 탭 노출이 증가하고 브랜드 협찬 제안 가능성이 크게 높아집니다. 자연스러운 성장 패턴으로 처리되며 드롭 시 보상받을 수 있어 장기적인 계정 자산으로 활용됩니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29691'},
      {id:'pig5',name:'Instagram 팔로워 — 프리미엄 글로벌 (드롭 보상)',pl:'instagram',rate:0.57,min:1,max:10000000,description:'전 세계 실계정 기반으로 제공되는 고품질 Instagram 팔로워 서비스입니다. 팔로워 수는 계정 신뢰도의 핵심 지표로, 팔로워가 많을수록 탐색 탭 노출이 증가하고 브랜드 협찬 제안 가능성이 크게 높아집니다. 자연스러운 성장 패턴으로 처리되며 드롭 시 보상받을 수 있어 장기적인 계정 자산으로 활용됩니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'30505'},
      {id:'pig7',name:'Instagram 팔로워 — 나이지리아 타겟 (드롭 보상)',pl:'instagram',rate:34.58,min:20,max:100000,description:'나이지리아 기반 고품질 Instagram 팔로워 서비스로, 나이지리아는 아프리카 최대 디지털 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 팔로워 수는 계정 신뢰도의 핵심 지표로, 팔로워가 많을수록 탐색 탭 노출이 증가하고 브랜드 협찬 제안 가능성이 크게 높아집니다. 자연스러운 성장 패턴으로 처리되며 드롭 시 보상받을 수 있어 장기적인 계정 자산으로 활용됩니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29756'},
      {id:'pig8',name:'Instagram 팔로워 — 터키 타겟 (드롭 보상)',pl:'instagram',rate:12.6,min:10,max:50000,description:'터키 기반 고품질 Instagram 팔로워 서비스로, 터키 사용자는 참여율이 매우 높으며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 팔로워 수는 계정 신뢰도의 핵심 지표로, 팔로워가 많을수록 탐색 탭 노출이 증가하고 브랜드 협찬 제안 가능성이 크게 높아집니다. 자연스러운 성장 패턴으로 처리되며 드롭 시 보상받을 수 있어 장기적인 계정 자산으로 활용됩니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'30054'},
      {id:'pig9',name:'Instagram 팔로워 — 미국 타겟',pl:'instagram',rate:48.91,min:50,max:6000,description:'미국 기반 고품질 Instagram 팔로워 서비스로, 미국 광고 RPM이 세계 최고 수준이며 해당 시장 타겟 마케팅에 최적화되어 있습니다. 팔로워 수는 계정 신뢰도의 핵심 지표로, 팔로워가 많을수록 탐색 탭 노출이 증가하고 브랜드 협찬 제안 가능성이 크게 높아집니다. 자연스러운 성장 패턴으로 처리되며 드롭 시 보상받을 수 있어 장기적인 계정 자산으로 활용됩니다.',api_id:'22628'},
      {id:'ptt1',name:'TikTok 댓글 — 프리미엄 글로벌',pl:'tiktok',rate:0.91,min:1,max:50000,description:'전 세계 실계정 기반으로 제공되는 고품질 TikTok 댓글 서비스입니다. 댓글이 많은 영상은 알고리즘이 높은 인게이지먼트로 인식해 포유 탭 노출을 늘립니다. 질문 형태의 댓글은 다른 시청자들의 댓글 참여를 유발하는 연쇄 효과가 있어 영상 활성도를 자연스럽게 높여줍니다.',api_id:'31288'},
      {id:'ptt10',name:'TikTok 공유 — 프리미엄 글로벌',pl:'tiktok',rate:1.13,min:1,max:5000,description:'전 세계 실계정 기반으로 제공되는 고품질 TikTok 공유 서비스입니다. 공유는 틱톡에서 가장 강력한 바이럴 신호입니다. 공유가 많은 영상은 외부 트래픽을 유입시키고 알고리즘이 바이럴 콘텐츠로 판단해 대규모 배포합니다.',api_id:'30998'},
      {id:'ptt11',name:'TikTok 스토리 조회수 — 프리미엄 글로벌',pl:'tiktok',rate:0.18,min:10,max:10000000,description:'전 세계 실계정 기반으로 제공되는 고품질 TikTok 스토리 조회수 서비스입니다. 틱톡 스토리 조회수를 늘려 계정 활성도를 높입니다. 활발한 스토리 활동은 알고리즘이 활성 크리에이터로 인식하게 만들어 콘텐츠 노출 범위를 확대합니다.',api_id:'25820'},
      {id:'ptt12',name:'TikTok 조회수 — 브라질 타겟 (드롭 보상)',pl:'tiktok',rate:0.08,min:1,max:1000000,description:'브라질 기반 고품질 TikTok 조회수 서비스로, 브라질은 중남미 최대 콘텐츠 시장으로 해당 시장 타겟 마케팅에 최적화되어 있습니다. 틱톡에서 바이럴을 만드는 가장 빠른 방법입니다. 초기 조회수가 빠르게 쌓이면 알고리즘이 영상을 더 넓은 포유 탭에 배포하며, 이 바이럴 루프에 진입하면 수백만 조회수까지 자연 성장이 가능합니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'31183'},
      {id:'ptt13',name:'TikTok 조회수 — 프리미엄 글로벌 (드롭 보상)',pl:'tiktok',rate:0.44,min:10,max:1000000,description:'전 세계 실계정 기반으로 제공되는 고품질 TikTok 조회수 서비스입니다. 틱톡에서 바이럴을 만드는 가장 빠른 방법입니다. 초기 조회수가 빠르게 쌓이면 알고리즘이 영상을 더 넓은 포유 탭에 배포하며, 이 바이럴 루프에 진입하면 수백만 조회수까지 자연 성장이 가능합니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'20976'},
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
      {id:'pth1',name:'Threads 팔로워 — 프리미엄 글로벌 (드롭 보상)',pl:'threads',rate:21.0,min:100,max:50000,description:'전 세계 실계정 기반으로 제공되는 고품질 Threads 팔로워 서비스입니다. 메타의 Threads 팔로워는 인스타그램과 연동되어 증가할수록 인스타그램 계정 노출에도 시너지 효과가 발생합니다. 빠르게 성장하는 플랫폼에서 초기 팔로워 확보는 장기적 경쟁 우위를 만듭니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29558'},
      {id:'pth2',name:'Threads 좋아요 — 프리미엄 글로벌 (드롭 보상)',pl:'threads',rate:12.6,min:50,max:50000,description:'전 세계 실계정 기반으로 제공되는 고품질 Threads 좋아요 서비스입니다. Threads 게시물 좋아요로 참여도를 높입니다. 좋아요가 많은 게시물은 Threads 피드 상위에 노출되어 추가 팔로워와 인게이지먼트를 유도하며, 인스타그램 연동 시너지도 발휘합니다. 드롭 발생 시 자동 보상되어 안정적인 장기 운영이 가능합니다.',api_id:'29560'},
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
      await query(`INSERT INTO services(id,name,pl,rate,min,max,description,api_id,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, pl=EXCLUDED.pl, rate=EXCLUDED.rate, min=EXCLUDED.min, max=EXCLUDED.max, api_id=EXCLUDED.api_id`,
        [s.id, s.name, s.pl, s.rate, s.min, s.max, s.description||'', s.api_id||null, 1]);
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
  try { await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS charge_bonus REAL DEFAULT 0`); } catch(e) {}
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
  
  console.log('✅ DB 초기화 완료');
}

// ── 미들웨어 ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// index.html은 제외하고 정적 파일만 서빙 (index.html은 동적 렌더링용)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

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
      // www 제거 후 재시도 (예: www.no9story.com → no9story.com)
      const bareHost = host.replace(/^www\./, '');
      if (bareHost !== host) {
        r = await query(`SELECT * FROM sites WHERE domain=$1 AND active=1`, [bareHost]);
        site = r.rows[0];
      }
    }
    if (!site) {
      // 매칭 실패 시 default 사이트 사용 (도메인 덮어쓰기 제거)
      r = await query(`SELECT * FROM sites WHERE id='default'`);
      site = r.rows[0];
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

// 🔗 URL 검증 (플랫폼별)
function validateUrl(url, platform) {
  if (!url || typeof url !== 'string') return { ok: false, error: 'URL을 입력해주세요' };
  try {
    const u = new URL(url);
    const domain = u.hostname.replace(/^www\./, '').toLowerCase();
    
    const validDomains = {
      youtube: ['youtube.com', 'youtu.be', 'm.youtube.com'],
      instagram: ['instagram.com', 'instagr.am'],
      tiktok: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
      twitter: ['twitter.com', 'x.com'],
      facebook: ['facebook.com', 'fb.com', 'fb.watch', 'm.facebook.com'],
      telegram: ['t.me', 'telegram.me'],
      threads: ['threads.com', 'threads.net'],
      spotify: ['spotify.com', 'open.spotify.com'],
      twitch: ['twitch.tv'],
    };
    
    const expectedDomains = validDomains[platform];
    if (!expectedDomains) return { ok: true }; // 기타/traffic은 검증 안 함
    
    const isValid = expectedDomains.some(d => domain === d || domain.endsWith('.' + d));
    if (!isValid) {
      return { ok: false, error: `잘못된 URL입니다. ${platform} 서비스는 ${expectedDomains[0]} 링크를 입력해주세요.` };
    }
    return { ok: true };
  } catch(e) {
    return { ok: false, error: '올바른 URL 형식이 아닙니다 (예: https://...)' };
  }
}

// 🤖 텔레그램 알림 발송 (통합 함수)
async function sendTelegramToSuper(message) {
  try {
    const token = await getGlobalSetting('tg_token');
    const chat = await getGlobalSetting('tg_chat');
    if (!token || !chat) return false;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' })
    });
    return true;
  } catch(e) { console.log('텔레그램 발송 실패:', e.message); return false; }
}

// 💵 Peakerr 잔액 체크 (주문 시마다)
async function checkPeakerrBalance() {
  try {
    const apiKey = await getGlobalSetting('peakerr_api_key');
    if (!apiKey) return null;
    const resp = await fetch('https://peakerr.com/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key: apiKey, action: 'balance' })
    });
    const data = await resp.json();
    const balance = parseFloat(data.balance || 0);
    
    // 잔액 $50 이하면 알림 (하루 최대 1번만)
    if (balance < 50) {
      const lastAlert = await getGlobalSetting('peakerr_low_balance_alert');
      const today = new Date().toDateString();
      if (lastAlert !== today) {
        await sendTelegramToSuper(`⚠️ <b>공급사 잔액 부족</b>\n\n현재 잔액: <b>$${balance.toFixed(2)}</b>\n\n공급사 사이트에서 충전해주세요.`);
        await setGlobalSetting('peakerr_low_balance_alert', today);
      }
    }
    return balance;
  } catch(e) { console.log('Peakerr 잔액 체크 실패:', e.message); return null; }
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
  if (!['admin','partner','superadmin'].includes(payload.role)) return res.status(403).json({ error: '관리자 권한 필요' });
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

// ═══════════════════════════════════════
// 🔄 Peakerr 자동 동기화 시스템
// ═══════════════════════════════════════

// Peakerr 주문 상태 조회
async function fetchPeakerrOrderStatus(apiKey, apiOrderId) {
  try {
    const resp = await fetch('https://peakerr.com/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key: apiKey, action: 'status', order: apiOrderId })
    });
    return await resp.json();
    // { charge, start_count, status: 'Completed'/'In progress'/'Partial'/'Canceled', remains, currency }
  } catch(e) { console.log('Peakerr 상태 조회 실패:', e.message); return null; }
}

// 💸 주문 자동 환불 처리 (Peakerr 기반)
async function autoRefundOrder(order, peakerrData) {
  try {
    // Peakerr 상태 확인
    const status = (peakerrData.status || '').toLowerCase();
    const remains = parseInt(peakerrData.remains || 0);
    const startsCount = parseInt(peakerrData.start_count || 0);
    
    let refundPercent = 0;
    let newStatus = order.status;
    
    if (status === 'completed') {
      newStatus = 'completed';
    } else if (status === 'canceled' || status === 'cancelled') {
      refundPercent = 100;
      newStatus = 'refunded';
    } else if (status === 'partial') {
      if (remains > 0 && order.qty > 0) {
        refundPercent = Math.round((remains / order.qty) * 100);
        newStatus = refundPercent >= 100 ? 'refunded' : 'partial_refunded';
      }
    } else if (status === 'in progress' || status === 'processing' || status === 'pending') {
      newStatus = 'processing';
    } else if (status === 'error' || status === 'failed') {
      refundPercent = 100;
      newStatus = 'refunded';
    }
    
    // 진행률 저장 (starts_count, remains)
    await query(`UPDATE orders SET status=$1, starts_count=$2, remains=$3 WHERE id=$4`,
      [newStatus, startsCount, remains, order.id]);
    
    // 🎁 완료 시 포인트 적립
    if (newStatus === 'completed' && order.status !== 'completed') {
      await earnPoints({ ...order, status: 'processing' }); // status를 completed 이전으로 전달
    }
    
    // 환불 처리
    if (refundPercent > 0 && order.status !== 'refunded' && order.status !== 'partial_refunded') {
      const refundAmount = Math.round(order.charge * refundPercent / 100);
      
      // 고객 잔액 복구
      const userR = await query(`SELECT * FROM users WHERE id=$1`, [order.uid]);
      const user = userR.rows[0];
      if (user) {
        const beforeBal = user.balance || 0;
        await query(`UPDATE users SET balance=balance+$1 WHERE id=$2`, [refundAmount, order.uid]);
        const afterR = await query(`SELECT * FROM users WHERE id=$1`, [order.uid]);
        
        await logBalance(
          order.site_id, order.uid, user.name, refundAmount,
          beforeBal, afterR.rows[0]?.balance || 0,
          `자동 환불 (주문 ${status}) - 주문 ${order.id}`,
          'system'
        );
      }
      
      // 지인 크레딧도 복구 (default 사이트 아니면)
      if (order.site_id !== 'default') {
        // 공급가 비율로 크레딧 복구 (원가 × 슈퍼마진)
        const siteR = await query(`SELECT * FROM sites WHERE id=$1`, [order.site_id]);
        const site = siteR.rows[0];
        if (site) {
          // 대략적인 원가 비율로 크레딧 복구 (서비스 rate 조회)
          const svcR = await query(`SELECT rate FROM services WHERE id=$1`, [order.sid]);
          if (svcR.rows[0]) {
            const superMgStr = await getGlobalSetting('super_margin');
            const superMg = (site.super_margin >= 0) ? site.super_margin : parseFloat(superMgStr || '50');
            const globalSiteMgStr = await getGlobalSetting('global_site_margin');
            const globalSiteMg = parseFloat(globalSiteMgStr || '50');
            // 지인이 지불한 크레딧 = GLOW 판매가 ($)
            const creditRefund = svcR.rows[0].rate / 1000 * order.qty * (1 + superMg/100) * (1 + globalSiteMg/100) * (refundPercent / 100);
            await query(`UPDATE sites SET credit=credit+$1 WHERE id=$2`, [creditRefund, order.site_id]);
          }
        }
      }
      
      await logActivity(
        order.site_id, 'system', '자동환불',
        `자동 환불 (${refundPercent}%)`, 'order', order.id,
        `주문 ${status} → ₩${refundAmount.toLocaleString()} 환불`
      );
    }
    
    return { status: newStatus, refundPercent };
  } catch(e) { console.log('자동 환불 실패:', e.message); return null; }
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

// 🔄 진행중인 모든 주문 상태 동기화
async function syncAllOrderStatuses() {
  try {
    const apiKey = await getGlobalSetting('peakerr_api_key');
    if (!apiKey) return;
    
    // 진행중 또는 pending 상태인 주문 조회 (Peakerr 주문 ID 있는 것만)
    const r = await query(`
      SELECT * FROM orders 
      WHERE api_order_id IS NOT NULL 
      AND api_order_id != ''
      AND status NOT IN ('completed', 'refunded', 'partial_refunded', 'failed')
      AND created > NOW() - INTERVAL '30 days'
      ORDER BY created DESC
      LIMIT 100
    `);
    
    if (r.rows.length === 0) return;
    console.log(`🔄 주문 상태 동기화 시작: ${r.rows.length}건`);
    
    let completed = 0, refunded = 0, errors = 0;
    for (const order of r.rows) {
      const peakerrData = await fetchPeakerrOrderStatus(apiKey, order.api_order_id);
      if (!peakerrData || peakerrData.error) { errors++; continue; }
      const result = await autoRefundOrder(order, peakerrData);
      if (result) {
        if (result.status === 'completed') completed++;
        if (result.refundPercent > 0) refunded++;
      }
      // Rate limit 회피를 위한 약간의 delay
      await new Promise(r => setTimeout(r, 100));
    }
    
    console.log(`✅ 동기화 완료: 완료 ${completed}건, 환불 ${refunded}건, 오류 ${errors}건`);
    
    // 슈퍼관리자에게 요약 알림 (환불 발생 시에만)
    if (refunded > 0) {
      await sendTelegramToSuper(`🔄 <b>자동 환불 처리</b>\n\n완료: ${completed}건\n환불: ${refunded}건\n오류: ${errors}건`);
    }
  } catch(e) { console.log('주문 동기화 실패:', e.message); }
}

// 🔄 Peakerr 서비스 자동 동기화 (삭제된/변경된 서비스 체크)
async function syncPeakerrServices() {
  try {
    const apiKey = await getGlobalSetting('peakerr_api_key');
    if (!apiKey) return;
    
    // Peakerr 전체 서비스 목록 가져오기
    const resp = await fetch('https://peakerr.com/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key: apiKey, action: 'services' })
    });
    const services = await resp.json();
    if (!Array.isArray(services)) return;
    
    const peakerrMap = new Map();
    services.forEach(s => peakerrMap.set(String(s.service), s));
    
    // GLOW DB의 모든 서비스 조회
    const glowR = await query(`SELECT id, name, api_id, rate, active FROM services WHERE api_id IS NOT NULL AND api_id != ''`);
    
    let disabled = 0, priceChanged = 0, checked = 0;
    const priceChangedList = [];
    
    for (const glowSvc of glowR.rows) {
      const peakerrSvc = peakerrMap.get(glowSvc.api_id);
      checked++;
      
      if (!peakerrSvc) {
        // Peakerr에서 삭제됨 → 비활성화
        if (glowSvc.active === 1) {
          await query(`UPDATE services SET active=0 WHERE id=$1`, [glowSvc.id]);
          disabled++;
          console.log(`  ⚠️ 비활성화: ${glowSvc.name}`);
        }
      } else {
        // 원가 변동 체크 (20% 이상 차이)
        const newRate = parseFloat(peakerrSvc.rate);
        const oldRate = parseFloat(glowSvc.rate);
        if (oldRate > 0 && Math.abs(newRate - oldRate) / oldRate > 0.2) {
          priceChangedList.push({
            name: glowSvc.name,
            old: oldRate,
            new: newRate,
            change: ((newRate - oldRate) / oldRate * 100).toFixed(1)
          });
          // 자동 업데이트 (안전하게: 5% 이상 변동 시)
          if (Math.abs(newRate - oldRate) / oldRate > 0.05) {
            await query(`UPDATE services SET rate=$1 WHERE id=$2`, [newRate, glowSvc.id]);
            priceChanged++;
          }
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
        WHERE status='pending' AND (api_order_id IS NULL OR api_order_id='')
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
      if (disabled > 0) msg += `⚠️ 비활성화: ${disabled}개 (공급사에서 삭제됨)\n`;
      if (stuckRefunded > 0) msg += `💸 미처리 주문 자동 환불: ${stuckRefunded}건\n`;
      if (priceChanged > 0) {
        msg += `💰 가격 업데이트: ${priceChanged}개\n`;
        priceChangedList.slice(0, 5).forEach(p => {
          msg += `  • ${p.name.substring(0, 30)}: $${p.old} → $${p.new} (${p.change}%)\n`;
        });
      }
      await sendTelegramToSuper(msg);
    }
  } catch(e) { console.log('서비스 동기화 실패:', e.message); }
}

// 🆕 새로운 고품질 서비스 추천 알림 (주간)
async function scanNewServices() {
  try {
    const apiKey = await getGlobalSetting('peakerr_api_key');
    if (!apiKey) return;
    
    const resp = await fetch('https://peakerr.com/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key: apiKey, action: 'services' })
    });
    const services = await resp.json();
    if (!Array.isArray(services)) return;
    
    // 현재 GLOW에 있는 api_id 목록
    const existingR = await query(`SELECT api_id FROM services WHERE api_id IS NOT NULL`);
    const existing = new Set(existingR.rows.map(r => String(r.api_id)));
    
    // 고품질 신규 서비스 필터
    const candidates = [];
    for (const s of services) {
      if (existing.has(String(s.service))) continue;
      const name = (s.name || '').toLowerCase();
      const cat = (s.category || '').toLowerCase();
      if (cat.includes('testing')) continue;
      if (name.includes('bot') || name.includes('fake')) continue;
      
      let score = 0;
      if (/\bhq\b|high quality/.test(name)) score += 100;
      if (/\breal\b/.test(name)) score += 80;
      if (name.includes('non drop') || name.includes('non-drop')) score += 60;
      if (name.includes('lifetime')) score += 50;
      if (s.refill) score += 30;
      if (name.includes('premium')) score += 20;
      if (name.includes('monetiz')) score += 80;
      
      if (score >= 150) {
        candidates.push({ ...s, qs: score });
      }
    }
    
    candidates.sort((a, b) => b.qs - a.qs);
    const top5 = candidates.slice(0, 5);
    
    if (top5.length > 0) {
      let msg = `🆕 <b>신규 고품질 서비스</b>\n\n`;
      top5.forEach((s, i) => {
        msg += `${i+1}. ${(s.name || '').substring(0, 50)}\n`;
        msg += `   💰 $${s.rate}/1K, Q${s.qs}\n\n`;
      });
      msg += `슈퍼관리자에서 추가할지 검토해주세요.`;
      await sendTelegramToSuper(msg);
    }
  } catch(e) { console.log('신규 서비스 스캔 실패:', e.message); }
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
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: msg, parse_mode: 'HTML' })
      });
    } catch(e) { console.log('TG 오류:', e.message); }
  }));
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

  res.json({
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
    chargeBonus: parseFloat(site.charge_bonus) || 0,
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
    theme: site.theme || 'glow',
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
    
    // 레퍼럴 코드 없으면 자동 생성
    if (!targetUser.referral_code) {
      const refCode = Math.random().toString(36).substring(2,8).toUpperCase();
      await query(`UPDATE users SET referral_code=$1 WHERE id=$2`, [refCode, targetUser.id]);
      targetUser.referral_code = refCode;
    }
    
    const token = createToken({ userId: targetUser.id, role: targetUser.role, siteId: req.siteId });
    res.json({ ok: true, token, user: {
      id: targetUser.id,
      name: targetUser.name,
      email: targetUser.email,
      role: targetUser.role,
      balance: targetUser.balance,
      points: targetUser.points || 0,
      referral_code: targetUser.referral_code
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
    if (referral_code) {
      const refUser = await query(`SELECT id FROM users WHERE site_id=$1 AND referral_code=$2`, [req.siteId, referral_code]);
      if (refUser.rows.length > 0) {
        referredBy = refUser.rows[0].id;
        signupBonus = 500; // 추천인 가입 시 ₩500 포인트 지급
        // 추천인에게도 포인트 지급
        await query(`UPDATE users SET points=COALESCE(points,0)+500, referral_bonus=COALESCE(referral_bonus,0)+500 WHERE id=$1`, [referredBy]);
      }
    }
    await query(`INSERT INTO users(id,site_id,name,email,pw,role,balance,referral_code,referred_by,points,phone) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, req.siteId, name, email, hash, 'user', 0, refCode, referredBy, signupBonus, phone]);
    const token = createToken({ userId: id, role: 'user', siteId: req.siteId });
    res.json({ ok: true, token, user: { id, name, email, role: 'user', balance: 0, points: signupBonus, referral_code: refCode }});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => { res.json({ ok: true }); });

// ═══════════════════════════════════════
// 🔐 비밀번호 재설정 (이메일 기반)
// ═══════════════════════════════════════

// Resend를 통한 이메일 발송
async function sendEmail(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.log('⚠️ RESEND_API_KEY 미설정 - 이메일 발송 스킵'); return false; }
  try {
    const from = process.env.EMAIL_FROM || 'noreply@glow-multi.onrender.com';
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html })
    });
    const data = await resp.json();
    if (!resp.ok) { console.log('❌ 이메일 발송 실패:', data); return false; }
    return true;
  } catch(e) { console.log('❌ 이메일 오류:', e.message); return false; }
}

// Step 1: 비밀번호 재설정 요청 (이메일 입력)
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.json({ error: '이메일을 입력하세요' });
    // 현재 사이트 기준 사용자 찾기
    const siteId = req.siteId || 'default';
    const userR = await query(`SELECT * FROM users WHERE site_id=$1 AND email=$2`, [siteId, email]);
    const user = userR.rows[0];
    
    // 보안: 사용자 존재 여부와 상관없이 동일한 메시지 반환 (이메일 존재 유출 방지)
    if (!user) {
      return res.json({ ok: true, message: '해당 이메일로 재설정 링크를 보냈습니다. 메일함을 확인해주세요.' });
    }
    
    // 토큰 생성 (30분 유효)
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 60 * 1000); // 30분
    await query(`INSERT INTO password_resets(token, user_id, site_id, email, expires) VALUES($1,$2,$3,$4,$5)`,
      [token, user.id, siteId, email, expires]);
    
    // 사이트 정보 가져오기
    const siteR = await query(`SELECT * FROM sites WHERE id=$1`, [siteId]);
    const site = siteR.rows[0];
    const siteName = site?.name || 'GLOW';
    const siteDomain = site?.domain || 'glow-multi.onrender.com';
    const resetUrl = `https://${siteDomain}/reset-password?token=${token}`;
    
    // HTML 이메일 템플릿
    const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>비밀번호 재설정</title></head>
    <body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;margin:0">
      <div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;padding:40px 30px;box-shadow:0 2px 10px rgba(0,0,0,0.08)">
        <h1 style="color:#7209B7;margin:0 0 24px 0;font-size:24px">🔐 ${siteName} 비밀번호 재설정</h1>
        <p style="color:#333;font-size:15px;line-height:1.7">안녕하세요 <strong>${user.name || '고객'}</strong>님,</p>
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
    
    const sent = await sendEmail(email, `[${siteName}] 비밀번호 재설정 안내`, html);
    if (!sent) {
      return res.json({ error: '이메일 발송에 실패했습니다. 사이트 관리자에게 문의해주세요.' });
    }
    res.json({ ok: true, message: '해당 이메일로 재설정 링크를 보냈습니다. 메일함을 확인해주세요.' });
  } catch(e) { console.log('forgot-password 오류:', e); res.status(500).json({ error: e.message }); }
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
    const r = await query(`SELECT id,name,email,role,balance,status,COALESCE(points,0) as points,referral_code,COALESCE(phone,'') as phone FROM users WHERE id=$1`, [req.session.userId]);
    const user = r.rows[0];
    if (!user) return res.json({ error: '사용자 없음' });
    // referral_code 없으면 자동 생성
    if (!user.referral_code) {
      const refCode = Math.random().toString(36).substring(2,8).toUpperCase();
      await query(`UPDATE users SET referral_code=$1 WHERE id=$2`, [refCode, req.session.userId]);
      user.referral_code = refCode;
    }
    res.json(user);
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

app.get('/api/services', async (req, res) => {
  try {
    const site = req.site;
    const siteMg = site ? (site.margin != null ? site.margin : 0) : 0;
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
      // site_services 설정이 없으면 전체 보여줌 (초기 설정 전)
      if (serviceRows.length === 0) {
        const allR = await query(`SELECT * FROM services WHERE active=1 ORDER BY id`);
        serviceRows = allR.rows;
      }
    } else {
      const allR = await query(`SELECT * FROM services WHERE active=1 ORDER BY id`);
      serviceRows = allR.rows;
    }
    const isPartner = req.session && req.session.role === 'partner';
    const isDefaultSite = !site || site.id === 'default';
    
    // 🎯 플랫폼 우선순위 정렬 (한국 사용자 선호도 기반)
    // YouTube, Instagram, TikTok 먼저 → Twitter, Threads → 기타
    const platformOrder = {
      youtube: 1, instagram: 2, tiktok: 3,
      threads: 4, twitter: 5, spotify: 6,
      twitch: 7, facebook: 8, telegram: 9,
      traffic: 10, travel: 11, other: 99,
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
        // 지인/파트너: GLOW 판매가를 원가로 보여줌 (실제 Peakerr 원가 숨김)
        return { ...s, sell: sellPrice, baseCost, isPartnerView: true };
      }
      // GLOW 본사(슈퍼관리자): 모든 정보 공개
      return { ...s, sell: sellPrice, originalCost, supplyCost, myProfit: supplyCost - originalCost };
    }));
  } catch(e) { res.status(500).json({ error: e.message }); }
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
    const svcR = await query(`SELECT * FROM services WHERE id=$1 AND active=1`, [sid]);
    const svc = svcR.rows[0];
    if (!svc) return res.json({ error: '서비스를 찾을 수 없습니다' });
    
    // 🔗 URL 검증 (플랫폼별 도메인 체크)
    const urlCheck = validateUrl(link, svc.pl);
    if (!urlCheck.ok) return res.json({ error: urlCheck.error });
    
    const qtyNum = parseInt(qty);
    if (isNaN(qtyNum) || qtyNum < svc.min || qtyNum > svc.max)
      return res.json({ error: `수량은 ${svc.min.toLocaleString()} ~ ${svc.max.toLocaleString()} 사이여야 합니다` });
    
    // 🚫 중복 주문 차단: 같은 회원이 같은 URL로 30분 내 중복 주문 방지
    const dupCheck = await query(
      `SELECT id FROM orders WHERE uid=$1 AND sid=$2 AND link=$3 AND created > NOW() - INTERVAL '30 minutes' LIMIT 1`,
      [req.session.userId, sid, link]
    );
    if (dupCheck.rows.length > 0) {
      return res.json({ error: '동일 주문이 30분 내 이미 있습니다. 중복 주문을 방지합니다.' });
    }
    
    const site = req.site;
    const siteMg = site ? (site.margin != null ? site.margin : 0) : 0;
    const globalExrate2 = await getGlobalSetting('global_exrate');
    const ex = (site && site.exrate > 0) ? site.exrate : parseFloat(globalExrate2 || '1500');
    let superMg2;
    if (site && site.super_margin >= 0) {
      superMg2 = site.super_margin;
    } else {
      const superMgStr2 = await getGlobalSetting('super_margin');
      superMg2 = parseFloat(superMgStr2 || '50');
    }
    const isDefaultSite2 = !site || site.id === 'default';
    const globalSiteMgStr2 = await getGlobalSetting('global_site_margin');
    const globalSiteMg2 = parseFloat(globalSiteMgStr2 || '50');
    
    // 🔧 결제 금액 및 크레딧 차감 계산
    // - GLOW(default): 고객 결제 = 원가 × 슈퍼 × 사이트마진
    // - 지인 사이트: 고객 결제 = GLOW 판매가 × (1 + 지인마진)
    //                크레딧 차감 = GLOW 판매가 (지인 입장의 "원가")
    // ⚠️ charge는 서비스목록 sell과 동일하게 "1개당 가격 반올림 × 수량"으로 계산
    //    → 화면 표시 총액과 실제 차감액이 100% 일치 (고객 혼란 방지)
    let charge, apiCost;
    if (isDefaultSite2) {
      // 1000개당 판매가(₩) → 1개당 반올림(최소 1원) → × 수량
      const sellPer1000 = svc.rate * ex * (1 + superMg2 / 100) * (1 + siteMg / 100);
      const sellPerUnit = Math.max(Math.round(sellPer1000 / 1000), 1);
      charge = sellPerUnit * qtyNum;
      apiCost = svc.rate / 1000 * qtyNum * (1 + superMg2 / 100); // 공급가($) - default는 크레딧 안 씀
    } else {
      // GLOW 판매가($/1000) → 지인 고객가(₩/1000) → 1개당 반올림 → × 수량
      const glowPricePer1000 = svc.rate * (1 + superMg2 / 100) * (1 + globalSiteMg2 / 100); // $/1000
      const sellPer1000 = glowPricePer1000 * ex * (1 + siteMg / 100); // ₩/1000
      const sellPerUnit = Math.max(Math.round(sellPer1000 / 1000), 1);
      charge = sellPerUnit * qtyNum;
      // 지인 크레딧 차감 = GLOW 판매가 ($)
      apiCost = glowPricePer1000 / 1000 * qtyNum;
    }
    const userR = await query(`SELECT * FROM users WHERE id=$1`, [req.session.userId]);
    const user = userR.rows[0];
    if ((user.balance || 0) < charge)
      return res.json({ error: `잔액 부족. 현재 ₩${Math.round(user.balance || 0).toLocaleString()}` });
    if (site && site.credit < apiCost && site.id !== 'default')
      return res.json({ error: '사이트 API 크레딧이 부족합니다.' });
    await query(`UPDATE users SET balance=balance-$1 WHERE id=$2`, [charge, user.id]);
    if (site && site.id !== 'default')
      await query(`UPDATE sites SET credit=GREATEST(0,credit-$1) WHERE id=$2`, [apiCost, site.id]);
    let apiOrderId = null;
    let apiError = null;
    const apiKey = await getGlobalSetting('peakerr_api_key');
    if (apiKey && svc.api_id) {
      try {
        const resp = await fetch('https://peakerr.com/api/v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ key: apiKey, action: 'add', service: svc.api_id, link, quantity: String(qty) })
        });
        const data = await resp.json();
        if (data.order) {
          apiOrderId = String(data.order);
        } else {
          // 공급사가 주문을 거부함 (서비스 삭제/최소수량 미달/잔액부족 등)
          apiError = data.error || '주문 접수 실패';
        }
      } catch(e) {
        apiError = '서버 연결 실패: ' + e.message;
        console.log('API 오류:', e.message);
      }
    } else if (!svc.api_id) {
      apiError = '연동되지 않은 서비스입니다';
    }

    // ⚠️ 공급사 전송 실패 → 즉시 자동 환불 + 주문 실패 처리 ("돈 냈는데 작업 안 됨" 방지)
    if (apiError) {
      // 고객 잔액 복구
      await query(`UPDATE users SET balance=balance+$1 WHERE id=$2`, [charge, user.id]);
      // 지인 크레딧 복구
      if (site && site.id !== 'default')
        await query(`UPDATE sites SET credit=credit+$1 WHERE id=$2`, [apiCost, site.id]);
      // 실패 주문 기록 (추적용)
      const failId = 'O' + Date.now();
      try {
        await query(`INSERT INTO orders(id,site_id,uid,uname,sid,sname,pl,api_order_id,link,qty,charge,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [failId, req.siteId, user.id, user.name, svc.id, svc.name, svc.pl, null, link, qtyNum, charge, 'failed']);
        await logBalance(req.siteId, user.id, user.name, charge,
          (user.balance || 0) - charge, user.balance || 0,
          `주문 실패 자동 환불 - ${svc.name}`, 'system');
      } catch(e) {}
      // 서비스가 공급사에 없으면 즉시 비활성화 (다른 고객 추가 피해 방지)
      if (/not\s*found|invalid\s*service|존재|없/i.test(apiError) || apiError === '주문 접수 실패') {
        await query(`UPDATE services SET active=0 WHERE id=$1`, [svc.id]).catch(()=>{});
      }
      return res.json({ error: `주문에 실패하여 자동 환불되었습니다. (사유: ${apiError})\n다른 서비스를 이용해주세요.` });
    }

    const orderId = 'O' + Date.now();
    // 💰 cost = 지인(파트너) 입장의 원가 = 슈퍼시아에게 크레딧으로 지불한 금액(원화 환산)
    //    default 사이트는 크레딧을 안 쓰므로 0
    const orderCost = (site && site.id !== 'default') ? (apiCost * ex) : 0;
    await query(`INSERT INTO orders(id,site_id,uid,uname,sid,sname,pl,api_order_id,link,qty,charge,status,cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [orderId, req.siteId, user.id, user.name, svc.id, svc.name, svc.pl, apiOrderId, link, qtyNum, charge, 'processing', orderCost]);
    const updR = await query(`SELECT * FROM users WHERE id=$1`, [user.id]);
    const custBal = Math.round(updR.rows[0]?.balance || 0);
    tgAlert(`📦 <b>새 주문</b> [${site?.name || 'GLOW'}]\n👤 ${user.name}\n✦ ${svc.name}\n🔢 ${qtyNum.toLocaleString()}개\n💰 ₩${Math.round(charge).toLocaleString()}\n💳 주문 후 잔액: ₩${custBal.toLocaleString()}\n🔗 ${link}`, site);
    
    // 💵 Peakerr 잔액 체크 (비동기, 주문 처리와 별도로)
    checkPeakerrBalance().catch(e => console.log('잔액 체크 실패:', e.message));
    
    res.json({ ok: true, orderId, apiOrderId, balance: updR.rows[0].balance });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders/my', requireAuth, async (req, res) => {
  try {
    const r = await query(`SELECT * FROM orders WHERE uid=$1 ORDER BY created DESC`, [req.session.userId]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 🔄 고객이 주문 상태 실시간 새로고침 (Peakerr에서 직접 조회)
app.post('/api/orders/refresh/:orderId', requireAuth, async (req, res) => {
  try {
    const orderR = await query(`SELECT * FROM orders WHERE id=$1 AND uid=$2`, [req.params.orderId, req.session.userId]);
    const order = orderR.rows[0];
    if (!order) return res.json({ error: '주문을 찾을 수 없습니다' });
    if (!order.api_order_id) return res.json({ error: 'API 주문 ID가 없습니다' });
    
    const apiKey = await getGlobalSetting('peakerr_api_key');
    if (!apiKey) return res.json({ error: 'API 키 미설정' });
    
    const peakerrData = await fetchPeakerrOrderStatus(apiKey, order.api_order_id);
    if (!peakerrData || peakerrData.error) return res.json({ error: '상태 조회 실패' });
    
    const result = await autoRefundOrder(order, peakerrData);
    const updR = await query(`SELECT * FROM orders WHERE id=$1`, [order.id]);
    res.json({ ok: true, order: updR.rows[0], peakerrStatus: peakerrData.status });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 🚫 고객 주문 취소 요청 (Peakerr가 아직 처리 시작 안 했으면 취소 가능)
app.post('/api/orders/cancel/:orderId', requireAuth, async (req, res) => {
  try {
    const orderR = await query(`SELECT * FROM orders WHERE id=$1 AND uid=$2`, [req.params.orderId, req.session.userId]);
    const order = orderR.rows[0];
    if (!order) return res.json({ error: '주문을 찾을 수 없습니다' });
    if (['completed', 'refunded', 'partial_refunded'].includes(order.status)) {
      return res.json({ error: '이미 완료되거나 환불된 주문입니다' });
    }
    if (!order.api_order_id) {
      // Peakerr 주문 ID 없으면 바로 취소 + 환불
      const userR = await query(`SELECT * FROM users WHERE id=$1`, [order.uid]);
      const user = userR.rows[0];
      if (user) {
        const beforeBal = user.balance || 0;
        await query(`UPDATE users SET balance=balance+$1 WHERE id=$2`, [order.charge, order.uid]);
        await logBalance(order.site_id, order.uid, user.name, order.charge, beforeBal, beforeBal + order.charge, `주문 취소 (API 미전송) - ${order.id}`, 'system');
      }
      await query(`UPDATE orders SET status='refunded' WHERE id=$1`, [order.id]);
      return res.json({ ok: true, message: '주문이 취소되고 전액 환불되었습니다' });
    }
    
    // Peakerr에 취소 요청
    const apiKey = await getGlobalSetting('peakerr_api_key');
    if (!apiKey) return res.json({ error: 'API 키 미설정' });
    
    try {
      const resp = await fetch('https://peakerr.com/api/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ key: apiKey, action: 'cancel', orders: order.api_order_id })
      });
      const data = await resp.json();
      
      // Peakerr 상태 즉시 조회해서 환불 처리
      const statusData = await fetchPeakerrOrderStatus(apiKey, order.api_order_id);
      if (statusData) {
        const result = await autoRefundOrder(order, statusData);
        if (result && result.refundPercent > 0) {
          return res.json({ ok: true, message: `취소 완료. ${result.refundPercent}% 환불되었습니다.` });
        }
      }
      res.json({ ok: true, message: '취소 요청을 전송했습니다. 잠시 후 상태가 업데이트됩니다.' });
    } catch(e) {
      res.json({ error: '취소 요청 실패: ' + e.message });
    }
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
    // 1포인트 = 1원
    await query(`UPDATE users SET balance=balance+$1, points=0 WHERE id=$2`, [points, user.id]);
    await logBalance(user.site_id, user.id, user.name, points,
      user.balance, user.balance + points, `포인트 전환 (${points}P → ₩${points.toLocaleString()})`, 'system');
    res.json({ ok: true, converted: points });
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
      else { admRev += rev; admCost += cst; }  // admin/partner/superadmin = 본인 주문
    });
    const credit = isSuper ? null : (req.site?.credit || 0);
    const globalEx = parseFloat((await getGlobalSetting('global_exrate')) || '1500');
    const siteEx = (req.site && req.site.exrate > 0) ? req.site.exrate : globalEx;

    // 슈퍼관리자 → 전부 합산 / 파트너 → 고객 주문만 매출, 관리자 주문은 별도
    const totalRev = custRev + admRev;
    const totalCost = custCost + admCost;
    res.json({
      users: parseInt(users.rows[0].c),
      orders: parseInt(orders.rows[0].c),
      // 슈퍼관리자: 전체 합산 / 파트너: 고객 주문만
      revenue: isSuper ? totalRev : custRev,
      cost: isSuper ? totalCost : custCost,
      profit: isSuper ? (totalRev - totalCost) : (custRev - custCost),
      // 파트너용 — 관리자 본인 주문 분 (자기가 작업한 것)
      adminRevenue: admRev,
      adminCost: admCost,
      pendingCharges: parseInt(pending.rows[0].c),
      credit,
      exrate: siteEx,
      isSuper
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
    const orderR = await query(`SELECT * FROM orders WHERE id=$1`, [id]);
    const order = orderR.rows[0];
    if (!order) return res.json({ error: '주문을 찾을 수 없습니다' });

    // 사이트 권한 체크
    if (req.session.role !== 'superadmin' && order.site_id !== req.siteId) {
      return res.json({ error: '다른 사이트 주문은 변경할 수 없습니다' });
    }

    // ⚠️ '취소'로 변경 시 자동 환불 — 이미 환불/취소된 주문이 아닐 때만
    const alreadyDone = ['refunded', 'partial_refunded', 'cancelled', 'canceled'].includes(order.status);
    if ((status === 'cancelled' || status === 'canceled') && !alreadyDone) {
      // 고객 잔액 복구
      const userR = await query(`SELECT * FROM users WHERE id=$1`, [order.uid]);
      const user = userR.rows[0];
      if (user) {
        const beforeBal = user.balance || 0;
        await query(`UPDATE users SET balance=balance+$1 WHERE id=$2`, [order.charge, order.uid]);
        await logBalance(order.site_id, order.uid, user.name, order.charge,
          beforeBal, beforeBal + order.charge, `주문 취소 자동 환불 - ${order.sname}`, req.session.userId);
      }
      // 지인 사이트면 크레딧도 복구
      if (order.site_id && order.site_id !== 'default') {
        const svcR = await query(`SELECT rate FROM services WHERE id=$1`, [order.sid]);
        if (svcR.rows[0]) {
          const superMg = parseFloat((await getGlobalSetting('super_margin')) || '50');
          const globalSiteMg = parseFloat((await getGlobalSetting('global_site_margin')) || '50');
          const creditRefund = svcR.rows[0].rate / 1000 * order.qty * (1 + superMg/100) * (1 + globalSiteMg/100);
          await query(`UPDATE sites SET credit=credit+$1 WHERE id=$2`, [creditRefund, order.site_id]);
        }
      }
      await query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [id]);
      await logActivity(req.siteId, req.session.userId, '', '주문 취소+환불', 'order', id,
        `₩${Math.round(order.charge).toLocaleString()} 환불`);
      return res.json({ ok: true, refunded: true, refundAmount: Math.round(order.charge) });
    }

    // 그 외 상태 변경은 단순 변경
    await query(`UPDATE orders SET status=$1 WHERE id=$2`, [status, id]);
    await logActivity(req.siteId, req.session.userId, '', '주문 상태 변경', 'order', id, `상태: ${status}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 💸 주문 환불 (고객 잔액 복구 + 주문 상태 변경)
app.post('/api/admin/orders/refund', requireAdmin, async (req, res) => {
  try {
    const { id, refundPercent } = req.body;
    const pct = Math.min(Math.max(parseFloat(refundPercent) || 100, 0), 100);
    
    const orderR = await query(`SELECT * FROM orders WHERE id=$1`, [id]);
    const order = orderR.rows[0];
    if (!order) return res.json({ error: '주문을 찾을 수 없습니다' });
    if (order.status === 'refunded') return res.json({ error: '이미 환불된 주문입니다' });
    
    // 사이트 권한 체크
    if (req.session.role !== 'superadmin' && order.site_id !== req.siteId) {
      return res.json({ error: '다른 사이트 주문은 환불할 수 없습니다' });
    }
    
    // 환불 금액 계산
    const refundAmount = Math.round(order.charge * pct / 100);
    
    // 잔액 복구
    const userR = await query(`SELECT * FROM users WHERE id=$1`, [order.uid]);
    const user = userR.rows[0];
    if (user) {
      const beforeBal = user.balance || 0;
      await query(`UPDATE users SET balance=balance+$1 WHERE id=$2`, [refundAmount, order.uid]);
      const afterR = await query(`SELECT * FROM users WHERE id=$1`, [order.uid]);
      const afterBal = afterR.rows[0].balance || 0;
      
      await logBalance(
        order.site_id, order.uid, user.name, refundAmount,
        beforeBal, afterBal,
        `주문 환불 (${pct}%) - 주문 ${id}`,
        req.session.userId
      );
    }
    
    // 주문 상태 변경
    const newStatus = pct >= 100 ? 'refunded' : 'partial_refunded';
    await query(`UPDATE orders SET status=$1 WHERE id=$2`, [newStatus, id]);
    
    await logActivity(
      req.siteId, req.session.userId, '',
      '주문 환불', 'order', id,
      `${pct}% 환불 (₩${refundAmount.toLocaleString()})`
    );
    
    res.json({ ok: true, refundAmount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 주문 내역 삭제 (관리자 전용 · 끝난 주문만 삭제 가능 · 기록 정리용)
// ⚠️ 처리중(processing)·대기(pending) 주문은 추적이 끊기므로 삭제 불가
//    삭제는 '기록 정리'이며 이미 처리된 환불·정산에는 영향 없음
app.post('/api/admin/orders/delete', requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
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
      ? await query(`SELECT * FROM users WHERE site_id=$1 AND role!='superadmin' ORDER BY joined DESC`, [siteId])
      : await query(`SELECT * FROM users WHERE role!='superadmin' ORDER BY joined DESC`);
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
    // 활동 로그
    await logActivity(req.siteId, req.session.userId, '', '비밀번호 리셋', 'user', uid, '관리자가 비밀번호 변경');
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
    const userR = await query(`SELECT id,name,email,phone,role,balance,status,joined FROM users WHERE id=$1`, [req.params.uid]);
    if (!userR.rows[0]) return res.json({ error: '회원을 찾을 수 없습니다' });
    const orders = await query(`SELECT * FROM orders WHERE uid=$1 ORDER BY created DESC`, [req.params.uid]);
    const charges = await query(`SELECT * FROM charges WHERE uid=$1 ORDER BY created DESC`, [req.params.uid]);
    // 💰 잔액 변동 로그 포함
    const balanceLogs = await query(`SELECT * FROM balance_logs WHERE user_id=$1 ORDER BY created DESC LIMIT 50`, [req.params.uid]);
    res.json({ user: userR.rows[0], orders: orders.rows, charges: charges.rows, balanceLogs: balanceLogs.rows });
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
      // 잔액 변동 로그
      const beforeR = await query(`SELECT * FROM users WHERE id=$1`, [charge.uid]);
      const beforeBal = beforeR.rows[0]?.balance || 0;
      const chargerRole = beforeR.rows[0]?.role || 'user';
      // 💰 충전 보너스 — 사이트 설정 보너스율, 일반 고객(user)에게만 지급
      let bonus = 0;
      if (chargerRole === 'user') {
        const bSiteR = await query(`SELECT charge_bonus FROM sites WHERE id=$1`, [charge.site_id]);
        const bonusRate = parseFloat(bSiteR.rows[0]?.charge_bonus) || 0;
        if (bonusRate > 0) bonus = Math.round(charge.amount * bonusRate / 100);
      }
      const totalAdd = charge.amount + bonus;
      await query(`UPDATE users SET balance=balance+$1 WHERE id=$2`, [totalAdd, charge.uid]);
      const afterR = await query(`SELECT * FROM users WHERE id=$1`, [charge.uid]);
      const afterBal = afterR.rows[0]?.balance || 0;

      const bonusNote = bonus > 0 ? ` +보너스 ₩${bonus.toLocaleString()}` : '';
      await logBalance(
        charge.site_id, charge.uid, charge.uname, totalAdd,
        beforeBal, afterBal,
        `충전 승인 (${charge.memo || '메모 없음'})${bonusNote}`,
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
    
    // 전체 서비스 + 이 사이트의 활성화 여부
    const r = await query(`
      SELECT s.id, s.name, s.pl, s.rate, s.min, s.max, s.active as global_active,
        COALESCE(ss.active, 1) as site_active
      FROM services s
      LEFT JOIN site_services ss ON s.id = ss.service_id AND ss.site_id = $1
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
    res.json(hiddenServices);
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
      WHERE site_id=$1 AND service_id NOT IN (SELECT id FROM services)
    `, [siteId]);
    // 전체 서비스에 대해 site_services 레코드 생성/업데이트
    const allSvcs = await query(`SELECT id FROM services WHERE active=1`);
    const val = active ? 1 : 0;
    for (const s of allSvcs.rows) {
      await query(`
        INSERT INTO site_services(site_id, service_id, active)
        VALUES($1, $2, $3)
        ON CONFLICT(site_id, service_id) DO UPDATE SET active=$3
      `, [siteId, s.id, val]);
    }
    res.json({ ok: true, count: allSvcs.rows.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 슈퍼관리자 - 서비스 자동 정리 (카테고리별 베스트만 남기기)
app.post('/api/super/services/auto-clean', requireSuperAdmin, async (req, res) => {
  try {
    // 1. 전체 비활성화
    await query(`UPDATE services SET active=0`);
    // 2. 카테고리별 베스트 선별 기준:
    //    - HQ, Real, Instant, 🔥 키워드 우선
    //    - 가격 적정 (rate > 0.01)
    //    - 카테고리별 최대 25개
    const categories = ['instagram','tiktok','youtube','facebook','telegram','twitter','threads','spotify','twitch','traffic','travel','other'];
    let totalActivated = 0;
    for (const pl of categories) {
      // 좋은 키워드 포함된 것 우선
      const good = await query(`
        SELECT id FROM services
        WHERE pl=$1 AND rate > 0.01
        AND (
          name ILIKE '%HQ%' OR name ILIKE '%Real%' OR name ILIKE '%Instant%'
          OR name ILIKE '%🔥%' OR name ILIKE '%Refill%' OR name ILIKE '%Non Drop%'
          OR name ILIKE '%High Quality%' OR name ILIKE '%Organic%'
        )
        ORDER BY rate ASC
        LIMIT 15
      `, [pl]);
      // 나머지도 저렴한 순으로 채우기
      const goodIds = good.rows.map(r => r.id);
      const rest = await query(`
        SELECT id FROM services
        WHERE pl=$1 AND rate > 0.01
        AND id != ALL($2)
        ORDER BY rate ASC
        LIMIT $3
      `, [pl, goodIds.length ? goodIds : [''], 25 - goodIds.length]);
      const allIds = [...goodIds, ...rest.rows.map(r => r.id)];
      if (allIds.length > 0) {
        await query(`UPDATE services SET active=1 WHERE id = ANY($1)`, [allIds]);
        totalActivated += allIds.length;
      }
    }
    res.json({ ok: true, activated: totalActivated });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const site = req.site;
    const isSuperAdmin = req.session.role === 'superadmin';
    const apikey = await getGlobalSetting('peakerr_api_key');
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
      apikey: isSuperAdmin ? (apikey ? '••••(설정됨)' : '') : '(슈퍼관리자 전용)',
      tg_token: isSuperAdmin ? (global_tg_token ? '••••(설정됨)' : '') : (site?.tg_token ? '••••(설정됨)' : ''),
      tg_chat: isSuperAdmin ? global_tg_chat : (site?.tg_chat || ''),
      site_tg_token: site?.tg_token || '',
      site_tg_chat: site?.tg_chat || '',
      super_margin: isSuperAdmin ? (super_margin || '50') : undefined,
      global_exrate: isSuperAdmin ? (global_exrate || '1500') : undefined,
      isSuperAdmin,
      supplyExamples  // 관리자용 공급가 샘플
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/settings/save', requireAdmin, async (req, res) => {
  try {
    const { key, value } = req.body;
    const isSuperAdmin = req.session.role === 'superadmin';
    const superOnly = ['peakerr_api_key', 'tg_token', 'tg_chat'];
    if (superOnly.includes(key)) {
      if (isSuperAdmin) {
        await setGlobalSetting(key, value);
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
      return res.json({ error: '슈퍼관리자 전용 설정입니다' });
    }
    const siteFields = ['name','kakao','bank','margin','exrate','super_margin','primary_color','accent_color','logo','slogan','slogan_sub','description','stat1_num','stat1_label','stat2_num','stat2_label','stat3_num','stat3_label','stat4_num','stat4_label','notice','footer_text','login_welcome','login_sub','register_welcome','register_sub','kakao_btn_text','charge_guide','order_guide','hero_badge','banner_text','banner_image','banner_link','charge_bonus'];
    if (siteFields.includes(key)) {
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
        const ex = parseFloat(value);
        if (isNaN(ex) || ex < 500 || ex > 3000) return res.json({ error: '환율은 500~3000 범위여야 합니다' });
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
      await query(`INSERT INTO services(id,name,pl,rate,min,max,description,api_id,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`,
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
        // cr.amount는 원화(₩) → DB credit은 USD이므로 환율로 나눔
        const crSiteR = await query(`SELECT exrate FROM sites WHERE id=$1`, [cr.site_id]);
        const crGlobalEx = parseFloat((await getGlobalSetting('global_exrate')) || '1500');
        const crEx = (crSiteR.rows[0] && crSiteR.rows[0].exrate > 0) ? crSiteR.rows[0].exrate : crGlobalEx;
        const crUSD = parseFloat(cr.amount) / crEx;
        await query(`UPDATE sites SET credit=credit+$1 WHERE id=$2`, [crUSD, cr.site_id]);
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
      // 잔액 변동 로그 포함 (process 라우트와 동일하게 정합성 유지)
      const beforeR = await query(`SELECT balance, role FROM users WHERE id=$1`, [charge.uid]);
      const beforeBal = beforeR.rows[0]?.balance || 0;
      const chargerRole = beforeR.rows[0]?.role || 'user';
      // 💰 충전 보너스 — 일반 고객(user)에게만 지급
      let bonus = 0;
      if (chargerRole === 'user') {
        const bSiteR = await query(`SELECT charge_bonus FROM sites WHERE id=$1`, [charge.site_id]);
        const bonusRate = parseFloat(bSiteR.rows[0]?.charge_bonus) || 0;
        if (bonusRate > 0) bonus = Math.round(charge.amount * bonusRate / 100);
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

// 🔄 슈퍼관리자: 수동 서비스 동기화
app.post('/api/super/sync-services', requireSuperAdmin, async (req, res) => {
  try {
    syncPeakerrServices().catch(e => console.log(e));
    res.json({ ok: true, message: '서비스 동기화를 시작했습니다. 결과는 텔레그램으로 알려드립니다.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 🆕 슈퍼관리자: 신규 서비스 스캔
app.post('/api/super/scan-new-services', requireSuperAdmin, async (req, res) => {
  try {
    scanNewServices().catch(e => console.log(e));
    res.json({ ok: true, message: '신규 서비스 스캔을 시작했습니다. 결과는 텔레그램으로 알려드립니다.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
      // cr.amount는 원화(₩) → DB credit은 USD이므로 환율로 나눔
      const crSiteR = await query(`SELECT exrate FROM sites WHERE id=$1`, [cr.site_id]);
      const crGlobalEx = parseFloat((await getGlobalSetting('global_exrate')) || '1500');
      const crEx = (crSiteR.rows[0] && crSiteR.rows[0].exrate > 0) ? crSiteR.rows[0].exrate : crGlobalEx;
      const crUSD = parseFloat(cr.amount) / crEx;
      await query(`UPDATE sites SET credit=credit+$1 WHERE id=$2`, [crUSD, cr.site_id]);
      // 해당 사이트 텔레그램 알림
      const siteR = await query(`SELECT * FROM sites WHERE id=$1`, [cr.site_id]);
      const site = siteR.rows[0];
      if (site?.tg_token && site?.tg_chat) {
        await fetch(`https://api.telegram.org/bot${site.tg_token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: site.tg_chat,
            text: `✅ <b>크레딧 충전 완료</b>\n💵 ₩${Math.round(cr.amount).toLocaleString()} 충전됨\n현재 잔액 확인해주세요`,
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
      const sitesR = await query(`SELECT id FROM sites`);
      for (const st of sitesR.rows) {
        await query(`INSERT INTO site_services(site_id, service_id, active) VALUES($1,$2,1)
                     ON CONFLICT(site_id, service_id) DO NOTHING`, [st.id, id]);
      }
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

app.post('/api/super/sites/create', requireSuperAdmin, async (req, res) => {
  try {
    const { domain, name, logo, primaryColor, accentColor, adminEmail, adminPw, margin, exrate, credit } = req.body;
    if (!domain || !name || !adminEmail || !adminPw)
      return res.json({ error: '필수 항목을 입력하세요' });
    const siteId = 'site_' + Date.now();
    const superMarginVal = req.body.superMargin !== undefined ? parseFloat(req.body.superMargin) : -1;

    // 자동 테마 생성 - 사이트마다 고유한 조합
    function generateUniqueTheme(seed) {
      let s = seed;
      const rnd = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return Math.abs(s) / 0xffffffff; };
      // 라이트 계열 비중 높임 (dark 25%, mid 25%, light 50%)
      const bgTypeRnd = rnd();
      const bgType = bgTypeRnd < 0.5 ? 'light' : (bgTypeRnd < 0.75 ? 'mid' : 'dark');
      const palettes = [
        {p:'#FF0080',a:'#7928CA'},{p:'#00F5FF',a:'#0050FF'},{p:'#39FF14',a:'#00CC44'},
        {p:'#FFD700',a:'#FF8C00'},{p:'#FF6B35',a:'#FF0A54'},{p:'#00E5CC',a:'#0066FF'},
        {p:'#FF85A1',a:'#C9184A'},{p:'#A855F7',a:'#6D28D9'},{p:'#F97316',a:'#DC2626'},
        {p:'#10B981',a:'#059669'},{p:'#3B82F6',a:'#1D4ED8'},{p:'#EC4899',a:'#9333EA'},
        {p:'#EAB308',a:'#D97706'},{p:'#14B8A6',a:'#0891B2'},{p:'#F43F5E',a:'#E11D48'},
        {p:'#8B5CF6',a:'#7C3AED'},{p:'#06B6D4',a:'#0284C7'},{p:'#84CC16',a:'#65A30D'},
        {p:'#FB923C',a:'#EA580C'},{p:'#E879F9',a:'#A21CAF'},
      ];
      const palette = palettes[Math.floor(rnd() * palettes.length)];
      const fonts = [
        "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        "'Courier New',monospace","Georgia,serif",
        "'Helvetica Neue',Helvetica,Arial,sans-serif",
        "Verdana,Geneva,sans-serif","'Trebuchet MS',sans-serif",
      ];
      const font = fonts[Math.floor(rnd() * fonts.length)];
      const radii = ['4px','8px','12px','20px','100px'];
      const radius = radii[Math.floor(rnd() * radii.length)];
      const cardStyles = ['flat','shadow','glow','border'];
      const cardStyle = cardStyles[Math.floor(rnd() * cardStyles.length)];
      const hue = Math.floor(rnd() * 360);
      let bg, w, tx, tm, tl, bd, bd2;
      if (bgType === 'dark') {
        bg=`hsl(${hue},20%,6%)`;w=`hsl(${hue},20%,10%)`;tx=`hsl(${hue},10%,90%)`;
        tm=`hsl(${hue},10%,60%)`;tl=`hsl(${hue},10%,40%)`;
        bd=`hsla(${hue},50%,60%,.15)`;bd2=`hsla(${hue},50%,60%,.35)`;
      } else if (bgType === 'light') {
        bg=`hsl(${hue},30%,97%)`;w=`#ffffff`;tx=`hsl(${hue},40%,10%)`;
        tm=`hsl(${hue},20%,40%)`;tl=`hsl(${hue},15%,60%)`;
        bd=`hsla(${hue},40%,40%,.12)`;bd2=`hsla(${hue},40%,40%,.28)`;
      } else {
        bg=`hsl(${hue},25%,18%)`;w=`hsl(${hue},20%,24%)`;tx=`hsl(${hue},10%,92%)`;
        tm=`hsl(${hue},15%,65%)`;tl=`hsl(${hue},10%,45%)`;
        bd=`hsla(${hue},40%,70%,.18)`;bd2=`hsla(${hue},40%,70%,.38)`;
      }
      return { p1:palette.p, p2:palette.a, p3:palette.a, bg, w, tx, tm, tl, bd, bd2, font, radius, cardStyle, bgType };
    }
    const siteCountR = await query(`SELECT COUNT(*) as cnt FROM sites WHERE id != 'default'`);
    const siteCount = parseInt(siteCountR.rows[0].cnt) || 0;
    const themeData = generateUniqueTheme(siteCount * 999983 + 12345);
    // 🔧 사용자가 색상을 직접 지정했으면 그 색 사용 + theme 비워두기 (glow 기본 테마 사용)
    // 색상 미지정 시에만 자동 랜덤 테마 JSON 사용
    const userPickedColors = !!(primaryColor && accentColor);
    const autoTheme = userPickedColors ? 'glow' : JSON.stringify(themeData);
    const finalPrimary = primaryColor || themeData.p1;
    const finalAccent  = accentColor  || themeData.p2;

    await query(`INSERT INTO sites(id,domain,name,logo,primary_color,accent_color,margin,exrate,credit,super_margin,theme) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [siteId, domain, name, logo||'✨', finalPrimary, finalAccent,
        parseFloat(margin||0), parseFloat(exrate||1380), parseFloat(credit||0), superMarginVal, autoTheme]);
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
    res.json({ ok: true, siteId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/sites/credit', requireSuperAdmin, async (req, res) => {
  try {
    const { siteId, amount } = req.body;
    // amount는 프론트엔드에서 이미 USD로 환산되어 전달됨
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.json({ error: '금액을 입력하세요' });
    await query(`UPDATE sites SET credit=credit+$1 WHERE id=$2`, [amt, siteId]);
    const r = await query(`SELECT * FROM sites WHERE id=$1`, [siteId]);
    res.json({ ok: true, credit: r.rows[0].credit });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 사이트 크레딧 직접 수정 (정확한 값으로 덮어쓰기 · 잘못 충전 정정용)
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

app.post('/api/super/sites/update', requireSuperAdmin, async (req, res) => {
  try {
    const { siteId, name, domain, logo, primaryColor, accentColor, margin, exrate, active } = req.body;
    const superMarginUpd = req.body.superMargin !== undefined ? parseFloat(req.body.superMargin) : -1;
    // 🔧 색상을 지정해서 변경했다면 theme을 'glow'(기본)로 설정해 사용자 색상이 표시되게 함
    await query(`UPDATE sites SET name=$1,domain=$2,logo=$3,primary_color=$4,accent_color=$5,margin=$6,exrate=$7,active=$8,super_margin=$9,theme='glow' WHERE id=$10`,
      [name, domain, logo, primaryColor, accentColor, parseFloat(margin), parseFloat(exrate), active?1:0, superMarginUpd, siteId]);
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

app.post('/api/super/settings/save', requireSuperAdmin, async (req, res) => {
  try {
    const { key, value } = req.body;
    const allowed = ['super_margin', 'global_exrate', 'peakerr_api_key', 'tg_token', 'tg_chat'];
    if (!allowed.includes(key)) return res.json({ error: '잘못된 설정 키' });
    await setGlobalSetting(key, value);
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
    // 순수익 계산: 총매출 - API 원가 합계
    const totalApiCost = await query(`SELECT SUM(qty * rate / 1000.0) as s FROM orders o JOIN services s ON o.sid = s.id`);
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
      apiBalance,
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
  if (n.includes('discord')) return 'other';
  if (n.includes('linkedin')) return 'other';
  if (n.includes('pinterest')) return 'other';
  if (n.includes('reddit')) return 'other';
  if (n.includes('soundcloud')) return 'other';
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

// SPA - 사이트별 브랜딩을 서버사이드에서 삽입 (FOUC 완전 방지)
app.get('*', async (req, res) => {
  try {
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
    
    if (site) {
      siteName = (site.name || 'GLOW').replace(/[<>"']/g, '');
      siteLogo = (site.logo || '✨').replace(/[<>"']/g, '');
      if (site.primary_color) primaryColor = site.primary_color;
      if (site.accent_color) accentColor = site.accent_color;
    }
    
    // HTML placeholder를 실제 값으로 치환 (모든 발생 위치)
    html = html.split('__SITE_NAME__').join(siteName);
    html = html.split('__SITE_LOGO__').join(siteLogo);
    
    // 커스텀 테마 색상 주입 (기본 CSS 변수를 덮어씀)
    const customTheme = `<style id="dynamic-theme">
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
  
  // 💵 Peakerr 잔액 주기 체크 (6시간마다)
  setInterval(async () => {
    await checkPeakerrBalance().catch(() => {});
  }, 6 * 60 * 60 * 1000);
  
  // 🔄 주문 상태 자동 동기화 (30분마다)
  setInterval(async () => {
    await syncAllOrderStatuses().catch(e => console.log('주문 동기화 스케줄러 오류:', e.message));
  }, 30 * 60 * 1000);
  
  // 🔄 서비스 동기화 (6시간마다 + 시작 시 1회, 삭제/가격변경 체크)
  //    Render 무료 인스턴스는 잠들었다 깨면 타이머가 리셋되므로 시작 시 실행 필수
  syncPeakerrServices().catch(e => console.log('서비스 동기화 초기 실행 오류:', e.message));
  setInterval(async () => {
    await syncPeakerrServices().catch(e => console.log('서비스 동기화 스케줄러 오류:', e.message));
  }, 6 * 60 * 60 * 1000);
  
  // 🆕 신규 서비스 스캔 (일요일마다)
  setInterval(async () => {
    const now = new Date();
    if (now.getDay() === 0 && now.getHours() === 10) { // 일요일 오전 10시
      await scanNewServices().catch(e => console.log('신규 스캔 오류:', e.message));
    }
  }, 60 * 60 * 1000); // 매 시간 체크 (실제 실행은 일요일 10시만)
  
  // 서버 시작 후 5분 뒤 한 번 실행 (DB 준비 대기)
  setTimeout(async () => {
    console.log('🔄 서버 시작 후 자동 동기화 실행');
    await syncAllOrderStatuses().catch(() => {});
  }, 5 * 60 * 1000);
});
