FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
ENV PORT=7000
EXPOSE 7000
CMD ["node", "src/server.js"]
