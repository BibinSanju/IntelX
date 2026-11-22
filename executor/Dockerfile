FROM node:20-bookworm-slim

# Install Python, C, C++, and Java JDK
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    gcc \
    g++ \
    default-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
RUN mkdir -p /app/temp && chmod 711 /app/temp

# The server needs root only to drop each submission to its own throwaway UID (setpriv).
ENV NODE_ENV=production \
    SANDBOX_ISOLATION=uid

# Render expects web services to bind to a port
EXPOSE 8080
CMD ["node", "server.js"]
