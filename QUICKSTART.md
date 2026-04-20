# ChatTree Visualizer - 快速启动指南

## 项目结构

```
tree-visualizer/
├── frontend/          # React 前端
├── backend/           # FastAPI 后端
└── docs/             # 文档
```

## 环境要求

- Node.js 18+
- Python 3.9+
- Claude API Key

## 安装步骤

### 1. 后端设置

```bash
cd backend

# 创建虚拟环境（推荐）
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入你的 ANTHROPIC_API_KEY
```

### 2. 前端设置

```bash
cd frontend

# 安装依赖
npm install
```

## 运行项目

### 启动后端

```bash
cd backend
python main.py
```

后端将运行在 `http://localhost:8000`

### 启动前端

```bash
cd frontend
npm run dev
```

前端将运行在 `http://localhost:5173`

## 使用说明

1. 打开浏览器访问 `http://localhost:5173`
2. 在右侧输入框输入消息
3. 点击"发送消息"或按 Enter 键
4. 等待 AI 回复，回复会实时流式显示
5. 点击任意节点，可以在该节点下创建分支对话
6. 使用鼠标拖拽画布、滚轮缩放

## 功能特性

- ✅ 树形对话可视化
- ✅ 实时流式响应
- ✅ 分支对话创建
- ✅ 节点选择和聚焦
- ✅ 响应式布局
- ✅ 暗色模式支持

## API 配置

编辑 `backend/.env` 文件：

```env
# Claude API Key
ANTHROPIC_API_KEY=sk-ant-xxx

# 服务器配置
HOST=0.0.0.0
PORT=8000

# CORS 配置
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

## 故障排除

### 后端无法启动

- 检查 Python 版本：`python --version`
- 检查依赖是否安装：`pip list`
- 检查端口 8000 是否被占用

### 前端无法连接后端

- 确认后端已启动
- 检查浏览器控制台错误
- 确认 CORS 配置正确

### WebSocket 连接失败

- 检查防火墙设置
- 确认后端 WebSocket 端点可访问
- 查看浏览器开发者工具的网络标签

## 开发

### 前端开发

```bash
cd frontend
npm run dev    # 开发模式
npm run build  # 构建生产版本
npm run preview # 预览生产版本
```

### 后端开发

```bash
cd backend
python main.py  # 自动重载模式
```

## 下一步

- [ ] 添加更多 LLM 支持（OpenAI, Gemini 等）
- [ ] 实现节点编辑和删除
- [ ] 添加对话历史保存
- [ ] 支持导出为图片
- [ ] 添加搜索和过滤功能

## 技术栈

**前端**：
- React 18 + TypeScript
- React Flow（树形可视化）
- Zustand（状态管理）
- Tailwind CSS（样式）
- Vite（构建工具）

**后端**：
- FastAPI（Web 框架）
- Anthropic SDK（Claude API）
- WebSocket（实时通信）

## 许可证

待定
