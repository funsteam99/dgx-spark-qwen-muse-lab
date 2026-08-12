# DGX Spark coexistence experiment

Test date: 2026-08-12 (Asia/Taipei)

## Platform

| Item | Value |
|---|---|
| Host | NVIDIA DGX Spark / GB10 |
| Architecture | aarch64 |
| Unified memory | 128 GB class; Linux reported 121 GiB |
| CUDA target | `sm_121a` |
| Container runtime | Docker + NVIDIA Container Runtime |
| Qwen runtime | vLLM nightly (`0.23.1rc1.dev552+g4559c43a9` observed) |
| Muse runtime | llama.cpp `b10353`, built on `nvcr.io/nvidia/vllm:26.03-py3` |

## Models and endpoints

| Model | Endpoint | Context | Vision | Speculative decoding |
|---|---:|---:|---|---|
| `nvidia/Qwen3.6-35B-A3B-NVFP4` | 8002 | 65,536 | Native vision encoder inside the HF/vLLM checkpoint; no separate mmproj | Built-in MTP, 3 speculative tokens |
| Muse Glimmer 30B K-Quant | 8004 | 32,768 | `mmproj-kquant.gguf` | `dflash-kquant.gguf`, `draft-dflash`, max draft 15 |
| Splitframe web console | 8005 | — | Uploads images as OpenAI-compatible data URLs | — |

## Muse artifacts

The model weights are not redistributed by this repository.

| File | Exact bytes |
|---|---:|
| `muse-glimmer-30B-kquant-17gb.gguf` | 16,756,681,056 |
| `dflash-kquant.gguf` | 1,631,205,312 |
| `mmproj-kquant.gguf` | 1,400,328,928 |

## Procedure

1. Preserve the original Qwen container configuration and provide a rollback script.
2. Build llama.cpp with CUDA enabled and `CMAKE_CUDA_ARCHITECTURES=121`. CUDA 13.2 resolves this as `sm_121a` on GB10.
3. Reduce Qwen context from 262K to 64K and concurrency from 4 to 2 for coexistence.
4. Keep Qwen `gpu-memory-utilization=0.18`; `0.10` was too low to initialize its model plus CUDA graphs.
5. Start Muse with one 32K slot, all main and draft layers offloaded, mmproj loaded, and DFlash enabled.
6. Validate both health endpoints, model lists, individual prompts, and simultaneous prompts.

## Results

![Live simultaneous comparison in Splitframe](images/splitframe-live-comparison.png)

| Test | Result |
|---|---|
| Qwen text request | Passed (`QWEN_OK`) |
| Muse text request | Passed (`MUSE_OK`) |
| Simultaneous Qwen + Muse request | Passed |
| Container restarts after final parallel test | Qwen 0, Muse 0 |
| Muse without DFlash | ~7.5 tok/s |
| Muse with DFlash | 23.1 tok/s single test; 24.1 tok/s during final concurrent test |
| DFlash acceptance samples | 70/285 and 69/300 drafted tokens |

DFlash produced roughly a **3.1×–3.2×** decode speedup for the short controlled prompt. This is not a comprehensive benchmark: prompt length, acceptance rate, thermal state, cache state, and concurrent load all affect throughput.

## Resource snapshot after concurrent test

- Linux memory: about 93 GiB used, 28 GiB available.
- Swap: about 9.3 GiB used.
- GPU/unified-memory processes observed: Qwen about 64.9 GiB, Muse about 19.9 GiB.
- Root filesystem had about 75 GiB available (92% used).

Because DGX Spark uses unified memory, the reported GPU and system values should not be added as if they were independent memory pools.

## Failure notes

### Generic vLLM image could not build llama.cpp

The existing `vllm/vllm-openai:nightly` image lacked CUDA development headers such as `cublas_v2.h`. Reusing the already-present NGC vLLM 26.03 development image solved the build.

### Qwen failed at `gpu-memory-utilization=0.10`

The model loaded, but CUDA graph profiling produced negative available memory for KV cache and the engine restarted. Returning to `0.18` provided about 39.7 GiB of KV cache while retaining the 64K/2-sequence coexistence reductions.

### DFlash model loaded but was initially inactive

Passing `-md` loads the draft model, but llama.cpp defaults `--spec-type` to `none`. Adding `--spec-type draft-dflash --spec-draft-n-max 15` activated speculative decoding and raised observed decode speed from ~7.5 to ~23–24 tok/s.

## Security

The experiment used host networking and no API keys. Bind these services only on a trusted LAN or place an authenticated reverse proxy in front of them.

## WebP compatibility note

The llama.cpp multimodal loader used here rejected a raw WebP data URL with `Failed to load image or audio file`. Splitframe now converts browser-decodable formats such as WebP to high-quality JPEG client-side (maximum edge 2048 px) before sending them. A 1000×1000 WebP regression test was successfully described by Muse after conversion.
