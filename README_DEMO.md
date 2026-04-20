# 🌳 ChatTree Visualizer

一个支持分支对话的树形可视化工具，让你的 AI 对话更加灵活和高效。

![Demo](docs/demo-screenshot.png)

## ✨ 特性

- 🌲 **树形对话结构** - 可视化展示对话的分支关系
- ⚡ **实时流式响应** - 支持 Claude API 的流式输出
- 🔀 **分支对话** - 在任意节点创建新的对话分支
- 🎯 **节点选择** - 点击节点创建子分支
- 🎨 **现代化 UI** - 基于 React Flow 的流畅交互体验
- 🌓 **暗色模式** - 自动适配系统主题

## 🚀 快速开始

### 方式一：一键启动（Windows）

1. 双击运行 `start-all.cmd`
2. 等待服务启动
3. 浏览器访问 `http://localhost:5173`

### 方式二：手动启动

#### 1. 配置 API Key

编辑 `backend/.env` 文件，填入你的 Claude API Key：

```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

#### 2. 启动后端

```bash
# Windows
start-backend.cmd

# Linux/Mac
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

#### 3. 启动前端

```bash
# Windows
start-frontend.cmd

# Linux/Mac
cd frontend
npm install
npm run dev
```

## 📖 使用说明

### 基础对话

1. 在右侧输入框输入消息
2. 按 Enter 或点击"发送消息"
3. 等待 AI 回复（实时流式显示）

### 创建分支

1. 点击任意节点（用户或助手消息）
2. 在右侧输入框输入新问题
3. 发送后会在该节点下创建分支

### 画布操作

- **拖拽** - 移动画布
- **滚轮** - 缩放视图
- **点击节点** - 选中节点
- **小地图** - 快速导航

## 🏗️ 技术架构

### 前端

- **React 18** + TypeScript
- **React Flow** - 树形可视化
- **Zustand** - 状态管理
- **Tailwind CSS** - 样式
- **Vite** - 构建工具

### 后端

- **FastAPI** - Web 框架
- **Anthropic SDK** - Claude API
- **WebSocket** - 实时通信
- **Pydantic** - 数据验证

## 📁 项目结构

```
tree-visualizer/
├── frontend/                 # React 前端
│   ├── src/
│   │   ├── components/      # React 组件
│   │   ├── store/           # Zustand 状态管理
│   │   ├── hooks/           # 自定义 Hooks
│   │   ├── types/           # TypeScript 类型
│   │   └── utils/           # 工具函数
│   └── package.json
├── backend/                  # FastAPI 后端
│   ├── main.py              # 主程序
│   ├── requirements.txt     # Python 依赖
│   └── .env                 # 环境变量
├── docs/                     # 文档
│   ├── 01-技术选型.md
│   ├── 02-架构设计.md
│   └── 03-原型设计.md
├── start-all.cmd            # 一键启动脚本
├── start-backend.cmd        # 后端启动脚本
├── start-frontend.cmd       # 前端启动脚本
├── QUICKSTART.md            # 快速启动指南
└── README.md                # 本文件
```

## 🔧 配置说明

### 后端配置 (backend/.env)

```env
# Claude API Key（必填）
ANTHROPIC_API_KEY=sk-ant-xxx

# 服务器配置
HOST=0.0.0.0
PORT=8000

# CORS 配置
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

### 前端配置

前端默认连接到 `http://localhost:8000`，如需修改请编辑：
- `frontend/src/hooks/useWebSocket.ts`

## 🐛 故障排除

### 后端无法启动

- 检查 Python 版本（需要 3.9+）
- 确认已安装依赖：`pip install -r requirements.txt`
- 检查端口 8000 是否被占用

### 前端无法连接

- 确认后端已启动
- 检查浏览器控制台错误
- 确认 CORS 配置正确

### WebSocket 连接失败

- 检查防火墙设置
- 确认后端 WebSocket 可访问
- 查看浏览器开发者工具网络标签

## 🗺️ 路线图

- [x] 基础对话树可视化
- [x] Claude API 集成
- [x] 实时流式响应
- [x] 分支对话创建
- [ ] 多 LLM 支持（OpenAI, Gemini）
- [ ] 节点编辑和删除
- [ ] 对话历史保存
- [ ] 导出为图片
- [ ] 搜索和过滤
- [ ] WorkTree 可视化

## 📝 开发文档

详细的技术文档请查看 `docs/` 目录：

- [技术选型](docs/01-技术选型.md)
- [架构设计](docs/02-架构设计.md)
- [原型设计](docs/03-原型设计.md)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

待定

## 🙏 致谢

- [React Flow](https://reactflow.dev/) - 强大的节点编辑器
- [Anthropic](https://www.anthropic.com/) - Claude API
- [FastAPI](https://fastapi.tiangolo.com/) - 现代化的 Python Web 框架
