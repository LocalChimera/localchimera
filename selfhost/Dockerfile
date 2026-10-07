FROM node:22-alpine
WORKDIR /app
COPY node.mjs .
ENV CHIMERA_STATE=/data
VOLUME /data
USER node
CMD ["node", "node.mjs"]
