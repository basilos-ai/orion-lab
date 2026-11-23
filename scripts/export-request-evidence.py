"""Export one authorized Gateway request and its published policy evidence for Orion."""
import argparse
import json
import pathlib
import re
import subprocess
import urllib.parse

# Default executable for existing gateway installations. New deployments can pass --cli.
DEFAULT_GATEWAY_CLI = '\x73\x68\x69\x65\x6c\x64\x6f\x6e'


def select(row, keys):
    return {k: row[k] for k in keys.split() if k in row and isinstance(row[k], (str, int, bool))}

POLICY_KEYS = set('id name active scope scopes scope_type scope_id type config config_id model models logical_model logical_models gateway_key_id policy_id limit_policy_id limit_policy_ids bindings limits rpm tpm concurrency requests_per_minute tokens_per_minute max_concurrency failure_mode'.split())


def policy_fields(value):
    if isinstance(value, dict):
        return {k: policy_fields(v) for k, v in value.items() if k in POLICY_KEYS}
    if isinstance(value, list):
        return [policy_fields(v) for v in value]
    return value


def export(api, workspace, request_id, pages):
    permissions = api('/auth/context')['workspaces']
    if not any(w['id'] == workspace and w['permissions'].get('read') for w in permissions):
        raise ValueError('No read access to the selected workspace')
    base = '/workspaces/' + workspace
    cursor = ''
    for _ in range(pages):
        page = api(base + '/usage/logs?limit=100' + cursor)
        row = next((r for r in page['data'] if r.get('workspace_id') == workspace and r.get('request_id') == request_id), None)
        if row:
            break
        cursor = page.get('page', {}).get('next_cursor')
        if not cursor:
            break
        cursor = '&cursor=' + urllib.parse.quote(cursor, safe='')
    if not row:
        raise ValueError('Request not found in the selected workspace and search window')
    request = select(row, 'workspace_id request_id release_id config_id requested_model logical_model upstream_model access_mode status http_status error_code rejection_stage total_tokens total_tokens_known')
    result = {'schema': 'orion-request-v1', 'request': request}
    for key in ('guardrail_decisions', 'budget_decisions', 'limit_decisions'):
        if isinstance(row.get(key), list):
            result[key] = [select(d, 'profile_id policy_id check_id stage action outcome reason_code') for d in row[key]]
    release_id = request.get('release_id')
    if release_id:
        snapshot = api(base + '/gateway-releases/' + urllib.parse.quote(release_id, safe=''))['data']
        if snapshot['id'] != release_id or snapshot.get('workspace_id') != workspace:
            raise ValueError('Release does not match the request')
        result['release'] = select(snapshot, 'id published_at')
        if 'limit_policies' in snapshot:
            policies = snapshot['limit_policies'] or []
            if not isinstance(policies, list):
                raise ValueError('Unsupported release policy format')
            result['release']['limit_policy_count'] = len(policies)
            result['release']['limit_policies'] = policy_fields(policies)
        bindings = []
        for config in snapshot.get('configs') or []:
            for entry in [config, *(config.get('models') or [])]:
                limits = {k: policy_fields(entry[k]) for k in ('limit_policy_id', 'limit_policy_ids') if entry.get(k)}
                if limits:
                    bindings.append(dict(config_id=config['id'], **select(entry, 'model'), **limits))
        if bindings:
            result['release']['bindings'] = bindings
    return result


if __name__ == '__main__':
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('--workspace', required=True)
    args.add_argument('--request', required=True)
    args.add_argument('--output', type=pathlib.Path, required=True)
    args.add_argument('--cli', default=DEFAULT_GATEWAY_CLI)
    args.add_argument('--profile')
    args.add_argument('--pages', type=int, default=10)
    opts = args.parse_args()
    if not re.fullmatch(r'ws_[A-Za-z0-9_-]+', opts.workspace) or not 1 <= opts.pages <= 100:
        args.error('Invalid workspace or page limit')

    def get(path):
        command = [opts.cli, 'auth', 'context', '--json'] if path == '/auth/context' else [opts.cli, 'api', 'GET', '/v1' + path]
        if opts.profile:
            command += ['--profile', opts.profile]
        response = subprocess.run(command, capture_output=True, encoding='utf8', timeout=60)
        if response.returncode:
            raise ValueError('AI Gateway read failed. Check CLI authentication and workspace permissions.')
        return json.loads(response.stdout)

    try:
        result = export(get, opts.workspace, opts.request, opts.pages)
        opts.output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf8')
        print(opts.output)
    except (ValueError, KeyError, OSError, subprocess.TimeoutExpired) as error:
        args.exit(1, str(error) + '\n')
