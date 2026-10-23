# The API. Build from the repository root:
#   docker build -f deploy/api.Dockerfile -t workhub-api .
# On start it applies any new migrations, then serves on $PORT (default 4000).

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @workhub/shared && npm run build --workspace @workhub/api

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Only what the API needs at run time.
RUN npm ci --omit=dev --workspace @workhub/shared --workspace @workhub/api && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
COPY apps/api/scripts apps/api/scripts
USER node
EXPOSE 4000
CMD ["sh", "-c", "node apps/api/scripts/migrate.mjs && exec node apps/api/dist/main.js"]
