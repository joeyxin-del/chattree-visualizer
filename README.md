# Tree Visualizer - 树形可视化项目

## 项目简介

Tree Visualizer 是一个通用的树形结构可视化工具，旨在为 Molt-Py 项目提供直观的树形数据展示能力。

### 核心目标

- **初期**：实现对话树（ChatTree）可视化 - 支持分支对话功能的可视化展示
- **后期**：扩展支持代码工作树（WorkTree）可视化 - 类似 git worktree 的可视化管理

---

## 快速开始

### 文档导航

1. [技术选型](./docs/01-技术选型.md) - 前端框架、可视化库、状态管理等技术选择
2. [架构设计](./docs/02-架构设计.md) - 系统架构、模块设计、数据流
3. [原型设计](./docs/03-原型设计.md) - UI/UX 设计、交互设计、视觉规范

### 本地运行与模型配置（ChatTree）

1. 启动后端（默认监听 `http://127.0.0.1:8000`）：可在 `backend` 目录使用 `.env`，或仅通过网页配置（见下）。
2. 启动前端：在 `frontend` 目录执行 `npm run dev`（默认 `http://localhost:5173`）。
3. **模型与 API Key**：在界面右上角打开「**模型设置**」，可选择 MiniMax（OpenAI 兼容）、OpenAI 或 Claude，填写 Base URL、模型与 API Key 并保存。配置持久化到 `backend/data/llm_config.json`，与会话数据同属 `backend/data/`，已被 `.gitignore` 忽略。
4. **配置优先级**：当 `llm_config.json` 中存在有效 API Key 且提供商为 `openai_compat` 或 `anthropic` 时，**优先使用该文件**中的 Base URL 与模型；否则**回退到环境变量**（参见 `backend/.env.example`，如 `OPENAI_BASE_URL` + `OPENAI_API_KEY`，或 `API_BASE_URL` + `LLM_PROVIDER` + 对应 Key）。在设置页「清除已保存的 Key」会删除该文件，从而重新采用环境变量。
5. 可选环境变量 **`LLM_CONFIG_FILE`**：覆盖默认的 `llm_config.json` 路径。

### 后端 Python 与 Docling（PDF 结构 / 智能解析章节）

- **Python 版本须为 3.10+**（与 [Docling](https://github.com/docling-project/docling) 一致）。根目录 `start-backend.cmd` 会在进入 venv 前做一次版本检查。
- 依赖统一写在 **`backend/requirements.txt`**。Docling 作为 **PyPI 包**（`docling>=2.92,<3`）安装即可；**不建议**把 Docling 做成 git submodule，否则无法正确管理其传递依赖（torch、docling-core 等）。
- **首次安装或启动**：Docling 会在预热阶段下载**版面/layout**等模型到本机缓存，需预留磁盘与网络；时间可能较长，属正常现象。
- 当前集成策略（见 `backend/pdf_docling_toc.py`）：**StandardPdf 标准管道**、**仅 CPU**（`DOCLING_DEVICE=cpu`）、关闭 **OCR**、**表格结构**、**公式/代码增强**以及页图/内嵌大图导出；**未启用 VLM**。启动时默认在 **lifespan** 中同步预热 Docling，避免首次点击「智能解析章节」才拉权重；若在开发时希望尽快起服务，可在 `.env` 中设置 **`TREE_SKIP_DOCLING_WARMUP=1`**。若机器无法加载 PyTorch（例如 Windows 缺少 VC++ 运行库导致 `c10.dll` 报错），可设 **`TREE_DISABLE_DOCLING=1`**，将仅使用 `pdf_heuristic_toc.py` 启发式。
- **智能解析章节** API：优先使用 Docling 抽取 `section_header`；若失败或检测到的章节少于 2 个，自动 **回退** 到原有启发式。

### 技术栈

```
前端框架：React 18 + TypeScript
可视化：  React Flow（初期）→ D3.js（后期可选）
状态管理：Zustand
实时通信：WebSocket (原生)
UI 组件： shadcn/ui + Tailwind CSS
构建工具：Vite
```

---

## 项目结构

```
tree-visualizer/
├── docs/                      # 📚 项目文档
│   ├── 01-技术选型.md
│   ├── 02-架构设计.md
│   └── 03-原型设计.md
├── src/                       # 🚧 源代码（待创建）
├── public/                    # 🚧 静态资源（待创建）
├── tests/                     # 🚧 测试（待创建）
└── README.md                  # 本文件
```

---

## 功能特性

### ChatTree 可视化（初期）

- ✅ 树状对话结构展示
- ✅ 实时状态更新（思考中/已完成）
- ✅ 分支创建和管理
- ✅ 节点交互（点击/展开/折叠）
- ✅ 多种布局模式（垂直/水平/径向）
- ✅ 搜索和过滤
- ✅ 响应式设计（桌面/移动端）

### WorkTree 可视化（后期）

- ⏭️ Git 分支树展示
- ⏭️ Worktree 状态管理
- ⏭️ 文件变更可视化
- ⏭️ 分支切换和合并

---

## 开发计划

### 阶段 1：文档和设计（当前）
- [x] 技术选型
- [x] 架构设计
- [x] 原型设计
- [ ] Figma 高保真原型

**预计时间**：1 周

### 阶段 2：项目初始化
- [ ] 创建项目脚手架
- [ ] 配置开发环境
- [ ] 搭建基础组件库
- [ ] 实现核心数据模型

**预计时间**：1 周

### 阶段 3：ChatTree MVP
- [ ] 树形布局引擎
- [ ] 节点渲染组件
- [ ] WebSocket 集成
- [ ] 基础交互功能

**预计时间**：2-3 周

### 阶段 4：功能完善
- [ ] 多种布局模式
- [ ] 搜索和过滤
- [ ] 性能优化
- [ ] 移动端适配

**预计时间**：2 周

### 阶段 5：WorkTree 扩展
- [ ] Git 集成
- [ ] Worktree 管理
- [ ] 文件变更展示

**预计时间**：3-4 周

---

## 设计理念

### 1. 清晰性优先
树形结构应该一目了然，避免视觉混乱

### 2. 性能至上
支持 100+ 节点的流畅展示，使用虚拟化和增量渲染

### 3. 响应式设计
从移动端到桌面端的无缝体验

### 4. 可扩展性
通用的树形引擎，支持多种数据类型（对话/代码/文件）

---

## 参考项目

- [React Flow](https://reactflow.dev/) - 节点编辑器
- [Excalidraw](https://excalidraw.com/) - 画布交互
- [Obsidian](https://obsidian.md/) - 知识图谱
- [D3.js Tree](https://observablehq.com/@d3/tree) - 树形布局

---

## 贡献指南

### 开发流程
1. 阅读设计文档
2. 创建功能分支
3. 编写代码和测试
4. 提交 PR

### 代码规范
- TypeScript 严格模式
- ESLint + Prettier
- 组件优先使用函数式
- 遵循 React Hooks 最佳实践

---

## 许可证

待定

---

## 联系方式

项目维护者：待定

---

**最后更新**：2026-04-27
