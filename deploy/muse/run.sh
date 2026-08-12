#!/usr/bin/env bash
set -euo pipefail

MODEL_DIR=${MODEL_DIR:-/home/funsteam/models/Muse-Glimmer-30B-GGUF}
docker rm -f muse-glimmer-8004 2>/dev/null || true

exec docker run -d \
  --name muse-glimmer-8004 \
  --restart unless-stopped \
  --gpus all --network host --ipc host \
  -v "${MODEL_DIR}:/models:ro" \
  muse-glimmer-llamacpp:ngc2603-b10353 \
  -m /models/muse-glimmer-30B-kquant-17gb.gguf \
  -md /models/dflash-kquant.gguf \
  --spec-type draft-dflash \
  --spec-draft-n-max 15 \
  --mmproj /models/mmproj-kquant.gguf \
  -a muse-glimmer-30B -ngl 99 -ngld 99 \
  -c 32768 -np 1 \
  --host 0.0.0.0 --port 8004 \
  --jinja --temp 1.0 --top-p 0.95 --top-k 64 \
  --reasoning-budget 8192
