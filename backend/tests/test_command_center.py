from fastapi.testclient import TestClient

from backend.main import app


client = TestClient(app)


def _disconnect_all():
    client.post('/api/agent/disconnect')


def test_demo_ai_connection_accepts_any_non_empty_key_without_storing_it():
    client.post('/api/audit/reset')
    _disconnect_all()
    fake_key = 'totally-free-demo-key-123'

    response = client.post(
        '/api/agent/connect',
        json={'session_id': 'connect-test', 'api_key': fake_key},
    )

    assert response.status_code == 200
    data = response.json()
    assert data['connected'] is True
    assert data['provider'] == 'RAKSHA Demo Model'
    assert data['mode'] == 'FREE_DEMO'
    assert fake_key not in response.text

    audit = client.get('/api/audit/events').text
    assert fake_key not in audit


def test_demo_ai_connection_rejects_blank_key():
    response = client.post(
        '/api/agent/connect',
        json={'session_id': 'connect-test', 'api_key': '   '},
    )
    assert response.status_code == 422


def test_live_activity_tracks_only_connected_user_sessions():
    client.post('/api/audit/reset')
    _disconnect_all()

    for sid in ('user-alpha', 'user-beta'):
        client.post(
            '/api/agent/connect',
            json={'session_id': sid, 'api_key': 'demo-key'},
        )
        response = client.post(
            '/api/agent/message',
            json={
                'session_id': sid,
                'message': 'Please summarize the vendor invoice',
            },
        )
        assert response.status_code == 200

    response = client.get('/api/activity?limit=50')
    assert response.status_code == 200
    data = response.json()

    assert data['active_sessions'] == 2
    assert {session['session_id'] for session in data['sessions']} == {
        'user-alpha',
        'user-beta',
    }
    session_ids = {event['session_id'] for event in data['events']}
    assert {'user-alpha', 'user-beta'} <= session_ids
    assert any(event['verdict'] == 'ALLOW' for event in data['events'])


def test_disconnect_resets_live_presence_but_keeps_audit_history():
    client.post('/api/audit/reset')
    _disconnect_all()

    for sid in ('user-one', 'user-two'):
        client.post(
            '/api/agent/connect',
            json={'session_id': sid, 'api_key': 'demo-key'},
        )
        client.post(
            '/api/agent/message',
            json={'session_id': sid, 'message': 'summarize the vendor invoice'},
        )

    before = client.get('/api/activity').json()
    assert before['active_sessions'] == 2
    assert before['event_count'] > 0

    disconnected = client.post('/api/agent/disconnect')
    assert disconnected.status_code == 200
    payload = disconnected.json()
    assert payload['connected'] is False
    assert payload['disconnected_sessions'] == 2

    after = client.get('/api/activity').json()
    assert after['active_sessions'] == 0
    assert after['event_count'] == 0
    assert after['events'] == []
    assert after['sessions'] == []

    # Permanent proof stays available even though the live dashboard is empty.
    audit = client.get('/api/audit/events').json()
    assert audit['event_count'] > 0


def test_generic_chat_returns_a_human_friendly_demo_response():
    _disconnect_all()
    sid = 'user-chat-response'
    client.post('/api/agent/connect', json={'session_id': sid, 'api_key': 'demo-key'})

    response = client.post(
        '/api/agent/message',
        json={'session_id': sid, 'message': 'hello, what can you do?'},
    )

    assert response.status_code == 200
    data = response.json()
    assert data['assistant_message']
    assert 'No tool action needed' not in data['assistant_message']
    assert 'RAKSHA' in data['assistant_message']


def test_safe_invoice_chat_returns_useful_result_text():
    _disconnect_all()
    sid = 'user-invoice-response'
    client.post('/api/agent/connect', json={'session_id': sid, 'api_key': 'demo-key'})

    response = client.post(
        '/api/agent/message',
        json={'session_id': sid, 'message': 'summarize the vendor invoice'},
    )

    assert response.status_code == 200
    text = response.json()['assistant_message']
    assert 'Acme Supplies' in text
    assert '$1,250' in text
