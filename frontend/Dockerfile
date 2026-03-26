FROM node:20.19.5-alpine3.22 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL
ARG VITE_API_PREFIX
ARG VITE_FRONTEND_PROXY_SECRET
ARG VITE_REQUIRE_HANDSHAKE

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_API_PREFIX=${VITE_API_PREFIX}
ENV VITE_FRONTEND_PROXY_SECRET=${VITE_FRONTEND_PROXY_SECRET}
ENV VITE_REQUIRE_HANDSHAKE=${VITE_REQUIRE_HANDSHAKE}

RUN npm run build

FROM nginx:1.27-alpine

WORKDIR /usr/share/nginx/html

COPY --from=build /app/dist .
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
