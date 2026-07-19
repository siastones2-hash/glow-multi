#!/usr/bin/env node
/**
 * 텔레그램 봇 토큰·채팅 ID → .env 저장 + (선택) webhook 등록
 * 사용: node scripts/telegram-setup.mjs [봇토큰] [채팅ID]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
dotenv.config({ path: path.join(root, ".env") });

const token = (process.argv[2] || process.env.TELEGRAM_BOT_TOKEN || "").trim();
let chatId = (process.argv[3] || process.env.TELEGRAM_CHAT_ID || "").trim();
const publicBase = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  process.env.PUBLIC_BASE_URL ||
  ""
).replace(/\/$/, "");

if (!token) {
  console.error("사용법: node scripts/telegram-setup.mjs <봇토큰> [채팅ID]");
  console.error("  또는 .env / telegram.local.env 에 TELEGRAM_BOT_TOKEN 설정");
  process.exit(1);
}

async function tg(method, body = {}) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.description || method);
  return d.result;
}

const me = await tg("getMe");
console.log(`봇 확인: @${me.username}`);

if (!chatId) {
  const updates = await tg("getUpdates", { limit: 20 });
  const last = [...updates].reverse().find((u) => u.message?.chat?.id || u.callback_query?.message?.chat?.id);
  const chat = last?.message?.chat || last?.callback_query?.message?.chat;
  if (chat) {
    chatId = String(chat.id);
    console.log(`채팅 ID 자동 감지: ${chatId} (${chat.title || chat.first_name || chat.type})`);
  } else {
    console.error("\n채팅 ID 없음 → 봇/그룹에 /start 보낸 뒤 다시 실행하거나");
    console.error("  node scripts/telegram-setup.mjs <토큰> <채팅ID>");
    process.exit(1);
  }
}

const envPath = path.join(root, ".env");
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const set = (k, v) => {
  const line = `${k}=${v}`;
  env = new RegExp(`^${k}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${k}=.*$`, "m"), line) : env.trimEnd() + "\n" + line + "\n";
};
set("TELEGRAM_BOT_TOKEN", token);
set("TELEGRAM_CHAT_ID", chatId);
fs.writeFileSync(envPath, env);
console.log("✅ .env 저장 완료");

await tg("sendMessage", {
  chat_id: chatId,
  text: "✅ <b>슈퍼샤샤</b> 텔레그램 연동 테스트",
  parse_mode: "HTML",
});
console.log("✅ 테스트 메시지 전송");

if (publicBase) {
  const url = `${publicBase}/api/tg/webhook`;
  await tg("setWebhook", { url, allowed_updates: ["callback_query"] });
  console.log(`✅ webhook 등록: ${url}`);
} else {
  console.log("ℹ PUBLIC_URL/RENDER_EXTERNAL_URL 없음 — Render 배포 후 서버 재시작하면 webhook 자동 등록");
}
