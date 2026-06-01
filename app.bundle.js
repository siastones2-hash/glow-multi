// ═══════════════════════════════════════════════════════════
// FRANCHAIN v5.5 — 마케팅 관제 플랫폼
// Part 1: API + 데이터 + 유틸
// ═══════════════════════════════════════════════════════════
const {
  useState,
  useEffect,
  useMemo,
  useRef
} = React;
const API_BASE = null;
const SB_URL = "https://rfpsrldxnwucjfejvoxh.supabase.co";
const SB_KEY = "sb_publishable_DhhESQtrbdgi_nFGOuvS-Q_yTo-DD4X";

// Supabase REST API 헬퍼
const sbFetch = async (path, opts = {}) => {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      "apikey": SB_KEY,
      "Authorization": "Bearer " + SB_KEY,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...(opts.headers || {})
    }
  });
  if (!res.ok) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

// 매장 데이터 저장
const sbSaveStore = async s => {
  await sbFetch(`store_data?store_id=eq.${s.id}`, {
    method: "DELETE"
  });
  await sbFetch("store_data", {
    method: "POST",
    body: JSON.stringify({
      store_id: s.id,
      channels: s.channels || {},
      keyword_rank: s.keywordRank || 0,
      receipt_age: s.receiptReviewAge || 99,
      external_signal: s.externalSignal || 0,
      sales: s.sales || 0,
      updated_at: new Date().toISOString()
    })
  });
};

// 매장 데이터 불러오기
const sbLoadStores = async () => {
  const rows = await sbFetch("store_data?select=*");
  if (!rows?.length) return null;
  return rows;
};
let _dailyCache = null;
let _dailyFetch = null;
/** daily.json 단일 로드 (캐시·타임아웃 없음 — 전 매장 순위 공통) */
const fetchDailyJson = () => {
  if (_dailyCache) return Promise.resolve(_dailyCache);
  if (_dailyFetch) return _dailyFetch;
  _dailyFetch = fetch(new URL("data/daily.json", location.href).href).then(r => r.ok ? r.json() : null).then(d => {
    _dailyCache = d || null;
    return _dailyCache;
  }).catch(() => null).finally(() => {
    _dailyFetch = null;
  });
  return _dailyFetch;
};
const dailyRowForStore = (daily, s) => {
  if (!daily?.stores?.length || !s) return null;
  return daily.stores.find(x => x.place_id === s.placeId || x.franchain_store_id === s.id || x.store_id === s.id || x.store_id === "franchain_" + s.id) || null;
};
const api = {
  getStores: async () => {
    // Supabase에서 저장된 데이터 불러와서 SD에 합치기
    try {
      const rows = await sbLoadStores();
      if (rows) {
        return SD.map(s => {
          const row = rows.find(r => r.store_id === s.id);
          if (!row) return s;
          const ch = {
            ...(row.channels || s.channels)
          };
          const naver = ch._naver;
          if (naver) {
            delete ch._naver;
            ["blog", "receipt"].forEach(k => {
              if (ch[k] && naver.totals && naver.totals[k] != null) {
                ch[k] = {
                  ...ch[k],
                  month: naver.totals[k],
                  today: ch[k].today ?? 0,
                  week: ch[k].week ?? 0
                };
              }
            });
          }
          return {
            ...s,
            channels: ch,
            naverSync: naver || null,
            keywordRank: row.keyword_rank ?? s.keywordRank,
            receiptReviewAge: row.receipt_age ?? s.receiptReviewAge,
            externalSignal: row.external_signal ?? s.externalSignal,
            sales: row.sales ?? s.sales,
            lastSynced: naver?.synced_at || null
          };
        });
      }
    } catch (e) {}
    return SD;
  },
  getNotice: async () => {
    if (API_BASE) return (await fetch(`${API_BASE}/api/notice`)).json();
    const s = localStorage.getItem("hq_v55");
    return s ? JSON.parse(s) : null;
  },
  saveNotice: async n => {
    if (API_BASE) await fetch(`${API_BASE}/api/notice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(n)
    });
    n ? localStorage.setItem("hq_v55", JSON.stringify(n)) : localStorage.removeItem("hq_v55");
  },
  autoSync: (ext, set) => {
    if (!ext?.length) return;
    set(p => p.map(s => {
      const e = ext.find(d => d.storeId === s.id);
      if (!e) return s;
      const updated = {
        ...s,
        ...e,
        lastSynced: new Date().toLocaleTimeString("ko-KR", {
          hour: "2-digit",
          minute: "2-digit"
        })
      };
      // 순위 변동 로그 자동 생성
      const oldRank = s.keywordRank || 99;
      const newRank = e.keywordRank || oldRank;
      const diff = oldRank - newRank;
      const today = new Date().toLocaleDateString("ko-KR", {
        month: "numeric",
        day: "numeric"
      });
      let newLog = [...(s.rankLog || [])];
      if (diff !== 0) {
        newLog.unshift({
          date: today,
          event: "autoSync 데이터 갱신",
          rankChange: diff,
          detail: diff > 0 ? `키워드 순위 ${diff}계단 상승 (${oldRank}위→${newRank}위)` : `키워드 순위 ${Math.abs(diff)}계단 하락 (${oldRank}위→${newRank}위)`
        });
        newLog = newLog.slice(0, 10);
      }
      return rc({
        ...updated,
        rankLog: newLog
      });
    }));
  }
};

// ─── 채널: 네이버 플레이스 자동 + 별도(점주 입력) ─────────
const NAVER_AUTO_CH = ["blog", "visitor", "receipt"];
const MANUAL_CH = ["insta", "youtube", "cafe"];
const CH_KEYS = [...NAVER_AUTO_CH, ...MANUAL_CH];
const CH_INFO = {
  blog: {
    label: "블로그",
    icon: "📝",
    color: "#f59e0b",
    auto: true
  },
  visitor: {
    label: "방문리뷰",
    icon: "👣",
    color: "#818cf8",
    auto: true
  },
  receipt: {
    label: "영수증",
    icon: "⭐",
    color: "#10b981",
    auto: true
  },
  insta: {
    label: "인스타",
    icon: "📸",
    color: "#c084fc",
    auto: false
  },
  youtube: {
    label: "유튜브",
    icon: "🎬",
    color: "#ef4444",
    auto: false
  },
  cafe: {
    label: "네이버카페",
    icon: "☕",
    color: "#60a5fa",
    auto: false
  }
};
const chSourceSub = (k, ch) => ch?.count_source === "place_header" || ch?.count_source === "receipt_tab" ? "플레이스 실측" : CH_INFO[k]?.auto ? "플레이스 실측" : ch?.source === "manual" ? "점주 입력" : "미연동";
const mkCh = (today = 0, week = 0, month = 0) => ({
  today,
  week,
  month
});

// ─── 21개 실제 매장 데이터 ──────────────────────────────
const SD = [{
  id: "s1",
  name: "소림사 마곡점",
  region: "서울 강서구 마곡동",
  type: "역세권",
  phone: "070-7525-0898",
  placeId: "2075084311",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 3,
  keywordTarget: "마곡 소금빵",
  receiptReviewAge: 5,
  receiptReviewCount: 12,
  keywordReviews: {
    "소금빵": 8,
    "디저트": 2,
    "카페": 5,
    "소큰빵": 3
  },
  externalSignal: 15,
  peakReviews: 2,
  channels: {
    blog: mkCh(1, 4, 14),
    insta: mkCh(1, 3, 12),
    youtube: mkCh(0, 1, 3),
    receipt: mkCh(2, 12, 44),
    cafe: mkCh(0, 2, 7)
  },
  rankLog: [{
    date: "4/3",
    event: "블로그 4건 발행",
    rankChange: 2,
    detail: "블로그 4건 발행 → 키워드 순위 2계단 상승 (5위→3위)"
  }, {
    date: "4/1",
    event: "영수증리뷰 공백",
    rankChange: -1,
    detail: "영수증리뷰 공백 24h → 순위 1계단 하락 (4위→5위)"
  }],
  history: [{
    m: "2월",
    v: -2
  }, {
    m: "3월",
    v: 3
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s2",
  name: "소림사 다산점",
  region: "남양주 다산동",
  type: "주거",
  phone: "0507-1394-7901",
  placeId: "1965307586",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 22,
  keywordTarget: "다산 카페",
  receiptReviewAge: 38,
  receiptReviewCount: 1,
  keywordReviews: {
    "소금빵": 2,
    "디저트": 1,
    "카페": 0,
    "소큰빵": 0
  },
  externalSignal: -8,
  peakReviews: 0,
  channels: {
    blog: mkCh(0, 1, 3),
    insta: mkCh(0, 1, 4),
    youtube: mkCh(0, 0, 0),
    receipt: mkCh(0, 1, 5),
    cafe: mkCh(0, 0, 1)
  },
  rankLog: [{
    date: "4/5",
    event: "영수증리뷰 공백",
    rankChange: -2,
    detail: "영수증리뷰 36h 공백 → 순위 2계단 하락 (20위→22위)"
  }, {
    date: "3/28",
    event: "인스타 업로드",
    rankChange: 1,
    detail: "인스타 3건 업로드 → 외부신호 개선, 순위 1계단 상승"
  }],
  history: [{
    m: "2월",
    v: -5
  }, {
    m: "3월",
    v: -3
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s3",
  name: "소림사 역삼점",
  region: "서울 강남구 역삼동",
  type: "오피스",
  phone: "02-553-1112",
  placeId: "2063243598",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 8,
  keywordTarget: "역삼 소금빵",
  receiptReviewAge: 14,
  receiptReviewCount: 5,
  keywordReviews: {
    "소금빵": 5,
    "디저트": 4,
    "카페": 2,
    "소큰빵": 1
  },
  externalSignal: 3,
  peakReviews: 1,
  channels: {
    blog: mkCh(0, 2, 8),
    insta: mkCh(0, 2, 7),
    youtube: mkCh(0, 0, 1),
    receipt: mkCh(1, 5, 19),
    cafe: mkCh(0, 1, 4)
  },
  rankLog: [{
    date: "4/4",
    event: "블로그 2건 발행",
    rankChange: 1,
    detail: "블로그 2건 발행 → 순위 1계단 상승 (9위→8위)"
  }],
  history: [{
    m: "2월",
    v: 3
  }, {
    m: "3월",
    v: 5
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s4",
  name: "소림사 강남역점",
  region: "서울 강남구 역삼동",
  type: "역세권",
  phone: "0507-1453-7226",
  placeId: "2091043530",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 2,
  keywordTarget: "강남역 소금빵",
  receiptReviewAge: 2,
  receiptReviewCount: 21,
  keywordReviews: {
    "소금빵": 15,
    "디저트": 8,
    "카페": 9,
    "소큰빵": 7
  },
  externalSignal: 42,
  peakReviews: 4,
  channels: {
    blog: mkCh(2, 9, 35),
    insta: mkCh(1, 4, 15),
    youtube: mkCh(0, 1, 4),
    receipt: mkCh(4, 21, 78),
    cafe: mkCh(1, 5, 18)
  },
  rankLog: [{
    date: "4/5",
    event: "블로그+영수증 동시",
    rankChange: 3,
    detail: "블로그 9건+영수증리뷰 21건 → 순위 3계단 상승 (5위→2위)"
  }, {
    date: "3/30",
    event: "유튜브 1건 발행",
    rankChange: 1,
    detail: "유튜브 리뷰 영상 1건 → 외부신호 급증, 순위 상승"
  }],
  history: [{
    m: "2월",
    v: 8
  }, {
    m: "3월",
    v: 12
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s5",
  name: "소림사 고투몰점",
  region: "서울 서초구 잠원동",
  type: "쇼핑몰",
  phone: "0507-1367-7489",
  placeId: "2040615154",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 15,
  keywordTarget: "잠원 카페",
  receiptReviewAge: 27,
  receiptReviewCount: 3,
  keywordReviews: {
    "소금빵": 2,
    "디저트": 1,
    "카페": 0,
    "소큰빵": 0
  },
  externalSignal: -5,
  peakReviews: 0,
  channels: {
    blog: mkCh(0, 1, 4),
    insta: mkCh(0, 1, 5),
    youtube: mkCh(0, 0, 0),
    receipt: mkCh(0, 3, 11),
    cafe: mkCh(0, 1, 2)
  },
  rankLog: [{
    date: "4/3",
    event: "영수증리뷰 공백",
    rankChange: -1,
    detail: "영수증리뷰 공백 24h+ → 순위 1계단 하락"
  }],
  history: [{
    m: "2월",
    v: -8
  }, {
    m: "3월",
    v: -5
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s6",
  name: "소림사 범계점",
  region: "안양 동안구 호계동",
  type: "역세권",
  phone: "0507-1417-2256",
  placeId: "2065663074",
  matjibKeyword: "범계 맛집",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 0,
  keywordTarget: "범계 맛집",
  receiptReviewAge: 99,
  receiptReviewCount: 0,
  keywordReviews: {
    "소금빵": 3,
    "디저트": 1,
    "카페": 2,
    "소큰빵": 1
  },
  externalSignal: 0,
  peakReviews: 1,
  channels: {
    blog: mkCh(0, 2, 6),
    insta: mkCh(0, 2, 6),
    youtube: mkCh(0, 0, 1),
    receipt: mkCh(1, 4, 16),
    cafe: mkCh(0, 1, 3)
  },
  rankLog: [{
    date: "4/2",
    event: "블로그 2건",
    rankChange: 1,
    detail: "블로그 2건 발행 → 순위 1계단 상승 (12위→11위)"
  }],
  history: [{
    m: "2월",
    v: 2
  }, {
    m: "3월",
    v: 4
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s7",
  name: "소림사 천호점",
  region: "서울 강동구 천호동",
  type: "역세권",
  phone: "0507-1385-5863",
  placeId: "2044613400",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 5,
  keywordTarget: "천호 소금빵",
  receiptReviewAge: 9,
  receiptReviewCount: 8,
  keywordReviews: {
    "소금빵": 7,
    "디저트": 3,
    "카페": 4,
    "소큰빵": 2
  },
  externalSignal: 12,
  peakReviews: 2,
  channels: {
    blog: mkCh(1, 5, 19),
    insta: mkCh(1, 3, 11),
    youtube: mkCh(0, 1, 2),
    receipt: mkCh(2, 8, 30),
    cafe: mkCh(0, 3, 9)
  },
  rankLog: [{
    date: "4/4",
    event: "인스타+블로그",
    rankChange: 2,
    detail: "인스타 3건+블로그 5건 → 외부신호 +12%, 순위 2계단 상승"
  }],
  history: [{
    m: "2월",
    v: 5
  }, {
    m: "3월",
    v: 7
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s8",
  name: "소림사 광명점",
  region: "광명 소하동",
  type: "주거",
  phone: "0507-1410-3313",
  placeId: "2058641947",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 31,
  keywordTarget: "광명 소금빵",
  receiptReviewAge: 52,
  receiptReviewCount: 0,
  keywordReviews: {
    "소금빵": 1,
    "디저트": 0,
    "카페": 0,
    "소큰빵": 0
  },
  externalSignal: -18,
  peakReviews: 0,
  channels: {
    blog: mkCh(0, 0, 1),
    insta: mkCh(0, 0, 2),
    youtube: mkCh(0, 0, 0),
    receipt: mkCh(0, 0, 2),
    cafe: mkCh(0, 0, 0)
  },
  rankLog: [{
    date: "4/5",
    event: "영수증리뷰 52h 공백",
    rankChange: -4,
    detail: "영수증리뷰 52h 공백+블로그 0건 → 순위 4계단 급락 (27위→31위)"
  }, {
    date: "3/25",
    event: "채널 전체 비활성",
    rankChange: -3,
    detail: "5대 채널 모두 활동 없음 → 외부신호 -18%, 순위 하락"
  }],
  history: [{
    m: "2월",
    v: -12
  }, {
    m: "3월",
    v: -9
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s9",
  name: "소림사 문정점",
  region: "서울 송파구 문정동",
  type: "오피스",
  phone: "02-3400-0965",
  placeId: "2030163460",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 9,
  keywordTarget: "문정 소금빵",
  receiptReviewAge: 20,
  receiptReviewCount: 5,
  keywordReviews: {
    "소금빵": 4,
    "디저트": 2,
    "카페": 2,
    "소큰빵": 1
  },
  externalSignal: 6,
  peakReviews: 1,
  channels: {
    blog: mkCh(0, 2, 9),
    insta: mkCh(0, 2, 8),
    youtube: mkCh(0, 0, 1),
    receipt: mkCh(1, 5, 20),
    cafe: mkCh(0, 2, 5)
  },
  rankLog: [{
    date: "4/3",
    event: "블로그 2건",
    rankChange: 1,
    detail: "블로그 2건+영수증리뷰 5건 → 순위 1계단 상승"
  }],
  history: [{
    m: "2월",
    v: 1
  }, {
    m: "3월",
    v: 3
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s10",
  name: "소림사 신림점",
  region: "서울 관악구 신림동",
  type: "대학가",
  phone: "02-6407-0001",
  placeId: "1760695984",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 28,
  keywordTarget: "신림 카페",
  receiptReviewAge: 44,
  receiptReviewCount: 1,
  keywordReviews: {
    "소금빵": 1,
    "디저트": 0,
    "카페": 0,
    "소큰빵": 0
  },
  externalSignal: -22,
  peakReviews: 0,
  channels: {
    blog: mkCh(0, 0, 2),
    insta: mkCh(0, 1, 3),
    youtube: mkCh(0, 0, 0),
    receipt: mkCh(0, 1, 4),
    cafe: mkCh(0, 0, 1)
  },
  rankLog: [{
    date: "4/4",
    event: "채널 비활성",
    rankChange: -3,
    detail: "블로그/영수증 모두 0건 → 순위 3계단 하락 (25위→28위)"
  }],
  history: [{
    m: "2월",
    v: -15
  }, {
    m: "3월",
    v: -10
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s11",
  name: "카페 소림사",
  region: "고양 덕양구 성사동",
  type: "역세권+주거",
  phone: "0507-1364-9920",
  placeId: "1935501245",
  matjibKeyword: "원당 맛집",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 1,
  keywordTarget: "원당 카페",
  receiptReviewAge: 3,
  receiptReviewCount: 18,
  keywordReviews: {
    "소금빵": 12,
    "디저트": 7,
    "카페": 8,
    "소큰빵": 5
  },
  externalSignal: 55,
  peakReviews: 5,
  channels: {
    blog: mkCh(2, 12, 48),
    insta: mkCh(2, 6, 22),
    youtube: mkCh(1, 3, 9),
    receipt: mkCh(5, 18, 67),
    cafe: mkCh(1, 6, 22)
  },
  rankLog: [{
    date: "4/5",
    event: "전채널 풀가동",
    rankChange: 0,
    detail: "5대 채널 모두 최고 활동량 → 1위 유지"
  }, {
    date: "4/1",
    event: "유튜브 3건 발행",
    rankChange: 1,
    detail: "유튜브 리뷰 3건 → 외부신호 +55%, 1위 달성"
  }],
  history: [{
    m: "2월",
    v: 9
  }, {
    m: "3월",
    v: 14
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s12",
  name: "소림사 위례",
  region: "성남 수정구 창곡동",
  type: "주거(신도시)",
  phone: "031-602-7200",
  placeId: "2046052601",
  matjibKeyword: "위례 맛집",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 7,
  keywordTarget: "위례 소금빵",
  receiptReviewAge: 12,
  receiptReviewCount: 6,
  keywordReviews: {
    "소금빵": 5,
    "디저트": 3,
    "카페": 3,
    "소큰빵": 2
  },
  externalSignal: 8,
  peakReviews: 2,
  channels: {
    blog: mkCh(1, 4, 16),
    insta: mkCh(1, 3, 10),
    youtube: mkCh(0, 1, 2),
    receipt: mkCh(2, 6, 24),
    cafe: mkCh(0, 2, 7)
  },
  rankLog: [{
    date: "4/3",
    event: "블로그+인스타",
    rankChange: 2,
    detail: "블로그 4건+인스타 3건 → 순위 2계단 상승 (9위→7위)"
  }],
  history: [{
    m: "2월",
    v: 4
  }, {
    m: "3월",
    v: 6
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s14",
  name: "소림사 수내역점",
  region: "성남 분당구 수내동",
  type: "역세권",
  phone: "0507-1432-1738",
  placeId: "2015714126",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 2,
  keywordTarget: "수내 소금빵",
  receiptReviewAge: 4,
  receiptReviewCount: 19,
  keywordReviews: {
    "소금빵": 14,
    "디저트": 6,
    "카페": 10,
    "소큰빵": 8
  },
  externalSignal: 38,
  peakReviews: 4,
  channels: {
    blog: mkCh(2, 10, 38),
    insta: mkCh(1, 5, 18),
    youtube: mkCh(0, 2, 6),
    receipt: mkCh(4, 19, 72),
    cafe: mkCh(1, 5, 17)
  },
  rankLog: [{
    date: "4/4",
    event: "블로그 10건 달성",
    rankChange: 2,
    detail: "블로그 주간 10건 → '수내 소금빵' 키워드 2위 진입"
  }, {
    date: "3/31",
    event: "영수증+카페 동시",
    rankChange: 1,
    detail: "영수증리뷰 19건+카페 5건 → 신뢰도 상승"
  }],
  history: [{
    m: "2월",
    v: 18
  }, {
    m: "3월",
    v: 22
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s15",
  name: "소림사 용산점",
  region: "서울 용산구 한강로3가",
  type: "관광+주거",
  phone: "070-8657-0446",
  placeId: "1215016250",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 1,
  keywordTarget: "용산 소금빵",
  receiptReviewAge: 1,
  receiptReviewCount: 25,
  keywordReviews: {
    "소금빵": 18,
    "디저트": 9,
    "카페": 12,
    "소큰빵": 11
  },
  externalSignal: 68,
  peakReviews: 6,
  channels: {
    blog: mkCh(3, 15, 58),
    insta: mkCh(2, 7, 26),
    youtube: mkCh(1, 3, 10),
    receipt: mkCh(6, 25, 92),
    cafe: mkCh(2, 8, 28)
  },
  rankLog: [{
    date: "4/5",
    event: "전채널 최고 기록",
    rankChange: 0,
    detail: "블로그 15건+영수증 25건+인스타 7건 → 1위 압도적 유지"
  }, {
    date: "4/2",
    event: "유튜브 3건",
    rankChange: 1,
    detail: "유튜브 3건 발행 → 외부신호 +68% 달성"
  }],
  history: [{
    m: "2월",
    v: 25
  }, {
    m: "3월",
    v: 28
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s16",
  name: "소림사 본점(서순라길)",
  region: "서울 서순라길",
  type: "관광",
  phone: "02-6337-3337",
  placeId: "2050449918",
  matjibKeyword: "서순라길 맛집",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 0,
  keywordTarget: "서순라길 맛집",
  receiptReviewAge: 99,
  receiptReviewCount: 0,
  keywordReviews: {
    "소금빵": 7,
    "디저트": 4,
    "카페": 5,
    "소큰빵": 3
  },
  externalSignal: 18,
  peakReviews: 2,
  channels: {
    blog: mkCh(1, 5, 18),
    insta: mkCh(1, 3, 11),
    youtube: mkCh(0, 1, 3),
    receipt: mkCh(2, 9, 34),
    cafe: mkCh(0, 3, 10)
  },
  rankLog: [{
    date: "4/3",
    event: "블로그+영수증",
    rankChange: 1,
    detail: "블로그 5건+영수증 9건 → 순위 1계단 상승 (7위→6위)"
  }],
  history: [{
    m: "2월",
    v: 7
  }, {
    m: "3월",
    v: 10
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s18",
  name: "소림사 서초점",
  region: "서울 서초구 서초동",
  type: "오피스",
  phone: "0507-1330-6660",
  placeId: "2003275850",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 14,
  keywordTarget: "서초 소금빵",
  receiptReviewAge: 26,
  receiptReviewCount: 3,
  keywordReviews: {
    "소금빵": 2,
    "디저트": 1,
    "카페": 1,
    "소큰빵": 0
  },
  externalSignal: -2,
  peakReviews: 0,
  channels: {
    blog: mkCh(0, 2, 6),
    insta: mkCh(0, 1, 5),
    youtube: mkCh(0, 0, 0),
    receipt: mkCh(0, 3, 12),
    cafe: mkCh(0, 1, 3)
  },
  rankLog: [{
    date: "4/4",
    event: "영수증 공백",
    rankChange: -1,
    detail: "영수증리뷰 26h 공백 → 순위 1계단 하락 (13위→14위)"
  }],
  history: [{
    m: "2월",
    v: -6
  }, {
    m: "3월",
    v: -4
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s20",
  name: "소림사 구로디지털점",
  region: "서울 구로구 구로동",
  type: "오피스",
  phone: "0507-1301-0899",
  placeId: "2053860093",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 24,
  keywordTarget: "구로 카페",
  receiptReviewAge: 35,
  receiptReviewCount: 2,
  keywordReviews: {
    "소금빵": 1,
    "디저트": 0,
    "카페": 1,
    "소큰빵": 0
  },
  externalSignal: -6,
  peakReviews: 0,
  channels: {
    blog: mkCh(0, 1, 3),
    insta: mkCh(0, 1, 4),
    youtube: mkCh(0, 0, 0),
    receipt: mkCh(0, 2, 7),
    cafe: mkCh(0, 0, 1)
  },
  rankLog: [{
    date: "4/4",
    event: "채널 비활성",
    rankChange: -2,
    detail: "블로그+영수증 0건 → 순위 2계단 하락 (22위→24위)"
  }],
  history: [{
    m: "2월",
    v: -4
  }, {
    m: "3월",
    v: -2
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s21",
  name: "소림사 팔거역점",
  region: "대구 북구 동천동",
  type: "역세권",
  phone: "",
  placeId: "2031470155",
  matjibKeyword: "동천동 맛집",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 0,
  keywordTarget: "팔거역 맛집",
  receiptReviewAge: 99,
  receiptReviewCount: 0,
  keywordReviews: {
    "소금빵": 0,
    "디저트": 0,
    "카페": 0,
    "소큰빵": 0
  },
  externalSignal: 0,
  peakReviews: 0,
  channels: {
    blog: mkCh(0, 0, 0),
    insta: mkCh(0, 0, 0),
    youtube: mkCh(0, 0, 0),
    receipt: mkCh(0, 0, 0),
    cafe: mkCh(0, 0, 0)
  },
  rankLog: [],
  history: [{
    m: "2월",
    v: 0
  }, {
    m: "3월",
    v: 0
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s22",
  name: "소림사 동남지구점",
  region: "충북 청주",
  type: "기타",
  phone: "",
  placeId: "2047626725",
  matjibKeyword: "동남지구 맛집",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 0,
  keywordTarget: "동남지구 맛집",
  receiptReviewAge: 99,
  receiptReviewCount: 0,
  keywordReviews: {
    "소금빵": 0,
    "디저트": 0,
    "카페": 0,
    "소큰빵": 0
  },
  externalSignal: 0,
  peakReviews: 0,
  channels: {
    blog: mkCh(0, 0, 0),
    insta: mkCh(0, 0, 0),
    youtube: mkCh(0, 0, 0),
    receipt: mkCh(0, 0, 0),
    cafe: mkCh(0, 0, 0)
  },
  rankLog: [],
  history: [{
    m: "2월",
    v: 0
  }, {
    m: "3월",
    v: 0
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s23",
  name: "소림사 산본점",
  region: "경기 군포 산본",
  type: "기타",
  phone: "",
  placeId: "2036890095",
  matjibKeyword: "산본 맛집",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 0,
  keywordTarget: "산본 맛집",
  receiptReviewAge: 99,
  receiptReviewCount: 0,
  keywordReviews: {
    "소금빵": 0,
    "디저트": 0,
    "카페": 0,
    "소큰빵": 0
  },
  externalSignal: 0,
  peakReviews: 0,
  channels: {
    blog: mkCh(0, 0, 0),
    insta: mkCh(0, 0, 0),
    youtube: mkCh(0, 0, 0),
    receipt: mkCh(0, 0, 0),
    cafe: mkCh(0, 0, 0)
  },
  rankLog: [],
  history: [{
    m: "2월",
    v: 0
  }, {
    m: "3월",
    v: 0
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s24",
  name: "소림사 잠실엘스점",
  region: "서울 송파구 잠실동",
  type: "쇼핑몰",
  phone: "02-6337-3337",
  placeId: "1889333438",
  matjibKeyword: "잠실 맛집",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 0,
  keywordTarget: "잠실 맛집",
  receiptReviewAge: 99,
  receiptReviewCount: 0,
  keywordReviews: {
    "소금빵": 0,
    "디저트": 0,
    "카페": 0,
    "소큰빵": 0
  },
  externalSignal: 0,
  peakReviews: 0,
  channels: {
    blog: mkCh(0, 0, 0),
    insta: mkCh(0, 0, 0),
    youtube: mkCh(0, 0, 0),
    receipt: mkCh(0, 0, 0),
    cafe: mkCh(0, 0, 0)
  },
  rankLog: [],
  history: [{
    m: "2월",
    v: 0
  }, {
    m: "3월",
    v: 0
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s25",
  name: "소림사 원주점",
  region: "강원 원주시 무실동",
  type: "주거",
  phone: "0507-1373-4489",
  placeId: "2084617483",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 0,
  keywordTarget: "원주 맛집",
  receiptReviewAge: 99,
  receiptReviewCount: 0,
  keywordReviews: {
    "소금빵": 0,
    "디저트": 0,
    "카페": 0,
    "소큰빵": 0
  },
  externalSignal: 0,
  peakReviews: 0,
  channels: {
    blog: mkCh(0, 0, 0),
    insta: mkCh(0, 0, 0),
    youtube: mkCh(0, 0, 0),
    receipt: mkCh(0, 0, 0),
    cafe: mkCh(0, 0, 0)
  },
  rankLog: [],
  history: [{
    m: "2월",
    v: 0
  }, {
    m: "3월",
    v: 0
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s26",
  name: "소림사 대구도서관점",
  region: "대구 남구 봉덕동",
  type: "기타",
  phone: "0507-1342-6728",
  placeId: "2085116121",
  matjibKeyword: "봉덕동 맛집",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 0,
  keywordTarget: "대구 맛집",
  receiptReviewAge: 99,
  receiptReviewCount: 0,
  keywordReviews: {
    "소금빵": 0,
    "디저트": 0,
    "카페": 0,
    "소큰빵": 0
  },
  externalSignal: 0,
  peakReviews: 0,
  channels: {
    blog: mkCh(0, 0, 0),
    insta: mkCh(0, 0, 0),
    youtube: mkCh(0, 0, 0),
    receipt: mkCh(0, 0, 0),
    cafe: mkCh(0, 0, 0)
  },
  rankLog: [],
  history: [{
    m: "2월",
    v: 0
  }, {
    m: "3월",
    v: 0
  }, {
    m: "이번달",
    v: 0
  }]
}, {
  id: "s27",
  name: "소림사 광주상무점",
  region: "광주 서구 치평동",
  type: "카페",
  phone: "0507-1360-1051",
  placeId: "2012766446",
  sales: 0,
  vis: 0,
  aov: 0,
  rev: 0,
  ad: false,
  ri: false,
  insta: 0,
  blogs: 0,
  keywordRank: 0,
  keywordTarget: "광주 맛집",
  receiptReviewAge: 99,
  receiptReviewCount: 0,
  keywordReviews: {
    "소금빵": 0,
    "디저트": 0,
    "카페": 0,
    "소큰빵": 0
  },
  externalSignal: 0,
  peakReviews: 0,
  channels: {
    blog: mkCh(0, 0, 0),
    insta: mkCh(0, 0, 0),
    youtube: mkCh(0, 0, 0),
    receipt: mkCh(0, 0, 0),
    cafe: mkCh(0, 0, 0)
  },
  rankLog: [],
  history: [{
    m: "2월",
    v: 0
  }, {
    m: "3월",
    v: 0
  }, {
    m: "이번달",
    v: 0
  }]
}];

// 우선 관리 3개 매장 (본점·청주·산본) — 맨 위 순위 패널
const PRIORITY_PLACE_ORDER = ["2050449918", "2047626725", "2036890095"];
const PRIORITY_TOP3 = [{
  placeId: "2050449918",
  label: "소림사 본점(서순라길)",
  keyword: "서순라길 맛집",
  storeId: "s16"
}, {
  placeId: "2047626725",
  label: "소림사 동남지구점",
  keyword: "동남지구 맛집",
  storeId: "s22"
}, {
  placeId: "2036890095",
  label: "소림사 산본점",
  keyword: "산본 맛집",
  storeId: "s23"
}];
/** UI 카드·패널 공통 스타일 */
const FC = {
  card: {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    boxShadow: "var(--shadow)"
  },
  panel: {
    padding: "12px 14px",
    borderBottom: "1px solid var(--border)"
  },
  page: {
    width: "100%",
    maxWidth: 480,
    margin: "0 auto"
  },
  pad: {
    padding: "0 12px"
  },
  btnPrimary: {
    padding: "10px 16px",
    borderRadius: 10,
    border: "none",
    background: "var(--accent)",
    color: "#0b0f1a",
    fontWeight: 800,
    cursor: "pointer",
    fontSize: "var(--fs-sm)",
    minHeight: 40
  },
  btnGhost: {
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text)",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "var(--fs-sm)",
    minHeight: 40
  },
  type: {
    xs: "var(--fs-xs)",
    sm: "var(--fs-sm)",
    base: "var(--fs-base)",
    md: "var(--fs-md)",
    lg: "var(--fs-lg)",
    title: "var(--fs-title)",
    rank: "var(--fs-rank)",
    rankLg: "var(--fs-rank-lg)"
  }
};
const PageShell = ({
  children,
  style
}) => React.createElement("div", {
  className: "fc-page",
  style: {
    paddingBottom: 64,
    ...style
  }
}, children);
const formatSynced = t => t ? String(t).slice(0, 16).replace("T", " ") : "";
const receiptDisplay = store => {
  const row = store.channels?.receipt || {};
  const n = row.month ?? 0;
  const src = row.count_source;
  if (row.unavailable || src === "unavailable") return {
    text: "미지원",
    sub: "네이버·베이커리는 영수증 리뷰 없음",
    color: "var(--dim)"
  };
  if (n === 0 && src === "receipt_tab") return {
    text: "0건",
    sub: "탭 실측·리뷰 없음",
    color: "var(--muted)"
  };
  if (n === 0 && src === "place_header") return {
    text: "0건",
    sub: "네이버 상단 집계",
    color: "var(--muted)"
  };
  if (n === 0 && src === "review_list") return {
    text: "0건",
    sub: "상단 미표시·탭 미수집",
    color: "var(--warn)"
  };
  if (n > 0) return {
    text: n + "건",
    sub: src === "receipt_tab" ? "탭 실측" : src === "place_header" ? "상단 집계" : "",
    color: "var(--text)"
  };
  return {
    text: "—",
    sub: "미측정",
    color: "var(--dim)"
  };
};
const prioritySort = (a, b) => {
  const ia = PRIORITY_PLACE_ORDER.indexOf(a.placeId || ""),
    ib = PRIORITY_PLACE_ORDER.indexOf(b.placeId || "");
  if (ia !== -1 || ib !== -1) {
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
  return sortRankStore(a) - sortRankStore(b);
};

// ─── 유틸 ────────────────────────────────────────────────
const TYPES = ["역세권", "역세권+주거", "주거", "주거(신도시)", "오피스", "대학가", "쇼핑몰", "관광", "관광+주거", "기타"];
const SC = {
  green: "#10b981",
  yellow: "#f59e0b",
  red: "#ef4444"
};
const SB = {
  green: "rgba(16,185,129,.12)",
  yellow: "rgba(245,158,11,.12)",
  red: "rgba(239,68,68,.12)"
};
const purl = id => id ? `https://map.naver.com/p/entry/place/${id}` : null;
const uid = () => "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const rkC = r => !r || r === 0 ? "#475569" : r <= 5 ? "#10b981" : r <= 15 ? "#f59e0b" : "#ef4444";
const rkL = r => r == null || r === undefined ? "미집계" : !r || r === 0 ? "미집계" : r <= 5 ? r + "위 🟢" : r <= 15 ? r + "위 ⚠️" : r + "위 🔴";
const matjibKwForStore = s => {
  if (s.matjibKeyword) return s.matjibKeyword;
  const paren = (s.name || "").match(/\(([^)]+)\)/);
  if (paren) return paren[1] + " 맛집";
  if (s.keywordTarget && s.keywordTarget.includes("맛집")) return s.keywordTarget;
  const m = (s.name || "").match(/소림사\s+(.+?)점/);
  if (m && m[1] !== "본") return m[1] + " 맛집";
  const tail = (s.name || "").match(/소림사\s+(.+)$/);
  if (tail) return tail[1] + " 맛집";
  if ((s.name || "").startsWith("카페 소림사")) return "원당 맛집";
  const rd = s.naverSync?.rank_detail;
  if (rd?.search_keyword && rd.search_keyword !== "맛집") return rd.search_keyword;
  if (s.keywordTarget) {
    const f = s.keywordTarget.split()[0];
    if (f) return f + " 맛집";
  }
  const rg = (s.region || "").match(/(\S+역|\S+동)/);
  if (rg) return rg[1] + " 맛집";
  return s.keywordTarget || "-";
};
const naverRankForStore = (s, drow) => {
  const row = drow || null;
  const pr = s.placeKeywordRank ?? row?.keyword_rank ?? row?.rank_detail?.place_rank;
  const rd = {
    ...(row?.rank_detail || {}),
    ...(s.naverSync?.rank_detail || {})
  };
  const kw = matjibKwForStore(s);
  const synced = s.lastSynced || row?.collected_at || s.naverSync?.synced_at;
  const measured = !!(s.naverMeasured || synced);
  if (pr != null && pr > 0 && Number(pr) > 0) return {
    main: String(pr),
    unit: "위",
    color: rkC(pr),
    sub: "「" + kw + "」 실측",
    kind: "matjib",
    sort: Number(pr)
  };
  if (!s.placeId) return {
    main: "미등록",
    unit: "",
    color: "#94a3b8",
    sub: "네이버에 아직 없음 · 영업 매장",
    kind: "wait",
    sort: 9997
  };
  if (s.placePageInvalid) {
    const hint = s.naverPlaceTitle ? " (네이버: " + s.naverPlaceTitle + ")" : "";
    return {
      main: "ID오류",
      unit: "",
      color: "#ef4444",
      sub: (s.naverRankHint || "placeId 확인") + hint,
      kind: "err",
      sort: 9998
    };
  }
  if (measured) {
    const n = rd.searched_count || 0;
    if (rd.incomplete_search || n < 25) return {
      main: "재측정",
      unit: "",
      color: "#64748b",
      sub: "「" + kw + "」목록 " + n + "곳만 로드됨",
      kind: "wait",
      sort: 998
    };
    if (pr != null && Number(pr) > 0) return {
      main: String(pr),
      unit: "위",
      color: rkC(pr),
      sub: "「" + kw + "」" + n + "곳 중 · 실측",
      kind: "matjib",
      sort: Number(pr)
    };
    return {
      main: "100+",
      unit: "",
      color: "#f59e0b",
      sub: "「" + kw + "」" + (n || "?") + "곳 스캔 · 목록 밖",
      kind: "out",
      sort: 999
    };
  }
  if (s.placeId) return {
    main: "—",
    unit: "",
    color: "#64748b",
    sub: "실측 불러오는 중…",
    kind: "wait",
    sort: 9999
  };
  const kr = s.keywordRank || 0;
  if (kr > 0) return {
    main: String(kr),
    unit: "위",
    color: "#64748b",
    sub: "「" + (s.keywordTarget || "") + "」 샘플",
    kind: "demo",
    sort: kr
  };
  return {
    main: "—",
    unit: "",
    color: "#64748b",
    sub: "측정 전",
    kind: "wait",
    sort: 9999
  };
};
const rkLStore = s => {
  const d = naverRankForStore(s);
  return d.kind === "out" ? d.main : d.main + (d.unit || "");
};
const rkCStore = s => naverRankForStore(s).color;
const rkSubStore = s => naverRankForStore(s).sub;
const sortRankStore = s => naverRankForStore(s).sort;
/** 고객용 한 줄 — “그래서 뭘 하라는 거지?” */
const storeActionLine = (s, top5avg) => {
  if (!s.placeId) return {
    icon: "📋",
    text: "네이버 플레이스 등록 대기 — 순위·리뷰는 등록 후 자동",
    color: "#94a3b8",
    bg: "rgba(100,116,139,.12)"
  };
  if (s.placePageInvalid) return {
    icon: "⚠️",
    text: "네이버 placeId 수정 필요",
    color: "#fca5a5",
    bg: "rgba(239,68,68,.12)"
  };
  const d = naverRankForStore(s);
  const advice = getMktAdvice(s, top5avg);
  if ((s.receiptReviewAge || 99) > 24) return {
    icon: "🔥",
    text: "영수증 리뷰 끊김 → 매장 리뷰 이벤트 바로",
    color: "#fecaca",
    bg: "rgba(239,68,68,.15)"
  };
  if (d.kind === "matjib" && Number(d.main) <= 10) return {
    icon: "✅",
    text: "검색 노출 양호 — 블로그·리뷰만 유지",
    color: "#86efac",
    bg: "rgba(16,185,129,.12)"
  };
  if (d.kind === "out" || d.kind === "wait") {
    if (advice.length) {
      const a = advice[0];
      return {
        icon: "👉",
        text: "맛집 검색 약함 → " + a.label + " 이번 주 " + a.diff + "건 더 올리기",
        color: "#fde68a",
        bg: "rgba(245,158,11,.15)"
      };
    }
    return {
      icon: "👉",
      text: "맛집 키워드 100위 밖 — 블로그·영수증 리뷰부터",
      color: "#fde68a",
      bg: "rgba(245,158,11,.15)"
    };
  }
  if (advice.length) {
    return {
      icon: "👉",
      text: advice.slice(0, 2).map(a => a.label + " +" + a.diff + "건").join(" · "),
      color: "#fde68a",
      bg: "rgba(245,158,11,.12)"
    };
  }
  return {
    icon: "✅",
    text: "지표 정상 — 지금 활동 유지",
    color: "#86efac",
    bg: "rgba(16,185,129,.1)"
  };
};
const rankMeaningText = d => {
  if (d.kind === "matjib") return (d.sub || "").replace(/\s*실측\s*/, "") + " 검색 시 " + d.main + "번째";
  if (d.kind === "out") return "맛집 검색에 안 보임 → 블로그·리뷰 올리기";
  if (d.kind === "err") return "네이버 연결 확인 필요";
  if (d.kind === "wait") return "순위 수집 중";
  return "";
};
/** daily.json → 매장 객체에 네이버 실측 반영 */
const mergeDailyIntoStore = (s, row) => {
  if (!row) return s;
  if (!s.placeId) return s;
  if (row.place_id && s.placeId && row.place_id !== s.placeId) return s;
  if (row.place_page_ok === false || row.error) {
    const hint = row.naver_place_title ? "네이버에는 「" + row.naver_place_title + "」로 등록됨 — placeId 수정 필요" : row.error || "플레이스 ID 확인 필요";
    return {
      ...s,
      naverMeasured: true,
      placeKeywordRank: null,
      keywordRank: 0,
      naverRankHint: hint,
      naverPlaceTitle: row.naver_place_title || null,
      placePageInvalid: true,
      lastSynced: row.collected_at
    };
  }
  const ch = {
    ...s.channels
  };
  const sm = row.summary || {};
  ["blog", "receipt", "visitor"].forEach(k => {
    const t = row.channels?.[k];
    const total = sm[k + "_total"] ?? t?.total_visible;
    if (total != null) {
      const delta = sm[k + "_delta"] ?? t?.delta_vs_yesterday;
      ch[k] = {
        ...(ch[k] || {
          today: 0,
          week: 0,
          month: 0
        }),
        month: total,
        today: t?.today_on_page ?? 0,
        week: delta ?? 0,
        count_source: t?.count_source,
        unavailable: t?.unavailable,
        auto: true
      };
    }
  });
  MANUAL_CH.forEach(k => {
    if (!ch[k] || !ch[k].source) ch[k] = {
      today: 0,
      week: 0,
      month: 0,
      source: "manual",
      auto: false
    };
  });
  const rd = row.rank_detail || {};
  const pr = row.keyword_rank ?? rd.place_rank;
  const placeRank = pr != null && pr !== "" && Number(pr) > 0 ? Number(pr) : null;
  let hint = null;
  if (!placeRank && row.collected_at) {
    hint = rd.incomplete_search ? "「" + (rd.search_keyword || matjibKwForStore(s)) + "」목록 " + (rd.searched_count || "?") + "곳만 수집 — 재측정 필요" : "「" + (rd.search_keyword || s.keywordTarget) + "」맛집 키워드 상위 100위 밖";
  }
  const matjibKw = matjibKwForStore(s);
  if (rd.search_keyword && rd.search_keyword !== matjibKw) rd = {
    ...rd,
    search_keyword: matjibKw
  };
  const measured = !!row.collected_at;
  return {
    ...s,
    channels: ch,
    placeKeywordRank: placeRank,
    brandKeywordRank: null,
    matjibKeyword: matjibKw,
    keywordRank: placeRank != null ? placeRank : measured ? 0 : s.keywordRank,
    naverMeasured: measured,
    naverRankHint: hint,
    placePageInvalid: false,
    naverPlaceTitle: row.naver_place_title || null,
    receiptReviewCount: ch.receipt?.month ?? s.receiptReviewCount,
    blogs: ch.blog?.month ?? s.blogs,
    naverSync: {
      synced_at: row.collected_at,
      change_log: row.change_events || [],
      rank_detail: rd
    },
    lastSynced: row.collected_at
  };
};
/** 핵심3·랜딩: 매장 merge + daily 교차검증 */
const rankDisplayForStore = (store, drow, keyword) => {
  const rd = drow?.rank_detail || store?.naverSync?.rank_detail || {};
  const kw = matjibKwForStore(store) || rd.search_keyword || keyword;
  const top0 = rd.top_place_ids?.[0];
  const r = store?.placeKeywordRank ?? drow?.keyword_rank ?? rd.place_rank;
  const measured = (drow?.collected_at || store?.lastSynced || "").slice(0, 16).replace("T", " ");
  const n = rd.searched_count || 0;
  if (store?.placeId && !drow?.collected_at && !store?.naverMeasured) return {
    label: "—",
    unit: "",
    color: "var(--dim)",
    hint: "실측 대기",
    sub: ""
  };
  if (r == null || r === "" || Number(r) === 0 || rd.not_in_top_n) {
    return {
      label: "100+",
      unit: "",
      color: "#f59e0b",
      hint: "「" + kw + "」 약 " + (n || "?") + "곳 · 목록 밖" + (measured ? " · " + measured : ""),
      sub: "상위 목록에 없음"
    };
  }
  const rankN = Number(r);
  if (rankN === 1 && top0 && store?.placeId && top0 !== store.placeId) return {
    label: "100+",
    unit: "",
    color: "#f59e0b",
    hint: "순위 재검증 필요 · 목록 1번과 불일치",
    sub: ""
  };
  if (rankN === 1 && (!top0 || !rd.rank_source)) return {
    label: "상위",
    unit: "",
    color: "#f59e0b",
    hint: "「" + kw + "」최상단 근접 · 정확 순위 재측정 중",
    sub: "1위 단정 보류"
  };
  return {
    label: String(rankN),
    unit: "위",
    color: rkC(rankN),
    hint: "「" + kw + "」" + (n ? n + "곳 중 " : "") + (measured || ""),
    sub: rankN <= 3 ? "키워드 검색 실측" : ""
  };
};
/** daily.json 단독 (레거시) */
const rkFromDaily = (drow, keyword) => {
  if (!drow || !drow.collected_at) return {
    rank: null,
    label: "측정 전",
    color: "#64748b",
    hint: "「" + (keyword || "") + "」— 수집 대기"
  };
  const r = drow.keyword_rank ?? drow.rank_detail?.place_rank;
  const measured = drow.collected_at.slice(0, 16).replace("T", " ");
  if (r == null || r === "" || Number(r) === 0) {
    const n = drow.rank_detail?.searched_count || 0;
    const br = drow.rank_detail?.brand_rank;
    const bk = drow.rank_detail?.brand_keyword || "브랜드명";
    if (drow.rank_detail?.incomplete_search) {
      return {
        rank: null,
        label: "측정중",
        color: "#64748b",
        hint: "목록 " + n + "곳 · 재수집 · " + measured
      };
    }
    if (drow.rank_detail?.not_in_top_n || n >= 65) {
      const hint = "「" + (keyword || "") + "」 약 " + n + "곳 스캔 · 목록 밖 · " + measured;
      return {
        rank: null,
        label: "100+",
        unit: "",
        color: "#f59e0b",
        hint,
        sub: "상위 목록에 없음"
      };
    }
    return {
      rank: null,
      label: "측정 전",
      unit: "",
      color: "#64748b",
      hint: "순위 수집 실패 · " + measured,
      sub: ""
    };
  }
  const n = Number(r);
  const scanned = drow.rank_detail?.searched_count || 0;
  const kw = keyword || drow.rank_detail?.search_keyword || "";
  return {
    rank: n,
    label: String(n),
    unit: "위",
    color: rkC(n),
    hint: "「" + kw + "」 약 " + scanned + "곳 스캔 · " + measured,
    sub: "키워드별 실측 (브랜드 통합 순위 아님)"
  };
};
const frC = h => h <= 6 ? "#10b981" : h <= 24 ? "#f59e0b" : "#ef4444";
const frL = h => h <= 6 ? h + "h 신선" : h <= 24 ? h + "h ⚠️" : h + "h 🚨";
const sgC = v => v > 10 ? "#10b981" : v > 0 ? "#84cc16" : v === 0 ? "#64748b" : v > -10 ? "#f59e0b" : "#ef4444";
const sgL = v => v > 0 ? "+" + v + "% ▲" : v === 0 ? "변동없음" : v + "% ▼";

// SEO 이행률: 5대채널 + 기존 지표
const cComp = s => {
  const ch = s.channels || {};
  const chScore = [(ch.blog?.week || 0) >= 5, (ch.insta?.week || 0) >= 3, (ch.receipt?.week || 0) >= 10, (ch.youtube?.month || 0) >= 2, (ch.cafe?.week || 0) >= 3].filter(Boolean).length;
  const seoScore = [s.ad, s.ri, (s.placeKeywordRank || s.keywordRank || 99) <= 10 && (s.placeKeywordRank || s.keywordRank || 0) !== 0, (s.receiptReviewAge || 99) <= 24, (s.externalSignal || 0) > 0].filter(Boolean).length;
  return Math.round((chScore + seoScore) / 10 * 100);
};
const rc = s => {
  let h = 0;
  const sc = s.sales || 0,
    vc = s.vis || 0,
    nr = s.rev || 0;
  if (sc >= 10) h += 3;else if (sc >= 0) h += 2;else if (sc >= -10) h += 1;
  if (vc >= 5) h += 2;else if (vc >= 0) h += 1;
  if (nr >= 300) h += 2;else if (nr >= 100) h += 1;
  let mk = 0;
  if (s.ad) mk++;
  if (s.ri) mk++;
  if ((s.insta || 0) >= 3) mk++;
  const adj = h - (mk === 0 ? 1 : 0);
  const comp = cComp(s);
  const predicted = +(sc + (comp >= 80 ? 3 : comp >= 60 ? 1.5 : comp >= 40 ? 0 : comp >= 20 ? -1.5 : -3)).toFixed(1);
  return {
    ...s,
    health: h,
    mkt: mk,
    status: adj >= 6 ? "green" : adj >= 3 ? "yellow" : "red",
    predicted
  };
};

// 상위 5% 기준 (브랜드 내 Top3 평균)
const getTop5Avg = stores => {
  const top3 = [...stores].filter(s => s.placeId).sort((a, b) => sortRankStore(a) - sortRankStore(b)).slice(0, 3);
  const avg = {};
  CH_KEYS.forEach(k => {
    avg[k] = {
      today: Math.round(top3.reduce((a, s) => a + (s.channels?.[k]?.today || 0), 0) / top3.length),
      week: Math.round(top3.reduce((a, s) => a + (s.channels?.[k]?.week || 0), 0) / top3.length),
      month: Math.round(top3.reduce((a, s) => a + (s.channels?.[k]?.month || 0), 0) / top3.length)
    };
  });
  return avg;
};

// 마케팅 제언: 결핍 채널 분석
const getMktAdvice = (store, top5avg) => {
  const gaps = [];
  const ch = store.channels || {};
  const avg = top5avg || {};
  NAVER_AUTO_CH.forEach(k => {
    if (k === "receipt" && ch.receipt?.unavailable) return;
    const mine = ch[k]?.week || 0;
    const bench = avg[k]?.week || 0;
    if (bench > 0 && mine < bench * 0.5) {
      gaps.push({
        ch: k,
        label: CH_INFO[k].label,
        icon: CH_INFO[k].icon,
        color: CH_INFO[k].color,
        mine,
        bench,
        diff: bench - mine
      });
    }
  });
  gaps.sort((a, b) => b.diff - a.diff);
  return gaps;
};

// ═══════════════════════════════════════════════════════════
// Part 2: 공통 컴포넌트
// ═══════════════════════════════════════════════════════════

// ── 공통 UI ─────────────────────────────────────────────
const Chip = ({
  v
}) => {
  const n = parseFloat(v) || 0,
    p = n >= 0;
  return React.createElement("span", {
    className: "mono fc-chip",
    style: {
      color: p ? "#10b981" : "#ef4444",
      background: p ? "rgba(16,185,129,.1)" : "rgba(239,68,68,.1)",
      border: "1px solid " + (p ? "rgba(16,185,129,.22)" : "rgba(239,68,68,.22)")
    }
  }, p ? "▲" : "▼", Math.abs(n) + "%");
};
const MBar = ({
  r,
  color
}) => {
  const c = color || (r >= 70 ? "#10b981" : r >= 40 ? "#f59e0b" : "#ef4444");
  return React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 5
    }
  }, React.createElement("div", {
    style: {
      flex: 1,
      height: 3,
      background: "#1e3a5f",
      borderRadius: 9
    }
  }, React.createElement("div", {
    style: {
      height: "100%",
      width: r + "%",
      background: c,
      borderRadius: 9
    }
  })), React.createElement("span", {
    className: "mono fc-muted",
    style: {
      fontWeight: 700,
      color: c,
      minWidth: 26,
      textAlign: "right"
    }
  }, r + "%"));
};

// ── 로고 클릭 → 홈 (점주/관리자 로그인 등) ───────────────
function FranchainHomeLogo({
  onHome,
  subtitle
}) {
  const el = React.createElement;
  if (!onHome) return null;
  return el("div", {
    style: {
      padding: "10px 15px 8px",
      borderBottom: "1px solid #0f1e35",
      background: "#070d1a"
    }
  }, el("button", {
    type: "button",
    onClick: onHome,
    title: "홈으로",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      background: "none",
      border: "none",
      cursor: "pointer",
      width: "100%",
      padding: 0
    }
  }, el("div", {
    style: {
      width: 28,
      height: 28,
      background: "linear-gradient(135deg,#f59e0b,#d97706)",
      borderRadius: 7,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 24
    }
  }, "🍞"), el("div", {
    style: {
      textAlign: "left",
      flex: 1
    }
  }, el("div", {
    className: "mono",
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: "var(--accent)",
      letterSpacing: 1
    }
  }, "FRANCHAIN v5.9.2"), subtitle && el("div", {
    style: {
      fontSize: 13,
      color: "var(--muted)",
      marginTop: 2
    }
  }, subtitle)), el("span", {
    style: {
      fontSize: 18,
      color: "#64748b",
      fontWeight: 600
    }
  }, "🏠 홈")));
}

// ── 우선 3개 매장 순위 (본점·청주·산본) ─────────────────
function PriorityTop3Panel({
  stores,
  goDetail,
  daily: extDaily
}) {
  const el = React.createElement;
  const [daily, setDaily] = React.useState(extDaily || null);
  React.useEffect(() => {
    if (extDaily) {
      setDaily(extDaily);
      return;
    }
    fetchDailyJson().then(setDaily);
  }, [extDaily]);
  const cards = PRIORITY_TOP3.map((p, i) => {
    const s = stores.find(x => x.placeId === p.placeId || x.id === p.storeId) || {};
    const drow = dailyRowForStore(daily, s) || (daily?.stores || []).find(x => x.place_id === p.placeId);
    const kw = matjibKwForStore(s) || p.keyword;
    const rkInfo = rankDisplayForStore(s, drow, kw);
    const rcpt = receiptDisplay(s);
    const sid = s.id || p.storeId;
    return el("div", {
      key: p.placeId,
      onClick: () => sid && goDetail && goDetail(sid),
      style: {
        ...FC.card,
        padding: "12px 10px",
        cursor: sid ? "pointer" : "default",
        borderColor: "rgba(232,163,23,.28)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0
      }
    }, el("div", {
      className: "fc-label",
      style: {
        marginBottom: 4
      }
    }, "핵심 " + (i + 1)), el("div", {
      className: "fc-list-name",
      style: {
        marginBottom: 2,
        lineHeight: 1.3
      }
    }, p.label.replace(/^소림사\s*/, "")), el("div", {
      className: "fc-muted"
    }, "「" + kw + "」"), el("div", {
      className: "fc-label",
      style: {
        marginTop: 8,
        marginBottom: 2
      }
    }, "맛집 순위"), el("div", {
      style: {
        display: "flex",
        alignItems: "baseline",
        gap: 3
      }
    }, el("div", {
      className: "fc-rank fc-rank--lg",
      style: {
        color: rkInfo.color
      }
    }, rkInfo.label), rkInfo.unit && el("span", {
      className: "fc-body",
      style: {
        fontWeight: 700,
        color: rkInfo.color
      }
    }, rkInfo.unit)), rkInfo.hint && el("div", {
      className: "fc-muted",
      style: {
        marginTop: 4,
        lineHeight: 1.35
      }
    }, rkInfo.hint), el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 4,
        marginTop: 8
      }
    }, el("div", {
      style: {
        background: "var(--bg)",
        borderRadius: 6,
        padding: "6px 4px",
        textAlign: "center"
      }
    }, el("div", {
      className: "fc-label"
    }, "방문"), el("div", {
      className: "fc-stat",
      style: {
        color: "#a5b4fc"
      }
    }, drow?.summary?.visitor_total ?? drow?.channels?.visitor?.total_visible ?? s.channels?.visitor?.month ?? 0)), el("div", {
      style: {
        background: "var(--bg)",
        borderRadius: 6,
        padding: "6px 4px",
        textAlign: "center"
      }
    }, el("div", {
      className: "fc-label"
    }, "블로그"), el("div", {
      className: "fc-stat",
      style: {
        color: "var(--ok)"
      }
    }, drow?.summary?.blog_total ?? drow?.channels?.blog?.total_visible ?? s.channels?.blog?.month ?? 0)), el("div", {
      style: {
        background: "var(--bg)",
        borderRadius: 6,
        padding: "6px 4px",
        textAlign: "center"
      }
    }, el("div", {
      className: "fc-label"
    }, "영수증"), el("div", {
      className: "fc-stat",
      style: {
        color: rcpt.color
      }
    }, rcpt.text))), drow?.collected_at ? el("div", {
      className: "fc-muted",
      style: {
        marginTop: 6
      }
    }, "실측 " + formatSynced(drow.collected_at)) : "");
  });
  return el("div", {
    style: {
      width: "100%",
      ...FC.card,
      padding: "12px 14px"
    }
  }, el("div", {
    className: "fc-h1",
    style: {
      marginBottom: 4
    }
  }, "핵심 3매장"), el("div", {
    className: "fc-muted",
    style: {
      marginBottom: 10,
      lineHeight: 1.45
    }
  }, "매장마다 검색어·순위가 다릅니다 (통합 1위 아님)"), el("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
      gap: 8,
      alignItems: "stretch"
    }
  }, cards));
}
function StoreRankBadge({
  store,
  large,
  compact
}) {
  const el = React.createElement;
  const d = naverRankForStore(store);
  if (compact) {
    return el("div", {
      style: {
        textAlign: "right",
        flexShrink: 0
      }
    }, el("div", {
      className: "fc-rank",
      style: {
        color: d.color
      }
    }, d.main, d.unit && el("span", {
      style: {
        fontSize: FC.type.sm,
        marginLeft: 1
      }
    }, d.unit)), el("div", {
      className: "fc-muted",
      style: {
        marginTop: 2,
        maxWidth: 88,
        marginLeft: "auto"
      }
    }, (d.sub || "").slice(0, 24)));
  }
  const mean = rankMeaningText(d);
  return el("div", {
    style: {
      textAlign: "right",
      flexShrink: 0,
      minWidth: large ? 100 : 84
    }
  }, el("div", {
    className: "fc-label",
    style: {
      marginBottom: 4
    }
  }, "맛집 검색"), el("div", {
    className: "fc-rank" + (large ? " fc-rank--lg" : ""),
    style: {
      color: d.color
    }
  }, d.main, d.unit && el("span", {
    style: {
      fontSize: FC.type.sm,
      fontWeight: 700,
      marginLeft: 2
    }
  }, d.unit)), el("div", {
    className: "fc-muted",
    style: {
      fontSize: ".75rem",
      marginTop: 4,
      maxWidth: 150,
      marginLeft: "auto",
      lineHeight: 1.35
    }
  }, d.sub), mean && el("div", {
    style: {
      fontSize: ".72rem",
      color: "var(--text)",
      marginTop: 4,
      maxWidth: 150,
      marginLeft: "auto"
    }
  }, mean), store.lastSynced && el("div", {
    className: "fc-muted",
    style: {
      fontSize: ".65rem",
      marginTop: 4
    }
  }, formatSynced(store.lastSynced)));
}

/** 매장 목록 — 컴팩트 카드 (탭 = 상세, 큰 버튼 없음) */
function StoreListRow({
  store,
  top5avg,
  onDetail,
  isPri,
  priLabel
}) {
  const el = React.createElement;
  const d = naverRankForStore(store);
  const a = storeActionLine(store, top5avg);
  const v = store.channels?.visitor?.month ?? 0;
  const b = store.channels?.blog?.month ?? 0;
  const rc = receiptDisplay(store);
  const kw = matjibKwForStore(store);
  const url = purl(store.placeId);
  const actionText = a.text ? a.text.replace(/^[^\s]+\s*/, "") : "";
  return el("div", {
    onClick: () => onDetail(store.id),
    style: {
      display: "grid",
      gridTemplateColumns: "1fr auto",
      gap: 12,
      alignItems: "stretch",
      padding: "14px 14px",
      marginBottom: 8,
      cursor: "pointer",
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      borderLeft: "4px solid " + (isPri ? "var(--accent)" : SC[store.status])
    }
  }, el("div", {
    style: {
      minWidth: 0
    }
  }, el("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 6,
      flexWrap: "wrap"
    }
  }, isPri && el("span", {
    className: "fc-badge-core"
  }, "핵심"), el("span", {
    className: "fc-list-name",
    style: {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      flex: 1,
      minWidth: 0
    }
  }, priLabel || store.name)), el("div", {
    className: "fc-muted",
    style: {
      marginBottom: 8
    }
  }, store.region, " · ", kw), el("div", {
    style: {
      display: "flex",
      gap: 6,
      flexWrap: "wrap"
    }
  }, el("span", {
    className: "fc-pill"
  }, "방문 ", el("b", {
    style: {
      color: "#a5b4fc"
    }
  }, v)), el("span", {
    className: "fc-pill"
  }, "블로그 ", el("b", {
    style: {
      color: "var(--ok)"
    }
  }, b)), el("span", {
    className: "fc-pill"
  }, "영수증 ", el("b", {
    style: {
      color: rc.color
    }
  }, rc.text)), store.lastSynced && el("span", {
    className: "fc-pill",
    style: {
      color: "var(--accent)"
    }
  }, "실측 " + String(store.lastSynced).slice(0, 10))), actionText && el("div", {
    className: "fc-action",
    style: {
      color: a.color,
      borderLeft: "3px solid " + a.color
    }
  }, actionText)), el("div", {
    style: {
      textAlign: "right",
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      minWidth: 72
    }
  }, el("div", {
    className: "fc-rank",
    style: {
      color: d.color
    }
  }, d.main, el("span", {
    style: {
      fontSize: FC.type.sm,
      fontWeight: 700
    }
  }, d.unit || "")), el("div", {
    className: "fc-muted",
    style: {
      marginTop: 4,
      fontSize: FC.type.xs,
      maxWidth: 88,
      marginLeft: "auto"
    }
  }, (d.sub || "").slice(0, 22)), el("div", {
    className: "fc-body",
    style: {
      color: "var(--accent)",
      marginTop: 8,
      fontWeight: 700,
      fontSize: FC.type.sm
    }
  }, "상세 ›")));
}
function DashboardTodayBanner({
  stores
}) {
  const el = React.createElement;
  const urgent = stores.filter(s => (s.receiptReviewAge || 99) > 24 || s.placePageInvalid || naverRankForStore(s).kind === "out").length;
  const good = stores.filter(s => {
    const d = naverRankForStore(s);
    return d.kind === "matjib" && Number(d.main) <= 10;
  }).length;
  const synced = stores.filter(s => s.lastSynced).length;
  return el("div", {
    style: {
      margin: "8px 12px 0",
      padding: "10px 12px",
      ...FC.card
    }
  }, el("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 6
    }
  }, el("div", {
    style: {
      textAlign: "center"
    }
  }, el("div", {
    className: "fc-stat",
    style: {
      color: "var(--bad)"
    }
  }, urgent), el("div", {
    className: "fc-label"
  }, "조치")), el("div", {
    style: {
      textAlign: "center"
    }
  }, el("div", {
    className: "fc-stat",
    style: {
      color: "var(--ok)"
    }
  }, good), el("div", {
    className: "fc-label"
  }, "순위 양호")), el("div", {
    style: {
      textAlign: "center"
    }
  }, el("div", {
    className: "fc-stat",
    style: {
      color: "var(--accent)"
    }
  }, synced), el("div", {
    className: "fc-label"
  }, "실측"))));
}
function StoreActionBox({
  store,
  top5avg
}) {
  const el = React.createElement;
  const a = storeActionLine(store, top5avg);
  return el("div", {
    style: {
      borderLeft: "2px solid " + a.color,
      padding: "8px 10px",
      marginBottom: 8,
      background: "rgba(255,255,255,.03)",
      borderRadius: 6
    }
  }, el("div", {
    className: "fc-label",
    style: {
      marginBottom: 3
    }
  }, "오늘 할 일"), el("div", {
    style: {
      fontSize: ".85rem",
      color: a.color,
      lineHeight: 1.45,
      fontWeight: 500
    }
  }, a.text));
}
function StoreQuickStats({
  store
}) {
  const el = React.createElement;
  const v = store.channels?.visitor?.month ?? 0;
  const b = store.channels?.blog?.month ?? 0;
  const rc = receiptDisplay(store);
  return el("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 6,
      marginTop: 8
    }
  }, el("div", {
    style: {
      background: "var(--bg)",
      borderRadius: 8,
      padding: "8px",
      textAlign: "center",
      border: "1px solid var(--border)"
    }
  }, el("div", {
    className: "fc-label",
    style: {
      fontSize: ".65rem",
      marginBottom: 4
    }
  }, "방문"), el("div", {
    className: "mono",
    style: {
      fontSize: "1.15rem",
      fontWeight: 800,
      color: "#a5b4fc"
    }
  }, v)), el("div", {
    style: {
      background: "var(--bg)",
      borderRadius: 8,
      padding: "8px",
      textAlign: "center",
      border: "1px solid var(--border)"
    }
  }, el("div", {
    className: "fc-label",
    style: {
      fontSize: ".65rem",
      marginBottom: 4
    }
  }, "블로그"), el("div", {
    className: "mono",
    style: {
      fontSize: "1.15rem",
      fontWeight: 800,
      color: "var(--ok)"
    }
  }, b)), el("div", {
    style: {
      background: "var(--bg)",
      borderRadius: 8,
      padding: "8px",
      textAlign: "center",
      border: "1px solid var(--border)"
    }
  }, el("div", {
    className: "fc-label",
    style: {
      fontSize: ".65rem",
      marginBottom: 4
    }
  }, "영수증"), el("div", {
    className: "mono",
    style: {
      fontSize: "1.15rem",
      fontWeight: 800,
      color: rc.color
    }
  }, rc.text), rc.sub && el("div", {
    style: {
      fontSize: ".58rem",
      color: rc.color,
      marginTop: 2
    }
  }, rc.sub)));
}
function AllStoresNaverRankPanel({
  stores,
  goDetail,
  daily: extDaily
}) {
  const el = React.createElement;
  const [daily, setDaily] = React.useState(extDaily || null);
  React.useEffect(() => {
    if (extDaily) {
      setDaily(extDaily);
      return;
    }
    fetchDailyJson().then(setDaily);
  }, [extDaily]);
  const list = [...stores].filter(s => s.placeId).sort((a, b) => {
    const ra = naverRankForStore(a, dailyRowForStore(daily, a));
    const rb = naverRankForStore(b, dailyRowForStore(daily, b));
    return ra.sort - rb.sort;
  });
  if (!list.length) return null;
  const withRank = list.filter(s => {
    const d = naverRankForStore(s, dailyRowForStore(daily, s));
    return d.kind === "matjib" && Number(d.main) > 0;
  }).length;
  const dailyReady = !!daily?.stores?.length;
  return el("div", {
    style: {
      padding: "10px 12px",
      borderBottom: "1px solid var(--border)"
    }
  }, el("div", {
    className: "fc-h1",
    style: {
      marginBottom: 4
    }
  }, "전체 매장 순위"), el("div", {
    className: "fc-muted",
    style: {
      marginBottom: 8,
      lineHeight: 1.45
    }
  }, dailyReady ? "네이버 「지역+맛집」 실측 · " + withRank + "곳 순위 · " + (list.length - withRank) + "곳 100+" : "daily.json 불러오는 중…"), el("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 4
    }
  }, list.map(s => {
    const drow = dailyRowForStore(daily, s);
    const d = naverRankForStore(s, drow);
    const kw = matjibKwForStore(s);
    return el("div", {
      key: s.id,
      onClick: () => goDetail && goDetail(s.id),
      style: {
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 10,
        alignItems: "center",
        padding: "12px 12px",
        cursor: "pointer",
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 10
      }
    }, el("div", {
      style: {
        minWidth: 0
      }
    }, el("div", {
      className: "fc-list-name",
      style: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, (s.name || "").replace(/^소림사\s*/, "")), el("div", {
      className: "fc-muted",
      style: {
        marginTop: 4
      }
    }, kw)), el("div", {
      style: {
        textAlign: "right"
      }
    }, el("div", {
      className: "fc-rank",
      style: {
        color: d.color
      }
    }, d.main, d.unit && el("span", {
      style: {
        fontSize: FC.type.sm,
        marginLeft: 1
      }
    }, d.unit)), el("div", {
      className: "fc-muted",
      style: {
        marginTop: 2,
        maxWidth: 100,
        marginLeft: "auto"
      }
    }, (d.sub || "").slice(0, 28))));
  })));
}

// ── 긴급 알림 배너 ──────────────────────────────────────
function UrgentAlerts({
  stores,
  goDetail
}) {
  const alerts = [];
  stores.forEach(s => {
    if ((s.peakReviews || 0) === 0 && (s.receiptReviewCount || 0) < 3) alerts.push({
      id: s.id,
      name: s.name,
      msg: "점심 피크 리뷰 공백! 현장 이벤트 권장"
    });
    if ((s.receiptReviewAge || 0) > 24) alerts.push({
      id: s.id,
      name: s.name,
      msg: "영수증 리뷰 " + (s.receiptReviewAge || 0) + "h 공백 — 즉시 이벤트 필요"
    });
    if (!s.naverMeasured && (s.keywordRank || 0) > 20 && (s.keywordRank || 0) !== 0) alerts.push({
      id: s.id,
      name: s.name,
      msg: "'" + s.keywordTarget + "' " + (s.keywordRank || 0) + "위(샘플) — 실측 전"
    });
    if (s.naverMeasured) {
      const d = naverRankForStore(s);
      if (d.kind === "out") alerts.push({
        id: s.id,
        name: s.name,
        msg: matjibKwForStore(s) + " 맛집 검색 100위 밖"
      });
    }
  });
  if (!alerts.length) return null;
  const el = React.createElement;
  return el("div", {
    className: "apulse",
    style: {
      background: "rgba(239,68,68,.08)",
      borderLeft: "3px solid #ef4444",
      padding: "8px 12px",
      borderBottom: "1px solid rgba(239,68,68,.15)"
    }
  }, el("div", {
    className: "fc-body",
    style: {
      fontWeight: 800,
      color: "#f87171",
      marginBottom: 4,
      display: "flex",
      alignItems: "center",
      gap: 5
    }
  }, el("span", null, "🚨"), "긴급 " + alerts.length + "건"), alerts.slice(0, 3).map((a, i) => el("div", {
    key: i,
    onClick: () => goDetail && goDetail(a.id),
    className: "fc-body",
    style: {
      display: "flex",
      gap: 6,
      cursor: "pointer",
      marginBottom: i < alerts.length - 1 ? 2 : 0
    }
  }, el("span", {
    style: {
      color: "#f87171",
      fontWeight: 700,
      flexShrink: 0,
      fontSize: FC.type.sm
    }
  }, a.name.replace(/^소림사\s*/, "")), el("span", {
    className: "fc-muted"
  }, a.msg))), alerts.length > 3 && el("div", {
    className: "fc-muted",
    style: {
      marginTop: 2
    }
  }, "외 " + (alerts.length - 3) + "건"));
}

// ── 공지 배너 ────────────────────────────────────────────
function NoticeBanner({
  n,
  onX
}) {
  if (!n) return null;
  const c = {
    info: {
      bg: "rgba(59,130,246,.08)",
      bd: "#3b82f6",
      tx: "#60a5fa",
      i: "📢"
    },
    warn: {
      bg: "rgba(245,158,11,.08)",
      bd: "#f59e0b",
      tx: "#fbbf24",
      i: "⚠️"
    },
    urgent: {
      bg: "rgba(239,68,68,.1)",
      bd: "#ef4444",
      tx: "#f87171",
      i: "🚨"
    }
  }[n.type || "info"];
  const el = React.createElement;
  return el("div", {
    style: {
      background: c.bg,
      borderLeft: "3px solid " + c.bd,
      padding: "8px 12px",
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, el("span", {
    style: {
      fontSize: 16,
      flexShrink: 0
    }
  }, c.i), el("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, el("div", {
    className: "fc-body",
    style: {
      fontWeight: 700,
      color: c.tx
    }
  }, n.title), el("div", {
    className: "fc-muted",
    style: {
      marginTop: 1,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, n.body)), el("div", {
    style: {
      display: "flex",
      gap: 5,
      alignItems: "center",
      flexShrink: 0
    }
  }, el("span", {
    className: "fc-muted"
  }, n.date), el("button", {
    onClick: onX,
    style: {
      background: "none",
      border: "none",
      color: "#475569",
      fontSize: 18,
      cursor: "pointer",
      lineHeight: 1,
      minHeight: 32
    }
  }, "×")));
}

// ── 5대 채널 활동량 테이블 ───────────────────────────────
function ChannelTable({
  store,
  top5avg,
  compact
}) {
  const el = React.createElement;
  const ch = store.channels || {};
  if (compact) {
    return el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(6,1fr)",
        gap: 3
      }
    }, CH_KEYS.map(k => {
      const info = CH_INFO[k];
      const wk = ch[k]?.week || 0;
      const bench = top5avg?.[k]?.week || 0;
      const ok = bench === 0 || wk >= bench * 0.5;
      return el("div", {
        key: k,
        style: {
          background: "#070d1a",
          borderRadius: 7,
          padding: "5px 4px",
          textAlign: "center",
          border: "1px solid " + (ok ? "#1e3a5f" : "rgba(239,68,68,.2)")
        }
      }, el("div", {
        style: {
          fontSize: 14,
          marginBottom: 1
        }
      }, info.icon), el("div", {
        className: "fc-stat",
        style: {
          color: ok ? info.color : "#ef4444"
        }
      }, wk), el("div", {
        className: "fc-muted"
      }, "/주"));
    }));
  }
  return el("div", {
    style: {
      ...FC.card,
      padding: "12px",
      marginBottom: 10
    }
  }, el("div", {
    className: "fc-h1",
    style: {
      marginBottom: 4,
      color: "var(--muted)"
    }
  }, "📣 채널 (플레이스 자동 + 점주 입력)"), el("div", {
    className: "fc-muted",
    style: {
      marginBottom: 8
    }
  }, "블로그·방문·영수증 = 네이버 실측 · 인스타·유튜브·카페 = 점주 입력"), el("div", {
    style: {
      overflowX: "auto"
    }
  }, el("table", {
    style: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: FC.type.base
    }
  }, el("thead", null, el("tr", {
    style: {
      borderBottom: "1px solid var(--border)"
    }
  }, el("th", {
    className: "fc-label",
    style: {
      padding: "4px 6px",
      textAlign: "left"
    }
  }, "채널"), el("th", {
    className: "fc-label",
    style: {
      padding: "4px 6px",
      textAlign: "center"
    }
  }, "오늘"), el("th", {
    className: "fc-label",
    style: {
      padding: "4px 6px",
      textAlign: "center",
      color: "var(--accent)"
    }
  }, "주"), el("th", {
    className: "fc-label",
    style: {
      padding: "4px 6px",
      textAlign: "center"
    }
  }, "월"), top5avg && el("th", {
    className: "fc-label",
    style: {
      padding: "4px 6px",
      textAlign: "center",
      color: "var(--ok)"
    }
  }, "상위"), top5avg && el("th", {
    className: "fc-label",
    style: {
      padding: "4px 6px",
      textAlign: "center"
    }
  }, "상태"))), el("tbody", null, CH_KEYS.map(k => {
    const info = CH_INFO[k];
    const d = ch[k] || {
      today: 0,
      week: 0,
      month: 0
    };
    const bench = top5avg?.[k]?.week || 0;
    const ratio = bench > 0 ? Math.round(d.week / bench * 100) : 100;
    const ok = bench === 0 || ratio >= 50;
    return el("tr", {
      key: k,
      style: {
        borderTop: "1px solid rgba(30,58,95,.5)"
      }
    }, el("td", {
      style: {
        padding: "6px"
      }
    }, el("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 5,
        flexWrap: "wrap"
      }
    }, el("span", {
      style: {
        fontSize: 14
      }
    }, info.icon), el("span", {
      className: "fc-body",
      style: {
        fontWeight: 600
      }
    }, info.label), el("span", {
      className: "fc-muted",
      style: {
        fontSize: ".65rem"
      }
    }, info.auto ? "자동" : "입력"))), el("td", {
      style: {
        padding: "6px",
        textAlign: "center"
      }
    }, el("span", {
      className: "mono fc-body",
      style: {
        fontWeight: 700,
        color: d.today > 0 ? info.color : "var(--dim)"
      }
    }, d.today)), el("td", {
      style: {
        padding: "6px",
        textAlign: "center"
      }
    }, el("span", {
      className: "fc-stat",
      style: {
        color: ok ? info.color : "#ef4444"
      }
    }, d.week)), el("td", {
      style: {
        padding: "6px",
        textAlign: "center"
      }
    }, el("span", {
      className: "mono fc-muted",
      style: {
        fontWeight: 600
      }
    }, d.month)), top5avg && el("td", {
      style: {
        padding: "6px",
        textAlign: "center"
      }
    }, el("span", {
      className: "mono fc-body",
      style: {
        fontWeight: 700,
        color: "var(--ok)"
      }
    }, bench)), top5avg && el("td", {
      style: {
        padding: "6px",
        textAlign: "center"
      }
    }, bench === 0 ? el("span", {
      className: "fc-muted"
    }, "—") : el("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 2
      }
    }, el(MBar, {
      r: Math.min(ratio, 100),
      color: ok ? "#10b981" : "#ef4444"
    }), !ok && el("span", {
      className: "fc-muted",
      style: {
        color: "#ef4444",
        fontWeight: 700
      }
    }, "-" + (bench - d.week)))));
  })))));
}

// ── 마케팅 제언 패널 (결핍 분석) ────────────────────────
function MktAdvicePanel({
  store,
  top5avg,
  topStore
}) {
  const el = React.createElement;
  const gaps = getMktAdvice(store, top5avg);
  if (!gaps.length) return el("div", {
    style: {
      background: "rgba(16,185,129,.06)",
      borderRadius: 10,
      padding: "12px 14px",
      border: "1px solid rgba(16,185,129,.2)",
      marginBottom: 10
    }
  }, el("div", {
    className: "fc-body",
    style: {
      fontWeight: 700,
      color: "#10b981",
      marginBottom: 4
    }
  }, "✅ 채널 활동량 양호"), el("div", {
    className: "fc-muted",
    style: {
      lineHeight: 1.45
    }
  }, "5대 채널 모두 상위 5% 대비 50% 이상 달성 중입니다."));
  return el("div", {
    style: {
      background: "#0c1629",
      borderRadius: 11,
      padding: "12px 14px",
      border: "1px solid rgba(245,158,11,.2)",
      marginBottom: 10
    }
  }, el("div", {
    className: "fc-body",
    style: {
      fontWeight: 800,
      color: "#f59e0b",
      marginBottom: 4
    }
  }, "📌 1위 추격을 위해 부족한 채널"), el("div", {
    className: "fc-muted",
    style: {
      marginBottom: 10,
      lineHeight: 1.45
    }
  }, "상위 5% 평균 대비 50% 미만 채널 — 점주가 직접 보완해야 할 항목입니다."), el("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, gaps.map((g, i) => el("div", {
    key: i,
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 10,
      padding: "10px 12px",
      background: "rgba(239,68,68,.05)",
      borderRadius: 8,
      border: "1px solid rgba(239,68,68,.15)"
    }
  }, el("span", {
    style: {
      fontSize: 20,
      flexShrink: 0,
      lineHeight: 1.2
    }
  }, g.icon), el("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, el("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      marginBottom: 4,
      flexWrap: "wrap"
    }
  }, el("span", {
    className: "fc-body",
    style: {
      fontWeight: 700,
      color: "#e2e8f0"
    }
  }, "[" + g.label + "]"), el("span", {
    className: "mono fc-body",
    style: {
      color: "#ef4444",
      fontWeight: 700
    }
  }, "내 주" + g.mine + "건"), el("span", {
    className: "fc-muted"
  }, "vs"), el("span", {
    className: "mono fc-body",
    style: {
      color: "#10b981",
      fontWeight: 700
    }
  }, "상위5% 주" + g.bench + "건")), el(MBar, {
    r: Math.round(g.mine / g.bench * 100),
    color: "#ef4444"
  }), el("div", {
    className: "fc-body",
    style: {
      color: "#fca5a5",
      fontWeight: 600,
      marginTop: 4,
      lineHeight: 1.45
    }
  }, g.label + " " + g.diff + "건 추가 필요 → 블로그 체험단 / 자체 콘텐츠 제작 권장"))))));
}

// ── 순위 변동 로그 ───────────────────────────────────────
function RankLog({
  store
}) {
  const el = React.createElement;
  const logs = store.rankLog || [];
  if (!logs.length) return el("div", {
    style: {
      background: "#0c1629",
      borderRadius: 10,
      padding: "12px 14px",
      border: "1px solid #1e3a5f",
      marginBottom: 10
    }
  }, el("div", {
    className: "fc-body",
    style: {
      fontWeight: 700,
      color: "#94a3b8",
      marginBottom: 4
    }
  }, "📋 활동량 → 순위 변동 로그"), el("div", {
    className: "fc-muted",
    style: {
      lineHeight: 1.45
    }
  }, "아직 로그가 없습니다. 채널 활동 후 자동으로 기록됩니다."));
  return el("div", {
    style: {
      background: "#0c1629",
      borderRadius: 11,
      padding: "12px 14px",
      border: "1px solid #1e3a5f",
      marginBottom: 10
    }
  }, el("div", {
    className: "fc-body",
    style: {
      fontWeight: 700,
      color: "#94a3b8",
      marginBottom: 8
    }
  }, "📋 활동량 → 순위 변동 로그"), el("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 5
    }
  }, logs.map((log, i) => el("div", {
    key: i,
    style: {
      display: "flex",
      gap: 8,
      padding: "7px 9px",
      background: "rgba(0,0,0,.2)",
      borderRadius: 7,
      border: "1px solid " + (log.rankChange > 0 ? "rgba(16,185,129,.15)" : log.rankChange < 0 ? "rgba(239,68,68,.15)" : "rgba(71,85,105,.3)")
    }
  }, el("div", {
    style: {
      flexShrink: 0,
      textAlign: "center",
      minWidth: 28
    }
  }, el("div", {
    style: {
      fontSize: 11,
      color: "#475569",
      fontWeight: 600
    }
  }, log.date), el("div", {
    className: "mono",
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: log.rankChange > 0 ? "#10b981" : log.rankChange < 0 ? "#ef4444" : "#64748b",
      lineHeight: 1.2,
      marginTop: 2
    }
  }, log.rankChange > 0 ? "▲" + log.rankChange : log.rankChange < 0 ? "▼" + Math.abs(log.rankChange) : "−")), el("div", {
    style: {
      flex: 1
    }
  }, el("div", {
    className: "fc-body",
    style: {
      fontWeight: 600,
      marginBottom: 2
    }
  }, log.event), el("div", {
    className: "fc-muted",
    style: {
      lineHeight: 1.45
    }
  }, log.detail))))));
}

// ── 매출 추이 (고정 높이·라벨은 HTML — SVG 확대 방지) ─────
function SalesChart({
  store,
  topStore
}) {
  const el = React.createElement;
  const W = 300,
    H = 72,
    PL = 28,
    PR = 8,
    PT = 8,
    PB = 4;
  const cw = W - PL - PR,
    ch = H - PT - PB;
  const myH = (store.history || []).map((d, i, a) => i === a.length - 1 ? {
    ...d,
    v: store.sales || 0
  } : d);
  const tpH = (topStore.history || []).map((d, i, a) => i === a.length - 1 ? {
    ...d,
    v: topStore.sales || 0
  } : d);
  const all = [...myH, ...tpH].map(d => d.v);
  const minV = Math.min(...all) - 7,
    maxV = Math.max(...all) + 7,
    rng = maxV - minV || 1;
  const xp = (i, n) => PL + i / (n - 1) * cw;
  const yp = v => PT + ch - (v - minV) / rng * ch;
  const ln = (data, c, dash) => {
    const pts = data.map((d, i) => xp(i, data.length).toFixed(1) + "," + yp(d.v).toFixed(1)).join(" ");
    return el("g", null, el("polyline", {
      points: pts,
      fill: "none",
      stroke: c,
      strokeWidth: 1.8,
      strokeDasharray: dash ? "4 3" : undefined,
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }), data.map((d, i) => el("circle", {
      key: i,
      cx: xp(i, data.length),
      cy: yp(d.v),
      r: 3,
      fill: c,
      stroke: "#070d1a",
      strokeWidth: 1.5
    })));
  };
  const topLbl = topStore.name.replace("소림사 ", "").slice(0, 4);
  const fmt = v => (v >= 0 ? "+" : "") + v + "%";
  return el("div", {
    className: "fc-chart",
    style: {
      background: "#0c1629",
      borderRadius: 10,
      padding: "12px 14px",
      border: "1px solid #1e3a5f",
      marginBottom: 9
    }
  }, el("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 8,
      marginBottom: 4,
      flexWrap: "wrap"
    }
  }, el("div", null, el("div", {
    className: "fc-body",
    style: {
      fontWeight: 700,
      color: "#94a3b8"
    }
  }, "📊 최근 3개월 매출 추이"), el("div", {
    className: "fc-muted",
    style: {
      marginTop: 2,
      lineHeight: 1.35
    }
  }, "관리 입력 % · 1위 매장과 비교 참고")), el("div", {
    style: {
      display: "flex",
      gap: 10,
      flexShrink: 0
    }
  }, [{
    c: "#f59e0b",
    l: "내 매장",
    d: false
  }, {
    c: "#10b981",
    l: "1위(" + topLbl + ")",
    d: true
  }].map(x => el("div", {
    key: x.l,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4
    }
  }, el("svg", {
    width: 14,
    height: 6
  }, el("line", {
    x1: 0,
    y1: 3,
    x2: 14,
    y2: 3,
    stroke: x.c,
    strokeWidth: "2",
    strokeDasharray: x.d ? "3 2" : undefined
  })), el("span", {
    className: "fc-muted",
    style: {
      color: x.c,
      fontWeight: 600
    }
  }, x.l))))), el("svg", {
    width: W,
    height: H,
    viewBox: "0 0 " + W + " " + H,
    preserveAspectRatio: "none",
    style: {
      display: "block",
      width: "100%",
      height: H,
      maxHeight: H
    }
  }, el("line", {
    x1: PL,
    y1: yp(0),
    x2: W - PR,
    y2: yp(0),
    stroke: "#1e3a5f",
    strokeWidth: 1,
    strokeDasharray: "3 2"
  }), store.id !== topStore.id && ln(tpH, "#10b981", true), ln(myH, "#f59e0b", false)), el("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(" + myH.length + ",1fr)",
      gap: 4,
      marginTop: 8
    }
  }, myH.map((d, i) => el("div", {
    key: i,
    style: {
      textAlign: "center",
      minWidth: 0
    }
  }, el("div", {
    className: "fc-muted",
    style: {
      fontWeight: i === myH.length - 1 ? 700 : 500,
      color: i === myH.length - 1 ? "#f59e0b" : "#64748b"
    }
  }, d.m), el("div", {
    className: "mono",
    style: {
      fontSize: "var(--fs-sm)",
      fontWeight: 700,
      color: "#f59e0b",
      marginTop: 2
    }
  }, fmt(d.v)), store.id !== topStore.id && el("div", {
    className: "mono",
    style: {
      fontSize: "var(--fs-xs)",
      fontWeight: 600,
      color: "#10b981",
      marginTop: 1
    }
  }, fmt((tpH[i] || {}).v))))));
}

// ── 매장 폼 ──────────────────────────────────────────────
function StoreForm({
  store,
  onSave,
  onCancel
}) {
  const isNew = !store?.id;
  const [f, setF] = useState(store || {
    name: "",
    type: "역세권",
    region: "",
    phone: "",
    placeId: "",
    sales: 0,
    vis: 0,
    aov: 0,
    rev: 0,
    ad: false,
    ri: false,
    keywordRank: 0,
    keywordTarget: "",
    receiptReviewAge: 0,
    receiptReviewCount: 0,
    externalSignal: 0,
    peakReviews: 0,
    channels: {
      blog: mkCh(),
      insta: mkCh(),
      youtube: mkCh(),
      receipt: mkCh(),
      cafe: mkCh()
    }
  });
  const set = (k, v) => setF(p => ({
    ...p,
    [k]: v
  }));
  const setCh = (k, t, v) => setF(p => ({
    ...p,
    channels: {
      ...p.channels,
      [k]: {
        ...(p.channels?.[k] || {}),
        [t]: parseFloat(v) || 0
      }
    }
  }));
  const el = React.createElement;
  const Row = ({
    label,
    k,
    type = "number",
    ph = ""
  }) => el("div", null, el("div", {
    style: {
      fontSize: 17,
      color: "#475569",
      fontWeight: 600,
      marginBottom: 2,
      textTransform: "uppercase",
      letterSpacing: .4
    }
  }, label), el("input", {
    type,
    value: f[k],
    placeholder: ph,
    onChange: e => set(k, type === "number" ? parseFloat(e.target.value) || 0 : e.target.value),
    style: {
      width: "100%",
      padding: "8px 10px",
      border: "1px solid #1e3a5f",
      borderRadius: 7,
      background: "#070d1a",
      color: "#e2e8f0",
      fontSize: 21,
      outline: "none",
      boxSizing: "border-box"
    },
    onFocus: e => e.target.style.borderColor = "#f59e0b",
    onBlur: e => e.target.style.borderColor = "#1e3a5f"
  }));
  return el("div", {
    style: {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,.92)",
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center",
      zIndex: 200
    },
    onClick: e => e.target === e.currentTarget && onCancel()
  }, el("div", {
    style: {
      background: "#0c1629",
      borderRadius: "14px 14px 0 0",
      width: "100%",
      maxWidth: 540,
      maxHeight: "92vh",
      overflow: "auto",
      padding: "0 15px 32px",
      border: "1px solid #1e3a5f"
    }
  }, el("div", {
    style: {
      width: 34,
      height: 3,
      background: "#1e3a5f",
      borderRadius: 2,
      margin: "10px auto 12px"
    }
  }), el("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12
    }
  }, el("div", {
    style: {
      fontSize: 23,
      fontWeight: 800,
      color: "#e2e8f0"
    }
  }, isNew ? "새 매장 등록" : "매장 정보 수정"), el("button", {
    onClick: onCancel,
    style: {
      padding: "5px 12px",
      borderRadius: 6,
      border: "1px solid #1e3a5f",
      background: "transparent",
      color: "#64748b",
      cursor: "pointer",
      fontSize: 20
    }
  }, "닫기")), el("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 9
    }
  }, el("div", {
    style: {
      background: "#070d1a",
      borderRadius: 9,
      padding: 12,
      border: "1px solid #1e3a5f"
    }
  }, el("div", {
    style: {
      fontSize: 17,
      color: "#f59e0b",
      fontWeight: 700,
      letterSpacing: 1,
      marginBottom: 8,
      textTransform: "uppercase"
    }
  }, "📍 기본 정보"), el("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 7,
      marginBottom: 7
    }
  }, el(Row, {
    label: "매장명",
    k: "name",
    type: "text",
    ph: "소림사 OO점"
  }), el("div", null, el("div", {
    style: {
      fontSize: 17,
      color: "#475569",
      fontWeight: 600,
      marginBottom: 2,
      textTransform: "uppercase",
      letterSpacing: .4
    }
  }, "상권 유형"), el("select", {
    value: f.type,
    onChange: e => set("type", e.target.value),
    style: {
      width: "100%",
      padding: "8px 10px",
      border: "1px solid #1e3a5f",
      borderRadius: 7,
      background: "#070d1a",
      color: "#e2e8f0",
      fontSize: 21,
      outline: "none"
    }
  }, TYPES.map(t => el("option", {
    key: t,
    value: t
  }, t))))), el("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 7
    }
  }, el(Row, {
    label: "지역",
    k: "region",
    type: "text",
    ph: "서울 강남구"
  }), el(Row, {
    label: "전화번호",
    k: "phone",
    type: "text",
    ph: "02-0000-0000"
  }), el(Row, {
    label: "네이버 플레이스 ID",
    k: "placeId",
    type: "text",
    ph: "숫자만"
  }))), el("div", {
    style: {
      background: "#070d1a",
      borderRadius: 9,
      padding: 12,
      border: "1px solid #1e3a5f"
    }
  }, el("div", {
    style: {
      fontSize: 17,
      color: "#f59e0b",
      fontWeight: 700,
      letterSpacing: 1,
      marginBottom: 8,
      textTransform: "uppercase"
    }
  }, "🔍 SEO 지표"), el("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 7
    }
  }, el(Row, {
    label: "키워드 순위",
    k: "keywordRank",
    ph: "예: 3"
  }), el(Row, {
    label: "대표 키워드",
    k: "keywordTarget",
    type: "text",
    ph: "마곡 소금빵"
  }), el(Row, {
    label: "리뷰 신선도(h)",
    k: "receiptReviewAge",
    ph: "예: 12"
  }), el(Row, {
    label: "외부 신호%",
    k: "externalSignal",
    ph: "+15 / -8"
  }))), el("div", {
    style: {
      background: "#070d1a",
      borderRadius: 9,
      padding: 12,
      border: "1px solid #1e3a5f"
    }
  }, el("div", {
    style: {
      fontSize: 17,
      color: "#f59e0b",
      fontWeight: 700,
      letterSpacing: 1,
      marginBottom: 8,
      textTransform: "uppercase"
    }
  }, "📣 5대 채널 주간 활동량"), el("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(5,1fr)",
      gap: 6
    }
  }, CH_KEYS.map(k => el("div", {
    key: k,
    style: {
      textAlign: "center"
    }
  }, el("div", {
    style: {
      fontSize: 21,
      marginBottom: 3
    }
  }, CH_INFO[k].icon), el("div", {
    style: {
      fontSize: 17,
      color: "#475569",
      marginBottom: 4
    }
  }, CH_INFO[k].label), el("input", {
    type: "number",
    value: f.channels?.[k]?.week || 0,
    onChange: e => setCh(k, "week", e.target.value),
    style: {
      width: "100%",
      padding: "6px 4px",
      border: "1px solid #1e3a5f",
      borderRadius: 6,
      background: "#0c1629",
      color: CH_INFO[k].color,
      fontSize: 21,
      outline: "none",
      textAlign: "center",
      fontFamily: "'Space Mono',monospace",
      fontWeight: 700
    },
    onFocus: e => e.target.style.borderColor = CH_INFO[k].color,
    onBlur: e => e.target.style.borderColor = "#1e3a5f"
  }))))), el("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 7
    }
  }, el("div", {
    style: {
      background: "#070d1a",
      borderRadius: 9,
      padding: 12,
      border: "1px solid #1e3a5f"
    }
  }, el("div", {
    style: {
      fontSize: 17,
      color: "#f59e0b",
      fontWeight: 700,
      letterSpacing: 1,
      marginBottom: 8,
      textTransform: "uppercase"
    }
  }, "📈 매출"), el("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, el(Row, {
    label: "매출%",
    k: "sales",
    ph: "+22/-8"
  }), el(Row, {
    label: "방문자%",
    k: "vis"
  }), el(Row, {
    label: "총 리뷰",
    k: "rev"
  }))), el("div", {
    style: {
      background: "#070d1a",
      borderRadius: 9,
      padding: 12,
      border: "1px solid #1e3a5f"
    }
  }, el("div", {
    style: {
      fontSize: 17,
      color: "#f59e0b",
      fontWeight: 700,
      letterSpacing: 1,
      marginBottom: 8,
      textTransform: "uppercase"
    }
  }, "마케팅 채널"), el("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, [{
    k: "ad",
    l: "네이버 광고"
  }, {
    k: "ri",
    l: "리뷰 이벤트"
  }].map(b => el("button", {
    key: b.k,
    onClick: () => set(b.k, !f[b.k]),
    style: {
      padding: "9px 7px",
      borderRadius: 7,
      fontSize: 19,
      fontWeight: 700,
      border: "1.5px solid " + (f[b.k] ? "#10b981" : "#1e3a5f"),
      background: f[b.k] ? "rgba(16,185,129,.08)" : "transparent",
      color: f[b.k] ? "#10b981" : "#475569",
      cursor: "pointer",
      textAlign: "left"
    }
  }, (f[b.k] ? "✓ " : "") + b.l))))), el("button", {
    onClick: () => {
      if (!f.name.trim()) return alert("매장명을 입력해주세요");
      const hist = f.history || [{
        m: "2월",
        v: 0
      }, {
        m: "3월",
        v: 0
      }, {
        m: "이번달",
        v: f.sales || 0
      }];
      onSave(rc({
        ...f,
        id: f.id || uid(),
        history: hist,
        keywordReviews: f.keywordReviews || {
          "소금빵": 0,
          "디저트": 0,
          "카페": 0,
          "소큰빵": 0
        },
        rankLog: f.rankLog || []
      }));
    },
    style: {
      padding: "13px",
      borderRadius: 10,
      border: "none",
      background: "linear-gradient(135deg,#f59e0b,#d97706)",
      color: "#070d1a",
      fontWeight: 800,
      fontSize: 22,
      cursor: "pointer"
    }
  }, isNew ? "✅ 매장 등록하기" : "✅ 수정 완료"))));
}

// ═══════════════════════════════════════════════════════════
// Part 3: MAIN APP
// ═══════════════════════════════════════════════════════════
function App({
  startAdmin,
  stores: extStores,
  setStores: extSetStores,
  notice: extNotice,
  setNotice: extSetNotice,
  top5avg: extTop5avg,
  topStore: extTopStore,
  daily: extDaily,
  onHome,
  initialDetail,
  onDetailConsumed
}) {
  const [_stores, _setStores] = useState([]);
  const [loading, setLoading] = useState(!extStores?.length);
  const stores = extStores?.length ? extStores : _stores;
  const setStores = extSetStores || _setStores;
  const [_notice, _setNotice] = useState(null);
  const notice = extNotice !== undefined ? extNotice : _notice;
  const setNotice = extSetNotice || _setNotice;
  const [dismissed, setDismissed] = useState(false);
  const [page, setPage] = useState(startAdmin ? "admin" : "list");
  const [sel, setSel] = useState(null);
  const [adminOk, setAdminOk] = useState(!!startAdmin);
  const [form, setForm] = useState(null);
  const [adminTab, setAdminTab] = useState("all");
  const [search, setSearch] = useState("");
  const [checks, setChecks] = useState({});
  const [svModal, setSvModal] = useState(null);
  const [delConf, setDelConf] = useState(null);
  const [salesIn, setSalesIn] = useState({});
  const [nTitle, setNTitle] = useState("");
  const [nBody, setNBody] = useState("");
  const [nType, setNType] = useState("info");
  const [syncLog, setSyncLog] = useState(null);
  useEffect(() => {
    if (extStores?.length) {
      setLoading(false);
      return;
    }
    setStores(SD.map(s => rc(s)));
    setLoading(false);
  }, []);
  useEffect(() => {
    if (extNotice !== undefined) return;
    (async () => {
      const n = await api.getNotice();
      if (n) setNotice(n);
    })();
  }, []);
  useEffect(() => {
    if (initialDetail) {
      go("detail", initialDetail);
      onDetailConsumed && onDetailConsumed();
    }
  }, [initialDetail]);
  const sorted = useMemo(() => [...stores].sort(prioritySort), [stores]);
  const topStore = extTopStore || sorted[0] || stores[0];
  const store = stores.find(s => s.id === sel);
  const top5avg = extTop5avg || useMemo(() => getTop5Avg(stores), [stores]);
  const avg = stores.length ? +(stores.reduce((a, s) => a + (s.sales || 0), 0) / stores.length).toFixed(1) : 0;
  const saveStore = s => {
    setStores(p => p.find(x => x.id === s.id) ? p.map(x => x.id === s.id ? s : x) : [...p, s]);
    setForm(null);
    // Supabase 저장 (비동기)
    sbSaveStore(s).catch(() => {});
  };
  const delStore = id => {
    setStores(p => p.filter(s => s.id !== id));
    setDelConf(null);
    if (sel === id) {
      setSel(null);
      setPage("list");
    }
  };
  const go = (p, id) => {
    if (id !== undefined) setSel(id);
    setPage(p);
    window.scrollTo && window.scrollTo(0, 0);
  };
  const el = React.createElement;
  const MBar2 = ({
    r,
    c
  }) => {
    const col = c || (r >= 70 ? "#10b981" : r >= 40 ? "#f59e0b" : "#ef4444");
    return el("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 4
      }
    }, el("div", {
      style: {
        flex: 1,
        height: 3,
        background: "#1e3a5f",
        borderRadius: 9
      }
    }, el("div", {
      style: {
        height: "100%",
        width: r + "%",
        background: col,
        borderRadius: 9
      }
    })), el("span", {
      className: "mono",
      style: {
        fontSize: 17,
        fontWeight: 700,
        color: col,
        minWidth: 24,
        textAlign: "right"
      }
    }, r + "%"));
  };
  const LogoHome = ({
    sub
  }) => {
    const inner = [el("div", {
      style: {
        width: 28,
        height: 28,
        background: "linear-gradient(135deg,#f59e0b,#d97706)",
        borderRadius: 7,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 24,
        flexShrink: 0
      }
    }, "🍞"), el("div", {
      style: {
        textAlign: "left"
      }
    }, el("div", {
      className: "mono",
      style: {
        fontSize: 14,
        fontWeight: 700,
        color: "var(--accent)",
        letterSpacing: 1
      }
    }, "FRANCHAIN v5.9.2"), el("div", {
      style: {
        fontSize: 13,
        color: "var(--muted)"
      }
    }, sub || "소림사 · " + stores.length + "개 매장"))];
    const sty = {
      display: "flex",
      alignItems: "center",
      gap: 7,
      background: "none",
      border: "none",
      padding: 0,
      flexShrink: 0
    };
    return onHome ? el("button", {
      type: "button",
      onClick: onHome,
      title: "홈으로",
      style: {
        ...sty,
        cursor: "pointer"
      }
    }, inner) : el("div", {
      style: sty
    }, inner);
  };
  const Header = ({
    title,
    back,
    right
  }) => el("header", {
    style: {
      background: "#070d1a",
      borderBottom: "1px solid #0f1e35",
      padding: "10px 15px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      position: "sticky",
      top: 0,
      zIndex: 30
    }
  }, el("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9,
      flex: 1,
      minWidth: 0
    }
  }, back && el("button", {
    onClick: back,
    style: {
      background: "none",
      border: "none",
      color: "#475569",
      fontSize: 22,
      cursor: "pointer",
      padding: "4px 0",
      display: "flex",
      alignItems: "center",
      gap: 2,
      flexShrink: 0
    }
  }, "‹ ", el("span", {
    style: {
      fontSize: 19
    }
  }, "뒤로")), el(LogoHome, {
    sub: title ? null : undefined
  }), title && el("div", {
    style: {
      fontSize: 21,
      fontWeight: 800,
      color: "#e2e8f0",
      flex: 1,
      marginLeft: 6,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, title)), right && el("div", {
    style: {
      flexShrink: 0
    }
  }, right));
  const SiaMark = () => el("a", {
    href: "https://siastreet.com",
    target: "_blank",
    rel: "noreferrer",
    className: "sia-credit",
    style: {
      position: "fixed",
      bottom: 72,
      right: 10,
      display: "flex",
      alignItems: "center",
      gap: 4,
      textDecoration: "none",
      zIndex: 35,
      background: "rgba(7,13,26,.6)",
      padding: "3px 7px",
      borderRadius: 99,
      backdropFilter: "blur(4px)"
    }
  }, el("svg", {
    width: 9,
    height: 9,
    viewBox: "0 0 24 24",
    fill: "none"
  }, el("rect", {
    x: 2,
    y: 2,
    width: 20,
    height: 20,
    rx: 5,
    fill: "#1e3a5f"
  }), el("path", {
    d: "M7 12h10M12 7l5 5-5 5",
    stroke: "#475569",
    strokeWidth: 2.5,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })), el("span", {
    style: {
      fontSize: 17,
      color: "#475569",
      fontFamily: "'Space Mono',monospace",
      letterSpacing: .6
    }
  }, "SIA STREET"));
  const BottomBar = () => el("div", {
    style: {
      position: "fixed",
      bottom: 0,
      left: 0,
      right: 0,
      background: "#070d1a",
      borderTop: "1px solid #0f1e35",
      display: "flex",
      zIndex: 40,
      paddingBottom: "env(safe-area-inset-bottom,0)"
    }
  }, [{
    k: "list",
    i: "🏪",
    l: "매장"
  }, {
    k: "rank",
    i: "📊",
    l: "랭킹"
  }, {
    k: "input",
    i: "✍️",
    l: "입력"
  }, {
    k: "admin",
    i: "🏢",
    l: "관제"
  }].map(t => el("button", {
    key: t.k,
    onClick: () => {
      if (t.k === "admin" && !adminOk && !startAdmin) {
        const p = prompt("관리자 비밀번호를 입력하세요:");
        if (p === authStore.getAdminPw()) {
          setAdminOk(true);
          setPage("admin");
        } else if (p) alert("틀렸습니다!");
        return;
      }
      setPage(t.k);
    },
    style: {
      flex: 1,
      padding: "8px 4px 6px",
      border: "none",
      background: "transparent",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 2,
      cursor: "pointer"
    }
  }, el("span", {
    style: {
      fontSize: 20
    }
  }, t.i), el("span", {
    style: {
      fontSize: ".72rem",
      fontWeight: 700,
      color: page === t.k ? "var(--accent)" : "var(--muted)"
    }
  }, t.l), page === t.k && el("div", {
    style: {
      width: 16,
      height: 2,
      background: "#f59e0b",
      borderRadius: 1,
      marginTop: 1
    }
  }))));
  if (loading) return el("div", {
    style: {
      minHeight: "100vh",
      background: "#070d1a",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: 14
    }
  }, el("div", {
    style: {
      fontSize: 36
    }
  }, "🍞"), el("div", {
    className: "mono",
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: "var(--accent)",
      letterSpacing: 1
    }
  }, "FRANCHAIN v5.9"), el("div", {
    style: {
      fontSize: 19,
      color: "#334155"
    }
  }, "마케팅 관제 플랫폼 로딩 중..."), el("div", {
    style: {
      width: 120,
      height: 2,
      background: "#0f1e35",
      borderRadius: 99,
      overflow: "hidden"
    }
  }, el("div", {
    style: {
      height: "100%",
      width: "65%",
      background: "#f59e0b",
      borderRadius: 99
    }
  })));

  // ── 매장 목록 ──────────────────────────────────────────
  if (page === "list") {
    const filtered = sorted.filter(s => !search || (s.name + s.region).includes(search));
    return el("div", {
      style: {
        minHeight: "100vh",
        background: "var(--bg)",
        paddingBottom: 56
      }
    }, el(Header, {
      onHome,
      right: el("button", {
        onClick: () => setForm("new"),
        style: {
          padding: "6px 12px",
          borderRadius: 8,
          border: "none",
          background: "var(--accent)",
          color: "#0b0f1a",
          fontSize: FC.type.sm,
          fontWeight: 800,
          cursor: "pointer",
          minHeight: 36
        }
      }, "+추가")
    }), el("div", {
      className: "fc-page"
    }, el(DashboardTodayBanner, {
      stores,
      top5avg
    }), el(UrgentAlerts, {
      stores,
      goDetail: id => go("detail", id)
    }), el(NoticeBanner, {
      n: dismissed ? null : notice,
      onX: () => setDismissed(true)
    }), form && el(StoreForm, {
      store: form === "new" ? null : form,
      onSave: saveStore,
      onCancel: () => setForm(null)
    }), delConf && el("div", {
      style: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: 20
      }
    }, el("div", {
      style: {
        background: "#0c1629",
        borderRadius: 12,
        padding: "20px 16px",
        width: "100%",
        maxWidth: 280,
        border: "1px solid #ef4444",
        textAlign: "center"
      }
    }, el("div", {
      style: {
        fontSize: 32,
        marginBottom: 7
      }
    }, "🗑️"), el("div", {
      style: {
        fontSize: 21,
        fontWeight: 800,
        color: "#e2e8f0",
        marginBottom: 4
      }
    }, delConf.name), el("div", {
      style: {
        fontSize: 19,
        color: "#64748b",
        marginBottom: 14
      }
    }, "정말 삭제하시겠습니까?"), el("div", {
      style: {
        display: "flex",
        gap: 7
      }
    }, el("button", {
      onClick: () => delStore(delConf.id),
      style: {
        flex: 1,
        padding: 10,
        borderRadius: 8,
        border: "none",
        background: "#ef4444",
        color: "#fff",
        fontWeight: 800,
        cursor: "pointer"
      }
    }, "삭제"), el("button", {
      onClick: () => setDelConf(null),
      style: {
        flex: 1,
        padding: 10,
        borderRadius: 8,
        border: "1px solid #1e3a5f",
        background: "transparent",
        color: "#64748b",
        cursor: "pointer"
      }
    }, "취소")))), el("div", {
      style: {
        padding: "8px 12px 0"
      }
    }, el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(4,1fr)",
        gap: 6,
        marginBottom: 8
      }
    }, [{
      l: "전체",
      v: stores.length,
      c: "var(--text)"
    }, {
      l: "정상",
      v: stores.filter(s => s.status === "green").length,
      c: "var(--ok)"
    }, {
      l: "주의",
      v: stores.filter(s => s.status === "yellow").length,
      c: "var(--warn)"
    }, {
      l: "위험",
      v: stores.filter(s => s.status === "red").length,
      c: "var(--bad)"
    }].map(k => el("div", {
      key: k.l,
      style: {
        ...FC.card,
        padding: "8px 6px",
        textAlign: "center"
      }
    }, el("div", {
      className: "fc-label"
    }, k.l), el("div", {
      className: "fc-stat",
      style: {
        color: k.c
      }
    }, k.v)))), el("input", {
      value: search,
      onChange: e => setSearch(e.target.value),
      placeholder: "매장명 · 지역 검색",
      style: {
        width: "100%",
        padding: "10px 12px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-card)",
        color: "var(--text)",
        fontSize: ".9rem",
        outline: "none",
        boxSizing: "border-box",
        marginBottom: 8
      }
    })), el("div", {
      style: {
        padding: "0 12px 8px"
      }
    }, el("div", {
      className: "fc-body",
      style: {
        color: "var(--text-muted)",
        marginBottom: 8
      }
    }, "탭하면 상세 · 순위·리뷰는 네이버 실측"), filtered.map(s => {
      const pri = PRIORITY_TOP3.find(p => p.placeId === s.placeId || p.storeId === s.id);
      return el(StoreListRow, {
        key: s.id,
        store: s,
        top5avg,
        onDetail: id => go("detail", id),
        isPri: !!pri,
        priLabel: pri?.label
      });
    }))), el(SiaMark, null), el(BottomBar, null));
  }

  // ── 랭킹 ───────────────────────────────────────────────
  if (page === "rank") return el("div", {
    style: {
      minHeight: "100vh",
      background: "var(--bg)",
      paddingBottom: 68
    }
  }, el(Header, {
    onHome
  }), el("div", {
    className: "fc-page"
  }, el(PriorityTop3Panel, {
    stores,
    goDetail: id => go("detail", id),
    daily: extDaily
  }), el(AllStoresNaverRankPanel, {
    stores,
    goDetail: id => go("detail", id),
    daily: extDaily
  }), el(UrgentAlerts, {
    stores,
    goDetail: id => go("detail", id)
  }), el(NoticeBanner, {
    n: dismissed ? null : notice,
    onX: () => setDismissed(true)
  }), el("div", {
    style: {
      padding: "8px 0"
    }
  }, el("div", {
    className: "fc-h1",
    style: {
      marginBottom: 4
    }
  }, "📊 키워드 순위"), el("div", {
    className: "fc-muted",
    style: {
      marginBottom: 10
    }
  }, "맛집 검색 실측 · 매출 ", el("span", {
    className: "mono",
    style: {
      color: "var(--accent)"
    }
  }, (avg >= 0 ? "+" : "") + avg + "%")), sorted.map((s, i) => {
    const advice = getMktAdvice(s, top5avg);
    const pri = PRIORITY_TOP3.find(p => p.placeId === s.placeId || p.storeId === s.id);
    const displayName = (pri ? pri.label : s.name).replace(/^소림사\s*/, "");
    const d = naverRankForStore(s, dailyRowForStore(extDaily, s));
    return el("div", {
      key: s.id,
      onClick: () => go("detail", s.id),
      style: {
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 8,
        alignItems: "center",
        padding: "10px 12px",
        marginBottom: 5,
        cursor: "pointer",
        ...FC.card,
        borderLeft: "3px solid " + (pri ? "var(--accent)" : SC[s.status])
      }
    }, el("div", {
      style: {
        textAlign: "center",
        minWidth: 28
      }
    }, pri ? el("span", {
      style: {
        fontSize: 14
      }
    }, "🎯") : i < 3 ? el("span", {
      style: {
        fontSize: 16
      }
    }, ["🥇", "🥈", "🥉"][i]) : el("span", {
      className: "fc-muted"
    }, "#" + (i + 1))), el("div", {
      style: {
        minWidth: 0
      }
    }, el("div", {
      className: "fc-list-name",
      style: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, displayName), el("div", {
      className: "fc-muted"
    }, matjibKwForStore(s)), advice.length > 0 && el("div", {
      className: "fc-muted",
      style: {
        color: "var(--warn)",
        marginTop: 3
      }
    }, "부족: " + advice.slice(0, 2).map(g => g.label).join(" · "))), el("div", {
      style: {
        textAlign: "right"
      }
    }, el("div", {
      className: "fc-rank",
      style: {
        color: d.color
      }
    }, d.main, el("span", {
      style: {
        fontSize: FC.type.xs
      }
    }, d.unit || "")), el("div", {
      className: "fc-muted",
      style: {
        marginTop: 2
      }
    }, (d.sub || "").slice(0, 18))));
  }))), el(SiaMark, null), el(BottomBar, null));

  // ── 매출 입력 ──────────────────────────────────────────
  if (page === "input") return el("div", {
    style: {
      minHeight: "100vh",
      background: "#070d1a",
      paddingBottom: 68
    }
  }, el(Header, {
    onHome,
    title: "✍️ 매출 입력"
  }), el(NoticeBanner, {
    n: dismissed ? null : notice,
    onX: () => setDismissed(true)
  }), el("div", {
    style: {
      padding: "11px 15px"
    }
  }, topStore && el("div", {
    style: {
      background: "linear-gradient(135deg,#0c1629,#0a1f12)",
      borderRadius: 10,
      padding: "12px 14px",
      marginBottom: 11,
      border: "1px solid rgba(245,158,11,.15)"
    }
  }, el("div", {
    className: "mono",
    style: {
      fontSize: 16,
      color: "#f59e0b",
      letterSpacing: 2,
      marginBottom: 3
    }
  }, "🥇 현재 브랜드 1위 (키워드 순위 기준)"), el("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, el("div", null, el("div", {
    style: {
      fontSize: 21,
      fontWeight: 800,
      color: "#e2e8f0"
    }
  }, topStore.name), el("div", {
    className: "mono",
    style: {
      fontSize: 25,
      fontWeight: 700,
      color: "#10b981",
      marginTop: 1
    }
  }, rkL(topStore.keywordRank))), el("div", {
    style: {
      fontSize: 17,
      color: "#334155",
      lineHeight: 1.8,
      textAlign: "right"
    }
  }, "📝 블로그 주" + (topStore.channels?.blog?.week || 0) + "건", el("br", null), "⭐ 영수증 주" + (topStore.channels?.receipt?.week || 0) + "건"))), el("div", {
    style: {
      fontSize: 19,
      fontWeight: 700,
      color: "#475569",
      marginBottom: 8
    }
  }, "이번달 매출 변화율 입력 (%)"), stores.map(s => el("div", {
    key: s.id,
    style: {
      background: "#0c1629",
      borderRadius: 9,
      padding: "10px 12px",
      marginBottom: 6,
      border: "1px solid #0f1e35"
    }
  }, el("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 6
    }
  }, el("div", null, el("div", {
    style: {
      fontWeight: 700,
      fontSize: 20,
      color: "#e2e8f0"
    }
  }, s.name), el("div", {
    style: {
      fontSize: 17,
      color: "#334155"
    }
  }, s.region)), el("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 5
    }
  }, el(Chip, {
    v: s.sales || 0
  }), el("span", {
    style: {
      fontSize: 16,
      fontWeight: 700,
      padding: "1px 5px",
      borderRadius: 99,
      color: SC[s.status],
      background: SB[s.status]
    }
  }, s.status === "green" ? "🟢" : s.status === "yellow" ? "⚠️" : "🔴"))), el("div", {
    style: {
      display: "flex",
      gap: 5
    }
  }, el("input", {
    type: "number",
    value: salesIn[s.id] ?? "",
    onChange: e => setSalesIn(p => ({
      ...p,
      [s.id]: e.target.value
    })),
    placeholder: "예: -8 또는 +22",
    style: {
      flex: 1,
      padding: "8px 10px",
      border: "1px solid #1e3a5f",
      borderRadius: 7,
      background: "#070d1a",
      color: "#e2e8f0",
      fontSize: 21,
      outline: "none",
      textAlign: "center",
      fontFamily: "'Space Mono',monospace",
      fontWeight: 700
    },
    onFocus: e => e.target.style.borderColor = "#f59e0b",
    onBlur: e => e.target.style.borderColor = "#1e3a5f"
  }), el("button", {
    onClick: () => {
      const v = parseFloat(salesIn[s.id]);
      if (isNaN(v)) return;
      const hist = s.history || [{
        m: "2월",
        v: 0
      }, {
        m: "3월",
        v: 0
      }, {
        m: "이번달",
        v: 0
      }];
      const newH = [...hist.slice(0, -1), {
        ...hist[hist.length - 1],
        v
      }];
      const updated = rc({
        ...s,
        sales: v,
        history: newH
      });
      saveStore(updated);
      setSalesIn(p => ({
        ...p,
        [s.id]: ""
      }));
    },
    style: {
      padding: "8px 12px",
      borderRadius: 7,
      border: "none",
      background: "#f59e0b",
      color: "#070d1a",
      fontSize: 19,
      fontWeight: 800,
      cursor: "pointer",
      flexShrink: 0
    }
  }, "저장"))))), el(SiaMark, null), el(BottomBar, null));

  // ── 매장 상세 ──────────────────────────────────────────
  if (page === "detail" && store) {
    const c = cComp(store),
      rank = sorted.findIndex(s => s.id === store.id) + 1,
      url = purl(store.placeId);
    return el("div", {
      style: {
        minHeight: "100vh",
        background: "#070d1a",
        paddingBottom: 20
      }
    }, form && el(StoreForm, {
      store: form,
      onSave: s => {
        saveStore(s);
        setSel(s.id);
        setForm(null);
      },
      onCancel: () => setForm(null)
    }), el(Header, {
      onHome,
      back: () => setPage("list"),
      right: el("div", {
        style: {
          display: "flex",
          gap: 4
        }
      }, url && el("a", {
        href: url,
        target: "_blank",
        rel: "noreferrer",
        style: {
          padding: "5px 9px",
          borderRadius: 6,
          border: "1px solid rgba(16,185,129,.3)",
          background: "rgba(16,185,129,.06)",
          color: "#10b981",
          fontSize: 18,
          fontWeight: 700,
          textDecoration: "none"
        }
      }, "🗺️"), el("button", {
        onClick: () => setForm(store),
        style: {
          padding: "5px 9px",
          borderRadius: 6,
          border: "1px solid #1e3a5f",
          background: "transparent",
          color: "#475569",
          fontSize: 18,
          cursor: "pointer"
        }
      }, "✏️"))
    }), el("div", {
      style: {
        padding: "11px 15px"
      }
    }, el(StoreActionBox, {
      store,
      top5avg
    }), el("div", {
      style: {
        height: 10
      }
    }),
    // 기본 카드
    el("div", {
      style: {
        background: "#0c1629",
        borderRadius: 11,
        padding: "14px",
        marginBottom: 9,
        border: "1px solid #334155",
        borderLeft: "4px solid " + SC[store.status]
      }
    }, el("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 10,
        gap: 8
      }
    }, el("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, el("div", {
      style: {
        fontSize: 25,
        fontWeight: 900,
        color: "#e2e8f0"
      }
    }, store.name), el("div", {
      style: {
        fontSize: 17,
        color: "#475569",
        marginTop: 2
      }
    }, store.type + " · " + store.region), store.phone && el("div", {
      style: {
        fontSize: 17,
        color: "#334155",
        marginTop: 1
      }
    }, "📞 " + store.phone), el("div", {
      style: {
        display: "flex",
        gap: 6,
        marginTop: 3,
        alignItems: "center",
        flexWrap: "wrap"
      }
    }, el("span", {
      className: "mono",
      style: {
        fontSize: 17,
        color: "#f59e0b"
      }
    }, "브랜드 " + rank + "위/" + stores.length + "개"), store.predicted !== undefined && el("span", {
      style: {
        fontSize: 17,
        fontWeight: 700,
        color: store.predicted >= 0 ? "#10b981" : "#ef4444",
        background: store.predicted >= 0 ? "rgba(16,185,129,.08)" : "rgba(239,68,68,.08)",
        padding: "1px 6px",
        borderRadius: 3
      }
    }, "예측 " + (store.predicted >= 0 ? "+" : "") + store.predicted + "%"))), el(StoreRankBadge, {
      store,
      large: true
    }), el("span", {
      style: {
        fontSize: 18,
        fontWeight: 700,
        color: SC[store.status],
        background: SB[store.status],
        padding: "3px 9px",
        borderRadius: 7,
        flexShrink: 0
      }
    }, store.status === "green" ? "🟢 정상" : store.status === "yellow" ? "⚠️ 주의" : "🔴 위험")), el("div", {
      style: {
        background: "linear-gradient(135deg,rgba(245,158,11,.1),rgba(59,130,246,.06))",
        border: "1.5px solid rgba(245,158,11,.25)",
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 9,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }
    }, el("div", null, el("div", {
      style: {
        fontSize: 18,
        color: "#94a3b8",
        fontWeight: 700,
        marginBottom: 4
      }
    }, "네이버 플레이스 · 맛집 키워드"), el("div", {
      style: {
        fontSize: 19,
        color: "#e2e8f0",
        fontWeight: 600
      }
    }, matjibKwForStore(store))), el(StoreRankBadge, {
      store,
      large: true
    })), el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(3,1fr)",
        gap: 5,
        marginBottom: 9
      }
    }, [{
      l: "매출",
      v: store.sales || 0
    }, {
      l: "방문자",
      v: store.vis || 0
    }, {
      l: "객단가",
      v: store.aov || 0
    }].map(k => {
      const p = k.v >= 0;
      return el("div", {
        key: k.l,
        style: {
          background: "#070d1a",
          borderRadius: 7,
          padding: "8px",
          textAlign: "center"
        }
      }, el("div", {
        style: {
          fontSize: 16,
          color: "#475569",
          marginBottom: 1,
          textTransform: "uppercase"
        }
      }, k.l), el("div", {
        className: "mono",
        style: {
          fontSize: 24,
          fontWeight: 700,
          color: p ? "#10b981" : "#ef4444"
        }
      }, (p ? "+" : "") + k.v + "%"));
    })),
    // SEO 3대 지표
    el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 5,
        marginBottom: 9
      }
    }, [{
      label: "키워드 순위",
      val: rkLStore(store),
      c: rkCStore(store),
      sub: rkSubStore(store),
      big: true
    }, {
      label: "네이버 방문리뷰",
      val: (store.channels?.visitor?.month ?? 0) + "건",
      c: "#818cf8",
      sub: "플레이스 실측"
    }, {
      label: "네이버 블로그",
      val: (store.channels?.blog?.month ?? 0) + "건",
      c: "#10b981",
      sub: "플레이스 실측"
    }].map(f => el("div", {
      key: f.label,
      style: {
        background: "#070d1a",
        borderRadius: 7,
        padding: "8px 6px",
        textAlign: "center",
        border: "1px solid " + f.c + "22"
      }
    }, el("div", {
      style: {
        fontSize: 16,
        color: "#475569",
        marginBottom: 2,
        textTransform: "uppercase",
        letterSpacing: .4
      }
    }, f.label), el("div", {
      className: "mono",
      style: {
        fontSize: f.big ? 20 : 11,
        fontWeight: 800,
        color: f.c
      }
    }, f.val), el("div", {
      style: {
        fontSize: 16,
        color: "#334155",
        marginTop: 1,
        lineHeight: 1.3
      }
    }, f.sub)))), store.lastSynced && el("div", {
      style: {
        fontSize: 16,
        color: "#475569",
        marginBottom: 8
      }
    }, "네이버 연동 " + String(store.lastSynced).slice(0, 16).replace("T", " ")), el("div", {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        marginBottom: 9
      }
    }, [{
      l: "광고",
      on: store.ad
    }, {
      l: "리뷰이벤트",
      on: store.ri
    }].map(ch => el("span", {
      key: ch.l,
      style: {
        fontSize: 18,
        fontWeight: 600,
        padding: "2px 7px",
        borderRadius: 4,
        color: ch.on ? "#10b981" : "#475569",
        background: ch.on ? "rgba(16,185,129,.08)" : "rgba(30,58,95,.2)",
        border: "1px solid " + (ch.on ? "rgba(16,185,129,.2)" : "#1e3a5f")
      }
    }, ch.on ? "✓" : "✗", " " + ch.l))), el("div", null, el("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        fontSize: 17,
        color: "#475569",
        marginBottom: 2
      }
    }, el("span", "마케팅 이행률"), el("span", {
      className: "mono",
      style: {
        fontWeight: 700,
        color: c >= 70 ? "#10b981" : c >= 40 ? "#f59e0b" : "#ef4444"
      }
    }, c + "%")), el(MBar2, {
      r: c
    }))),
    // 5대 채널 상세 테이블 (상위5% 벤치마킹 포함)
    el(ChannelTable, {
      store,
      top5avg
    }),
    // 마케팅 제언 (결핍 분석)
    el(MktAdvicePanel, {
      store,
      top5avg,
      topStore
    }),
    // 순위 변동 로그
    el(RankLog, {
      store
    }),
    // 매출 차트
    el(SalesChart, {
      store,
      topStore
    })));
  }

  // ── 관제센터 ───────────────────────────────────────────
  if (page === "admin") {
    const aS = [...stores].sort(prioritySort);
    const danger = stores.filter(s => s.status === "red" || (s.keywordRank || 0) > 20 || (s.receiptReviewAge || 0) > 24);
    const mktStats = [{
      l: "블로그 주5건+",
      n: stores.filter(s => (s.channels?.blog?.week || 0) >= 5).length
    }, {
      l: "인스타 주3건+",
      n: stores.filter(s => (s.channels?.insta?.week || 0) >= 3).length
    }, {
      l: "영수증 주10건+",
      n: stores.filter(s => (s.channels?.receipt?.week || 0) >= 10).length
    }, {
      l: "유튜브 월2건+",
      n: stores.filter(s => (s.channels?.youtube?.month || 0) >= 2).length
    }, {
      l: "키워드TOP10",
      n: stores.filter(s => (s.keywordRank || 99) <= 10 && (s.keywordRank || 0) !== 0).length
    }, {
      l: "리뷰24h이내",
      n: stores.filter(s => (s.receiptReviewAge || 99) <= 24).length
    }];
    const makeSV = s => {
      const c2 = cComp(s);
      const ch = s.channels || {};
      const miss = [];
      if ((ch.blog?.week || 0) < 5) miss.push("블로그(주" + (ch.blog?.week || 0) + "건/기준5)");
      if ((ch.insta?.week || 0) < 3) miss.push("인스타(주" + (ch.insta?.week || 0) + "건/기준3)");
      if ((ch.receipt?.week || 0) < 10) miss.push("영수증리뷰(주" + (ch.receipt?.week || 0) + "건/기준10)");
      if ((ch.youtube?.month || 0) < 2) miss.push("유튜브(월" + (ch.youtube?.month || 0) + "건/기준2)");
      if ((s.keywordRank || 99) > 10) miss.push("키워드순위(" + s.keywordRank + "위)");
      if ((s.receiptReviewAge || 99) > 24) miss.push("리뷰신선도(" + s.receiptReviewAge + "h)");
      const done = [];
      if ((ch.blog?.week || 0) >= 5) done.push("블로그✓");
      if ((ch.insta?.week || 0) >= 3) done.push("인스타✓");
      if ((ch.receipt?.week || 0) >= 10) done.push("영수증✓");
      if (s.ad) done.push("광고✓");
      setSvModal({
        name: s.name,
        phone: s.phone,
        placeUrl: purl(s.placeId),
        risk: c2 < 30 ? "high" : "medium",
        comp: c2,
        done,
        miss,
        next: c2 < 50 ? ((s.sales || 0) - Math.abs(s.sales || 0) * .12).toFixed(1) : ((s.sales || 0) + 1.5).toFixed(1),
        basis: c2 < 50 ? "마케팅 이행률 50% 미만 — 채널 활동 즉시 필요" : "채널 활동 중 — 꾸준한 유지 필요",
        comment: s.name + "의 마케팅 이행률은 " + c2 + "%입니다. " + (miss.length ? "부족 채널: " + miss.slice(0, 3).join(", ") + " — 즉각 보완이 필요합니다." : "전반적으로 양호하나 꾸준한 관리가 필요합니다.")
      });
    };
    const runSync = () => {
      const demo = [{
        storeId: "s1",
        keywordRank: 2,
        receiptReviewAge: 3,
        receiptReviewCount: 16,
        externalSignal: 30,
        peakReviews: 3,
        channels: {
          blog: {
            today: 2,
            week: 8,
            month: 28
          },
          insta: {
            today: 1,
            week: 4,
            month: 16
          },
          youtube: {
            today: 0,
            week: 1,
            month: 4
          },
          receipt: {
            today: 3,
            week: 16,
            month: 55
          },
          cafe: {
            today: 0,
            week: 3,
            month: 10
          }
        }
      }, {
        storeId: "s10",
        keywordRank: 31,
        receiptReviewAge: 50,
        receiptReviewCount: 0,
        externalSignal: -28,
        peakReviews: 0,
        channels: {
          blog: {
            today: 0,
            week: 0,
            month: 1
          },
          insta: {
            today: 0,
            week: 0,
            month: 2
          },
          youtube: {
            today: 0,
            week: 0,
            month: 0
          },
          receipt: {
            today: 0,
            week: 0,
            month: 3
          },
          cafe: {
            today: 0,
            week: 0,
            month: 0
          }
        }
      }, {
        storeId: "s14",
        keywordRank: 1,
        receiptReviewAge: 2,
        receiptReviewCount: 24,
        externalSignal: 50,
        peakReviews: 6,
        channels: {
          blog: {
            today: 2,
            week: 12,
            month: 44
          },
          insta: {
            today: 1,
            week: 5,
            month: 20
          },
          youtube: {
            today: 0,
            week: 2,
            month: 7
          },
          receipt: {
            today: 6,
            week: 24,
            month: 88
          },
          cafe: {
            today: 1,
            week: 6,
            month: 22
          }
        }
      }];
      api.autoSync(demo, setStores);
      setSyncLog({
        count: demo.length,
        time: new Date().toLocaleTimeString("ko-KR"),
        names: demo.map(d => stores.find(s => s.id === d.storeId)?.name || d.storeId)
      });
    };
    return el("div", {
      style: {
        minHeight: "100vh",
        background: "var(--bg)",
        paddingBottom: 68
      }
    }, el(Header, {
      onHome,
      title: "🏢 관제센터",
      right: el("button", {
        onClick: () => {
          const rows = [["순위", "매장명", "지역", "키워드순위", "블로그/주", "인스타/주", "영수증/주", "유튜브/월", "리뷰신선도", "외부신호", "이행률"], ...aS.map((s, i) => [i + 1, s.name, s.region, s.keywordRank || 0, s.channels?.blog?.week || 0, s.channels?.insta?.week || 0, s.channels?.receipt?.week || 0, s.channels?.youtube?.month || 0, s.receiptReviewAge || 0, s.externalSignal || 0, cComp(s) + "%"])];
          const csv = "\uFEFF" + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\r\n");
          const a = document.createElement("a");
          a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
          a.download = "sorimsa_v55_" + new Date().toISOString().slice(0, 10) + ".csv";
          a.click();
        },
        style: {
          padding: "5px 10px",
          borderRadius: 6,
          border: "1px solid rgba(16,185,129,.3)",
          background: "rgba(16,185,129,.06)",
          color: "#10b981",
          fontSize: 18,
          fontWeight: 700,
          cursor: "pointer"
        }
      }, "📥 CSV")
    }), el(PriorityTop3Panel, {
      stores,
      goDetail: id => go("detail", id)
    }), el(UrgentAlerts, {
      stores,
      goDetail: id => go("detail", id)
    }), el(NoticeBanner, {
      n: dismissed ? null : notice,
      onX: () => setDismissed(true)
    }), svModal && el("div", {
      style: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.92)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 300
      },
      onClick: e => e.target === e.currentTarget && setSvModal(null)
    }, el("div", {
      style: {
        background: "#0c1629",
        borderRadius: "14px 14px 0 0",
        width: "100%",
        maxWidth: 540,
        maxHeight: "88vh",
        overflow: "auto",
        padding: "0 15px 36px"
      }
    }, el("div", {
      style: {
        width: 32,
        height: 3,
        background: "#1e3a5f",
        borderRadius: 2,
        margin: "10px auto 12px"
      }
    }), el("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12
      }
    }, el("div", null, el("div", {
      className: "mono",
      style: {
        fontSize: 16,
        color: "#64748b",
        letterSpacing: 2,
        marginBottom: 2
      }
    }, "SV 마케팅 리포트"), el("div", {
      style: {
        fontSize: 22,
        fontWeight: 900,
        color: "#e2e8f0"
      }
    }, svModal.name)), el("button", {
      onClick: () => setSvModal(null),
      style: {
        padding: "5px 11px",
        borderRadius: 6,
        border: "1px solid #1e3a5f",
        background: "transparent",
        color: "#64748b",
        cursor: "pointer",
        fontSize: 19
      }
    }, "닫기")), el("div", {
      style: {
        display: "flex",
        gap: 6,
        marginBottom: 10,
        flexWrap: "wrap"
      }
    }, el("div", {
      style: {
        padding: "5px 10px",
        borderRadius: 6,
        background: svModal.risk === "high" ? "rgba(239,68,68,.15)" : "rgba(245,158,11,.1)",
        border: "1.5px solid " + (svModal.risk === "high" ? "#ef4444" : "#f59e0b"),
        fontSize: 20,
        fontWeight: 800,
        color: svModal.risk === "high" ? "#f87171" : "#f59e0b"
      }
    }, svModal.risk === "high" ? "🔴 고위험" : "⚠️ 중위험"), el("div", {
      style: {
        padding: "5px 10px",
        borderRadius: 6,
        background: "rgba(96,165,250,.08)",
        border: "1px solid #3b82f6",
        fontSize: 19,
        fontWeight: 700,
        color: "#60a5fa"
      }
    }, "이행률 " + svModal.comp + "%")), el("div", {
      style: {
        background: "#070d1a",
        borderRadius: 9,
        padding: "11px",
        marginBottom: 8
      }
    }, el("div", {
      style: {
        fontSize: 17,
        fontWeight: 700,
        color: "#f59e0b",
        letterSpacing: 1,
        marginBottom: 3
      }
    }, "📋 SV 종합 판단"), el("div", {
      style: {
        fontSize: 19,
        lineHeight: 1.7,
        color: "#64748b"
      }
    }, svModal.comment)), el("div", {
      style: {
        background: "rgba(245,158,11,.05)",
        borderRadius: 9,
        padding: "9px 11px",
        marginBottom: 8,
        border: "1px solid rgba(245,158,11,.15)"
      }
    }, el("div", {
      style: {
        fontSize: 17,
        fontWeight: 700,
        color: "#f59e0b",
        marginBottom: 2
      }
    }, "📈 다음 달 예측"), el("div", {
      className: "mono",
      style: {
        fontSize: 28,
        fontWeight: 700,
        color: parseFloat(svModal.next) >= 0 ? "#10b981" : "#ef4444"
      }
    }, svModal.next + "%"), el("div", {
      style: {
        fontSize: 17,
        color: "#475569",
        marginTop: 1
      }
    }, svModal.basis)), el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 7,
        marginBottom: 8
      }
    }, el("div", {
      style: {
        background: "rgba(16,185,129,.04)",
        borderRadius: 8,
        padding: 9,
        border: "1px solid rgba(16,185,129,.1)"
      }
    }, el("div", {
      style: {
        fontSize: 16,
        fontWeight: 700,
        color: "#10b981",
        marginBottom: 3
      }
    }, "✅ 이행 중"), svModal.done.length ? svModal.done.map((d, i) => el("div", {
      key: i,
      style: {
        fontSize: 18,
        color: "#10b981",
        marginBottom: 1
      }
    }, "• " + d)) : el("div", {
      style: {
        fontSize: 18,
        color: "#1e3a5f"
      }
    }, "없음")), el("div", {
      style: {
        background: "rgba(239,68,68,.04)",
        borderRadius: 8,
        padding: 9,
        border: "1px solid rgba(239,68,68,.1)"
      }
    }, el("div", {
      style: {
        fontSize: 16,
        fontWeight: 700,
        color: "#f87171",
        marginBottom: 3
      }
    }, "❌ 부족 채널"), svModal.miss.length ? svModal.miss.map((m, i) => el("div", {
      key: i,
      style: {
        fontSize: 18,
        color: "#f87171",
        marginBottom: 1
      }
    }, "• " + m)) : el("div", {
      style: {
        fontSize: 18,
        color: "#475569"
      }
    }, "없음"))), svModal.phone && el("div", {
      style: {
        background: "rgba(245,158,11,.05)",
        borderRadius: 8,
        padding: "8px 10px",
        border: "1px solid rgba(245,158,11,.12)",
        marginBottom: 7
      }
    }, el("div", {
      style: {
        fontSize: 16,
        fontWeight: 700,
        color: "#f59e0b",
        marginBottom: 1
      }
    }, "📞 점주 연락처"), el("div", {
      style: {
        fontSize: 21,
        fontWeight: 700,
        color: "#e2e8f0"
      }
    }, svModal.phone)), svModal.placeUrl && el("a", {
      href: svModal.placeUrl,
      target: "_blank",
      rel: "noreferrer",
      style: {
        display: "block",
        padding: 10,
        borderRadius: 8,
        border: "1px solid rgba(16,185,129,.22)",
        background: "rgba(16,185,129,.04)",
        color: "#10b981",
        fontWeight: 600,
        fontSize: 20,
        textDecoration: "none",
        textAlign: "center"
      }
    }, "🗺️ 네이버 플레이스 바로가기"))), el("div", {
      style: {
        padding: "11px 15px"
      }
    },
    // autoSync
    el("div", {
      style: {
        background: "linear-gradient(135deg,#070d1a,#0a1f12)",
        borderRadius: 10,
        padding: "12px",
        marginBottom: 11,
        border: "1px solid rgba(16,185,129,.18)"
      }
    }, el("div", {
      style: {
        fontSize: 18,
        fontWeight: 800,
        color: "#10b981",
        marginBottom: 2
      }
    }, "⚡ 외부 데이터 자동 동기화 (autoSync)"), el("div", {
      style: {
        fontSize: 18,
        color: "#475569",
        marginBottom: 8,
        lineHeight: 1.6
      }
    }, "크롤링 업체에서 채널 활동량 데이터가 들어오면 순위 변동 로그까지 ", el("strong", {
      style: {
        color: "#10b981"
      }
    }, "자동 갱신"), "됩니다."), syncLog && el("div", {
      style: {
        background: "rgba(16,185,129,.05)",
        borderRadius: 7,
        padding: "6px 9px",
        marginBottom: 7,
        border: "1px solid rgba(16,185,129,.1)"
      }
    }, el("div", {
      style: {
        fontSize: 16,
        color: "#10b981",
        fontWeight: 700,
        marginBottom: 1
      }
    }, "✅ " + syncLog.time + " 동기화 완료"), el("div", {
      style: {
        fontSize: 18,
        color: "#64748b"
      }
    }, syncLog.names.join(", ") + " (" + syncLog.count + "개)")), el("button", {
      onClick: runSync,
      style: {
        width: "100%",
        padding: "9px",
        borderRadius: 8,
        border: "none",
        background: "linear-gradient(135deg,#16a34a,#15803d)",
        color: "#fff",
        fontWeight: 800,
        fontSize: 20,
        cursor: "pointer"
      }
    }, "⚡ 채널 데이터 동기화 데모 실행")),
    // 공지
    el("div", {
      style: {
        background: "#0c1629",
        borderRadius: 10,
        padding: "12px",
        marginBottom: 11,
        border: "1px solid #1e3a5f"
      }
    }, el("div", {
      style: {
        fontSize: 19,
        fontWeight: 800,
        color: "#f59e0b",
        marginBottom: 9
      }
    }, "📢 본사 공지사항 작성"), el("div", {
      style: {
        display: "flex",
        gap: 6,
        marginBottom: 7
      }
    }, [{
      k: "info",
      l: "📢 일반",
      c: "#3b82f6"
    }, {
      k: "warn",
      l: "⚠️ 주의",
      c: "#f59e0b"
    }, {
      k: "urgent",
      l: "🚨 긴급",
      c: "#ef4444"
    }].map(t => el("button", {
      key: t.k,
      onClick: () => setNType(t.k),
      style: {
        flex: 1,
        padding: "6px 3px",
        borderRadius: 6,
        fontSize: 18,
        fontWeight: 700,
        border: "1.5px solid " + (nType === t.k ? t.c : "#1e3a5f"),
        background: nType === t.k ? t.c + "22" : "transparent",
        color: nType === t.k ? t.c : "#475569",
        cursor: "pointer"
      }
    }, t.l))), el("input", {
      placeholder: "공지 제목",
      value: nTitle,
      onChange: e => setNTitle(e.target.value),
      style: {
        width: "100%",
        padding: "7px 10px",
        border: "1px solid #1e3a5f",
        borderRadius: 6,
        background: "#070d1a",
        color: "#e2e8f0",
        fontSize: 20,
        outline: "none",
        boxSizing: "border-box",
        marginBottom: 6
      },
      onFocus: e => e.target.style.borderColor = "#f59e0b",
      onBlur: e => e.target.style.borderColor = "#1e3a5f"
    }), el("textarea", {
      placeholder: "공지 내용 (등록 즉시 모든 탭 상단 배너 표시)",
      value: nBody,
      onChange: e => setNBody(e.target.value),
      rows: 2,
      style: {
        width: "100%",
        padding: "7px 10px",
        border: "1px solid #1e3a5f",
        borderRadius: 6,
        background: "#070d1a",
        color: "#e2e8f0",
        fontSize: 20,
        outline: "none",
        resize: "vertical",
        boxSizing: "border-box",
        marginBottom: 7
      },
      onFocus: e => e.target.style.borderColor = "#f59e0b",
      onBlur: e => e.target.style.borderColor = "#1e3a5f"
    }), el("div", {
      style: {
        display: "flex",
        gap: 6
      }
    }, el("button", {
      onClick: async () => {
        if (!nTitle.trim()) return alert("제목을 입력해주세요");
        const n = {
          title: nTitle,
          body: nBody,
          type: nType,
          date: new Date().toLocaleDateString("ko-KR", {
            month: "short",
            day: "numeric"
          }),
          id: Date.now()
        };
        await api.saveNotice(n);
        setNotice(n);
        setDismissed(false);
        setNTitle("");
        setNBody("");
      },
      style: {
        flex: 1,
        padding: "9px",
        borderRadius: 7,
        border: "none",
        background: "#f59e0b",
        color: "#070d1a",
        fontWeight: 800,
        fontSize: 20,
        cursor: "pointer"
      }
    }, "📢 공지 등록"), notice && el("button", {
      onClick: async () => {
        await api.saveNotice(null);
        setNotice(null);
      },
      style: {
        padding: "9px 12px",
        borderRadius: 7,
        border: "1px solid rgba(239,68,68,.2)",
        background: "transparent",
        color: "#ef4444",
        fontSize: 19,
        cursor: "pointer"
      }
    }, "삭제")), notice && el("div", {
      style: {
        marginTop: 7,
        padding: "6px 9px",
        borderRadius: 6,
        background: "rgba(16,185,129,.04)",
        border: "1px solid rgba(16,185,129,.1)"
      }
    }, el("div", {
      style: {
        fontSize: 16,
        color: "#10b981",
        fontWeight: 700,
        marginBottom: 1
      }
    }, "현재 등록 공지 (" + notice.date + ")"), el("div", {
      style: {
        fontSize: 19,
        color: "#e2e8f0",
        fontWeight: 700
      }
    }, notice.title))),
    // KPI
    el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(3,1fr)",
        gap: 5,
        marginBottom: 10
      }
    }, [{
      l: "전체 매장",
      v: stores.length,
      c: "#e2e8f0"
    }, {
      l: "평균 매출",
      v: (avg >= 0 ? "+" : "") + avg + "%",
      c: avg >= 0 ? "#10b981" : "#ef4444"
    }, {
      l: "🔴위험",
      v: danger.length,
      c: "#ef4444"
    }, {
      l: "블로그기준↑",
      v: stores.filter(s => (s.channels?.blog?.week || 0) >= 5).length + "개",
      c: "#f59e0b"
    }, {
      l: "영수증기준↑",
      v: stores.filter(s => (s.channels?.receipt?.week || 0) >= 10).length + "개",
      c: "#10b981"
    }, {
      l: "키워드TOP10",
      v: stores.filter(s => (s.keywordRank || 99) <= 10 && (s.keywordRank || 0) !== 0).length + "개",
      c: "#60a5fa"
    }].map(k => el("div", {
      key: k.l,
      style: {
        background: "#0c1629",
        borderRadius: 8,
        padding: "8px 9px",
        border: "1px solid #0f1e35"
      }
    }, el("div", {
      style: {
        fontSize: 15,
        color: "#475569",
        fontWeight: 600,
        letterSpacing: .4,
        marginBottom: 2,
        textTransform: "uppercase"
      }
    }, k.l), el("div", {
      className: "mono",
      style: {
        fontSize: 21,
        fontWeight: 700,
        color: k.c
      }
    }, k.v)))),
    // 채널 이행 현황
    el("div", {
      style: {
        background: "#0c1629",
        borderRadius: 10,
        padding: "11px 12px",
        marginBottom: 10,
        border: "1px solid #1e3a5f"
      }
    }, el("div", {
      style: {
        fontSize: 18,
        fontWeight: 700,
        color: "#64748b",
        marginBottom: 8
      }
    }, "📣 5대 채널 + SEO 이행 현황"), el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 6
      }
    }, mktStats.map(item => {
      const p = Math.round(item.n / stores.length * 100);
      return el("div", {
        key: item.l,
        style: {
          padding: "7px 8px",
          background: "#070d1a",
          borderRadius: 6,
          border: "1px solid #0f1e35"
        }
      }, el("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 3,
          fontSize: 16
        }
      }, el("span", {
        style: {
          color: "#475569",
          fontWeight: 600
        }
      }, item.l), el("span", {
        className: "mono",
        style: {
          fontWeight: 700,
          color: p >= 50 ? "#10b981" : p >= 30 ? "#f59e0b" : "#ef4444"
        }
      }, item.n + "/" + stores.length)), el(MBar2, {
        r: p
      }));
    }))),
    // 탭
    el("div", {
      style: {
        display: "flex",
        gap: 5,
        marginBottom: 10,
        overflowX: "auto",
        paddingBottom: 2
      }
    }, [{
      k: "all",
      l: "📋 전체(" + stores.length + ")"
    }, {
      k: "danger",
      l: "🚨 위험(" + danger.length + ")"
    }, {
      k: "region",
      l: "📍 채널현황"
    }].map(t => el("button", {
      key: t.k,
      onClick: () => setAdminTab(t.k),
      style: {
        padding: "6px 10px",
        borderRadius: 6,
        fontSize: 18,
        fontWeight: 700,
        border: "1.5px solid " + (adminTab === t.k ? "#f59e0b" : "#1e3a5f"),
        background: adminTab === t.k ? "#f59e0b" : "transparent",
        color: adminTab === t.k ? "#070d1a" : "#475569",
        cursor: "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0
      }
    }, t.l))),
    // 전체
    adminTab === "all" && aS.map((s, i) => {
      const c = cComp(s),
        url = purl(s.placeId);
      const advice = getMktAdvice(s, top5avg);
      return el("div", {
        key: s.id,
        style: {
          background: "#0c1629",
          borderRadius: 10,
          padding: "10px 12px",
          marginBottom: 7,
          border: "1px solid #0f1e35",
          borderLeft: "3px solid " + SC[s.status]
        }
      }, el("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6
        }
      }, el("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 7,
          flex: 1,
          minWidth: 0
        }
      }, el("span", {
        style: {
          fontSize: 20,
          flexShrink: 0
        }
      }, i < 3 ? ["🥇", "🥈", "🥉"][i] : "#" + (i + 1)), el("div", {
        style: {
          cursor: "pointer",
          minWidth: 0
        },
        onClick: () => go("detail", s.id)
      }, el("div", {
        style: {
          fontWeight: 700,
          fontSize: 20,
          color: "#e2e8f0",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis"
        }
      }, s.name, s.lastSynced && el("span", {
        style: {
          marginLeft: 4,
          fontSize: 15,
          color: "#10b981"
        }
      }, "⚡")), el("div", {
        style: {
          fontSize: 16,
          color: "#334155"
        }
      }, s.region))), el("div", {
        style: {
          display: "flex",
          gap: 4,
          alignItems: "center",
          flexShrink: 0
        }
      }, el(Chip, {
        v: s.sales || 0
      }), el("span", {
        style: {
          fontSize: 16,
          fontWeight: 700,
          padding: "1px 5px",
          borderRadius: 99,
          color: SC[s.status],
          background: SB[s.status]
        }
      }, s.status === "green" ? "🟢" : s.status === "yellow" ? "⚠️" : "🔴"))), el("div", {
        style: {
          marginBottom: 5
        }
      }, el(ChannelTable, {
        store: s,
        top5avg,
        compact: true
      })), advice.length > 0 && el("div", {
        style: {
          fontSize: 16,
          color: "#f59e0b",
          fontWeight: 600,
          marginBottom: 5
        }
      }, "📌 부족: " + advice.slice(0, 3).map(g => g.label + "(-" + g.diff + ")").join(" / ")), el("div", {
        style: {
          marginBottom: 6
        }
      }), el(MBar2, {
        r: c
      }), el("div", {
        style: {
          display: "flex",
          gap: 4,
          marginTop: 6
        }
      }, url && el("a", {
        href: url,
        target: "_blank",
        rel: "noreferrer",
        style: {
          padding: "6px 9px",
          borderRadius: 5,
          border: "1px solid rgba(16,185,129,.22)",
          background: "rgba(16,185,129,.04)",
          color: "#10b981",
          fontSize: 18,
          textDecoration: "none"
        }
      }, "🗺️"), el("button", {
        onClick: () => makeSV(s),
        style: {
          flex: 1,
          padding: "6px",
          borderRadius: 5,
          border: "none",
          background: s.status === "red" || (s.keywordRank || 0) > 20 ? "#ef4444" : "#1e3a5f",
          color: s.status === "red" || (s.keywordRank || 0) > 20 ? "#fff" : "#64748b",
          fontSize: 18,
          fontWeight: 700,
          cursor: "pointer"
        }
      }, "🤖 SV 분석")));
    }),
    // 위험
    adminTab === "danger" && (danger.length === 0 ? el("div", {
      style: {
        textAlign: "center",
        padding: 44,
        color: "#475569"
      }
    }, "🎉 현재 위험 매장 없음") : danger.map(s => {
      const c2 = cComp(s);
      const advice = getMktAdvice(s, top5avg);
      return el("div", {
        key: s.id,
        style: {
          background: "#0c1629",
          borderRadius: 10,
          padding: "11px 12px",
          marginBottom: 7,
          border: "1px solid #0f1e35",
          borderLeft: "3px solid #ef4444"
        }
      }, el("div", {
        style: {
          fontWeight: 800,
          fontSize: 21,
          color: "#e2e8f0",
          marginBottom: 2
        }
      }, s.name), el("div", {
        style: {
          fontSize: 17,
          color: "#475569",
          marginBottom: 5
        }
      }, s.region + (s.phone ? " · " + s.phone : "")), el("div", {
        style: {
          display: "flex",
          gap: 6,
          marginBottom: 6,
          flexWrap: "wrap",
          alignItems: "center"
        }
      }, el(Chip, {
        v: s.sales || 0
      }), el("span", {
        style: {
          fontSize: 16,
          color: rkC(s.keywordRank),
          fontWeight: 600
        }
      }, rkL(s.keywordRank)), el("span", {
        style: {
          fontSize: 16,
          color: frC(s.receiptReviewAge || 99)
        }
      }, frL(s.receiptReviewAge || 99))), advice.length > 0 && el("div", {
        style: {
          fontSize: 17,
          color: "#f59e0b",
          fontWeight: 700,
          marginBottom: 6
        }
      }, "📌 부족 채널: " + advice.slice(0, 3).map(g => g.icon + " " + g.label).join(" / ")), el(MBar2, {
        r: c2
      }), el("div", {
        style: {
          display: "flex",
          gap: 5,
          marginTop: 7
        }
      }, el("button", {
        onClick: () => go("detail", s.id),
        style: {
          flex: 1,
          padding: "8px",
          borderRadius: 6,
          border: "1px solid #1e3a5f",
          background: "transparent",
          fontSize: 18,
          fontWeight: 600,
          color: "#64748b",
          cursor: "pointer"
        }
      }, "상세 →"), purl(s.placeId) && el("a", {
        href: purl(s.placeId),
        target: "_blank",
        rel: "noreferrer",
        style: {
          padding: "8px 10px",
          borderRadius: 6,
          border: "1px solid rgba(16,185,129,.22)",
          background: "rgba(16,185,129,.04)",
          color: "#10b981",
          fontSize: 18,
          fontWeight: 600,
          textDecoration: "none"
        }
      }, "🗺️"), el("button", {
        onClick: () => makeSV(s),
        style: {
          flex: 1,
          padding: "8px",
          borderRadius: 6,
          border: "none",
          background: "#ef4444",
          color: "#fff",
          fontSize: 18,
          fontWeight: 700,
          cursor: "pointer"
        }
      }, "🤖 SV")));
    })),
    // 채널 현황 (지역 탭 대체)
    adminTab === "region" && el("div", null, el("div", {
      style: {
        fontSize: 18,
        fontWeight: 700,
        color: "#64748b",
        marginBottom: 9
      }
    }, "📣 전체 매장 채널별 주간 활동량 현황"), el("div", {
      style: {
        overflowX: "auto"
      }
    }, el("table", {
      style: {
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 19
      }
    }, el("thead", null, el("tr", {
      style: {
        borderBottom: "1px solid #1e3a5f"
      }
    }, ["매장명", "📝블로그", "📸인스타", "🎬유튜브", "⭐영수증", "☕카페", "이행률"].map(h => el("th", {
      key: h,
      style: {
        padding: "5px 6px",
        textAlign: "center",
        fontSize: 16,
        color: "#475569",
        fontWeight: 700,
        textTransform: "uppercase",
        whiteSpace: "nowrap"
      }
    }, h)))), el("tbody", null, aS.map(s => el("tr", {
      key: s.id,
      style: {
        borderTop: "1px solid rgba(30,58,95,.3)",
        cursor: "pointer"
      },
      onClick: () => go("detail", s.id)
    }, el("td", {
      style: {
        padding: "7px 6px",
        fontSize: 18,
        color: "#e2e8f0",
        fontWeight: 600,
        whiteSpace: "nowrap"
      }
    }, s.name.replace("소림사 ", "")), ...CH_KEYS.map(k => {
      const v = s.channels?.[k]?.week || 0;
      const bench = top5avg?.[k]?.week || 0;
      const ok = bench === 0 || v >= bench * 0.5;
      return el("td", {
        key: k,
        style: {
          padding: "7px 6px",
          textAlign: "center"
        }
      }, el("span", {
        className: "mono",
        style: {
          fontSize: 19,
          fontWeight: 700,
          color: ok ? CH_INFO[k].color : "#ef4444"
        }
      }, v));
    }), el("td", {
      style: {
        padding: "7px 6px",
        textAlign: "center"
      }
    }, el("span", {
      className: "mono",
      style: {
        fontSize: 18,
        fontWeight: 700,
        color: cComp(s) >= 70 ? "#10b981" : cComp(s) >= 40 ? "#f59e0b" : "#ef4444"
      }
    }, cComp(s) + "%"))))))))), el(SiaMark, null), el(BottomBar, null));
  }
  return el("div", {
    style: {
      minHeight: "100vh",
      background: "#070d1a",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, el("div", {
    style: {
      color: "#334155"
    }
  }, "로딩 중..."));
}

// ═══════════════════════════════════════════════════════════
// v5.7 인증 시스템 — 관리자 / 점주 권한 분리
// ═══════════════════════════════════════════════════════════

// 점주 PIN 데이터 (localStorage에 저장, 실서버 연결 시 DB로 교체)
const STORE_PINS_KEY = "fc_store_pins_v56";
const ADMIN_PW_KEY = "fc_admin_pw_v56";
const authStore = {
  // 관리자 비번
  getAdminPw: () => localStorage.getItem(ADMIN_PW_KEY) || "1234",
  setAdminPw: pw => localStorage.setItem(ADMIN_PW_KEY, pw),
  // 점주 PIN 목록 { storeId: pin }
  getPins: () => {
    const s = localStorage.getItem(STORE_PINS_KEY);
    return s ? JSON.parse(s) : {};
  },
  setPin: (storeId, pin) => {
    const pins = authStore.getPins();
    pins[storeId] = pin;
    localStorage.setItem(STORE_PINS_KEY, JSON.stringify(pins));
  },
  removePin: storeId => {
    const pins = authStore.getPins();
    delete pins[storeId];
    localStorage.setItem(STORE_PINS_KEY, JSON.stringify(pins));
  },
  verifyPin: (storeId, pin) => {
    const pins = authStore.getPins();
    // PIN이 없으면 기본 PIN = 매장 ID 뒷 2자리
    const stored = pins[storeId] || "1234";
    return String(stored) === String(pin);
  }
};

// ── 관리자 로그인 화면 ────────────────────────────────────
function AdminLogin({
  onSuccess,
  onBack
}) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const [mode, setMode] = useState("login"); // login | changepw
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwOk, setPwOk] = useState(false);
  const el = React.createElement;
  const tryLogin = () => {
    if (pw === authStore.getAdminPw()) {
      onSuccess();
    } else {
      setErr(true);
      setTimeout(() => setErr(false), 1500);
    }
  };
  const tryChangePw = () => {
    if (curPw !== authStore.getAdminPw()) {
      setPwMsg("현재 비밀번호가 틀렸습니다");
      setPwOk(false);
      return;
    }
    if (newPw.length < 4) {
      setPwMsg("새 비밀번호는 4자 이상이어야 합니다");
      setPwOk(false);
      return;
    }
    if (newPw !== newPw2) {
      setPwMsg("새 비밀번호가 일치하지 않습니다");
      setPwOk(false);
      return;
    }
    authStore.setAdminPw(newPw);
    setPwMsg("✅ 비밀번호가 변경됐습니다!");
    setPwOk(true);
    setCurPw("");
    setNewPw("");
    setNewPw2("");
    setTimeout(() => {
      setMode("login");
      setPwMsg("");
      setPwOk(false);
    }, 1500);
  };
  const inputStyle = focus => ({
    width: "100%",
    padding: "11px 14px",
    border: "1.5px solid #1e3a5f",
    borderRadius: 9,
    background: "#070d1a",
    color: "#e2e8f0",
    fontSize: 22,
    outline: "none",
    boxSizing: "border-box",
    marginBottom: 8,
    onFocus: e => e.target.style.borderColor = "#f59e0b",
    onBlur: e => e.target.style.borderColor = "#1e3a5f"
  });
  if (mode === "changepw") return el("div", {
    style: {
      minHeight: "100vh",
      background: "#070d1a",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20
    }
  }, el("div", {
    style: {
      background: "#0c1629",
      borderRadius: 16,
      padding: "28px 22px",
      width: "100%",
      maxWidth: 320,
      border: "1px solid #1e3a5f",
      textAlign: "center"
    }
  }, el("div", {
    style: {
      fontSize: 32,
      marginBottom: 10
    }
  }, "🔑"), el("div", {
    style: {
      fontSize: 24,
      fontWeight: 900,
      color: "#e2e8f0",
      marginBottom: 4
    }
  }, "관리자 비밀번호 변경"), el("div", {
    style: {
      fontSize: 19,
      color: "#475569",
      marginBottom: 20
    }
  }, "현재 비밀번호 확인 후 변경"), [{
    ph: "현재 비밀번호",
    val: curPw,
    set: setCurPw
  }, {
    ph: "새 비밀번호 (4자 이상)",
    val: newPw,
    set: setNewPw
  }, {
    ph: "새 비밀번호 확인",
    val: newPw2,
    set: setNewPw2
  }].map((f, i) => el("input", {
    key: i,
    type: "password",
    value: f.val,
    onChange: e => {
      f.set(e.target.value);
      setPwMsg("");
    },
    onKeyDown: e => e.key === "Enter" && tryChangePw(),
    placeholder: f.ph,
    style: {
      width: "100%",
      padding: "11px 14px",
      border: "1.5px solid #1e3a5f",
      borderRadius: 9,
      background: "#070d1a",
      color: "#e2e8f0",
      fontSize: 22,
      outline: "none",
      boxSizing: "border-box",
      marginBottom: 8
    },
    onFocus: e => e.target.style.borderColor = "#f59e0b",
    onBlur: e => e.target.style.borderColor = "#1e3a5f"
  })), pwMsg && el("div", {
    style: {
      fontSize: 19,
      color: pwOk ? "#10b981" : "#ef4444",
      marginBottom: 8,
      fontWeight: 600
    }
  }, pwMsg), el("button", {
    onClick: tryChangePw,
    style: {
      width: "100%",
      padding: "12px",
      borderRadius: 9,
      border: "none",
      background: "linear-gradient(135deg,#f59e0b,#d97706)",
      color: "#070d1a",
      fontWeight: 800,
      fontSize: 22,
      cursor: "pointer",
      marginBottom: 8
    }
  }, "비밀번호 변경"), el("button", {
    onClick: () => {
      setMode("login");
      setPwMsg("");
      setCurPw("");
      setNewPw("");
      setNewPw2("");
    },
    style: {
      width: "100%",
      padding: "9px",
      borderRadius: 9,
      border: "1px solid #1e3a5f",
      background: "transparent",
      color: "#64748b",
      fontSize: 20,
      cursor: "pointer"
    }
  }, "← 돌아가기")));
  return el("div", {
    style: {
      minHeight: "100vh",
      background: "#070d1a",
      display: "flex",
      flexDirection: "column"
    }
  }, el(FranchainHomeLogo, {
    onHome: onBack,
    subtitle: "본사 관제센터 로그인"
  }), el("div", {
    style: {
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20
    }
  }, el("div", {
    style: {
      background: "#0c1629",
      borderRadius: 16,
      padding: "32px 24px",
      width: "100%",
      maxWidth: 320,
      border: "1px solid #1e3a5f",
      textAlign: "center"
    }
  }, el("div", {
    style: {
      fontSize: 36,
      marginBottom: 12
    }
  }, "🏢"), el("div", {
    style: {
      fontSize: 25,
      fontWeight: 900,
      color: "#e2e8f0",
      marginBottom: 4
    }
  }, "본사 관제센터"), el("div", {
    style: {
      fontSize: 19,
      color: "#475569",
      marginBottom: 24
    }
  }, "관리자 비밀번호를 입력하세요"), el("input", {
    type: "password",
    value: pw,
    onChange: e => {
      setPw(e.target.value);
      setErr(false);
    },
    onKeyDown: e => e.key === "Enter" && tryLogin(),
    placeholder: "비밀번호",
    autoFocus: true,
    style: {
      width: "100%",
      padding: "13px 14px",
      border: "1.5px solid " + (err ? "#ef4444" : "#1e3a5f"),
      borderRadius: 10,
      background: "#070d1a",
      color: "#e2e8f0",
      fontSize: 24,
      outline: "none",
      textAlign: "center",
      letterSpacing: 4,
      boxSizing: "border-box",
      marginBottom: 8,
      transition: "border-color .2s"
    },
    onFocus: e => e.target.style.borderColor = "#f59e0b",
    onBlur: e => e.target.style.borderColor = err ? "#ef4444" : "#1e3a5f"
  }), err && el("div", {
    style: {
      fontSize: 19,
      color: "#ef4444",
      marginBottom: 8
    }
  }, "비밀번호가 틀렸습니다"), el("button", {
    onClick: tryLogin,
    style: {
      width: "100%",
      padding: "13px",
      borderRadius: 10,
      border: "none",
      background: "linear-gradient(135deg,#f59e0b,#d97706)",
      color: "#070d1a",
      fontWeight: 800,
      fontSize: 23,
      cursor: "pointer",
      marginBottom: 8
    }
  }, "입장"), el("button", {
    onClick: () => setMode("changepw"),
    style: {
      width: "100%",
      padding: "9px",
      borderRadius: 10,
      border: "1px solid rgba(245,158,11,.2)",
      background: "transparent",
      color: "#f59e0b",
      fontSize: 19,
      cursor: "pointer",
      marginBottom: 8
    }
  }, "🔑 비밀번호 변경"), el("button", {
    onClick: onBack,
    style: {
      width: "100%",
      padding: "10px",
      borderRadius: 10,
      border: "1px solid #1e3a5f",
      background: "transparent",
      color: "#64748b",
      fontSize: 20,
      cursor: "pointer"
    }
  }, "← 홈으로"))));
}

// ── 점주 로그인 화면 ──────────────────────────────────────
function StoreLogin({
  stores,
  onSuccess,
  onBack
}) {
  const [step, setStep] = useState("select"); // select | pin
  const [selStore, setSelStore] = useState(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const [search, setSearch] = useState("");
  const el = React.createElement;
  const filtered = [...stores].filter(s => !search || (s.name + s.region).includes(search) || PRIORITY_TOP3.some(p => (p.label + p.keyword).includes(search))).sort(prioritySort);
  const tryPin = () => {
    if (authStore.verifyPin(selStore.id, pin)) {
      onSuccess(selStore.id);
    } else {
      setErr(true);
      setPin("");
      setTimeout(() => setErr(false), 1500);
    }
  };

  // 매장 선택 화면
  if (step === "select") return el("div", {
    style: {
      minHeight: "100vh",
      background: "#070d1a",
      display: "flex",
      flexDirection: "column"
    }
  }, el(FranchainHomeLogo, {
    onHome: onBack,
    subtitle: "점주 로그인 · 매장 선택"
  }), el("div", {
    style: {
      padding: "12px 16px 0",
      textAlign: "center"
    }
  }, el("div", {
    style: {
      fontSize: 32,
      marginBottom: 6
    }
  }, "🏪"), el("div", {
    style: {
      fontSize: 24,
      fontWeight: 900,
      color: "#e2e8f0",
      marginBottom: 4
    }
  }, "점주 로그인"), el("div", {
    style: {
      fontSize: 19,
      color: "#475569",
      marginBottom: 16
    }
  }, "내 매장을 선택하세요"), el("div", {
    style: {
      position: "relative",
      marginBottom: 12
    }
  }, el("span", {
    style: {
      position: "absolute",
      left: 10,
      top: "50%",
      transform: "translateY(-50%)",
      fontSize: 20,
      color: "#334155"
    }
  }, "🔍"), el("input", {
    value: search,
    onChange: e => setSearch(e.target.value),
    placeholder: "매장명 / 지역 검색",
    style: {
      width: "100%",
      padding: "9px 10px 9px 28px",
      border: "1px solid #1e3a5f",
      borderRadius: 8,
      background: "#0c1629",
      color: "#e2e8f0",
      fontSize: 20,
      outline: "none",
      boxSizing: "border-box"
    },
    onFocus: e => e.target.style.borderColor = "#f59e0b",
    onBlur: e => e.target.style.borderColor = "#1e3a5f"
  }))), !search && el("div", {
    style: {
      padding: "0 16px 8px"
    }
  }, el(PriorityTop3Panel, {
    stores,
    goDetail: id => {
      const s = stores.find(x => x.id === id);
      if (s) {
        setSelStore(s);
        setStep("pin");
      }
    }
  })), el("div", {
    style: {
      flex: 1,
      overflow: "auto",
      padding: "0 16px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, filtered.map(s => {
    const pri = PRIORITY_TOP3.find(p => p.placeId === s.placeId || p.storeId === s.id);
    const displayName = pri ? pri.label : s.name;
    const rankN = pri ? PRIORITY_PLACE_ORDER.indexOf(s.placeId) + 1 : 0;
    return el("button", {
      key: s.id,
      onClick: () => {
        setSelStore(s);
        setStep("pin");
      },
      style: {
        padding: "12px 14px",
        borderRadius: 10,
        border: pri ? "1.5px solid rgba(245,158,11,.35)" : "1px solid #1e3a5f",
        background: pri ? "linear-gradient(160deg,#0c1629,#0a1520)" : "#0c1629",
        color: "#e2e8f0",
        cursor: "pointer",
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        gap: 10
      }
    }, el("div", {
      style: {
        width: 36,
        height: 36,
        borderRadius: 9,
        background: pri ? "linear-gradient(135deg,#f59e0b,#d97706)" : "linear-gradient(135deg,#f59e0b22,#f59e0b11)",
        border: pri ? "none" : "1px solid rgba(245,158,11,.3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: pri ? 11 : 16,
        flexShrink: 0,
        fontWeight: 800,
        color: pri ? "#070d1a" : "inherit"
      }
    }, pri ? "🎯" + rankN : "🏪"), el("div", null, pri && el("div", {
      style: {
        fontSize: 16,
        color: "#f59e0b",
        fontWeight: 700,
        marginBottom: 2
      }
    }, pri.keyword), el("div", {
      style: {
        fontWeight: 700,
        fontSize: 21,
        color: "#e2e8f0"
      }
    }, displayName), el("div", {
      style: {
        fontSize: 18,
        color: "#475569",
        marginTop: 1
      }
    }, s.type + " · " + s.region)));
  })), el("div", {
    style: {
      padding: "12px 16px",
      borderTop: "1px solid #0f1e35"
    }
  }, el("button", {
    onClick: onBack,
    style: {
      width: "100%",
      padding: "11px",
      borderRadius: 9,
      border: "1px solid #1e3a5f",
      background: "transparent",
      color: "#64748b",
      fontSize: 20,
      cursor: "pointer"
    }
  }, "← 홈으로")));

  // PIN 입력 화면
  return el("div", {
    style: {
      minHeight: "100vh",
      background: "#070d1a",
      display: "flex",
      flexDirection: "column"
    }
  }, el(FranchainHomeLogo, {
    onHome: onBack,
    subtitle: "PIN 입력"
  }), el("div", {
    style: {
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20
    }
  }, el("div", {
    style: {
      background: "#0c1629",
      borderRadius: 16,
      padding: "28px 22px",
      width: "100%",
      maxWidth: 300,
      border: "1px solid #1e3a5f",
      textAlign: "center"
    }
  }, el("div", {
    style: {
      fontSize: 28,
      marginBottom: 8
    }
  }, "🏪"), el("div", {
    style: {
      fontSize: 23,
      fontWeight: 900,
      color: "#e2e8f0",
      marginBottom: 2
    }
  }, selStore.name), el("div", {
    style: {
      fontSize: 18,
      color: "#475569",
      marginBottom: 20
    }
  }, selStore.region),
  // PIN 숫자 패드
  el("div", {
    style: {
      display: "flex",
      gap: 8,
      justifyContent: "center",
      marginBottom: 12
    }
  }, [0, 1, 2, 3].map(i => el("div", {
    key: i,
    style: {
      width: 44,
      height: 44,
      borderRadius: 8,
      border: "1.5px solid " + (err ? "#ef4444" : pin.length > i ? "#f59e0b" : "#1e3a5f"),
      background: pin.length > i ? "rgba(245,158,11,.1)" : "transparent",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 28,
      color: "#f59e0b",
      transition: "all .15s"
    }
  }, pin.length > i ? "●" : "○"))), err && el("div", {
    style: {
      fontSize: 19,
      color: "#ef4444",
      marginBottom: 8
    }
  }, "PIN이 틀렸습니다"), el("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 8,
      marginBottom: 10
    }
  }, [1, 2, 3, 4, 5, 6, 7, 8, 9, "←", 0, "→"].map((k, i) => el("button", {
    key: i,
    onClick: () => {
      if (k === "←") {
        setPin(p => p.slice(0, -1));
        setErr(false);
      } else if (k === "→" && pin.length === 4) {
        tryPin();
      } else if (typeof k === "number" && pin.length < 4) {
        const newPin = pin + k;
        setPin(newPin);
        if (newPin.length === 4) {
          setTimeout(() => {
            if (authStore.verifyPin(selStore.id, newPin)) {
              onSuccess(selStore.id);
            } else {
              setErr(true);
              setPin("");
              setTimeout(() => setErr(false), 1500);
            }
          }, 200);
        }
      }
    },
    style: {
      padding: "14px",
      borderRadius: 9,
      border: "1px solid #1e3a5f",
      background: k === "→" ? "linear-gradient(135deg,#f59e0b,#d97706)" : k === "←" ? "rgba(239,68,68,.1)" : "#070d1a",
      color: k === "→" ? "#070d1a" : k === "←" ? "#ef4444" : "#e2e8f0",
      fontSize: k === "←" || k === "→" ? 16 : 18,
      fontWeight: 700,
      cursor: "pointer"
    }
  }, k === "←" ? "⌫" : k === "→" ? "✓" : k))), el("div", {
    style: {
      fontSize: 18,
      color: "#334155",
      marginBottom: 12
    }
  }, "4자리 PIN을 입력하세요"), el("button", {
    onClick: () => {
      setStep("select");
      setPin("");
      setErr(false);
    },
    style: {
      width: "100%",
      padding: "9px",
      borderRadius: 8,
      border: "1px solid #1e3a5f",
      background: "transparent",
      color: "#64748b",
      fontSize: 19,
      cursor: "pointer"
    }
  }, "← 매장 다시 선택"))));
}

// ── 점주 대시보드 ─────────────────────────────────────────
function PinChangeForm({
  storeId,
  onDone
}) {
  const [curPin, setCurPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPin2, setNewPin2] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const el = React.createElement;
  const tryChange = () => {
    if (curPin.length < 4) {
      setMsg("현재 PIN 4자리를 입력해주세요");
      setOk(false);
      return;
    }
    if (!authStore.verifyPin(storeId, curPin)) {
      setMsg("현재 PIN이 틀렸습니다");
      setOk(false);
      return;
    }
    if (newPin.length !== 4) {
      setMsg("새 PIN은 4자리여야 합니다");
      setOk(false);
      return;
    }
    if (newPin !== newPin2) {
      setMsg("새 PIN이 일치하지 않습니다");
      setOk(false);
      return;
    }
    authStore.setPin(storeId, newPin);
    setMsg("✅ PIN이 변경됐습니다!");
    setOk(true);
    setCurPin("");
    setNewPin("");
    setNewPin2("");
    setTimeout(() => onDone && onDone(), 1500);
  };
  return el("div", null, [{
    label: "현재 PIN",
    val: curPin,
    set: setCurPin
  }, {
    label: "새 PIN (4자리)",
    val: newPin,
    set: setNewPin
  }, {
    label: "새 PIN 확인",
    val: newPin2,
    set: setNewPin2
  }].map((f, i) => el("div", {
    key: i,
    style: {
      marginBottom: 10
    }
  }, el("div", {
    style: {
      fontSize: 17,
      color: "#475569",
      fontWeight: 700,
      marginBottom: 5,
      textTransform: "uppercase",
      letterSpacing: .8
    }
  }, f.label), el("input", {
    type: "password",
    value: f.val,
    maxLength: 4,
    onChange: e => {
      f.set(e.target.value.replace(/\D/g, "").slice(0, 4));
      setMsg("");
    },
    onKeyDown: e => e.key === "Enter" && tryChange(),
    placeholder: "• • • •",
    style: {
      width: "100%",
      padding: "12px",
      border: "1.5px solid #1e3a5f",
      borderRadius: 9,
      background: "#070d1a",
      color: "#f59e0b",
      fontSize: 28,
      outline: "none",
      textAlign: "center",
      letterSpacing: 8,
      boxSizing: "border-box",
      fontFamily: "'Space Mono',monospace",
      fontWeight: 700
    },
    onFocus: e => e.target.style.borderColor = "#f59e0b",
    onBlur: e => e.target.style.borderColor = "#1e3a5f"
  }))), msg && el("div", {
    style: {
      fontSize: 19,
      color: ok ? "#10b981" : "#ef4444",
      textAlign: "center",
      marginBottom: 10,
      fontWeight: 600
    }
  }, msg), el("button", {
    onClick: tryChange,
    style: {
      width: "100%",
      padding: "12px",
      borderRadius: 9,
      border: "none",
      background: "linear-gradient(135deg,#f59e0b,#d97706)",
      color: "#070d1a",
      fontWeight: 800,
      fontSize: 22,
      cursor: "pointer"
    }
  }, "PIN 변경 완료"));
}
function OwnerDashboard({
  storeId,
  stores,
  setStores,
  top5avg,
  topStore,
  onHome,
  onLogout
}) {
  const el = React.createElement;
  const store = stores.find(s => s.id === storeId);
  const [form, setForm] = useState(false);
  const [tab, setTab] = useState("overview"); // overview | channels | log
  const [salesVal, setSalesVal] = useState("");
  const [chEdit, setChEdit] = useState(false);
  const [chVals, setChVals] = useState(store ? Object.fromEntries(CH_KEYS.map(k => [k, store.channels?.[k]?.week || 0])) : {});
  if (!store) return el("div", {
    style: {
      minHeight: "100vh",
      background: "#070d1a",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, el("div", {
    style: {
      color: "#ef4444"
    }
  }, "매장 정보를 찾을 수 없습니다"));
  const c = cComp(store);
  const url = purl(store.placeId);
  const advice = getMktAdvice(store, top5avg);
  const rank = [...stores].sort((a, b) => (a.keywordRank || 99) - (b.keywordRank || 99)).findIndex(s => s.id === storeId) + 1;
  const saveStore = s => {
    setStores(p => p.map(x => x.id === s.id ? s : x));
    sbSaveStore(s).catch(() => {});
  };
  const saveSales = () => {
    const v = parseFloat(salesVal);
    if (isNaN(v)) return;
    const hist = store.history || [{
      m: "2월",
      v: 0
    }, {
      m: "3월",
      v: 0
    }, {
      m: "이번달",
      v: 0
    }];
    const newH = [...hist.slice(0, -1), {
      ...hist[hist.length - 1],
      v
    }];
    saveStore(rc({
      ...store,
      sales: v,
      history: newH
    }));
    setSalesVal("");
    alert("✅ 저장 완료!");
  };
  const saveCh = () => {
    const newCh = {};
    CH_KEYS.forEach(k => {
      const w = parseInt(chVals[k]) || 0;
      newCh[k] = {
        ...(store.channels?.[k] || {}),
        week: w,
        today: store.channels?.[k]?.today || 0,
        month: store.channels?.[k]?.month || 0
      };
    });
    // 순위 변동 로그 추가
    const today = new Date().toLocaleDateString("ko-KR", {
      month: "numeric",
      day: "numeric"
    });
    const changedChs = CH_KEYS.filter(k => chVals[k] !== (store.channels?.[k]?.week || 0));
    let newLog = [...(store.rankLog || [])];
    if (changedChs.length > 0) {
      newLog.unshift({
        date: today,
        event: changedChs.map(k => CH_INFO[k].label + " 주" + chVals[k] + "건").join(", ") + " 입력",
        rankChange: 0,
        detail: changedChs.map(k => CH_INFO[k].icon + " " + CH_INFO[k].label + ": " + chVals[k] + "건/주 입력 완료").join(" · ")
      });
      newLog = newLog.slice(0, 10);
    }
    saveStore(rc({
      ...store,
      channels: newCh,
      rankLog: newLog
    }));
    setChEdit(false);
    alert("✅ 채널 활동량 저장 완료!");
  };
  const MBar2 = ({
    r,
    c: col
  }) => {
    const color = col || (r >= 70 ? "#10b981" : r >= 40 ? "#f59e0b" : "#ef4444");
    return el("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 4
      }
    }, el("div", {
      style: {
        flex: 1,
        height: 3,
        background: "#1e3a5f",
        borderRadius: 9
      }
    }, el("div", {
      style: {
        height: "100%",
        width: r + "%",
        background: color,
        borderRadius: 9
      }
    })), el("span", {
      className: "mono",
      style: {
        fontSize: 17,
        fontWeight: 700,
        color: color,
        minWidth: 24,
        textAlign: "right"
      }
    }, r + "%"));
  };
  return el("div", {
    style: {
      minHeight: "100vh",
      background: "#070d1a",
      paddingBottom: 20
    }
  }, form && el(StoreForm, {
    store,
    onSave: s => {
      saveStore(s);
      setForm(false);
    },
    onCancel: () => setForm(false)
  }),
  // 헤더
  el("header", {
    style: {
      background: "#070d1a",
      borderBottom: "1px solid #0f1e35",
      padding: "10px 15px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      position: "sticky",
      top: 0,
      zIndex: 30
    }
  }, el("button", {
    type: "button",
    onClick: onHome,
    title: "홈으로",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      background: "none",
      border: "none",
      cursor: "pointer",
      padding: 0
    }
  }, el("div", {
    style: {
      width: 26,
      height: 26,
      background: "linear-gradient(135deg,#f59e0b,#d97706)",
      borderRadius: 6,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 22
    }
  }, "🍞"), el("div", {
    style: {
      textAlign: "left"
    }
  }, el("div", {
    className: "mono",
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: "#f59e0b"
    }
  }, "FRANCHAIN"), el("div", {
    style: {
      fontSize: 19,
      fontWeight: 800,
      color: "#e2e8f0"
    }
  }, store.name))), el("div", {
    style: {
      display: "flex",
      gap: 5
    }
  }, el("button", {
    onClick: () => setForm(true),
    style: {
      padding: "5px 9px",
      borderRadius: 6,
      border: "1px solid #1e3a5f",
      background: "transparent",
      color: "#64748b",
      fontSize: 18,
      cursor: "pointer"
    }
  }, "✏️ 수정"), el("button", {
    onClick: onLogout,
    style: {
      padding: "5px 9px",
      borderRadius: 6,
      border: "1px solid rgba(239,68,68,.25)",
      background: "transparent",
      color: "#ef4444",
      fontSize: 18,
      cursor: "pointer"
    }
  }, "로그아웃"))), el("div", {
    style: {
      padding: "11px 15px"
    }
  },
  // 상태 카드
  el("div", {
    style: {
      background: "#0c1629",
      borderRadius: 11,
      padding: "13px",
      marginBottom: 9,
      border: "1px solid #0f1e35",
      borderLeft: "3px solid " + SC[store.status]
    }
  }, el("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 9
    }
  }, el("div", null, el("div", {
    style: {
      fontSize: 24,
      fontWeight: 900,
      color: "#e2e8f0"
    }
  }, store.name), el("div", {
    style: {
      fontSize: 17,
      color: "#475569",
      marginTop: 2
    }
  }, store.type + " · " + store.region), el("div", {
    style: {
      display: "flex",
      gap: 7,
      marginTop: 4,
      alignItems: "center"
    }
  }, el("span", {
    className: "mono",
    style: {
      fontSize: 17,
      color: "#f59e0b"
    }
  }, "브랜드 " + rank + "위"), el("span", {
    style: {
      fontSize: 17,
      color: rkCStore(store),
      fontWeight: 600
    }
  }, rkLStore(store)))), el("span", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: SC[store.status],
      background: SB[store.status],
      padding: "3px 9px",
      borderRadius: 7
    }
  }, store.status === "green" ? "🟢 정상" : store.status === "yellow" ? "⚠️ 주의" : "🔴 위험")), el("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 5,
      marginBottom: 8
    }
  }, [{
    l: "매출",
    v: store.sales || 0
  }, {
    l: "방문자",
    v: store.vis || 0
  }, {
    l: "객단가",
    v: store.aov || 0
  }].map(k => {
    const p = k.v >= 0;
    return el("div", {
      key: k.l,
      style: {
        background: "#070d1a",
        borderRadius: 7,
        padding: "7px",
        textAlign: "center"
      }
    }, el("div", {
      style: {
        fontSize: 16,
        color: "#475569",
        marginBottom: 1,
        textTransform: "uppercase"
      }
    }, k.l), el("div", {
      className: "mono",
      style: {
        fontSize: 23,
        fontWeight: 700,
        color: p ? "#10b981" : "#ef4444"
      }
    }, (p ? "+" : "") + k.v + "%"));
  })), el("div", null, el("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 16,
      color: "#475569",
      marginBottom: 2
    }
  }, el("span", "마케팅 이행률"), el("span", {
    className: "mono",
    style: {
      fontWeight: 700,
      color: c >= 70 ? "#10b981" : c >= 40 ? "#f59e0b" : "#ef4444"
    }
  }, c + "%")), el(MBar2, {
    r: c
  }))),
  // 탭
  el("div", {
    style: {
      display: "flex",
      gap: 5,
      marginBottom: 10
    }
  }, [{
    k: "overview",
    l: "📊 현황"
  }, {
    k: "channels",
    l: "📣 채널 입력"
  }, {
    k: "log",
    l: "📋 활동 로그"
  }, {
    k: "pin",
    l: "🔑 PIN 변경"
  }].map(t => el("button", {
    key: t.k,
    onClick: () => setTab(t.k),
    style: {
      flex: 1,
      padding: "7px 4px",
      borderRadius: 7,
      fontSize: 18,
      fontWeight: 700,
      border: "1.5px solid " + (tab === t.k ? "#f59e0b" : "#1e3a5f"),
      background: tab === t.k ? "#f59e0b" : "transparent",
      color: tab === t.k ? "#070d1a" : "#475569",
      cursor: "pointer"
    }
  }, t.l))),
  // 현황 탭
  tab === "overview" && el("div", null,
  // 매출 입력
  el("div", {
    style: {
      background: "#0c1629",
      borderRadius: 10,
      padding: "12px",
      marginBottom: 9,
      border: "1px solid #1e3a5f"
    }
  }, el("div", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: "#64748b",
      marginBottom: 8
    }
  }, "✍️ 이번달 매출 변화율 입력"), el("div", {
    style: {
      display: "flex",
      gap: 6
    }
  }, el("input", {
    type: "number",
    value: salesVal,
    onChange: e => setSalesVal(e.target.value),
    onKeyDown: e => e.key === "Enter" && saveSales(),
    placeholder: "예: +12 또는 -8",
    style: {
      flex: 1,
      padding: "10px 11px",
      border: "1px solid #1e3a5f",
      borderRadius: 8,
      background: "#070d1a",
      color: "#e2e8f0",
      fontSize: 22,
      outline: "none",
      textAlign: "center",
      fontFamily: "'Space Mono',monospace",
      fontWeight: 700
    },
    onFocus: e => e.target.style.borderColor = "#f59e0b",
    onBlur: e => e.target.style.borderColor = "#1e3a5f"
  }), el("button", {
    onClick: saveSales,
    style: {
      padding: "10px 14px",
      borderRadius: 8,
      border: "none",
      background: "#f59e0b",
      color: "#070d1a",
      fontSize: 20,
      fontWeight: 800,
      cursor: "pointer",
      flexShrink: 0
    }
  }, "저장"))),
  // 마케팅 제언
  el(MktAdvicePanel, {
    store,
    top5avg,
    topStore
  }),
  // SEO 현황
  el("div", {
    style: {
      background: "#0c1629",
      borderRadius: 10,
      padding: "12px",
      marginBottom: 9,
      border: "1px solid #1e3a5f"
    }
  }, el("div", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: "#64748b",
      marginBottom: 9
    }
  }, "🔍 SEO 현황"), el("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 6
    }
  }, [{
    label: "키워드 순위",
    val: rkLStore(store),
    c: rkCStore(store),
    sub: rkSubStore(store)
  }, {
    label: "네이버 방문",
    val: (store.channels?.visitor?.month ?? 0) + "건",
    c: "#818cf8",
    sub: "실측"
  }, {
    label: "네이버 블로그",
    val: (store.channels?.blog?.month ?? 0) + "건",
    c: "#10b981",
    sub: "실측"
  }].map(f => el("div", {
    key: f.label,
    style: {
      background: "#070d1a",
      borderRadius: 7,
      padding: "8px 6px",
      textAlign: "center",
      border: "1px solid " + f.c + "22"
    }
  }, el("div", {
    style: {
      fontSize: 15,
      color: "#475569",
      marginBottom: 2,
      textTransform: "uppercase",
      letterSpacing: .4
    }
  }, f.label), el("div", {
    className: "mono",
    style: {
      fontSize: 19,
      fontWeight: 700,
      color: f.c
    }
  }, f.val), el("div", {
    style: {
      fontSize: 16,
      color: "#334155",
      marginTop: 1,
      lineHeight: 1.3
    }
  }, f.sub))))), el(SalesChart, {
    store,
    topStore
  })),
  // 채널 입력 탭
  tab === "channels" && el("div", null, el("div", {
    style: {
      background: "#0c1629",
      borderRadius: 10,
      padding: "13px",
      marginBottom: 9,
      border: "1px solid #1e3a5f"
    }
  }, el("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 9
    }
  }, el("div", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: "#64748b"
    }
  }, "📣 이번 주 채널별 활동량 입력"), el("div", {
    style: {
      fontSize: 17,
      color: "#475569"
    }
  }, "직접 발행/업로드 건수를 입력하세요")), el("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, CH_KEYS.map(k => {
    const info = CH_INFO[k];
    const bench = top5avg?.[k]?.week || 0;
    const curr = chVals[k] || 0;
    const ok = bench === 0 || curr >= bench * 0.5;
    return el("div", {
      key: k,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 10px",
        background: "#070d1a",
        borderRadius: 8,
        border: "1px solid " + (ok ? "#1e3a5f" : "rgba(239,68,68,.2)")
      }
    }, el("span", {
      style: {
        fontSize: 26,
        flexShrink: 0
      }
    }, info.icon), el("div", {
      style: {
        flex: 1
      }
    }, el("div", {
      style: {
        fontSize: 19,
        fontWeight: 600,
        color: "#e2e8f0",
        marginBottom: 2
      }
    }, info.label), el("div", {
      style: {
        fontSize: 17,
        color: "#475569"
      }
    }, "상위5% 기준: 주" + bench + "건" + (ok ? " ✅" : " ← 부족"))), el("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0
      }
    }, el("button", {
      onClick: () => setChVals(p => ({
        ...p,
        [k]: Math.max(0, (p[k] || 0) - 1)
      })),
      style: {
        width: 28,
        height: 28,
        borderRadius: 6,
        border: "1px solid #1e3a5f",
        background: "transparent",
        color: "#64748b",
        fontSize: 22,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }
    }, "−"), el("input", {
      type: "number",
      value: chVals[k] || 0,
      onChange: e => setChVals(p => ({
        ...p,
        [k]: parseInt(e.target.value) || 0
      })),
      style: {
        width: 52,
        padding: "5px",
        border: "1.5px solid " + (ok ? info.color : "#ef4444"),
        borderRadius: 7,
        background: "#0c1629",
        color: ok ? info.color : "#ef4444",
        fontSize: 23,
        outline: "none",
        textAlign: "center",
        fontFamily: "'Space Mono',monospace",
        fontWeight: 700
      }
    }), el("button", {
      onClick: () => setChVals(p => ({
        ...p,
        [k]: (p[k] || 0) + 1
      })),
      style: {
        width: 28,
        height: 28,
        borderRadius: 6,
        border: "1px solid #1e3a5f",
        background: "transparent",
        color: "#64748b",
        fontSize: 22,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }
    }, "+")));
  })), el("button", {
    onClick: saveCh,
    style: {
      width: "100%",
      padding: "12px",
      borderRadius: 9,
      border: "none",
      background: "linear-gradient(135deg,#f59e0b,#d97706)",
      color: "#070d1a",
      fontWeight: 800,
      fontSize: 22,
      cursor: "pointer",
      marginTop: 12
    }
  }, "✅ 활동량 저장")),
  // 채널 벤치마킹 테이블
  el(ChannelTable, {
    store,
    top5avg
  })),
  // 로그 탭
  tab === "log" && el(RankLog, {
    store
  }),
  // PIN 변경 탭
  tab === "pin" && el("div", {
    style: {
      background: "#0c1629",
      borderRadius: 10,
      padding: "20px",
      border: "1px solid #1e3a5f"
    }
  }, el("div", {
    style: {
      textAlign: "center",
      marginBottom: 20
    }
  }, el("div", {
    style: {
      fontSize: 28,
      marginBottom: 8
    }
  }, "🔑"), el("div", {
    style: {
      fontSize: 23,
      fontWeight: 800,
      color: "#e2e8f0",
      marginBottom: 4
    }
  }, "PIN 번호 변경"), el("div", {
    style: {
      fontSize: 19,
      color: "#475569"
    }
  }, "현재 PIN 확인 후 새 PIN 설정")), React.createElement(PinChangeForm, {
    storeId,
    onDone: () => setTab("overview")
  })),
  // 네이버 플레이스 링크
  url && el("a", {
    href: url,
    target: "_blank",
    rel: "noreferrer",
    style: {
      display: "block",
      padding: "11px",
      borderRadius: 9,
      border: "1px solid rgba(16,185,129,.25)",
      background: "rgba(16,185,129,.05)",
      color: "#10b981",
      fontWeight: 600,
      fontSize: 20,
      textDecoration: "none",
      textAlign: "center"
    }
  }, "🗺️ 네이버 플레이스에서 내 매장 확인")));
}

// ═══════════════════════════════════════════════════════════
// v5.7 랜딩 + ROOT (홈 버튼 + 로그인 통합)
// ═══════════════════════════════════════════════════════════

function Landing({
  onAdmin,
  onStore,
  onEnterDirect,
  stores,
  onPriorityDetail
}) {
  const el = React.createElement;
  const storeList = stores && stores.length ? stores : SD.map(s => rc(s));
  const W = {
    width: "100%",
    maxWidth: 920,
    margin: "0 auto"
  };
  const features = [{
    title: "점주",
    desc: "내 매장 순위·리뷰·오늘 할 일",
    btn: "점주 입장",
    color: "var(--ok)",
    action: onStore
  }, {
    title: "전체 현황",
    desc: "24매장 맛집 순위·조치 필요",
    btn: "대시보드",
    color: "var(--accent)",
    action: onEnterDirect
  }, {
    title: "본사 관제",
    desc: "긴급·공지·CSV",
    btn: "관제 입장",
    color: "var(--bad)",
    action: onAdmin
  }];
  return el("div", {
    style: {
      minHeight: "100vh",
      background: "var(--bg)"
    }
  }, el("nav", {
    style: {
      position: "sticky",
      top: 0,
      zIndex: 50,
      padding: "12px 20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      background: "rgba(11,15,26,.92)",
      backdropFilter: "blur(10px)",
      borderBottom: "1px solid var(--border)"
    }
  }, el("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, el("div", {
    style: {
      width: 32,
      height: 32,
      background: "var(--accent)",
      borderRadius: 8,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 18,
      color: "#0b0f1a",
      fontWeight: 900
    }
  }, "F"), el("div", null, el("div", {
    className: "mono",
    style: {
      fontSize: 15,
      fontWeight: 700,
      color: "var(--accent)"
    }
  }, "FRANCHAIN v5.9"), el("div", {
    style: {
      fontSize: 12,
      color: "var(--muted)"
    }
  }, "소림사 마케팅 관제"))), el("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, el("button", {
    onClick: onStore,
    style: {
      ...FC.btnGhost,
      padding: "8px 14px",
      fontSize: ".85rem",
      borderColor: "rgba(52,211,153,.35)",
      color: "var(--ok)"
    }
  }, "점주"), el("button", {
    onClick: onAdmin,
    style: {
      ...FC.btnGhost,
      padding: "8px 14px",
      fontSize: ".85rem"
    }
  }, "관제"))), el("main", {
    style: {
      padding: "32px 20px 48px"
    }
  }, el("div", {
    style: W
  }, el("h1", {
    style: {
      fontSize: "clamp(1.6rem,4vw,2.25rem)",
      fontWeight: 800,
      color: "var(--text)",
      marginBottom: 10,
      lineHeight: 1.25,
      textAlign: "center"
    }
  }, "맛집 검색 순위 · 오늘 할 일"), el("p", {
    style: {
      fontSize: "1rem",
      color: "var(--muted)",
      textAlign: "center",
      marginBottom: 8,
      lineHeight: 1.55
    }
  }, "이 링크 하나로 랜딩 · 매장목록 · 순위 · 점주·본사 관제까지 모두 이용합니다."), el("p", {
    style: {
      fontSize: ".85rem",
      color: "var(--dim)",
      textAlign: "center",
      marginBottom: 28
    }
  }, "순위·리뷰 = 네이버 실측 · 본사 관제는 비밀번호 필요"), el("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: 10,
      marginBottom: 24
    }
  }, [{
    num: "24",
    label: "네이버 연동"
  }, {
    num: "3",
    label: "핵심 매장"
  }, {
    num: "실측",
    label: "순위·리뷰"
  }, {
    num: "v5.9",
    label: "관제"
  }].map(s => el("div", {
    key: s.label,
    style: {
      ...FC.card,
      padding: "14px 10px",
      textAlign: "center"
    }
  }, el("div", {
    className: "mono",
    style: {
      fontSize: "1.25rem",
      fontWeight: 800,
      color: "var(--accent)"
    }
  }, s.num), el("div", {
    className: "fc-muted",
    style: {
      fontSize: ".75rem",
      marginTop: 4
    }
  }, s.label)))), el("div", {
    style: {
      marginBottom: 24
    }
  }, el(PriorityTop3Panel, {
    stores: storeList,
    goDetail: onPriorityDetail || (id => onEnterDirect && onEnterDirect())
  })), el("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 12
    }
  }, features.map(f => el("button", {
    key: f.title,
    type: "button",
    onClick: f.action,
    style: {
      ...FC.card,
      padding: "20px 16px",
      cursor: "pointer",
      textAlign: "left",
      border: "1px solid var(--border)",
      background: "var(--bg-card)"
    }
  }, el("h3", {
    style: {
      fontSize: "1.05rem",
      fontWeight: 800,
      color: "var(--text)",
      marginBottom: 6
    }
  }, f.title), el("p", {
    className: "fc-muted",
    style: {
      fontSize: ".85rem",
      marginBottom: 14,
      lineHeight: 1.45
    }
  }, f.desc), el("span", {
    style: {
      display: "inline-block",
      padding: "10px 16px",
      borderRadius: 8,
      background: f.color,
      color: "#0b0f1a",
      fontSize: ".9rem",
      fontWeight: 800
    }
  }, f.btn)))))), el("footer", {
    style: {
      borderTop: "1px solid var(--border)",
      padding: "16px",
      textAlign: "center"
    }
  }, el("div", {
    style: {
      fontSize: 12,
      color: "var(--dim)"
    }
  }, "© 소림사 FRANCHAIN v5.9 · SIA STREET")));
}

// ── ROOT ─────────────────────────────────────────────────
function Root() {
  // view: "landing" | "admin_login" | "store_login" | "admin" | "store:{id}" | "dashboard"
  const [view, setView] = useState("landing");
  const [jumpDetail, setJumpDetail] = useState(null);
  const [stores, setStores] = useState([]);
  const [daily, setDaily] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    let base = SD.map(s => rc(s));
    setStores(base);
    setLoading(false);
    (async () => {
      const dailyData = await fetchDailyJson();
      if (dailyData) setDaily(dailyData);
      if (dailyData?.stores?.length) {
        setStores(SD.map(s => mergeDailyIntoStore(rc(s), dailyRowForStore(dailyData, s))));
      }
      try {
        const rows = await sbFetch("store_data?select=*");
        if (rows?.length) {
          setStores(p => p.map(s => {
            const row = rows.find(r => r.store_id === s.id);
            if (!row) return s;
            const ch = {
              ...s.channels
            };
            if (row.channels) {
              MANUAL_CH.forEach(k => {
                if (row.channels[k]) ch[k] = {
                  ...ch[k],
                  ...row.channels[k],
                  source: "manual",
                  auto: false
                };
              });
            }
            return {
              ...s,
              channels: ch,
              keywordRank: row.keyword_rank ?? s.keywordRank,
              receiptReviewAge: row.receipt_age ?? s.receiptReviewAge,
              externalSignal: row.external_signal ?? s.externalSignal,
              sales: row.sales ?? s.sales,
              naverMeasured: s.naverMeasured,
              placeKeywordRank: s.placeKeywordRank,
              naverSync: s.naverSync,
              lastSynced: s.lastSynced,
              placePageInvalid: s.placePageInvalid,
              naverRankHint: s.naverRankHint
            };
          }));
        }
      } catch (e) {}
    })();
  }, []);
  useEffect(() => {
    (async () => {
      const n = await api.getNotice();
      if (n) setNotice(n);
    })();
  }, []);
  const top5avg = useMemo(() => getTop5Avg(stores), [stores]);
  const topStore = useMemo(() => [...stores].sort((a, b) => (a.keywordRank || 99) - (b.keywordRank || 99))[0] || stores[0], [stores]);
  const el = React.createElement;
  if (loading) return el("div", {
    style: {
      minHeight: "100vh",
      background: "#070d1a",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: 12
    }
  }, el("div", {
    style: {
      fontSize: 34
    }
  }, "🍞"), el("div", {
    className: "mono",
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: "var(--accent)"
    }
  }, "FRANCHAIN v5.9"), el("div", {
    style: {
      fontSize: 14,
      color: "var(--muted)"
    }
  }, "초기화 중..."), el("div", {
    style: {
      width: 100,
      height: 2,
      background: "#0f1e35",
      borderRadius: 99,
      overflow: "hidden",
      marginTop: 4
    }
  }, el("div", {
    style: {
      height: "100%",
      width: "60%",
      background: "#f59e0b",
      borderRadius: 99
    }
  })));

  // 랜딩
  if (view === "landing") return el(Landing, {
    onAdmin: () => setView("admin_login"),
    onStore: () => setView("store_login"),
    onEnterDirect: () => setView("dashboard"),
    stores,
    onPriorityDetail: id => {
      setJumpDetail(id);
      setView("dashboard");
    }
  });

  // 관제센터 로그인
  if (view === "admin_login") return el(AdminLogin, {
    onSuccess: () => setView("admin"),
    onBack: () => setView("landing")
  });

  // 점주 로그인
  if (view === "store_login") return el(StoreLogin, {
    stores,
    onSuccess: storeId => setView("store:" + storeId),
    onBack: () => setView("landing")
  });

  // 점주 대시보드
  if (view.startsWith("store:")) {
    const storeId = view.replace("store:", "");
    return el(OwnerDashboard, {
      storeId,
      stores,
      setStores,
      top5avg,
      topStore,
      onHome: () => setView("landing"),
      onLogout: () => setView("landing")
    });
  }

  // 관제센터 or 전체 대시보드
  return el(App, {
    startAdmin: view === "admin",
    stores,
    setStores,
    notice,
    setNotice,
    top5avg,
    topStore,
    daily,
    onHome: () => setView("landing"),
    initialDetail: jumpDetail,
    onDetailConsumed: () => setJumpDetail(null)
  });
}
try {
  ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(Root));
} catch (err) {
  document.getElementById("root").innerHTML = '<div style="padding:40px 20px;text-align:center;color:#f87171">관제 로드 실패<br><span style="font-size:12px;color:#94a3b8">' + (err && err.message ? err.message : "스크립트 오류") + '</span></div>';
}