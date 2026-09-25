# skope container image (SPEC §5.5): ghcr.io/mattyv/skope, for machines that
# want a pinned runtime rather than the npm package or a standalone binary
# (for example musl systems such as Alpine, which the standalone Linux
# binaries don't support — see SPEC §5.5).

FROM node:20-slim AS build
WORKDIR /app
# npm ci runs the postinstall script, so it goes in first. It does nothing here: it only installs
# agent skills after a global npm install.
COPY package.json package-lock.json ./
COPY scripts/postinstall.mjs ./scripts/
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
COPY core ./core
COPY contracts ./contracts
COPY .dafny-version ./
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/postinstall.mjs ./scripts/
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY core/generated ./core/generated
COPY LICENSE-MIT LICENSE-APACHE ./

ENTRYPOINT ["node", "dist/cli.js"]
