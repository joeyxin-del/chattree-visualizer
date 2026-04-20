import asyncio
import websockets
import json
import requests

async def test_chat():
    # 1. 创建会话
    print("Creating session...")
    response = requests.post("http://localhost:8000/api/sessions", json={})
    session_data = response.json()
    session_key = session_data["session_key"]
    print(f"Session created: {session_key}")

    # 2. 连接 WebSocket
    print("Connecting to WebSocket...")
    uri = f"ws://localhost:8000/ws/{session_key}"

    async with websockets.connect(uri) as websocket:
        print("Connected!")

        # 3. 发送消息
        message = {
            "type": "chat",
            "parent_node_id": None,
            "message": "你好",
            "branch_label": None
        }
        print(f"Sending message: {message['message']}")
        await websocket.send(json.dumps(message))

        # 4. 接收响应
        print("\nReceiving responses:")
        full_response = ""
        while True:
            try:
                response = await asyncio.wait_for(websocket.recv(), timeout=30)
                data = json.loads(response)
                print(f"[{data['type']}]", end=" ")

                if data["type"] == "node_streaming":
                    full_response = data["content"]
                    print(f"Streaming... ({len(full_response)} chars)")
                elif data["type"] == "node_completed":
                    full_response = data["content"]
                    print(f"\n\nFinal response:\n{full_response}")
                    break
                elif data["type"] == "node_error":
                    print(f"\n\nError: {data['error']}")
                    break
                elif data["type"] == "node_created":
                    print(f"Node created: {data['node']['role']}")

            except asyncio.TimeoutError:
                print("\n\nTimeout waiting for response")
                break
            except Exception as e:
                print(f"\n\nError: {e}")
                break

if __name__ == "__main__":
    asyncio.run(test_chat())
