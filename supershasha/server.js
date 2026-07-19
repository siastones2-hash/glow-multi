import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { buildServiceMeta, normalizeLang, KIND_LABELS as KIND_LABELS_I18N, stripPanelBrand } from "./i18n-service.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────────────────────
//  설정
// ─────────────────────────────────────────────────────────────
const CFG = {
  apiUrl: process.env.MORETHAN_API_URL || "https://morethanpanel.com/api/v2",
  apiKey: process.env.MORETHAN_API_KEY || "",
  secret: process.env.SESSION_SECRET || "change-me-please-very-long-secret",
  adminUser: process.env.ADMIN_USERNAME || "leestones",
  adminPass: process.env.ADMIN_PASSWORD || "1234",
  tgToken: process.env.TELEGRAM_BOT_TOKEN || "",
  tgChat: process.env.TELEGRAM_CHAT_ID || "",
  port: process.env.PORT || 3000,
  fx: parseFloat(process.env.FX_KRW) || 1400, // USD→KRW 환율
  koreaOnly: process.env.KOREA_ONLY === "true", // 실제 공급사 응답을 한국 상품만 필터
  platformSlug: process.env.PLATFORM_SLUG || "sh4-op-internal", // 사장님 전용 (총판에게 절대 공유 금지)
  masterSlug: process.env.MASTER_SLUG || "master",
  servicesSyncSec: Math.max(15, parseInt(process.env.SERVICES_SYNC_SEC, 10) || 30),
};
const DEMO = !CFG.apiKey; // API 키 없으면 데모(샘플 서비스) 모드

function stripDisplayName(msg) {
  return stripPanelBrand(msg);
}

function stripBrandText(msg) {
  if (msg == null || msg === "") return msg;
  let t = String(msg);
  t = t.replace(/MoreThan\s*Panel/gi, "");
  t = t.replace(/MoreThan/gi, "");
  t = t.replace(/morethanpanel\.com/gi, "");
  t = t.replace(/morethan/gi, "");
  t = t.replace(/\bSMM\b/gi, "");
  t = t.replace(/\bsmm\b/g, "");
  t = t.replace(/SMM\s*패널/gi, "");
  t = t.replace(/관리자\s*패널/gi, "관리자");
  t = t.replace(/패널/g, "");
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, "");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

function normalizeCategory(raw = "", name = "") {
  const t = `${raw} ${name}`.toLowerCase();
  if (/instagram|인스타/.test(t)) return "인스타그램";
  if (/youtube|유튜브/.test(t)) return "유튜브";
  if (/tiktok|틱톡/.test(t)) return "틱톡";
  if (/twitter|트위터|\bx\b/.test(t)) return "X(트위터)";
  if (/facebook|페이스북|\bfb\b/.test(t)) return "페이스북";
  if (/telegram|텔레그램/.test(t)) return "텔레그램";
  if (/threads|스레드/.test(t)) return "스레드";
  if (/naver|네이버|smartstore|스마트스토어/.test(t)) return "네이버";
  if (/kakao|카카오/.test(t)) return "카카오";
  if (/spotify|스포티/.test(t)) return "스포티파이";
  if (/sooplive|soop|숲/.test(t)) return "숲(Soop)";
  if (/linkedin|링크드인/.test(t)) return "링크드인";
  if (/pinterest|핀터/.test(t)) return "핀터레스트";
  if (/snapchat|스냅챗/.test(t)) return "스냅챗";
  if (/discord|디스코드/.test(t)) return "디스코드";
  if (/reddit|레딧/.test(t)) return "레딧";
  if (/twitch|트위치/.test(t)) return "트위치";
  if (/soundcloud/.test(t)) return "사운드클라우드";
  if (/whatsapp|왓츠앱/.test(t)) return "왓츠앱";
  if (/\bline\b|라인/.test(t)) return "라인";
  if (/\bkick\b|kick\.com/.test(t)) return "Kick";
  if (/rumble/.test(t)) return "Rumble";
  if (/quora/.test(t)) return "Quora";
  if (/google map|google business|gmb|구글맵|구글 지도/.test(t)) return "구글맵";
  if (/steam/.test(t)) return "Steam";
  if (/shopee|쇼피/.test(t)) return "Shopee";
  if (/vimeo/.test(t)) return "Vimeo";
  if (/medium\.com|\bmedium\b/.test(t)) return "Medium";
  if (/clubhouse/.test(t)) return "Clubhouse";
  if (/tumblr/.test(t)) return "Tumblr";
  if (/\bvk\b|vkontakte/.test(t)) return "VK";
  return stripBrandText(raw) || "기타";
}

function isKoreanService(svc) {
  const t = `${stripBrandText(svc.name || "")} ${svc.category || ""}`.toLowerCase();
  return /한국|korea|south korea|국내|🇰🇷|\bkr\b/.test(t);
}
function isVietnameseService(svc) {
  const t = `${stripBrandText(svc.name || "")} ${svc.category || ""}`.toLowerCase();
  return /vietnam|vietnamese|베트남|🇻🇳|\bvn\b/.test(t);
}
function isPriorityRegionService(svc) {
  return isKoreanService(svc) || isVietnameseService(svc);
}
function detectServiceKind(name = "") {
  const n = String(name).toLowerCase();
  if (/follower|팔로워|subscriber|구독|member|멤버/.test(n)) return "followers";
  if (/like|좋아요|heart|reaction|반응/.test(n)) return "likes";
  if (/view|조회|watch|시청|impression|노출|reach|도달/.test(n)) return "views";
  if (/comment|댓글/.test(n)) return "comments";
  if (/share|공유|retweet|리트윗|repost/.test(n)) return "shares";
  if (/save|저장|bookmark/.test(n)) return "saves";
  if (/live|라이브|stream/.test(n)) return "live";
  return "general";
}
function serviceMeta(svc, lang = "ko") {
  const name = stripBrandText(svc.name || "");
  const category = normalizeCategory(svc.category || svc.type || "", name);
  const kind = detectServiceKind(name);
  const isKr = isKoreanService(svc);
  const isVn = isVietnameseService(svc);
  const hasRefill = /refill|리필|refill|보장|guarantee|lifetime|평생|365|30일|7일/.test(name.toLowerCase());
  const isHq = /uhq|hq|premium|프리미엄|real|리얼|organic|오가닉|고품질/.test(name.toLowerCase());
  return buildServiceMeta(svc, category, kind, isKr, isVn, hasRefill, isHq, lang);
}
function serviceMetaKo(svc) {
  return serviceMeta(svc, "ko");
}
const PLATFORM_ORDER = [
  "인스타그램", "유튜브", "틱톡", "X(트위터)", "페이스북", "텔레그램", "스레드", "스포티파이",
  "링크드인", "핀터레스트", "스냅챗", "디스코드", "레딧", "트위치", "구글맵", "Kick", "Steam",
  "사운드클라우드", "왓츠앱", "라인", "Rumble", "Quora", "Shopee", "VK", "Tumblr", "Medium", "Vimeo", "Clubhouse",
  "숲(Soop)", "네이버", "카카오",
];

/** 모어댄 API 전체 상품 — min/max만 검증, 플랫폼·개수 제한 없음 */
function allProviderServices(arr) {
  if (!Array.isArray(arr) || !arr.length) return arr;
  const out = arr.filter((s) => {
    const name = stripBrandText(s.name || "");
    if (!name) return false;
    const min = parseInt(s.min, 10) || 0;
    const max = parseInt(s.max, 10) || 0;
    return max >= min && max > 0;
  });
  const catOrder = PLATFORM_ORDER;
  out.sort((a, b) => {
    const ca = normalizeCategory(a.category || a.type || "", a.name || "");
    const cb = normalizeCategory(b.category || b.type || "", b.name || "");
    const ia = catOrder.indexOf(ca);
    const ib = catOrder.indexOf(cb);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return stripBrandText(a.name || "").localeCompare(stripBrandText(b.name || ""), "ko");
  });
  return out;
}

function providerErrorKo(resp, forSuper = false) {
  const e = String(resp?.error || resp?.message || "").toLowerCase();
  if (e.includes("not enough funds") || e.includes("insufficient"))
    return forSuper
      ? "공급사 USD 잔액이 부족합니다. 슈퍼샤샤에서 공급 계정을 충전해야 실제 주문이 접수됩니다."
      : "공급이 일시적으로 중단되었습니다. 잠시 후 다시 시도하거나 관리자에게 문의하세요.";
  if (e.includes("invalid") && e.includes("service"))
    return "선택한 상품이 공급사에서 지원되지 않습니다. 페이지를 새로고침 후 다시 선택하세요.";
  if (e.includes("incorrect") || e.includes("invalid link"))
    return "링크 형식이 올바르지 않습니다. 해당 상품에 맞는 URL을 입력하세요.";
  const raw = resp?.error || resp?.message;
  return raw ? stripBrandText(raw) : "공급사 주문 접수에 실패했습니다.";
}
async function checkProviderFunds(svc, qty, forSuper = false) {
  if (DEMO) return null;
  const costUsd = ((parseFloat(svc.rate) || 0) * qty) / 1000;
  if (costUsd <= 0) return null;
  try {
    const bal = await moreThan({ action: "balance" });
    const usd = parseFloat(bal.balance) || 0;
    if (usd + 1e-9 < costUsd) {
      return forSuper
        ? `공급사 USD 잔액 부족 (보유 $${usd.toFixed(2)} · 필요 약 $${costUsd.toFixed(4)}). 공급 계정 충전 후 주문 가능합니다.`
        : "공급이 일시적으로 중단되었습니다. 잠시 후 다시 시도하세요.";
    }
  } catch {
    /* balance 조회 실패 시 add 단계에서 처리 */
  }
  return null;
}
function isStaffOrder(user, tenant) {
  return (
    user &&
    ["admin", "superadmin"].includes(user.role) &&
    tenant &&
    (isMasterType(tenant) || isAgencyType(tenant))
  );
}

// ─────────────────────────────────────────────────────────────
//  초간단 파일 DB
// ─────────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, "data", "db.json");
let db = {
  tenants: [],
  users: [],
  orders: [],
  topups: [],
  creditRequests: [],
  serviceOverrides: {}, // { [serviceId]: { hidden, mainMargin, customMargin } }
  settings: { fx: null, koreaOnly: null, koreaKeywords: "한국,korea,south korea,국내,kr" },
  seq: { user: 1, order: 1, topup: 1, creditReq: 1 },
};
function loadDB() {
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    if (!db.settings) db.settings = { fx: null, koreaOnly: null, koreaKeywords: "한국,korea,korean,kr" };
    if (!db.serviceOverrides) db.serviceOverrides = {};
    migrateDB();
  } catch {
    seedDB();
    saveDB();
  }
}
function isPlatformType(t) {
  return t && (t.type === "platform" || t.type === "main");
}
function isMasterType(t) {
  return t && t.type === "master";
}
function isAgencyType(t) {
  return t && (t.type === "agency" || t.type === "partner");
}
function platformTenant() {
  return db.tenants.find(isPlatformType);
}
function masterTenant() {
  return db.tenants.find(isMasterType);
}
function masterTenants() {
  return db.tenants.filter(isMasterType);
}
function parentMaster(tenant) {
  if (!tenant) return null;
  if (isMasterType(tenant)) return tenant;
  if (isAgencyType(tenant) && tenant.parentId) {
    return db.tenants.find((t) => t.id === tenant.parentId && isMasterType(t));
  }
  return masterTenant();
}
function platformSlug() {
  return CFG.platformSlug;
}
function isPlatformSlug(slug) {
  return slug === platformSlug() || slug === "main"; // main = 구버전 호환
}
function defaultPublicSlug() {
  return masterTenant()?.slug || CFG.masterSlug;
}
function resolveTenantSlug(slug, allowPlatform = false) {
  if (!slug || slug === "main") {
    if (allowPlatform && slug === "main") return platformSlug();
    return slug === "main" && allowPlatform ? platformSlug() : defaultPublicSlug();
  }
  if (isPlatformSlug(slug)) return allowPlatform ? platformSlug() : null;
  return slug;
}
function agenciesOfMaster(masterId) {
  return db.tenants.filter((t) => isAgencyType(t) && t.parentId === masterId);
}
function userTenant(user) {
  return db.tenants.find((t) => t.id === user.tenantId);
}
function isMasterAdmin(user) {
  return user?.role === "admin" && isMasterType(userTenant(user));
}
function adminOrderScope(user) {
  if (user.role === "superadmin") return db.orders;
  const ut = userTenant(user);
  if (isMasterType(ut)) {
    const ids = new Set([ut.id, ...agenciesOfMaster(ut.id).map((t) => t.id)]);
    return db.orders.filter((o) => ids.has(o.tenantId));
  }
  return db.orders.filter((o) => o.tenantId === user.tenantId);
}
function adminMemberScope(user) {
  if (user.role === "superadmin") return db.users;
  const ut = userTenant(user);
  if (isMasterType(ut)) {
    const ids = new Set([ut.id, ...agenciesOfMaster(ut.id).map((t) => t.id)]);
    return db.users.filter((u) => ids.has(u.tenantId));
  }
  return db.users.filter((u) => u.tenantId === user.tenantId);
}
function adminTopupScope(user) {
  if (user.role === "superadmin") return db.topups;
  const ut = userTenant(user);
  if (isMasterType(ut)) {
    const ids = new Set(agenciesOfMaster(ut.id).map((t) => t.id));
    return db.topups.filter((t) => ids.has(t.tenantId));
  }
  return db.topups.filter((t) => t.tenantId === user.tenantId);
}
function adminCreditRequestScope(user) {
  if (user.role === "superadmin") return db.creditRequests || [];
  const ut = userTenant(user);
  if (isMasterType(ut)) {
    const ids = new Set(agenciesOfMaster(ut.id).map((t) => t.id));
    return (db.creditRequests || []).filter((r) => ids.has(r.tenantId));
  }
  return (db.creditRequests || []).filter((r) => r.tenantId === user.tenantId);
}
function canManageTenant(user, tenantId) {
  if (user.role === "superadmin") return true;
  const t = db.tenants.find((x) => x.id === tenantId);
  if (!t) return false;
  if (isMasterAdmin(user) && isAgencyType(t) && t.parentId === user.tenantId) return true;
  return user.role === "admin" && user.tenantId === tenantId;
}
function migrateDB() {
  let changed = false;
  for (const t of db.tenants) {
    if (t.type === "main") {
      t.type = "platform";
      changed = true;
    }
    if (t.type === "partner") {
      t.type = "agency";
      changed = true;
    }
  }
  if (!masterTenant()) {
    const plat = platformTenant();
    db.tenants.push({
      id: "master",
      name: "본사",
      type: "master",
      slug: CFG.masterSlug,
      parentId: plat?.id || "platform",
      marginPercent: 20,
      creditBalance: 500000,
      brand: "본사",
      active: true,
    });
    changed = true;
  }
  const plat = platformTenant();
  if (plat && plat.slug !== platformSlug()) {
    plat.slug = platformSlug();
    plat.name = "슈퍼샤샤";
    plat.brand = "슈퍼샤샤";
    changed = true;
  }
  if (
    plat &&
    (plat.name === "SUPERSHASHA" ||
      plat.name === "슈퍼시아" ||
      plat.brand === "슈퍼시아" ||
      plat.brand === "플랫폼" ||
      plat.name === "운영" ||
      plat.brand === "운영" ||
      plat.name === "관리자")
  ) {
    plat.name = "슈퍼샤샤";
    plat.brand = "슈퍼샤샤";
    changed = true;
  }
  for (const t of db.tenants) {
    if (isAgencyType(t) && !t.parentId) {
      t.parentId = masterTenant()?.id || "master";
      changed = true;
    }
    if (isMasterType(t) && /슈퍼시아|슈퍼샤샤|supershasha|supersia|supersha/i.test(`${t.name || ""} ${t.brand || ""}`)) {
      t.name = "본사";
      t.brand = "본사";
      changed = true;
    }
    if (t.slug === "nine" && t.name === "NINE STORY") {
      t.name = "나인스토리";
      t.brand = "나인스토리";
      changed = true;
    }
  }
  if (!db.creditRequests) {
    db.creditRequests = [];
    changed = true;
  }
  if (!db.seq.creditReq) db.seq.creditReq = 1;
  const ptg = ensureTelegramSettings();
  if (ptg.notifySignups !== false || ptg.notifyOrders !== false || ptg.notifyTopups !== false) {
    ptg.notifySignups = false;
    ptg.notifyOrders = false;
    ptg.notifyTopups = false;
    if (ptg.notifyCreditReq == null) ptg.notifyCreditReq = true;
    changed = true;
  }
  ensureSeedPasswords();
  if (changed) saveDB();
}
function ensureSeedPasswords() {
  const defs = [
    { username: CFG.adminUser, password: CFG.adminPass },
    { username: "master", password: "master1234" },
    { username: "nineadmin", password: "nine1234" },
  ];
  let changed = false;
  for (const d of defs) {
    const u = db.users.find((x) => x.username === d.username && x.active);
    if (!u) continue;
    if (!verifyPw(d.password, u.salt, u.passwordHash)) {
      const { salt, hash } = hashPw(d.password);
      u.salt = salt;
      u.passwordHash = hash;
      changed = true;
    }
  }
  if (changed) saveDB();
}
function getFx() {
  return db.settings?.fx != null ? parseFloat(db.settings.fx) : CFG.fx;
}
function fxForTenant(tenant) {
  if (!tenant) return getFx();
  const master = isMasterType(tenant) ? tenant : parentMaster(tenant);
  if (master?.fx != null) {
    const v = parseFloat(master.fx);
    if (v > 0) return v;
  }
  return getFx();
}
function koreaFilterOn() {
  return db.settings?.koreaOnly != null ? !!db.settings.koreaOnly : CFG.koreaOnly;
}
function koreaKeywords() {
  return (db.settings?.koreaKeywords || "한국,korea,korean,kr")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}
let saveTimer = null;
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  }, 150);
}

function seedDB() {
  // 플랫폼(숨김) → 총판 1명 → 대리점 N
  db.tenants = [
    {
      id: "platform",
      name: "슈퍼샤샤",
      type: "platform",
      slug: CFG.platformSlug,
      marginPercent: 35,
      creditBalance: 0,
      brand: "슈퍼샤샤",
      active: true,
      hidden: true,
    },
    {
      id: "master",
      name: "본사",
      type: "master",
      slug: CFG.masterSlug,
      parentId: "platform",
      marginPercent: 20,
      creditBalance: 500000,
      brand: "본사",
      active: true,
    },
    {
      id: "agency1",
      name: "나인스토리",
      type: "agency",
      parentId: "master",
      slug: "nine",
      marginPercent: 20, // 대리점→손님 마진(%)
      supplyMargin: 50, // 총판→대리점 마진(%)
      creditBalance: 79583,
      brand: "나인스토리",
      active: true,
    },
  ];
  db.settings = { fx: CFG.fx, koreaOnly: CFG.koreaOnly, koreaKeywords: "한국,korea,korean,kr" };
  const { salt, hash } = hashPw(CFG.adminPass);
  const masterHash = hashPw("master1234");
  const nineHash = hashPw("nine1234");
  db.users = [
    {
      id: db.seq.user++,
      tenantId: "platform",
      username: CFG.adminUser,
      email: "admin@leestones.com",
      salt,
      passwordHash: hash,
      balance: 0,
      role: "superadmin",
      active: true,
      createdAt: Date.now(),
    },
    {
      id: db.seq.user++,
      tenantId: "master",
      username: "master",
      email: "",
      salt: masterHash.salt,
      passwordHash: masterHash.hash,
      balance: 0,
      role: "admin",
      active: true,
      createdAt: Date.now(),
    },
    {
      id: db.seq.user++,
      tenantId: "agency1",
      username: "nineadmin",
      email: "",
      salt: nineHash.salt,
      passwordHash: nineHash.hash,
      balance: 0,
      role: "admin",
      active: true,
      createdAt: Date.now(),
    },
  ];
}

// ─────────────────────────────────────────────────────────────
//  인증 (stateless 서명 토큰)
// ─────────────────────────────────────────────────────────────
function hashPw(pw, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPw(pw, salt, hash) {
  if (!pw || !salt || !hash) return false;
  try {
    const h = crypto.scryptSync(pw, salt, 64).toString("hex");
    const a = Buffer.from(h);
    const b = Buffer.from(hash);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", CFG.secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expect = crypto.createHmac("sha256", CFG.secret).update(body).digest("base64url");
  if (sig !== expect) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
}
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const data = verifyToken(token);
  if (!data) return res.status(401).json({ error: "로그인이 필요합니다." });
  const user = db.users.find((u) => u.id === data.uid && u.active);
  if (!user) return res.status(401).json({ error: "유효하지 않은 세션입니다." });
  req.user = user;
  next();
}
function adminOnly(req, res, next) {
  if (!["admin", "superadmin"].includes(req.user.role))
    return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  next();
}

// ─────────────────────────────────────────────────────────────
//  공급사 API 호출
// ─────────────────────────────────────────────────────────────
async function moreThan(params) {
  if (DEMO) return demoResponse(params);
  const body = new URLSearchParams({ key: CFG.apiKey, ...params });
  const timeoutMs = params.action === "services" ? 60000 : 20000;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(CFG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: ctl.signal,
    });
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("공급사 응답 파싱 실패: " + text.slice(0, 200));
    }
  } finally {
    clearTimeout(t);
  }
}

// 데모 모드용 샘플 (키 없을 때 UI/흐름 테스트)
function demoResponse(params) {
  if (params.action === "services") return DEMO_SERVICES;
  if (params.action === "balance") return { balance: "250.0000", currency: "USD" };
  if (params.action === "add") return { order: Math.floor(Math.random() * 9e6 + 1e6) };
  if (params.action === "status")
    return { status: "In progress", charge: "0.5", remains: "120", start_count: "0" };
  return {};
}
const DEMO_SERVICES = [
  { service:6007, name:"인스타그램 동영상 조회수", category:"인스타그램", min:100, max:100000000, rate:"0.0009" },
  { service:7402, name:"인스타그램 동영상 조회수 (30일 리필)", category:"인스타그램", min:100, max:100000000, rate:"0.009" },
  { service:6010, name:"인스타그램 게시물 공유", category:"인스타그램", min:100, max:1000000, rate:"0.009" },
  { service:9042, name:"페이스북 팔로워 (프로필) 30일 리필", category:"페이스북", min:10, max:1000000, rate:"0.51" },
  { service:9041, name:"페이스북 팔로워 (페이지) 30일 리필", category:"페이스북", min:100, max:10000000, rate:"0.66" },
  { service:9044, name:"페이스북 페이지 좋아요+팔로워", category:"페이스북", min:10, max:2000000, rate:"0.66" },
  { service:9045, name:"페이스북 게시물 좋아요", category:"페이스북", min:20, max:500000, rate:"0.73" },
  { service:9043, name:"페이스북 그룹 멤버", category:"페이스북", min:10, max:500000, rate:"1.38" },
  { service:9047, name:"페이스북 게시물 좋아요 (미국)", category:"페이스북", min:10, max:10000, rate:"10.15" },
  { service:5749, name:"틱톡 팔로워 (노리필)", category:"틱톡", min:10, max:100000, rate:"1.74" },
  { service:9406, name:"틱톡 팔로워 (30일 리필)", category:"틱톡", min:10, max:100000, rate:"2.1" },
  { service:9407, name:"틱톡 팔로워 (평생 보장)", category:"틱톡", min:10, max:100000, rate:"2.44" },
  { service:9408, name:"틱톡 팔로워 (UHQ 고품질)", category:"틱톡", min:100, max:10000, rate:"5.99" },
  { service:9594, name:"틱톡 오가닉 팔로워 (실계정)", category:"틱톡", min:100, max:5000, rate:"11.49" },
  { service:9616, name:"틱톡 동영상 조회수", category:"틱톡", min:10, max:10000000, rate:"0.005" },
  { service:4432, name:"X(트위터) 팔로워 (노리필)", category:"X(트위터)", min:100, max:20000, rate:"0.69" },
  { service:3635, name:"X(트위터) 팔로워 (7일 리필)", category:"X(트위터)", min:100, max:20000, rate:"2.29" },
  { service:9229, name:"X(트위터) 팔로워 (미국)", category:"X(트위터)", min:100, max:10000, rate:"1.19" },
  { service:9527, name:"X(트위터) 트윗 조회수", category:"X(트위터)", min:10, max:10000000, rate:"0.005" },
  { service:8166, name:"X(트위터) 트윗 조회수 (대량)", category:"X(트위터)", min:100, max:100000000, rate:"0.009" },
  { service:8869, name:"X(트위터) 조회수+노출+참여", category:"X(트위터)", min:100, max:100000000, rate:"0.009" },
  { service:6013, name:"X(트위터) 동영상 조회수", category:"X(트위터)", min:100, max:100000000, rate:"0.0019" },
  { service:8136, name:"텔레그램 게시물 조회수", category:"텔레그램", min:10, max:1000000, rate:"0.009" },
  { service:8509, name:"텔레그램 게시물 공유", category:"텔레그램", min:10, max:20000, rate:"0.009" },
  { service:8510, name:"텔레그램 반응 + 조회수", category:"텔레그램", min:10, max:300000, rate:"0.03" }
];

// 서비스 캐시 + 모어댄 실시간 동기화
let svcCache = {
  at: 0,
  syncAt: 0,
  data: [],
  mode: DEMO ? "preview" : "live",
  error: null,
  rev: 0,
  fingerprint: "",
};
let svcSyncPromise = null;
let svcSyncTimer = null;
const svcSseClients = new Set();

function servicesFingerprint(arr) {
  const sig = arr
    .map((s) =>
      [s.service, s.rate, s.min, s.max, stripBrandText(s.name || ""), s.category || s.type || ""].join("|")
    )
    .sort((a, b) => String(a).localeCompare(String(b)))
    .join("\n");
  return crypto.createHash("sha256").update(sig).digest("hex").slice(0, 16);
}

function processProviderServices(raw) {
  let arr = Array.isArray(raw) ? raw : [];
  if (koreaFilterOn()) {
    const kws = koreaKeywords();
    arr = arr.filter((s) => {
      const t = ((s.name || "") + " " + (s.category || "")).toLowerCase();
      return kws.some((k) => t.includes(k));
    });
  }
  if (!arr.length) throw new Error("빈 응답");
  return allProviderServices(arr);
}

function broadcastServicesUpdate() {
  const payload = JSON.stringify({
    rev: svcCache.rev,
    count: svcCache.data.length,
    syncAt: svcCache.syncAt,
    mode: svcCache.mode,
  });
  for (const client of svcSseClients) {
    try {
      client.res.write(`event: services\ndata: ${payload}\n\n`);
    } catch {
      svcSseClients.delete(client);
    }
  }
}

async function refreshServicesFromProvider(force = false) {
  if (DEMO) {
    svcCache = {
      at: Date.now(),
      syncAt: Date.now(),
      data: DEMO_SERVICES,
      mode: "preview",
      error: null,
      rev: svcCache.rev || 1,
      fingerprint: servicesFingerprint(DEMO_SERVICES),
    };
    return svcCache.data;
  }
  if (svcSyncPromise) return svcSyncPromise;
  svcSyncPromise = (async () => {
    try {
      const raw = await moreThan({ action: "services" });
      const arr = processProviderServices(raw);
      const fp = servicesFingerprint(arr);
      const changed = force || fp !== svcCache.fingerprint || !svcCache.data.length;
      const now = Date.now();
      if (changed) {
        svcCache = {
          at: now,
          syncAt: now,
          data: arr,
          mode: "live",
          error: null,
          rev: (svcCache.rev || 0) + 1,
          fingerprint: fp,
        };
        console.log(`↻ 모어댄 상품 동기화: ${arr.length}개 (rev ${svcCache.rev})`);
        broadcastServicesUpdate();
      } else {
        svcCache.at = now;
        svcCache.syncAt = now;
        svcCache.mode = "live";
        svcCache.error = null;
      }
      return svcCache.data;
    } catch (e) {
      console.warn("⚠ 공급사 서비스 수신 실패:", e.message);
      if (svcCache.data?.length) {
        svcCache.mode = "degraded";
        svcCache.error = e.message;
        return svcCache.data;
      }
      svcCache = {
        at: Date.now(),
        syncAt: Date.now(),
        data: [],
        mode: "degraded",
        error: e.message,
        rev: svcCache.rev || 0,
        fingerprint: svcCache.fingerprint || "",
      };
      throw new Error("공급사 상품 목록을 불러오지 못했습니다. API 키·네트워크를 확인하세요.");
    } finally {
      svcSyncPromise = null;
    }
  })();
  return svcSyncPromise;
}

function invalidateServicesCache() {
  svcCache.at = 0;
  refreshServicesFromProvider(true).catch((e) => console.warn("⚠ 상품 강제 동기화 실패:", e.message));
}

function startServicesSyncLoop() {
  if (svcSyncTimer || DEMO) return;
  const tick = () => refreshServicesFromProvider(false).catch(() => {});
  tick();
  svcSyncTimer = setInterval(tick, CFG.servicesSyncSec * 1000);
}

function providerStatus() {
  return {
    mode: DEMO ? "preview" : svcCache.mode || "live",
    connected: !DEMO && svcCache.mode === "live",
    serviceCount: svcCache.data?.length || 0,
    error: svcCache.error || null,
    servicesRev: svcCache.rev || 0,
    servicesSyncAt: svcCache.syncAt || 0,
    servicesSyncSec: CFG.servicesSyncSec,
  };
}

async function getServices(force = false) {
  if (DEMO) {
    if (!svcCache.data.length) {
      svcCache = {
        at: Date.now(),
        syncAt: Date.now(),
        data: DEMO_SERVICES,
        mode: "preview",
        error: null,
        rev: 1,
        fingerprint: servicesFingerprint(DEMO_SERVICES),
      };
    }
    return svcCache.data;
  }
  if (force || !svcCache.data.length) await refreshServicesFromProvider(force);
  return svcCache.data;
}

// ─────────────────────────────────────────────────────────────
//  가격 로직: 원가 → 플랫폼(숨김) → 총판 → 대리점 → 손님
// ─────────────────────────────────────────────────────────────
function priceFor(tenant, svc) {
  const baseUsd = parseFloat(svc.rate) || 0;
  const platform = platformTenant();
  const ov = db.serviceOverrides[svc.service] || {};
  const platformMargin = ov.platformMargin ?? ov.mainMargin ?? platform?.marginPercent ?? 35;
  const baseKrw = round4(baseUsd * fxForTenant(tenant));
  const masterSupply = round4(baseKrw * (1 + platformMargin / 100));

  if (isPlatformType(tenant)) {
    return { sell: masterSupply, supply: baseKrw, base: baseKrw, masterSupply };
  }
  if (isMasterType(tenant)) {
    const sell = round4(masterSupply * (1 + (tenant.marginPercent || 0) / 100));
    return { sell, supply: masterSupply, base: baseKrw, masterSupply };
  }
  const master = parentMaster(tenant);
  const toAgencyMargin =
    tenant.supplyMargin != null ? tenant.supplyMargin : master?.defaultAgencySupply ?? 50;
  const supply = round4(masterSupply * (1 + toAgencyMargin / 100));
  const agencyMargin = ov.agencyMargin ?? ov.customMargin ?? tenant.marginPercent;
  const sell = round4(supply * (1 + agencyMargin / 100));
  return { sell, supply, base: baseKrw, masterSupply };
}
const round4 = (n) => Math.round(n * 10000) / 10000;

function tenantRoleType(t) {
  if (!t) return null;
  if (isPlatformType(t)) return "platform";
  if (isMasterType(t)) return "master";
  return "agency";
}

// 테넌트별 가공된 서비스 목록
async function tenantServices(tenant, isAdmin, viewer, lang = "ko") {
  const L = normalizeLang(lang);
  const svcs = await getServices();
  const superView = viewer?.role === "superadmin";
  const masterView = isMasterAdmin(viewer);
  const kindLabels = KIND_LABELS_I18N[L] || KIND_LABELS_I18N.ko;
  return svcs
    .filter((s) => !(db.serviceOverrides[s.service]?.hidden))
    .map((s) => {
      const p = priceFor(tenant, s);
      const meta = serviceMeta(s, L);
      const row = {
        service: s.service,
        name: stripDisplayName(s.name),
        category: meta.category,
        categoryLabel: meta.categoryLabel,
        description: meta.description,
        linkHint: meta.linkHint,
        kind: meta.kind,
        kindLabel: kindLabels[meta.kind] || kindLabels.general || "기타",
        lang: L,
        min: parseInt(s.min) || 1,
        max: parseInt(s.max) || 100000,
        rate: p.sell,
      };
      if (isAdmin) {
        // 슈퍼샤샤: MoreThan 원가·본사공급가 전체 노출
        if (superView) {
          row.base = p.base;
          row.masterSupply = p.masterSupply;
          row.supply = p.supply;
        } else if (masterView && isMasterType(tenant)) {
          // 본사: 슈퍼샤샤에서 받은 공급가만 (대리점에는 비공개)
          row.supply = p.supply;
        }
        // 대리점 관리자·일반 회원: 판매가(rate)만 — upstream 공급가 미포함
      }
      return row;
    });
}

// ─────────────────────────────────────────────────────────────
//  텔레그램
// ─────────────────────────────────────────────────────────────
function ensureTelegramSettings() {
  if (!db.settings) db.settings = {};
  if (!db.settings.telegram) {
    db.settings.telegram = {
      botToken: "",
      chatId: "",
      notifySignups: false,
      notifyOrders: false,
      notifyTopups: false,
      notifyCreditReq: true,
      webhookRegistered: false,
    };
  }
  return db.settings.telegram;
}
function ensureTenantTelegram(t) {
  if (!t) return null;
  if (!t.telegram) {
    t.telegram = {
      botToken: "",
      chatId: "",
      notifySignups: true,
      notifyOrders: true,
      notifyTopups: true,
      notifyCreditReq: true,
      webhookRegistered: false,
    };
  }
  return t.telegram;
}
function getPlatformTelegramConfig() {
  const s = ensureTelegramSettings();
  const token = String(s.botToken || CFG.tgToken || "").trim();
  const chatId = String(s.chatId || CFG.tgChat || "").trim();
  return {
    token,
    chatId,
    notifySignups: s.notifySignups !== false,
    notifyOrders: s.notifyOrders !== false,
    notifyTopups: s.notifyTopups !== false,
    notifyCreditReq: s.notifyCreditReq !== false,
    webhookRegistered: !!s.webhookRegistered,
  };
}
function getTenantTelegramConfig(t) {
  if (!t) return null;
  const s = ensureTenantTelegram(t);
  const token = String(s.botToken || "").trim();
  const chatId = String(s.chatId || "").trim();
  if (!token || !chatId) return null;
  return {
    token,
    chatId,
    notifySignups: s.notifySignups !== false,
    notifyOrders: s.notifyOrders !== false,
    notifyTopups: s.notifyTopups !== false,
    notifyCreditReq: s.notifyCreditReq !== false,
    webhookRegistered: !!s.webhookRegistered,
  };
}
function getTelegramConfig() {
  return getPlatformTelegramConfig();
}
function notifyMasterForTenant(tenant) {
  if (!tenant) return null;
  if (isMasterType(tenant)) return tenant;
  return parentMaster(tenant);
}
function publicBaseUrl(req) {
  const fromEnv = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (!req) return "";
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return host ? `${proto}://${host}` : "";
}
function telegramSettingsDTO(req) {
  const cfg = getPlatformTelegramConfig();
  const token = cfg.token;
  return {
    configured: !!(token && cfg.chatId),
    botTokenPreview: token ? `${token.slice(0, 8)}…` : "",
    botTokenSet: !!token,
    chatId: cfg.chatId,
    notifySignups: cfg.notifySignups,
    notifyOrders: cfg.notifyOrders,
    notifyTopups: cfg.notifyTopups,
    notifyCreditReq: cfg.notifyCreditReq,
    webhookUrl: publicBaseUrl(req) ? `${publicBaseUrl(req)}/api/tg/webhook` : "",
    webhookRegistered: cfg.webhookRegistered,
  };
}
function tenantTelegramDTO(t, req) {
  ensureTenantTelegram(t);
  const cfg = getTenantTelegramConfig(t) || {
    token: "",
    chatId: t.telegram?.chatId || "",
    notifySignups: t.telegram?.notifySignups !== false,
    notifyOrders: t.telegram?.notifyOrders !== false,
    notifyTopups: t.telegram?.notifyTopups !== false,
    notifyCreditReq: t.telegram?.notifyCreditReq !== false,
    webhookRegistered: !!t.telegram?.webhookRegistered,
  };
  const token = cfg.token || String(t.telegram?.botToken || "").trim();
  return {
    configured: !!(token && cfg.chatId),
    botTokenPreview: token ? `${token.slice(0, 8)}…` : "",
    botTokenSet: !!token,
    chatId: cfg.chatId || t.telegram?.chatId || "",
    notifySignups: cfg.notifySignups,
    notifyOrders: cfg.notifyOrders,
    notifyTopups: cfg.notifyTopups,
    notifyCreditReq: cfg.notifyCreditReq,
    webhookUrl: publicBaseUrl(req) ? `${publicBaseUrl(req)}/api/tg/webhook/tenant/${t.id}` : "",
    webhookRegistered: cfg.webhookRegistered,
  };
}
function applyTelegramBody(target, body) {
  if (!body || typeof body !== "object") return;
  const rawToken = body.botToken != null ? String(body.botToken).trim() : null;
  if (rawToken && !rawToken.includes("…")) target.botToken = rawToken;
  if (body.chatId != null) target.chatId = String(body.chatId).trim();
  if (body.notifySignups != null) target.notifySignups = !!body.notifySignups;
  if (body.notifyOrders != null) target.notifyOrders = !!body.notifyOrders;
  if (body.notifyTopups != null) target.notifyTopups = !!body.notifyTopups;
  if (body.notifyCreditReq != null) target.notifyCreditReq = !!body.notifyCreditReq;
}
function applyPlatformTelegramBody(target, body) {
  applyTelegramBody(target, body);
  // 플랫폼 알림은 본사 크레딧 요청만
  target.notifySignups = false;
  target.notifyOrders = false;
  target.notifyTopups = false;
  if (body?.notifyCreditReq != null) target.notifyCreditReq = !!body.notifyCreditReq;
  else if (target.notifyCreditReq == null) target.notifyCreditReq = true;
}
async function tgApi(method, body, token) {
  const t = token || getTelegramConfig().token;
  if (!t) throw new Error("텔레그램 봇 토큰이 없습니다.");
  const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new Error(d.description || "텔레그램 API 오류");
  return d;
}
async function tgSend(cfg, text, keyboard, kind) {
  if (!cfg?.token || !cfg?.chatId) return;
  if (kind === "signup" && !cfg.notifySignups) return;
  if (kind === "order" && !cfg.notifyOrders) return;
  if (kind === "topup" && !cfg.notifyTopups) return;
  if (kind === "credit" && !cfg.notifyCreditReq) return;
  try {
    await tgApi(
      "sendMessage",
      {
        chat_id: cfg.chatId,
        text,
        parse_mode: "HTML",
        reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
      },
      cfg.token
    );
  } catch (e) {
    console.error("TG error", e.message);
  }
}
async function tgPlatform(text, keyboard, kind) {
  await tgSend(getPlatformTelegramConfig(), text, keyboard, kind);
}
async function tgTenant(tenant, text, keyboard, kind) {
  const cfg = getTenantTelegramConfig(tenant);
  await tgSend(cfg, text, keyboard, kind);
}
async function tgNotifyScope(tenant, text, keyboard, kind) {
  // 슈퍼샤샤: 본사→플랫폼 크레딧(공급) 요청만 — 주문·가입·손님충전은 본사 텔레그램으로
  if (tenant && isMasterType(tenant) && kind === "credit") {
    await tgPlatform(text, keyboard, kind);
  }
  const master = notifyMasterForTenant(tenant);
  if (!master) return;
  if (isMasterType(tenant) && kind === "credit") return;
  await tgTenant(master, text, keyboard, kind);
}
async function tg(text, keyboard, kind) {
  await tgPlatform(text, keyboard, kind);
}
async function handleTopupCallback(cb, botToken) {
  if (!cb?.data?.startsWith("topup_")) return;
  const [, decision, idStr] = cb.data.split("_");
  const t = db.topups.find((x) => x.id === +idStr);
  if (t && t.status === "pending") {
    if (decision === "approve") {
      const u = db.users.find((x) => x.id === t.userId);
      if (u) u.balance = round4(u.balance + t.amount);
      t.status = "approved";
    } else t.status = "rejected";
    saveDB();
  }
  if (botToken) {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: cb.id, text: decision === "approve" ? "승인됨" : "거절됨" }),
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  공개 / 인증 API
// ─────────────────────────────────────────────────────────────
function tenantBySlug(slug, allowPlatform = false) {
  if (isPlatformSlug(slug)) {
    if (!allowPlatform) return null;
    return platformTenant();
  }
  const t = db.tenants.find((x) => x.slug === slug && x.active && !isPlatformType(x));
  if (t) return t;
  if (allowPlatform && slug === platformSlug()) return platformTenant();
  return null;
}
const PLATFORM_BRAND_RE = /슈퍼시아|슈퍼샤샤|supershasha|supersia|supersha/i;
function sanitizeTenantBrand(t) {
  let name = t.name || "";
  let brand = t.brand || name;
  if (isPlatformType(t)) return { name, brand };
  if (PLATFORM_BRAND_RE.test(name) || PLATFORM_BRAND_RE.test(brand)) {
    if (isMasterType(t)) {
      name = "본사";
      brand = "본사";
    } else if (isAgencyType(t)) {
      if (PLATFORM_BRAND_RE.test(name)) name = t.slug || "대리점";
      if (PLATFORM_BRAND_RE.test(brand)) brand = name;
    }
  }
  return { name, brand };
}
function publicTenant(t) {
  if (!t || isPlatformType(t)) return null;
  const roleType = tenantRoleType(t);
  const { name, brand } = sanitizeTenantBrand(t);
  const pub = { id: t.id, name, slug: t.slug, brand, logoUrl: t.logoUrl || "", roleType };
  if (isMasterType(t)) pub.type = "main";
  else pub.type = "agency";
  return pub;
}
function opsTenantPublic() {
  return {
    id: "ops",
    name: "슈퍼샤샤",
    slug: platformSlug(),
    brand: "슈퍼샤샤",
    logoUrl: "",
    roleType: "platform",
    type: "main",
  };
}

app.get("/api/config", (req, res) => {
  const ps = providerStatus();
  res.json({
    defaultTenant: defaultPublicSlug(),
    ok: true,
    ...ps,
    demo: DEMO,
    curated: false,
    publicBase: getPublicBaseUrl(),
  });
});
app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get("/api/tenant/:slug", (req, res) => {
  const slug = req.params.slug;
  if (isPlatformSlug(slug)) return res.json(opsTenantPublic());
  const t = tenantBySlug(slug);
  if (!t) return res.status(404).json({ error: "사이트를 찾을 수 없습니다." });
  res.json(publicTenant(t));
});

app.get("/api/services/revision", (req, res) => {
  res.json({
    rev: svcCache.rev || 0,
    count: svcCache.data?.length || 0,
    syncAt: svcCache.syncAt || 0,
    mode: svcCache.mode,
    error: svcCache.error || null,
  });
});

app.get("/api/services/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (res.flushHeaders) res.flushHeaders();
  const client = { res };
  svcSseClients.add(client);
  res.write(
    `event: hello\ndata: ${JSON.stringify({
      rev: svcCache.rev || 0,
      count: svcCache.data?.length || 0,
      syncAt: svcCache.syncAt || 0,
    })}\n\n`
  );
  req.on("close", () => svcSseClients.delete(client));
});

app.get("/api/services", async (req, res) => {
  try {
    const slug = resolveTenantSlug(req.query.tenant || defaultPublicSlug(), false);
    const tenant = tenantBySlug(slug);
    if (!tenant) return res.status(404).json({ error: "사이트를 찾을 수 없습니다." });
    const lang = normalizeLang(req.query.lang);
    res.json(await tenantServices(tenant, false, null, lang));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/register", (req, res) => {
  const { username, email, phone, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "아이디/비밀번호를 입력하세요." });
  const raw = req.body?.tenant || defaultPublicSlug();
  if (isPlatformSlug(raw)) return res.status(403).json({ error: "가입할 수 없습니다." });
  const slug = resolveTenantSlug(raw, false);
  const tenant = tenantBySlug(slug);
  if (!tenant || isMasterType(tenant))
    return res.status(403).json({ error: "이 사이트에서는 회원가입을 받지 않습니다." });
  if (db.users.find((u) => u.tenantId === tenant.id && u.username === username))
    return res.status(409).json({ error: "이미 사용 중인 아이디입니다." });
  const { salt, hash } = hashPw(password);
  const user = {
    id: db.seq.user++,
    tenantId: tenant.id,
    username,
    email: email || "",
    phone: phone || "",
    salt,
    passwordHash: hash,
    balance: 0,
    role: "user",
    active: true,
    createdAt: Date.now(),
  };
  db.users.push(user);
  saveDB();
  tgNotifyScope(tenant, `🆕 <b>신규 가입</b>\n사이트: ${tenant.name}\n아이디: ${username}`, null, "signup");
  res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  try {
    const { username, password } = req.body || {};
    const rawSlug = req.body?.tenant || defaultPublicSlug();
    if (!username || !password) return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });

    const onOps = isPlatformSlug(rawSlug);
    const tenant = onOps ? platformTenant() : tenantBySlug(resolveTenantSlug(rawSlug, false));
    const user = db.users.find((u) => u.username === username && u.active);
    if (!user || !verifyPw(password, user.salt, user.passwordHash))
      return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });

    if (user.role === "superadmin") {
      if (!onOps) {
        return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
      }
    } else if (onOps) {
      return res.status(401).json({ error: "이 주소에서는 해당 계정으로 로그인할 수 없습니다." });
    } else if (!tenant || user.tenantId !== tenant.id) {
      const userTenant = db.tenants.find((t) => t.id === user.tenantId);
      if (userTenant?.slug) {
        return res.status(401).json({
          error: `이 계정은 ?tenant=${userTenant.slug} 주소에서 로그인하세요.`,
          needTenant: userTenant.slug,
        });
      }
      return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    res.json({ token: signToken({ uid: user.id }), user: meDTO(user) });
  } catch (e) {
    console.error("login error:", e);
    res.status(500).json({ error: "로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." });
  }
});

function meDTO(u) {
  const t = db.tenants.find((x) => x.id === u.tenantId);
  let tenant = t ? publicTenant(t) : null;
  if (u.role === "superadmin") tenant = { ...opsTenantPublic(), roleType: "platform" };
  else if (tenant) tenant.roleType = tenantRoleType(t);
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    balance: round4(u.balance),
    role: u.role,
    tenant,
  };
}
app.get("/api/me", auth, (req, res) => res.json(meDTO(req.user)));

// 주문 생성
app.post("/api/order", auth, async (req, res) => {
  try {
    const { service, link, quantity } = req.body || {};
    const qty = parseInt(quantity);
    if (!service || !link || !qty) return res.status(400).json({ error: "입력값을 확인하세요." });
    const tenant = db.tenants.find((t) => t.id === req.user.tenantId);
    const svcs = await getServices();
    const svc = svcs.find((s) => String(s.service) === String(service));
    if (!svc) return res.status(404).json({ error: "서비스를 찾을 수 없습니다." });
    if (qty < (parseInt(svc.min) || 1) || qty > (parseInt(svc.max) || 1e9))
      return res.status(400).json({ error: `수량 범위: ${svc.min} ~ ${svc.max}` });

    const p = priceFor(tenant, svc);
    const charge = round4((p.sell * qty) / 1000);
    const agencySupplyCost = round4((p.supply * qty) / 1000);
    const masterSupplyCost = round4((p.masterSupply * qty) / 1000);
    const staff = isStaffOrder(req.user, tenant);

    if (!staff) {
      if (req.user.balance < charge)
        return res.status(402).json({ error: "잔액이 부족합니다. 충전 후 이용하세요." });
    }

    if (isAgencyType(tenant)) {
      if (tenant.creditBalance < agencySupplyCost)
        return res.status(402).json({ error: "공급 크레딧이 부족합니다. 본사에 문의하세요." });
      const master = parentMaster(tenant);
      if (master && master.creditBalance < masterSupplyCost)
        return res.status(402).json({ error: "사이트 공급이 일시적으로 불가합니다. 잠시 후 다시 시도하세요." });
    }
    if (isMasterType(tenant)) {
      if (tenant.creditBalance < masterSupplyCost)
        return res.status(402).json({ error: "공급 크레딧이 부족합니다. 본사에 문의하세요." });
    }

    const fundErr = await checkProviderFunds(svc, qty, req.user.role === "superadmin");
    if (fundErr) return res.status(402).json({ error: fundErr });

    // 공급사에 실제 주문
    const resp = await moreThan({ action: "add", service, link, quantity: qty });
    if (!resp.order) return res.status(502).json({ error: providerErrorKo(resp, req.user.role === "superadmin") });

    // 차감
    if (!staff) req.user.balance = round4(req.user.balance - charge);
    if (isAgencyType(tenant)) {
      tenant.creditBalance = round4(tenant.creditBalance - agencySupplyCost);
      const master = parentMaster(tenant);
      if (master) master.creditBalance = round4(master.creditBalance - masterSupplyCost);
    } else if (isMasterType(tenant)) {
      tenant.creditBalance = round4(tenant.creditBalance - masterSupplyCost);
    }

    const order = {
      id: db.seq.order++,
      tenantId: tenant.id,
      userId: req.user.id,
      service: svc.service,
      serviceName: svc.name,
      link,
      quantity: qty,
      charge,
      cost: round4((p.base * qty) / 1000),
      providerOrderId: resp.order,
      status: "처리중",
      providerStatus: "Pending",
      startCount: 0,
      remains: qty,
      createdAt: Date.now(),
    };
    db.orders.push(order);
    saveDB();
    tgNotifyScope(
      tenant,
      `🛒 <b>신규 주문</b>\n사이트: ${tenant.name}\n회원: ${req.user.username}\n${svc.name}\n수량: ${qty.toLocaleString()} | 결제: ${charge}\n공급주문#: ${resp.order}`,
      null,
      "order"
    );
    res.json({
      ok: true,
      orderId: order.id,
      providerOrderId: resp.order,
      balance: req.user.balance,
      paidFrom: staff ? "credit" : "balance",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 내 주문 + 실시간 상태 동기화
app.get("/api/orders", auth, async (req, res) => {
  const mine = db.orders.filter((o) => o.userId === req.user.id).sort((a, b) => b.id - a.id);
  for (const o of mine) {
    if (!o.providerOrderId || o.status === "완료" || o.status === "취소") continue;
    try {
      const st = await moreThan({ action: "status", order: o.providerOrderId });
      if (!st || st.error) continue;
      o.providerStatus = st.status || o.providerStatus;
      o.status = mapStatus(st.status);
      const start = parseInt(st.start_count, 10);
      const rem = parseInt(st.remains, 10);
      if (!Number.isNaN(start)) o.startCount = start;
      if (!Number.isNaN(rem)) o.remains = rem;
      else if (o.status === "완료") {
        o.remains = 0;
        o.startCount = o.quantity;
      }
    } catch {
      /* ignore sync errors */
    }
  }
  saveDB();
  res.json(mine.map(orderDTO));
});
function orderDTO(o, admin, viewer) {
  const d = {
    id: o.id,
    service: o.service,
    serviceName: o.serviceName,
    link: o.link,
    quantity: o.quantity,
    charge: o.charge,
    status: o.status,
    providerStatus: o.providerStatus,
    createdAt: o.createdAt,
    startCount: o.startCount ?? 0,
    remains: o.remains ?? o.quantity,
  };
  if (admin) {
    d.providerOrderId = o.providerOrderId;
    if (viewer?.role === "superadmin") {
      d.cost = o.cost;
      d.profit = round4(o.charge - o.cost);
    }
  }
  return d;
}

app.post("/api/order/:id/refresh", auth, async (req, res) => {
  const o = db.orders.find((x) => x.id === +req.params.id && x.userId === req.user.id);
  if (!o) return res.status(404).json({ error: "주문 없음" });
  try {
    const st = await moreThan({ action: "status", order: o.providerOrderId });
    o.providerStatus = st.status || o.providerStatus;
    o.status = mapStatus(st.status);
    const start = parseInt(st.start_count, 10);
    const rem = parseInt(st.remains, 10);
    if (!Number.isNaN(start)) o.startCount = start;
    if (!Number.isNaN(rem)) o.remains = rem;
    else if (o.status === "완료") { o.remains = 0; o.startCount = o.quantity; }
    saveDB();
    res.json(orderDTO(o));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
function mapStatus(s = "") {
  const m = {
    Pending: "대기",
    "In progress": "처리중",
    Processing: "처리중",
    Completed: "완료",
    Partial: "부분완료",
    Canceled: "취소",
  };
  return m[s] || "처리중";
}

// 충전 요청
app.post("/api/topup", auth, (req, res) => {
  const amount = parseFloat(req.body?.amount);
  const method = req.body?.method || "무통장입금";
  if (!amount || amount <= 0) return res.status(400).json({ error: "금액을 확인하세요." });
  const t = {
    id: db.seq.topup++,
    tenantId: req.user.tenantId,
    userId: req.user.id,
    username: req.user.username,
    amount: round4(amount),
    method,
    status: "pending",
    createdAt: Date.now(),
  };
  db.topups.push(t);
  saveDB();
  const tenant = db.tenants.find((x) => x.id === req.user.tenantId);
  const topupKeyboard = [[
    { text: "✅ 승인", callback_data: `topup_approve_${t.id}` },
    { text: "❌ 거절", callback_data: `topup_reject_${t.id}` },
  ]];
  tgNotifyScope(
    tenant,
    `💰 <b>충전 요청</b>\n사이트: ${tenant?.name}\n회원: ${req.user.username}\n금액: ${amount} (${method})`,
    topupKeyboard,
    "topup"
  );
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
//  관리자 API
// ─────────────────────────────────────────────────────────────
app.get("/api/admin/overview", auth, adminOnly, async (req, res) => {
  const scope = adminOrderScope(req.user);
  const revenue = scope.reduce((s, o) => s + o.charge, 0);
  const cost = scope.reduce((s, o) => s + (o.cost || 0), 0);
  let balance = null;
  if (req.user.role === "superadmin") {
    try {
      const b = await moreThan({ action: "balance" });
      balance = b.balance;
    } catch {}
  }
  const ut = userTenant(req.user);
  res.json({
    orders: scope.length,
    members: adminMemberScope(req.user).length,
    revenue: round4(revenue),
    cost: req.user.role === "superadmin" ? round4(cost) : undefined,
    profit: req.user.role === "superadmin" ? round4(revenue - cost) : undefined,
    pendingTopups: adminTopupScope(req.user).filter((t) => t.status === "pending").length,
    providerBalance: balance,
    masterCredit: isMasterType(ut)
      ? ut.creditBalance
      : isAgencyType(ut)
        ? parentMaster(ut)?.creditBalance
        : undefined,
    masters:
      req.user.role === "superadmin"
        ? masterTenants().map((m) => ({
            id: m.id,
            name: m.name,
            slug: m.slug,
            creditBalance: m.creditBalance,
            marginPercent: m.marginPercent,
            agencyCount: agenciesOfMaster(m.id).length,
          }))
        : undefined,
    tenants:
      req.user.role === "superadmin"
        ? db.tenants.filter((t) => !isPlatformType(t))
        : isMasterType(ut)
          ? agenciesOfMaster(ut.id)
          : undefined,
  });
});

app.get("/api/admin/orders", auth, adminOnly, (req, res) => {
  const scope = adminOrderScope(req.user);
  res.json(
    [...scope].sort((a, b) => b.id - a.id).map((o) => ({
      ...orderDTO(o, true, req.user),
      tenant: db.tenants.find((t) => t.id === o.tenantId)?.name,
      user: db.users.find((u) => u.id === o.userId)?.username,
    }))
  );
});

app.get("/api/admin/topups", auth, adminOnly, (req, res) => {
  const scope = adminTopupScope(req.user);
  res.json([...scope].sort((a, b) => b.id - a.id));
});
app.post("/api/admin/topup/:id/:decision", auth, adminOnly, (req, res) => {
  const t = db.topups.find((x) => x.id === +req.params.id);
  if (!t || t.status !== "pending") return res.status(404).json({ error: "처리할 충전 요청 없음" });
  if (req.params.decision === "approve") {
    const u = db.users.find((x) => x.id === t.userId);
    if (u) u.balance = round4(u.balance + t.amount);
    t.status = "approved";
  } else {
    t.status = "rejected";
  }
  saveDB();
  res.json({ ok: true });
});

app.post("/api/credit-request", auth, adminOnly, (req, res) => {
  const amount = parseFloat(req.body?.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: "금액을 입력하세요." });
  if (!db.creditRequests) db.creditRequests = [];
  if (!db.seq.creditReq) db.seq.creditReq = 1;
  const r = {
    id: db.seq.creditReq++,
    tenantId: req.user.tenantId,
    username: req.user.username,
    amount: round4(amount),
    note: String(req.body?.note || ""),
    status: "pending",
    createdAt: Date.now(),
  };
  db.creditRequests.push(r);
  saveDB();
  const tenant = userTenant(req.user);
  tgNotifyScope(tenant, `📋 <b>크레딧 요청</b>\n사이트: ${tenant?.name}\n요청: ${req.user.username}\n금액: ${amount}`, null, "credit");
  res.json({ ok: true });
});
app.get("/api/admin/credit-requests", auth, adminOnly, (req, res) => {
  const scope = adminCreditRequestScope(req.user);
  res.json(
    [...scope]
      .sort((a, b) => b.id - a.id)
      .map((r) => ({ ...r, tenant: db.tenants.find((t) => t.id === r.tenantId)?.name }))
  );
});
app.post("/api/admin/credit-request/:id/:decision", auth, adminOnly, (req, res) => {
  const r = (db.creditRequests || []).find((x) => x.id === +req.params.id);
  if (!r || r.status !== "pending") return res.status(404).json({ error: "처리할 요청 없음" });
  const tenant = db.tenants.find((t) => t.id === r.tenantId);
  if (!tenant) return res.status(404).json({ error: "사이트 없음" });
  if (!canManageTenant(req.user, tenant.id) && req.user.role !== "superadmin")
    return res.status(403).json({ error: "권한 없음" });
  if (isMasterType(tenant) && req.user.role !== "superadmin")
    return res.status(403).json({ error: "권한이 없습니다." });
  if (req.params.decision === "approve") {
    tenant.creditBalance = round4((tenant.creditBalance || 0) + r.amount);
    r.status = "approved";
  } else {
    r.status = "rejected";
  }
  saveDB();
  res.json({ ok: true });
});

app.get("/api/admin/members", auth, adminOnly, (req, res) => {
  const scope = adminMemberScope(req.user);
  res.json(scope.map((u) => ({ id: u.id, username: u.username, email: u.email, phone: u.phone || "", balance: round4(u.balance), role: u.role, tenant: db.tenants.find((t) => t.id === u.tenantId)?.name, active: u.active })));
});
app.post("/api/admin/member/:id/balance", auth, adminOnly, (req, res) => {
  const u = db.users.find((x) => x.id === +req.params.id);
  if (!u) return res.status(404).json({ error: "회원 없음" });
  const allowed = adminMemberScope(req.user).some((x) => x.id === u.id);
  if (!allowed) return res.status(403).json({ error: "권한 없음" });
  u.balance = round4(u.balance + (parseFloat(req.body?.delta) || 0));
  saveDB();
  res.json({ ok: true, balance: u.balance });
});

// 서비스 마진/노출 관리 (본사)
app.get("/api/admin/services", auth, adminOnly, async (req, res) => {
  const tenant = db.tenants.find((t) => t.id === req.user.tenantId);
  const viewTenant =
    req.user.role === "superadmin"
      ? platformTenant()
      : isMasterType(tenant)
        ? tenant
        : tenant;
  const list = await tenantServices(viewTenant, true, req.user, normalizeLang(req.query.lang));
  res.json(
    list.map((s) => {
      const ov = db.serviceOverrides[s.service] || {};
      if (req.user.role !== "superadmin") {
        const slim = { ...s };
        if (ov.hidden != null) slim.hidden = ov.hidden;
        if (isAgencyType(viewTenant) && (ov.agencyMargin != null || ov.customMargin != null))
          slim.agencyMargin = ov.agencyMargin ?? ov.customMargin;
        return slim;
      }
      return { ...s, ...ov };
    })
  );
});
app.post("/api/admin/service/:id", auth, adminOnly, (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "권한이 없습니다." });
  const id = req.params.id;
  const cur = { ...(db.serviceOverrides[id] || {}) };
  if (req.body.hidden != null) cur.hidden = !!req.body.hidden;
  if ("mainMargin" in req.body) {
    if (req.body.mainMargin == null) delete cur.mainMargin;
    else cur.mainMargin = parseFloat(req.body.mainMargin);
  }
  if ("customMargin" in req.body) {
    if (req.body.customMargin == null) delete cur.customMargin;
    else cur.customMargin = parseFloat(req.body.customMargin);
  }
  db.serviceOverrides[id] = cur;
  saveDB();
  res.json({ ok: true });
});

// 지인 관리자 — 내 마진 설정
app.get("/api/admin/my-tenant", auth, adminOnly, (req, res) => {
  const t = db.tenants.find((x) => x.id === req.user.tenantId);
  if (!t) return res.status(404).json({ error: "사이트 없음" });
  const body = {
    id: t.id,
    name: t.name,
    type: tenantRoleType(t),
    marginPercent: t.marginPercent,
    creditBalance: t.creditBalance,
  };
  if (isMasterType(t)) {
    body.fx = fxForTenant(t);
    body.fxDefault = getFx();
    body.fxCustom = t.fx != null && parseFloat(t.fx) > 0;
  }
  res.json(body);
});
app.post("/api/admin/my-tenant", auth, adminOnly, (req, res) => {
  const t = db.tenants.find((x) => x.id === req.user.tenantId);
  if (!t) return res.status(404).json({ error: "사이트 없음" });
  if (req.body?.marginPercent != null) t.marginPercent = parseFloat(req.body.marginPercent);
  if (req.body?.fx != null) {
    if (!isMasterType(t)) return res.status(403).json({ error: "본사만 환율을 설정할 수 있습니다." });
    const v = parseFloat(req.body.fx);
    if (v > 0) t.fx = v;
    else delete t.fx;
  }
  saveDB();
  invalidateServicesCache();
  res.json({
    ok: true,
    marginPercent: t.marginPercent,
    fx: isMasterType(t) ? fxForTenant(t) : undefined,
    fxCustom: isMasterType(t) ? t.fx != null && parseFloat(t.fx) > 0 : undefined,
  });
});

// 본사 수익·환율·한국상품 설정
app.get("/api/admin/settings", auth, adminOnly, (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "권한이 없습니다." });
  const platform = platformTenant();
  res.json({
    fx: getFx(),
    platformMargin: platform?.marginPercent ?? 35,
    mainMargin: platform?.marginPercent ?? 35,
    koreaOnly: koreaFilterOn(),
    koreaKeywords: db.settings?.koreaKeywords || "한국,korea,korean,kr",
    telegram: telegramSettingsDTO(req),
    masters: masterTenants().map((m) => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      creditBalance: m.creditBalance,
      agencyCount: agenciesOfMaster(m.id).length,
    })),
  });
});
app.post("/api/admin/settings", auth, adminOnly, (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "권한이 없습니다." });
  const platform = platformTenant();
  if (req.body?.fx != null) db.settings.fx = parseFloat(req.body.fx) || getFx();
  const pm = req.body?.platformMargin ?? req.body?.mainMargin;
  if (pm != null && platform) platform.marginPercent = parseFloat(pm);
  if (req.body?.koreaOnly != null) db.settings.koreaOnly = !!req.body.koreaOnly;
  if (req.body?.koreaKeywords != null) db.settings.koreaKeywords = String(req.body.koreaKeywords);
  const tgBody = req.body?.telegram;
  if (tgBody && typeof tgBody === "object") {
    applyPlatformTelegramBody(ensureTelegramSettings(), tgBody);
  }
  saveDB();
  invalidateServicesCache();
  res.json({ ok: true, telegram: telegramSettingsDTO(req) });
});
app.get("/api/admin/my-tenant/telegram", auth, adminOnly, (req, res) => {
  if (!isMasterAdmin(req.user)) return res.status(403).json({ error: "본사 관리자만 이용할 수 있습니다." });
  const t = db.tenants.find((x) => x.id === req.user.tenantId);
  if (!t || !isMasterType(t)) return res.status(404).json({ error: "사이트 없음" });
  res.json({ telegram: tenantTelegramDTO(t, req) });
});
app.post("/api/admin/my-tenant/telegram", auth, adminOnly, (req, res) => {
  if (!isMasterAdmin(req.user)) return res.status(403).json({ error: "본사 관리자만 이용할 수 있습니다." });
  const t = db.tenants.find((x) => x.id === req.user.tenantId);
  if (!t || !isMasterType(t)) return res.status(404).json({ error: "사이트 없음" });
  applyTelegramBody(ensureTenantTelegram(t), req.body?.telegram || req.body || {});
  saveDB();
  res.json({ ok: true, telegram: tenantTelegramDTO(t, req) });
});
app.post("/api/admin/my-tenant/telegram/test", auth, adminOnly, async (req, res) => {
  if (!isMasterAdmin(req.user)) return res.status(403).json({ error: "본사 관리자만 이용할 수 있습니다." });
  const t = db.tenants.find((x) => x.id === req.user.tenantId);
  if (!t || !isMasterType(t)) return res.status(404).json({ error: "사이트 없음" });
  const cfg = getTenantTelegramConfig(t);
  if (!cfg?.token || !cfg?.chatId) return res.status(400).json({ error: "봇 토큰과 채팅 ID를 먼저 저장하세요." });
  try {
    await tgApi(
      "sendMessage",
      {
        chat_id: cfg.chatId,
        text: `✅ <b>${t.name}</b> 팀 그룹 연동 테스트\n이 방에 주문·충전·가입 알림이 옵니다. (그룹 멤버 전원 수신)`,
        parse_mode: "HTML",
      },
      cfg.token
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.post("/api/admin/my-tenant/telegram/webhook", auth, adminOnly, async (req, res) => {
  if (!isMasterAdmin(req.user)) return res.status(403).json({ error: "본사 관리자만 이용할 수 있습니다." });
  const t = db.tenants.find((x) => x.id === req.user.tenantId);
  if (!t || !isMasterType(t)) return res.status(404).json({ error: "사이트 없음" });
  const cfg = getTenantTelegramConfig(t);
  if (!cfg?.token) return res.status(400).json({ error: "봇 토큰을 먼저 저장하세요." });
  const base = publicBaseUrl(req);
  if (!base) return res.status(400).json({ error: "공개 URL을 확인할 수 없습니다." });
  const webhookUrl = `${base}/api/tg/webhook/tenant/${t.id}`;
  try {
    await tgApi("setWebhook", { url: webhookUrl, allowed_updates: ["callback_query"] }, cfg.token);
    ensureTenantTelegram(t).webhookRegistered = true;
    saveDB();
    res.json({ ok: true, webhookUrl });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.post("/api/admin/telegram/test", auth, adminOnly, async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "권한이 없습니다." });
  const cfg = getPlatformTelegramConfig();
  if (!cfg.token || !cfg.chatId) return res.status(400).json({ error: "봇 토큰과 채팅 ID를 먼저 저장하세요." });
  try {
    await tgApi(
      "sendMessage",
      {
        chat_id: cfg.chatId,
        text: "✅ <b>슈퍼샤샤</b> 팀 그룹 연동 테스트\n<b>본사 크레딧 요청</b> 알림이 이 방으로 옵니다.",
        parse_mode: "HTML",
      },
      cfg.token
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.post("/api/admin/telegram/webhook", auth, adminOnly, async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "권한이 없습니다." });
  const cfg = getPlatformTelegramConfig();
  if (!cfg.token) return res.status(400).json({ error: "봇 토큰을 먼저 저장하세요." });
  const base = publicBaseUrl(req);
  if (!base) return res.status(400).json({ error: "공개 URL을 확인할 수 없습니다. Render 배포 후 다시 시도하세요." });
  const webhookUrl = `${base}/api/tg/webhook`;
  try {
    await tgApi("setWebhook", { url: webhookUrl, allowed_updates: ["callback_query"] }, cfg.token);
    ensureTelegramSettings().webhookRegistered = true;
    saveDB();
    res.json({ ok: true, webhookUrl });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.get("/api/admin/explore", auth, adminOnly, async (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "권한이 없습니다." });
  try {
    const kws = (req.query.keywords != null ? String(req.query.keywords) : db.settings?.koreaKeywords || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    const all = await getServices();
    const matched = all.filter((s) => {
      const t = ((s.name || "") + " " + (s.category || "")).toLowerCase();
      return kws.some((k) => t.includes(k));
    });
    res.json({
      total: all.length,
      count: matched.length,
      keywords: kws,
      live: !DEMO,
      sample: matched.slice(0, 60).map((s) => ({ service: s.service, name: s.name, category: s.category || s.type, rate: s.rate })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function tenantAdminDTO(t) {
  const d = {
    id: t.id,
    name: t.name,
    slug: t.slug,
    brand: t.brand || t.name,
    type: tenantRoleType(t),
    marginPercent: t.marginPercent,
    creditBalance: t.creditBalance,
    defaultAgencySupply: t.defaultAgencySupply,
    supplyMargin: t.supplyMargin,
    active: t.active !== false,
    admins: db.users.filter((u) => u.tenantId === t.id && u.role === "admin").map((u) => u.username),
  };
  return d;
}

function siteLinkDTO(t, kind) {
  if (!t) return null;
  const slug = isPlatformType(t) ? platformSlug() : t.slug;
  const pub = getPublicBaseUrl();
  const path = `/?tenant=${encodeURIComponent(slug)}`;
  return {
    kind,
    id: t.id,
    name: isPlatformType(t) ? "슈퍼샤샤" : t.name,
    slug,
    path,
    publicUrl: pub ? `${pub}${path}` : null,
    admins: isPlatformType(t)
      ? [CFG.adminUser]
      : db.users.filter((u) => u.tenantId === t.id && u.role === "admin" && u.active !== false).map((u) => u.username),
  };
}

function getPublicBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) return String(process.env.PUBLIC_BASE_URL).trim().replace(/\/$/, "");
  try {
    const p = path.join(__dirname, "data", "public-base.txt");
    if (fs.existsSync(p)) {
      const v = fs.readFileSync(p, "utf8").trim().replace(/\/$/, "");
      if (v) return v;
    }
  } catch {}
  return null;
}

app.get("/api/admin/site-links", auth, adminOnly, (req, res) => {
  const links = [];
  const ut = userTenant(req.user);
  if (req.user.role === "superadmin") {
    const plat = platformTenant();
    const mst = masterTenant();
    // 슈퍼샤샤 URL은 플랫폼 관리자만 — 본사·대리점 공유 목록에 포함하지 않음
    if (plat) links.push(siteLinkDTO(plat, "platform"));
    if (mst) links.push(siteLinkDTO(mst, "master"));
    if (mst) for (const a of agenciesOfMaster(mst.id)) links.push(siteLinkDTO(a, "agency"));
  } else if (isMasterAdmin(req.user)) {
    if (ut) links.push(siteLinkDTO(ut, "master"));
    for (const a of agenciesOfMaster(ut.id)) links.push(siteLinkDTO(a, "agency"));
  } else {
    if (ut) links.push(siteLinkDTO(ut, "agency"));
    const mst = parentMaster(ut);
    if (mst) links.push(siteLinkDTO(mst, "master"));
  }
  res.json({ links: links.filter(Boolean), publicBase: getPublicBaseUrl() });
});

// 테넌트 관리
app.get("/api/admin/tenants", auth, adminOnly, (req, res) => {
  const ut = userTenant(req.user);
  let list;
  if (req.user.role === "superadmin") list = db.tenants.filter((t) => !isPlatformType(t));
  else if (isMasterType(ut)) list = agenciesOfMaster(ut.id);
  else return res.status(403).json({ error: "권한 없음" });
  res.json(list.map((t) => tenantAdminDTO(t)));
});
app.post("/api/admin/tenant", auth, adminOnly, (req, res) => {
  const ut = userTenant(req.user);
  const isMaster = isMasterAdmin(req.user);
  if (req.user.role !== "superadmin" && !isMaster) return res.status(403).json({ error: "권한 없음" });

  const { id, name, slug, brand, marginPercent, supplyMargin } = req.body || {};
  let t = id ? db.tenants.find((x) => x.id === id) : null;

  if (req.user.role === "superadmin") {
    if (t) {
      if (isPlatformType(t)) return res.status(400).json({ error: "처리할 수 없습니다." });
      if (name != null) t.name = name;
      if (slug != null) t.slug = slug;
      if (brand != null) t.brand = brand;
      if (isMasterType(t) && marginPercent != null) t.marginPercent = parseFloat(marginPercent);
      if (isMasterType(t) && supplyMargin !== undefined)
        t.defaultAgencySupply = supplyMargin === null ? null : parseFloat(supplyMargin);
      if (isAgencyType(t)) {
        if (marginPercent != null) t.marginPercent = parseFloat(marginPercent);
        if (supplyMargin !== undefined) t.supplyMargin = supplyMargin === null ? null : parseFloat(supplyMargin);
      }
    } else {
      if (!name || !slug) return res.status(400).json({ error: "대리점 이름과 주소(slug)를 입력하세요." });
      const { adminUsername, adminPassword } = req.body || {};
      if (!adminUsername || !adminPassword)
        return res.status(400).json({ error: "대리점 관리자 아이디와 비밀번호를 입력하세요." });
      if (db.users.find((u) => u.username === adminUsername))
        return res.status(409).json({ error: "이미 사용 중인 아이디입니다." });
      if (db.tenants.find((x) => x.slug === slug)) return res.status(409).json({ error: "이미 사용 중인 slug입니다." });
      const mst = masterTenant();
      if (!mst) return res.status(500).json({ error: "본사가 설정되지 않았습니다." });
      const parentId =
        req.body.parentId && db.tenants.find((x) => x.id === req.body.parentId && isMasterType(x))
          ? req.body.parentId
          : mst.id;
      t = {
        id: slug,
        name: name || "새 대리점",
        slug,
        type: "agency",
        parentId,
        brand: brand || name,
        marginPercent: parseFloat(marginPercent) || 20,
        supplyMargin: supplyMargin != null ? parseFloat(supplyMargin) : mst.defaultAgencySupply ?? 50,
        creditBalance: 0,
        active: true,
      };
      db.tenants.push(t);
      const { salt, hash } = hashPw(adminPassword);
      db.users.push({
        id: db.seq.user++,
        tenantId: t.id,
        username: adminUsername,
        email: "",
        phone: "",
        salt,
        passwordHash: hash,
        balance: 0,
        role: "admin",
        active: true,
        createdAt: Date.now(),
      });
    }
  } else if (isMaster) {
    if (!t) return res.status(403).json({ error: "대리점 등록 권한이 없습니다." });
    if (!isAgencyType(t) || t.parentId !== ut.id) return res.status(403).json({ error: "권한 없음" });
    if (name != null) t.name = name;
    if (slug != null) t.slug = slug;
    if (brand != null) t.brand = brand;
    if (marginPercent != null) t.marginPercent = parseFloat(marginPercent);
    if (supplyMargin !== undefined) t.supplyMargin = supplyMargin === null ? null : parseFloat(supplyMargin);
  }
  saveDB();
  const out = tenantAdminDTO(t);
  if (req.body?.adminUsername) out.createdAdmin = req.body.adminUsername;
  res.json({ ok: true, tenant: out, loginUrl: `/?tenant=${t.slug}` });
});
app.post("/api/admin/tenant/:id/admin", auth, adminOnly, (req, res) => {
  if (!canManageTenant(req.user, req.params.id) && req.user.role !== "superadmin")
    return res.status(403).json({ error: "권한 없음" });
  const t = db.tenants.find((x) => x.id === req.params.id);
  if (!t || isPlatformType(t)) return res.status(404).json({ error: "사이트 없음" });
  if (isMasterType(t) && req.user.role !== "superadmin")
    return res.status(403).json({ error: "권한이 없습니다." });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "아이디/비밀번호를 입력하세요." });
  if (db.users.find((u) => u.tenantId === t.id && u.username === username))
    return res.status(409).json({ error: "이미 사용 중인 아이디입니다." });
  const { salt, hash } = hashPw(password);
  db.users.push({
    id: db.seq.user++,
    tenantId: t.id,
    username,
    email: "",
    phone: "",
    salt,
    passwordHash: hash,
    balance: 0,
    role: "admin",
    active: true,
    createdAt: Date.now(),
  });
  saveDB();
  res.json({ ok: true });
});
app.post("/api/admin/tenant/:id/credit", auth, adminOnly, (req, res) => {
  if (!canManageTenant(req.user, req.params.id)) return res.status(403).json({ error: "권한 없음" });
  const t = db.tenants.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "사이트 없음" });
  if (isPlatformType(t)) return res.status(400).json({ error: "처리할 수 없습니다." });
  if (isMasterType(t) && req.user.role !== "superadmin")
    return res.status(403).json({ error: "권한이 없습니다." });
  t.creditBalance = round4((t.creditBalance || 0) + (parseFloat(req.body?.delta) || 0));
  saveDB();
  res.json({ ok: true, creditBalance: t.creditBalance });
});

// ─────────────────────────────────────────────────────────────
//  텔레그램 webhook (충전 인라인 승인)
// ─────────────────────────────────────────────────────────────
app.post("/api/tg/webhook", async (req, res) => {
  const cb = req.body?.callback_query;
  if (cb) await handleTopupCallback(cb, getPlatformTelegramConfig().token);
  res.json({ ok: true });
});
app.post("/api/tg/webhook/tenant/:id", async (req, res) => {
  const t = db.tenants.find((x) => x.id === req.params.id);
  const cfg = t ? getTenantTelegramConfig(t) : null;
  const cb = req.body?.callback_query;
  if (cb) await handleTopupCallback(cb, cfg?.token);
  res.json({ ok: true });
});

// SPA fallback
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

loadDB();
syncTelegramFromEnv();

function syncTelegramFromEnv() {
  if (!CFG.tgToken && !CFG.tgChat) return;
  const s = ensureTelegramSettings();
  if (CFG.tgToken) s.botToken = CFG.tgToken;
  if (CFG.tgChat) s.chatId = CFG.tgChat;
  saveDB();
}

function resolvePublicBase() {
  return (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || getPublicBaseUrl() || "").replace(/\/$/, "");
}

async function bootstrapTelegram() {
  syncTelegramFromEnv();
  const base = resolvePublicBase();
  const cfg = getPlatformTelegramConfig();
  if (!cfg.token) {
    console.log("ℹ 텔레그램: .env에 TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID 설정 후 재시작");
    return;
  }
  if (base && cfg.token) {
    try {
      const url = `${base}/api/tg/webhook`;
      await tgApi("setWebhook", { url, allowed_updates: ["callback_query"] }, cfg.token);
      const wasReg = !!ensureTelegramSettings().webhookRegistered;
      ensureTelegramSettings().webhookRegistered = true;
      saveDB();
      console.log(`✅ 텔레그램 webhook → ${url}`);
      if (!wasReg && cfg.chatId) {
        await tgApi(
          "sendMessage",
          {
            chat_id: cfg.chatId,
            text: "✅ <b>슈퍼샤샤</b> 알림 연결됨\n<b>본사 크레딧(공급) 요청</b>만 이 방으로 옵니다.",
            parse_mode: "HTML",
          },
          cfg.token
        );
      }
    } catch (e) {
      console.warn("⚠ 텔레그램 webhook:", e.message);
    }
  } else if (cfg.token && cfg.chatId) {
    console.log("ℹ 텔레그램 알림(발송)만 활성 — webhook은 Render/터널 HTTPS 필요");
  }
  const master = masterTenant();
  if (master && base) {
    const tc = getTenantTelegramConfig(master);
    const tok = String(master.telegram?.botToken || "").trim();
    if (tok && tc?.chatId) {
      try {
        const url = `${base}/api/tg/webhook/tenant/${master.id}`;
        await tgApi("setWebhook", { url, allowed_updates: ["callback_query"] }, tok);
        ensureTenantTelegram(master).webhookRegistered = true;
        saveDB();
        console.log(`✅ 본사 텔레그램 webhook → ${url}`);
      } catch (e) {
        console.warn("⚠ 본사 텔레그램 webhook:", e.message);
      }
    }
  }
}

process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
  if (err?.code === "EADDRINUSE") process.exit(1);
});
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
process.on("SIGTERM", () => {
  console.log("SIGTERM — graceful shutdown");
  saveDB();
  process.exit(0);
});
process.on("SIGINT", () => {
  saveDB();
  process.exit(0);
});
const httpServer = app.listen(CFG.port, "0.0.0.0", () => {
  console.log(`리스톤즈 server on :${CFG.port} ${DEMO ? "(preview)" : "(live)"}`);
  getServices().catch((e) => console.warn("⚠ 상품 캐시 예열 실패:", e.message));
  startServicesSyncLoop();
  bootstrapTelegram().catch((e) => console.warn("⚠ 텔레그램 부트스트랩:", e.message));
});
httpServer.on("error", (err) => {
  console.error("listen error:", err.message);
  process.exit(1);
});
