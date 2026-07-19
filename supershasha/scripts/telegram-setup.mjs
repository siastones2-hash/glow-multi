#!/usr/bin/env node
/**
 * 텔레그램 봇 토큰·팀 그룹 채팅 ID → .env 저장 + (선택) webhook 등록
 * 3명이 한곳에서 보려면 개인 ID가 아니라 그룹 ID(-100…)를 넣으세요.
 * 사용: node scripts/telegram-setup.mjs [봇토큰] [그룹채팅ID]
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
  console.error("사용법: node scripts/telegram-setup.mjs <봇토큰> [그룹채팅ID]");
  console.error("  팀 3명: 텔레그램 그룹 만들기 → 3명+봇 초대 → 그룹 ID(-100…) 입력");
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

function chatLabel(chat) {
  if (!chat) return "?";
  return chat.title || chat.first_name || chat.username || chat.type || "?";
}

function pickTeamGroupChat(updates) {
  const seen = new Map();
  for (const u of updates) {
    const chat = u.message?.chat || u.callback_query?.message?.chat;
    if (!chat?.id) continue;
    seen.set(chat.id, chat);
  }
  const chats = [...seen.values()];
  const group = chats.find((c) => c.type === "supergroup" || c.type === "group");
  if (group) return group;
  return chats[chats.length - 1] || null;
}

const me = await tg("getMe");
console.log(`봇 확인: @${me.username}`);

if (!chatId) {
  console.log("\n팀 그룹 설정: 그룹에 3명 + @"+me.username+" 초대 후 그룹에서 /start 입력\n");
  const updates = await tg("getUpdates", { limit: 50 });
  const chat = pickTeamGroupChat(updates);
  if (chat) {
    chatId = String(chat.id);
    const isGroup = chat.type === "group" || chat.type === "supergroup";
    console.log(`채팅 ID 자동 감지: ${chatId}`);
    console.log(`  종류: ${chat.type} · ${chatLabel(chat)}`);
    if (!isGroup) {
      console.warn("\n⚠ 개인 채팅으로 감지됐습니다. 3명이 같이 보려면:");
      console.warn("  1) 텔레그램 그룹 생성 → 3명 + 봇 초대");
      console.warn("  2) 그룹에서 /start 입력");
      console.warn("  3) 이 스크립트 다시 실행\n");
    } else {
      console.log("✅ 그룹 ID — 이 방에 알림이 가면 멤버 전원이 함께 봅니다.\n");
    }
  } else {
    console.error("채팅 ID 없음 → 팀 그룹에 봇 추가 후 그룹에서 /start 보내고 다시 실행");
    console.error("  node scripts/telegram-setup.mjs <토큰> <그룹채팅ID>");
    process.exit(1);
  }
}

const envPath = path.join(root, ".env");
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const set = (k, v) => {
  const line = `${k}=${v}`;
  env = new RegExp(`^${k}=.*$`, "m").test(env)
    ? env.replace(new RegExp(`^${k}=.*$`, "m"), line)
    : env.trimEnd() + "\n" + line + "\n";
};
set("TELEGRAM_BOT_TOKEN", token);
set("TELEGRAM_CHAT_ID", chatId);
fs.writeFileSync(envPath, env);
console.log("✅ .env 저장 완료");

await tg("sendMessage", {
  chat_id: chatId,
  text: "✅ <b>슈퍼샤샤</b> 팀 그룹 연동 테스트\n이 방에 주문·충전·가입 알림이 옵니다. (멤버 전원 수신)",
  parse_mode: "HTML",
});
console.log("✅ 테스트 메시지 전송 — 그룹에서 3명 모두 확인하세요");

if (publicBase) {
  const url = `${publicBase}/api/tg/webhook`;
  await tg("setWebhook", { url, allowed_updates: ["callback_query"] });
  console.log(`✅ webhook 등록: ${url}`);
} else {
  console.log("ℹ PUBLIC_URL/RENDER_EXTERNAL_URL 없음 — Render 배포 후 서버 재시작하면 webhook 자동 등록");
}
