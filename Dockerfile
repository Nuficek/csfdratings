FROM node:20-slim
WORKDIR /app
# slim images ship no fonts; install one so SVG text (digits + "ČSFD") renders
RUN apt-get update && apt-get install -y --no-install-recommends \
      fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 7000
CMD ["node", "server.js"]
