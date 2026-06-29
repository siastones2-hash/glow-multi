/**
 * 히즈마케팅 홍보용 쇼케이스 (DISPLAY ONLY)
 *
 * - 관리자 화면(대시보드·주문·충전·수익)에만 표시 숫자/목록을 덮어씀
 * - DB INSERT/UPDATE 없음 · 정산·크레딧·실주문·텔레그램·슈퍼 전체 집계 무관
 * - GLOW 본사(default) 슈퍼관리자 전체 보기만 제외
 */

const SHOWCASE = {
  users: 1066,
  orders: 8956,
  pendingCharges: 23,
  revenue: 116425221,
  cost: 81497654,
  profit: 34927567,
  revenueToday: 4286500,
  revenueMonth: 116425221,
  revenueCustomerOrders: 8720,
};

const SITE_NAMES = new Set(['히즈마케팅']);
const SITE_DOMAINS = new Set(['hismarketing.ai.kr']);

function isHismarketingSite(site) {
  if (!site || site.id === 'default') return false;
  const domain = String(site.domain || '').replace(/^www\./i, '').toLowerCase();
  return SITE_NAMES.has(site.name) || SITE_DOMAINS.has(domain);
}

/** 파트너 관리자 화면에만 쇼케이스 적용 (본사 슈퍼 전체 집계 제외) */
function isHismarketingShowcaseRequest(req) {
  if (!isHismarketingSite(req.site)) return false;
  if (req.session?.role === 'superadmin' && req.site?.id === 'default') return false;
  return true;
}

function getShowcaseStats() {
  return {
    users: SHOWCASE.users,
    orders: SHOWCASE.orders,
    pendingCharges: SHOWCASE.pendingCharges,
    revenue: SHOWCASE.revenue,
    cost: SHOWCASE.cost,
    profit: SHOWCASE.profit,
    displayShowcase: true,
    showcaseRevenue: {
      today: SHOWCASE.revenueToday,
      month: SHOWCASE.revenueMonth,
      total: SHOWCASE.revenue,
      customerOrders: SHOWCASE.revenueCustomerOrders,
    },
  };
}

function daysAgoIso(days, hour = 14) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, Math.floor(Math.random() * 50) + 5, 0, 0);
  return d.toISOString();
}

const ORDER_SAMPLES = [
  { uname: '마케팅킹', sname: 'Instagram 팔로워 — 프리미엄 글로벌', charge: 186500, qty: 5000, status: 'completed' },
  { uname: '브랜드랩', sname: 'YouTube 조회수 — 프리미엄 글로벌', charge: 92400, qty: 50000, status: 'completed' },
  { uname: '콘텐츠메이커', sname: 'TikTok 조회수 — 브라질 타겟', charge: 45800, qty: 100000, status: 'completed' },
  { uname: '인플루언서A', sname: 'Instagram 릴스 조회수', charge: 67200, qty: 20000, status: 'completed' },
  { uname: '스타트업B', sname: 'YouTube 구독자 — 프리미엄', charge: 245000, qty: 500, status: 'completed' },
  { uname: '셀럽샵', sname: 'Instagram 좋아요 — 한국 타겟', charge: 38900, qty: 3000, status: 'completed' },
  { uname: '미디어팀', sname: 'TikTok 팔로워 — 브라질 타겟', charge: 156000, qty: 10000, status: 'processing' },
  { uname: '광고대행', sname: 'Facebook 좋아요 — 브라질 타겟', charge: 52800, qty: 500, status: 'completed' },
  { uname: '유튜버C', sname: 'YouTube 쇼츠 조회수 — 프리미엄', charge: 71400, qty: 40000, status: 'completed' },
  { uname: '틱톡크리에이터', sname: 'TikTok 좋아요 — 프리미엄 글로벌', charge: 22100, qty: 5000, status: 'completed' },
  { uname: '디지털마케팅', sname: 'Instagram 저장 — 프리미엄 글로벌', charge: 19800, qty: 2000, status: 'completed' },
  { uname: '브랜드공식', sname: 'Threads 팔로워 — 프리미엄', charge: 87500, qty: 2500, status: 'completed' },
  { uname: '쇼핑몰D', sname: 'Instagram 팔로워 — 브라질 타겟', charge: 132000, qty: 8000, status: 'completed' },
  { uname: '영상제작소', sname: 'YouTube 좋아요 — 프리미엄 글로벌', charge: 15600, qty: 500, status: 'completed' },
  { uname: 'SNS전문가', sname: 'TikTok 공유 — 프리미엄 글로벌', charge: 8900, qty: 1000, status: 'processing' },
  { uname: '라이브커머스', sname: 'Instagram 스토리 조회수', charge: 44500, qty: 3000, status: 'completed' },
  { uname: '퍼포먼스팀', sname: 'YouTube 조회수 — 리얼 네이티브', charge: 318000, qty: 200000, status: 'completed' },
  { uname: '글로벌브랜드', sname: 'Instagram 팔로워 — 미국 타겟', charge: 278000, qty: 4000, status: 'completed' },
];

function getShowcaseOrders() {
  return ORDER_SAMPLES.map((row, i) => ({
    id: `SHOW_HIZ_${i}`,
    site_id: 'showcase',
    uid: `showcase_u_${i}`,
    uname: row.uname,
    sid: 'showcase',
    sname: row.sname,
    pl: 'instagram',
    link: 'https://example.com/showcase',
    qty: row.qty,
    charge: row.charge,
    cost: 0,
    status: row.status,
    created: daysAgoIso(i % 28, 9 + (i % 10)),
    user_role: 'user',
    paid: 1,
    starts_count: row.status === 'completed' ? 1200 : 800,
    remains: row.status === 'processing' ? Math.floor(row.qty * 0.35) : 0,
  }));
}

const CHARGE_AMOUNTS = [50000, 100000, 30000, 200000, 80000, 150000, 45000, 120000, 250000, 60000,
  90000, 35000, 180000, 70000, 110000, 40000, 95000, 130000, 55000, 220000, 85000, 65000, 175000];

function getShowcaseCharges() {
  return CHARGE_AMOUNTS.map((amount, i) => ({
    id: `SHOW_HIZ_CHG_${i}`,
    site_id: 'showcase',
    uid: `showcase_chg_${i}`,
    uname: ['김○○', '이○○', '박○○', '최○○', '정○○', '강○○', '윤○○', '장○○', '임○○', '한○○',
      '오○○', '서○○', '신○○', '권○○', '황○○', '안○○', '송○○', '류○○', '홍○○', '문○○',
      '양○○', '조○○', '배○○'][i] || '회원',
    amount,
    note: i % 3 === 0 ? '사업자 입금' : (i % 3 === 1 ? '충전 요청' : ''),
    status: 'pending',
    created: daysAgoIso(i % 5, 11),
  }));
}

function isShowcaseId(id) {
  return String(id || '').startsWith('SHOW_HIZ');
}

module.exports = {
  SHOWCASE,
  isHismarketingSite,
  isHismarketingShowcaseRequest,
  getShowcaseStats,
  getShowcaseOrders,
  getShowcaseCharges,
  isShowcaseId,
};
