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

def test_delete_session(session_key):
    """测试删除会话后无法再 GET"""
    try:
        r = requests.delete(f"{BASE_URL}/api/sessions/{session_key}")
        if r.status_code != 204:
            print(f"✗ 删除会话应返回 204，实际 {r.status_code}: {r.text}")
            return False
        r2 = requests.get(f"{BASE_URL}/api/sessions/{session_key}")
        if r2.status_code != 404:
            print(f"✗ 删除后会话 GET 应 404，实际 {r2.status_code}")
            return False
        print("✓ 删除会话测试: 204，随后 GET 404")
        return True
    except Exception as e:
        print(f"✗ 删除会话失败: {e}")
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

    # 分支摘要：参数校验（不调 LLM）
    try:
        r0 = requests.post(
            f"{BASE_URL}/api/sessions/{session_key}/summary/branch",
            json={"node_ids": []},
        )
        assert r0.status_code == 400, f"空 node_ids 应返回 400，实际 {r0.status_code}"
        print(f"✓ 分支摘要对空 node_ids: {r0.status_code}")
        r1 = requests.post(
            f"{BASE_URL}/api/sessions/{session_key}/summary/branch",
            json={"node_ids": ["no_such_id"]},
        )
        assert r1.status_code == 400, f"非法 node 应 400，实际 {r1.status_code}"
        print(f"✓ 分支摘要对非法 node_id: {r1.status_code}")
    except AssertionError as e:
        print(f"✗ 分支摘要校验测试失败: {e}")
    except Exception as e:
        print(f"✗ 分支摘要请求失败: {e}")

    print()

    if not test_delete_session(session_key):
        return

    print()
    print("=" * 50)
    print("✅ 所有测试通过！后端运行正常")
    print("=" * 50)
    print()
    print("现在可以访问前端: http://localhost:5173")

if __name__ == "__main__":
    main()
