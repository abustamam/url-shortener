import { OpenAPIHono } from '@hono/zod-openapi'

export const healthRouter = new OpenAPIHono()

healthRouter.get('/health', (c) => c.json({ status: 'ok' }))
