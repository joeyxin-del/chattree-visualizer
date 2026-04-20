# ✅ 后端已启动！

## 当前状态

✅ **后端服务器**: 正在运行
- 地址: http://localhost:8000
- 进程 ID: 38344
- 状态: Application startup complete

✅ **前端服务器**: 应该也在运行
- 地址: http://localhost:5173

✅ **API Key**: 已配置

## 🚀 现在开始使用

### 方式一：直接访问前端

打开浏览器访问：
```
http://localhost:5173
```

### 方式二：测试 API

打开浏览器访问：
```
http://localhost:8000/docs
```

这是 FastAPI 自动生成的 API 文档界面，你可以在这里测试所有 API 端点。

## 💡 使用步骤

1. **打开前端**
   ```
   http://localhost:5173
   ```

2. **开始对话**
   - 在右侧输入框输入消息
   - 按 Enter 发送

3. **创建分支**
   - 点击任意节点
   - 输入新问题
   - 发送创建分支

## 🔍 API 端点

- `GET /` - 根路径
- `POST /api/sessions` - 创建会话
- `GET /api/sessions/{session_key}` - 获取会话
- `WS /ws/{session_key}` - WebSocket 连接

## 📊 测试 WebSocket

前端会自动连接 WebSocket，你可以：
1. 打开浏览器开发者工具（F12）
2. 切换到 Network 标签
3. 筛选 WS（WebSocket）
4. 查看实时消息

## 🐛 如果遇到问题

### 前端无法连接后端
1. 确认后端正在运行（已确认 ✓）
2. 检查浏览器控制台错误
3. 确认没有防火墙阻止

### WebSocket 连接失败
1. 刷新页面重试
2. 检查浏览器控制台
3. 确认后端 WebSocket 端点可访问

## 📝 下一步

现在就可以：
1. 打开 http://localhost:5173
2. 开始你的第一个对话
3. 尝试创建分支对话
4. 体验树形可视化！

---

**提示**: 如果需要重启后端，运行：
```bash
cd E:\002project\014moltbot\tree-visualizer
start-backend.cmd
```
