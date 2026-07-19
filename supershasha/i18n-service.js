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
    Shopee: "상점·상품 URL",
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

const PROFILE_HINTS = {
  ko: {
    인스타그램: "프로필 URL (예: instagram.com/아이디)",
    유튜브: "채널 URL (예: youtube.com/@채널)",
    틱톡: "프로필 URL (예: tiktok.com/@아이디)",
    "X(트위터)": "프로필 URL (예: x.com/아이디)",
    페이스북: "페이지·프로필 URL",
    텔레그램: "채널 URL",
    스레드: "프로필 URL",
    default: "공개 프로필·채널 URL",
  },
  zh: { default: "公开主页/频道 URL" },
  vi: { default: "URL hồ sơ/kênh công khai" },
  th: { default: "URL โปรไฟล์/ช่องสาธารณะ" },
};

const SPEC_LABELS = {
  ko: {
    sectionWhat: "【 이 상품은 】",
    sectionWhy: "【 왜 쓰나요 】",
    sectionHow: "【 주문하면 】",
    sectionUse: "【 사용 방법 】",
    sectionDetail: "【 상품 옵션 】",
    sectionOrder: "【 주문 조건 】",
    minMax: (min, max) => `수량: ${Number(min).toLocaleString()} ~ ${Number(max).toLocaleString()} (1,000개 단위 과금)`,
    category: (c) => `카테고리: ${c}`,
    refillYes: "리필(보장): 가능 — 기간 내 줄어들면 재보충",
    refillNo: "리필(보장): 없음 — 저가·단기용",
    cancelYes: "주문 취소: 가능 (처리 전)",
    cancelNo: "주문 취소: 불가",
    dripfeed: "드립피드: 가능 — 나눠서 천천히 전송",
    avgTime: (t) => `평균 완료: ${t}`,
  },
  zh: {
    sectionWhat: "【 这是什么 】",
    sectionWhy: "【 为什么用 】",
    sectionHow: "【 下单后 】",
    sectionUse: "【 使用方法 】",
    sectionDetail: "【 商品选项 】",
    sectionOrder: "【 下单条件 】",
    minMax: (min, max) => `数量: ${Number(min).toLocaleString()} ~ ${Number(max).toLocaleString()}（按每1000计费）`,
    category: (c) => `分类: ${c}`,
    refillYes: "补量: 支持 — 掉量可补偿",
    refillNo: "补量: 不支持",
    cancelYes: "取消订单: 可以（未开始）",
    cancelNo: "取消订单: 不可以",
    dripfeed: "Dripfeed: 支持 — 分批投放",
    avgTime: (t) => `平均完成: ${t}`,
  },
  vi: {
    sectionWhat: "【 Sản phẩm này 】",
    sectionWhy: "【 Vì sao dùng 】",
    sectionHow: "【 Sau khi đặt 】",
    sectionUse: "【 Cách dùng 】",
    sectionDetail: "【 Tùy chọn 】",
    sectionOrder: "【 Điều kiện 】",
    minMax: (min, max) => `Số lượng: ${Number(min).toLocaleString()} ~ ${Number(max).toLocaleString()} (tính theo 1.000)`,
    category: (c) => `Danh mục: ${c}`,
    refillYes: "Refill: Có — drop sẽ bù lại",
    refillNo: "Refill: Không",
    cancelYes: "Hủy đơn: Có thể (chưa chạy)",
    cancelNo: "Hủy đơn: Không",
    dripfeed: "Dripfeed: Có — gửi từ từ",
    avgTime: (t) => `Hoàn thành TB: ${t}`,
  },
  th: {
    sectionWhat: "【 สินค้านี้ 】",
    sectionWhy: "【 ทำไมต้องใช้ 】",
    sectionHow: "【 หลังสั่งซื้อ 】",
    sectionUse: "【 วิธีใช้ 】",
    sectionDetail: "【 ตัวเลือก 】",
    sectionOrder: "【 เงื่อนไข 】",
    minMax: (min, max) => `จำนวน: ${Number(min).toLocaleString()} ~ ${Number(max).toLocaleString()} (คิดต่อ 1,000)`,
    category: (c) => `หมวด: ${c}`,
    refillYes: "Refill: รองรับ — หลุดแล้วเติมให้",
    refillNo: "Refill: ไม่รองรับ",
    cancelYes: "ยกเลิก: ได้ (ก่อนเริ่ม)",
    cancelNo: "ยกเลิก: ไม่ได้",
    dripfeed: "Dripfeed: รองรับ — ส่งทีละน้อย",
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

/** 상품 타깃 국가 (설명 「왜 쓰나요」 지역 문구용 — 표시 언어와 별개) */
export function detectProductRegion(svc) {
  const t = `${svc?.name || ""} ${svc?.category || ""}`.toLowerCase();
  if (/🇰🇷|\bkorea\b|korean|south korea|한국|국내|\bkr\b/.test(t)) return "ko";
  if (/🇻🇳|vietnam|vietnamese|베트남|\bvn\b/.test(t)) return "vi";
  if (/🇨🇳|china|chinese|中文|台湾|taiwan|\bcn\b/.test(t)) return "zh";
  if (/🇹🇭|thailand|\bthai\b|ไทย/.test(t)) return "th";
  return "global";
}

/** 설명·상품명 표시 언어 = UI/국가 선택 언어 (상품 타깃 국가와 무관) */
export function descriptionLangFor(_svc, uiLang = "ko") {
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
    [/Guaranteed?/gi, "보장"],
    [/All Links/gi, "모든 링크"],
    [/Country Targeted/gi, "국가 타겟"],
    [/South\b/gi, ""],
    [/Answer Poll on Post/gi, "게시물 투표 참여"],
    [/Emoji/gi, "이모지"],
    [/Story/gi, "스토리"],
    [/Post/gi, "게시물"],
    [/Note to/gi, "메모"],
    [/Add English Note to/gi, "영문 메모 추가"],
    [/点赞/g, "좋아요"],
    [/粉丝/g, "팔로워"],
    [/播放/g, "재생"],
    [/评论/g, "댓글"],
    [/分享/g, "공유"],
    [/订阅/g, "구독"],
    [/中国/g, "중국"],
    [/韩国/g, "한국"],
    [/越南/g, "베트남"],
    [/泰国/g, "태국"],
    [/速度/g, "속도"],
    [/最多/g, "최대"],
    [/最少/g, "최소"],
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

function localizeApiCategory(raw, lang) {
  const s = stripPanelBrand(String(raw || "").trim());
  if (!s) return s;
  return localizeSegment(s.replace(/\s*\|\s*/g, " · "), lang);
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

const REGION_NOTE = {
  ko: {
    ko: "한국 IP·한국어 사용자 비중이 높아 국내 마케팅·로컬 신뢰도에 적합합니다.",
    vi: "베트남 현지 사용자 기반으로 동남아 타겟 캠페인에 적합합니다.",
    zh: "중국어권 사용자 타겟에 적합합니다.",
    th: "태국 현지 사용자 타겟에 적합합니다.",
    global: "전 세계/혼합 트래픽으로 빠른 수치 성장·테스트에 적합합니다.",
  },
  zh: {
    ko: "面向韩国用户，适合本地曝光与信任度提升。",
    vi: "面向越南用户，适合东南亚本地推广。",
    zh: "面向中文用户，适合华语市场。",
    th: "面向泰国用户。",
    global: "全球混合流量，适合快速测试与放量。",
  },
  vi: {
    ko: "Nhắm người dùng Hàn Quốc, phù hợp marketing nội địa.",
    vi: "Nhắm người dùng Việt Nam, phù hợp chiến dịch địa phương.",
    zh: "Nhắm người dùng Trung Quốc.",
    th: "Nhắm người dùng Thái Lan.",
    global: "Traffic toàn cầu, phù hợp thử nghiệm nhanh.",
  },
  th: {
    ko: "กลุ่มเป้าหมายเกาหลี เหมาะกับการตลาดในประเทศ",
    vi: "กลุ่มเป้าหมายเวียดนาม",
    zh: "กลุ่มเป้าหมายจีน",
    th: "กลุ่มเป้าหมายไทย เหมาะกับตลาดในประเทศ",
    global: "ทรaffic ทั่วโลก เหมาะทดสอบและขยายยอด",
  },
};

/** kind별 — 무엇 / 왜 / 주문 후 / 사용법 */
const KIND_GUIDE = {
  ko: {
    followers: {
      what: (c) => `${c} 프로필·채널의 팔로워(구독자) 수를 늘려주는 상품입니다.`,
      why: "팔로워·구독자가 많으면 첫 방문자에게 신뢰감을 주고, 팔로우·구독 전환에 유리합니다.",
      how: "주문 접수 → 자동 처리 → 프로필·채널 숫자가 오릅니다. 속도 제한 상품은 며칠에 나눠 자연스럽게 증가할 수 있습니다. 진행률은 「주문 내역」에서 확인하세요.",
      use: (hint) => `계정을 「공개」로 두고 프로필·채널 URL을 입력하세요. (${hint})`,
    },
    likes: {
      what: (c) => `${c} 게시물·영상의 좋아요(하트·반응) 수를 올려주는 상품입니다.`,
      why: "좋아요가 많으면 게시물 신뢰도가 올라가고, 추천·탐색 노출에 도움이 될 수 있습니다.",
      how: "지정한 게시물 URL에 좋아요가 순차 반영됩니다. 처리 중에는 게시물을 삭제·비공개로 바꾸지 마세요.",
      use: (hint) => `좋아요를 올릴 게시물·릴스·쇼츠 URL을 넣으세요. (${hint})`,
    },
    views: {
      what: (c) => `${c} 영상·릴스·게시물의 조회수(재생·노출)를 늘려주는 상품입니다.`,
      why: "조회·노출이 늘면 콘텐츠가 활성화된 것처럼 보이고, 알고리즘·도달 개선에 쓰입니다.",
      how: "URL에 조회가 쌓입니다. 대량·저가형은 빠르게, 고품질형은 천천히 반영될 수 있습니다.",
      use: (hint) => `동영상·릴스·쇼츠·게시물 URL을 입력하세요. (${hint})`,
    },
    comments: {
      what: (c) => `${c} 게시물에 댓글을 달아 참여도를 높이는 상품입니다.`,
      why: "댓글이 있으면 대화가 있는 게시물처럼 보여 신뢰·참여 지표 개선에 적합합니다.",
      how: "커스텀: 원하는 문구 / 랜덤: 자동 문구가 달립니다. 처리 후 댓글 확인·관리는 직접 하세요.",
      use: (hint) => `댓글을 달 게시물 URL + (커스텀 시) 원하는 문구를 주문 메모에 적으세요. (${hint})`,
    },
    shares: {
      what: (c) => `${c} 게시물 공유·리트윗·확산 수를 늘리는 상품입니다.`,
      why: "공유·리트윗은 콘텐츠 확산 신호로, 도달 넓히기·이벤트 홍보에 씁니다.",
      how: "지정 URL에 공유·리트윗이 반영됩니다.",
      use: (hint) => `공유할 게시물·트윗 URL을 입력하세요. (${hint})`,
    },
    saves: {
      what: (c) => `${c} 게시물 저장(북마크) 수를 올리는 상품입니다.`,
      why: "저장 수는 「나중에 다시 보고 싶은 콘텐츠」 신호로, 인스타·틱톡에서 긍정 지표입니다.",
      how: "게시물 URL에 저장 수가 반영됩니다.",
      use: (hint) => `저장을 올릴 게시물 URL을 입력하세요. (${hint})`,
    },
    live: {
      what: (c) => `${c} 라이브·방송 시청자·동접을 늘리는 상품입니다.`,
      why: "라이브 동접·시청이 많으면 방송이 인기 있다는 인상을 줍니다.",
      how: "라이브 시작 전·중 URL로 주문하세요. 방송 시간·유지 시간은 상품명의 분(min) 옵션을 확인하세요.",
      use: (hint) => `라이브 방송 URL을 넣고, 상품별 최소 시청 시간을 확인하세요. (${hint})`,
    },
    general: {
      what: (c) => `${c} 계정·콘텐츠 성장을 돕는 마케팅 상품입니다.`,
      why: "SNS 지표(숫자)를 빠르게 올려 캠페인·런칭·테스트에 활용할 수 있습니다.",
      how: "주문 후 자동 처리되며, 완료·진행률은 주문 내역에서 확인합니다.",
      use: (hint) => `상품에 맞는 공개 URL을 입력하세요. (${hint})`,
    },
  },
  zh: {
    followers: { what: (c) => `提升${c}粉丝/订阅数的商品。`, why: "粉丝多可提升账号可信度与关注转化。", how: "下单后自动处理，数字会显示在主页。可在订单记录查看进度。", use: (h) => `输入公开的主页/频道 URL。（${h}）` },
    likes: { what: (c) => `提升${c}帖子/视频点赞数。`, why: "点赞多有助于信任与推荐曝光。", how: "点赞会逐步加到指定帖子，处理中请勿删帖或设私密。", use: (h) => `输入帖子/Reels/Shorts URL。（${h}）` },
    views: { what: (c) => `提升${c}播放/阅读量。`, why: "播放高有助于内容活跃与算法曝光。", how: "播放量会累计到指定 URL。", use: (h) => `输入视频/帖子 URL。（${h}）` },
    comments: { what: (c) => `为${c}帖子增加评论。`, why: "评论提升互动与真实感。", how: "自定义或随机评论会出现在帖子下。", use: (h) => `输入帖子 URL。（${h}）` },
    shares: { what: (c) => `提升${c}分享/转发。`, why: "扩大传播与触达。", how: "分享数会加到指定内容。", use: (h) => `输入帖子 URL。（${h}）` },
    saves: { what: (c) => `提升${c}收藏/保存数。`, why: "收藏是正向互动信号。", how: "保存数会反映到帖子。", use: (h) => `输入帖子 URL。（${h}）` },
    live: { what: (c) => `提升${c}直播观看/在线人数。`, why: "直播人气更直观。", how: "直播前或直播中下单，注意时长选项。", use: (h) => `输入直播 URL。（${h}）` },
    general: { what: (c) => `${c}增长类服务。`, why: "快速拉升指标用于活动与测试。", how: "自动处理，订单记录可查进度。", use: (h) => `输入对应公开 URL。（${h}）` },
  },
  vi: {
    followers: { what: (c) => `Tăng follower/đăng ký ${c}.`, why: "Nhiều follower tạo uy tín, dễ chuyển đổi theo dõi.", how: "Tự động xử lý sau đặt hàng; xem tiến độ trong lịch sử đơn.", use: (h) => `Dán URL hồ sơ/kênh công khai. (${h})` },
    likes: { what: (c) => `Tăng lượt thích bài/video ${c}.`, why: "Nhiều like giúp tăng độ tin cậy và hiển thị.", how: "Like cộng dồn vào URL; đừng xóa/ẩn bài khi đang chạy.", use: (h) => `URL bài/Reels/Shorts. (${h})` },
    views: { what: (c) => `Tăng lượt xem ${c}.`, why: "View cao hỗ trợ lan truyền nội dung.", how: "View cộng vào URL chỉ định.", use: (h) => `URL video/bài viết. (${h})` },
    comments: { what: (c) => `Tăng bình luận ${c}.`, why: "Comment tăng tương tác.", how: "Custom hoặc random comment sẽ hiện dưới bài.", use: (h) => `URL bài viết. (${h})` },
    shares: { what: (c) => `Tăng chia sẻ ${c}.`, why: "Mở rộng phạm vi tiếp cận.", how: "Chia sẻ cộng vào URL.", use: (h) => `URL bài/ tweet. (${h})` },
    saves: { what: (c) => `Tăng lượt lưu ${c}.`, why: "Lưu là tín hiệu tích cực.", how: "Lượt lưu phản ánh trên bài.", use: (h) => `URL bài viết. (${h})` },
    live: { what: (c) => `Tăng người xem live ${c}.`, why: "Live đông tạo cảm giác hot.", how: "Đặt trước/trong live; xem option phút.", use: (h) => `URL live. (${h})` },
    general: { what: (c) => `Dịch vụ tăng trưởng ${c}.`, why: "Tăng chỉ số nhanh cho chiến dịch.", how: "Tự động; theo dõi trong lịch sử.", use: (h) => `URL công khai phù hợp. (${h})` },
  },
  th: {
    followers: { what: (c) => `เพิ่มผู้ติดตาม/สมาชิก ${c}`, why: "ยอดติดตามสูงสร้างความน่าเชื่อถือ", how: "ประมวลผลอัตโนมัติ ดูความคืบหน้าในประวัติคำสั่ง", use: (h) => `วาง URL โปรไฟล์/ช่องสาธารณะ (${h})` },
    likes: { what: (c) => `เพิ่มไลก์ ${c}`, why: "ไลก์มากช่วยความน่าเชื่อถือและการมองเห็น", how: "ไลก์จะเพิ่มที่ URL ที่ระบุ", use: (h) => `URL โพสต์/Reels (${h})` },
    views: { what: (c) => `เพิ่มยอดวิว ${c}`, why: "ยอดวิวสูงช่วยการเผยแพร่", how: "ยอดวิวสะสมที่ URL", use: (h) => `URL วิดีโอ/โพสต์ (${h})` },
    comments: { what: (c) => `เพิ่มคอมเมนต์ ${c}`, why: "คอมเมนต์เพิ่มการมีส่วนร่วม", how: "คอมเมนต์จะปรากฏใต้โพสต์", use: (h) => `URL โพสต์ (${h})` },
    shares: { what: (c) => `เพิ่มแชร์ ${c}`, why: "ขยายการเข้าถึง", how: "แชร์เพิ่มที่ URL", use: (h) => `URL โพสต์ (${h})` },
    saves: { what: (c) => `เพิ่มการบันทึก ${c}`, why: "การบันทึกเป็นสัญญาณเชิงบวก", how: "ยอดบันทึกแสดงบนโพสต์", use: (h) => `URL โพสต์ (${h})` },
    live: { what: (c) => `เพิ่มผู้ชมไลฟ์ ${c}`, why: "ไลฟ์คนดูเยอะดูน่าสนใจ", how: "สั่งก่อน/ระหว่างไลฟ์ ดู option เวลา", use: (h) => `URL ไลฟ์ (${h})` },
    general: { what: (c) => `บริการเติบโต ${c}`, why: "เพิ่มตัวเลขเร็วสำหรับแคมเปญ", how: "อัตโนมัติ ตรวจในประวัติคำสั่ง", use: (h) => `URL สาธารณะที่เหมาะสม (${h})` },
  },
};

function qualityNotes(L, hasRefill, isHq, svc) {
  const n = String(svc?.name || "").toLowerCase();
  const notes = [];
  const lang = normalizeLang(L);
  if (lang === "ko") {
    if (isHq) notes.push("고품질(HQ) 옵션 — 속도·유지율 균형.");
    if (hasRefill || truthyFlag(svc?.refill)) notes.push("리필(보장) 포함 — 기간 내 줄어들면 재보충.");
    else if (/no refill|non refill|nrf|리필 없/.test(n)) notes.push("리필 없음 — 저가·단기·테스트용.");
    if (/custom/.test(n)) notes.push("커스텀 — 원하는 문구·내용 지정 가능.");
    if (/random/.test(n)) notes.push("랜덤 — 시스템이 자동 문구/계정 사용.");
  } else if (lang === "zh") {
    if (isHq) notes.push("高质量(HQ)选项。");
    if (hasRefill || truthyFlag(svc?.refill)) notes.push("含补量保障。");
    else if (/no refill|nrf/.test(n)) notes.push("无补量，适合测试。");
  } else if (lang === "vi") {
    if (isHq) notes.push("Tùy chọn HQ.");
    if (hasRefill || truthyFlag(svc?.refill)) notes.push("Có bảo hành refill.");
  } else if (lang === "th") {
    if (isHq) notes.push("ตัวเลือก HQ");
    if (hasRefill || truthyFlag(svc?.refill)) notes.push("มี refill");
  }
  return notes;
}

/** 상품 가이드 설명 — 무엇/왜/주문 후/사용법 + 옵션 + 조건 */
export function buildProviderDescription(svc, uiLang = "ko", ctx = {}) {
  const L = descriptionLangFor(svc, uiLang);
  const lab = SPEC_LABELS[L] || SPEC_LABELS.ko;
  const region = detectProductRegion(svc);
  const regionKey = region === "global" ? "global" : region;
  const {
    category = "기타",
    kind = "general",
    isKr = false,
    isVn = false,
    hasRefill = false,
    isHq = false,
    catDisplay = category,
    linkHint = "",
  } = ctx;

  const guides = KIND_GUIDE[L] || KIND_GUIDE.ko;
  const g = guides[kind] || guides.general;
  const rNotes = REGION_NOTE[L] || REGION_NOTE.ko;
  const lines = [];

  lines.push(lab.sectionWhat, g.what(catDisplay), "");

  lines.push(lab.sectionWhy, g.why);
  const rn = rNotes[regionKey] || rNotes.global;
  if (rn) lines.push(rn);
  for (const q of qualityNotes(L, hasRefill, isHq, svc)) lines.push(q);
  lines.push("");

  lines.push(lab.sectionHow, g.how, "");

  lines.push(lab.sectionUse, g.use(linkHint));
  const min = parseInt(svc?.min, 10) || 0;
  const max = parseInt(svc?.max, 10) || 0;
  if (max > 0) {
    const qtyTip =
      L === "ko"
        ? `수량은 ${min.toLocaleString()}~${max.toLocaleString()} 사이, 1,000개 단위로 과금됩니다.`
        : L === "zh"
          ? `数量范围 ${min}~${max}，按每1000计费。`
          : L === "vi"
            ? `Số lượng ${min}~${max}, tính theo 1.000.`
            : `จำนวน ${min}~${max}, คิดต่อ 1,000`;
    lines.push(qtyTip);
  }
  lines.push("");

  const name = stripPanelBrand(svc?.name || "");
  if (name) {
    lines.push(lab.sectionDetail);
    if (name.includes("|")) {
      name
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((seg) => lines.push(`· ${localizeSegment(seg, L)}`));
    } else {
      lines.push(`· ${localizeSegment(name, L)}`);
    }
    lines.push("");
  }

  lines.push(lab.sectionOrder);
  if (max > 0) lines.push(`· ${lab.minMax(min, max)}`);
  const apiCat = svc?.category || svc?.type;
  if (apiCat) lines.push(`· ${lab.category(localizeApiCategory(apiCat, L))}`);
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
  const descLang = uiLang;
  const catDisplay = categoryLabel(category, uiLang);

  const hints = LINK_HINTS[uiLang] || LINK_HINTS.ko;
  const profileKinds = new Set(["followers", "subscribers", "members", "general"]);
  const profileHints = PROFILE_HINTS[uiLang] || PROFILE_HINTS.ko;
  const linkHint =
    profileKinds.has(kind) && profileHints[category]
      ? `${hints.prefix} ${profileHints[category]}`
      : profileKinds.has(kind)
        ? `${hints.prefix} ${profileHints.default}`
        : `${hints.prefix} ${hints[category] || hints.default}`;
  const desc = buildProviderDescription(svc, uiLang, {
    category,
    kind,
    isKr,
    isVn,
    hasRefill,
    isHq,
    catDisplay,
    linkHint,
  });
  const kindLabel = KIND_LABELS[uiLang]?.[kind] || KIND_LABELS.ko[kind] || kind;

  return {
    category,
    categoryLabel: catDisplay,
    description: desc,
    displayName: localizeServiceName(svc?.name, uiLang),
    descLang,
    linkHint,
    kind,
    kindLabel,
    lang: uiLang,
  };
}
