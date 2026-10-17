FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js ./server.js
COPY lib ./lib
COPY public ./public
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server.js"]
