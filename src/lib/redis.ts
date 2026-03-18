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
