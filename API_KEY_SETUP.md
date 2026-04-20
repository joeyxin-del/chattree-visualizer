# ⚠️ 重要：配置 API Key

在运行项目之前，你需要配置 Claude API Key。

## 获取 API Key

1. 访问 [Anthropic Console](https://console.anthropic.com/)
2. 登录或注册账号
3. 进入 API Keys 页面
4. 创建新的 API Key

## 配置步骤

编辑 `backend/.env` 文件：

```env
ANTHROPIC_API_KEY=sk-ant-your-actual-key-here
```

将 `sk-ant-your-actual-key-here` 替换为你的实际 API Key。

## 验证配置

启动后端后，如果看到以下错误：

```
ANTHROPIC_API_KEY not configured
```

说明 API Key 未正确配置，请检查 `.env` 文件。

## 安全提示

- ⚠️ 不要将 API Key 提交到 Git 仓库
- ⚠️ 不要在公开场合分享 API Key
- ⚠️ 定期轮换 API Key
- ⚠️ `.env` 文件已在 `.gitignore` 中，不会被提交
