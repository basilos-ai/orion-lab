"""Exercise the actual chat HTTP handler without models, private state or external hosts."""
import contextlib
import http.client
import json
import pathlib
import sys
import threading
import time
import types
import unittest
from http.cookies import SimpleCookie
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'services/o6n-bridge'))
import controlled_bridge as bridge


class ClientAuthorizationTests(unittest.TestCase):
    @contextlib.contextmanager
    def server(self, configuration, address='198.51.100.42'):
        # The listener stays on loopback; inject the peer only at the test-server
        # boundary so unlisted-source behavior is tested without spoofed headers.
        class Handler(bridge.Handler):
            def __init__(self, request, client, server):
                super().__init__(request, (address, client[1]), server)

            def log_message(self, *args):
                pass

        with patch.object(bridge, 'CONF', configuration), patch.object(bridge, 'sessions', {}), patch.object(bridge, 'event') as events, patch.object(bridge, 'agent_proxy', types.SimpleNamespace(identity_cookie=lambda handler: None), create=True):
            server = bridge.http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                yield server.server_port, events
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=2)

    def request(self, port, path='/api/session', *, body=None, cookie=None, origin=None):
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
        headers = {'Content-Type': 'application/json'}
        if cookie:
            headers['Cookie'] = cookie
        if origin:
            headers['Origin'] = origin
        connection.request('GET' if body is None else 'POST', path, body=None if body is None else json.dumps(body), headers=headers)
        response = connection.getresponse()
        result = response.status, json.loads(response.read()), response.getheader('Set-Cookie')
        connection.close()
        return result

    def test_default_and_enabled_allowlist_reject_unlisted_peers(self):
        for options in [{}, {'trusted_client_ips_enabled': True}]:
            with self.subTest(options=options), self.server({'trusted_client_ips': ['198.51.100.9'], **options}) as (port, _):
                status, body, cookie = self.request(port)
                self.assertEqual(status, 403)
                self.assertFalse(body['authorized'])
                self.assertIsNone(cookie)

    def test_disabled_allowlist_accepts_unlisted_peer_without_erasing_entries(self):
        configuration = {'trusted_client_ips': ['198.51.100.9'], 'trusted_client_ips_enabled': False}
        with self.server(configuration) as (port, _):
            status, body, cookie = self.request(port)
            self.assertEqual(status, 200)
            self.assertTrue(body['authorized'])
            self.assertIn('HttpOnly', cookie)
            self.assertIn('SameSite=Strict', cookie)
            self.assertIn('Max-Age=43200', cookie)
        self.assertEqual(configuration['trusted_client_ips'], ['198.51.100.9'])

    def test_only_literal_false_disables_the_allowlist(self):
        for value in [None, 0, '', 'false', [], {}]:
            with self.subTest(value=value), self.server({'trusted_client_ips_enabled': value}) as (port, _):
                self.assertEqual(self.request(port)[0], 403)

    def test_enabled_allowlist_keeps_explicit_and_loopback_trust(self):
        for address in ['198.51.100.42', '127.0.0.1', '::1']:
            with self.subTest(address=address), self.server({'trusted_client_ips': ['198.51.100.42']}, address) as (port, _):
                self.assertEqual(self.request(port)[0], 200)

    def test_disabled_allowlist_retains_session_and_same_origin_requirements(self):
        with self.server({'trusted_client_ips_enabled': False}) as (port, events):
            payload = {'request_id': 'fixture-authorization', 'rating': 'good'}
            self.assertEqual(self.request(port, '/api/feedback', body=payload)[0], 401)
            status, _, header = self.request(port)
            self.assertEqual(status, 200)
            cookie = SimpleCookie(header)
            sid = cookie['o6n_session'].value
            header = 'o6n_session=' + sid
            self.assertEqual(self.request(port, '/api/feedback', body=payload, cookie=header, origin='https://cross-site.invalid')[0], 403)
            events.assert_not_called()
            self.assertEqual(self.request(port, '/api/feedback', body=payload, cookie=header, origin=f'http://127.0.0.1:{port}')[0], 200)
            events.assert_called_once()
            bridge.sessions[sid] = (time.time() - 1, '198.51.100.42')
            self.assertEqual(self.request(port, '/api/feedback', body=payload, cookie=header)[0], 401)
            bridge.sessions[sid] = (time.time() + 60, '198.51.100.99')
            self.assertEqual(self.request(port, '/api/feedback', body=payload, cookie=header)[0], 401)


if __name__ == '__main__':
    unittest.main()
