#!/usr/bin/env bash
# Vercel's build step can't fetch private git submodules natively (see
# CLAUDE.md's "Tooling quirks" note) — vendor/Admination.02-Design points at
# a private repo, so it clones empty there. This re-fetches it over an
# authenticated HTTPS rewrite before `next build` runs.
#
# No-ops anywhere ADMINATION_DS_TOKEN isn't set (local dev, CI without the
# secret) — the submodule is already checked out there via the normal
# `git submodule update --init` a developer runs once after cloning.
set -euo pipefail

if [ -z "${ADMINATION_DS_TOKEN:-}" ]; then
  exit 0
fi

git config --global "url.https://x-access-token:${ADMINATION_DS_TOKEN}@github.com/.insteadOf" "https://github.com/"
git submodule sync --recursive
git submodule update --init --recursive
