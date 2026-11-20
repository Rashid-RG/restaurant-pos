FROM node:24-alpine
WORKDIR /app
COPY gateway.mjs ./
USER node
EXPOSE 8080
CMD ["node","gateway.mjs"]
