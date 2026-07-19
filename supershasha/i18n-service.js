/** @typedef {'ko'|'zh'|'vi'|'th'} Lang */

export const SUPPORTED_LANGS = ["ko", "zh", "vi", "th"];

export function normalizeLang(raw) {
  const q = String(raw || "ko").toLowerCase().slice(0, 2);
  if (q === "zh" || q === "cn") return "zh";
  if (q === "vi" || q === "vn") return "vi";
  if (q === "th") return "th";
  return "ko";
}

const KIND_PHRASE = {
  ko: {
    followers: "팔로워·구독자 증가",
    likes: "좋아요·반응 증가",
    views: "조회수·노출 증가",
    comments: "댓글·참여 증가",
    shares: "공유·확산",
    saves: "저장·관심 지표 강화",
    live: "라이브·실시간 시청",
    general: "계정·콘텐츠 성장",
  },
  zh: {
    followers: "粉丝/订阅增长",
    likes: "点赞/互动增长",
    views: "播放量/曝光增长",
    comments: "评论/互动增长",
    shares: "分享/传播",
    saves: "收藏/兴趣指标",
    live: "直播/实时观看",
    general: "账号/内容增长",
  },
  vi: {
    followers: "Tăng follower/đăng ký",
    likes: "Tăng thích/tương tác",
    views: "Tăng lượt xem/hiển thị",
    comments: "Tăng bình luận/tương tác",
    shares: "Chia sẻ/lan truyền",
    saves: "Lưu/chỉ số quan tâm",
    live: "Live/xem trực tiếp",
    general: "Tăng trưởng tài khoản/nội dung",
  },
  th: {
    followers: "เพิ่มผู้ติดตาม/สมาชิก",
    likes: "เพิ่มไลก์/การมีส่วนร่วม",
    views: "เพิ่มยอดวิว/การมองเห็น",
    comments: "เพิ่มคอมเมนต์/การมีส่วนร่วม",
    shares: "แชร์/การเผยแพร่",
    saves: "บันทึก/ตัวชี้วัดความสนใจ",
    live: "ไลฟ์/การรับชมแบบเรียลไทม์",
    general: "การเติบโตของบัญชี/คอน텐츠",
  },
};

export const KIND_LABELS = {
  ko: {
    followers: "팔로워·구독",
    likes: "좋아요·반응",
    views: "조회·노출",
    comments: "댓글·참여",
    shares: "공유·확산",
    saves: "저장",
    live: "라이브",
    general: "기타",
  },
  zh: { followers: "粉丝/订阅", likes: "点赞", views: "播放/曝光", comments: "评论", shares: "分享", saves: "收藏", live: "直播", general: "其他" },
  vi: { followers: "Follower", likes: "Thích", views: "Lượt xem", comments: "Bình luận", shares: "Chia sẻ", saves: "Lưu", live: "Live", general: "Khác" },
  th: { followers: "ผู้ติดตาม", likes: "ไลก์", views: "ยอดวิว", comments: "คอมเมนต์", shares: "แชร์", saves: "บันทึก", live: "ไลฟ์", general: "อื่นๆ" },
};

const CAT_LABEL = {
  ko: {},
  zh: {
    인스타그램: "Instagram",
    유튜브: "YouTube",
    틱톡: "TikTok",
    "X(트위터)": "X (Twitter)",
    페이스북: "Facebook",
    텔레그램: "Telegram",
    스레드: "Threads",
    네이버: "Naver",
    카카오: "Kakao",
    기타: "其他",
  },
  vi: {
    인스타그램: "Instagram",
    유튜브: "YouTube",
    틱톡: "TikTok",
    "X(트위터)": "X (Twitter)",
    페이스북: "Facebook",
    텔레그램: "Telegram",
    스레드: "Threads",
    네이버: "Naver",
    카카오: "Kakao",
    기타: "Khác",
  },
  th: {
    인스타그램: "Instagram",
    유튜브: "YouTube",
    틱톡: "TikTok",
    "X(트witter)": "X (Twitter)",
    "X(트위터)": "X (Twitter)",
    페이스북: "Facebook",
    텔레그램: "Telegram",
    스레드: "Threads",
    네이버: "Naver",
    카카오: "Kakao",
    기타: "อื่นๆ",
  },
};

const LINK_HINTS = {
  ko: {
    인스타그램: "게시물·릴스·프로필 URL (예: instagram.com/p/… 또는 /reel/…)",
    유튜브: "동영상·쇼츠·채널 URL (예: youtube.com/watch?v=…)",
    틱톡: "틱톡 동영상 또는 프로필 URL",
    "X(트위터)": "트윗·프로필 URL",
    페이스북: "페이지·게시물·프로필 URL",
    텔레그램: "채널·게시물 URL",
    스레드: "게시물·프로필 URL",
    네이버: "블로그·스마트스토어·플레이스 URL",
    카카오: "채널·스토어 URL",
    default: "해당 플랫폼의 공개 URL을 붙여넣으세요",
    prefix: "링크 입력:",
  },
  zh: {
    인스타그램: "帖子/Reels/主页 URL（如 instagram.com/p/…）",
    유튜브: "视频/Shorts/频道 URL（如 youtube.com/watch?v=…）",
    틱톡: "TikTok 视频或主页 URL",
    "X(트위터)": "推文/主页 URL",
    페이스북: "主页/帖子 URL",
    텔레그램: "频道/帖子 URL",
    default: "请粘贴该平台的公开 URL",
    prefix: "链接:",
  },
  vi: {
    인스타그램: "URL bài/Reels/hồ sơ (vd: instagram.com/p/…)",
    유튜브: "URL video/Shorts/kênh (vd: youtube.com/watch?v=…)",
    틱톡: "URL video hoặc hồ sơ TikTok",
    "X(트위터)": "URL tweet/hồ sơ",
    페이스북: "URL trang/bài viết",
    텔레그램: "URL kênh/bài viết",
    default: "Dán URL công khai của nền tảng",
    prefix: "Liên kết:",
  },
  th: {
    인스타그램: "URL โพสต์/Reels/โปรไฟล์ (เช่น instagram.com/p/…)",
    유튜브: "URL วิดีโอ/Shorts/ช่อง (เช่น youtube.com/watch?v=…)",
    틱톡: "URL วิดีโอหรือโปรไฟล์ TikTok",
    "X(트witter)": "URL ทวีต/โปรไฟล์",
    "X(트위터)": "URL ทวีต/โปรไฟล์",
    페이스북: "URL เพจ/โพสต์",
    텔레그램: "URL ช่อง/โพสต์",
    default: "วาง URL สาธารณะของแพลตฟอร์ม",
    prefix: "ลิงก์:",
  },
};

const DESC_TPL = {
  ko: {
    intro: (cat, kind) => `${cat} ${kind} 상품입니다. `,
    kr: "한국 타겟·국내 알고리즘에 유리한 고품질 옵션으로, 국내 도달·탐색 노출 강화에 적합합니다. ",
    vn: "베트남 타겟·현지 사용자 기반 옵션으로, 동남아 시장·현지 도달 캠페인에 적합합니다. ",
    hq: "고품질(HQ) 옵션으로 자연스러운 증가 속도와 안정적인 처리에 초점을 맞췄습니다. ",
    std: "빠른 처리와 합리적인 가격으로 캠페인·테스트 주문에 적합합니다. ",
    refill: "일정 기간 드롭(감소) 발생 시 보상(리필)이 포함된 안정형 상품입니다. ",
    footer: "주문 후 공급망에서 자동 처리되며, 주문 내역에서 진행률을 확인할 수 있습니다.",
  },
  zh: {
    intro: (cat, kind) => `${cat} ${kind}服务。`,
    kr: "面向韩国用户，适合本地算法与曝光提升。",
    vn: "面向越南用户，适合东南亚本地推广。",
    hq: "高品质(HQ)选项，增长更自然、处理更稳定。",
    std: "处理快速、价格合理，适合活动与测试订单。",
    refill: "含补量(refill)保障，掉粉时可补偿。",
    footer: "下单后自动处理，可在订单记录中查看进度。",
  },
  vi: {
    intro: (cat, kind) => `Dịch vụ ${kind} trên ${cat}. `,
    kr: "Nhắm người dùng Hàn Quốc, phù hợp thuật toán và hiển thị nội địa. ",
    vn: "Nhắm người dùng Việt Nam, phù hợp chiến dịch địa phương Đông Nam Á. ",
    hq: "Tùy chọn HQ chất lượng cao, tăng trưởng tự nhiên và ổn định. ",
    std: "Xử lý nhanh, giá hợp lý, phù hợp chiến dịch và đơn thử. ",
    refill: "Có bảo hành refill khi số lượng giảm trong thời hạn. ",
    footer: "Tự động xử lý sau khi đặt; theo dõi tiến độ trong lịch sử đơn.",
  },
  th: {
    intro: (cat, kind) => `บริการ${kind}บน${cat} `,
    kr: "กลุ่มเป้าหมายเกาหลี เหมาะกับอัลกอริทึมและการมองเห็นในประเทศ ",
    vn: "กลุ่มเป้าหมายเวียดนาม เหมาะกับแคมเปญในภูมิภาค ",
    hq: "ตัวเลือก HQ คุณภาพสูง เติบโตเป็นธรรมชาติและเสถียร ",
    std: "ประมวลผลเร็ว ราคาเหมาะสม เหมาะกับแคมเปญและทดสอบ ",
    refill: "มี refill ชดเชยหากยอดลดลงภายในระยะเวลาที่กำหนด ",
    footer: "ระบบประมวลผลอัตโนมัติหลังสั่งซื้อ ตรวจความคืบหน้าในประวัติคำสั่งซื้อ",
  },
};

function categoryLabel(category, lang) {
  if (lang === "ko") return category;
  return CAT_LABEL[lang]?.[category] || category;
}

/** 공급사 브랜드만 제거 — 국기·상세 스펙은 유지 */
export function stripPanelBrand(msg) {
  if (msg == null || msg === "") return msg;
  return String(msg)
    .replace(/MoreThan\s*Panel/gi, "")
    .replace(/MoreThan/gi, "")
    .replace(/morethanpanel\.com/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function truthyFlag(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}

const SPEC_LABELS = {
  ko: {
    sectionName: "【 상품 상세 】",
    sectionOrder: "【 주문 조건 】",
    minMax: (min, max) => `수량: ${Number(min).toLocaleString()} ~ ${Number(max).toLocaleString()} (1,000개 단위 과금)`,
    category: (c) => `카테고리: ${c}`,
    type: (t) => `유형: ${t}`,
    refillYes: "리필(보장): 가능",
    refillNo: "리필(보장): 없음",
    cancelYes: "주문 취소: 가능",
    cancelNo: "주문 취소: 불가",
    dripfeed: "드립피드(분할 전송): 지원",
    avgTime: (t) => `평균 완료 시간: ${t}`,
  },
  zh: {
    sectionName: "【 商品详情 】",
    sectionOrder: "【 下单条件 】",
    minMax: (min, max) => `数量: ${Number(min).toLocaleString()} ~ ${Number(max).toLocaleString()}（按每1000计费）`,
    category: (c) => `分类: ${c}`,
    type: (t) => `类型: ${t}`,
    refillYes: "补量(Refill): 支持",
    refillNo: "补量(Refill): 不支持",
    cancelYes: "取消订单: 可以",
    cancelNo: "取消订单: 不可以",
    dripfeed: "Dripfeed: 支持",
    avgTime: (t) => `平均完成: ${t}`,
  },
  vi: {
    sectionName: "【 Chi tiết dịch vụ 】",
    sectionOrder: "【 Điều kiện đặt 】",
    minMax: (min, max) => `Số lượng: ${Number(min).toLocaleString()} ~ ${Number(max).toLocaleString()} (tính theo 1.000)`,
    category: (c) => `Danh mục: ${c}`,
    type: (t) => `Loại: ${t}`,
    refillYes: "Refill: Có",
    refillNo: "Refill: Không",
    cancelYes: "Hủy đơn: Có thể",
    cancelNo: "Hủy đơn: Không",
    dripfeed: "Dripfeed: Hỗ trợ",
    avgTime: (t) => `Hoàn thành TB: ${t}`,
  },
  th: {
    sectionName: "【 รายละเอียดบริการ 】",
    sectionOrder: "【 เงื่อนไขสั่งซื้อ 】",
    minMax: (min, max) => `จำนวน: ${Number(min).toLocaleString()} ~ ${Number(max).toLocaleString()} (คิดต่อ 1,000)`,
    category: (c) => `หมวด: ${c}`,
    type: (t) => `ประเภท: ${t}`,
    refillYes: "Refill: รองรับ",
    refillNo: "Refill: ไม่รองรับ",
    cancelYes: "ยกเลิกคำสั่ง: ได้",
    cancelNo: "ยกเลิกคำสั่ง: ไม่ได้",
    dripfeed: "Dripfeed: รองรับ",
    avgTime: (t) => `เวลาเฉลี่ย: ${t}`,
  },
};

function formatDuration(sec, lang) {
  const n = parseInt(sec, 10);
  if (!n || n <= 0) return "";
  const L = normalizeLang(lang);
  if (n < 60) return L === "ko" ? `${n}초` : `${n}s`;
  if (n < 3600) {
    const m = Math.round(n / 60);
    return L === "ko" ? `약 ${m}분` : L === "zh" ? `约${m}分钟` : L === "vi" ? `~${m} phút` : `~${m} นาที`;
  }
  const h = Math.round(n / 3600);
  return L === "ko" ? `약 ${h}시간` : L === "zh" ? `约${h}小时` : L === "vi" ? `~${h} giờ` : `~${h} ชม.`;
}

function isGeneratedDescription(text) {
  return /상품입니다\.|服务。|Dịch vụ .* trên|บริการ.*บน/.test(String(text || ""));
}

/** 상품 타깃 국가 → 설명 언어 (한국=한글, 베트남=베트남어 …) */
export function detectProductRegion(svc) {
  const t = `${svc?.name || ""} ${svc?.category || ""}`.toLowerCase();
  if (/🇰🇷|\bkorea\b|korean|south korea|한국|국내|\bkr\b/.test(t)) return "ko";
  if (/🇻🇳|vietnam|vietnamese|베트남|\bvn\b/.test(t)) return "vi";
  if (/🇨🇳|china|chinese|中文|台湾|taiwan|\bcn\b/.test(t)) return "zh";
  if (/🇹🇭|thailand|\bthai\b|ไทย/.test(t)) return "th";
  return "global";
}

/** 지역 상품은 해당 국어, 글로벌 상품은 UI 언어 */
export function descriptionLangFor(svc, uiLang = "ko") {
  const region = detectProductRegion(svc);
  if (region !== "global") return region;
  return normalizeLang(uiLang);
}

const GLOSSARY = {
  ko: [
    [/Instagram/gi, "인스타그램"],
    [/Youtube|YouTube/gi, "유튜브"],
    [/TikTok|Tik Tok/gi, "틱톡"],
    [/Facebook/gi, "페이스북"],
    [/Telegram/gi, "텔레그램"],
    [/Threads/gi, "스레드"],
    [/Twitter|X\s*\(/gi, "X(트위터) "],
    [/Spotify/gi, "스포티파이"],
    [/Naver/gi, "네이버"],
    [/Kakao/gi, "카카오"],
    [/Followers?/gi, "팔로워"],
    [/Subscribers?/gi, "구독자"],
    [/Likes?/gi, "좋아요"],
    [/Comments?/gi, "댓글"],
    [/Views?/gi, "조회수"],
    [/Shares?/gi, "공유"],
    [/Saves?/gi, "저장"],
    [/Reels?/gi, "릴스"],
    [/Live Stream|Live Views|Live/gi, "라이브"],
    [/Watch Hours?/gi, "시청시간"],
    [/Impressions?/gi, "노출"],
    [/Reach/gi, "도달"],
    [/Members?/gi, "멤버"],
    [/Korea(n)?/gi, "한국"],
    [/South Korea/gi, "한국"],
    [/Vietnam(ese)?/gi, "베트남"],
    [/Thailand|Thai/gi, "태국"],
    [/China|Chinese/gi, "중국"],
    [/Japan(ese)?/gi, "일본"],
    [/United States|USA|US\b/gi, "미국"],
    [/United Kingdom|UK\b/gi, "영국"],
    [/Worldwide|Global/gi, "글로벌"],
    [/High Quality|UHQ|HQ/gi, "고품질"],
    [/Premium/gi, "프리미엄"],
    [/Real\b/gi, "리얼"],
    [/Organic/gi, "오가닉"],
    [/Custom/gi, "커스텀"],
    [/Random/gi, "랜덤"],
    [/Female/gi, "여성"],
    [/Male/gi, "남성"],
    [/30 Day Refill|30 Days Refill/gi, "30일 리필"],
    [/365 Day Refill|Lifetime Refill|Lifetime/gi, "평생 리필"],
    [/No Refill|Non Refill/gi, "리필 없음"],
    [/Refill/gi, "리필"],
    [/Speed:?\s*/gi, "속도: "],
    [/Max\.?\s*/gi, "최대 "],
    [/Min\.?\s*/gi, "최소 "],
    [/Per Day|\/Day/gi, "/일"],
    [/Day(s)?/gi, "일"],
  ],
  zh: [
    [/Instagram/gi, "Instagram"],
    [/Followers?/gi, "粉丝"],
    [/Subscribers?/gi, "订阅"],
    [/Likes?/gi, "点赞"],
    [/Comments?/gi, "评论"],
    [/Views?/gi, "播放量"],
    [/Korea(n)?/gi, "韩国"],
    [/Vietnam(ese)?/gi, "越南"],
    [/Thailand|Thai/gi, "泰国"],
    [/China|Chinese/gi, "中国"],
    [/High Quality|UHQ|HQ/gi, "高质量"],
    [/Premium/gi, "优质"],
    [/30 Day Refill/gi, "30天补量"],
    [/Lifetime Refill|Lifetime/gi, "终身补量"],
    [/Refill/gi, "补量"],
    [/Speed:?\s*/gi, "速度: "],
    [/Max\.?\s*/gi, "最多 "],
  ],
  vi: [
    [/Instagram/gi, "Instagram"],
    [/Followers?/gi, "Follower"],
    [/Subscribers?/gi, "Người đăng ký"],
    [/Likes?/gi, "Lượt thích"],
    [/Comments?/gi, "Bình luận"],
    [/Views?/gi, "Lượt xem"],
    [/Korea(n)?/gi, "Hàn Quốc"],
    [/Vietnam(ese)?/gi, "Việt Nam"],
    [/Thailand|Thai/gi, "Thái Lan"],
    [/China|Chinese/gi, "Trung Quốc"],
    [/High Quality|UHQ|HQ/gi, "Chất lượng cao"],
    [/30 Day Refill/gi, "Bảo hành 30 ngày"],
    [/Lifetime Refill|Lifetime/gi, "Bảo hành trọn đời"],
    [/Refill/gi, "Bảo hành (refill)"],
    [/Speed:?\s*/gi, "Tốc độ: "],
    [/Max\.?\s*/gi, "Tối đa "],
  ],
  th: [
    [/Instagram/gi, "Instagram"],
    [/Followers?/gi, "ผู้ติดตาม"],
    [/Subscribers?/gi, "ผู้ติดตาม"],
    [/Likes?/gi, "ไลก์"],
    [/Comments?/gi, "คอมเมนต์"],
    [/Views?/gi, "ยอดวิว"],
    [/Korea(n)?/gi, "เกาหลี"],
    [/Vietnam(ese)?/gi, "เวียดนาม"],
    [/Thailand|Thai/gi, "ไทย"],
    [/China|Chinese/gi, "จีน"],
    [/High Quality|UHQ|HQ/gi, "คุณภาพสูง"],
    [/30 Day Refill/gi, "เติม 30 วัน"],
    [/Lifetime Refill|Lifetime/gi, "เติมตลอดชีพ"],
    [/Refill/gi, "เติม (refill)"],
    [/Speed:?\s*/gi, "ความเร็ว: "],
    [/Max\.?\s*/gi, "สูงสุด "],
  ],
};

export function localizeSegment(text, lang) {
  const L = normalizeLang(lang);
  let out = String(text || "").trim();
  if (!out) return out;
  for (const [re, rep] of GLOSSARY[L] || []) {
    out = out.replace(re, rep);
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

export function localizeServiceName(rawName, lang) {
  const name = stripPanelBrand(rawName || "");
  if (!name) return name;
  const L = normalizeLang(lang);
  if (name.includes("|")) {
    return name
      .split("|")
      .map((s) => localizeSegment(s.trim(), L))
      .filter(Boolean)
      .join(" · ");
  }
  return localizeSegment(name, L);
}

/** 모어댄 상품명·스펙 — 타깃 국가 언어로 설명 */
export function buildProviderDescription(svc, uiLang = "ko") {
  const L = descriptionLangFor(svc, uiLang);
  const lab = SPEC_LABELS[L] || SPEC_LABELS.ko;
  const lines = [];

  for (const key of ["description", "desc", "service_description"]) {
    const ext = svc?.[key];
    if (ext && String(ext).trim().length > 12 && !isGeneratedDescription(ext)) {
      lines.push(localizeSegment(String(ext).trim(), L), "");
      break;
    }
  }

  const name = stripPanelBrand(svc?.name || "");
  if (name) {
    if (name.includes("|")) {
      lines.push(lab.sectionName);
      name
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((seg) => lines.push(`· ${localizeSegment(seg, L)}`));
    } else {
      lines.push(localizeSegment(name, L));
    }
  }

  lines.push("", lab.sectionOrder);
  const min = parseInt(svc?.min, 10) || 0;
  const max = parseInt(svc?.max, 10) || 0;
  if (max > 0) lines.push(`· ${lab.minMax(min, max)}`);

  const apiCat = svc?.category || svc?.type;
  if (apiCat) lines.push(`· ${lab.category(String(apiCat))}`);

  if (truthyFlag(svc?.refill)) lines.push(`· ${lab.refillYes}`);
  else if (svc?.refill === false || svc?.refill === 0 || svc?.refill === "0") lines.push(`· ${lab.refillNo}`);

  if (truthyFlag(svc?.cancel)) lines.push(`· ${lab.cancelYes}`);
  else if (svc?.cancel === false || svc?.cancel === 0 || svc?.cancel === "0") lines.push(`· ${lab.cancelNo}`);

  if (truthyFlag(svc?.dripfeed)) lines.push(`· ${lab.dripfeed}`);

  const avg = formatDuration(svc?.avg_time, L);
  if (avg) lines.push(`· ${lab.avgTime(avg)}`);

  return lines.join("\n").trim();
}

/**
 * @param {object} svc raw service
 * @param {string} category normalized Korean category key
 * @param {string} kind service kind key
 * @param {boolean} isKr
 * @param {boolean} isVn
 * @param {boolean} hasRefill
 * @param {boolean} isHq
 * @param {Lang} lang
 */
export function buildServiceMeta(svc, category, kind, isKr, isVn, hasRefill, isHq, lang = "ko") {
  const uiLang = normalizeLang(lang);
  const descLang = descriptionLangFor(svc, uiLang);
  const catDisplay = categoryLabel(category, uiLang);
  const desc = buildProviderDescription(svc, uiLang);

  const hints = LINK_HINTS[uiLang] || LINK_HINTS.ko;
  const linkHint = `${hints.prefix} ${hints[category] || hints.default}`;
  const kindLabel = KIND_LABELS[uiLang]?.[kind] || KIND_LABELS.ko[kind] || kind;

  return {
    category,
    categoryLabel: catDisplay,
    description: desc,
    displayName: localizeServiceName(svc?.name, descLang),
    descLang,
    linkHint,
    kind,
    kindLabel,
    lang: uiLang,
  };
}
