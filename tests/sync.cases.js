/* StorageAdapter 원격 동기화 동작 검증 (하네스 공용 케이스)
   인자: StorageAdapter, normalizeMeals, ok(cond,label,extra), setRemote(obj), setFetchMode(mode) */
module.exports = async function runCases(StorageAdapter, normalizeMeals, ok, setRemote, setFetchMode){
  const ids = l => l.map(x => x.id);
  // 원격 파일 시각은 '지금'을 기준으로 만듭니다 (실제 삐클이 업로드 시각과 같은 성격).
  const T = ms => new Date(Date.now() + ms).toISOString();
  const MIN = 60000;
  const R1 = T(-30 * MIN), R2 = T(-20 * MIN), R3 = T(-10 * MIN), R4 = T(-2 * MIN);
  const R5 = T(-30 * 1000), R6 = T(-10 * 1000), R7 = T(0), R8 = T(+10 * MIN);

  console.log('[1] 첫 실행: 원격 데이터를 로컬로 가져오기');
  setRemote({
    updatedAt: R1,
    inventory: [
      { id: 'inv1', name: '서울우유', amount: '900ml', qty: 2, location: '냉장', expiresAt: '2026-11-24' },
      { name: '대파', qty: 1, location: '냉장', expiresAt: '2026-11-25' }
    ],
    meals: [{ emo: '🍚', day: '월', kids: '김치볶음밥', adult: '된장찌개', ing: [{ key: '김치', name: '김치' }], time: '20분', steps: ['볶기'], tip: '약불' }],
    shopping: [{ id: 'sh1', name: '계란', from: '삐클이', done: false }]
  });
  let s = await StorageAdapter.load();
  ok(s.inventory.length === 2, '재고 2종 반영', ids(s.inventory));
  ok(s.inventory.find(x => x.id === 'inv1').qty === 2, '원격 수량 유지');
  ok(s.shopping.length === 1 && s.shopping[0].id === 'sh1', '장보기 반영');
  ok(s.meals.length === 1, '식단 반영');
  ok(s.lastSyncedAt === R1, 'lastSyncedAt 기록', s.lastSyncedAt);
  const noId = s.inventory.find(x => !x.id.startsWith('inv'));
  ok(!!noId && /^ri/.test(noId.id), 'id 없는 항목에 고정 id 부여', noId && noId.id);
  const noIdKey = noId.id;

  console.log('[2] 같은 원격을 다시 열어도 중복 없음 + 사용자가 고친 수량 유지');
  await StorageAdapter.setQty('inv1', 5);
  await StorageAdapter.syncFromRemote();
  s = await StorageAdapter.load();
  ok(s.inventory.length === 2, '중복 생성 없음', ids(s.inventory));
  ok(s.inventory.find(x => x.id === 'inv1').qty === 5, '직접 고친 수량 5 유지', s.inventory.find(x => x.id === 'inv1'));
  ok(s.inventory.some(x => x.id === noIdKey), 'id 없는 항목도 같은 id 유지');

  console.log('[3] 원격이 새 버전: 새 항목 추가 + 로컬 전용 항목 유지');
  await StorageAdapter.saveInventory([].concat(s.inventory, [
    { id: 'loc1', name: '집에서 추가한 두부', amount: '', qty: 1, location: '냉장', expiresAt: '2026-11-20', addedAt: new Date().toISOString() }
  ]));
  setRemote({
    updatedAt: R2,
    inventory: [
      { id: 'inv1', name: '서울우유', amount: '900ml', qty: 1, location: '냉장', expiresAt: '2026-11-24' },
      { id: 'inv2', name: '애호박', qty: 2, location: '냉장', expiresAt: '2026-11-22' }
    ],
    meals: [],
    shopping: [{ id: 'sh1', name: '계란', from: '삐클이', done: false }, { id: 'sh2', name: '두부', from: '삐클이', done: false }]
  });
  await StorageAdapter.syncFromRemote();
  s = await StorageAdapter.load();
  ok(ids(s.inventory).includes('inv2'), '새 원격 항목 inv2 추가', ids(s.inventory));
  ok(ids(s.inventory).includes('loc1'), '로컬 전용 loc1 유지', ids(s.inventory));
  ok((s.inventory.find(x => x.id === 'inv1') || {}).qty === 5, '직접 고친 inv1 수량 5 유지');
  ok(s.shopping.length === 2, '장보기 sh2 추가', ids(s.shopping));
  ok(s.meals.length === 0, '원격 meals(빈 배열) 반영');

  console.log('[4] 사용자가 지운 항목은 원격에 다시 나타나도 되살아나지 않음');
  await StorageAdapter.removeItem('inv2');
  setRemote({
    updatedAt: R3,
    inventory: [
      { id: 'inv1', name: '서울우유', amount: '900ml', qty: 1, location: '냉장', expiresAt: '2026-11-24' },
      { id: 'inv2', name: '애호박', qty: 2, location: '냉장', expiresAt: '2026-11-22' }
    ],
    meals: [],
    shopping: [{ id: 'sh1', name: '계란', from: '삐클이', done: false }]
  });
  await StorageAdapter.syncFromRemote();
  s = await StorageAdapter.load();
  ok(!ids(s.inventory).includes('inv2'), '지운 inv2 부활 없음', ids(s.inventory));
  ok(ids(s.inventory).includes('loc1'), 'loc1 그대로');
  ok(s.deletedIds.inventory.includes('inv2'), '삭제 기록 유지', s.deletedIds.inventory);
  ok(s.lastSyncedAt === R3, 'lastSyncedAt 갱신', s.lastSyncedAt);

  console.log('[5] 장보기 체크 상태는 원격 재동기화에도 유지');
  await StorageAdapter.saveShopping(s.shopping.map(x => x.id === 'sh1' ? Object.assign({}, x, { done: true }) : x));
  setRemote({
    updatedAt: R4,
    inventory: [],
    meals: [],
    shopping: [{ id: 'sh1', name: '계란', from: '삐클이', done: false }]
  });
  await StorageAdapter.syncFromRemote();
  s = await StorageAdapter.load();
  ok(s.shopping.find(x => x.id === 'sh1').done === true, '체크한 sh1 유지', s.shopping.find(x => x.id === 'sh1'));

  console.log('[6] 원격에서 빠진 항목은 냉장고에서도 빠짐 (방금 손댄 항목은 유지)');
  setRemote({
    updatedAt: R5,
    inventory: [{ id: 'inv7', name: '사과', qty: 1, location: '냉장', expiresAt: '2026-11-28' }],
    meals: [],
    shopping: [{ id: 'sh1', name: '계란', from: '삐클이', done: false }]
  });
  await StorageAdapter.syncFromRemote();
  s = await StorageAdapter.load();
  ok(ids(s.inventory).includes('inv7'), '원격 항목 inv7 추가', ids(s.inventory));

  await StorageAdapter.setQty('inv7', 4);            // 세화가 방금 직접 고침
  setRemote({
    updatedAt: R6,
    inventory: [{ id: 'inv8', name: '두부', qty: 1, location: '냉장', expiresAt: '2026-11-20' }],
    meals: [],
    shopping: [{ id: 'sh9', name: '우유', from: '삐클이', done: false }]
  });
  await StorageAdapter.syncFromRemote();
  s = await StorageAdapter.load();
  ok(ids(s.inventory).includes('inv7'), '방금 고친 inv7 은 남김', ids(s.inventory));
  ok(ids(s.inventory).includes('inv8'), '새 원격 항목 inv8 추가', ids(s.inventory));
  ok(ids(s.inventory).includes('inv1') && ids(s.inventory).includes('loc1'), '로컬/inv1 유지', ids(s.inventory));
  ok(ids(s.shopping).includes('sh9'), '장보기 sh9 추가', ids(s.shopping));

  setRemote({
    updatedAt: R7,
    inventory: [],
    meals: [],
    shopping: []
  });
  await StorageAdapter.syncFromRemote();
  s = await StorageAdapter.load();
  ok(!ids(s.inventory).includes('inv8'), '원격에서 빠진 inv8 제거', ids(s.inventory));
  ok(!ids(s.shopping).includes('sh9'), '원격에서 빠진 sh9 제거', ids(s.shopping));
  ok(ids(s.inventory).includes('loc1'), '로컬 전용 loc1 은 그대로', ids(s.inventory));
  ok(ids(s.inventory).includes('inv7'), '직접 고친 inv7 은 그대로', ids(s.inventory));

  console.log('[7] 오프라인/404 에서도 기존 동작 그대로');
  const before = JSON.parse(JSON.stringify(await StorageAdapter.load()));
  setFetchMode('throw');
  await StorageAdapter.syncFromRemote();
  let after = await StorageAdapter.load();
  ok(after.inventory.length === before.inventory.length, '오프라인: 재고 그대로', after.inventory.length);
  setFetchMode('404');
  await StorageAdapter.syncFromRemote();
  after = await StorageAdapter.load();
  ok(after.inventory.length === before.inventory.length, '404(HTML 응답)에도 그대로');
  setFetchMode('ok');

  console.log('[8] 깨진 원격 데이터(updatedAt 없음)는 무시');
  const keep = JSON.parse(JSON.stringify(await StorageAdapter.load()));
  setRemote({ inventory: [{ id: 'ghost', name: '유령' }] });
  await StorageAdapter.syncFromRemote();
  s = await StorageAdapter.load();
  ok(!ids(s.inventory).includes('ghost') && s.inventory.length === keep.inventory.length, 'updatedAt 없는 원격 무시');

  console.log('[9] normalizeMeals: 빈/깨진 식단 안전 처리');
  ok(normalizeMeals(undefined).length === 0, 'undefined → []');
  ok(normalizeMeals([{ kids: '밥' }]).length === 0, '재료 없는 식단 제외');
  ok(normalizeMeals([{ kids: '밥', ing: [{ name: '쌀' }] }])[0].ing[0].key === '쌀', 'key 없으면 name 사용');

  console.log('[10] 로컬 수정보다 더 새로운 원격 값은 원격이 이김');
  setRemote({
    updatedAt: R8,
    inventory: [{ id: 'inv1', name: '서울우유', amount: '900ml', qty: 3, location: '냉장', expiresAt: '2026-11-26' }],
    meals: [],
    shopping: []
  });
  await StorageAdapter.syncFromRemote();
  s = await StorageAdapter.load();
  ok((s.inventory.find(x => x.id === 'inv1') || {}).qty === 3, '원격 수량 3 반영', s.inventory.find(x => x.id === 'inv1'));
  ok(ids(s.inventory).includes('loc1'), '로컬 전용 loc1 은 여전히 유지', ids(s.inventory));
};
