# syntax=docker/dockerfile:1.4

ARG NODE_VERSION=22

####################################################################################################
## Build Packages

FROM node:${NODE_VERSION}-alpine AS builder

# Remove again once corepack >= 0.31 made it into base image
# (see https://github.com/directus/directus/issues/24514)
RUN npm install --global corepack@latest

RUN apk --no-cache add python3 py3-setuptools build-base

WORKDIR /directus

# Copy workspace manifests first so dependency installation stays cacheable.
# Keep this list in sync with pnpm-workspace.yaml when packages are added.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=node:node patches/ ./patches/
COPY --chown=node:node api/package.json ./api/package.json
COPY --chown=node:node app/package.json ./app/package.json
COPY --chown=node:node directus/package.json ./directus/package.json
COPY --chown=node:node packages/ai/package.json ./packages/ai/package.json
COPY --chown=node:node packages/composables/package.json ./packages/composables/package.json
COPY --chown=node:node packages/constants/package.json ./packages/constants/package.json
COPY --chown=node:node packages/create-directus-extension/package.json ./packages/create-directus-extension/package.json
COPY --chown=node:node packages/create-directus-project/package.json ./packages/create-directus-project/package.json
COPY --chown=node:node packages/env/package.json ./packages/env/package.json
COPY --chown=node:node packages/errors/package.json ./packages/errors/package.json
COPY --chown=node:node packages/extensions/package.json ./packages/extensions/package.json
COPY --chown=node:node packages/extensions-registry/package.json ./packages/extensions-registry/package.json
COPY --chown=node:node packages/extensions-sdk/package.json ./packages/extensions-sdk/package.json
COPY --chown=node:node packages/format-title/package.json ./packages/format-title/package.json
COPY --chown=node:node packages/memory/package.json ./packages/memory/package.json
COPY --chown=node:node packages/pressure/package.json ./packages/pressure/package.json
COPY --chown=node:node packages/release-notes-generator/package.json ./packages/release-notes-generator/package.json
COPY --chown=node:node packages/schema/package.json ./packages/schema/package.json
COPY --chown=node:node packages/schema-builder/package.json ./packages/schema-builder/package.json
COPY --chown=node:node packages/specs/package.json ./packages/specs/package.json
COPY --chown=node:node packages/storage/package.json ./packages/storage/package.json
COPY --chown=node:node packages/storage-driver-azure/package.json ./packages/storage-driver-azure/package.json
COPY --chown=node:node packages/storage-driver-cloudinary/package.json ./packages/storage-driver-cloudinary/package.json
COPY --chown=node:node packages/storage-driver-gcs/package.json ./packages/storage-driver-gcs/package.json
COPY --chown=node:node packages/storage-driver-local/package.json ./packages/storage-driver-local/package.json
COPY --chown=node:node packages/storage-driver-s3/package.json ./packages/storage-driver-s3/package.json
COPY --chown=node:node packages/storage-driver-supabase/package.json ./packages/storage-driver-supabase/package.json
COPY --chown=node:node packages/stores/package.json ./packages/stores/package.json
COPY --chown=node:node packages/system-data/package.json ./packages/system-data/package.json
COPY --chown=node:node packages/themes/package.json ./packages/themes/package.json
COPY --chown=node:node packages/types/package.json ./packages/types/package.json
COPY --chown=node:node packages/update-check/package.json ./packages/update-check/package.json
COPY --chown=node:node packages/utils/package.json ./packages/utils/package.json
COPY --chown=node:node packages/validation/package.json ./packages/validation/package.json
COPY --chown=node:node sdk/package.json ./sdk/package.json
COPY --chown=node:node tests/blackbox/package.json ./tests/blackbox/package.json
COPY --chown=node:node tests/blackbox/extensions/action-verify-create/package.json ./tests/blackbox/extensions/action-verify-create/package.json
COPY --chown=node:node tests/blackbox/extensions/action-verify-schema/package.json ./tests/blackbox/extensions/action-verify-schema/package.json
RUN corepack enable && corepack prepare

# Deploy as 'node' user to match pnpm setups in production image
# (see https://github.com/directus/directus/issues/23822)
RUN chown node:node .
USER node

ENV NODE_OPTIONS=--max-old-space-size=8192

RUN --mount=type=cache,id=pnpm-store,target=/home/node/.local/share/pnpm/store,uid=1000,gid=1000 \
    pnpm fetch

# Keep dependency installation isolated from source changes so BuildKit can
# reuse this layer when only workspace code changes.
RUN --mount=type=cache,id=pnpm-store,target=/home/node/.local/share/pnpm/store,uid=1000,gid=1000 \
    pnpm install --recursive --offline --frozen-lockfile

COPY --chown=node:node . .

# Build all packages (concurrency=4 requires 8-vCPU CI runners)
RUN npm_config_workspace_concurrency=4 pnpm run build

# Deploy production bundle — use the same pnpm store cache mount so reads
# go through native fs instead of slow overlayfs layer operations.
RUN --mount=type=cache,id=pnpm-store,target=/home/node/.local/share/pnpm/store,uid=1000,gid=1000 <<EOF
	set -ex
	pnpm --filter directus deploy --legacy --prod --store-dir /home/node/.local/share/pnpm/store dist
	cd dist
	# Regenerate package.json file with essential fields only
	# (see https://github.com/directus/directus/issues/20338)
	node -e '
		const f = "package.json", {name, version, type, exports, bin} = require(`./${f}`), {packageManager} = require(`../${f}`);
		fs.writeFileSync(f, JSON.stringify({name, version, type, exports, bin, packageManager}, null, 2));
	'
	mkdir -p database extensions uploads
	# Strip source maps — they are uploaded to Sentry during CI,
	# but must not be served to browsers or shipped in the image.
	find . -name '*.map' -delete
EOF

####################################################################################################
## Create Production Image

FROM node:${NODE_VERSION}-alpine AS runtime

RUN npm install --global \
	pm2@5 \
	corepack@latest # Remove again once corepack >= 0.31 made it into base image

USER node

WORKDIR /directus

ENV \
	DB_CLIENT="sqlite3" \
	DB_FILENAME="/directus/database/database.sqlite" \
	NODE_ENV="production" \
	NPM_CONFIG_UPDATE_NOTIFIER="false"

COPY --from=builder --chown=node:node /directus/ecosystem.config.cjs .
COPY --from=builder --chown=node:node /directus/dist .

EXPOSE 8055

CMD : \
	&& node cli.js bootstrap \
	&& pm2-runtime start ecosystem.config.cjs \
	;
