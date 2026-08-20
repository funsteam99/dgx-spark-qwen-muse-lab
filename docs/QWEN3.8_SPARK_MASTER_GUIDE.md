# Qwen 3.8-27B on NVIDIA DGX SPARK (GB10) 部署與最佳化全指南

**建立日期：** 2026-08-19  
**最後更新：** 2026-08-20  
**硬體節點：** NVIDIA DGX SPARK (`GB10 Superchip` / 128 GiB Coherent Unified Memory / ARM `aarch64` / Compute Capability `sm_121`)  
**模型版本：** `unsloth/Qwen3.8-27B-NVFP4` (Dense 27B + 3-Token MTP + 視覺多模態)  
**服務端口：** `Port 8006` (直連) / `Port 4000` (LiteLLM 網關) / `Port 8005` (Splitframe 實驗室)

---

## 🚀 一、黃金啟動配置（已驗證通過）

啟動腳本已保存於 `/home/funsteam/start_qwen38.sh`，指令內容如下：

```bash
#!/bin/bash
docker rm -f qwen3.8-nvfp4 2>/dev/null || true

docker run -d \
  --name qwen3.8-nvfp4 \
  --gpus all \
  --network host \
  --ipc host \
  --restart unless-stopped \
  -v /home/funsteam/.cache/huggingface:/root/.cache/huggingface \
  vllm/vllm-openai:nightly \
  --model unsloth/Qwen3.8-27B-NVFP4 \
  --trust-remote-code \
  --served-model-name qwen3.8 \
  --reasoning-parser qwen3 \
  --tool-call-parser qwen3_xml \
  --enable-auto-tool-choice \
  --max-model-len 65536 \
  --kv-cache-dtype fp8 \
  --gpu-memory-utilization 0.35 \
  --kv-cache-memory-bytes 10737418240 \
  --enforce-eager \
  --max-num-seqs 4 \
  --max-num-batched-tokens 8192 \
  --enable-prefix-caching \
  --speculative-config '{"method":"mtp","num_speculative_tokens":3}' \
  --host 0.0.0.0 \
  --port 8006
```

---

## 📊 二、3-Token MTP 投機解碼加速表現

在啟用 `--speculative-config '{"method":"mtp","num_speculative_tokens":3}'` 後：
* **草稿 Token 數**：每次前進 3 個草稿 Token。
* **實測接受率**：
  * **Position 0 接受率**：**85.0%**
  * **Position 1 接受率**：**77.5%**
  * **Position 2 接受率**：**66.25%**
* **平均步進效率**：每步推進 **2.29 tokens**（~2.29x 投機加速比）。
* **推論速度**：常規對話回應延遲自 7~8 秒壓縮至 **3.0 ~ 3.5 秒**。

---

## 🧠 三、8002 (Qwen 3.6) vs 8006 (Qwen 3.8) 思考處理對比

| 比較維度 | Qwen 3.6 (8002) | Qwen 3.8 (8006) |
| :--- | :--- | :--- |
| **模型架構** | 35B NVFP4 MoE | 27B NVFP4 Dense (3:1 Mamba/Transformer) |
| **思考機制** | 強制深度長鏈英文推導 (Long-CoT) | 自適應精簡思考 (Short-CoT) |
| **典型思考長度** | 400 ~ 1200+ tokens | 50 ~ 150 tokens |
| **直出模式延遲** | 極快 (~1.15s) | 極快 (~1.2s) |
| **思考開關控制** | `chat_template_kwargs: { enable_thinking: bool }` | `chat_template_kwargs: { enable_thinking: bool }` |

---

## 🎨 四、Splitframe (Port 8005) 實驗室前端功能

1. **雙欄模型自由比較**：可任意在左右兩欄配置 Qwen 3.6、Qwen 3.8 或 Muse Glimmer。
2. **獨立思考開關**：左右側皆有獨立 `[🧠 思考]` toggle 開關。
3. **KaTeX 數學公式渲染**：支援行內 `$E=mc^2$` 與獨立行區塊 `$$\int \dots$$`。
4. **Mermaid 流程圖視覺化**：自動將 `flowchart`、`sequenceDiagram` 轉為高清 SVG。
5. **GFM 表格與排版**：支援完整 Markdown 表格與樣式。
6. **100% 離線可用**：全部靜態資源皆已封裝於 Docker 容器內。
