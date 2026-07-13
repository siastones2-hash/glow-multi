# 리스톤즈 — 멀티테넌트 마케팅 자동화 시스템

본사 직영 + 지인(파트너) 사이트 구조의 멀티테넌트 시스템.
지인에게는 원가·본사 마진이 숨겨지고, 선불 공급 크레딧 모델로 운영됩니다. 네온 글로우 UI.

---

## 1. 빠른 시작 (로컬)

```bash
npm install
# .env 는 이미 키가 들어 있습니다 (없으면 .env.example 복사)
npm start                  # http://localhost:3000
```

`.env`에 공급사 API 키가 있으면 **실시간(live)** 으로 실제 상품·주문·잔액이 연동됩니다.
키가 없으면 **미리보기(preview)** 로 샘플 상품이 표시됩니다.
화면(index.html)만 단독으로 열어도 내장 샘플 상품이 보이며, 실제 상품은 서버 구동 후 표시됩니다.

> ⚠️ API 키는 절대 깃허브나 프론트엔드에 노출하지 마세요. `.env`(또는 배포 환경변수)에만.

---

## 2. 공급사 API 연동

`.env`에 다음 두 값만 채우면 자동 연동됩니다. 동작은 코드가 처리합니다(상품목록/주문생성/상태조회/잔액). 호출에는 8초 타임아웃 + 실패 시 샘플 폴백이 걸려 있어 화면이 멈추지 않습니다.

```
SUPPLIER_API_URL=  (공급처 API 주소)
SUPPLIER_API_KEY=  (발급받은 키)
```

> 현재 코드 변수명은 호환을 위해 `MORETHAN_API_URL` / `MORETHAN_API_KEY` 입니다.
> 원하면 `server.js`와 `.env`에서 이 변수명을 `SUPPLIER_*`로 일괄 변경해도 됩니다(기능 동일).

---

## 3. 멀티테넌트 (본사 / 지인)

- **본사(main)** : 원가 위에 `marginPercent`(기본 35%)를 얹어 고객에게 판매
- **지인(partner)** : 본사 공급가(=본사 판매가) 위에 자기 `marginPercent`(기본 20%)를 얹어 판매
  - 지인은 **원가와 본사 마진을 절대 볼 수 없음** (응답에서 제거)
  - 지인 주문 시 본사 선불 **공급 크레딧**에서 차감

**사이트 접속 URL** : `?tenant=slug`
- 본사: `https://도메인/`
- 지인: `https://도메인/?tenant=nine`

관리자 콘솔 → **사이트 관리**에서 지인 추가·마진·크레딧 관리, 로고는 테넌트별 `logoUrl`로 지정.

---

## 4. 권한 / 기본 계정

| 권한 | 설명 |
|---|---|
| `superadmin` | 본사 슈퍼관리자 — 전체 사이트·원가·이익·테넌트·크레딧 |
| `admin` | 사이트 관리자 — 자기 사이트 주문/회원/충전 |
| `user` | 일반 회원 |

초기 슈퍼관리자: `.env`의 `ADMIN_USERNAME` / `ADMIN_PASSWORD` (기본 `leestones` / `1234` — **반드시 변경**).

---

## 5. 운영 흐름

1. 회원이 **충전 요청** → 관리자 **승인**(콘솔 또는 텔레그램 버튼) → 잔액 반영
2. 회원이 **주문** → 잔액 차감 → 공급처에 실제 주문 전송
3. **새로고침**으로 실시간 상태 동기화

---

## 6. 로고 교체

`public/`에 로고 파일(예: `logo.png`)을 넣고, 관리자 콘솔의 사이트 설정 또는
`server.js`의 해당 테넌트 `logoUrl`을 `/logo.png`로 지정하면 헤더 워드마크 대신 이미지가 표시됩니다.

---

## 7. 텔레그램 알림 (선택)

`.env`에 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` 설정 시 가입/주문/충전 알림 + 인라인 승인 버튼.
webhook 등록:
```
https://api.telegram.org/bot<토큰>/setWebhook?url=https://배포도메인/api/tg/webhook
```

---

## 8. Render 배포

1. 깃허브 푸시 (`.env`, `node_modules`, `data/`는 `.gitignore` 처리됨)
2. Render → New Web Service → Build `npm install` / Start `npm start`
3. 환경변수에 `.env` 값 등록 (특히 API 키, `SESSION_SECRET`)

> Render 무료 디스크는 재배포 시 초기화됩니다. `data/db.json`은 프로토타입용이며,
> 실제 운영은 **PostgreSQL 전환**을 권장합니다.

---

## 9. 파일 구조

```
morethan-multi/
├─ server.js          # 공급사 프록시 + 멀티테넌트 + 인증 + 크레딧 + 텔레그램
├─ public/index.html  # 네온 글로우 화면 (고객/회원/관리자 통합)
├─ package.json
├─ .env / .env.example
└─ data/db.json       # 자동 생성 (파일 DB)
```
