FROM node:24-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV ZIG_VERSION=0.12.0
ENV ZLS_VERSION=0.12.0

RUN apt-get update \
  && apt-get -y install --no-install-recommends \
  ca-certificates curl git locales vim-nox sudo wget xz-utils \
  && apt-get auto-remove -y \
  && apt-get clean -y

RUN sed -i 's/^# *ja_JP.UTF-8 UTF-8/ja_JP.UTF-8 UTF-8/' /etc/locale.gen \
  && locale-gen \
  && update-locale LANG=ja_JP.UTF-8

# # enable pnpm via Corepack (non-interactive, ephemeral env)
# # Ensure pnpm is available at image build time to avoid runtime prompts.
# ARG PNPM_VERSION=10.30.3
# RUN COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1 corepack enable \
#   && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1 corepack prepare pnpm@${PNPM_VERSION} --activate \
#   || true
# Also install pnpm globally via npm as a deterministic, non-interactive fallback
# RUN npm install -g pnpm@${PNPM_VERSION} --no-audit --no-fund

# # Zig and ZLS
# RUN wget "https://ziglang.org/download/${ZIG_VERSION}/zig-linux-x86_64-${ZIG_VERSION}.tar.xz" \
#   && tar -xf "zig-linux-x86_64-${ZIG_VERSION}.tar.xz" -C /usr/local \
#   && mv "/usr/local/zig-linux-x86_64-${ZIG_VERSION}" /usr/local/zig-linux \
#   && rm "zig-linux-x86_64-${ZIG_VERSION}.tar.xz"

# RUN wget "https://github.com/zigtools/zls/releases/download/${ZLS_VERSION}/zls-x86_64-linux.tar.xz" \
#   && tar -xf "zls-x86_64-linux.tar.xz" -C /usr/local/bin \
#   && rm "zls-x86_64-linux.tar.xz" \
#   && chmod +x /usr/local/bin/zls

# ENV PATH="/usr/local/zig-linux:${PATH}"

# Use non-root user provided by image
USER node

ENV TZ=Asia/Tokyo
ENV LANG=ja_JP.UTF-8
ENV LC_ALL=ja_JP.UTF-8
