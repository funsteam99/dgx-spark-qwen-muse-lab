FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
ENV PORT=8005
EXPOSE 8005
CMD ["node", "server.mjs"]
