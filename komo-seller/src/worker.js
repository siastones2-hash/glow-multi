var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.js
var ORIGIN = "https://komo-product-api.qlsl0328.workers.dev";
var ADMIN_BANK_HTML = "";
var ADMIN_MEMBERS_HTML = "";
var ADMIN_PRODUCTS_HTML = "";
var ADMIN_HOME_HTML = "";
var ADMIN_DEALERS_HTML = "";
var ADMIN_LOGIN_HTML = "";
var ADMIN_ME_HTML = "";
var ADMIN_FIND_HTML = "";
var SHOP_HTML = "";
var FAVICON_SVG = "";
var FAVICON_ICO_B64 = "";
var FAVICON_TOUCH_B64 = "";
var OG_PNG_B64 = "";
function json(data, status = 200, extra = {}) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  for (const [key, value] of Object.entries(extra || {})) {
    if (String(key).toLowerCase() === "set-cookie") {
      const cookies = Array.isArray(value) ? value : [value];
      for (const cookie of cookies) headers.append("Set-Cookie", cookie);
    } else if (value != null) {
      headers.set(key, String(value));
    }
  }
  return new Response(JSON.stringify(data), { status, headers });
}
__name(json, "json");
function rewriteCookie(raw) {
  return String(raw).replace(/;\s*Domain=[^;]*/gi, "");
}
__name(rewriteCookie, "rewriteCookie");
function isSellerPage(pathname) {
  return pathname === "/seller" || pathname.startsWith("/seller/");
}
__name(isSellerPage, "isSellerPage");
function isShopPage(pathname) {
  return pathname === "/" || pathname === "/shop" || pathname.startsWith("/shop/") || pathname === "/login" || pathname === "/signup" || pathname === "/find" || pathname === "/me";
}
__name(isShopPage, "isShopPage");
function isLocalAsset(pathname) {
  return pathname === "/sw-seller.js" || pathname === "/seller.html" || pathname === "/shop.html" || pathname === "/admin-bank.html" || pathname === "/admin-products.html" || pathname === "/admin-login.html" || pathname === "/admin-home.html" || pathname === "/admin-members.html" || pathname === "/admin-me.html" || pathname === "/admin-find.html" || pathname === "/admin-owner-login.html" || pathname === "/admin-owner.html" || pathname === "/seed-products.json" || pathname.startsWith("/products/") || pathname.startsWith("/pwa/");
}
__name(isLocalAsset, "isLocalAsset");
async function serveAsset(env, request, file) {
  const asset = await env.ASSETS.fetch(new URL(file, request.url));
  return new Response(asset.body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
__name(serveAsset, "serveAsset");
function b64ToBytes(b64) {
  const bin = atob(String(b64 || ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
__name(b64ToBytes, "b64ToBytes");
function serveFavicon(pathname) {
  const cache = { "cache-control": "public, max-age=86400" };
  if (pathname === "/favicon.svg" && FAVICON_SVG) {
    return new Response(FAVICON_SVG, { headers: { "content-type": "image/svg+xml; charset=utf-8", ...cache } });
  }
  if (pathname === "/favicon.ico" && FAVICON_ICO_B64) {
    return new Response(b64ToBytes(FAVICON_ICO_B64), { headers: { "content-type": "image/x-icon", ...cache } });
  }
  if ((pathname === "/apple-touch-icon.png" || pathname === "/apple-touch-icon-precomposed.png") && FAVICON_TOUCH_B64) {
    return new Response(b64ToBytes(FAVICON_TOUCH_B64), { headers: { "content-type": "image/png", ...cache } });
  }
  if ((pathname === "/og.png" || pathname === "/og-share.png") && OG_PNG_B64) {
    return new Response(b64ToBytes(OG_PNG_B64), { headers: { "content-type": "image/png", ...cache } });
  }
  return null;
}
__name(serveFavicon, "serveFavicon");
async function proxy(request, refererPath = "/shop") {
  const url = new URL(request.url);
  const dest = new URL(url.pathname + url.search, ORIGIN);
  const headers = new Headers(request.headers);
  headers.set("Origin", ORIGIN);
  headers.set("Referer", ORIGIN + refererPath);
  headers.delete("host");
  const init = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }
  const up = await fetch(dest.toString(), init);
  const out = new Headers(up.headers);
  const cookies = typeof up.headers.getSetCookie === "function" ? up.headers.getSetCookie() : [];
  out.delete("set-cookie");
  for (const c of cookies) out.append("Set-Cookie", rewriteCookie(c));
  const ctype = String(up.headers.get("content-type") || "");
  if (ctype.includes("text/html")) {
    let html = await up.text();
    html = html.replace("#komoPwaInstallGate.show{display:flex}", "#komoPwaInstallGate,#komoPwaInstallGate.show{display:none!important}").replace("function show(){if(isEntry&&!standalone())gate.classList.add('show')}", "function show(){return}");
    out.delete("content-length");
    return new Response(html, { status: up.status, headers: out });
  }
  return new Response(up.body, { status: up.status, headers: out });
}
__name(proxy, "proxy");
async function bankSettings(env) {
  const saved = await env.KOMO_STORE.get("bank", { type: "json" });
  return {
    bank: saved?.bank || env.BANK_NAME || "\uC6B0\uB9AC\uC740\uD589",
    account: saved?.account || env.BANK_ACCOUNT || "1005-504-945329",
    holder: saved?.holder || env.BANK_HOLDER || "\uB098\uC6B1\uD76C(\uC62C\uD53D\uC720\uD1B5)"
  };
}
__name(bankSettings, "bankSettings");
function cookieVal(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const m = raw.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : "";
}
__name(cookieVal, "cookieVal");
function sessionCookie(token, name = "ollpick_admin") {
  return name + "=" + encodeURIComponent(token) + "; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax";
}
__name(sessionCookie, "sessionCookie");
function clearSessionCookie(name = "ollpick_admin") {
  return name + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
}
__name(clearSessionCookie, "clearSessionCookie");
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256, "sha256");
async function hashPassword(password, salt) {
  return sha256(salt + ":" + password);
}
__name(hashPassword, "hashPassword");
function validId(id) {
  const user = String(id || "").trim();
  if (user.length < 2 || user.length > 40) return "\uC544\uC774\uB514\uB294 2\uC790 \uC774\uC0C1\uC73C\uB85C \uC815\uD574\uC8FC\uC138\uC694.";
  if (/\s/.test(user)) return "\uC544\uC774\uB514\uC5D0 \uACF5\uBC31\uC740 \uB123\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";
  return "";
}
__name(validId, "validId");
function validAccount(id, password) {
  const err = validId(id);
  if (err) return err;
  if (String(password || "").length < 4) return "\uBE44\uBC00\uBC88\uD638\uB294 4\uC790 \uC774\uC0C1\uC73C\uB85C \uC815\uD574\uC8FC\uC138\uC694.";
  return "";
}
__name(validAccount, "validAccount");
async function getAccount(env) {
  return await env.KOMO_STORE.get("admin_account", { type: "json" }) || null;
}
__name(getAccount, "getAccount");
async function getOwnerAccount(env) {
  return await env.KOMO_STORE.get("owner_account", { type: "json" }) || null;
}
__name(getOwnerAccount, "getOwnerAccount");
async function makeSessionToken(account) {
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1e3;
  const payload = exp + ":" + account.id;
  const sig = await sha256(account.password + ":" + payload);
  return payload + ":" + sig;
}
__name(makeSessionToken, "makeSessionToken");
async function tokenMatches(token, account) {
  if (!token || !account) return false;
  const first = token.indexOf(":");
  const last = token.lastIndexOf(":");
  if (first > 0 && last > first) {
    const exp = Number(token.slice(0, first));
    const id = token.slice(first + 1, last);
    const sig = token.slice(last + 1);
    if (!exp || exp < Date.now() || id !== account.id) return false;
    const expect = await sha256(account.password + ":" + token.slice(0, last));
    return sig === expect;
  }
  return false;
}
__name(tokenMatches, "tokenMatches");
async function isOperator(request, env) {
  const token = cookieVal(request, "ollpick_admin");
  if (await tokenMatches(token, await getAccount(env))) return true;
  if (!token) return false;
  const saved = await env.KOMO_STORE.get("admin_session");
  return !!saved && saved === token;
}
__name(isOperator, "isOperator");
async function isOwner(request, env) {
  return tokenMatches(cookieVal(request, "ollpick_owner"), await getOwnerAccount(env));
}
__name(isOwner, "isOwner");
async function isAdmin(request, env) {
  return await isOperator(request, env) || await isOwner(request, env);
}
__name(isAdmin, "isAdmin");
function profilePublic(account) {
  if (!account) return { id: "", name: "", email: "", phone: "", idLocked: false };
  return {
    id: account.id || "",
    name: account.name || "",
    email: account.email || "",
    phone: account.phone || "",
    idLocked: !!account.idLocked
  };
}
__name(profilePublic, "profilePublic");
async function loggedAdmin(request, env) {
  if (await isOperator(request, env)) {
    const account = await getAccount(env);
    return account ? { key: "admin_account", account, role: "staff" } : null;
  }
  if (await isOwner(request, env)) {
    const account = await getOwnerAccount(env);
    return account ? { key: "owner_account", account, role: "owner" } : null;
  }
  return null;
}
__name(loggedAdmin, "loggedAdmin");
async function denyUnlessAdmin(request, env) {
  if (await isAdmin(request, env)) return null;
  return json({ success: false, error: "LOGIN_REQUIRED" }, 401);
}
__name(denyUnlessAdmin, "denyUnlessAdmin");
async function denyUnlessOwner(request, env) {
  if (await isOwner(request, env)) return null;
  return json({ success: false, error: "OWNER_REQUIRED" }, 401);
}
__name(denyUnlessOwner, "denyUnlessOwner");
function digits(v) {
  return String(v || "").replace(/\D/g, "");
}
__name(digits, "digits");
function publicMember(m) {
  return {
    id: m.id,
    name: m.name || "",
    phone: m.phone || "",
    email: m.email || "",
    zonecode: m.zonecode || "",
    address1: m.address1 || "",
    address2: m.address2 || "",
    note: m.note || "",
    active: m.active !== false,
    createdAt: m.createdAt || "",
    lastOrderAt: m.lastOrderAt || "",
    dealer: !!m.dealer,
    business: m.business || ""
  };
}
__name(publicMember, "publicMember");
function withOrderStats(m, orders) {
  const mine = (orders || []).filter((o) => o.memberId === m.id || digits(o.phone) === m.phone);
  const paid = mine.filter((o) => ["입금확인", "배송중", "완료"].includes(o.status));
  const wait = mine.filter((o) => o.status === "입금대기");
  const money = (arr) => arr.reduce((s, o) => s + Number(o.total || 0), 0);
  return {
    ...publicMember(m),
    orderCount: mine.length,
    orderTotal: money(paid),
    waitCount: wait.length,
    waitTotal: money(wait),
    lastOrderAt: mine[0]?.createdAt || m.lastOrderAt || ""
  };
}
__name(withOrderStats, "withOrderStats");
function normalizeFeeTiers(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const t of list.slice(0, 8)) {
    const from = Math.max(0, Math.round(Number(String(t.from ?? t.min ?? 0).toString().replace(/[^\d.]/g, ""))));
    const rate = Math.max(0, Math.min(40, Number(t.rate ?? t.percent ?? 0)));
    if (!Number.isFinite(from) || !Number.isFinite(rate) || rate <= 0) continue;
    if (seen.has(from)) continue;
    seen.add(from);
    out.push({ from, rate });
  }
  out.sort((a, b) => a.from - b.from);
  return out;
}
__name(normalizeFeeTiers, "normalizeFeeTiers");
function feeRateForSales(tiers, sales) {
  let rate = 0;
  for (const t of normalizeFeeTiers(tiers)) {
    if (Number(sales) >= t.from) rate = t.rate;
  }
  return rate;
}
__name(feeRateForSales, "feeRateForSales");
function nextFeeTier(tiers, sales) {
  return normalizeFeeTiers(tiers).find((t) => Number(sales) < t.from) || null;
}
__name(nextFeeTier, "nextFeeTier");
function discountedPrice(listPrice, rate) {
  const n = Math.max(0, Math.round(Number(listPrice || 0)));
  if (!(rate > 0)) return n;
  return Math.max(0, Math.round(n * (100 - rate) / 100));
}
__name(discountedPrice, "discountedPrice");
function dealerFeeInfo(m, orders) {
  const stats = withOrderStats(m, orders);
  const tiers = normalizeFeeTiers(m.feeTiers);
  const rate = m.dealer ? feeRateForSales(tiers, stats.orderTotal) : 0;
  const next = m.dealer ? nextFeeTier(tiers, stats.orderTotal) : null;
  return {
    ...stats,
    feeTiers: tiers,
    feeRate: rate,
    nextFrom: next ? next.from : 0,
    nextRate: next ? next.rate : 0
  };
}
__name(dealerFeeInfo, "dealerFeeInfo");
async function dealerRateForRequest(request, env) {
  const member = await getMemberSession(request, env);
  if (!member || !member.dealer) return { member: member || null, rate: 0 };
  const info = dealerFeeInfo(member, await getOrders(env));
  return { member, rate: info.feeRate, info };
}
__name(dealerRateForRequest, "dealerRateForRequest");

function parseStore(v, fallback) {
  if (v == null || v === "") return fallback;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}
__name(parseStore, "parseStore");
async function shopGet(env, key, fallback) {
  if (env.KOMO_DB) {
    const row = await env.KOMO_DB.prepare("SELECT v FROM store WHERE k = ?").bind(key).first();
    if (row && row.v != null) return parseStore(row.v, fallback);
  }
  const fromKv = await env.KOMO_STORE.get(key, { type: "json" });
  return fromKv == null ? fallback : fromKv;
}
__name(shopGet, "shopGet");
async function shopPut(env, key, value) {
  const v = typeof value === "string" ? value : JSON.stringify(value);
  if (env.KOMO_DB) {
    await env.KOMO_DB.prepare("INSERT OR REPLACE INTO store (k, v) VALUES (?, ?)").bind(key, v).run();
    return;
  }
  await env.KOMO_STORE.put(key, v);
}
__name(shopPut, "shopPut");
async function shopDel(env, key) {
  if (env.KOMO_DB) {
    await env.KOMO_DB.prepare("DELETE FROM store WHERE k = ?").bind(key).run();
    return;
  }
  await env.KOMO_STORE.delete(key);
}
__name(shopDel, "shopDel");
async function getOrders(env) {
  const list = await shopGet(env, "orders", []);
  return Array.isArray(list) ? list : [];
}
__name(getOrders, "getOrders");
async function saveOrders(env, list) {
  await shopPut(env, "orders", list.slice(0, 500));
}
__name(saveOrders, "saveOrders");
async function getMembers(env) {
  const list = await shopGet(env, "members", []);
  return Array.isArray(list) ? list : [];
}
__name(getMembers, "getMembers");
async function saveMembers(env, list) {
  await shopPut(env, "members", list.slice(0, 2e3));
}
__name(saveMembers, "saveMembers");
async function getMemberSession(request, env) {
  const token = cookieVal(request, "ollpick_member");
  if (!token) return null;
  const first = token.indexOf(":");
  const last = token.lastIndexOf(":");
  if (!(first > 0 && last > first)) return null;
  const id = token.slice(first + 1, last);
  const list = await getMembers(env);
  const member = list.find((m) => m.id === id);
  if (!member || member.active === false) return null;
  if (!await tokenMatches(token, { id: member.id, password: member.password })) return null;
  return member;
}
__name(getMemberSession, "getMemberSession");
function kstDate(iso) {
  const d = new Date(iso || Date.now());
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 9 * 3600 * 1e3).toISOString().slice(0, 10);
}
__name(kstDate, "kstDate");
function sumOrders(list) {
  const paid = ["\uC785\uAE08\uD655\uC778", "\uBC30\uC1A1\uC911", "\uC644\uB8CC"];
  const wait = list.filter((o) => o.status === "\uC785\uAE08\uB300\uAE30");
  const ok = list.filter((o) => paid.includes(o.status));
  const cancel = list.filter((o) => o.status === "\uCDE8\uC18C");
  const money = /* @__PURE__ */ __name((arr) => arr.reduce((s, o) => s + Number(o.total || 0), 0), "money");
  return {
    count: list.length,
    total: money(list),
    paidCount: ok.length,
    paidTotal: money(ok),
    waitCount: wait.length,
    waitTotal: money(wait),
    cancelCount: cancel.length,
    cancelTotal: money(cancel)
  };
}
__name(sumOrders, "sumOrders");
function publicProduct(p, extra = {}) {
  return {
    product_id: p.product_id,
    product_no: p.product_no || "",
    name: p.name,
    price: Number(p.price || 0),
    sale_price: Number(p.price || 0),
    order_unit: Number(p.order_unit || 1),
    category: p.category || "",
    thumbnail: p.thumbnail || "",
    badge_genuine: !!p.badge_genuine,
    badge_new: !!p.badge_new,
    badge_hot: !!p.badge_hot,
    badge_low: !!p.badge_low,
    createdAt: inferCreatedAt(p),
    soldQty: Number(extra.soldQty || 0),
    orderQty: Number(extra.orderQty || 0),
    orderCount: Number(extra.orderCount || 0)
  };
}
__name(publicProduct, "publicProduct");
function inferCreatedAt(p) {
  if (p.createdAt) return p.createdAt;
  const id = String(p.product_id || "");
  if (id.startsWith("U")) {
    const n = parseInt(id.slice(1), 36);
    if (Number.isFinite(n) && n > 1.6e12) return new Date(n).toISOString();
  }
  const m = id.match(/^P(\d+)$/i);
  if (m) return new Date(Date.UTC(2026, 7, 1, 0, 0, 0) + Number(m[1]) * 3600 * 1000).toISOString();
  return "2026-08-01T00:00:00.000Z";
}
__name(inferCreatedAt, "inferCreatedAt");
function productStats(orders) {
  const paid = ["입금확인", "배송중", "완료"];
  const sold = {};
  const demand = {};
  const counts = {};
  for (const o of orders || []) {
    if (o.status === "취소") continue;
    const seen = new Set();
    for (const it of o.items || []) {
      const id = it.productId;
      if (!id) continue;
      const q = Number(it.qty || 0);
      demand[id] = (demand[id] || 0) + q;
      if (paid.includes(o.status)) sold[id] = (sold[id] || 0) + q;
      if (!seen.has(id)) {
        seen.add(id);
        counts[id] = (counts[id] || 0) + 1;
      }
    }
  }
  return { sold, demand, counts };
}
__name(productStats, "productStats");
function normalizeProduct(p, fallbackId) {
  const id = String(p.product_id || fallbackId || "").trim();
  const unit = Math.max(1, Number(p.order_unit || 1));
  const price = Math.max(0, Math.round(Number(p.price || 0)));
  return {
    product_id: id,
    product_no: String(p.product_no || "").trim(),
    name: String(p.name || "").trim(),
    price,
    order_unit: unit,
    category: String(p.category || "").trim(),
    thumbnail: String(p.thumbnail || "").trim(),
    active: p.active !== false,
    badge_genuine: !!p.badge_genuine,
    badge_new: !!p.badge_new,
    badge_hot: !!p.badge_hot,
    badge_low: !!p.badge_low,
    createdAt: p.createdAt || ""
  };
}
__name(normalizeProduct, "normalizeProduct");
async function seedProducts(env, request) {
  const r = await env.ASSETS.fetch(new URL("/seed-products.json", request.url));
  const list = await r.json();
  return (Array.isArray(list) ? list : []).map((p, i) => normalizeProduct(p, "P" + String(i + 1).padStart(3, "0")));
}
__name(seedProducts, "seedProducts");
async function getProducts(env, request, forceSeed = false) {
  if (!forceSeed) {
    const saved = await shopGet(env, "products", null);
    if (Array.isArray(saved) && saved.length) return saved.map((p) => normalizeProduct(p, p.product_id));
  }
  const seeded = await seedProducts(env, request);
  await saveProducts(env, seeded);
  return seeded;
}
__name(getProducts, "getProducts");
async function saveProducts(env, list) {
  await shopPut(env, "products", list);
}
__name(saveProducts, "saveProducts");
function parseDataUrl(raw) {
  const m = String(raw || "").match(/^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) return null;
  const bin = Uint8Array.from(atob(m[2].replace(/\s/g, "")), (c) => c.charCodeAt(0));
  if (!bin.length || bin.length > 18e5) return null;
  return { type: m[1], bytes: bin };
}
__name(parseDataUrl, "parseDataUrl");
async function handleLocalApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path.startsWith("/local-api/image/") && request.method === "GET") {
    const id = decodeURIComponent(path.slice("/local-api/image/".length));
    const bytes = await env.KOMO_STORE.get("img:" + id, { type: "arrayBuffer" });
    if (!bytes) return new Response("NOT_FOUND", { status: 404 });
    return new Response(bytes, {
      headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" }
    });
  }
  if (path === "/local-api/catalog" && request.method === "GET") {
    const list = await getProducts(env, request);
    const stats = productStats(await getOrders(env));
    return json({
      success: true,
      products: list.filter((p) => p.active).map((p) => publicProduct(p, {
        soldQty: stats.sold[p.product_id] || 0,
        orderQty: stats.demand[p.product_id] || 0,
        orderCount: stats.counts[p.product_id] || 0
      }))
    });
  }
  if (path === "/local-api/member/me" && request.method === "GET") {
    const member = await getMemberSession(request, env);
    if (!member) return json({ success: true, loggedIn: false, member: null });
    return json({ success: true, loggedIn: true, member: publicMember(member) });
  }
  if (path === "/local-api/member/signup" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const phone = digits(body.phone);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (name.length < 2) return json({ success: false, error: "\uC774\uB984\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694." }, 400);
    if (phone.length < 10 || phone.length > 11) return json({ success: false, error: "\uD734\uB300\uD3F0 \uBC88\uD638\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694." }, 400);
    if (email && !email.includes("@")) return json({ success: false, error: "\uC774\uBA54\uC77C\uC744 \uB2E4\uC2DC \uD655\uC778\uD574\uC8FC\uC138\uC694." }, 400);
    if (password.length < 4) return json({ success: false, error: "\uBE44\uBC00\uBC88\uD638\uB294 4\uC790 \uC774\uC0C1\uC73C\uB85C \uC815\uD574\uC8FC\uC138\uC694." }, 400);
    const list = await getMembers(env);
    if (list.some((m) => m.phone === phone)) return json({ success: false, error: "\uC774\uBBF8 \uAC00\uC785\uB41C \uC804\uD654\uBC88\uD638\uC785\uB2C8\uB2E4. \uB85C\uADF8\uC778\uD574\uC8FC\uC138\uC694." }, 409);
    if (email && list.some((m) => String(m.email || "").toLowerCase() === email)) {
      return json({ success: false, error: "\uC774\uBBF8 \uAC00\uC785\uB41C \uC774\uBA54\uC77C\uC785\uB2C8\uB2E4. \uB85C\uADF8\uC778\uD574\uC8FC\uC138\uC694." }, 409);
    }
    const salt = crypto.randomUUID();
    const member = {
      id: "M" + Date.now().toString(36).toUpperCase(),
      name,
      phone,
      email,
      salt,
      password: await hashPassword(password, salt),
      zonecode: String(body.zonecode || "").trim(),
      address1: String(body.address1 || "").trim(),
      address2: String(body.address2 || "").trim(),
      note: "",
      active: true,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    list.unshift(member);
    await saveMembers(env, list);
    const token = await makeSessionToken({ id: member.id, password: member.password });
    return json({ success: true, member: publicMember(member) }, 200, {
      "set-cookie": sessionCookie(token, "ollpick_member")
    });
  }
  if (path === "/local-api/member/login" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const phone = digits(body.phone);
    const password = String(body.password || "");
    const list = await getMembers(env);
    const member = list.find((m) => m.phone === phone);
    if (!member) return json({ success: false, error: "\uC544\uC774\uB514 \uB610\uB294 \uBE44\uBC00\uBC88\uD638\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." }, 401);
    if (member.active === false) return json({ success: false, error: "\uC774\uC6A9\uC774 \uC911\uC9C0\uB41C \uD68C\uC6D0\uC785\uB2C8\uB2E4." }, 403);
    const hashed = await hashPassword(password, member.salt);
    if (hashed !== member.password) return json({ success: false, error: "\uC544\uC774\uB514 \uB610\uB294 \uBE44\uBC00\uBC88\uD638\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." }, 401);
    const token = await makeSessionToken({ id: member.id, password: member.password });
    return json({ success: true, member: publicMember(member) }, 200, {
      "set-cookie": sessionCookie(token, "ollpick_member")
    });
  }
  if (path === "/local-api/member/logout" && request.method === "POST") {
    return json({ success: true }, 200, { "set-cookie": clearSessionCookie("ollpick_member") });
  }
  if (path === "/local-api/member/find" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = digits(body.phone);
    if (!name && !email.includes("@")) {
      return json({ success: false, error: "\uC774\uB984 \uB610\uB294 \uC774\uBA54\uC77C\uACFC \uD734\uB300\uD3F0 \uBC88\uD638\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694." }, 400);
    }
    if (phone.length < 10) return json({ success: false, error: "\uC774\uB984(\uB610\uB294 \uC774\uBA54\uC77C)\uACFC \uD734\uB300\uD3F0 \uBC88\uD638\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694." }, 400);
    const list = await getMembers(env);
    const hit = list.find((m) => {
      if (m.active === false || m.phone !== phone) return false;
      if (name && String(m.name || "").trim() === name) return true;
      if (email && String(m.email || "").toLowerCase() === email) return true;
      return false;
    });
    if (!hit) return json({ success: false, error: "\uB4F1\uB85D\uB41C \uC815\uBCF4\uC640 \uAC19\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC774\uB984\xB7\uC774\uBA54\uC77C\xB7\uD734\uB300\uD3F0\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694." }, 401);
    const token = crypto.randomUUID();
    await shopPut(env, "member_reset", { token, id: hit.id, exp: Date.now() + 20 * 60 * 1e3 });
    return json({ success: true, token });
  }
  if (path === "/local-api/member/reset" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || "");
    const nextPass = String(body.password || "");
    if (nextPass.length < 4) return json({ success: false, error: "\uC0C8 \uBE44\uBC00\uBC88\uD638\uB294 4\uC790 \uC774\uC0C1\uC73C\uB85C \uC815\uD574\uC8FC\uC138\uC694." }, 400);
    const saved = await shopGet(env, "member_reset", null) || null;
    if (!saved || saved.token !== token || Number(saved.exp || 0) < Date.now()) {
      return json({ success: false, error: "\uC778\uC99D\uC774 \uB9CC\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uCC3E\uC544\uC8FC\uC138\uC694." }, 400);
    }
    const list = await getMembers(env);
    const idx = list.findIndex((m) => m.id === saved.id);
    if (idx < 0) return json({ success: false, error: "\uACC4\uC815\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4." }, 404);
    list[idx].salt = crypto.randomUUID();
    list[idx].password = await hashPassword(nextPass, list[idx].salt);
    await saveMembers(env, list);
    await shopDel(env, "member_reset");
    return json({ success: true });
  }
  if (path === "/local-api/member/me" && request.method === "PUT") {
    const member = await getMemberSession(request, env);
    if (!member) return json({ success: false, error: "LOGIN_REQUIRED" }, 401);
    const body = await request.json().catch(() => ({}));
    const list = await getMembers(env);
    const idx = list.findIndex((m) => m.id === member.id);
    if (idx < 0) return json({ success: false, error: "NOT_FOUND" }, 404);
    const cur = list[idx];
    if (body.name != null) {
      const name = String(body.name || "").trim();
      if (name.length < 2) return json({ success: false, error: "\uC774\uB984\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694." }, 400);
      cur.name = name;
    }
    if (body.email != null) {
      const email = String(body.email || "").trim().toLowerCase();
      if (email && !email.includes("@")) return json({ success: false, error: "\uC774\uBA54\uC77C\uC744 \uB2E4\uC2DC \uD655\uC778\uD574\uC8FC\uC138\uC694." }, 400);
      if (email && list.some((m) => m.id !== cur.id && String(m.email || "").toLowerCase() === email)) {
        return json({ success: false, error: "\uC774\uBBF8 \uC0AC\uC6A9 \uC911\uC778 \uC774\uBA54\uC77C\uC785\uB2C8\uB2E4." }, 409);
      }
      cur.email = email;
    }
    if (body.phone != null) {
      const phone = digits(body.phone);
      if (phone.length < 10 || phone.length > 11) return json({ success: false, error: "\uD734\uB300\uD3F0 \uBC88\uD638\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694." }, 400);
      if (list.some((m) => m.id !== cur.id && m.phone === phone)) {
        return json({ success: false, error: "\uC774\uBBF8 \uC0AC\uC6A9 \uC911\uC778 \uC804\uD654\uBC88\uD638\uC785\uB2C8\uB2E4." }, 409);
      }
      cur.phone = phone;
    }
    if (body.zonecode != null) cur.zonecode = String(body.zonecode || "").trim();
    if (body.address1 != null) cur.address1 = String(body.address1 || "").trim();
    if (body.address2 != null) cur.address2 = String(body.address2 || "").trim();
    if (body.password) {
      const current = String(body.current || "");
      if (String(body.password).length < 4) return json({ success: false, error: "\uBE44\uBC00\uBC88\uD638\uB294 4\uC790 \uC774\uC0C1\uC73C\uB85C \uC815\uD574\uC8FC\uC138\uC694." }, 400);
      const hashed = await hashPassword(current, cur.salt);
      if (hashed !== cur.password) return json({ success: false, error: "\uD604\uC7AC \uBE44\uBC00\uBC88\uD638\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." }, 400);
      cur.salt = crypto.randomUUID();
      cur.password = await hashPassword(String(body.password), cur.salt);
    }
    list[idx] = cur;
    await saveMembers(env, list);
    const token = await makeSessionToken({ id: cur.id, password: cur.password });
    return json({ success: true, member: publicMember(cur) }, 200, {
      "set-cookie": sessionCookie(token, "ollpick_member")
    });
  }
  if (path === "/local-api/member/me" && request.method === "DELETE") {
    const member = await getMemberSession(request, env);
    if (!member) return json({ success: false, error: "LOGIN_REQUIRED" }, 401);
    const list = await getMembers(env);
    const next = list.filter((m) => m.id !== member.id);
    if (next.length === list.length) return json({ success: false, error: "NOT_FOUND" }, 404);
    await saveMembers(env, next);
    return json({ success: true }, 200, { "set-cookie": clearSessionCookie("ollpick_member") });
  }
  if (path === "/local-api/admin/members" && request.method === "GET") {
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const members = await getMembers(env);
    const orders = await getOrders(env);
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const rows = members.map((m) => {
      return withOrderStats(m, orders);
    }).filter((m) => {
      if (!q) return true;
      return (m.name + " " + m.phone + " " + (m.business || "") + " " + (m.note || "")).toLowerCase().includes(q);
    });
    return json({ success: true, count: rows.length, members: rows });
  }
  if (path.startsWith("/local-api/admin/members/") && request.method === "PUT") {
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const id = decodeURIComponent(path.split("/")[4] || "");
    const body = await request.json().catch(() => ({}));
    const list = await getMembers(env);
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0) return json({ success: false, error: "MEMBER_NOT_FOUND" }, 404);
    const cur = list[idx];
    if (body.note != null) cur.note = String(body.note || "").trim().slice(0, 300);
    if (body.active != null) cur.active = !!body.active;
    if (body.name != null) {
      const name = String(body.name || "").trim();
      if (name) cur.name = name;
    }
    if (body.business != null) cur.business = String(body.business || "").trim().slice(0, 80);
    if (body.dealer != null) cur.dealer = !!body.dealer;
    if (body.phone != null) {
      const phone = digits(body.phone);
      if (phone.length < 10 || phone.length > 11) return json({ success: false, error: "휴대폰 번호를 입력해주세요." }, 400);
      if (list.some((m) => m.id !== cur.id && m.phone === phone)) {
        return json({ success: false, error: "이미 사용 중인 전화번호입니다." }, 409);
      }
      cur.phone = phone;
    }
    if (body.password) {
      if (String(body.password).length < 4) return json({ success: false, error: "비밀번호는 4자 이상으로 정해주세요." }, 400);
      cur.salt = crypto.randomUUID();
      cur.password = await hashPassword(String(body.password), cur.salt);
    }
    list[idx] = cur;
    await saveMembers(env, list);
    return json({ success: true, member: publicMember(cur) });
  }
  if (path.startsWith("/local-api/admin/members/") && request.method === "DELETE") {
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const id = decodeURIComponent(path.split("/")[4] || "");
    const list = await getMembers(env);
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0) return json({ success: false, error: "MEMBER_NOT_FOUND" }, 404);
    const removed = list.splice(idx, 1)[0];
    await saveMembers(env, list);
    return json({ success: true, member: publicMember(removed) });
  }
  if (path === "/local-api/admin/hq" && request.method === "GET") {
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const members = await getMembers(env);
    const orders = await getOrders(env);
    const dealers = members.filter((m) => m.dealer);
    const today = kstDate();
    const todayList = orders.filter((o) => kstDate(o.createdAt) === today);
    return json({
      success: true,
      dealers: dealers.length,
      members: members.length,
      products: (await getProducts(env, request)).filter((p) => p.active !== false).length,
      summary: sumOrders(orders),
      today: sumOrders(todayList)
    });
  }
  if (path === "/local-api/admin/dealers" && request.method === "GET") {
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const members = await getMembers(env);
    const orders = await getOrders(env);
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const rows = members.filter((m) => m.dealer).map((m) => withOrderStats(m, orders)).filter((m) => {
      if (!q) return true;
      return (m.name + " " + m.phone + " " + (m.business || "") + " " + (m.note || "")).toLowerCase().includes(q);
    });
    return json({ success: true, count: rows.length, dealers: rows });
  }
  if (path === "/local-api/admin/dealers" && request.method === "POST") {
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const phone = digits(body.phone);
    const password = String(body.password || "");
    const business = String(body.business || "").trim();
    if (name.length < 2) return json({ success: false, error: "이름을 입력해주세요." }, 400);
    if (phone.length < 10 || phone.length > 11) return json({ success: false, error: "휴대폰 번호를 입력해주세요." }, 400);
    if (password && password.length < 4) return json({ success: false, error: "비밀번호는 4자 이상으로 정해주세요." }, 400);
    const list = await getMembers(env);
    const hit = list.find((m) => m.phone === phone);
    if (hit) {
      hit.dealer = true;
      hit.name = name || hit.name;
      hit.business = business || hit.business;
      hit.note = body.note != null ? String(body.note || "").trim().slice(0, 300) : hit.note;
      hit.active = true;
      if (password) {
        hit.salt = crypto.randomUUID();
        hit.password = await hashPassword(password, hit.salt);
      }
      await saveMembers(env, list);
      return json({ success: true, dealer: publicMember(hit), reused: true });
    }
    if (!password) return json({ success: false, error: "새 도매자는 비밀번호를 정해주세요." }, 400);
    const salt = crypto.randomUUID();
    const member = {
      id: "M" + Date.now().toString(36).toUpperCase(),
      name,
      phone,
      email: String(body.email || "").trim().toLowerCase(),
      salt,
      password: await hashPassword(password, salt),
      business,
      dealer: true,
      note: String(body.note || "").trim().slice(0, 300),
      zonecode: "",
      address1: "",
      address2: "",
      active: true,
      createdAt: new Date().toISOString()
    };
    list.unshift(member);
    await saveMembers(env, list);
    return json({ success: true, dealer: publicMember(member), reused: false });
  }
  if (path === "/local-api/admin/status" && request.method === "GET") {
    const staff = await getAccount(env);
    if (await isOperator(request, env)) {
      return json({
        success: true,
        setupNeeded: false,
        loggedIn: true,
        id: staff?.id || "",
        role: "staff"
      });
    }
    const owner = await getOwnerAccount(env);
    if (await isOwner(request, env)) {
      return json({
        success: true,
        setupNeeded: false,
        loggedIn: true,
        id: owner?.id || "",
        role: "owner"
      });
    }
    return json({
      success: true,
      setupNeeded: !staff,
      loggedIn: false,
      id: "",
      role: ""
    });
  }
  if (path === "/local-api/admin/setup" && request.method === "POST") {
    if (await getAccount(env)) return json({ success: false, error: "\uC774\uBBF8 \uC544\uC774\uB514\uAC00 \uC788\uC2B5\uB2C8\uB2E4. \uB85C\uADF8\uC778\uD574\uC8FC\uC138\uC694." }, 409);
    const body = await request.json().catch(() => ({}));
    const err = validAccount(body.id, body.password);
    if (err) return json({ success: false, error: err }, 400);
    const salt = crypto.randomUUID();
    const account = { id: String(body.id).trim(), salt, password: await hashPassword(body.password, salt) };
    await env.KOMO_STORE.put("admin_account", JSON.stringify(account));
    const token = await makeSessionToken(account);
    return json({ success: true, id: account.id }, 200, { "set-cookie": sessionCookie(token) });
  }
  if (path === "/local-api/admin/login" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    const password = String(body.password || "").trim();
    const staff = await getAccount(env);
    if (staff) {
      const hashed = await hashPassword(password, staff.salt);
      if (id.toLowerCase() === String(staff.id || "").toLowerCase() && hashed === staff.password) {
        const token = await makeSessionToken(staff);
        return json({ success: true, id: staff.id, role: "staff" }, 200, {
          "set-cookie": [sessionCookie(token, "ollpick_admin"), clearSessionCookie("ollpick_owner")]
        });
      }
    }
    const owner = await getOwnerAccount(env);
    if (owner) {
      const hashed = await hashPassword(password, owner.salt);
      if (id.toLowerCase() === String(owner.id || "").toLowerCase() && hashed === owner.password) {
        const token = await makeSessionToken(owner);
        return json({ success: true, id: owner.id, role: "owner" }, 200, {
          "set-cookie": [sessionCookie(token, "ollpick_owner"), clearSessionCookie("ollpick_admin")]
        });
      }
    }
    if (!staff && !owner) return json({ success: false, error: "SETUP_NEEDED" }, 400);
    return json({ success: false, error: "\uC544\uC774\uB514 \uB610\uB294 \uBE44\uBC00\uBC88\uD638\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." }, 401);
  }
  if (path === "/local-api/admin/logout" && request.method === "POST") {
    await env.KOMO_STORE.delete("admin_session");
    return json({ success: true }, 200, {
      "set-cookie": [clearSessionCookie("ollpick_admin"), clearSessionCookie("ollpick_owner")]
    });
  }
  if (path === "/local-api/admin/profile" && request.method === "GET") {
    const session = await loggedAdmin(request, env);
    if (!session) return json({ success: false, error: "LOGIN_REQUIRED" }, 401);
    return json({ success: true, role: session.role, ...profilePublic(session.account) });
  }
  if (path === "/local-api/admin/profile" && request.method === "PUT") {
    const session = await loggedAdmin(request, env);
    if (!session) return json({ success: false, error: "LOGIN_REQUIRED" }, 401);
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = digits(body.phone);
    if (name.length < 2) return json({ success: false, error: "\uC774\uB984\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694." }, 400);
    if (!email.includes("@")) return json({ success: false, error: "\uC774\uBA54\uC77C\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694." }, 400);
    if (phone.length < 10) return json({ success: false, error: "\uD734\uB300\uD3F0 \uBC88\uD638\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694." }, 400);
    const next = { ...session.account, name, email, phone };
    await env.KOMO_STORE.put(session.key, JSON.stringify(next));
    return json({ success: true, role: session.role, ...profilePublic(next) });
  }
  if (path === "/local-api/admin/login-id" && request.method === "PUT") {
    const session = await loggedAdmin(request, env);
    if (!session) return json({ success: false, error: "LOGIN_REQUIRED" }, 401);
    const body = await request.json().catch(() => ({}));
    const current = String(body.current || "");
    const nextId = String(body.id || "").trim();
    if (session.account.idLocked) {
      return json({ success: false, error: "\uC544\uC774\uB514\uB294 \uD55C \uBC88\uB9CC \uBC14\uAFC0 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }, 400);
    }
    const err = validId(nextId);
    if (err) return json({ success: false, error: err }, 400);
    if (nextId === session.account.id) {
      return json({ success: false, error: "\uC9C0\uAE08 \uC4F0\uB294 \uC544\uC774\uB514\uC640 \uAC19\uC2B5\uB2C8\uB2E4." }, 400);
    }
    const hashed = await hashPassword(current, session.account.salt);
    if (hashed !== session.account.password) return json({ success: false, error: "\uD604\uC7AC \uBE44\uBC00\uBC88\uD638\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." }, 400);
    const other = session.role === "owner" ? await getAccount(env) : await getOwnerAccount(env);
    if (other && other.id === nextId) return json({ success: false, error: "\uADF8 \uC544\uC774\uB514\uB294 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 400);
    const next = { ...session.account, id: nextId, idLocked: true, idChangedAt: (/* @__PURE__ */ new Date()).toISOString() };
    await env.KOMO_STORE.put(session.key, JSON.stringify(next));
    const cookieName = session.role === "owner" ? "ollpick_owner" : "ollpick_admin";
    const token = await makeSessionToken(next);
    return json({ success: true, id: next.id }, 200, { "set-cookie": sessionCookie(token, cookieName) });
  }
  if (path === "/local-api/admin/password" && request.method === "PUT") {
    const session = await loggedAdmin(request, env);
    if (!session) return json({ success: false, error: "LOGIN_REQUIRED" }, 401);
    const body = await request.json().catch(() => ({}));
    const current = String(body.current || "");
    const nextPass = String(body.password || "");
    if (nextPass.length < 4) return json({ success: false, error: "\uC0C8 \uBE44\uBC00\uBC88\uD638\uB294 4\uC790 \uC774\uC0C1\uC73C\uB85C \uC815\uD574\uC8FC\uC138\uC694." }, 400);
    const hashed = await hashPassword(current, session.account.salt);
    if (hashed !== session.account.password) return json({ success: false, error: "\uD604\uC7AC \uBE44\uBC00\uBC88\uD638\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." }, 400);
    const salt = crypto.randomUUID();
    const next = { ...session.account, salt, password: await hashPassword(nextPass, salt) };
    await env.KOMO_STORE.put(session.key, JSON.stringify(next));
    const cookieName = session.role === "owner" ? "ollpick_owner" : "ollpick_admin";
    const token = await makeSessionToken(next);
    return json({ success: true }, 200, { "set-cookie": sessionCookie(token, cookieName) });
  }
  if (path === "/local-api/admin/find" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const phone = digits(body.phone);
    if (!email.includes("@") || phone.length < 10) {
      return json({ success: false, error: "\uAC00\uC785\uD55C \uC774\uBA54\uC77C\uACFC \uD734\uB300\uD3F0 \uBC88\uD638\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694." }, 400);
    }
    const candidates = [
      { key: "admin_account", account: await getAccount(env) },
      { key: "owner_account", account: await getOwnerAccount(env) }
    ];
    const hit = candidates.find(
      (c) => c.account && String(c.account.email || "").toLowerCase() === email && digits(c.account.phone) === phone
    );
    if (!hit) return json({ success: false, error: "\uB4F1\uB85D\uB41C \uC815\uBCF4\uC640 \uAC19\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC774\uBA54\uC77C\uACFC \uD734\uB300\uD3F0\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694." }, 401);
    const token = crypto.randomUUID();
    await env.KOMO_STORE.put(
      "admin_reset",
      JSON.stringify({ token, key: hit.key, id: hit.account.id, exp: Date.now() + 20 * 60 * 1e3 })
    );
    return json({ success: true, token });
  }
  if (path === "/local-api/admin/reset" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || "");
    const nextPass = String(body.password || "");
    if (nextPass.length < 4) return json({ success: false, error: "\uC0C8 \uBE44\uBC00\uBC88\uD638\uB294 4\uC790 \uC774\uC0C1\uC73C\uB85C \uC815\uD574\uC8FC\uC138\uC694." }, 400);
    const saved = await env.KOMO_STORE.get("admin_reset", { type: "json" }) || null;
    if (!saved || saved.token !== token || Number(saved.exp || 0) < Date.now()) {
      return json({ success: false, error: "\uC778\uC99D\uC774 \uB9CC\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uCC3E\uC544\uC8FC\uC138\uC694." }, 400);
    }
    const account = await env.KOMO_STORE.get(saved.key, { type: "json" }) || null;
    if (!account || account.id !== saved.id) return json({ success: false, error: "\uACC4\uC815\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4." }, 404);
    const salt = crypto.randomUUID();
    account.salt = salt;
    account.password = await hashPassword(nextPass, salt);
    await env.KOMO_STORE.put(saved.key, JSON.stringify(account));
    await env.KOMO_STORE.delete("admin_reset");
    return json({ success: true });
  }
  if (path === "/local-api/owner/status" && request.method === "GET") {
    const account = await getOwnerAccount(env);
    const loggedIn = await isOwner(request, env);
    return json({ success: true, loggedIn, id: loggedIn ? account?.id : "" });
  }
  if (path === "/local-api/owner/login" && request.method === "POST") {
    const account = await getOwnerAccount(env);
    if (!account) return json({ success: false, error: "OWNER_NOT_READY" }, 400);
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    const password = String(body.password || "").trim();
    const hashed = await hashPassword(password, account.salt);
    if (id.toLowerCase() !== String(account.id || "").toLowerCase() || hashed !== account.password) {
      return json({ success: false, error: "\uC544\uC774\uB514 \uB610\uB294 \uBE44\uBC00\uBC88\uD638\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." }, 401);
    }
    const token = await makeSessionToken(account);
    return json({ success: true, id: account.id }, 200, {
      "set-cookie": [sessionCookie(token, "ollpick_owner"), clearSessionCookie("ollpick_admin")]
    });
  }
  if (path === "/local-api/owner/logout" && request.method === "POST") {
    return json({ success: true }, 200, { "set-cookie": clearSessionCookie("ollpick_owner") });
  }
  if (path === "/local-api/owner/sales" && request.method === "GET") {
    const denied = await denyUnlessOwner(request, env);
    if (denied) return denied;
    const list = await getOrders(env);
    const today = kstDate();
    const todayList = list.filter((o) => kstDate(o.createdAt) === today);
    const month = today.slice(0, 7);
    const monthList = list.filter((o) => kstDate(o.createdAt).startsWith(month));
    return json({
      success: true,
      today,
      summary: {
        all: sumOrders(list),
        today: sumOrders(todayList),
        month: sumOrders(monthList)
      },
      staffId: (await getAccount(env))?.id || "",
      orders: list
    });
  }
  if (path === "/local-api/owner/account" && request.method === "POST") {
    const denied = await denyUnlessOwner(request, env);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const err = validAccount(body.id, body.password);
    if (err) return json({ success: false, error: err }, 400);
    const staff = await getAccount(env);
    if (staff && String(body.id).trim() === staff.id) {
      return json({ success: false, error: "\uC2E4\uBB34 \uACC4\uC815\uACFC \uAC19\uC740 \uC544\uC774\uB514\uB294 \uC4F8 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 400);
    }
    const prev = await getOwnerAccount(env);
    const salt = crypto.randomUUID();
    const account = {
      id: String(body.id).trim(),
      salt,
      password: await hashPassword(body.password, salt),
      name: prev?.name || "",
      email: prev?.email || "",
      phone: prev?.phone || ""
    };
    await env.KOMO_STORE.put("owner_account", JSON.stringify(account));
    const token = await makeSessionToken(account);
    return json({ success: true, id: account.id }, 200, { "set-cookie": sessionCookie(token, "ollpick_owner") });
  }
  if (path === "/local-api/admin/account" && request.method === "POST") {
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const err = validAccount(body.id, body.password);
    if (err) return json({ success: false, error: err }, 400);
    const owner = await getOwnerAccount(env);
    if (owner && String(body.id).trim() === owner.id) {
      return json({ success: false, error: "\uADF8 \uC544\uC774\uB514\uB294 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 400);
    }
    const prev = await getAccount(env);
    const salt = crypto.randomUUID();
    const account = {
      id: String(body.id).trim(),
      salt,
      password: await hashPassword(body.password, salt),
      name: prev?.name || "",
      email: prev?.email || "",
      phone: prev?.phone || ""
    };
    await env.KOMO_STORE.put("admin_account", JSON.stringify(account));
    if (await isOperator(request, env)) {
      const token = await makeSessionToken(account);
      return json({ success: true, id: account.id }, 200, { "set-cookie": sessionCookie(token, "ollpick_admin") });
    }
    return json({ success: true, id: account.id });
  }
  if (path === "/local-api/admin/products" && request.method === "GET") {
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const list = await getProducts(env, request);
    return json({ success: true, products: list });
  }
  if (path === "/local-api/admin/seed" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const list = await getProducts(env, request, true);
    return json({ success: true, count: list.length, products: list });
  }
  if (path === "/local-api/admin/products" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const name = String(body.name || "").trim();
    const price = Math.round(Number(body.price || 0));
    if (!name) return json({ success: false, error: "\uC0C1\uD488\uBA85\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694." }, 400);
    if (!(price > 0)) return json({ success: false, error: "\uAE08\uC561\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694." }, 400);
    const list = await getProducts(env, request);
    const id = "U" + Date.now().toString(36).toUpperCase();
    let thumbnail = "";
    const img = parseDataUrl(body.image);
    if (img) {
      await env.KOMO_STORE.put("img:" + id, img.bytes);
      thumbnail = "/local-api/image/" + id;
    }
    const product = normalizeProduct({
      product_id: id,
      product_no: String(body.product_no || "").trim(),
      name,
      price,
      order_unit: body.order_unit || 1,
      category: body.category || "\uC9C1\uC811\uB4F1\uB85D",
      thumbnail,
      active: true,
      badge_genuine: !!body.badge_genuine,
      badge_new: !!body.badge_new,
      badge_hot: !!body.badge_hot,
      badge_low: !!body.badge_low,
      createdAt: new Date().toISOString()
    }, id);
    list.unshift(product);
    await saveProducts(env, list);
    return json({ success: true, product });
  }
  if (path.startsWith("/local-api/admin/products/") && request.method === "PUT") {
    const body = await request.json().catch(() => ({}));
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const id = decodeURIComponent(path.split("/")[4] || "");
    const list = await getProducts(env, request);
    const idx = list.findIndex((p) => p.product_id === id);
    if (idx < 0) return json({ success: false, error: "PRODUCT_NOT_FOUND" }, 404);
    const cur = list[idx];
    if (body.name != null) cur.name = String(body.name).trim() || cur.name;
    if (body.price != null) cur.price = Math.max(0, Math.round(Number(body.price)));
    if (body.order_unit != null) cur.order_unit = Math.max(1, Number(body.order_unit) || 1);
    if (body.category != null) cur.category = String(body.category).trim();
    if (body.product_no != null) cur.product_no = String(body.product_no).trim();
    if (body.active != null) cur.active = !!body.active;
    if (body.badge_genuine != null) cur.badge_genuine = !!body.badge_genuine;
    if (body.badge_new != null) cur.badge_new = !!body.badge_new;
    if (body.badge_hot != null) cur.badge_hot = !!body.badge_hot;
    if (body.badge_low != null) cur.badge_low = !!body.badge_low;
    const img = parseDataUrl(body.image);
    if (img) {
      await env.KOMO_STORE.put("img:" + id, img.bytes);
      cur.thumbnail = "/local-api/image/" + id;
    }
    list[idx] = normalizeProduct(cur, id);
    await saveProducts(env, list);
    return json({ success: true, product: list[idx] });
  }
  if (path.startsWith("/local-api/admin/products/") && request.method === "DELETE") {
    const body = await request.json().catch(() => ({}));
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const id = decodeURIComponent(path.split("/")[4] || "");
    const list = await getProducts(env, request);
    const next = list.filter((p) => p.product_id !== id);
    if (next.length === list.length) return json({ success: false, error: "PRODUCT_NOT_FOUND" }, 404);
    await saveProducts(env, next);
    return json({ success: true });
  }
  if (path === "/local-api/bank" && request.method === "GET") {
    return json({ success: true, ...await bankSettings(env) });
  }
  if (path === "/local-api/bank" && request.method === "PUT") {
    const body = await request.json().catch(() => ({}));
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const next = {
      bank: String(body.bank || "").trim(),
      account: String(body.account || "").trim(),
      holder: String(body.holder || "").trim()
    };
    if (!next.bank || !next.account || !next.holder) return json({ success: false, error: "BANK_REQUIRED" }, 400);
    await env.KOMO_STORE.put("bank", JSON.stringify(next));
    return json({ success: true, ...next });
  }
  if (path === "/local-api/order" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").replace(/\D/g, "");
    const address1 = String(body.address1 || "").trim();
    const address2 = String(body.address2 || "").trim();
    const zonecode = String(body.zonecode || "").trim();
    const items = Array.isArray(body.items) ? body.items : [];
    if (!name || phone.length < 10) return json({ success: false, error: "\uC8FC\uBB38\uC790 \uC774\uB984\uACFC \uC804\uD654\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694." }, 400);
    if (!address1 || !zonecode) return json({ success: false, error: "\uC8FC\uC18C \uAC80\uC0C9\uC73C\uB85C \uBC30\uC1A1\uC9C0\uB97C \uC120\uD0DD\uD574\uC8FC\uC138\uC694." }, 400);
    if (!items.length) return json({ success: false, error: "\uC7A5\uBC14\uAD6C\uB2C8\uAC00 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4." }, 400);
    const catalog = await getProducts(env, request);
    const priced = items.map((it) => {
      const p = catalog.find((x) => x.product_id === it.productId);
      const qty = Math.max(1, Number(it.qty || 1));
      const price = p ? Number(p.price || 0) : Number(it.price || 0);
      return {
        productId: it.productId,
        name: p?.name || it.name,
        thumbnail: p?.thumbnail || it.thumbnail || "",
        price,
        qty,
        orderUnit: p ? Number(p.order_unit || 1) : Number(it.orderUnit || 1)
      };
    });
    const id = "ORD_" + Date.now().toString(36).toUpperCase();
    const member = await getMemberSession(request, env);
    const order = {
      id,
      memberId: member?.id || "",
      name,
      phone,
      address1,
      address2,
      zonecode,
      memo: String(body.memo || "").trim(),
      items: priced,
      total: priced.reduce((s, x) => s + Number(x.price || 0) * Number(x.qty || 0), 0),
      status: "\uC785\uAE08\uB300\uAE30",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const list = await getOrders(env);
    list.unshift(order);
    await saveOrders(env, list);
    if (member) {
      const members = await getMembers(env);
      const idx = members.findIndex((m) => m.id === member.id);
      if (idx >= 0) {
        members[idx].name = name || members[idx].name;
        members[idx].zonecode = zonecode;
        members[idx].address1 = address1;
        members[idx].address2 = address2;
        members[idx].lastOrderAt = order.createdAt;
        await saveMembers(env, members);
      }
    }
    return json({ success: true, order, bank: await bankSettings(env) });
  }
  if (path === "/local-api/orders" && request.method === "GET") {
    const phone = digits(url.searchParams.get("phone") || "");
    const list = await getOrders(env);
    if (await isAdmin(request, env)) return json({ success: true, orders: list });
    const member = await getMemberSession(request, env);
    if (member) {
      return json({
        success: true,
        orders: list.filter((o) => o.memberId === member.id || digits(o.phone) === member.phone)
      });
    }
    if (phone.length >= 10) {
      return json({
        success: true,
        orders: list.filter((o) => digits(o.phone) === phone)
      });
    }
    return json({ success: false, error: "PHONE_OR_LOGIN_REQUIRED" }, 401);
  }
  if (path.startsWith("/local-api/orders/") && path.endsWith("/paid") && request.method === "POST") {
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const id = decodeURIComponent(path.split("/")[3] || "");
    const list = await getOrders(env);
    const idx = list.findIndex((o) => o.id === id);
    if (idx < 0) return json({ success: false, error: "ORDER_NOT_FOUND" }, 404);
    list[idx].status = "\uC785\uAE08\uD655\uC778";
    list[idx].paidAt = (/* @__PURE__ */ new Date()).toISOString();
    list[idx].updatedAt = list[idx].paidAt;
    await saveOrders(env, list);
    return json({ success: true, order: list[idx] });
  }
  if (path.startsWith("/local-api/orders/") && request.method === "PUT") {
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const id = decodeURIComponent(path.split("/")[3] || "");
    const body = await request.json().catch(() => ({}));
    const allowed = ["\uC785\uAE08\uB300\uAE30", "\uC785\uAE08\uD655\uC778", "\uBC30\uC1A1\uC911", "\uC644\uB8CC", "\uCDE8\uC18C"];
    const list = await getOrders(env);
    const idx = list.findIndex((o) => o.id === id);
    if (idx < 0) return json({ success: false, error: "ORDER_NOT_FOUND" }, 404);
    const cur = list[idx];
    if (body.status != null) {
      const status = String(body.status || "");
      if (!allowed.includes(status)) return json({ success: false, error: "\uCC98\uB9AC \uC0C1\uD0DC\uB97C \uB2E4\uC2DC \uC120\uD0DD\uD574\uC8FC\uC138\uC694." }, 400);
      cur.status = status;
      if (status === "\uC785\uAE08\uD655\uC778" && !cur.paidAt) cur.paidAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    if (body.addressChecked != null) {
      cur.addressChecked = !!body.addressChecked;
      cur.addressCheckedAt = cur.addressChecked ? (/* @__PURE__ */ new Date()).toISOString() : "";
    }
    if (body.name != null) {
      const name = String(body.name || "").trim();
      if (name.length < 2) return json({ success: false, error: "받는분 이름을 입력해주세요." }, 400);
      cur.name = name;
    }
    if (body.phone != null) {
      const phone = digits(body.phone);
      if (phone.length < 10 || phone.length > 11) return json({ success: false, error: "휴대폰 번호를 입력해주세요." }, 400);
      cur.phone = phone;
    }
    if (body.zonecode != null) cur.zonecode = String(body.zonecode || "").trim();
    if (body.address1 != null) cur.address1 = String(body.address1 || "").trim();
    if (body.address2 != null) cur.address2 = String(body.address2 || "").trim();
    if (body.memo != null) cur.memo = String(body.memo || "").trim();
    if (Array.isArray(body.items)) {
      const items = body.items.map((it) => {
        const qty = Math.max(0, Number(it.qty || 0));
        const price = Number(it.price || 0);
        return {
          productId: it.productId || "",
          name: String(it.name || ""),
          thumbnail: it.thumbnail || "",
          price,
          qty,
          orderUnit: Number(it.orderUnit || 1),
        };
      }).filter((it) => it.qty > 0 && it.name);
      if (!items.length) return json({ success: false, error: "상품이 비어 있으면 주문을 삭제해 주세요." }, 400);
      cur.items = items;
      cur.total = items.reduce((s, x) => s + Number(x.price || 0) * Number(x.qty || 0), 0);
    }
    if (body.address1 != null && !String(cur.address1 || "").trim()) {
      return json({ success: false, error: "배송지를 입력해주세요." }, 400);
    }
    cur.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    list[idx] = cur;
    await saveOrders(env, list);
    return json({ success: true, order: list[idx] });
  }
  if (path.startsWith("/local-api/orders/") && request.method === "DELETE") {
    const denied = await denyUnlessAdmin(request, env);
    if (denied) return denied;
    const id = decodeURIComponent(path.split("/")[3] || "");
    const list = await getOrders(env);
    const idx = list.findIndex((o) => o.id === id);
    if (idx < 0) return json({ success: false, error: "ORDER_NOT_FOUND" }, 404);
    const removed = list.splice(idx, 1)[0];
    await saveOrders(env, list);
    return json({ success: true, order: removed });
  }
  return json({ success: false, error: "NOT_FOUND" }, 404);
}
__name(handleLocalApi, "handleLocalApi");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const fav = serveFavicon(pathname);
    if (fav) return fav;
    try {
      if (pathname.startsWith("/local-api/")) return await handleLocalApi(request, env);
    } catch (err) {
      const msg = String(err.message || err);
      const friendly = /limit exceeded|KV put/i.test(msg) ? "지금은 저장이 잠시 밀렸습니다. 다시 한 번 눌러주세요." : msg;
      return json({ success: false, error: friendly }, 500);
    }
    if (pathname === "/admin" || pathname === "/admin/login" || pathname === "/report" || pathname === "/boss" || pathname === "/admin/owner" || pathname === "/admin/owner/login") {
      if (typeof ADMIN_LOGIN_HTML === "string" && ADMIN_LOGIN_HTML) {
        return new Response(ADMIN_LOGIN_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return serveAsset(env, request, "/admin-login.html");
    }
    if (pathname === "/admin/home" || pathname === "/admin/dashboard" || pathname === "/report/sales" || pathname === "/boss/sales" || pathname === "/admin/owner/sales" || pathname === "/admin/owner/home") {
      if (typeof ADMIN_HOME_HTML === "string" && ADMIN_HOME_HTML) {
        return new Response(ADMIN_HOME_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return serveAsset(env, request, "/admin-home.html");
    }
    if (pathname === "/admin/dealers" || pathname === "/admin/wholesale") {
      if (typeof ADMIN_DEALERS_HTML === "string" && ADMIN_DEALERS_HTML) {
        return new Response(ADMIN_DEALERS_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return serveAsset(env, request, "/admin-dealers.html");
    }
    if (pathname === "/admin/bank" || pathname === "/admin/deposits" || pathname === "/admin/orders") {
      if (typeof ADMIN_BANK_HTML === "string" && ADMIN_BANK_HTML) {
        return new Response(ADMIN_BANK_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return serveAsset(env, request, "/admin-bank.html");
    }
    if (pathname === "/admin/products" || pathname === "/admin/catalog") {
      if (typeof ADMIN_PRODUCTS_HTML === "string" && ADMIN_PRODUCTS_HTML) {
        return new Response(ADMIN_PRODUCTS_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return serveAsset(env, request, "/admin-products.html");
    }
    if (pathname === "/admin/members" || pathname === "/admin/customers") {
      if (typeof ADMIN_MEMBERS_HTML === "string" && ADMIN_MEMBERS_HTML) {
        return new Response(ADMIN_MEMBERS_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return serveAsset(env, request, "/admin-members.html");
    }
    if (pathname === "/admin/me" || pathname === "/admin/profile") {
      if (typeof ADMIN_ME_HTML === "string" && ADMIN_ME_HTML) {
        return new Response(ADMIN_ME_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return serveAsset(env, request, "/admin-me.html");
    }
    if (pathname === "/admin/find" || pathname === "/admin/reset") {
      if (typeof ADMIN_FIND_HTML === "string" && ADMIN_FIND_HTML) {
        return new Response(ADMIN_FIND_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return serveAsset(env, request, "/admin-find.html");
    }
    if (isShopPage(pathname)) {
      if (typeof SHOP_HTML === "string" && SHOP_HTML) {
        return new Response(SHOP_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return serveAsset(env, request, "/shop.html");
    }
    if (isSellerPage(pathname)) {
      return Response.redirect(new URL("/admin", request.url), 302);
    }
    if (pathname.startsWith("/products/") || isLocalAsset(pathname)) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.ok) {
        if (pathname.startsWith("/products/")) {
          const headers = new Headers(asset.headers);
          headers.set("cache-control", "public, max-age=86400");
          return new Response(asset.body, { status: asset.status, headers });
        }
        return asset;
      }
    }
    const referer = pathname.startsWith("/admin") ? "/admin" : "/shop";
    return proxy(request, referer);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map