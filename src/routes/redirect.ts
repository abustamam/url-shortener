import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { urls } from '../db/schema'
import { getCached, setCached } from '../lib/redis'

const SlugParamSchema = z.object({
  slug: z.string().openapi({ example: 'abc12345' }),
})

const ErrorSchema = z.object({
  error: z.string(),
})

const redirectRoute = createRoute({
  method: 'get',
  path: '/{slug}',
  request: {
    params: SlugParamSchema,
  },
  responses: {
    301: {
      description: 'Redirect to the original URL',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Slug not found',
    },
  },
})

export const redirectRouter = new OpenAPIHono()

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
