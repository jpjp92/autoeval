FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
ARG BACKEND_API_URL=http://server:8000
ARG NEXT_PUBLIC_UPLOAD_BASE_URL=""
ENV BACKEND_API_URL=$BACKEND_API_URL
ENV NEXT_PUBLIC_UPLOAD_BASE_URL=$NEXT_PUBLIC_UPLOAD_BASE_URL
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
