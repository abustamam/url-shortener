import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { shortenRouter } from './routes/shorten'
import { redirectRouter } from './routes/redirect'
import { healthRouter } from './routes/health'

const app = new OpenAPIHono()

app.route('/', healthRouter)

app.route('/', shortenRouter)

app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: { title: 'URL Shortener', version: '1.0.0' },
})

app.get('/docs', swaggerUI({ url: '/openapi.json' }))

// Must be last — /:slug matches any single-segment path
app.route('/', redirectRouter)

export default {
  port: process.env.PORT ?? 3000,
  fetch: app.fetch,
}
