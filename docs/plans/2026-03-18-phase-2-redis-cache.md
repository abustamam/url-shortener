# Phase 2: Redis Cache Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Redis cache-aside to `GET /:slug` so warm-path redirects skip Postgres entirely.

**Architecture:** Check Redis for `slug:<slug>` on every redirect; hit → redirect immediately; miss → query Postgres, populate cache with TTL, redirect. Hit-count increment fires-and-forgets on both paths. Redis failure is fail-open (falls through to Postgres).

**Tech Stack:** ioredis 5.x, existing Hono + Drizzle + Postgres stack, Docker Compose for local Redis.

---

### Task 1: Create branch and install ioredis

**Files:**
- Modify: `package.json` (via bun add)

**Step 1: Create the phase branch**

```bash
git checkout -b phase/2-redis-cache
```

Expected: `Switched to a new branch 'phase/2-redis-cache'`

**Step 2: Install ioredis**

```bash
bun add ioredis
```

Expected: `package.json` updated with `"ioredis": "^5.x.x"` in dependencies.

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add ioredis dependency"
```

---

### Task 2: Update environment config

**Files:**
- Modify: `.env.example`

**Step 1: Add Redis vars to `.env.example`**

Add these two lines to `.env.example` after the existing Postgres block:

```
# Redis (url-shortener service)
REDIS_URL=redis://redis:6379
CACHE_TTL_SECONDS=86400
```

**Step 2: Verify diff looks right**

```bash
git diff .env.example
```

**Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: add REDIS_URL and CACHE_TTL_SECONDS to .env.example"
```

---

### Task 3: Create Redis client module

**Files:**
- Create: `src/lib/redis.ts`

**Step 1: Create `src/lib/redis.ts`**

```typescript
import { Redis } from 'ioredis'

const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379')

redis.on('error', (err) => {
  console.error({ msg: 'Redis connection error', err })
})

const SLUG_KEY = (slug: string) => `slug:${slug}`

export const getCached = (slug: string) => redis.get(SLUG_KEY(slug))
export const setCached = (slug: string, url: string, ttl: number) =>
  redis.set(SLUG_KEY(slug), url, 'EX', ttl)
export const delCached = (slug: string) => redis.del(SLUG_KEY(slug))
```

**Step 2: Verify TypeScript compiles**

```bash
bun run --hot src/index.ts &
sleep 2
kill %1
```

Expected: No TypeScript errors printed.

**Step 3: Commit**

```bash
git add src/lib/redis.ts
git commit -m "feat: add Redis client singleton with slug cache helpers"
```

---

### Task 4: Update redirect handler with cache-aside logic

**Files:**
- Modify: `src/routes/redirect.ts`

**Step 1: Replace the handler body in `src/routes/redirect.ts`**

Add the import at the top:
```typescript
import { getCached, setCached } from '../lib/redis'
```

Replace the `redirectRouter.openapi(redirectRoute, async (c) => { ... })` block with:

```typescript
redirectRouter.openapi(redirectRoute, async (c) => {
  const { slug } = c.req.valid('param')
  const ttl = Number(process.env.CACHE_TTL_SECONDS ?? 86400)

  // Check cache first — fail-open: if Redis is unavailable, fall through to Postgres
  let cached: string | null = null
  try {
    cached = await getCached(slug)
  } catch {
    // Redis unavailable — proceed with Postgres fallback
  }

  if (cached) {
    // Fire-and-forget hit count increment (same as cold path — doesn't block redirect)
    db.update(urls)
      .set({ hitCount: sql`${urls.hitCount} + 1` })
      .where(eq(urls.slug, slug))
      .execute()
      .catch(() => {})

    return c.redirect(cached, 301)
  }

  // Cache miss — query Postgres
  const result = await db
    .select()
    .from(urls)
    .where(eq(urls.slug, slug))
    .limit(1)

  if (result.length === 0) {
    return c.json({ error: 'Slug not found' }, 404)
  }

  const { originalUrl } = result[0]

  // Populate cache — fire-and-forget so a Redis write failure doesn't block the redirect
  setCached(slug, originalUrl, ttl).catch(() => {})

  // Fire-and-forget hit count
  db.update(urls)
    .set({ hitCount: sql`${urls.hitCount} + 1` })
    .where(eq(urls.slug, slug))
    .execute()
    .catch(() => {})

  return c.redirect(originalUrl, 301)
})
```

**Step 2: Verify TypeScript compiles**

```bash
bun run --hot src/index.ts &
sleep 2
kill %1
```

Expected: No TypeScript errors.

**Step 3: Commit**

```bash
git add src/routes/redirect.ts
git commit -m "feat: add Redis cache-aside to GET /:slug"
```

---

### Task 5: Add Redis to docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add the `redis` service**

In `docker-compose.yml`, add a `redis` service before the app service:

```yaml
  redis:
    image: redis:7-alpine
    container_name: redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
```

**Step 2: Add `REDIS_URL` env var and `redis` dependency to the app service**

In the `${CONTAINER_NAME:-url-shortener}` service block, add:
- Under `environment:`: `REDIS_URL: redis://redis:6379`
- Under `depends_on:`: add `- redis`

**Step 3: Verify the compose file parses correctly**

```bash
docker compose config --quiet
```

Expected: No errors.

**Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add Redis service to docker-compose"
```

---

### Task 6: Local verification

**Step 1: Start the stack**

```bash
docker compose up -d
```

If you don't have a built image, run the app locally against a local Redis instead:

```bash
# Terminal 1: start Redis only
docker compose up redis -d

# Terminal 2: run app locally
REDIS_URL=redis://127.0.0.1:6379 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/urlshortener bun run dev
```

**Step 2: Create a test slug**

```bash
curl -s -X POST http://localhost:3000/shorten \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}' | jq .
```

Note the returned `slug` value — use it in subsequent steps.

**Step 3: Verify cold miss populates cache**

```bash
# First request (cache miss)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/<slug>

# Check Redis — should now have the key
docker compose exec redis redis-cli GET slug:<slug>
```

Expected: `"https://example.com"`

**Step 4: Verify TTL is set**

```bash
docker compose exec redis redis-cli TTL slug:<slug>
```

Expected: A positive number close to 86400 (not -1 or -2).

**Step 5: Verify warm hit skips Postgres**

```bash
# Watch Redis commands in real-time in one terminal
docker compose exec redis redis-cli MONITOR

# In another terminal, make a second request
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/<slug>
```

Expected in MONITOR output: `GET slug:<slug>` returning the URL — no Postgres query logged.

**Step 6: Verify unknown slug still returns 404**

```bash
curl -s http://localhost:3000/doesnotexist
```

Expected: `{"error":"Slug not found"}`

---

### Task 7: Open PR

**Step 1: Push branch**

```bash
git push -u origin phase/2-redis-cache
```

**Step 2: Open PR**

```bash
gh pr create \
  --title "feat: Phase 2 — Redis cache-aside for redirect" \
  --body "Adds Redis cache-aside to \`GET /:slug\`. Warm-path redirects skip Postgres. Hit-count increment fires-and-forgets on both cache hit and miss paths. Redis failure is fail-open.

## What changed
- \`src/lib/redis.ts\` — singleton ioredis client with \`getCached\`/\`setCached\`/\`delCached\` helpers
- \`src/routes/redirect.ts\` — cache-aside logic with fail-open fallback
- \`docker-compose.yml\` — Redis service added
- \`.env.example\` — \`REDIS_URL\` and \`CACHE_TTL_SECONDS\`

## Verification
Run k6 against a warm slug and compare p50/p95/p99 to v1-baseline tag."
```

**Step 3: After merge, tag on main**

```bash
git checkout main && git pull
git tag v2-redis-cache
git push origin v2-redis-cache
```
