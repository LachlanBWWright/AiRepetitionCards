FROM node:22.22.1-bookworm-slim
WORKDIR /runner
RUN npm install --ignore-scripts --omit=dev --save-exact wasmoon@1.16.0
COPY runtime ./runtime
USER node
ENTRYPOINT ["node", "runtime/cli.mjs"]
