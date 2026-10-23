# Website and API in one image, for a single free staging service (see render.yaml).
# Build from the repository root:
#   docker build -f deploy/staging.Dockerfile -t workhub-staging .
# For separate, always-on services use deploy/api.Dockerfile and deploy/web.Dockerfile.

FROM node:24-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
# The API is on the same machine, so the website's /api proxy points at loopback.
ENV API_URL=http://127.0.0.1:4000
RUN npm run build --workspace @workhub/shared \
 && npm run build --workspace @workhub/api \
 && npm run build --workspace @workhub/web
COPY deploy/staging-start.sh deploy/staging-start.sh
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["bash", "deploy/staging-start.sh"]
