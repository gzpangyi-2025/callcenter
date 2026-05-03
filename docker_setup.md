# Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start:prod"]

--- slide ---

# docker-compose.yml
services:
  backend:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - ./oss:/app/oss
      - ./uploads:/app/uploads
    restart: always
