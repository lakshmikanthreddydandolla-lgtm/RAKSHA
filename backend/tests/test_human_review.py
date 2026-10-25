from fastapi.testclient import TestClient

from backend.main import app


client = TestClient(app)


def create_review(session_id: str):
    client.delete(
        f"/api/session/{session_id}"
    )

    response = client.post(
        "/api/session/evaluate",
        json={
            "agent_id": "invoice-agent",
            "session_id": session_id,
            "tool": "read_file",
            "operation": "read",
            "resource": ".env",
            "destination": "local",
            "user_intent": "summarize vendor invoice",
            "permissions": [
                "read_file"
            ]
        }
    )

    return response


def test_review_action_becomes_pending():
    session_id = "review-pending-test"

    response = create_review(
        session_id
    )

    assert response.status_code == 200

    data = response.json()

    assert data["verdict"] == "REVIEW"

    assert (
        data["execution_status"]
        == "PENDING_REVIEW"
    )

    assert data["review_id"] is not None

    review_response = client.get(
        "/api/reviews",
        params={
            "session_id": session_id
        }
    )

    reviews = review_response.json()[
        "reviews"
    ]

    assert len(reviews) == 1

    assert (
        reviews[0]["status"]
        == "PENDING"
    )


def test_allow_once_resolves_review():
    session_id = "review-approve-test"

    response = create_review(
        session_id
    )

    review_id = response.json()[
        "review_id"
    ]

    approval = client.post(
        f"/api/reviews/{review_id}/approve"
    )

    assert approval.status_code == 200

    data = approval.json()

    assert data["status"] == "APPROVED"

    assert (
        data["final_outcome"]
        == "ALLOW_ONCE"
    )

    assert (
        data["execution_status"]
        == "APPROVED_ONCE"
    )


def test_deny_resolves_review_without_containment():
    session_id = "review-deny-test"

    response = create_review(
        session_id
    )

    review_id = response.json()[
        "review_id"
    ]

    denial = client.post(
        f"/api/reviews/{review_id}/deny"
    )

    assert denial.status_code == 200

    data = denial.json()

    assert data["status"] == "DENIED"

    assert (
        data["final_outcome"]
        == "DENY"
    )

    session = client.get(
        f"/api/session/{session_id}"
    ).json()

    assert session["contained"] is False


def test_review_cannot_be_approved_twice():
    session_id = "review-repeat-test"

    response = create_review(
        session_id
    )

    review_id = response.json()[
        "review_id"
    ]

    first = client.post(
        f"/api/reviews/{review_id}/approve"
    )

    assert first.status_code == 200

    second = client.post(
        f"/api/reviews/{review_id}/approve"
    )

    assert second.status_code == 409


def test_reset_removes_pending_reviews():
    session_id = "review-reset-test"

    create_review(
        session_id
    )

    client.delete(
        f"/api/session/{session_id}"
    )

    response = client.get(
        "/api/reviews",
        params={
            "session_id": session_id
        }
    )

    assert response.status_code == 200

    assert (
        response.json()["reviews"]
        == []
    )