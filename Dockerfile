FROM node:24.21.0-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node src ./src

USER node
EXPOSE 3000

# Прямий запуск Node.js дозволяє отримувати сигнали зупинки від Docker.
CMD ["node", "src/server.js"]
