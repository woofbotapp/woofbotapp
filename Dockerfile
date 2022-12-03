FROM node:16.15.0-bullseye-slim as dependencies_builder

WORKDIR /app
# For node-gyp
RUN apt-get update && apt-get install -y make gcc g++ python3 libzmq3-dev
# Copy build files
COPY package.json tsconfig.base.json yarn.lock ./
# Copy package.json & tsconfig.json of each workspace
ARG PACKAGE="common"
COPY "packages/${PACKAGE}/*.json" "./packages/${PACKAGE}/"
ARG PACKAGE="client"
COPY "packages/${PACKAGE}/*.json" "./packages/${PACKAGE}/"
ARG PACKAGE="server"
COPY "packages/${PACKAGE}/*.json" "./packages/${PACKAGE}/"
RUN yarn install --production --frozen-lockfile --network-timeout 600000
# Make sure that the directories exist so future COPY won't fail
RUN mkdir -p ./node_modules ./packages/common/node_modules ./packages/client/node_modules ./packages/server/node_modules ./logs

FROM dependencies_builder as builder

WORKDIR /app
# Also install dev-dependencies
RUN yarn install --frozen-lockfile --network-timeout 600000
# Copy code files
COPY . .
RUN echo "Make sure no garbage files were copied:" && find . -type f ! -path "./node_modules/*" ! -path "./packages/common/node_modules/*" ! -path "./packages/client/node_modules/*" ! -path "./packages/server/node_modules/*"
# Build all workspaces
RUN yarn common build
RUN yarn client build
RUN yarn server build
# No need for dependencies anymore
RUN rm -rf ./node_modules ./packages/common/node_modules ./packages/client/node_modules ./packages/server/node_modules

FROM node:16.15.0-bullseye-slim

WORKDIR /app
RUN chown -R node:node .
COPY --from=builder --chown=node:node /app ./
COPY --from=dependencies_builder --chown=node:node /app/node_modules ./node_modules
ARG PACKAGE="common"
COPY --from=dependencies_builder --chown=node:node "/app/packages/${PACKAGE}/node_modules" "./packages/${PACKAGE}/node_modules"
ARG PACKAGE="client"
COPY --from=dependencies_builder --chown=node:node "/app/packages/${PACKAGE}/node_modules" "./packages/${PACKAGE}/node_modules"
ARG PACKAGE="server"
COPY --from=dependencies_builder --chown=node:node "/app/packages/${PACKAGE}/node_modules" "./packages/${PACKAGE}/node_modules"
USER node
# Start server
CMD ["yarn", "server", "start"]
