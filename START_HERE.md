# ✅ Demo 项目已就绪！

## 🎉 项目创建成功

位置：`E:\002project\014moltbot\tree-visualizer`

前端已成功启动在 `http://localhost:5173`

## 🚀 现在开始使用

### 第一步：配置 API Key

1. 打开文件：`backend\.env`
2. 填入你的 Claude API Key：
   ```
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```

### 第二步：启动后端

打开新的命令行窗口，运行：
```bash
cd E:\002project\014moltbot\tree-visualizer
start-backend.cmd
```

或者手动启动：
```bash
cd backend
pip install -r requirements.txt
python main.py
```

### 第三步：访问应用

浏览器打开：`http://localhost:5173`

## 💡 使用方法

1. **开始对话**
   - 在右侧输入框输入消息
   - 按 Enter 或点击"发送消息"

2. **创建分支**
   - 点击任意节点（用户或助手消息）
   - 在右侧输入新问题
   - 发送后会在该节点下创建分支

3. **画布操作**
   - 拖拽：移动画布
   - 滚轮：缩放视图
   - 点击节点：选中节点

## 📊 项目状态

✅ 前端：已启动 (http://localhost:5173)
⏳ 后端：等待启动 (http://localhost:8000)

## 🔧 技术栈

- React 18 + TypeScript
- React Flow (树形可视化)
- Zustand (状态管理)
- Tailwind CSS (样式)
- FastAPI (后端)
- Claude Sonnet 4.5 (AI)

## 📝 功能特性

✅ 树形对话可视化
✅ 实时流式响应
✅ 分支对话创建
✅ 节点选择聚焦
✅ 响应式设计
✅ 暗色模式

## 🐛 故障排除

### 前端无法连接后端
- 确认后端已启动
- 检查端口 8000 是否可访问

### WebSocket 连接失败
- 检查防火墙设置
- 确认后端 WebSocket 可用

### API Key 错误
- 检查 backend\.env 文件
- 确认 API Key 格式正确

## 📚 更多文档

- README_DEMO.md - 完整项目说明
- QUICKSTART.md - 快速启动指南
- API_KEY_SETUP.md - API Key 配置

---

现在就去配置 API Key 并启动后端吧！🚀
