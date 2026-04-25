"""使用 TestClient 校验分支摘要路由（无需启动服务器、不调用 LLM）。"""
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_branch_summary_validation():
    r = client.post("/api/sessions", json={})
    assert r.status_code == 200
    key = r.json()["session_key"]

    r0 = client.post(
        f"/api/sessions/{key}/summary/branch",
        json={"node_ids": []},
    )
    assert r0.status_code == 400

    r1 = client.post(
        f"/api/sessions/{key}/summary/branch",
        json={"node_ids": ["no_such"]},
    )
    assert r1.status_code == 400

    r404 = client.post(
        "/api/sessions/does_not_exist/summary/branch",
        json={"node_ids": ["x"]},
    )
    assert r404.status_code == 404


if __name__ == "__main__":
    test_branch_summary_validation()
    print("test_branch_summary_validation: ok")
