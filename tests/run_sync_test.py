#!/usr/bin/env python3
"""index.html 의 StorageAdapter 코드를 그대로 떼어내 QuickJS 로 동기화 로직을 검증합니다.
node 가 없는 환경에서도 동작합니다:  python3 tests/run_sync_test.py
"""
import json
import os
import sys

import quickjs

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()


def extract(start, end):
    i = html.index(start)
    j = html.index(end, i)
    return html[i:j + len(end)]


adapter = extract('const StorageAdapter = (() => {', '\n})();')
meals = extract('function normalizeMeals(list){', '\n}\n')

prelude = r"""
var __log = [];
var __console = { log: function(m){ __log.push(String(m)); } };
var store = {};
var localStorage = {
  getItem: function(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function(k, v){ store[k] = String(v); },
  removeItem: function(k){ delete store[k]; }
};
function seedInventory(){ return []; }
function seedShopping(){ return []; }
var window = { addEventListener: function(){} };
var __remote = null;
var __fetchMode = 'ok';
function setRemote(o){ __remote = o; }
function setFetchMode(m){ __fetchMode = m; }
async function fetch(url){
  if(__fetchMode === 'throw') throw new Error('offline');
  if(__fetchMode === '404') return { ok: false, status: 404, json: async function(){ return {}; } };
  return { ok: true, status: 200, json: async function(){ return JSON.parse(JSON.stringify(__remote)); } };
}
"""

body = prelude + adapter + '\n' + meals + r"""
var __pass = 0, __fail = 0, __lines = [];
function ok(cond, label, extra){
  if(cond){ __pass++; __lines.push('  OK  ' + label); }
  else { __fail++; __lines.push('  FAIL ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}
function consoleLogShim(){}

var __done = false, __result = null, __error = null;
runCases(StorageAdapter, normalizeMeals, ok, setRemote, setFetchMode)
  .then(function(){ __done = true; })
  .catch(function(e){ __done = true; __error = String(e && e.stack || e); });
"""

cases = open(os.path.join(HERE, 'sync.cases.js'), encoding='utf-8').read()
# node 스타일 module.exports 를 브라우저/Eval 용 함수 선언으로 바꿔줍니다.
cases = cases.replace('module.exports = async function runCases(', 'async function runCases(', 1)

ctx = quickjs.Context()
ctx.eval('var console = { log: function(m){ __lines.push(String(m)); } };')
ctx.eval(cases)
ctx.eval(body)

def peek():
    return ctx.eval('__done'), ctx.eval('__error')

for _ in range(20000):
    done, err = peek()
    if done:
        break
    ctx.execute_pending_job()

done, err = peek()
state = (done, err)
if not state[0]:
    print('테스트가 끝나지 않았습니다 (job queue 정체)')
    sys.exit(2)
if state[1]:
    print('예외:', state[1])
    sys.exit(2)

lines = ctx.eval('__lines.join("\\n")')
p_ok, p_fail = ctx.eval('__pass'), ctx.eval('__fail')
print(lines)
print('\n결과: %d 통과 / %d 실패' % (p_ok, p_fail))
sys.exit(1 if p_fail else 0)
