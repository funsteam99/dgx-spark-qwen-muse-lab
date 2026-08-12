#!/usr/bin/env bash
set -euo pipefail

docker rm -f qwen3.6-nvfp4 2>/dev/null || true
exec docker run -d \
  --name qwen3.6-nvfp4 \
  --restart always \
  --gpus all --network host --ipc host \
  -v /home/funsteam/.cache/huggingface:/root/.cache/huggingface \
  vllm/vllm-openai:nightly \
  nvidia/Qwen3.6-35B-A3B-NVFP4 \
  --trust-remote-code --quantization modelopt \
  --reasoning-parser qwen3 --tool-call-parser qwen3_xml \
  --enable-auto-tool-choice \
  --max-model-len 262144 --kv-cache-dtype fp8 \
  --attention-backend flashinfer --moe-backend marlin \
  --gpu-memory-utilization 0.18 \
  --max-num-seqs 4 --max-num-batched-tokens 8192 \
  --enable-prefix-caching \
  --speculative-config '{"method":"mtp","num_speculative_tokens":3,"moe_backend":"triton"}' \
  --load-format fastsafetensors \
  --host 0.0.0.0 --port 8002
