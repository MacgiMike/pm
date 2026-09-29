FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json .npmrc ./
COPY package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
RUN mkdir -p /data/uploads /backups && chown -R node:node /data/uploads
USER node
EXPOSE 47814
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
