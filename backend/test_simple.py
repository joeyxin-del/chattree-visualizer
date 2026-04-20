import asyncio
import anthropic
import httpx
import os
from dotenv import load_dotenv

load_dotenv()

async def test_anthropic():
    api_key = os.getenv("ANTHROPIC_API_KEY")
    print(f"API Key loaded: {api_key[:20]}..." if api_key else "No API key")

    # 配置代理
    http_proxy = os.getenv("HTTP_PROXY") or os.getenv("http_proxy")
    https_proxy = os.getenv("HTTPS_PROXY") or os.getenv("https_proxy")

    proxy = http_proxy or https_proxy
    if proxy:
        print(f"Using proxy: {proxy}")

    # 创建 httpx client with proxy
    http_client = httpx.Client(proxy=proxy) if proxy else None

    # 获取 API 配置
    base_url = os.getenv("API_BASE_URL", "https://api.anthropic.com")
    model_name = os.getenv("MODEL_NAME", "claude-sonnet-4.5-20250514")

    print(f"API Base URL: {base_url}")
    print(f"Model: {model_name}")

    client = anthropic.Anthropic(
        api_key=api_key,
        base_url=base_url,
        http_client=http_client
    )

    print("Testing Claude API with streaming...")

    try:
        full_content = ""

        # 使用同步方式
        with client.messages.stream(
            model=model_name,
            max_tokens=1024,
            messages=[{"role": "user", "content": "你好"}]
        ) as stream:
            for text in stream.text_stream:
                full_content += text
                print(text, end="", flush=True)

        print(f"\n\nFull response length: {len(full_content)}")
        print(f"Full response: {full_content}")

    except Exception as e:
        print(f"Error: {type(e).__name__}: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_anthropic())
