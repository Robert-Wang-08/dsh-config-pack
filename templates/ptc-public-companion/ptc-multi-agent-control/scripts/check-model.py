
import json, os, io, urllib.request
from pathlib import Path

HOME = Path(os.environ.get('USERPROFILE', '')) / '.dsh'
sid  = os.environ.get('DSH_SESSION_ID', 'unknown')
EXPECTED = os.environ.get('PTC_EXPECTED_CONTROLLERS', 'codex-relay,openai-codex').split(',')

def find_key(obj, key, path=''):
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key: out.append((path + '/' + k, v))
            out.extend(find_key(v, key, path + '/' + k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out.extend(find_key(v, key, '%s[%d]' % (path, i)))
    return out

print('session id        : %s' % sid)
provider = model = None
pc = HOME / 'storages' / 'session_projcache' / 'sessions' / (sid + '.json')
if pc.exists():
    data = json.loads(io.open(pc, encoding='utf-8').read())
    for path, v in find_key(data, 'modelSelection'):
        val = v.get('val') if isinstance(v, dict) else None
        if isinstance(val, dict) and val.get('lastUsed'):
            lu = val['lastUsed']
            provider, model = lu.get('provider'), lu.get('model')
            print('projcache         : %s' % pc.name)
            print('  lastUsed        = %s / %s' % (provider, model))
            print('  pending         = %s' % json.dumps(val.get('pending')))
else:
    print('projcache         : MISSING (%s)' % pc)

try:
    with urllib.request.urlopen('http://127.0.0.1:3080/provider-failover/status', timeout=10) as r:
        st = json.loads(r.read().decode('utf-8'))
    print('failover          : enabled=%s policyMode=%s switches=%d pins=%s' % (
        st.get('enabled'), st.get('policyMode'), len(st.get('switches') or []), json.dumps(st.get('pins'))))
    print('  lastSessionId   = %s  (this session: %s)' % (st.get('lastSessionId'), st.get('lastSessionId') == sid))
except Exception as e:
    print('failover          : unavailable (%s)' % str(e)[:80])

print('')
print('--- VERDICT ---')
if provider is None:
    print('CONTROLLER MODEL: UNKNOWN - could not observe. Report as unverified; do NOT fill in a documented default.')
elif provider in EXPECTED:
    print('CONTROLLER MODEL: %s / %s  [expected family]' % (provider, model))
else:
    print('CONTROLLER MODEL: %s / %s  [NOT in expected list: %s]' % (provider, model, ','.join(EXPECTED)))
    print('ACTION: report this actual model verbatim in the routing section of the reply.')
    print('        do not describe it as Codex; do not substitute a documented default.')
