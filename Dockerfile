FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .
# 前端 + 後端同時預編譯（PERF-02：避免生產環境 tsx 即時編譯開銷）
RUN npm run build
RUN npx tsc -p tsconfig.server.json

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=true
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
EXPOSE 3000
CMD ["node", "dist-server/api.js"]
