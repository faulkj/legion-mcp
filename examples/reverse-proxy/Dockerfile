FROM node:24-alpine
ENV NODE_ENV=production
ENV HOST=0.0.0.0
RUN npm install -g legion-mcp
WORKDIR /app
# Legion overlays ./config on top of the bundled defaults, per file. This folder
# needs only the files it customizes, but must include at least one model file —
# the bundle ships no real models, so the server fails fast at startup without one.
COPY config/ /app/config/
USER node
EXPOSE 5000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:5000/health || exit 1
CMD ["legion-mcp", "http"]
