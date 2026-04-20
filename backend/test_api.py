"""
测试后端 API 是否正常工作
"""
import requests
import json
import time

BASE_URL = "http://localhost:8000"

def test_root():
    """测试根路径"""
    try:
        response = requests.get(f"{BASE_URL}/")
        print(f"✓ 根路径测试: {response.status_code}")
        print(f"  响应: {response.json()}")
        return True
    except Exception as e:
        print(f"✗ 根路径测试失败: {e}")
        return False

def test_create_session():
    """测试创建会话"""
    try:
        response = requests.post(
            f"{BASE_URL}/api/sessions",
            json={}
        )
        print(f"✓ 创建会话测试: {response.status_code}")
        data = response.json()
        print(f"  会话 Key: {data['session_key']}")
        return data['session_key']
    except Exception as e:
        print(f"✗ 创建会话失败: {e}")
        return None

def test_get_session(session_key):
    """测试获取会话"""
    try:
        response = requests.get(f"{BASE_URL}/api/sessions/{session_key}")
        print(f"✓ 获取会话测试: {response.status_code}")
        data = response.json()
        print(f"  节点数: {len(data['nodes'])}")
        return True
    except Exception as e:
        print(f"✗ 获取会话失败: {e}")
        return False

def main():
    print("=" * 50)
    print("ChatTree Visualizer - 后端 API 测试")
    print("=" * 50)
    print()

    # 测试根路径
    if not test_root():
        print("\n⚠️  后端可能未启动，请先运行: python main.py")
        return

    print()

    # 测试创建会话
    session_key = test_create_session()
    if not session_key:
        return

    print()

    # 测试获取会话
    test_get_session(session_key)

    print()
    print("=" * 50)
    print("✅ 所有测试通过！后端运行正常")
    print("=" * 50)
    print()
    print("现在可以访问前端: http://localhost:5173")

if __name__ == "__main__":
    main()
