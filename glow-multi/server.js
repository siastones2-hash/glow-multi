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
    global_exrate: '1500'  // 글로벌 기본 환율
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

  // 기본 서비스 강제 최신화 (매 시작시 기본 서비스 삭제 후 재삽입)
  await query(`DELETE FROM services WHERE id LIKE 'api_%'`);
  await query(`DELETE FROM services WHERE id NOT LIKE 'api_%'`);
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

async function tgAlert(msg, site) {
  // 사이트별 텔레그램 우선, 없으면 글로벌
  let token = site?.tg_token || '';
  let chat = site?.tg_chat || '';
  if (!token || !chat) {
    token = await getGlobalSetting('tg_token');
    chat = await getGlobalSetting('tg_chat');
  }
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: msg, parse_mode: 'HTML' })
    });
  } catch(e) { console.log('TG 오류:', e.message); }
}

async function tgChargeAlert(chargeId, userName, amount, note, site) {
  const siteName = typeof site === 'object' ? site.name : site;
  let token = (typeof site === 'object' ? site.tg_token : '') || await getGlobalSetting('tg_token');
  let chat = (typeof site === 'object' ? site.tg_chat : '') || await getGlobalSetting('tg_chat');
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
    footerText: site.footer_text || '소셜 미디어 플랫폼과 공식 제휴된 서비스가 아닙니다.',
    loginWelcome: site.login_welcome || '다시 만나서 반가워요',
    loginSub: site.login_sub || '계정에 로그인하세요',
    registerWelcome: site.register_welcome || '지금 시작하세요',
    registerSub: site.register_sub || '무료로 계정을 만들어보세요',
    kakaoBtnText: site.kakao_btn_text || '카카오톡 문의',
    chargeGuide: site.charge_guide || '입금 후 아래 양식을 작성해주세요.',
    orderGuide: site.order_guide || '주문 후 취소가 어려울 수 있습니다.',
    heroBadge: site.hero_badge || '소셜 성장 자동화 플랫폼',
    theme: site.theme || 'glow'
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
    res.json(serviceRows.map(s => {
      // 🔧 가격 계산: 1000개 단위로 먼저 계산한 뒤 1개당으로 나눔 (반올림으로 ₩0 되는 것 방지)
      const origPer1000 = s.rate * ex; // 1000개 기준 원가 (원화)
      const supplyPer1000 = origPer1000 * (1 + superMg / 100); // 1000개 기준 공급가
      const sellPer1000 = supplyPer1000 * (1 + siteMg / 100); // 1000개 기준 고객가
      // 1개당 환산 (최소 1원 보장 - 손해 방지)
      const originalCost = Math.max(Math.round(origPer1000 / 1000), 1);
      const supplyCost = Math.max(Math.round(supplyPer1000 / 1000), 1);
      const sellPrice = Math.max(Math.round(sellPer1000 / 1000), 1);
      if (isPartner) {
        // partner에게는 공급가를 원가처럼 보여줌 (실제 원가 숨김)
        return { ...s, sell: sellPrice, baseCost: supplyCost, isPartnerView: true };
      }
      return { ...s, sell: sellPrice, originalCost, supplyCost, myProfit: supplyCost - originalCost };
    }));
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
    const charge = svc.rate / 1000 * qtyNum * ex * (1 + superMg2 / 100) * (1 + siteMg / 100);
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
    tgAlert(`📦 <b>새 주문</b> [${site?.name || 'GLOW'}]\n👤 ${user.name}\n✦ ${svc.name}\n🔢 ${qtyNum.toLocaleString()}개\n💰 ₩${Math.round(charge).toLocaleString()}\n🔗 ${link}`, site);
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
    tgChargeAlert(id, user.name, amt, note, req.site || {name:'GLOW'});
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
      tgAlert(`✅ 충전승인 [${req.site?.name}]\n👤 ${charge.uname}\n💰 ₩${Math.round(charge.amount).toLocaleString()}`, req.site);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 관리자 서비스 활성화 목록 조회
app.get('/api/admin/site-services', requireAdmin, async (req, res) => {
  try {
    const siteId = req.siteId;
    if (siteId === 'default') return res.json({ error: '슈퍼관리자는 서비스 관리 탭을 이용하세요' });
    // 전체 서비스 + 이 사이트의 활성화 여부
    const r = await query(`
      SELECT s.id, s.name, s.pl, s.rate, s.min, s.max, s.active as global_active,
        COALESCE(ss.active, 1) as site_active
      FROM services s
      LEFT JOIN site_services ss ON s.id = ss.service_id AND ss.site_id = $1
      WHERE s.active = 1
      ORDER BY s.pl, s.rate ASC
    `, [siteId]);
    res.json(r.rows);
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
    // 전체 서비스에 대해 site_services 레코드 생성/업데이트
    const allSvcs = await query(`SELECT id FROM services WHERE active=1`);
    for (const s of allSvcs.rows) {
      await query(`
        INSERT INTO site_services(site_id, service_id, active)
        VALUES($1, $2, $3)
        ON CONFLICT(site_id, service_id) DO UPDATE SET active=$3
      `, [siteId, s.id, active ? 1 : 0]);
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

    // 관리자용: 공급가 샘플 계산 (가장 저렴한 서비스 기준)
    let supplyExamples = [];
    if (!isSuperAdmin) {
      try {
        const ex = (site && site.exrate > 0) ? site.exrate : parseFloat(global_exrate || '1500');
        const superMgStr = super_margin || '50';
        const superMg = (site && site.super_margin >= 0) ? site.super_margin : parseFloat(superMgStr);
        const svcs = await query(`SELECT id, name, rate, pl FROM services WHERE active=1 ORDER BY rate ASC LIMIT 5`);
        supplyExamples = svcs.rows.map(s => ({
          name: s.name,
          pl: s.pl,
          supplyPer1000: Math.round(s.rate / 1000 * ex * (1 + superMg / 100) * 1000), // ₩/1000개
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
    const siteFields = ['name','kakao','bank','margin','exrate','super_margin','primary_color','accent_color','logo','slogan','slogan_sub','description','stat1_num','stat1_label','stat2_num','stat2_label','stat3_num','stat3_label','stat4_num','stat4_label','notice','footer_text','login_welcome','login_sub','register_welcome','register_sub','kakao_btn_text','charge_guide','order_guide','hero_badge'];
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
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.json({ error: '금액을 입력하세요' });
    const site = req.site;
    if (!site) return res.json({ error: '사이트 정보를 찾을 수 없습니다' });
    const id = 'CR' + Date.now();
    await query(`INSERT INTO credit_requests(id,site_id,site_name,amount,note,status) VALUES($1,$2,$3,$4,$5,$6)`,
      [id, site.id, site.name, amt, note || '', 'pending']);
    // 슈퍼관리자 텔레그램 알림
    const token = await getGlobalSetting('tg_token');
    const chat = await getGlobalSetting('tg_chat');
    if (token && chat) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat,
          text: `💰 <b>크레딧 요청</b>\n🏢 ${site.name}\n💵 $${amt}\n📝 ${note || '-'}\n⏰ ${new Date().toLocaleString('ko-KR')}`,
          parse_mode: 'HTML'
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
      await query(`UPDATE sites SET credit=credit+$1 WHERE id=$2`, [cr.amount, cr.site_id]);
      // 해당 사이트 텔레그램 알림
      const siteR = await query(`SELECT * FROM sites WHERE id=$1`, [cr.site_id]);
      const site = siteR.rows[0];
      if (site?.tg_token && site?.tg_chat) {
        await fetch(`https://api.telegram.org/bot${site.tg_token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: site.tg_chat,
            text: `✅ <b>크레딧 충전 완료</b>\n💵 $${cr.amount} 충전됨\n현재 잔액 확인해주세요`,
            parse_mode: 'HTML'
          })
        });
      }
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── 서비스 CRUD (슈퍼어드민) ──
app.post('/api/super/services/create', requireSuperAdmin, async (req, res) => {
  try {
    const { name, pl, rate, min, max, description, active } = req.body;
    if (!name) return res.json({ error: '서비스명을 입력하세요' });
    const id = 'svc_' + Date.now();
    await query(`INSERT INTO services(id,name,pl,rate,min,max,description,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, name, pl||'other', parseFloat(rate||0), parseInt(min||100), parseInt(max||1000000), description||'', active?1:0]);
    res.json({ ok: true, id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/super/services/update', requireSuperAdmin, async (req, res) => {
  try {
    const { id, name, pl, rate, min, max, description, active } = req.body;
    if (!id) return res.json({ error: 'ID가 없습니다' });
    await query(`UPDATE services SET name=$1,pl=$2,rate=$3,min=$4,max=$5,description=$6,active=$7 WHERE id=$8`,
      [name, pl||'other', parseFloat(rate||0), parseInt(min||100), parseInt(max||1000000), description||'', active?1:0, id]);
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
    res.json(r.rows);
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
    const autoTheme = JSON.stringify(themeData);
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
    const superMarginUpd = req.body.superMargin !== undefined ? parseFloat(req.body.superMargin) : -1;
    await query(`UPDATE sites SET name=$1,domain=$2,logo=$3,primary_color=$4,accent_color=$5,margin=$6,exrate=$7,active=$8,super_margin=$9 WHERE id=$10`,
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
      myProfit: Math.round(myProfitKrw)
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
