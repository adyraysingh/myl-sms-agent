FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy source code
COPY src/ ./src/

# Create logs directory
RUN mkdir -p logs

# Set environment
ENV NODE_ENV=production

# Railway injects PORT - expose it
EXPOSE 8080

# Start server
CMD ["node", "src/server.js"]
