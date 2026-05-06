import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import { nanoid } from 'nanoid'
import { db } from '../db'
import { urls } from '../db/schema'
import { rateLimit } from '../middleware/rateLimit'

const ShortenBodySchema = z.object({
  url: z.string().url().openapi({ example: 'https://example.com' }),
})

const ShortenResponseSchema = z.object({
  slug: z.string().openapi({ example: 'abc12345' }),
})

const ErrorSchema = z.object({
  error: z.string(),
})

const shortenRoute = createRoute({
  method: 'post',
  path: '/shorten',
  request: {
    body: {
      content: { 'application/json': { schema: ShortenBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: ShortenResponseSchema } },
      description: 'URL shortened successfully',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid URL',
    },
    429: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Too Many Requests',
    },
  },
})

export const shortenRouter = new OpenAPIHono()

shortenRouter.use(rateLimit)

shortenRouter.openapi(shortenRoute, async (c) => {
  const { url } = c.req.valid('json')
  const slug = nanoid(8)

  await db.insert(urls).values({ slug, originalUrl: url })

  return c.json({ slug }, 201)
})
