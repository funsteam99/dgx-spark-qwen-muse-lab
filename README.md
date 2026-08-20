# Splitframe — 多模型視覺、推理與 Agent 實驗室 (DGX Spark)

A high-performance multimodal, reasoning, and **Agentic Self-Evolving Skill A/B testing console** for local LLM / VLM models on NVIDIA DGX Spark (GB10 Superchip, 128 GB Unified Memory).

---

## 🚀 支援模型與架構 (Models & Endpoints)

| 模型 | 容器 / Runtime | 端口 | 特色 |
| :--- | :--- | :--- | :--- |
| **Qwen 3.6 (35B NVFP4)** | `qwen3.6-nvfp4` (vLLM nightly) | `Port 8002` | 256K 上下文 · 原生多模態 · MTP 推測解碼 · 深度長推理 · **原生 Function/Tool Calling** |
| **Qwen 3.8 (27B NVFP4)** | `qwen3.8-nvfp4` (vLLM nightly) | `Port 8006` | 128K 上下文 · 3:1 Mamba/Transformer · **3-Token MTP 投機加速 (2.29x)** · 自適應思考 · **原生 Function/Tool Calling** |
| **Muse Glimmer (30B GGUF)** | `muse-glimmer-8004` (llama.cpp) | `Port 8004` | 32K 上下文 · GGUF 視覺多模態 · DFlash 草稿加速 |
| **Splitframe Web UI** | `splitframe` (Node.js Proxy + Web) | `Port 8005` | 雙欄自由切換 · 獨立思考開關 · **Agentic 迴圈** · **動態自建 Skill 隔離庫** |

---

## 🛠️ Agentic 與「動態自建 Skill」機制

Splitframe 不僅支援一般對話，還內建了 **多輪 ReAct 執行迴圈（Multi-turn ReAct Loop）** 與 **模型隔離的動態程式碼演化引擎**：

1. **內建基礎工具箱（Base Tools）**：
   - `web_search(query)`：網路即時公開資訊檢索。
   - `python_repl(code)`：Python 沙盒代碼執行與資料運算。
2. **核心亮點：自建 Skill 元工具（`create_skill`）**：
   - 當模型發現現有工具無法滿足任務時，可**自行編寫 Python 函式並註冊為可重複調用的 Skill**。
   - 系統即時編譯、語法安全檢查並熱加載（Hot-Reload）至該模型專屬的 Tool Registry。
   - 模型在下一個步驟即可直接調用自己剛寫出的新工具。
3. **模型獨立隔離評測（Isolated Registry）**：
   - Qwen 3.6 與 Qwen 3.8 擁有各自獨立的 Skill 記憶庫，互不干擾、無法借用對方的代碼，確保 A/B 評測 100% 公平。

---

## 🎨 前端渲染與互動特性

- **🛠️ Agent 模式切換**：可一鍵切換「一般直出模式」與「Multi-turn Agent 模式」。
- **即時步驟卡片 (Step Traces)**：視覺化展示思考過程、工具調用參數、代碼執行日誌與最終結論。
- **🎨 動態 Skill 技能庫抽屜**：側欄即時檢視各模型累積寫出的 Python 原始碼、參數規格，並支援 `[全部 / Qwen 3.6 / Qwen 3.8]` 分頁篩選與來源標籤。
- **⚡ 快捷 Agent 試煉題庫**：內建經典 Agent 評測題目（如自建經緯度距離計算、質數統計、時間序列分析）。
- **獨立思考模式開關 (🧠)**：支援動態傳遞 `enable_thinking`，精準切換思考鏈展開或秒級直出。
- **LaTeX 數學公式 & Mermaid 流程圖**：內建 KaTeX 與 Mermaid 離線編譯支援。

---

## 🛠️ 快速啟動 (Quickstart)

```bash
cd services/muse-qwen-compare
docker build -t splitframe:latest .
docker run -d --name splitframe --restart unless-stopped --network host splitframe:latest
```

開啟瀏覽器造訪 `http://<spark-ip>:8005/` 即可開始評測。
