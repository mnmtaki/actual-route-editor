FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_ARA_API_URL=/
ENV VITE_ARA_API_URL=${VITE_ARA_API_URL}
RUN npm run build:vite

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist-vite /usr/share/nginx/html
EXPOSE 80
