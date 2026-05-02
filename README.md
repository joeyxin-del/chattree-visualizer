# Tree Visualizer

**用一棵树，把分叉的 AI 对话、未来的文档与代码协作，都摆到同一张画布上。**

Tree Visualizer 是一个面向「多分支、可演进」场景的**树形可视化工作台**：当前以 **分支对话 ChatTree** 为核心，在同一会话里从任意节点派生新话题，在画布上一眼看清结构，而不是淹没在线性聊天记录里。后端支持多种 LLM，包括 OpenAI 兼容接口与 Claude，并预留与 PDF、长文档以及代码工程、Git work tree 结合的方向。

---

## 项目简介

- **是什么**：Web 端树形画布与 FastAPI 后端，实时 WebSocket，适合演示「对话如何长成一棵树」。
- **适合谁**：需要分支探索、对比多条推理路径，或想把「树」作为统一隐喻做多模态扩展的开发者与团队。
- **现状**：对话树与模型配置已可完整走通；文档解析、工程树展示等在路线图中，详见文末 **TODO**。

---

## 快速开始

### 环境要求

| 组件 | 版本 |
|------|------|
| Node.js | 18+ |
| Python | **3.10+**，须满足 Docling 与后端依赖要求 |

可选安装 Git。若在 Windows 上使用 PyTorch，有时需要安装对应平台的 C++ 运行库。

### 方式 A：Windows 一键起服务

1. 克隆本仓库并进入根目录。
2. 双击 **`start-all.cmd`**，会在两个终端窗口中依次拉起后端与前端。
3. 浏览器打开前端 [http://localhost:5173](http://localhost:5173)，后端默认为 [http://127.0.0.1:8000](http://127.0.0.1:8000)。
4. 首次运行时，若没有 `backend/.env`，`start-backend.cmd` 会从 **`backend/.env.example`** 复制一份模板，请编辑其中的 API 相关变量，说明见下文「配置大模型」。

也可分别双击 **`start-backend.cmd`**、**`start-frontend.cmd`**。

### 方式 B：手动安装

**后端**

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate
# macOS / Linux
# source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env   # Windows 可用 copy .env.example .env
# 编辑 .env，至少配置一种 LLM，说明见下文

python main.py
```

默认服务地址：`http://127.0.0.1:8000`。交互式 API 文档：<http://127.0.0.1:8000/docs>。

**前端**

```bash
cd frontend
npm install
npm run dev
```

开发服务器默认：<http://localhost:5173>。

### 配置大模型

1. **界面配置，适合首次上手**  
   打开前端右上角 **「模型设置」**，选择 MiniMax 等 OpenAI 兼容提供商、OpenAI 或 Claude，填写 Base URL、模型名与 API Key 并保存。配置会写入 `backend/data/llm_config.json`，该路径已由 `.gitignore` 忽略。

2. **环境变量，适合部署与 CI**  
   参考 **`backend/.env.example`**，例如配置 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`MODEL_NAME`，或使用 Anthropic 等其它组合。  
   **优先级**：当 `llm_config.json` 中存在有效 Key 且提供商为 `openai_compat` 或 `anthropic` 时，优先使用界面保存的配置；否则回退到 `.env`。设置页「清除已保存的 Key」会删除该 JSON，从而重新走环境变量。  
   可用 **`LLM_CONFIG_FILE`** 覆盖默认的 `llm_config.json` 路径。

### PDF 智能章节，可选

启用 **Docling** 时，首次启动会下载版面模型，耗时与磁盘占用属正常现象。开发时可在 `backend/.env` 中设置 **`TREE_SKIP_DOCLING_WARMUP=1`** 加快冷启动；若本机无法加载 PyTorch，可设 **`TREE_DISABLE_DOCLING=1`**，仅用启发式解析。更多说明见仓库内 `backend/pdf_docling_toc.py` 与 `.env.example` 注释。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18、TypeScript、Vite、React Flow、Zustand、Tailwind、shadcn/ui |
| 后端 | FastAPI、WebSocket、Pydantic；可选 Docling 做 PDF 结构解析 |
| 通信 | 浏览器与后端 WebSocket 实时推送 |

---

## 项目结构概要

```
tree-visualizer/
├── backend/          # FastAPI 服务、会话与 LLM、PDF 解析等
├── frontend/         # React 单页应用
├── start-backend.cmd # Windows：创建或使用 venv、同步依赖、启动后端
├── start-frontend.cmd
├── start-all.cmd
└── README.md
```

---

## TODO

面向独立产品演进，当前希望往三个方向延伸：

- **对话功能**  
  深化分支对话体验：编辑与整理节点、多模型切换、会话持久化与导入导出、检索与导航等，让「树」成为日常协作的默认视图。

- **文档阅读以及与文档结合的功能**  
  与 PDF、长文档的目录与章节结构对齐，支持在画布或侧栏中串联「读到哪里、问到哪一叉」，形成文档与对话的统一树形上下文。

- **与代码工程结合：树形的 work tree 表现**  
  对接 Git 工作树、分支与变更意图，用同一套树形隐喻呈现各条工作线在做什么，探索从对话树到「工程树」的连续体验。

---

## 参考与致谢

- [React Flow](https://reactflow.dev/)
- [FastAPI](https://fastapi.tiangolo.com/)
- [Docling](https://github.com/docling-project/docling)，可选，用于 PDF 相关能力

---

## 贡献

欢迎 Issue 与 PR。提交前请确保本地前后端均可按 **快速开始** 跑通；代码风格以现有 TypeScript、Python 与 ESLint 配置为准。

---

## 许可证

待定。

---

**最后更新**：2026-05-02
