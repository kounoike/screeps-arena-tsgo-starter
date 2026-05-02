#!/usr/bin/env bash
set -euo pipefail

# Install deps with pnpm (suppress corepack prompt if needed)
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install

# Install Biome globally
pnpm biome install -g

# Initialize lefthook git hooks
pnpm lefthook install

# Ensure bashrc exists
BASHRC="$HOME/.bashrc"
if [ ! -f "$BASHRC" ]; then
  touch "$BASHRC"
fi

# Enable starship prompt for bash if starship is present
if command -v starship >/dev/null 2>&1; then
  if ! grep -qs "starship init bash" "$BASHRC"; then
    echo 'eval "$(starship init bash)"' >> "$BASHRC"
  fi
fi
