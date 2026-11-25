FROM node:26.13.1-bookworm-slim AS backend-build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/nest-cli.json backend/tsconfig*.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:26.13.1-bookworm-slim AS backend
WORKDIR /app
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
USER node
CMD ["node", "dist/main"]

FROM node:26.13.1-bookworm-slim AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig*.json ./
COPY frontend/src ./src
RUN chown -R node:node /app/node_modules
USER node
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
