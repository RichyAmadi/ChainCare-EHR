# Chaincode-as-a-Service image: built from pre-compiled TypeScript (dist) and installed packages
FROM node:18-slim
ARG CC_SERVER_PORT=9999
WORKDIR /usr/src/app
COPY package.json ./
COPY node_modules ./node_modules
COPY dist ./dist
COPY META-INF ./META-INF
ENV PORT=$CC_SERVER_PORT NODE_ENV=production
EXPOSE $CC_SERVER_PORT
USER node
CMD ["npm","run","start:server-nontls"]
