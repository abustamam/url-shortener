FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src ./src
COPY drizzle ./drizzle
COPY drizzle.config.ts ./

ENV NODE_ENV=production
ENV SERVER_ID=url-shortener
EXPOSE 3000

# Run migrations then start the server
CMD ["sh", "-c", "bun run db:migrate && bun run src/index.ts"]
