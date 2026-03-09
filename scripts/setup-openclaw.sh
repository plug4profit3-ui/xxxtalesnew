#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/openclaw/openclaw.git"
TARGET_DIR="${1:-openclaw}"
BUILD_TYPE="${BUILD_TYPE:-Release}"

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git is not installed." >&2
  exit 1
fi

if ! command -v cmake >/dev/null 2>&1; then
  echo "Error: cmake is not installed." >&2
  exit 1
fi

if [ -d "$TARGET_DIR/.git" ]; then
  echo "Repository already exists at '$TARGET_DIR'. Pulling latest changes..."
  git -C "$TARGET_DIR" pull --ff-only
else
  echo "Cloning OpenClaw into '$TARGET_DIR'..."
  git clone --recursive "$REPO_URL" "$TARGET_DIR"
fi

echo "Configuring build (type: $BUILD_TYPE)..."
cmake -S "$TARGET_DIR" -B "$TARGET_DIR/build" -DCMAKE_BUILD_TYPE="$BUILD_TYPE"

echo "Building OpenClaw..."
cmake --build "$TARGET_DIR/build" --config "$BUILD_TYPE"

echo "Done. Build artifacts are in: $TARGET_DIR/build"
