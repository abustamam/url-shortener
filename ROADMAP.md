# Roadmap

Concrete milestones for each phase of the [URL Shortener learning-in-public project](vision.md).

Each phase has one infrastructure concept. Each section tracks implementation tasks, deployment steps, and a clear definition of done.

**Implementation tasks** may be AI-scaffolded — read and understand the code before shipping it.
**Verification steps** must be hands-on: run them yourself, record the real output, and write about what you actually observed.

---

## Phase 1 — Baseline: Hono + Postgres + Swagger

**Status:** ✅ Complete

**Done when:** `POST /shorten` and `GET /:slug` are live behind Caddy on a Hetzner VPS, Swagger UI is accessible at `/docs`, and a latency baseline is recorded.

### Implementation Tasks

- [x] Install dependencies: `@hono/zod-openapi`, `@hono/swagger-ui`, `drizzle-orm`, `drizzle-kit`, `pg`, `nanoid`, `zod`
- [x] Define Drizzle schema: `urls` table (`id`, `slug`, `original_url`, `created_at`, `hit_count`)
- [x] Write and run initial migration
- [x] Implement `POST /shorten` — validate URL with Zod, generate slug with nanoid, insert into DB
- [x] Implement `GET /:slug` — look up slug, increment `hit_count`, return 301 redirect
- [x] Return 404 with JSON body for unknown slugs
- [x] Mount Swagger UI at `/docs` via `@hono/swagger-ui`
- [x] Add `drizzle.config.ts` and `db:generate` / `db:migrate` scripts to `package.json`
- [x] Add `docker-compose.yml` with Postgres, url-shortener, and Caddy services
- [x] Add `.env.example` with `POSTGRES_*`, `IMAGE_NAME`, `CONTAINER_NAME`, `PORT`

### Deployment Steps

- [ ] Provision Hetzner CX22 VPS (Ubuntu 24.04)
- [ ] Install Docker and Docker Compose: follow [Docker install docs](https://docs.docker.com/engine/install/ubuntu/)
- [ ] Clone repo
- [ ] Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD`, `IMAGE_NAME`, etc.
- [ ] Build and push the app image, or use a pre-built image from your registry
- [ ] Update `Caddyfile`: replace `your_domain_here` with your actual domain
- [ ] Run migrations (one-off before first start): `docker compose run --rm url-shortener bun run db:migrate`
- [ ] Start stack: `docker compose up -d` — this starts Caddy, the app, and Postgres together

### Verification

- [x] `curl -X POST https://yourdomain.com/shorten -d '{"url":"https://example.com"}' -H 'Content-Type: application/json'` returns `{ slug: "abc123" }`
- [x] `curl -I https://yourdomain.com/abc123` returns `HTTP/2 301`
- [x] `https://yourdomain.com/docs` loads Swagger UI
- [x] Record baseline latency with k6: `k6 run --env BASE_URL=https://yourdomain.com --env SLUG=abc123 scripts/load-test.js` — log the printed p50/p95/p99 summary as the Phase 1 baseline

---

## Phase 2 — Caching with Redis

**Status:** ⬜ Not Started

**Done when:** Redirect latency on warm paths is measurably lower than Phase 1 baseline, and cache-aside logic is confirmed working via Redis CLI.

### Implementation Tasks

- [ ] Add `ioredis` dependency
- [ ] Add `REDIS_URL` to `.env.example`
- [ ] Create `src/lib/redis.ts` — singleton Redis client
- [ ] Update `GET /:slug` handler:
  1. Check Redis for slug key
  2. On hit: redirect immediately (no DB query)
  3. On miss: query Postgres, populate Redis with TTL, redirect
- [ ] Choose and document TTL (e.g., 24h) — add to env config as `CACHE_TTL_SECONDS`
- [ ] Handle deletion: if a slug is ever deleted from DB, also `DEL` from Redis
- [ ] Add Redis service to `docker-compose.yml`

### Deployment Steps

- [ ] Redis is already defined in `docker-compose.yml` — no separate install needed
- [ ] Set `REDIS_URL=redis://redis:6379` in `.env` (service name `redis` from compose network)
- [ ] `docker compose up -d` — compose starts Redis alongside the app and Postgres

### Verification

- [ ] First request to a slug: `docker compose exec redis redis-cli GET <slug>` returns nil → then returns the URL
- [ ] Second request: Redis serves it (check via `docker compose exec redis redis-cli MONITOR` watching no Postgres query hit)
- [ ] Record post-cache latency with k6: `k6 run --env BASE_URL=https://yourdomain.com --env SLUG=abc123 scripts/load-test.js` — compare p50/p95/p99 against Phase 1 baseline
- [ ] Confirm TTL is set: `docker compose exec redis redis-cli TTL <slug>` returns a positive number

---

## Phase 3 — Rate Limiting

**Status:** ⬜ Not Started

**Done when:** `POST /shorten` returns `429 Too Many Requests` with a `Retry-After` header after exceeding the configured limit per IP.

### Implementation Tasks

- [ ] Add `src/middleware/rateLimit.ts` — sliding window algorithm using Redis `ZADD` / `ZREMRANGEBYSCORE` / `ZCARD`
- [ ] Algorithm: for each request, add timestamp to a sorted set keyed by IP; remove entries outside the window; count remaining
- [ ] Return 429 with `Retry-After` header when count exceeds limit
- [ ] Apply middleware only to `POST /shorten`
- [ ] Add env vars: `RATE_LIMIT_MAX` (e.g., 10), `RATE_LIMIT_WINDOW_MS` (e.g., 60000)
- [ ] Update `.env.example`

### Deployment Steps

- [ ] Deploy updated app (Redis already running from Phase 2)
- [ ] Set `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` in env

### Verification

- [ ] `for i in {1..15}; do curl -s -o /dev/null -w "%{http_code}\n" -X POST https://yourdomain.com/shorten -d '{"url":"https://example.com"}' -H 'Content-Type: application/json'; done`
  - First N requests: `201`
  - Remaining: `429`
- [ ] Check `Retry-After` header is present on 429 responses
- [ ] Wait for window to reset, confirm requests succeed again

---

## Phase 4 — Horizontal Scaling

**Status:** ⬜ Not Started

**Done when:** Two VPS nodes are both receiving traffic behind Caddy, no node-local state issues exist, and killing one node does not affect availability.

### Implementation Tasks

- [ ] Add `GET /health` endpoint returning `{ status: "ok" }` — used by Caddy for health checks
- [ ] Audit for any in-memory state (session maps, local caches, etc.) — there should be none; document the audit
- [ ] Confirm Redis and Postgres URLs are network-accessible (not `localhost`) from both nodes

### Deployment Steps

- [ ] Provision second Hetzner CX22 VPS
- [ ] Clone repo and copy `.env` on node 2 (no Postgres/Redis — those stay on node 1 or a dedicated host)
- [ ] `docker compose up -d` on node 2 (app-only; comment out or remove `db` and `redis` services in a node2 override)
- [ ] Update `Caddyfile` on the load balancer node and reload:
  ```
  yourdomain.com {
    reverse_proxy node1_ip:3000 node2_ip:3000 {
      health_uri /health
      health_interval 10s
    }
  }
  ```
  Then: `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`

### Verification

- [ ] Tail logs on both nodes simultaneously: `docker compose logs -f app` on each
- [ ] Send 20 requests and confirm both nodes each received some
- [ ] Chaos test: `docker compose stop app` on node 1
  - Confirm all requests now hit node 2
  - `docker compose start app` on node 1, confirm traffic resumes to both
- [ ] Compare latency to Phase 2 baseline with k6: `k6 run --env BASE_URL=https://yourdomain.com --env SLUG=abc123 scripts/load-test.js`

---

## Phase 5 — Observability: Metrics, Logs, and Traces

**Status:** ⬜ Not Started

**Done when:** A Grafana dashboard shows live redirect latency (p50/p95/p99), cache hit rate, request rate, and error rate — sourced from real production traffic.

### Implementation Tasks

- [ ] Add `prom-client` — expose `GET /metrics` endpoint with:
  - `http_request_duration_seconds` histogram (labeled by route, method, status)
  - `cache_hits_total` and `cache_misses_total` counters
  - `http_requests_total` counter
- [ ] Add `pino` for structured logging; replace `console.log` calls
- [ ] Add `pino-loki` transport to ship logs to Loki
- [ ] Add `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node`
- [ ] Configure OTel to export traces to Tempo (OTLP HTTP)
- [ ] Add `docker-compose.observability.yml` with:
  - Prometheus (scrapes `/metrics`)
  - Loki
  - Tempo
  - Grafana (with provisioned data sources for all three)
- [ ] Provision a Grafana dashboard JSON with panels:
  - Redirect latency histogram (p50/p95/p99)
  - Cache hit rate (hits / (hits + misses))
  - Request rate (req/s)
  - Error rate (5xx / total)
  - Top-10 slugs by hit count (from Postgres or a counter metric)

### Deployment Steps

- [ ] Deploy observability stack (docker-compose on a dedicated VPS or alongside app)
- [ ] Configure Prometheus `scrape_configs` to point at both app nodes
- [ ] Set OTel env vars on app nodes: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`
- [ ] Set Loki endpoint env var for `pino-loki`
- [ ] Import Grafana dashboard JSON via UI or provisioning directory
- [ ] Restart app nodes

### Verification

- [ ] `curl https://yourdomain.com/metrics` returns Prometheus text format with all expected metric names
- [ ] Send test traffic; Prometheus dashboard shows non-zero request rate
- [ ] Loki: query `{service="url-shortener"}` in Grafana — structured log entries appear
- [ ] Tempo: click a trace from a redirect request and see span waterfall (app → Redis → optionally Postgres)
- [ ] Cache hit rate metric is > 0% for warm slugs

---

## Phase 6 — Database Replication (Stretch)

**Status:** ⬜ Not Started

**Done when:** A Postgres read replica is serving redirect reads; primary failure is documented with observed behavior.

### Implementation Tasks

- [ ] Add `REPLICA_DATABASE_URL` to `.env.example`
- [ ] Create `src/lib/db.ts` with two Drizzle client instances: `dbWrite` (primary) and `dbRead` (replica)
- [ ] Update `GET /:slug` DB fallback to use `dbRead`
- [ ] All writes (`POST /shorten`, hit count increment) use `dbWrite`
- [ ] Add a `db:replica:status` script that runs `SELECT * FROM pg_stat_replication` on primary

### Deployment Steps

- [ ] Provision third Hetzner VPS for the replica
- [ ] On primary Postgres, edit `postgresql.conf`:
  ```
  wal_level = replica
  max_wal_senders = 3
  ```
- [ ] Add replication user and `pg_hba.conf` entry for replica IP
- [ ] On replica VPS: `pg_basebackup -h primary_ip -U replicator -D /var/lib/postgresql/data -P -Xs -R`
- [ ] Start Postgres on replica; confirm `pg_stat_replication` shows 1 active replica
- [ ] Set `REPLICA_DATABASE_URL` on app nodes, deploy updated app

### Verification

- [ ] Write a slug via `POST /shorten`, confirm it appears when queried via replica directly: `psql $REPLICA_DATABASE_URL -c "SELECT * FROM urls ORDER BY created_at DESC LIMIT 1"`
- [ ] Check replication lag: `SELECT now() - pg_last_xact_replay_timestamp() AS replication_lag;` on replica
- [ ] Chaos: `systemctl stop postgresql` on primary
  - Observe redirect behavior (reads from replica still work, new shortens fail)
  - Document the exact error and recovery steps

---

## Phase Summary

| Phase | Concept | Status |
|-------|---------|--------|
| 1 | Baseline: Hono + Postgres + Swagger | ✅ Complete |
| 2 | Caching with Redis | ⬜ Not Started |
| 3 | Rate Limiting | ⬜ Not Started |
| 4 | Horizontal Scaling | ⬜ Not Started |
| 5 | Observability (LGTM stack) | ⬜ Not Started |
| 6 | Database Replication (Stretch) | ⬜ Not Started |
