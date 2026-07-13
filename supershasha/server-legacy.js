import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

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
};
const DEMO = !CFG.apiKey; // API 키 없으면 데모(샘플 서비스) 모드

// ─────────────────────────────────────────────────────────────
//  초간단 파일 DB
// ─────────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, "data", "db.json");
let db = {
  tenants: [],
  users: [],
  orders: [],
  topups: [],
  serviceOverrides: {}, // { [serviceId]: { hidden, mainMargin, customMargin } }
  settings: { fx: null, koreaOnly: null, koreaKeywords: "한국,korea,korean,kr" },
  seq: { user: 1, order: 1, topup: 1 },
};
function loadDB() {
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    if (!db.settings) db.settings = { fx: null, koreaOnly: null, koreaKeywords: "한국,korea,korean,kr" };
    if (!db.serviceOverrides) db.serviceOverrides = {};
  } catch {
    seedDB();
    saveDB();
  }
}
function getFx() {
  return db.settings?.fx != null ? parseFloat(db.settings.fx) : CFG.fx;
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
  // 본사 테넌트 + 슈퍼관리자
  db.tenants = [
    {
      id: "main",
      name: "SUPERSHASHA",
      type: "main",
      slug: "main",
      marginPercent: 35, // 공급사 원가 위에 얹는 본사 마진(%)
      creditBalance: 0, // main은 사용 안 함
      brand: "본사 직영",
      active: true,
    },
    {
      id: "partner1",
      name: "NINE STORY",
      type: "partner",
      slug: "nine",
      marginPercent: 20, // 지인이 손님에게 얹는 마진(%)
      supplyMargin: 50, // 본사가 지인에게 얹는 마진(%)
      creditBalance: 100,
      brand: "나인스토리",
      active: true,
    },
  ];
  db.settings = { fx: CFG.fx, koreaOnly: CFG.koreaOnly, koreaKeywords: "한국,korea,korean,kr" };
  const { salt, hash } = hashPw(CFG.adminPass);
  db.users = [
    {
      id: db.seq.user++,
      tenantId: "main",
      username: CFG.adminUser,
      email: "admin@leestones.com",
      salt,
      passwordHash: hash,
      balance: 0,
      role: "superadmin",
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
  const h = crypto.scryptSync(pw, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
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
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
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

// 서비스 캐시 (5분)
let svcCache = { at: 0, data: [] };
async function getServices() {
  if (Date.now() - svcCache.at < 5 * 60 * 1000 && svcCache.data.length) return svcCache.data;
  try {
    const raw = await moreThan({ action: "services" });
    let arr = Array.isArray(raw) ? raw : [];
    if (koreaFilterOn()) {
      const kws = koreaKeywords();
      arr = arr.filter((s) => {
        const t = ((s.name || "") + " " + (s.category || "")).toLowerCase();
        return kws.some((k) => t.includes(k));
      });
    }
    if (!arr.length) throw new Error("빈 응답");
    svcCache = { at: Date.now(), data: arr };
    return arr;
  } catch (e) {
    console.warn("⚠ 공급사 서비스 수신 실패 → 데모 데이터로 폴백:", e.message);
    svcCache = { at: Date.now() - 4.5 * 60 * 1000, data: DEMO_SERVICES }; // 짧게 재시도
    return DEMO_SERVICES;
  }
}

// ─────────────────────────────────────────────────────────────
//  가격 로직: 원가 → 본사 판매가 → 지인 판매가
// ─────────────────────────────────────────────────────────────
function mainTenant() {
  return db.tenants.find((t) => t.type === "main");
}
// 고객이 보는 1000당 판매단가 + (관리자에게만) 원가
function priceFor(tenant, svc) {
  const baseUsd = parseFloat(svc.rate) || 0;
  const main = mainTenant();
  const ov = db.serviceOverrides[svc.service] || {};
  const mainMargin = ov.mainMargin != null ? ov.mainMargin : main.marginPercent;
  const baseKrw = round4(baseUsd * getFx());
  if (tenant.type === "main") {
    const sell = round4(baseKrw * (1 + mainMargin / 100));
    return { sell, supply: baseKrw, base: baseKrw };
  }
  const supplyMargin = tenant.supplyMargin != null ? tenant.supplyMargin : mainMargin;
  const supply = round4(baseKrw * (1 + supplyMargin / 100));
  const partnerMargin = ov.customMargin != null ? ov.customMargin : tenant.marginPercent;
  const sell = round4(supply * (1 + partnerMargin / 100));
  return { sell, supply, base: baseKrw };
}
const round4 = (n) => Math.round(n * 10000) / 10000;

// 테넌트별 가공된 서비스 목록
async function tenantServices(tenant, isAdmin) {
  const svcs = await getServices();
  return svcs
    .filter((s) => !(db.serviceOverrides[s.service]?.hidden))
    .map((s) => {
      const p = priceFor(tenant, s);
      const row = {
        service: s.service,
        name: s.name,
        category: s.category || s.type || "기타",
        min: parseInt(s.min) || 1,
        max: parseInt(s.max) || 100000,
        rate: p.sell, // 고객 판매단가(1000당)
      };
      if (isAdmin) {
        row.supply = p.supply; // 공급가
        if (tenant.type === "main") row.base = p.base; // 원가는 본사 관리자만
      }
      return row;
    });
}

// ─────────────────────────────────────────────────────────────
//  텔레그램
// ─────────────────────────────────────────────────────────────
async function tg(text, keyboard) {
  if (!CFG.tgToken || !CFG.tgChat) return;
  try {
    await fetch(`https://api.telegram.org/bot${CFG.tgToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CFG.tgChat,
        text,
        parse_mode: "HTML",
        reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
      }),
    });
  } catch (e) {
    console.error("TG error", e.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  공개 / 인증 API
// ─────────────────────────────────────────────────────────────
function tenantBySlug(slug) {
  return db.tenants.find((t) => t.slug === slug && t.active) || mainTenant();
}
function publicTenant(t) {
  return { id: t.id, name: t.name, slug: t.slug, type: t.type, brand: t.brand, logoUrl: t.logoUrl || "" };
}

app.get("/api/tenant/:slug", (req, res) => {
  res.json(publicTenant(tenantBySlug(req.params.slug)));
});

app.get("/api/services", async (req, res) => {
  try {
    const tenant = tenantBySlug(req.query.tenant || "main");
    res.json(await tenantServices(tenant, false));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/register", (req, res) => {
  const { tenant: slug = "main", username, email, phone, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "아이디/비밀번호를 입력하세요." });
  const tenant = tenantBySlug(slug);
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
  tg(`🆕 <b>신규 가입</b>\n사이트: ${tenant.name}\n아이디: ${username}`);
  res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const { tenant: slug = "main", username, password } = req.body || {};
  const tenant = tenantBySlug(slug);
  const user = db.users.find(
    (u) => u.username === username && (u.tenantId === tenant.id || u.role === "superadmin")
  );
  if (!user || !user.active || !verifyPw(password, user.salt, user.passwordHash))
    return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
  res.json({ token: signToken({ uid: user.id }), user: meDTO(user) });
});

function meDTO(u) {
  const t = db.tenants.find((x) => x.id === u.tenantId);
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    balance: round4(u.balance),
    role: u.role,
    tenant: t ? publicTenant(t) : null,
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
    const charge = round4((p.sell * qty) / 1000); // 고객 지불액
    const supplyCost = round4((p.supply * qty) / 1000); // 지인→본사 공급원가
    if (req.user.balance < charge)
      return res.status(402).json({ error: "잔액이 부족합니다. 충전 후 이용하세요." });

    // 지인 사이트면 본사 선불 크레딧 확인
    if (tenant.type === "partner" && tenant.creditBalance < supplyCost)
      return res.status(402).json({ error: "사이트 공급 크레딧이 부족합니다. 본사에 문의하세요." });

    // 공급사에 실제 주문
    const resp = await moreThan({ action: "add", service, link, quantity: qty });
    if (!resp.order) return res.status(502).json({ error: resp.error || "공급사 주문 실패" });

    // 차감
    req.user.balance = round4(req.user.balance - charge);
    if (tenant.type === "partner") tenant.creditBalance = round4(tenant.creditBalance - supplyCost);

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
      createdAt: Date.now(),
    };
    db.orders.push(order);
    saveDB();
    tg(
      `🛒 <b>신규 주문</b>\n사이트: ${tenant.name}\n회원: ${req.user.username}\n${svc.name}\n수량: ${qty.toLocaleString()} | 결제: ${charge}\n공급주문#: ${resp.order}`
    );
    res.json({ ok: true, orderId: order.id, providerOrderId: resp.order, balance: req.user.balance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 내 주문 + 실시간 상태 동기화
app.get("/api/orders", auth, async (req, res) => {
  const mine = db.orders.filter((o) => o.userId === req.user.id).sort((a, b) => b.id - a.id);
  res.json(mine.map(orderDTO));
});
function orderDTO(o, admin) {
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
  };
  if (admin) {
    d.cost = o.cost;
    d.profit = round4(o.charge - o.cost);
    d.providerOrderId = o.providerOrderId;
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
  tg(
    `💰 <b>충전 요청</b>\n사이트: ${tenant?.name}\n회원: ${req.user.username}\n금액: ${amount} (${method})`,
    [[
      { text: "✅ 승인", callback_data: `topup_approve_${t.id}` },
      { text: "❌ 거절", callback_data: `topup_reject_${t.id}` },
    ]]
  );
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
//  관리자 API
// ─────────────────────────────────────────────────────────────
app.get("/api/admin/overview", auth, adminOnly, async (req, res) => {
  const scope = req.user.role === "superadmin" ? db.orders : db.orders.filter((o) => o.tenantId === req.user.tenantId);
  const revenue = scope.reduce((s, o) => s + o.charge, 0);
  const cost = scope.reduce((s, o) => s + (o.cost || 0), 0);
  let balance = null;
  if (req.user.role === "superadmin") {
    try {
      const b = await moreThan({ action: "balance" });
      balance = b.balance;
    } catch {}
  }
  res.json({
    orders: scope.length,
    members: db.users.filter((u) => req.user.role === "superadmin" || u.tenantId === req.user.tenantId).length,
    revenue: round4(revenue),
    cost: round4(cost),
    profit: round4(revenue - cost),
    pendingTopups: db.topups.filter((t) => t.status === "pending" && (req.user.role === "superadmin" || t.tenantId === req.user.tenantId)).length,
    providerBalance: balance,
    tenants: req.user.role === "superadmin" ? db.tenants : undefined,
  });
});

app.get("/api/admin/orders", auth, adminOnly, (req, res) => {
  const scope = req.user.role === "superadmin" ? db.orders : db.orders.filter((o) => o.tenantId === req.user.tenantId);
  res.json(
    [...scope].sort((a, b) => b.id - a.id).map((o) => ({
      ...orderDTO(o, true),
      tenant: db.tenants.find((t) => t.id === o.tenantId)?.name,
      user: db.users.find((u) => u.id === o.userId)?.username,
    }))
  );
});

app.get("/api/admin/topups", auth, adminOnly, (req, res) => {
  const scope = db.topups.filter((t) => req.user.role === "superadmin" || t.tenantId === req.user.tenantId);
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

app.get("/api/admin/members", auth, adminOnly, (req, res) => {
  const scope = db.users.filter((u) => req.user.role === "superadmin" || u.tenantId === req.user.tenantId);
  res.json(scope.map((u) => ({ id: u.id, username: u.username, email: u.email, phone: u.phone || "", balance: round4(u.balance), role: u.role, tenant: db.tenants.find((t) => t.id === u.tenantId)?.name, active: u.active })));
});
app.post("/api/admin/member/:id/balance", auth, adminOnly, (req, res) => {
  const u = db.users.find((x) => x.id === +req.params.id);
  if (!u) return res.status(404).json({ error: "회원 없음" });
  if (req.user.role !== "superadmin" && u.tenantId !== req.user.tenantId) return res.status(403).json({ error: "권한 없음" });
  u.balance = round4(u.balance + (parseFloat(req.body?.delta) || 0));
  saveDB();
  res.json({ ok: true, balance: u.balance });
});

// 서비스 마진/노출 관리 (본사)
app.get("/api/admin/services", auth, adminOnly, async (req, res) => {
  const tenant = db.tenants.find((t) => t.id === req.user.tenantId);
  const list = await tenantServices(tenant, true);
  res.json(list.map((s) => ({ ...s, ...(db.serviceOverrides[s.service] || {}) })));
});
app.post("/api/admin/service/:id", auth, adminOnly, (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "본사 관리자만 가능" });
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
  res.json({ id: t.id, name: t.name, type: t.type, marginPercent: t.marginPercent });
});
app.post("/api/admin/my-tenant", auth, adminOnly, (req, res) => {
  const t = db.tenants.find((x) => x.id === req.user.tenantId);
  if (!t) return res.status(404).json({ error: "사이트 없음" });
  if (req.body?.marginPercent != null) t.marginPercent = parseFloat(req.body.marginPercent);
  saveDB();
  res.json({ ok: true, marginPercent: t.marginPercent });
});

// 본사 수익·환율·한국상품 설정
app.get("/api/admin/settings", auth, adminOnly, (req, res) => {
  const main = mainTenant();
  res.json({
    fx: getFx(),
    mainMargin: main?.marginPercent ?? 35,
    koreaOnly: koreaFilterOn(),
    koreaKeywords: db.settings?.koreaKeywords || "한국,korea,korean,kr",
    partners: db.tenants.filter((t) => t.type === "partner").map((t) => ({ id: t.id, name: t.name, marginPercent: t.marginPercent })),
  });
});
app.post("/api/admin/settings", auth, adminOnly, (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "본사 관리자만 가능" });
  const main = mainTenant();
  if (req.body?.fx != null) db.settings.fx = parseFloat(req.body.fx) || getFx();
  if (req.body?.mainMargin != null && main) main.marginPercent = parseFloat(req.body.mainMargin);
  if (req.body?.koreaOnly != null) db.settings.koreaOnly = !!req.body.koreaOnly;
  if (req.body?.koreaKeywords != null) db.settings.koreaKeywords = String(req.body.koreaKeywords);
  saveDB();
  svcCache.at = 0;
  res.json({ ok: true });
});
app.get("/api/admin/explore", auth, adminOnly, async (req, res) => {
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

// 테넌트 관리 (슈퍼관리자)
app.get("/api/admin/tenants", auth, adminOnly, (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "본사 관리자만 가능" });
  res.json(
    db.tenants.map((t) => ({
      ...t,
      admins: db.users.filter((u) => u.tenantId === t.id && u.role === "admin").map((u) => u.username),
    }))
  );
});
app.post("/api/admin/tenant", auth, adminOnly, (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "본사 관리자만 가능" });
  const { id, name, slug, type, brand, marginPercent, supplyMargin } = req.body || {};
  let t = db.tenants.find((x) => x.id === id);
  if (t) {
    if (name != null) t.name = name;
    if (slug != null) t.slug = slug;
    if (brand != null) t.brand = brand;
    if (marginPercent != null) t.marginPercent = parseFloat(marginPercent);
    if (supplyMargin !== undefined) t.supplyMargin = supplyMargin === null ? null : parseFloat(supplyMargin);
  } else {
    t = {
      id: slug || "t" + Date.now(),
      name: name || "새 사이트",
      slug: slug || "t" + Date.now(),
      type: type === "main" ? "main" : "partner",
      brand: brand || "",
      marginPercent: parseFloat(marginPercent) || 20,
      supplyMargin: supplyMargin != null ? parseFloat(supplyMargin) : 50,
      creditBalance: 0,
      active: true,
    };
    db.tenants.push(t);
  }
  saveDB();
  res.json({ ok: true, tenant: t });
});
app.post("/api/admin/tenant/:id/admin", auth, adminOnly, (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "본사 관리자만 가능" });
  const t = db.tenants.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "사이트 없음" });
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
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "본사 관리자만 가능" });
  const t = db.tenants.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "사이트 없음" });
  t.creditBalance = round4((t.creditBalance || 0) + (parseFloat(req.body?.delta) || 0));
  saveDB();
  res.json({ ok: true, creditBalance: t.creditBalance });
});

// ─────────────────────────────────────────────────────────────
//  텔레그램 webhook (충전 인라인 승인)
// ─────────────────────────────────────────────────────────────
app.post("/api/tg/webhook", async (req, res) => {
  const cb = req.body?.callback_query;
  if (cb?.data?.startsWith("topup_")) {
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
    if (CFG.tgToken) {
      await fetch(`https://api.telegram.org/bot${CFG.tgToken}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: cb.id, text: decision === "approve" ? "승인됨" : "거절됨" }),
      });
    }
  }
  res.json({ ok: true });
});

// SPA fallback
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

loadDB();
app.listen(CFG.port, () => {
  console.log(`리스톤즈 server on :${CFG.port} ${DEMO ? "(preview)" : "(live)"}`);
});
