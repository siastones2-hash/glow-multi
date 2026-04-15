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
      {id:'yt1',name:'YouTube 조회수 — 일반 (빠른 처리)',pl:'youtube',rate:0.50,min:1000,max:1000000,description:'조회수는 유튜브 알고리즘의 핵심 지표입니다. 조회수가 높을수록 추천 영상에 노출되는 빈도가 높아지고, 신규 시청자 유입이 자연스럽게 증가합니다. 실제 사용자 패턴 기반으로 처리되어 안전하며, 빠른 시작으로 초기 채널 성장에 최적화되어 있습니다. 영상 업로드 직후 적용하면 알고리즘 부스트 효과를 극대화할 수 있습니다.'},
      {id:'yt2',name:'YouTube 조회수 — 고유지율 (30초+)',pl:'youtube',rate:1.20,min:500,max:500000,description:'단순 조회수보다 훨씬 강력한 효과를 제공합니다. 평균 시청 시간 30초 이상으로 처리되어 유튜브 알고리즘이 "좋은 영상"으로 인식하게 만듭니다. 시청 지속 시간은 추천 알고리즘 가중치가 가장 높은 지표로, 홈 화면과 추천 탭 노출 가능성을 크게 높여줍니다. 수익화 채널이나 브랜드 영상에 특히 효과적입니다.'},
      {id:'yt3',name:'YouTube 조회수 — 미국/영어권',pl:'youtube',rate:2.50,min:500,max:100000,description:'RPM(광고 1,000회 노출당 수익)이 가장 높은 미국, 캐나다, 영국, 호주 시청자 기반의 조회수입니다. 같은 조회수라도 영어권 시청자 비율이 높으면 광고 수익이 3~5배 이상 차이납니다. 글로벌 진출을 목표로 하는 크리에이터나 영어 콘텐츠 채널의 수익 극대화에 필수입니다.'},
      {id:'yt4',name:'YouTube 구독자 — 실계정',pl:'youtube',rate:3.00,min:100,max:50000,description:'수익화의 첫 번째 관문인 구독자 1,000명 달성을 도와드립니다. 실제 활성 계정 기반으로 구독자 수가 증가하여 채널 신뢰도와 사회적 증거(Social Proof)를 높여줍니다. 구독자가 많은 채널은 브랜드 협찬 제안도 더 많이 받게 되며, 신규 방문자의 구독 전환율도 자연스럽게 높아집니다. 드롭 발생 시 자동 보충됩니다.'},
      {id:'yt5',name:'YouTube 좋아요',pl:'youtube',rate:0.80,min:50,max:100000,description:'좋아요 수는 알고리즘이 영상 품질을 판단하는 중요한 신호입니다. 조회수 대비 좋아요 비율(좋아요율)이 높을수록 추천 탭과 검색 결과 상위에 노출될 확률이 높아집니다. 새 영상 업로드 시 빠르게 좋아요를 늘리면 초기 알고리즘 부스트를 받을 수 있으며, 시청자에게 신뢰감을 주어 추가 구독과 공유를 유도합니다.'},
      {id:'yt6',name:'YouTube 시청시간 (시간)',pl:'youtube',rate:5.00,min:100,max:10000,description:'유튜브 수익화 조건인 연간 4,000시간을 빠르게 달성하세요. 신규 채널이나 재활성화 채널의 수익화 신청 조건을 충족하는 데 필요한 시간을 단축해드립니다. 실제 시청 패턴으로 안전하게 처리되며, 시청 시간이 쌓일수록 채널 전체의 알고리즘 신뢰도도 함께 상승합니다.'},
      {id:'yt7',name:'YouTube 댓글 (커스텀)',pl:'youtube',rate:8.00,min:10,max:500,description:'원하는 내용의 댓글로 영상 활성도를 높여드립니다. 댓글이 많은 영상은 알고리즘이 "시청자 참여도가 높은 영상"으로 판단하여 더 많이 노출시킵니다. 긍정적인 댓글은 신규 방문자에게 신뢰감을 주고, 질문 형태의 댓글은 다른 시청자들의 추가 댓글 참여를 유도하는 효과가 있습니다.'},
      {id:'yt8',name:'YouTube 라이브 시청자',pl:'youtube',rate:10.00,min:100,max:10000,description:'라이브 방송 동시 시청자 수를 늘려 방송의 인기도를 높여드립니다. 시청자가 많은 라이브는 유튜브 라이브 탭에 상위 노출되어 신규 유입을 자연스럽게 만들어냅니다. 슈퍼챗, 멤버십 유도, 브랜드 라이브 이벤트 등에서 높은 동시 접속자 수는 참여율과 수익에 직접적인 영향을 줍니다.'},
      {id:'yt9',name:'YouTube 쇼츠 조회수',pl:'youtube',rate:0.15,min:1000,max:5000000,description:'유튜브 쇼츠는 지금 가장 빠르게 성장하는 포맷입니다. 조회수를 빠르게 늘려 쇼츠 피드 알고리즘의 바이럴 루프에 진입시켜 드립니다. 한 번 알고리즘이 영상을 밀기 시작하면 수백만 조회수까지 자연 성장이 가능합니다. 채널 성장의 가장 빠른 진입로로, 신규 채널에 특히 강력히 추천합니다.'},
      {id:'yt10',name:'YouTube 저장 (플레이리스트)',pl:'youtube',rate:1.50,min:100,max:50000,description:'영상 저장 수는 유튜브 알고리즘에서 "나중에 다시 보고 싶은 영상"으로 분류되는 강력한 신호입니다. 저장이 많은 영상은 구독자 홈 피드와 추천 영상에 장기적으로 지속 노출됩니다. 조회수나 좋아요보다 알고리즘 가중치가 높으며, 튜토리얼, 레시피, 정보성 콘텐츠에 특히 효과적입니다.'},
      {id:'ig1',name:'Instagram 팔로워 — 글로벌 실계정',pl:'instagram',rate:1.50,min:100,max:100000,description:'팔로워 수는 인스타그램에서 신뢰도와 인지도를 나타내는 핵심 지표입니다. 팔로워가 많을수록 브랜드 협찬 제안을 받을 가능성이 높아지고, 탐색 탭 노출 빈도도 증가합니다. 전 세계 실계정 기반으로 제공되며, 자연스러운 성장 패턴을 유지합니다. 드롭 발생 시 자동 보충 서비스가 포함되어 있습니다.'},
      {id:'ig2',name:'Instagram 팔로워 — 한국인',pl:'instagram',rate:5.00,min:50,max:10000,description:'국내 마케팅에 특화된 한국인 실계정 팔로워입니다. 한국 소비자를 타겟으로 하는 쇼핑몰, 맛집, 뷰티, 패션 계정에 가장 효과적입니다. 국내 팔로워 비율이 높으면 인스타그램 알고리즘이 국내 사용자에게 더 많이 노출시켜 실제 고객 유입으로 이어질 확률이 높습니다. 협찬 제안 시 국내 팔로워 비율은 브랜드사에서 중요하게 봅니다.'},
      {id:'ig3',name:'Instagram 팔로워 — 미국/영어권',pl:'instagram',rate:4.50,min:50,max:20000,description:'글로벌 브랜드 마케팅과 영어권 시장 공략에 최적화된 팔로워입니다. 미국, 영국, 캐나다, 호주 등 구매력이 높은 영어권 실계정으로 구성됩니다. 글로벌 진출을 목표로 하는 K-브랜드나 영어 콘텐츠 크리에이터에게 필수이며, 해외 브랜드 협찬 단가를 높이는 데 효과적입니다.'},
      {id:'ig4',name:'Instagram 좋아요 — 빠른 처리',pl:'instagram',rate:0.30,min:50,max:500000,description:'게시물 좋아요 수는 인스타그램 탐색 탭 노출의 핵심 요소입니다. 업로드 직후 빠르게 좋아요를 늘리면 인스타그램 알고리즘이 "인기 게시물"로 분류하여 팔로워가 아닌 사용자에게도 노출됩니다. 신제품 출시, 이벤트 게시물, 브랜드 캠페인에 적용하면 유기적 도달 범위를 극대화할 수 있습니다.'},
      {id:'ig5',name:'Instagram 릴스 조회수',pl:'instagram',rate:0.25,min:1000,max:10000000,description:'릴스는 현재 인스타그램에서 가장 강력한 성장 도구입니다. 조회수를 빠르게 늘려 알고리즘의 바이럴 루프에 진입시켜 드립니다. 조회수가 높은 릴스는 팔로워가 아닌 사람들에게도 대규모로 노출되어, 팔로워 급증과 계정 성장으로 이어집니다. 한 편의 릴스가 계정을 완전히 바꿀 수 있습니다.'},
      {id:'ig6',name:'Instagram 스토리 조회수',pl:'instagram',rate:0.35,min:100,max:1000000,description:'스토리 조회수는 계정 활성도와 팔로워 인게이지먼트를 나타냅니다. 조회수가 높은 스토리는 팔로워 피드 상단에 우선 표시되어 더 많은 노출을 확보합니다. 스토리 링크, 제품 태그, 설문 기능과 결합하면 실제 전환율을 높이는 효과적인 마케팅 도구가 됩니다.'},
      {id:'ig7',name:'Instagram 게시물 저장',pl:'instagram',rate:0.50,min:100,max:100000,description:'저장 수는 인스타그램 알고리즘에서 가장 높은 가중치를 부여받는 참여 지표입니다. "나중에 다시 보고 싶은 게시물"로 분류된 콘텐츠는 탐색 탭과 추천 피드에 장기간 지속적으로 노출됩니다. 인포그래픽, 레시피, 팁 콘텐츠 등 정보성 게시물에 특히 강력한 효과를 발휘합니다.'},
      {id:'ig8',name:'Instagram 댓글 (커스텀)',pl:'instagram',rate:10.00,min:5,max:300,description:'원하는 내용의 댓글로 게시물 활성도를 높여드립니다. 댓글이 많은 게시물은 알고리즘이 높은 참여도를 인식하여 더 많은 사람에게 노출시킵니다. 브랜드 이미지에 맞는 긍정적 댓글, 제품 질문 형태의 댓글 등을 원하는 내용으로 작성해드립니다.'},
      {id:'ig9',name:'Instagram 팔로워 — 여성 타겟',pl:'instagram',rate:3.50,min:50,max:20000,description:'여성 계정 중심의 팔로워로 뷰티, 패션, 육아, 라이프스타일 계정에 최적화되어 있습니다. 타겟 고객층과 일치하는 팔로워 구성은 브랜드 신뢰도를 높이고, 실제 구매로 이어지는 전환율을 높여줍니다. 여성 타겟 브랜드의 협찬 단가 협상에도 유리하게 작용합니다.'},
      {id:'ig10',name:'Instagram 라이브 시청자',pl:'instagram',rate:8.00,min:100,max:5000,description:'인스타그램 라이브 동시 시청자를 늘려드립니다. 시청자가 많은 라이브는 팔로워 알림에서 상위 노출되고, 라이브 탭에서도 우선 표시됩니다. 제품 라이브 판매, 브랜드 이벤트, 인플루언서 협업 라이브에서 높은 시청자 수는 신뢰도와 구매 전환율을 크게 높여줍니다.'},
      {id:'ig11',name:'Instagram 인상 수 (Impressions)',pl:'instagram',rate:0.20,min:1000,max:5000000,description:'게시물이 노출된 총 횟수를 늘려드립니다. 인상 수가 높으면 광고 효율 리포트에서 브랜드 인지도 지표가 개선되어, 브랜드 마케팅 제안 시 설득력 있는 데이터를 제시할 수 있습니다. 캠페인 성과 보고서를 위한 노출 수 확보에 효과적입니다.'},
      {id:'ig12',name:'Instagram 팔로우 + 언팔',pl:'instagram',rate:2.00,min:100,max:10000,description:'팔로우 후 일정 시간 뒤 언팔하는 방식으로 계정 노출을 높이는 전략입니다. 상대방의 알림에 계정이 노출되어 프로필 방문과 맞팔로워 유도 효과가 있습니다. 특정 타겟층에게 계정을 알리는 자연스러운 초기 마케팅 방법입니다.'},
      {id:'tt1',name:'TikTok 팔로워 — 실계정',pl:'tiktok',rate:1.80,min:100,max:100000,description:'틱톡 팔로워는 포유(For You) 탭 노출의 기본 신뢰도 지표입니다. 팔로워가 많을수록 알고리즘이 새 영상을 더 넓은 범위에 먼저 배포합니다. 실계정 기반으로 처리되어 계정 안전성을 유지하면서 인플루언서 레벨로 성장할 수 있는 기반을 만들어드립니다.'},
      {id:'tt2',name:'TikTok 조회수 — 초고속',pl:'tiktok',rate:0.15,min:1000,max:10000000,description:'틱톡에서 바이럴을 만드는 가장 빠른 방법입니다. 초기 조회수가 빠르게 쌓이면 틱톡 알고리즘이 영상을 더 넓은 포유 탭에 배포합니다. 이 바이럴 루프에 진입하면 수백만 조회수까지 자연 성장이 가능합니다. 트렌드에 맞는 영상 업로드 직후 적용하면 효과가 극대화됩니다.'},
      {id:'tt3',name:'TikTok 조회수 — 고유지율',pl:'tiktok',rate:0.80,min:500,max:1000000,description:'틱톡 알고리즘은 영상 완시청률을 가장 중요하게 봅니다. 고유지율 조회수는 시청자가 끝까지 본 것처럼 처리되어 알고리즘이 영상을 "좋은 콘텐츠"로 판단합니다. 단순 조회수보다 포유 탭 노출에 훨씬 강력한 효과를 발휘하며, 광고나 브랜드 영상에 특히 추천합니다.'},
      {id:'tt4',name:'TikTok 좋아요',pl:'tiktok',rate:0.40,min:100,max:500000,description:'좋아요는 틱톡 알고리즘의 중요한 참여 신호입니다. 조회수 대비 좋아요 비율이 높은 영상은 알고리즘이 더 많은 사람에게 배포합니다. 빠른 좋아요 증가로 영상의 초기 알고리즘 점수를 높여 포유 탭 진입을 도와드립니다.'},
      {id:'tt5',name:'TikTok 공유 수',pl:'tiktok',rate:1.20,min:100,max:50000,description:'공유는 틱톡에서 가장 강력한 바이럴 신호입니다. 다른 플랫폼으로 공유된 영상은 외부 트래픽을 유입시키고, 틱톡 알고리즘은 공유가 많은 영상을 바이럴 콘텐츠로 판단하여 대규모 배포합니다. 캠페인 영상이나 챌린지 영상의 바이럴 효과를 극대화하고 싶을 때 가장 효과적인 서비스입니다.'},
      {id:'tt6',name:'TikTok 저장 수',pl:'tiktok',rate:1.00,min:100,max:50000,description:'저장 수는 틱톡 알고리즘에서 "나중에 다시 보고 싶은 영상"으로 분류되는 강력한 신호입니다. 저장이 많은 영상은 포유 탭에 장기간 지속적으로 노출됩니다. 튜토리얼, 레시피, 정보성 콘텐츠에 적용하면 지속적인 유기적 노출 효과를 누릴 수 있습니다.'},
      {id:'tt7',name:'TikTok 댓글 (커스텀)',pl:'tiktok',rate:12.00,min:5,max:200,description:'원하는 내용의 댓글로 영상 참여도를 높여드립니다. 댓글이 많은 영상은 틱톡 알고리즘이 높은 인게이지먼트로 인식하여 포유 탭 노출을 늘립니다. 질문 형태의 댓글은 다른 시청자들의 댓글 참여를 유발하는 연쇄 효과가 있습니다.'},
      {id:'tt8',name:'TikTok 라이브 시청자',pl:'tiktok',rate:9.00,min:100,max:5000,description:'틱톡 라이브 동시 시청자를 늘려드립니다. 시청자가 많은 라이브는 라이브 탐색 탭 상단에 노출되어 신규 유입을 만들어냅니다. 라이브 선물, 제품 판매, 브랜드 이벤트에서 높은 시청자 수는 수익과 신뢰도를 동시에 높여줍니다.'},
      {id:'tt9',name:'TikTok 팔로워 — 미국 타겟',pl:'tiktok',rate:4.00,min:50,max:10000,description:'미국 기반 틱톡 사용자 팔로워입니다. 틱톡 크리에이터 펀드와 브랜드 협찬 시 미국 팔로워 비율은 수익에 직접적인 영향을 줍니다. 영어권 시장을 타겟으로 하는 크리에이터나 글로벌 브랜드에게 필수적인 서비스입니다.'},
      {id:'tt10',name:'TikTok 프로필 방문 수',pl:'tiktok',rate:0.30,min:1000,max:500000,description:'프로필 방문 수를 증가시켜 계정 노출도를 높여드립니다. 프로필 방문이 많으면 팔로워로 자연 전환될 확률이 높아지며, 틱톡 알고리즘이 계정의 인기도를 높게 평가합니다. 신규 계정의 초기 노출 확보에 효과적입니다.'},
      {id:'tw1',name:'Twitter/X 팔로워 — 글로벌',pl:'twitter',rate:2.00,min:100,max:100000,description:'X(트위터) 팔로워는 계정 영향력의 핵심 지표입니다. 팔로워가 많을수록 트윗의 도달 범위가 넓어지고, X 수익화 프로그램(광고 수익 공유) 조건 달성에 필수입니다. 글로벌 팔로워로 계정 신뢰도를 높여 인플루언서 협업 제안을 더 많이 받을 수 있습니다.'},
      {id:'tw2',name:'Twitter/X 팔로워 — 미국 타겟',pl:'twitter',rate:5.00,min:50,max:20000,description:'X 수익화에서 RPM이 가장 높은 미국 팔로워입니다. 같은 조회수라도 미국 팔로워 비율이 높으면 광고 수익이 수배 차이납니다. X 프리미엄 크리에이터로 성장하기 위한 핵심 자산입니다.'},
      {id:'tw3',name:'Twitter/X 좋아요',pl:'twitter',rate:0.80,min:50,max:100000,description:'좋아요가 많은 트윗은 X 알고리즘의 추천 탭과 탐색 탭에 우선 노출됩니다. 중요한 공지, 신제품 출시, 캠페인 트윗에 적용하면 유기적 도달 범위를 크게 확장할 수 있습니다.'},
      {id:'tw4',name:'Twitter/X 리트윗',pl:'twitter',rate:1.50,min:50,max:50000,description:'리트윗은 X에서 가장 강력한 바이럴 신호입니다. 리트윗이 많은 트윗은 팔로워가 아닌 사람들에게도 노출되어 계정 성장과 브랜드 인지도 향상에 직접적으로 기여합니다. 중요한 메시지가 빠르게 퍼질 수 있도록 도와드립니다.'},
      {id:'tw5',name:'Twitter/X 조회수',pl:'twitter',rate:0.30,min:1000,max:5000000,description:'X 수익화는 조회수 기반입니다. 조회수가 많을수록 광고 수익이 직접 증가합니다. 바이럴 가능성이 있는 트윗에 초기 조회수를 채워주면 알고리즘이 더 많은 사람에게 배포하는 선순환이 만들어집니다.'},
      {id:'tw6',name:'Twitter/X 북마크',pl:'twitter',rate:1.00,min:100,max:50000,description:'북마크는 X 알고리즘에서 높은 가중치를 가진 참여 지표입니다. "나중에 읽고 싶은 트윗"으로 분류되어 알고리즘 추천에 강력한 신호를 보냅니다. 정보성 트윗이나 중요한 발표에 적용하면 장기적인 노출 효과를 누릴 수 있습니다.'},
      {id:'tw7',name:'Twitter/X 댓글',pl:'twitter',rate:10.00,min:10,max:300,description:'트윗에 댓글을 달아드립니다. 댓글이 많은 트윗은 X 알고리즘이 높은 참여도로 인식하여 더 많이 노출시킵니다. 토론이나 질문 형태의 댓글은 다른 사용자들의 참여를 유도하는 연쇄 효과를 만들어냅니다.'},
      {id:'tw8',name:'Twitter/X 인용 트윗',pl:'twitter',rate:2.00,min:20,max:5000,description:'인용 트윗은 원본 트윗에 새로운 맥락을 더해 바이럴을 만드는 강력한 도구입니다. 인용이 많은 트윗은 X 알고리즘에서 "화제의 트윗"으로 분류되어 탐색 탭에 노출될 가능성이 높아집니다.'},
      {id:'th1',name:'Threads 팔로워',pl:'threads',rate:3.00,min:100,max:50000,description:'메타의 Threads 팔로워를 늘려드립니다. Threads는 인스타그램과 연동되어 팔로워가 늘어날수록 인스타그램 계정 노출에도 시너지 효과를 줍니다. 빠르게 성장하는 플랫폼에서 초기에 팔로워를 확보하면 유기적 성장 속도가 훨씬 빨라집니다.'},
      {id:'th2',name:'Threads 좋아요',pl:'threads',rate:0.80,min:50,max:100000,description:'Threads 게시물 좋아요로 참여도를 높여드립니다. 좋아요가 많은 게시물은 Threads 피드 상단에 노출되어 더 많은 팔로워와 인게이지먼트를 유도합니다.'},
      {id:'th3',name:'Threads 리포스트',pl:'threads',rate:1.50,min:50,max:20000,description:'Threads 게시물 리포스트로 콘텐츠 확산을 도와드립니다. 리포스트가 많을수록 팔로워가 아닌 사용자에게도 노출되어 빠른 팔로워 성장이 가능합니다.'},
      {id:'th4',name:'Threads 조회수',pl:'threads',rate:0.20,min:1000,max:1000000,description:'Threads 게시물 조회수를 빠르게 늘려드립니다. 높은 조회수는 알고리즘 추천을 유도하고 계정의 신뢰도를 높여줍니다.'},
      {id:'tg1',name:'Telegram 채널 멤버 — 글로벌',pl:'telegram',rate:1.50,min:100,max:100000,description:'텔레그램 채널 멤버 수는 채널의 신뢰도와 광고 수익에 직접적인 영향을 줍니다. 멤버가 많은 채널은 광고주로부터 더 높은 단가의 광고 제안을 받습니다. 전 세계 사용자 기반으로 빠르게 채널 규모를 키워 수익화와 영향력을 동시에 높여드립니다.'},
      {id:'tg2',name:'Telegram 채널 멤버 — 한국어권',pl:'telegram',rate:4.00,min:50,max:10000,description:'한국어 사용자 중심의 텔레그램 멤버입니다. 국내 커뮤니티, 정보 채널, 코인/주식 분석 채널 등 한국 타겟 채널 운영자에게 필수입니다. 한국인 멤버는 채널 광고 단가와 실제 반응률이 높아 수익화에 유리합니다.'},
      {id:'tg3',name:'Telegram 포스트 조회수',pl:'telegram',rate:0.25,min:1000,max:5000000,description:'채널 게시물 조회수는 채널 활성도의 핵심 지표입니다. 광고주들은 멤버 수보다 게시물 조회수를 더 중요하게 봅니다. 조회수가 높은 채널은 광고 단가 협상에서 훨씬 유리한 위치를 점할 수 있습니다.'},
      {id:'tg4',name:'Telegram 리액션',pl:'telegram',rate:0.80,min:100,max:50000,description:'게시물 이모지 리액션으로 채널 활성도와 참여율을 높여드립니다. 리액션이 많은 게시물은 채널의 인게이지먼트 지표를 개선하여 광고주에게 더 매력적인 채널로 보이게 합니다.'},
      {id:'tg5',name:'Telegram 그룹 멤버',pl:'telegram',rate:2.00,min:100,max:50000,description:'텔레그램 그룹 멤버를 늘려드립니다. 활성화된 커뮤니티는 비즈니스 협업, 제품 판매, 정보 공유에 강력한 도구가 됩니다. 초기 멤버 확보로 신규 참여자들의 자연 유입을 가속화하세요.'},
      {id:'tg6',name:'Telegram 봇 사용자',pl:'telegram',rate:3.00,min:100,max:10000,description:'텔레그램 봇의 사용자 수를 늘려드립니다. 봇 사용자가 많을수록 서비스 신뢰도가 높아지고, 실제 사용자 유입도 증가합니다.'},
      {id:'fb1',name:'Facebook 페이지 좋아요',pl:'facebook',rate:1.20,min:100,max:100000,description:'페이스북 페이지 좋아요는 비즈니스 페이지의 신뢰도를 나타내는 핵심 지표입니다. 좋아요가 많은 페이지는 페이스북 광고 집행 시 클릭률과 전환율이 더 높으며, 방문자에게 신뢰감을 주어 실제 고객 전환으로 이어집니다.'},
      {id:'fb2',name:'Facebook 팔로워',pl:'facebook',rate:1.00,min:100,max:100000,description:'페이스북 계정 팔로워를 늘려드립니다. 팔로워가 많을수록 게시물 도달 범위가 넓어지고, 알고리즘이 콘텐츠를 더 많은 사람에게 노출시킵니다.'},
      {id:'fb3',name:'Facebook 게시물 좋아요',pl:'facebook',rate:0.50,min:50,max:200000,description:'게시물 좋아요로 페이스북 알고리즘 노출을 높여드립니다. 좋아요가 많은 게시물은 팔로워의 뉴스피드 상단에 우선 표시되고, 친구들에게도 노출되어 유기적 도달이 증가합니다.'},
      {id:'fb4',name:'Facebook 동영상 조회수',pl:'facebook',rate:0.20,min:1000,max:5000000,description:'페이스북 동영상 조회수를 늘려드립니다. 조회수가 높은 영상은 인스트림 광고 수익이 발생하며, 알고리즘이 더 많은 사용자에게 배포합니다. 페이스북 릴스 성장에도 효과적입니다.'},
      {id:'fb5',name:'Facebook 공유 수',pl:'facebook',rate:2.00,min:50,max:20000,description:'게시물 공유로 바이럴 효과를 만들어드립니다. 공유가 많은 게시물은 페이스북 알고리즘에서 "화제 콘텐츠"로 분류되어 뉴스피드와 탐색 탭에 대규모 노출됩니다.'},
      {id:'fb6',name:'Facebook 리뷰 (별점 5점)',pl:'facebook',rate:15.00,min:5,max:200,description:'페이스북 비즈니스 페이지에 긍정적인 5점 리뷰를 달아드립니다. 리뷰가 많고 평점이 높은 비즈니스는 구글 검색 결과에도 긍정적인 영향을 주며, 신규 고객의 신뢰와 구매 결정에 직접적인 영향을 미칩니다.'},
      {id:'sp1',name:'Spotify 재생수 — 글로벌',pl:'spotify',rate:0.40,min:1000,max:1000000,description:'스포티파이 재생수를 늘려 차트 진입과 알고리즘 추천 확률을 높여드립니다. 재생수가 일정 기준을 넘으면 Discover Weekly, Release Radar 등 개인화 추천 플레이리스트에 포함될 가능성이 높아집니다. 신곡 발매 초기에 적용하면 알고리즘 부스트 효과를 극대화할 수 있습니다.'},
      {id:'sp2',name:'Spotify 팔로워',pl:'spotify',rate:2.00,min:100,max:20000,description:'스포티파이 아티스트 팔로워가 많을수록 신곡 발매 시 팔로워에게 자동 알림이 가고, 스포티파이 편집팀의 플레이리스트 선정 가능성도 높아집니다. 아티스트 인지도와 스트리밍 수익을 동시에 높이는 핵심 지표입니다.'},
      {id:'sp3',name:'Spotify 월간 리스너',pl:'spotify',rate:3.00,min:100,max:10000,description:'월간 리스너 수는 스포티파이 차트 진입의 핵심 지표이며, 아티스트 페이지에 공개적으로 표시되어 신뢰도에 직접 영향을 줍니다. 높은 월간 리스너는 레이블, 에이전시, 브랜드 협업 제안 시 강력한 증거 자료가 됩니다.'},
      {id:'sp4',name:'Spotify 플레이리스트 추가',pl:'spotify',rate:5.00,min:50,max:5000,description:'트랙을 플레이리스트에 추가해드립니다. 플레이리스트 등록은 지속적인 재생수 증가와 신규 리스너 유입의 원천입니다. 스포티파이 알고리즘은 플레이리스트 포함 트랙을 더 적극적으로 추천합니다.'},
      {id:'sp5',name:'Spotify 저장 수',pl:'spotify',rate:2.50,min:100,max:10000,description:'트랙 저장 수를 늘려드립니다. 저장이 많은 트랙은 스포티파이 개인화 추천 알고리즘에서 높은 점수를 받아 Discover Weekly 등 추천 플레이리스트에 포함될 가능성이 높아집니다.'},
      {id:'nv1',name:'네이버 블로그 방문자',pl:'naver',rate:1.00,min:100,max:10000,description:'네이버 블로그 일일 방문자를 늘려 블로그 지수를 높여드립니다. 방문자 수가 많을수록 네이버 검색 결과 상위 노출 가능성이 높아지며, 블로그 광고 수익도 증가합니다. 체험단, 원고료 제안을 받기 위한 기본 지표 확보에 효과적입니다.'},
      {id:'nv2',name:'네이버 블로그 좋아요',pl:'naver',rate:0.80,min:50,max:5000,description:'블로그 게시물 좋아요 수를 늘려드립니다. 좋아요가 많은 포스팅은 네이버 검색 알고리즘에서 좋은 콘텐츠로 평가받아 상위 노출 가능성이 높아집니다.'},
      {id:'nv3',name:'네이버 플레이스 저장',pl:'naver',rate:5.00,min:10,max:1000,description:'네이버 지도에서 플레이스 저장 수를 늘려드립니다. 저장이 많은 장소는 네이버 지도 검색 결과 상위에 노출되고, "저장 많은 맛집/카페" 추천 리스트에 포함될 가능성이 높아집니다. 로컬 비즈니스의 신규 고객 유입에 가장 직접적인 효과를 줍니다.'},
      {id:'nv4',name:'네이버 카페 회원',pl:'naver',rate:3.00,min:50,max:5000,description:'네이버 카페 회원 수를 늘려드립니다. 회원이 많은 카페는 네이버 검색 결과에서 더 잘 노출되며, 카페 활성도 지표가 올라가 기존 회원들의 참여도도 높아집니다.'},
      {id:'etc1',name:'Discord 서버 멤버',pl:'other',rate:2.00,min:100,max:50000,description:'디스코드 서버 멤버를 늘려 커뮤니티 규모와 신뢰도를 높여드립니다. 멤버가 많은 서버는 신규 참여자에게 활성화된 커뮤니티로 인식되어 자연 유입이 증가합니다. 게임, NFT, 크립토, 브랜드 커뮤니티 운영에 필수입니다.'},
      {id:'etc2',name:'YouTube Music 재생수',pl:'youtube',rate:0.50,min:1000,max:500000,description:'유튜브 뮤직 트랙의 재생수를 늘려드립니다. 유튜브 뮤직 차트 진입과 알고리즘 추천 플레이리스트 포함 가능성을 높여 아티스트 노출을 극대화합니다.'},
      {id:'etc3',name:'LinkedIn 팔로워',pl:'other',rate:3.00,min:50,max:10000,description:'링크드인 프로필 팔로워를 늘려 비즈니스 네트워크와 전문성을 강화해드립니다. 팔로워가 많은 프로필은 게시물 도달 범위가 넓어지고, 헤드헌터와 기업의 협업 제안을 더 많이 받게 됩니다. B2B 마케팅과 채용 브랜딩에 필수입니다.'},
      {id:'etc4',name:'Pinterest 팔로워',pl:'other',rate:1.50,min:100,max:20000,description:'핀터레스트 팔로워를 늘려드립니다. 팔로워가 많을수록 핀 노출 범위가 넓어지고, 쇼핑 기능과 연동하면 실제 구매 전환으로 이어집니다. 인테리어, 패션, 푸드, DIY 브랜드에 특히 효과적입니다.'},
      {id:'etc5',name:'Google 지도 리뷰 (별점 5점)',pl:'other',rate:20.00,min:5,max:100,description:'구글 지도 비즈니스에 긍정적인 5점 리뷰를 달아드립니다. 리뷰 수와 평점은 구글 로컬 검색 순위에 직접적인 영향을 주는 핵심 요소입니다. 리뷰가 많고 평점이 높은 비즈니스는 구글 맵 상단 노출과 함께 신규 고객의 신뢰와 방문을 유도합니다.'},
      // ── YouTube 추가 ──
      {id:'yt11',name:'YouTube 구독자 — 여성 타겟',pl:'youtube',rate:4.00,min:100,max:20000,description:'여성 시청자 비율이 높은 구독자입니다. 뷰티, 패션, 육아, 라이프스타일 채널에 최적화되어 있으며, 타겟 광고 수익과 협찬 단가를 높이는 데 효과적입니다.'},
      {id:'yt12',name:'YouTube 구독자 — 한국인',pl:'youtube',rate:6.00,min:50,max:10000,description:'국내 광고주와 협찬을 목표로 하는 채널에 필수인 한국인 구독자입니다. 국내 타겟 광고 RPM이 높으며 브랜드 협찬 단가 협상에 유리합니다.'},
      {id:'yt13',name:'YouTube 쇼츠 좋아요',pl:'youtube',rate:0.50,min:100,max:200000,description:'유튜브 쇼츠 영상의 좋아요를 늘려드립니다. 좋아요가 많은 쇼츠는 알고리즘이 더 많은 사람에게 배포하여 바이럴 가능성을 높입니다.'},
      {id:'yt14',name:'YouTube 멤버십 가입',pl:'youtube',rate:15.00,min:10,max:500,description:'유튜브 채널 멤버십 가입자를 늘려드립니다. 멤버십은 안정적인 월정액 수익원으로, 가입자가 많을수록 채널의 수익 안정성이 높아집니다.'},
      {id:'yt15',name:'YouTube 재생목록 조회수',pl:'youtube',rate:0.30,min:1000,max:2000000,description:'재생목록 전체 조회수를 늘려드립니다. 재생목록 조회수가 높으면 유튜브가 관련 영상들을 연속으로 추천하여 채널 전체 시청 시간이 증가합니다.'},
      {id:'yt16',name:'YouTube 공유 수',pl:'youtube',rate:2.00,min:50,max:20000,description:'영상 공유 수를 늘려드립니다. 공유는 유튜브 알고리즘에서 강력한 외부 트래픽 신호로 작용하여 추천 노출 가능성을 높입니다.'},
      {id:'yt17',name:'YouTube 채널 누적 조회수',pl:'youtube',rate:1.00,min:500,max:500000,description:'채널 전체 누적 조회수를 늘려드립니다. 총 조회수가 많은 채널은 광고주와 브랜드에게 신뢰감을 주어 협찬 제안을 더 많이 받습니다.'},
      // ── Instagram 추가 ──
      {id:'ig13',name:'Instagram 팔로워 — 남성 타겟',pl:'instagram',rate:3.50,min:50,max:20000,description:'남성 계정 중심의 팔로워로 스포츠, 자동차, 테크, 게임 계정에 최적화되어 있습니다. 남성 타겟 브랜드의 협찬 단가를 높이는 데 효과적입니다.'},
      {id:'ig14',name:'Instagram 팔로워 — 일본',pl:'instagram',rate:5.50,min:50,max:10000,description:'일본 기반 인스타그램 팔로워입니다. 일본 시장 진출이나 일본 브랜드 협찬을 목표로 하는 계정에 효과적이며, 일본 RPM은 아시아 최고 수준입니다.'},
      {id:'ig15',name:'Instagram 팔로워 — 유럽',pl:'instagram',rate:5.00,min:50,max:10000,description:'유럽(독일, 프랑스, 영국 등) 기반 팔로워입니다. 유럽 시장을 타겟으로 하는 브랜드와 협찬을 원하는 크리에이터에게 적합합니다.'},
      {id:'ig16',name:'Instagram 릴스 좋아요',pl:'instagram',rate:0.40,min:100,max:200000,description:'릴스 좋아요를 빠르게 늘려드립니다. 좋아요가 많은 릴스는 탐색 탭과 릴스 피드 상단에 노출되어 팔로워 급증 효과를 만들어냅니다.'},
      {id:'ig17',name:'Instagram 릴스 저장',pl:'instagram',rate:0.80,min:100,max:50000,description:'릴스 저장 수를 늘려드립니다. 저장이 많은 릴스는 인스타그램 알고리즘에서 가장 높은 가중치를 받아 장기적으로 지속 노출됩니다.'},
      {id:'ig18',name:'Instagram 프로필 방문',pl:'instagram',rate:0.30,min:500,max:500000,description:'프로필 방문 수를 늘려드립니다. 방문자가 많은 계정은 인스타그램 알고리즘이 더 많은 사람에게 추천합니다.'},
      // ── TikTok 추가 ──
      {id:'tt11',name:'TikTok 팔로워 — 한국인',pl:'tiktok',rate:5.00,min:50,max:10000,description:'한국인 틱톡 팔로워입니다. 국내 브랜드 협찬과 국내 마케팅을 목표로 하는 크리에이터에게 최적화되어 있습니다.'},
      {id:'tt12',name:'TikTok 팔로워 — 여성',pl:'tiktok',rate:4.00,min:50,max:20000,description:'여성 사용자 중심의 팔로워입니다. 뷰티, 패션, 댄스, 라이프스타일 콘텐츠에 특히 효과적이며 협찬 단가를 높여줍니다.'},
      {id:'tt13',name:'TikTok 즐겨찾기',pl:'tiktok',rate:1.20,min:100,max:50000,description:'틱톡 영상 즐겨찾기 수를 늘려드립니다. 즐겨찾기는 저장과 유사한 강력한 알고리즘 신호로 포유 탭 지속 노출에 도움이 됩니다.'},
      {id:'tt14',name:'TikTok 계정 방문 수',pl:'tiktok',rate:0.40,min:500,max:300000,description:'틱톡 계정 방문 수를 늘려드립니다. 방문이 많은 계정은 팔로워로 자연 전환되며, 알고리즘이 인기 계정으로 인식합니다.'},
      // ── 카카오 ──
      {id:'kk1',name:'카카오톡 채널 친구',pl:'kakao',rate:8.00,min:50,max:5000,description:'카카오톡 채널 친구(구독자)를 늘려드립니다. 친구가 많을수록 메시지 도달 범위가 넓어지고 카카오 광고 효율이 높아집니다. 국내 마케팅의 핵심 채널입니다.'},
      {id:'kk2',name:'카카오스토리 좋아요',pl:'kakao',rate:1.50,min:50,max:10000,description:'카카오스토리 게시물 좋아요를 늘려드립니다. 30~50대 주요 사용자층에게 효과적인 마케팅 채널로, 좋아요가 많은 게시물은 더 많이 노출됩니다.'},
      {id:'kk3',name:'카카오스토리 팔로워',pl:'kakao',rate:5.00,min:50,max:5000,description:'카카오스토리 팔로워를 늘려드립니다. 국내 30~50대 타겟 마케팅에 효과적인 플랫폼으로, 팔로워가 많을수록 콘텐츠 도달 범위가 넓어집니다.'},
      {id:'kk4',name:'카카오톡 오픈채팅 멤버',pl:'kakao',rate:6.00,min:50,max:3000,description:'카카오톡 오픈채팅방 멤버를 늘려드립니다. 멤버가 많은 채팅방은 카카오 검색에서 상위 노출되어 자연 유입이 증가합니다.'},
      {id:'kk5',name:'카카오맵 저장',pl:'kakao',rate:6.00,min:10,max:1000,description:'카카오맵 장소 저장 수를 늘려드립니다. 저장이 많은 장소는 카카오맵 검색 상위에 노출되며 로컬 비즈니스 신규 고객 유입에 효과적입니다.'},
      // ── 네이버 추가 ──
      {id:'nv5',name:'네이버 스마트스토어 찜',pl:'naver',rate:4.00,min:10,max:2000,description:'네이버 스마트스토어 찜(즐겨찾기) 수를 늘려드립니다. 찜이 많은 스토어는 네이버 쇼핑 검색 상위에 노출되며 구매 전환율이 높아집니다.'},
      {id:'nv6',name:'네이버 스마트스토어 리뷰 (5점)',pl:'naver',rate:20.00,min:5,max:200,description:'네이버 스마트스토어 구매 후기를 달아드립니다. 리뷰가 많고 평점이 높은 상품은 네이버 쇼핑 검색 상위에 노출되어 매출 증가로 이어집니다.'},
      {id:'nv7',name:'네이버 블로그 이웃 추가',pl:'naver',rate:3.00,min:50,max:3000,description:'네이버 블로그 이웃을 늘려드립니다. 이웃이 많으면 포스팅이 이웃 피드에 노출되어 방문자 수와 블로그 지수 향상에 도움이 됩니다.'},
      {id:'nv8',name:'네이버 카페 게시글 좋아요',pl:'naver',rate:1.00,min:50,max:3000,description:'네이버 카페 게시글 좋아요 수를 늘려드립니다. 인기 게시물은 카페 메인에 노출되어 추가 댓글과 조회수 증가로 이어집니다.'},
      {id:'nv9',name:'네이버 밴드 멤버',pl:'naver',rate:4.00,min:50,max:3000,description:'네이버 밴드 멤버를 늘려드립니다. 멤버가 많은 밴드는 네이버 검색에서 더 잘 노출되며 커뮤니티 활성도와 신뢰도가 높아집니다.'},
      // ── 트위치 ──
      {id:'tv1',name:'Twitch 팔로워',pl:'twitch',rate:2.50,min:100,max:50000,description:'트위치 채널 팔로워를 늘려드립니다. 팔로워가 많을수록 라이브 시작 시 더 많은 알림이 발송되고 트위치 파트너/어필리에이트 조건 달성에 도움이 됩니다.'},
      {id:'tv2',name:'Twitch 동시 시청자',pl:'twitch',rate:12.00,min:50,max:3000,description:'트위치 라이브 동시 시청자 수를 늘려드립니다. 시청자가 많은 채널은 트위치 디렉토리 상위에 노출되어 신규 시청자 유입이 증가합니다.'},
      {id:'tv3',name:'Twitch 클립 조회수',pl:'twitch',rate:0.50,min:500,max:100000,description:'트위치 클립 조회수를 늘려드립니다. 인기 클립은 트위치와 소셜미디어에서 바이럴되어 채널 홍보 효과를 만들어냅니다.'},
      // ── 구글/앱스토어 ──
      {id:'gg1',name:'Google 플레이스토어 다운로드',pl:'other',rate:5.00,min:100,max:10000,description:'구글 플레이스토어 앱 다운로드 수를 늘려드립니다. 다운로드가 많은 앱은 스토어 검색 상위에 노출되어 자연 다운로드가 증가합니다.'},
      {id:'gg2',name:'Google 플레이스토어 리뷰 (5점)',pl:'other',rate:20.00,min:5,max:200,description:'구글 플레이스토어 앱 리뷰를 달아드립니다. 좋은 리뷰와 높은 평점은 앱 스토어 검색 순위와 다운로드 전환율에 직접적인 영향을 줍니다.'},
      {id:'gg3',name:'App Store 리뷰 (5점)',pl:'other',rate:25.00,min:5,max:200,description:'애플 앱스토어 앱 리뷰를 달아드립니다. 앱스토어 평점은 다운로드 결정에 가장 큰 영향을 미치는 요소입니다.'},
      // ── SoundCloud ──
      {id:'sc1',name:'SoundCloud 재생수',pl:'other',rate:0.30,min:1000,max:500000,description:'사운드클라우드 트랙 재생수를 늘려드립니다. 재생수가 높은 트랙은 사운드클라우드 차트에 진입하여 신규 팬 유입이 증가합니다.'},
      {id:'sc2',name:'SoundCloud 팔로워',pl:'other',rate:2.00,min:100,max:10000,description:'사운드클라우드 팔로워를 늘려드립니다. 팔로워가 많은 아티스트는 신곡 발매 시 더 많은 초기 청취자를 확보할 수 있습니다.'},

      // ── 나라별 특화 팔로워 ──
      {id:'ct1',name:'Instagram 팔로워 — 인도',pl:'instagram',rate:1.00,min:100,max:100000,description:'인도 기반 인스타그램 팔로워입니다. 13억 인구의 인도 시장은 빠르게 성장하는 소셜미디어 시장으로, 저렴한 비용으로 대규모 팔로워 확보가 가능합니다.'},
      {id:'ct2',name:'Instagram 팔로워 — 중동/아랍',pl:'instagram',rate:3.00,min:100,max:50000,description:'사우디아라비아, UAE, 쿠웨이트 등 중동 아랍권 팔로워입니다. 구매력이 높은 중동 시장을 타겟으로 하는 브랜드와 럭셔리 제품 홍보에 효과적입니다.'},
      {id:'ct3',name:'Instagram 팔로워 — 동남아',pl:'instagram',rate:1.50,min:100,max:100000,description:'인도네시아, 태국, 베트남, 필리핀 등 동남아시아 팔로워입니다. 빠르게 성장하는 동남아 시장 진출과 쇼피, 라자다 등 이커머스 마케팅에 효과적입니다.'},
      {id:'ct4',name:'TikTok 팔로워 — 동남아',pl:'tiktok',rate:1.20,min:100,max:100000,description:'동남아시아 기반 틱톡 팔로워입니다. 틱톡 사용자 수 세계 최다인 동남아 시장을 공략할 수 있으며, 틱톡샵 연동 판매에도 효과적입니다.'},
      {id:'ct5',name:'YouTube 구독자 — 인도',pl:'youtube',rate:0.80,min:100,max:100000,description:'인도 기반 유튜브 구독자입니다. 인도는 유튜브 사용자 수 세계 1위 국가로, 저렴한 비용으로 빠르게 구독자를 늘릴 수 있습니다.'},
      {id:'ct6',name:'YouTube 구독자 — 중동',pl:'youtube',rate:3.00,min:100,max:20000,description:'중동 아랍권 유튜브 구독자입니다. 중동 광고 RPM은 세계 최고 수준으로, 중동 구독자 비율이 높으면 광고 수익이 크게 증가합니다.'},
      {id:'ct7',name:'Facebook 팔로워 — 동남아',pl:'facebook',rate:0.80,min:100,max:100000,description:'동남아시아 기반 페이스북 팔로워입니다. 페이스북 사용자가 가장 많은 동남아 시장을 공략하여 이커머스와 브랜드 마케팅에 활용하세요.'},
      {id:'ct8',name:'Twitter/X 팔로워 — 일본',pl:'twitter',rate:4.00,min:50,max:20000,description:'일본 기반 X(트위터) 팔로워입니다. 일본은 X 사용자 비율이 세계에서 가장 높은 국가 중 하나로, 일본 시장 마케팅에 필수적입니다.'},
      {id:'ct9',name:'Instagram 팔로워 — 터키',pl:'instagram',rate:2.00,min:100,max:50000,description:'터키 기반 인스타그램 팔로워입니다. 터키는 인스타그램 사용자 수 세계 상위권 국가로, 중동과 유럽을 잇는 교두보 시장입니다.'},
      {id:'ct10',name:'YouTube 조회수 — 아랍어권',pl:'youtube',rate:1.50,min:500,max:200000,description:'아랍어권 유튜브 조회수입니다. 아랍어 콘텐츠의 광고 RPM은 매우 높으며, 중동 시장을 타겟으로 하는 채널의 수익 극대화에 효과적입니다.'},

      // ── 아마존 ──
      {id:'az1',name:'Amazon 상품 리뷰 (별점 5점)',pl:'amazon',rate:30.00,min:3,max:100,description:'아마존 상품 페이지에 긍정적인 5점 리뷰를 달아드립니다. 아마존 알고리즘은 리뷰 수와 평점을 상품 검색 순위의 핵심 요소로 봅니다. 리뷰가 많고 평점이 높은 상품은 아마존 베스트셀러에 진입할 가능성이 높아집니다.'},
      {id:'az2',name:'Amazon 상품 찜 (Wishlist)',pl:'amazon',rate:5.00,min:10,max:1000,description:'아마존 상품 위시리스트 추가 수를 늘려드립니다. 위시리스트 추가가 많은 상품은 아마존 알고리즘이 인기 상품으로 인식하여 검색 노출을 높여줍니다.'},
      {id:'az3',name:'Amazon 상품 클릭 (트래픽)',pl:'amazon',rate:3.00,min:100,max:5000,description:'아마존 상품 페이지 방문 트래픽을 늘려드립니다. 클릭률이 높은 상품은 아마존 검색 알고리즘에서 높은 점수를 받아 자연 검색 상위 노출로 이어집니다.'},
      {id:'az4',name:'Amazon 셀러 피드백 (5점)',pl:'amazon',rate:25.00,min:3,max:100,description:'아마존 셀러 피드백 평점을 높여드립니다. 셀러 평점은 바이박스 경쟁과 상품 신뢰도에 직접적인 영향을 주는 핵심 지표입니다.'},

      // ── 알리익스프레스/중국 이커머스 ──
      {id:'ali1',name:'AliExpress 상품 리뷰',pl:'ecommerce',rate:15.00,min:5,max:200,description:'알리익스프레스 상품 리뷰를 달아드립니다. 리뷰가 많은 상품은 알리익스프레스 검색 상위에 노출되어 글로벌 구매자들의 신뢰를 얻습니다.'},
      {id:'ali2',name:'AliExpress 상품 주문 수',pl:'ecommerce',rate:8.00,min:10,max:500,description:'알리익스프레스 상품 주문 횟수를 늘려드립니다. 주문이 많은 상품은 알고리즘이 인기 상품으로 분류하여 검색 상위와 추천 섹션에 노출시킵니다.'},
      {id:'ali3',name:'Shopee 상품 좋아요',pl:'ecommerce',rate:3.00,min:50,max:5000,description:'쇼피 상품 좋아요 수를 늘려드립니다. 동남아 최대 이커머스 플랫폼인 쇼피에서 좋아요가 많은 상품은 검색 상위에 노출되어 판매량이 증가합니다.'},
      {id:'ali4',name:'Lazada 상품 리뷰',pl:'ecommerce',rate:15.00,min:5,max:200,description:'라자다 상품 리뷰를 달아드립니다. 동남아 주요 이커머스 라자다에서 리뷰가 많은 상품은 검색 상위 노출과 구매 전환율 향상에 효과적입니다.'},
      {id:'ali5',name:'Etsy 상품 리뷰 (5점)',pl:'ecommerce',rate:25.00,min:3,max:100,description:'엣시 상품 리뷰를 달아드립니다. 핸드메이드/빈티지 상품 전문 플랫폼 엣시에서 리뷰가 많은 상품은 검색 상위에 노출되어 글로벌 구매자 유입이 증가합니다.'},

      // ── 쿠팡/국내 이커머스 ──
      {id:'cp1',name:'쿠팡 상품 리뷰 (별점 5점)',pl:'coupang',rate:20.00,min:5,max:200,description:'쿠팡 상품 리뷰를 달아드립니다. 쿠팡 알고리즘은 리뷰 수와 평점을 검색 순위의 핵심 요소로 봅니다. 리뷰가 많은 상품은 쿠팡 로켓배송 섹션과 검색 상위에 노출될 가능성이 높아집니다.'},
      {id:'cp2',name:'쿠팡 상품 찜',pl:'coupang',rate:5.00,min:10,max:2000,description:'쿠팡 상품 찜 수를 늘려드립니다. 찜이 많은 상품은 쿠팡 알고리즘이 인기 상품으로 분류하여 메인 페이지와 추천 섹션에 노출시킵니다.'},
      {id:'cp3',name:'쿠팡 검색 클릭',pl:'coupang',rate:4.00,min:50,max:3000,description:'쿠팡 검색 결과에서 상품 클릭 수를 늘려드립니다. 클릭률이 높은 상품은 쿠팡 검색 알고리즘에서 상위 노출되어 자연 판매가 증가합니다.'},

      // ── 해외 플랫폼 추가 ──
      {id:'gl1',name:'Glassdoor 회사 리뷰 (5점)',pl:'other',rate:30.00,min:3,max:50,description:'글래스도어 회사 리뷰를 달아드립니다. 좋은 리뷰가 많은 회사는 우수 인재 채용에 유리하며, 기업 이미지와 브랜드 신뢰도가 향상됩니다.'},
      {id:'gl2',name:'Trustpilot 리뷰 (5점)',pl:'other',rate:25.00,min:3,max:100,description:'트러스트파일럿 비즈니스 리뷰를 달아드립니다. 글로벌 신뢰도 플랫폼인 트러스트파일럿 평점은 해외 고객의 구매 결정에 큰 영향을 줍니다.'},
      {id:'gl3',name:'Yelp 비즈니스 리뷰 (5점)',pl:'other',rate:25.00,min:3,max:100,description:'옐프 비즈니스 리뷰를 달아드립니다. 미국, 캐나다 로컬 비즈니스에 필수적인 플랫폼으로, 높은 평점은 신규 고객 유입을 크게 증가시킵니다.'},
      {id:'gl4',name:'Reddit 업보트',pl:'other',rate:2.00,min:50,max:10000,description:'레딧 게시물 업보트를 늘려드립니다. 업보트가 많은 게시물은 레딧 인기 탭에 노출되어 대규모 트래픽 유입 효과를 만들어냅니다.'},
      {id:'gl5',name:'Reddit 팔로워 (서브레딧)',pl:'other',rate:3.00,min:50,max:5000,description:'레딧 서브레딧 멤버를 늘려드립니다. 멤버가 많은 서브레딧은 레딧 검색에서 상위에 노출되어 커뮤니티 신뢰도가 높아집니다.'},

      // ── 구글/웹 트래픽 ──
      {id:'tr1',name:'구글 검색 트래픽 (SEO)',pl:'traffic',rate:5.00,min:100,max:10000,description:'특정 키워드로 구글 검색 후 웹사이트를 방문하는 트래픽입니다. 클릭률이 높아지면 구글이 해당 페이지를 인기 페이지로 인식하여 자연 검색 순위가 상승합니다. SEO 강화에 가장 효과적인 방법입니다.'},
      {id:'tr2',name:'웹사이트 직접 방문 트래픽',pl:'traffic',rate:2.00,min:500,max:50000,description:'웹사이트에 직접 방문 트래픽을 늘려드립니다. 방문자 수가 많을수록 구글 애널리틱스 지표가 개선되고, 광고 수익과 브랜드 신뢰도가 함께 향상됩니다.'},
      {id:'tr3',name:'구글 검색 순위 향상 (키워드)',pl:'traffic',rate:8.00,min:100,max:5000,description:'특정 키워드에 대한 구글 검색 클릭을 늘려 순위를 높여드립니다. 검색 상위 노출은 광고 없이도 지속적인 무료 트래픽을 가져다주는 가장 가치 있는 마케팅입니다.'},
      {id:'tr4',name:'유튜브 검색 트래픽',pl:'traffic',rate:3.00,min:200,max:10000,description:'유튜브 검색을 통한 영상 유입 트래픽을 늘려드립니다. 검색 유입이 많은 영상은 유튜브 SEO 점수가 높아져 장기적으로 상위 노출이 유지됩니다.'},
      {id:'tr5',name:'네이버 검색 트래픽',pl:'traffic',rate:4.00,min:100,max:5000,description:'네이버 검색을 통한 웹사이트/블로그 방문 트래픽입니다. 네이버 검색 유입이 많을수록 네이버 SEO 점수가 향상되어 블로그와 웹사이트의 자연 노출이 증가합니다.'},
      {id:'tr6',name:'인스타그램 프로필 트래픽',pl:'traffic',rate:2.00,min:500,max:20000,description:'인스타그램 프로필 방문 트래픽을 늘려드립니다. 프로필 방문이 많을수록 팔로워 전환율이 높아지고 인스타그램 알고리즘이 계정을 더 많이 추천합니다.'},

      // ── 앱스토어/모바일 ──
      {id:'app1',name:'iOS 앱스토어 다운로드',pl:'appstore',rate:8.00,min:50,max:5000,description:'애플 앱스토어 앱 다운로드 수를 늘려드립니다. 다운로드가 많은 앱은 앱스토어 검색 순위와 추천 섹션에 노출되어 자연 다운로드가 크게 증가합니다.'},
      {id:'app2',name:'iOS 앱스토어 리뷰 (5점)',pl:'appstore',rate:25.00,min:5,max:200,description:'애플 앱스토어 앱 리뷰를 달아드립니다. iOS 앱 평점은 다운로드 전환율에 가장 큰 영향을 미치며, 평점 4.5 이상 앱은 추천 섹션 진입 가능성이 높아집니다.'},
      {id:'app3',name:'Google Play 다운로드',pl:'appstore',rate:5.00,min:100,max:10000,description:'구글 플레이스토어 앱 다운로드 수를 늘려드립니다. 다운로드가 많은 앱은 플레이스토어 검색 상위에 노출되어 자연 다운로드와 수익이 증가합니다.'},
      {id:'app4',name:'Google Play 리뷰 (5점)',pl:'appstore',rate:20.00,min:5,max:200,description:'구글 플레이스토어 앱 리뷰를 달아드립니다. 좋은 리뷰와 높은 평점은 앱 검색 순위와 다운로드 전환율에 직접적인 영향을 줍니다.'},

      // ── 여행/숙박 ──
      {id:'tv4',name:'TripAdvisor 리뷰 (5점)',pl:'travel',rate:30.00,min:3,max:100,description:'트립어드바이저 비즈니스 리뷰를 달아드립니다. 글로벌 여행객들이 가장 많이 참고하는 플랫폼으로, 리뷰가 많고 평점이 높은 비즈니스는 트립어드바이저 검색 상위에 노출됩니다.'},
      {id:'tv5',name:'Airbnb 리뷰 (5점)',pl:'travel',rate:35.00,min:3,max:50,description:'에어비앤비 숙소 리뷰를 달아드립니다. 리뷰가 많고 평점이 높은 숙소는 에어비앤비 검색 상위에 노출되어 예약률과 수익이 크게 증가합니다.'},
      {id:'tv6',name:'Booking.com 리뷰',pl:'travel',rate:30.00,min:3,max:100,description:'부킹닷컴 숙소/호텔 리뷰를 달아드립니다. 글로벌 최대 숙박 예약 플랫폼에서 높은 평점은 노출 순위와 예약 전환율에 직접적인 영향을 줍니다.'},

      // ── 배달/음식 ──
      {id:'fd1',name:'배달의민족 리뷰 (5점)',pl:'delivery',rate:15.00,min:5,max:200,description:'배달의민족 가게 리뷰를 달아드립니다. 배민 알고리즘은 리뷰 수와 평점을 검색 순위의 핵심 요소로 봅니다. 리뷰가 많은 가게는 배민 검색 상위에 노출되어 주문이 증가합니다.'},
      {id:'fd2',name:'요기요 리뷰 (5점)',pl:'delivery',rate:15.00,min:5,max:200,description:'요기요 가게 리뷰를 달아드립니다. 리뷰가 많고 평점이 높은 가게는 요기요 검색 상위와 추천 섹션에 노출되어 자연 주문이 증가합니다.'},
      {id:'fd3',name:'쿠팡이츠 리뷰 (5점)',pl:'delivery',rate:15.00,min:5,max:200,description:'쿠팡이츠 가게 리뷰를 달아드립니다. 쿠팡이츠 알고리즘은 리뷰 수와 평점을 중요하게 반영하여 높은 평점 가게를 우선 노출합니다.'},
      {id:'fd4',name:'Uber Eats 리뷰 (5점)',pl:'delivery',rate:20.00,min:3,max:100,description:'우버이츠 가게 리뷰를 달아드립니다. 글로벌 배달 앱 우버이츠에서 높은 평점은 앱 내 검색 순위와 추천에 직접적인 영향을 줍니다.'},

      // ── 스팀/게임 ──
      {id:'gm1',name:'Steam 게임 리뷰 (긍정)',pl:'gaming',rate:20.00,min:5,max:200,description:'스팀 게임 긍정적 리뷰를 달아드립니다. 스팀 리뷰 점수는 게임 구매 전환율에 가장 큰 영향을 미칩니다. 긍정 리뷰가 많은 게임은 스팀 추천 알고리즘의 우선 노출을 받습니다.'},
      {id:'gm2',name:'Steam 위시리스트 추가',pl:'gaming',rate:3.00,min:50,max:5000,description:'스팀 게임 위시리스트 추가 수를 늘려드립니다. 위시리스트가 많은 게임은 스팀 알고리즘이 출시 시 더 많은 사람에게 알림을 보내 초기 판매량 극대화에 도움이 됩니다.'},
      {id:'gm3',name:'Twitch 팔로워',pl:'twitch',rate:2.50,min:100,max:50000,description:'트위치 채널 팔로워를 늘려드립니다. 팔로워가 많을수록 라이브 시작 시 더 많은 알림이 발송되고 트위치 파트너/어필리에이트 조건 달성에 도움이 됩니다.'},

      // ── 팟캐스트 ──
      {id:'pc1',name:'Spotify 팟캐스트 팔로워',pl:'spotify',rate:3.00,min:50,max:5000,description:'스포티파이 팟캐스트 팔로워를 늘려드립니다. 팔로워가 많은 팟캐스트는 스포티파이 추천 섹션에 노출되어 새 에피소드마다 더 많은 청취자를 확보합니다.'},
      {id:'pc2',name:'Apple Podcasts 리뷰 (5점)',pl:'appstore',rate:20.00,min:5,max:100,description:'애플 팟캐스트 리뷰를 달아드립니다. 리뷰가 많고 평점이 높은 팟캐스트는 애플 팟캐스트 차트 진입 가능성이 높아지고 신규 청취자 유입이 증가합니다.'},

      // ── LinkedIn 추가 ──
      {id:'li1',name:'LinkedIn 게시물 좋아요',pl:'other',rate:1.50,min:50,max:10000,description:'링크드인 게시물 좋아요를 늘려드립니다. 좋아요가 많은 게시물은 링크드인 피드 상단에 노출되어 더 많은 비즈니스 관계자에게 도달합니다.'},
      {id:'li2',name:'LinkedIn 게시물 댓글',pl:'other',rate:8.00,min:10,max:300,description:'링크드인 게시물 댓글을 달아드립니다. 댓글이 많은 게시물은 링크드인 알고리즘이 높은 참여도로 인식하여 더 많이 노출합니다. B2B 마케팅과 채용 브랜딩에 효과적입니다.'},
      {id:'li3',name:'LinkedIn 연결 (1촌)',pl:'other',rate:5.00,min:50,max:1000,description:'링크드인 1촌 연결을 늘려드립니다. 연결이 많을수록 게시물 도달 범위가 넓어지고 헤드헌터와 비즈니스 파트너에게 노출될 기회가 증가합니다.'},

      // ── Pinterest 추가 ──
      {id:'pt1',name:'Pinterest 핀 저장 (리핀)',pl:'other',rate:1.00,min:100,max:50000,description:'핀터레스트 핀 저장 수를 늘려드립니다. 저장이 많은 핀은 핀터레스트 검색 상위에 노출되고 스마트 피드에서 더 많이 추천됩니다. 쇼핑 연동 시 실제 구매로 이어집니다.'},
      {id:'pt2',name:'Pinterest 보드 팔로워',pl:'other',rate:2.00,min:50,max:10000,description:'핀터레스트 보드 팔로워를 늘려드립니다. 보드 팔로워가 많을수록 새 핀이 더 많은 사람에게 노출되어 자연적인 저장과 트래픽이 증가합니다.'},
    ];
    for (const s of svcs) {
      await query(`INSERT INTO services(id,name,pl,rate,min,max,description,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, pl=EXCLUDED.pl, rate=EXCLUDED.rate, min=EXCLUDED.min, max=EXCLUDED.max`,
        [s.id, s.name, s.pl, s.rate, s.min, s.max, s.description||'', 1]);
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
    const siteMg = site ? site.margin : 50;
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
    const r = await query(`SELECT * FROM services WHERE active=1 ORDER BY id`);
    const isPartner = req.session && req.session.role === 'partner';
    res.json(r.rows.map(s => {
      const originalCost = Math.round(s.rate / 1000 * ex); // 원가(₩/1개)
      const supplyCost = Math.round(s.rate / 1000 * ex * (1 + superMg / 100)); // 공급가
      const sellPrice = Math.round(supplyCost * (1 + siteMg / 100)); // 고객가
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
    const siteMg = site ? site.margin : 50;
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
      bank: site?.bank || '', margin: site?.margin || 50,
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
      const bgTypes = ['dark','light','mid'];
      const bgType = bgTypes[Math.floor(rnd() * bgTypes.length)];
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
        parseFloat(margin||50), parseFloat(exrate||1380), parseFloat(credit||0), superMarginVal, autoTheme]);
    const hash = bcrypt.hashSync(adminPw, 10);
    const adminRole = req.body.adminRole || 'admin';
    await query(`INSERT INTO users(id,site_id,name,email,pw,role,balance) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      ['admin_'+siteId, siteId, '관리자', adminEmail, hash, adminRole, 0]);
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
  if (n.includes('naver')) return 'naver';
  if (n.includes('kakao')) return 'kakao';
  if (n.includes('twitch')) return 'twitch';
  if (n.includes('amazon')) return 'amazon';
  if (n.includes('shopee') || n.includes('lazada') || n.includes('aliexpress') || n.includes('etsy')) return 'ecommerce';
  if (n.includes('coupang') || n.includes('쿠팡')) return 'coupang';
  if (n.includes('트래픽') || n.includes('traffic') || n.includes('seo') || n.includes('검색 트래픽')) return 'traffic';
  if (n.includes('앱스토어') || n.includes('appstore') || n.includes('play') || n.includes('ios') || n.includes('팟캐스트')) return 'appstore';
  if (n.includes('tripadvisor') || n.includes('airbnb') || n.includes('booking') || n.includes('여행') || n.includes('숙박')) return 'travel';
  if (n.includes('배달') || n.includes('요기요') || n.includes('uber eats')) return 'delivery';
  if (n.includes('steam') || n.includes('스팀') || n.includes('게임')) return 'gaming';
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
