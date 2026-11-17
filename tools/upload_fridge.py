#!/usr/bin/env python3
"""냉장고 데이터(data/fridge.json)를 검증해서 커밋·배포합니다.

사용법:
    python3 tools/upload_fridge.py payload.json            # 검증 → 커밋 → 푸시 → 배포 확인
    python3 tools/upload_fridge.py payload.json --dry-run   # 검증만 (파일도 건드리지 않음)

payload.json 은 inventory / meals / shopping 만 담으면 됩니다. updatedAt 은 이 스크립트가
지금 시각(한국시간)으로 찍습니다. 항목 id 가 없으면 이름+유통기한으로 고정 id 를 만들어
다음 업데이트에서도 같은 항목으로 갱신됩니다.
"""
import datetime
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'fridge.json')
PAGES_JSON = 'https://csh3787.github.io/Hatu_fridge/data/fridge.json'
LOCATIONS = ('냉장', '냉동', '실온')
KST = datetime.timezone(datetime.timedelta(hours=9))


def stable_id(name, extra, prefix):
    seed = f'{name}|{extra}'.encode('utf-8')
    return prefix + hashlib.sha1(seed).hexdigest()[:10]


def fail(msg, errors):
    errors.append(msg)


def normalize(payload):
    errors = []
    out = {'inventory': [], 'meals': [], 'shopping': []}

    for i, it in enumerate(payload.get('inventory') or []):
        if not isinstance(it, dict) or not str(it.get('name') or '').strip():
            fail(f'inventory[{i}]: name 이 필요합니다', errors)
            continue
        name = str(it['name']).strip()
        exp = str(it.get('expiresAt') or '')
        if exp:
            try:
                datetime.date.fromisoformat(exp)
            except ValueError:
                fail(f'inventory[{i}] "{name}": expiresAt 은 YYYY-MM-DD 형식이어야 합니다 ({exp})', errors)
                continue
        loc = str(it.get('location') or '냉장')
        if loc not in LOCATIONS:
            fail(f'inventory[{i}] "{name}": location 은 냉장/냉동/실온 중 하나여야 합니다 ({loc})', errors)
            continue
        qty = it.get('qty', 1)
        try:
            qty = max(1, int(qty))
        except (TypeError, ValueError):
            fail(f'inventory[{i}] "{name}": qty 는 숫자여야 합니다', errors)
            continue
        out['inventory'].append({
            'id': str(it.get('id') or stable_id(name, exp, 'inv-')),
            'name': name,
            'amount': '' if it.get('amount') is None else str(it['amount']),
            'qty': qty,
            'location': loc,
            'expiresAt': exp,
            'addedAt': str(it.get('addedAt') or '')
        })

    for i, it in enumerate(payload.get('shopping') or []):
        if not isinstance(it, dict) or not str(it.get('name') or '').strip():
            fail(f'shopping[{i}]: name 이 필요합니다', errors)
            continue
        name = str(it['name']).strip()
        out['shopping'].append({
            'id': str(it.get('id') or stable_id(name, '', 'shop-')),
            'name': name,
            'from': str(it.get('from') or '삐클이'),
            'done': bool(it.get('done')),
            'addedAt': str(it.get('addedAt') or '')
        })

    for i, m in enumerate(payload.get('meals') or []):
        if not isinstance(m, dict):
            fail(f'meals[{i}]: 객체여야 합니다', errors)
            continue
        ing = [g for g in (m.get('ing') or []) if isinstance(g, dict) and str(g.get('name') or '').strip()]
        if not ing:
            fail(f'meals[{i}]: ing(재료)가 비어 있습니다', errors)
            continue
        out['meals'].append({
            'day': str(m.get('day') or ''),
            'emo': str(m.get('emo') or '🍽️'),
            'kids': str(m.get('kids') or m.get('adult') or ''),
            'adult': str(m.get('adult') or m.get('kids') or ''),
            'ing': [{'key': str(g.get('key') or g['name']), 'name': str(g['name']).strip()} for g in ing],
            'time': str(m.get('time') or ''),
            'steps': [str(s) for s in (m.get('steps') or [])],
            'tip': str(m.get('tip') or '')
        })

    if payload.get('inventory') is not None and not isinstance(payload.get('inventory'), list):
        fail('inventory 는 배열이어야 합니다', errors)
    if payload.get('shopping') is not None and not isinstance(payload.get('shopping'), list):
        fail('shopping 는 배열이어야 합니다', errors)
    if payload.get('meals') is not None and not isinstance(payload.get('meals'), list):
        fail('meals 는 배열이어야 합니다', errors)
    return out, errors


def run(cmd):
    return subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry-run' in sys.argv
    if len(args) != 1:
        print(__doc__)
        return 2
    payload = json.load(open(args[0], encoding='utf-8'))

    # 페이로드에서 빠진 섹션은 기존 파일 내용을 그대로 유지합니다(실수로 지우는 일 방지).
    current = {}
    if os.path.exists(DATA):
        try:
            current = json.load(open(DATA, encoding='utf-8'))
        except Exception:
            current = {}
    for key in ('inventory', 'shopping', 'meals'):
        if key not in payload:
            payload[key] = current.get(key, [])
            print(f'  · {key}: 페이로드에 없어 기존 데이터 {len(payload[key])}개 유지')

    data, errors = normalize(payload)
    if errors:
        print('검증 실패:')
        for e in errors:
            print('  -', e)
        return 1

    now = datetime.datetime.now(KST).replace(microsecond=0)
    stamp = now.isoformat()
    for it in data['inventory']:
        it['addedAt'] = it['addedAt'] or stamp
    for it in data['shopping']:
        it['addedAt'] = it['addedAt'] or stamp
    data['updatedAt'] = stamp
    body = json.dumps(data, ensure_ascii=False, indent=2)

    print(f"재고 {len(data['inventory'])}종 · 장보기 {len(data['shopping'])}개 · 식단 {len(data['meals'])}개  (updatedAt {stamp})")
    if dry:
        print(body)
        print('\n--dry-run: 파일을 바꾸지 않았습니다.')
        return 0

    open(DATA, 'w', encoding='utf-8').write(body + '\n')
    msg = f"냉장고 데이터 업데이트 — 재고 {len(data['inventory'])}종 · 장보기 {len(data['shopping'])}개 · 식단 {len(data['meals'])}개"
    for cmd in (['git', 'add', 'data/fridge.json'],
                ['git', 'commit', '-m', msg],
                ['git', 'push', 'origin', 'main']):
        r = run(cmd)
        if r.returncode != 0:
            print('실패:', ' '.join(cmd))
            print(r.stdout, r.stderr)
            return 1

    print('푸시 완료. 배포 확인 중...')
    for _ in range(20):
        time.sleep(15)
        b = run(['gh', 'api', 'repos/csh3787/Hatu_fridge/pages/builds/latest', '--jq', '.status'])
        status = (b.stdout or '').strip()
        if status == 'built':
            break
    else:
        print('배포 상태를 확인하지 못했습니다. Pages 빌드를 나중에 확인해 주세요.')
        return 1

    for _ in range(12):
        try:
            with urllib.request.urlopen(PAGES_JSON + '?t=' + str(int(time.time())), timeout=15) as res:
                live = json.loads(res.read().decode('utf-8'))
            if live.get('updatedAt') == stamp:
                print('배포 확인 완료 — 라이브 data/fridge.json 이 방금 올린 데이터입니다.')
                return 0
        except Exception:
            pass
        time.sleep(10)
    print('배포는 끝났지만 라이브 파일이 아직 예전 버전입니다(캐시). 몇 분 뒤 다시 확인해 주세요.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
