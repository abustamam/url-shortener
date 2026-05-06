import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { Redis } from 'ioredis'

const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379')

redis.on('error', (err) => {
  console.error({ msg: 'Redis connection error (rate limiter)', err })
})

const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 10)
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000)

export const rateLimit = createMiddleware(async (c, next) => {
  // Caddy forwards the original client IP via X-Forwarded-For
  const forwarded = c.req.header('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() ?? 'unknown'
  const key = `rate_limit:${ip}:post_shorten`
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS

  try {
    const pipeline = redis.pipeline()

    // 1. Add current request timestamp
    pipeline.zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`)

    // 2. Remove entries outside the sliding window
    pipeline.zremrangebyscore(key, 0, windowStart)

    // 3. Count remaining entries in the window
    pipeline.zcard(key)

    // 4. Get the oldest remaining entry to compute Retry-After
    pipeline.zrange(key, 0, 0, 'WITHSCORES')

    // 5. Set expiry on the key so Redis cleans it up eventually
    pipeline.expire(key, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000))

    const results = await pipeline.exec()
    if (!results) {
      // Redis pipeline failed silently — fail open
      console.error({ msg: 'Rate limit pipeline returned no results', ip })
      return next()
    }

    // results is an array of [error, result] tuples
    const countResult = results[2] // zcard
    if (!countResult || countResult[0]) {
      console.error({ msg: 'Rate limit zcard failed', err: countResult?.[0], ip })
      return next()
    }

    const count = countResult[1] as number

    if (count > RATE_LIMIT_MAX) {
      // Compute Retry-After from the oldest entry in the window
      const oldestResult = results[3] // zrange withscores
      let retryAfter = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)

      if (oldestResult && !oldestResult[0]) {
        const oldestEntry = oldestResult[1] as string[]
        if (oldestEntry.length >= 2) {
          const oldestTimestamp = Number(oldestEntry[1])
          retryAfter = Math.max(
            1,
            Math.ceil((oldestTimestamp + RATE_LIMIT_WINDOW_MS - now) / 1000)
          )
        }
      }

      throw new HTTPException(429, {
        message: 'Too Many Requests',
        res: new Response(
          JSON.stringify({ error: 'Too Many Requests' }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(retryAfter),
            },
          }
        ),
      })
    }

    return next()
  } catch (err) {
    // If it's already an HTTPException (our 429), rethrow it
    if (err instanceof HTTPException) {
      throw err
    }

    // Otherwise, Redis is likely down — fail open so the app stays usable
    console.error({ msg: 'Rate limiter error, failing open', err, ip })
    return next()
  }
})
