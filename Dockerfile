
FROM node:24.21.0-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev && npm cache clean --force

# Код сервера
COPY --chown=node:node src ./src

# SQL-міграції
COPY --chown=node:node database/migrations ./database/migrations

# Скрипти перевірки
COPY --chown=node:node scripts ./scripts

# Тести
COPY --chown=node:node tests ./tests

USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
