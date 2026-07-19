# SUPERSHASHA — 멀티테넌트 SMM 패널

본사 → 대리점 → 손님 3단 구조. 네온 글로우 SPA + Express API.

```
슈퍼샤샤 (숨김) → 본사 (master) → 대리점 (agency) → 손님
```

---

## 빠른 시작

```bash
cp .env.example .env   # 비밀번호·SECRET 변경
npm install
npm start              # http://localhost:3000/?tenant=master
```

또는 맥: **`실행_Mac.command`** 더블클릭.

- **API 키 없음** → 미리보기(샘플 상품, 가짜 공급 주문)
- **API 키 있음** → 실연동(큐레이션된 상품 ~100–200개, 실제 주문)

> API 연결 전: **`API-연결전-체크리스트.md`** · **`시작하기.md`**

---

## 접속 URL

| 역할 | URL | 기본 계정 |
|------|-----|-----------|
| 슈퍼샤샤 | `?tenant=sh4-op-internal` | leestones / `.env` |
| 본사 | `?tenant=master` | master / master1234 |
| 대리점 | `?tenant=nine` | nineadmin / nine1234 |

---

## 주요 기능

- 멀티테넌트 마진·크레딧·환율(FX)
- 손님 화면 4개국어 (한·중·베·태)
- 충전 요청 → 관리자 승인 (+ 텔레그램)
- 크레딧 요청 (대리점→본사→슈퍼샤샤)
- 오프라인 체험: `demo/index.html` + `미리보기.command`

---

## 파일 구조

```
supershasha/
├─ server.js           # API · 멀티테넌트 · 공급사 프록시
├─ i18n-service.js     # 상품 설명 다국어
├─ public/index.html   # 프로덕션 SPA
├─ demo/index.html     # 오프라인 체험판
├─ render.yaml         # Render Blueprint
└─ data/db.json        # 파일 DB (자동 생성)
```

---

## Render 배포

1. GitHub Private 푸시
2. Render Blueprint → `render.yaml`
3. `MORETHAN_API_KEY`, `ADMIN_PASSWORD` 설정

⚠️ Render 무료: 재배포 시 `data/db.json` 초기화. 장기 운영은 PostgreSQL 권장.
