FROM node:22-alpine
RUN apk add --no-cache python3 rust cargo musl-dev
WORKDIR /build
RUN printf '[package]\nname="runner-deps"\nversion="0.1.0"\nedition="2021"\n[dependencies]\nserde_json="=1.0.145"\n' > Cargo.toml \
    && mkdir src && printf 'fn main() {}\n' > src/main.rs \
    && cargo build --release \
    && mkdir -p /runner/deps && cp target/release/deps/*.rlib /runner/deps/ \
    && rm -rf /build /root/.cargo
COPY runner.py javascript.cjs python.py /runner/
WORKDIR /tmp
USER 65534:65534
