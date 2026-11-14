# The production image: `nest build` output on the prod dependencies only.
# Built by cchess-infra (see its README); the same image also runs the
# migrations, since the typeorm CLI ships with typeorm itself.

# Node pinned to .nvmrc's version.
FROM node:24.15.0-bookworm-slim AS deps
WORKDIR /app
# bcrypt and better-sqlite3 are native: their prebuilt binaries normally
# install, and these build them from source when none fits.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM deps AS prod-deps
RUN npm ci --omit=dev

FROM node:24.15.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
# Exec form, so SIGTERM reaches Node and the shutdown hooks drain the games
# under way before the database closes.
CMD ["node", "dist/main.js"]
