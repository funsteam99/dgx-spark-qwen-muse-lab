# Qwen3.8-27B-NVFP4 部署與維運筆記

**建立日期：** 2026-08-17  
**最後更新：** 2026-08-20  
**機器：** SPARK (GB10 Superchip, 128 GiB unified memory)  
**模型：** unsloth/Qwen3.8-27B-NVFP4 (21.81 GiB)  
**Port：** 8006  
**Image：** vllm/vllm-openai:nightly  

---

## 坑一：HTTP 400 Bad Request（工具呼叫/推理參數）

### 現象
NextChat、Chatbox、Cursor 等標準 OpenAI 客戶端連 8006 時回傳 400 Bad Request。

### 根因
標準客戶端會在 payload 中帶入 `tools: []`、`tool_choice`、或推理相關參數。
vLLM 若沒有啟用對應 parser，會直接拒絕。

### 解法
啟動時必須加以下三個 flag：
```bash
--enable-auto-tool-choice
--tool-call-parser qwen3_xml
--reasoning-parser qwen3
```

---

## 坑二：GB10 統一記憶體 Profiling Assertion

### 根因
在 GB10 unified memory 上，同機多容器共存時記憶體微幅浮動，導致 vLLM profiling 快照 assertion 失敗。

### 解法
啟動時同時指定：
```bash
--gpu-memory-utilization 0.35
--kv-cache-memory-bytes 10737418240
```
直接指定 10.0 GiB KV cache，完全繞過 profiling assertion。

---

## 🚀 3-Token MTP 投機加速 (2026-08-20 更新)

- **參數設定**：`--speculative-config '{"method":"mtp","num_speculative_tokens":3}'`
- **實測數據**：
  - Pos 0 接受率：**85.0%**
  - Pos 1 接受率：**77.5%**
  - Pos 2 接受率：**66.25%**
  - 平均每步推進：**2.29 tokens**（~2.29x 投機加速）
- **延遲表現**：由原本 ~7 秒降至 **~3.2 秒**，無退化現象。

---

## 🎨 Splitframe 視覺與推理實驗室 (Port 8005) 升級

- **獨立思考開關**：雙欄獨立 `[🧠 思考]` toggle，切換 `enable_thinking`。
- **LaTeX 數學公式 (KaTeX)**：原生支援 `$E=mc^2$` 與 `$$\sum \dots$$`。
- **Mermaid 流程圖視覺化**：自動編譯 `flowchart` 等圖表為高清 SVG。
- **GFM 表格與引用塊**：完整支援 Markdown 表格與樣式。
- **全離線封裝**：容器內建所有 JS/CSS/字型資產。

---

## 最終工作命令（已驗證）

```bash
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

## Port 對照表

| Port | 容器名稱 | 模型 | 備註 |
|------|---------|------|------|
| 8002 | qwen3.6-nvfp4 | Qwen3.6-35B-A3B-NVFP4 | 37.8 GiB (Long-CoT) |
| 8004 | muse-glimmer-8004 | Muse 30B (llama.cpp) | 22.9 GiB (DFlash) |
| 8006 | qwen3.8-nvfp4 | Qwen3.8-27B-NVFP4 | 21.81 GiB (3-Token MTP) |
| 4000 | litellm_gateway | LiteLLM Gateway | 統一入口 |
| 8005 | splitframe | Splitframe Web UI | 支援 KaTeX / Mermaid / 表格 |
