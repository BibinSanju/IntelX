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
RUN npm install
COPY . .

# Render expects web services to bind to a port
EXPOSE 8080
CMD ["node", "server.js"]
