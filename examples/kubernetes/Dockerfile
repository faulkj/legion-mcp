FROM node:24-alpine
ENV NODE_ENV=production
ENV HOST=0.0.0.0
RUN npm install -g legion-mcp
WORKDIR /app
# Legion resolves ./config first and uses it INSTEAD OF the bundled defaults
# (all-or-nothing, not a per-file merge). This folder ships a complete config,
# so it must include at least one model file or the server fails fast at startup.
COPY config/ /app/config/
USER node
EXPOSE 5000
CMD ["legion-mcp", "http"]
