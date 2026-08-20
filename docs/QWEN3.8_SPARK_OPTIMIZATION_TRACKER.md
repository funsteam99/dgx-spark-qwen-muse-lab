# Qwen 3.8-27B on NVIDIA DGX SPARK (GB10) 最佳化追蹤手冊

**更新日期：** 2026-08-20  
**硬體環境：** NVIDIA DGX SPARK (GB10 Superchip / 128 GB Coherent Unified Memory / ARM aarch64)  
**目前狀態：** 雙模型共存穩定運行（Qwen 3.6 @ 8002 + Qwen 3.8 @ 8006 + 3-Token MTP + Splitframe Web UI）

---

## 📌 當前已落地的最佳化配置 (Baseline)

| 優化項目 | 實作參數 / 技術 | 成果效益 |
| :--- | :--- | :--- |
| **量化精度** | `NVFP4 (CompressedTensorsW8A8Fp8)` | 27B 模型權重僅 **21.3 GiB**，保留原生高精度 |
| **推測解碼 (MTP)** | `--speculative-config '{"method":"mtp","num_speculative_tokens":3}'` | **3-Token MTP 落地**：Pos 0 (85.0%)、Pos 1 (77.5%)、Pos 2 (66.25%)，平均每步推進 **2.29 tokens (~2.29x 提速)** |
| **KV 快取顯存** | `--kv-cache-dtype fp8 --kv-cache-memory-bytes 10737418240` | 鎖定 10.0 GB 快取，支援 25 萬+ tokens，徹底跳過 GB10 profiling assertion |
| **前綴快取** | `--enable-prefix-caching --max-num-batched-tokens 8192` | 重複 Prompt / 多輪對話 Prefill 近乎零延遲 |
| **高併發支援** | `--max-num-seqs 4` | 實測 4 併發吞吐量達 **48.9 ~ 62.1 tok/s** |
| **注意力核心** | `FlashInfer + Cutlass NVFP4 Linear Kernel` | 支援 GB10 Blackwell 架構原生張量運算 |
| **混合線性注意力** | `Triton / FLA GDN Prefill Kernel` | 支援 Qwen 3.8 的 3:1 Mamba/Transformer 混合結構 |
| **思考鏈調控** | `--reasoning-parser qwen3` + `chat_template_kwargs` | 前端支援獨立 `enable_thinking` 開關，自適應短思考與直出模式秒級切換 |

---

## 🎨 Splitframe (Port 8005) 實驗室前端升級 (2026-08-20)

| 升級項目 | 實作技術 | 說明 |
| :--- | :--- | :--- |
| **獨立思考開關** | `enable_thinking` 動態傳遞 | 左右雙欄均設有 `[🧠 思考]` toggle，自由控制是否輸出推理鏈 |
| **LaTeX 數學公式** | `KaTeX (Local Vendored)` | 支援行內公式 `$E=mc^2$` 與獨立行公式塊 `$$\int \dots$$` |
| **向量流程圖** | `Mermaid.js (Standalone)` | 即時渲染流程圖 (`flowchart`)、時序圖 (`sequenceDiagram`) 等 SVG 圖表 |
| **GFM 表格與排版** | `Marked.js (GFM)` | 支援 Markdown 表格、引用塊、自適應橫向滾動與代碼高亮 |
| **離線封裝** | 本地資源打包 | 所有 JS/CSS/字型皆打包於 Docker 容器內，100% 離線穩定運作 |

---

## 🚀 後續重點追蹤與最佳化演進方向 (Roadmap)

### 1. DeepGEMM 與 FlashInfer swapAB 動態核心切換
- **社群進展**：vLLM v0.23+ 已引入 `torch.cond()` 自動核心切換：
  - **小 Batch ($M < 32$)**：自動調用 **FlashInfer DeepGEMM swapAB** 優化，降低首字生成 (TTFT) 延遲。
  - **大 Batch ($M \ge 32$)**：調用官方 **DeepGEMM E8M0** 核心，提升並發吞吐量。
- **追蹤點**：後續更新 vLLM nightly 時可驗證 DeepGEMM PDL（Programmatic Dependent Launch）在 GB10 上的加速比。

### 2. 移除 `--enforce-eager` 並安全恢復 CUDA Graph
- **當前狀況**：目前使用 `--enforce-eager` 是為了跳過 GB10 統一記憶體浮動帶來的 profiling assertion 錯誤。
- **目標**：待 vLLM 官方釋出針對 Grace-Blackwell 統一記憶體的 profiling 容差修復後，可安全啟用 **CUDA Graph**，預期可再降低 **15% ~ 25%** 的 Decode 階段 CPU overhead 延遲。

### 3. 256K / 1M 超長上下文記憶體微調
- **當前狀況**：目前 Qwen 3.8 設定為 64K 上下文（`--max-model-len 65536`）。
- **擴展空間**：若需要跑單一超長文檔分析，可調整 `--kv-cache-memory-bytes` 至 16 GB ~ 24 GB，將上下文推展至 131,072 (128K) 或 262,144 (256K)。

---

## 🛠️ 常用監控與驗證指令

```bash
# 1. 檢查 MTP 命中率與接受率 (Pos 0, 1, 2)
curl -s http://127.0.0.1:8006/metrics | grep -E 'spec_decode_(num_draft|num_accepted)'

# 2. 檢查前綴快取命中率
curl -s http://127.0.0.1:8006/metrics | grep prefix_cache_hit_rate

# 3. 監控 GB10 顯存與處理進程
nvidia-smi --query-compute-apps=pid,used_memory,name --format=csv

# 4. 執行一鍵全健康檢查
python /home/funsteam/full_health_check.py
```
