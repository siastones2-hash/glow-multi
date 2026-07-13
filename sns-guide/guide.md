# Next.js + Supabase SNS 프로젝트 지침 (커서 전달용)

> Threads(스레드)를 참고한 SNS 웹앱. 대표 상품을 모아 보여주고, 유저가 글/댓글로 소통하는 기능. 아래 순서대로 만들어줘. 개발 초보 기준으로, 코드는 그대로 복붙 가능하게 완성본으로 제공.

---

## 0. 기술 스택
- Next.js (App Router, TypeScript, Tailwind CSS)
- Supabase (인증 + 데이터베이스)
- `@supabase/ssr`, `@supabase/supabase-js`

---

## 1. 프로젝트 세팅

```bash
npx create-next-app@latest my-sns
# 옵션: TypeScript=Yes, ESLint=Yes, Tailwind=Yes, src/=Yes, App Router=Yes, Turbopack=Yes, import alias(@/*)=Yes

cd my-sns
npm install @supabase/supabase-js @supabase/ssr
```

루트에 `.env.local` 생성:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

> 키는 Supabase 대시보드 → Project Settings → API 에서 복사. `.env.local` 수정 후에는 `npm run dev` 재실행 필요.

---

## 2. 폴더 구조

```
my-sns/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                # 홈 피드
│   │   ├── login/page.tsx          # 로그인/회원가입
│   │   ├── products/page.tsx       # 대표 상품
│   │   ├── post/[id]/page.tsx      # 게시글 상세 + 댓글
│   │   └── auth/signout/route.ts   # 로그아웃 처리
│   ├── components/
│   │   ├── PostForm.tsx
│   │   ├── PostCard.tsx
│   │   ├── CommentForm.tsx
│   │   └── ProductCard.tsx
│   ├── lib/supabase/
│   │   ├── client.ts               # 브라우저용
│   │   └── server.ts               # 서버용
│   └── middleware.ts               # 세션 자동 갱신
├── .env.local
└── package.json
```

---

## 3. 데이터베이스 (Supabase SQL Editor에서 실행)

```sql
-- 프로필
create table profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique not null,
  avatar_url text,
  bio text,
  created_at timestamptz default now()
);

-- 상품
create table products (
  id bigint generated always as identity primary key,
  name text not null,
  description text,
  image_url text,
  price integer,
  created_at timestamptz default now()
);

-- 게시글
create table posts (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  content text not null,
  image_url text,
  product_id bigint references products(id) on delete set null,
  created_at timestamptz default now()
);

-- 댓글
create table comments (
  id bigint generated always as identity primary key,
  post_id bigint references posts(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  content text not null,
  created_at timestamptz default now()
);

-- 좋아요
create table likes (
  id bigint generated always as identity primary key,
  post_id bigint references posts(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique (post_id, user_id)
);

-- RLS 활성화
alter table profiles enable row level security;
alter table products enable row level security;
alter table posts enable row level security;
alter table comments enable row level security;
alter table likes enable row level security;

-- 읽기: 누구나
create policy "read_all" on profiles for select using (true);
create policy "read_all" on products for select using (true);
create policy "read_all" on posts for select using (true);
create policy "read_all" on comments for select using (true);
create policy "read_all" on likes for select using (true);

-- 쓰기: 본인만
create policy "insert_own" on profiles for insert with check (auth.uid() = id);
create policy "insert_own" on posts for insert with check (auth.uid() = user_id);
create policy "delete_own" on posts for delete using (auth.uid() = user_id);
create policy "insert_own" on comments for insert with check (auth.uid() = user_id);
create policy "insert_own" on likes for insert with check (auth.uid() = user_id);
```

> 개발 중 이메일 인증이 번거로우면: Authentication → Providers → Email → "Confirm email" 잠깐 끄기.

---

## 4. Supabase 클라이언트

### `src/lib/supabase/client.ts`
```tsx
import { createBrowserClient } from '@supabase/ssr'

export const createClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
```

### `src/lib/supabase/server.ts`
```tsx
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const createClient = async () => {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // 서버 컴포넌트에서 쿠키 수정 시 무시 (미들웨어가 갱신 담당)
          }
        },
      },
    }
  )
}
```

### `src/middleware.ts`
```tsx
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  await supabase.auth.getUser()
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

---

## 5. 인증 페이지

### `src/app/login/page.tsx`
```tsx
'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) alert(error.message)
      else if (data.user) {
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({ id: data.user.id, username: username || email.split('@')[0] })
        if (profileError) alert(profileError.message)
        else {
          alert('회원가입 완료! 자동으로 로그인됩니다.')
          router.push('/')
          router.refresh()
        }
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) alert(error.message)
      else {
        router.push('/')
        router.refresh()
      }
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-8 shadow-md">
        <h2 className="text-center text-3xl font-bold tracking-tight text-gray-900">
          {isSignUp ? '계정 만들기' : '로그인'}
        </h2>
        <form className="mt-8 space-y-4" onSubmit={handleAuth}>
          {isSignUp && (
            <input type="text" placeholder="사용자 아이디(닉네임)" required
              className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-black focus:outline-none"
              value={username} onChange={(e) => setUsername(e.target.value)} />
          )}
          <input type="email" placeholder="이메일 주소" required
            className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-black focus:outline-none"
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="비밀번호" required
            className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-black focus:outline-none"
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" disabled={loading}
            className="w-full rounded-xl bg-black py-3 font-semibold text-white transition hover:bg-gray-800 disabled:bg-gray-400">
            {loading ? '처리 중...' : isSignUp ? '가입하기' : '로그인'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-600">
          {isSignUp ? '이미 계정이 있으신가요?' : '처음이신가요?'}
          <button className="ml-2 font-semibold text-black underline"
            onClick={() => setIsSignUp(!isSignUp)}>
            {isSignUp ? '로그인하기' : '회원가입하기'}
          </button>
        </p>
      </div>
    </div>
  )
}
```

### `src/app/auth/signout/route.ts`
```tsx
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/', request.url), { status: 302 })
}
```

---

## 6. 홈 피드

### `src/app/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server'
import PostForm from '@/components/PostForm'
import PostCard from '@/components/PostCard'
import Link from 'next/link'

export const revalidate = 0

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let username = ''
  if (user) {
    const { data: profile } = await supabase
      .from('profiles').select('username').eq('id', user.id).single()
    username = profile?.username ?? ''
  }

  const { data: posts, error } = await supabase
    .from('posts')
    .select(`id, content, created_at, profiles ( username, avatar_url )`)
    .order('created_at', { ascending: false })

  return (
    <div className="min-h-screen bg-white text-black">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-gray-100 bg-white/80 px-4 backdrop-blur-md">
        <span className="text-xl font-bold tracking-wider">모아보기</span>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/products" className="font-semibold text-gray-700 hover:underline">상품</Link>
          {user ? (
            <>
              <span className="text-gray-500"><b className="text-black">{username}</b>님 환영합니다!</span>
              <form action="/auth/signout" method="post">
                <button type="submit" className="font-semibold text-gray-700 hover:underline">로그아웃</button>
              </form>
            </>
          ) : (
            <Link href="/login" className="font-semibold text-blue-500 hover:underline">로그인</Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-xl border-x border-gray-100 min-h-[calc(100vh-3.5rem)]">
        <PostForm userId={user?.id} />
        <div className="divide-y divide-gray-100">
          {error && <p className="p-4 text-red-500">데이터를 불러오지 못했습니다.</p>}
          {posts && posts.length === 0 && (
            <p className="p-8 text-center text-gray-400">첫 번째 글을 작성해 보세요!</p>
          )}
          {posts?.map((post: any) => <PostCard key={post.id} post={post} />)}
        </div>
      </main>
    </div>
  )
}
```

### `src/components/PostForm.tsx`
```tsx
'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function PostForm({ userId }: { userId: string | undefined }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId) { alert('로그인이 필요한 서비스입니다.'); return router.push('/login') }
    if (!content.trim()) return
    setLoading(true)
    const { error } = await supabase.from('posts').insert({ user_id: userId, content })
    if (error) alert(error.message)
    else { setContent(''); router.refresh() }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="border-b border-gray-100 p-4">
      <div className="flex gap-3">
        <div className="h-10 w-10 rounded-full bg-gray-200" />
        <div className="flex-1">
          <textarea className="w-full resize-none text-base outline-none placeholder:text-gray-400"
            placeholder="새로운 소식을 남겨보세요..." rows={3}
            value={content} onChange={(e) => setContent(e.target.value)} />
          <div className="mt-2 flex justify-end">
            <button type="submit" disabled={loading}
              className="rounded-full bg-black px-4 py-1.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:bg-gray-300">
              게시
            </button>
          </div>
        </div>
      </div>
    </form>
  )
}
```

### `src/components/PostCard.tsx`
```tsx
import Link from 'next/link'

export interface PostProps {
  id: number
  content: string
  created_at: string
  profiles: { username: string; avatar_url: string | null }
}

export default function PostCard({ post }: { post: PostProps }) {
  return (
    <Link href={`/post/${post.id}`} className="block border-b border-gray-100 p-4 hover:bg-gray-50/50 transition">
      <div className="flex gap-3">
        <div className="h-10 w-10 flex-shrink-0 rounded-full bg-gray-300">
          {post.profiles?.avatar_url && (
            <img src={post.profiles.avatar_url} alt="avatar" className="rounded-full" />
          )}
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm">{post.profiles?.username || '알 수 없는 사용자'}</span>
            <span className="text-xs text-gray-400">{new Date(post.created_at).toLocaleDateString()}</span>
          </div>
          <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{post.content}</p>
        </div>
      </div>
    </Link>
  )
}
```

---

## 7. 게시글 상세 + 댓글

### `src/app/post/[id]/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server'
import CommentForm from '@/components/CommentForm'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const revalidate = 0

export default async function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: post } = await supabase
    .from('posts')
    .select('id, content, created_at, profiles(username, avatar_url)')
    .eq('id', id).single()

  if (!post) notFound()

  const { data: comments } = await supabase
    .from('comments')
    .select('id, content, created_at, profiles(username)')
    .eq('post_id', id).order('created_at', { ascending: true })

  return (
    <div className="min-h-screen bg-white text-black">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-gray-100 bg-white/80 px-4 backdrop-blur-md">
        <Link href="/" className="text-lg font-bold">←</Link>
        <span className="font-bold">게시글</span>
      </header>

      <main className="mx-auto max-w-xl border-x border-gray-100">
        <div className="border-b border-gray-100 p-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-gray-300" />
            {/* @ts-expect-error 조인 타입 */}
            <span className="font-semibold">{post.profiles?.username ?? '익명'}</span>
          </div>
          <p className="whitespace-pre-wrap text-gray-800">{post.content}</p>
        </div>

        <CommentForm postId={post.id} userId={user?.id} />

        <div className="divide-y divide-gray-100">
          {comments?.length === 0 && (
            <p className="p-8 text-center text-sm text-gray-400">첫 댓글을 남겨보세요!</p>
          )}
          {comments?.map((c: any) => (
            <div key={c.id} className="p-4">
              <span className="text-sm font-semibold">{c.profiles?.username ?? '익명'}</span>
              <p className="mt-1 text-sm text-gray-700">{c.content}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
```

### `src/components/CommentForm.tsx`
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function CommentForm({ postId, userId }: { postId: number; userId: string | undefined }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId) { alert('로그인이 필요합니다.'); return router.push('/login') }
    if (!content.trim()) return
    setLoading(true)
    const { error } = await supabase.from('comments').insert({ post_id: postId, user_id: userId, content })
    if (error) alert(error.message)
    else { setContent(''); router.refresh() }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 border-b border-gray-100 p-4">
      <input type="text" value={content} onChange={(e) => setContent(e.target.value)}
        placeholder="댓글을 남겨보세요..."
        className="flex-1 rounded-full border border-gray-200 px-4 py-2 text-sm outline-none focus:border-black" />
      <button type="submit" disabled={loading}
        className="rounded-full bg-black px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300">
        등록
      </button>
    </form>
  )
}
```

---

## 8. 대표 상품

### `src/app/products/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server'
import ProductCard from '@/components/ProductCard'
import Link from 'next/link'

export const revalidate = 0

export default async function ProductsPage() {
  const supabase = await createClient()
  const { data: products } = await supabase
    .from('products')
    .select('id, name, description, image_url, price')
    .order('created_at', { ascending: false })

  return (
    <div className="min-h-screen bg-white text-black">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-gray-100 bg-white/80 px-4 backdrop-blur-md">
        <Link href="/" className="text-lg font-bold">←</Link>
        <span className="font-bold">대표 상품</span>
      </header>
      <main className="mx-auto max-w-3xl p-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {products?.length === 0 && (
            <p className="col-span-full py-12 text-center text-gray-400">등록된 상품이 없습니다.</p>
          )}
          {products?.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      </main>
    </div>
  )
}
```

### `src/components/ProductCard.tsx`
```tsx
export interface Product {
  id: number
  name: string
  description: string | null
  image_url: string | null
  price: number | null
}

export default function ProductCard({ product }: { product: Product }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 shadow-sm transition hover:shadow-md">
      <div className="aspect-square bg-gray-100">
        {product.image_url && (
          <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
        )}
      </div>
      <div className="p-3">
        <h3 className="font-semibold">{product.name}</h3>
        {product.description && <p className="mt-1 line-clamp-2 text-sm text-gray-500">{product.description}</p>}
        {product.price != null && <p className="mt-2 font-bold">{product.price.toLocaleString()}원</p>}
      </div>
    </div>
  )
}
```

---

## 9. 실행 & 확인

```bash
npm run dev
```

브라우저에서 http://localhost:3000 접속. 흐름: 회원가입/로그인(`/login`) → 글쓰기 → 피드 → 글 클릭 → 상세+댓글 → 로그아웃. 상품은 Supabase Table Editor에서 직접 몇 개 넣고 `/products`에서 확인.

## 트러블슈팅
- 흰 화면/데이터 안 보임 → `.env.local` 키 확인 + 서버 재실행 / Supabase 테이블·RLS 정책 생성 여부 확인.
- `supabaseUrl is required` → `.env.local` 오타 또는 서버 재실행 안 함.
- 글은 보이는데 작성이 안 됨 → 로그인 여부, RLS insert 정책 확인.

## 남은 확장 아이디어 (원하면 요청)
좋아요 버튼 동작, 이미지 업로드(Supabase Storage), 프로필 페이지, 게시글에 상품 태그, profiles 자동 생성 트리거.
