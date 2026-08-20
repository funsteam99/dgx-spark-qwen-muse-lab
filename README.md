# Splitframe — 多模型視覺與推理實驗室 (DGX Spark)

A high-performance multimodal and reasoning A/B testing console for local LLM / VLM models on NVIDIA DGX Spark (GB10 Superchip, 128 GB Unified Memory).

---

## 🚀 支援模型與架構 (Models & Endpoints)

| 模型 | 容器 / Runtime | 端口 | 特色 |
| :--- | :--- | :--- | :--- |
| **Qwen 3.6 (35B NVFP4)** | `qwen3.6-nvfp4` (vLLM nightly) | `Port 8002` | 256K 上下文 · 原生多模態 · MTP 推測解碼 · 深度長推理 (Long-CoT) |
| **Qwen 3.8 (27B NVFP4)** | `qwen3.8-nvfp4` (vLLM nightly) | `Port 8006` | 128K 上下文 · 3:1 Mamba/Transformer · **3-Token MTP 投機加速 (2.29x)** · 自適應思考 (Short-CoT) |
| **Muse Glimmer (30B GGUF)** | `muse-glimmer-8004` (llama.cpp) | `Port 8004` | 32K 上下文 · GGUF 視覺多模態 · DFlash 草稿加速 |
| **Splitframe Web UI** | `splitframe` (Node.js Proxy + Web) | `Port 8005` | 雙欄自由切換 · 獨立思考開關 · KaTeX 公式 · Mermaid 流程圖 · GFM 表格 |

---

## 🎨 前端渲染與互動特性

- **雙欄自由切換 & 同步送出**：可同時將同一問題與多張圖片發送給兩端進行即時 A/B 對比。
- **獨立思考模式開關 (🧠)**：支援動態傳遞 `enable_thinking`，自由切換推理鏈展開或秒級直出。
- **LaTeX 數學公式排版**：內建 KaTeX，完整支援行內公式 `$E=mc^2$` 與區塊公式 `$$\int_0^\infty e^{-x^2} dx$$`。
- **Mermaid 流程圖視覺化**：自動將 `flowchart`、`sequenceDiagram` 等圖表代碼編譯為清晰的向量 SVG。
- **GFM 表格與代碼高亮**：完整解析 Markdown 表格、引用塊與語法高亮。
- **完全離線自給自足**：所有前端依賴庫（KaTeX、Mermaid、Marked 與字型檔）皆打包於容器內，無外部 CDN 依賴。

---

## 🛠️ 快速啟動 (Quickstart)

```bash
cd services/muse-qwen-compare
docker build -t splitframe:latest .
docker run -d --name splitframe --restart unless-stopped --network host splitframe:latest
```

開啟瀏覽器造訪 `http://<spark-ip>:8005/` 即可開始測試。
