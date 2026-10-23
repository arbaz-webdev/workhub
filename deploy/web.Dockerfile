# The web app. Build from the repository root:
#   docker build -f deploy/web.Dockerfile --build-arg API_URL=http://api:4000 -t workhub-web .
# API_URL is where /api/* is proxied to (the API's private address). It's needed at
# build time (Next.js fixes rewrites when it builds) and is kept for run time too.

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
COPY apps/web apps/web
ARG API_URL
ENV API_URL=${API_URL}
RUN test -n "$API_URL" || (echo "Set the API_URL build argument" && exit 1)
RUN npm run build --workspace @workhub/shared && npm run build --workspace @workhub/web
ENV NODE_ENV=production
USER node
EXPOSE 3000
# "::" listens on IPv6 and IPv4.
CMD ["sh", "-c", "exec node_modules/.bin/next start apps/web -H :: -p ${PORT:-3000}"]
