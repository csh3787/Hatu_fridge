// StorageAdapter 원격 동기화 로직 테스트 (index.html 의 실제 코드를 그대로 떼어내 실행)
const fs = require('fs');

const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
function extract(startMarker, endMarker){
  const i = html.indexOf(startMarker);
  if(i < 0) throw new Error('start not found: ' + startMarker);
  const j = html.indexOf(endMarker, i);
  if(j < 0) throw new Error('end not found: ' + endMarker);
  return html.slice(i, j + endMarker.length);
}
const adapterSrc = extract('const StorageAdapter = (() => {', '\n})();');
const mealsSrc = extract('function normalizeMeals(list){', '\n}\n');

let store = {};
let remote = null;
let fetchCalls = 0;
let fetchMode = 'ok';

const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
function seedInventory(){ return []; }
function seedShopping(){ return []; }
const window = { addEventListener(){} };
async function fetchStub(url){
  fetchCalls++;
  if(fetchMode === 'throw') throw new Error('offline');
  if(fetchMode === '404') return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(remote)) };
}

const factory = new Function('localStorage','seedInventory','seedShopping','window','fetch',
  adapterSrc + '\n' + mealsSrc + '\nreturn { StorageAdapter, normalizeMeals };');
const { StorageAdapter, normalizeMeals } = factory(localStorage, seedInventory, seedShopping, window, fetchStub);

let pass = 0, fail = 0;
function ok(cond, label, extra){
  if(cond){ pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? ' → ' + JSON.stringify(extra) : '')); }
}
const ids = l => l.map(x => x.id);

(async () => {
  console.log('[1] 첫 실행: 원격 데이터를 로컬로 가져오기');
  remote = {
    updatedAt: '2026-11-17T23:30:00+09:00',
    inventory: [
      { id: 'inv1', name: '서울우유', amount: '900ml', qty: 2, location: '냉장', expiresAt: '2026-11-24' },
      { name: '대파', qty: 1, location: '냉장', expiresAt: '2026-11-25' }   // id 없음
    ],
    meals: [{ emo:'🍚', day:'월', kids:'김치볶음밥', adult:'된장찌개', ing:[{key:'김치',name:'김치'}], time:'20분', steps:['볶기'], tip:'약불' }],
    shopping: [{ id: 'sh1', name: '계란', from: '삐클이', done: false }]
  };
  let s = await StorageAdapter.load();
  ok(s.inventory.length === 2, '재고 2종 반영', ids(s.inventory));
  ok(s.inventory.find(x => x.id === 'inv1').qty === 2, '원격 수량 유지');
  ok(s.shopping.length === 1 && s.shopping[0].id === 'sh1', '장보기 반영');
  ok(s.meals.length === 1, '식단 반영');
  ok(s.lastSyncedAt === '2026-11-17T14:30:00.000Z', 'lastSyncedAt 기록', s.lastSyncedAt);
  const noId = s.inventory.find(x => !x.id.startsWith('inv'));
  ok(!!noId && /^ri/.test(noId.id), 'id 없는 항목에 고정 id 부여', noId && noId.id);
  const noIdKey = noId.id;

  console.log('[2] 같은 원격을 다시 열어도 중복·초기화 없음 + 사용자가 고친 수량 유지');
  await StorageAdapter.setQty('inv1', 5);
  await new Promise(r => setTimeout(r, 5));
  fetchCalls = 0;
  s = await StorageAdapter.load();   // 20초 스로틀에 걸릴 수 있으므로 강제 확인
  s = await StorageAdapter.syncFromRemote().then(() => StorageAdapter.load());
  ok(s.inventory.length === 2, '중복 생성 없음', ids(s.inventory));
  ok(s.inventory.find(x => x.id === 'inv1').qty === 5, '직접 고친 수량 5 유지', s.inventory.find(x => x.id === 'inv1'));
  ok(s.inventory.some(x => x.id === noIdKey), 'id 없는 항목도 같은 id 유지');

  console.log('[3] 원격이 새 버전: 새 항목 추가 + 로컬 전용 항목 유지');
  await StorageAdapter.saveInventory([...s.inventory, { id: 'loc1', name: '집에서 추가한 두부', amount: '', qty: 1, location: '냉장', expiresAt: '2026-11-20', addedAt: new Date().toISOString() }]);
  remote = {
    updatedAt: '2026-11-17T23:45:00+09:00',
    inventory: [
      { id: 'inv1', name: '서울우유', amount: '900ml', qty: 1, location: '냉장', expiresAt: '2026-11-24' },
      { id: 'inv2', name: '애호박', qty: 2, location: '냉장', expiresAt: '2026-11-22' }
    ],
    meals: [],
    shopping: [{ id: 'sh1', name: '계란', from: '삐클이', done: false }, { id: 'sh2', name: '두부', from: '삐클이', done: false }]
  };
  await StorageAdapter.syncFromRemote();
  s = await StorageAdapter.load();
  ok(ids(s.inventory).includes('inv2'), '새 원격 항목 inv2 추가', ids(s.inventory));
  ok(ids(s.inventory).includes('loc1'), '로컬 전용 loc1 유지', ids(s.inventory));
  ok((s.inventory.find(x => x.id === 'inv1') || {}).qty === 5, '직접 고친 inv1 수량 5 유지');
  ok(s.shopping.length === 2, '장보기 sh2 추가', ids(s.shopping));
  ok(s.meals.length === 0, '원격 meals(빈 배열) 반영');

  console.log('[4] 사용자가 지운 항목은 원격에 다시 나타나도 되살아나지 않음');
  await StorageAdapter.removeItem('inv2');
  remote.updatedAt = '2026-11-18T00:10:00+09:00';
  await StorageAdapter.syncFromRemote();
  s = await StorageAdapter.load();
  ok(!ids(s.inventory).includes('inv2'), '지운 inv2 부활 없음', ids(s.inventory));
  ok(ids(s.inventory).includes('loc1'), 'loc1 그대로');
  ok(s.deletedIds.inventory.includes('inv2'), '삭제 기록 유지', s.deletedIds.inventory);
  ok(s.lastSyncedAt === '2026-11-17T15:10:00.000Z', 'lastSyncedAt 갱신', s.lastSyncedAt);

  console.log('[5] 장보기 체크 상태는 원격 재동기화에도 유지');
  const shop = s.shopping.map(x => x.id === 'sh1' ? { ...x, done: true } : x);
  await StorageAdapter.saveShopping(shop);
  remote.updatedAt = '2026-11-18T00:20:00+09:00';
  await StorageAdapter.syncFromRemote();
  s = await StorageAdapter.load();
  ok(s.shopping.find(x => x.id === 'sh1').done === true, '체크한 sh1 유지', s.shopping.find(x => x.id === 'sh1'));

  console.log('[6] 오프라인/404 에서도 기존 동작 그대로');
  const before = JSON.parse(JSON.stringify(await StorageAdapter.load()));
  fetchMode = 'throw';
  await StorageAdapter.syncFromRemote();
  let after = await StorageAdapter.load();
  ok(after.inventory.length === before.inventory.length, '오프라인: 재고 그대로', after.inventory.length);
  fetchMode = '404';
  await StorageAdapter.syncFromRemote();
  after = await StorageAdapter.load();
  ok(after.inventory.length === before.inventory.length, '404(HTML 응답)에도 그대로');
  fetchMode = 'ok';
  ok(true, '예외 없이 통과');

  console.log('[7] 깨진 원격 데이터(updatedAt 없음)는 무시');
  const keep = JSON.parse(JSON.stringify(await StorageAdapter.load()));
  remote = { inventory: [{ id: 'x', name: '유령' }] };
  await StorageAdapter.syncFromRemote();
  s = await StorageAdapter.load();
  ok(!ids(s.inventory).includes('x') && s.inventory.length === keep.inventory.length, 'updatedAt 없는 원격 무시');

  console.log('[8] normalizeMeals: 빈/깨진 식단 안전 처리');
  ok(normalizeMeals(undefined).length === 0, 'undefined → []');
  ok(normalizeMeals([{ kids: '밥' }]).length === 0, '재료 없는 식단 제외');
  ok(normalizeMeals([{ kids: '밥', ing: [{ name: '쌀' }] }])[0].ing[0].key === '쌀', 'key 없으면 name 사용');

  console.log('\n결과: ' + pass + ' 통과 / ' + fail + ' 실패');
  process.exit(fail ? 1 : 0);
})();
