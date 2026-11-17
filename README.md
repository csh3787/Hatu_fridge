# Hatu_fridge

하투 냉장고 — 세화·도현 부부가 같이 쓰는 우리 집 냉장고 웹앱 (GitHub Pages).
https://csh3787.github.io/Hatu_fridge/

## 원격 데이터 (`data/fridge.json`)

앱은 열릴 때(그리고 화면으로 돌아올 때) `data/fridge.json` 을 먼저 확인해서,
`updatedAt` 이 로컬의 `lastSyncedAt` 보다 새로우면 원격 내용을 로컬에 합쳐 보여줍니다.
원격 확인이 실패하면 조용히 `localStorage` 만 사용합니다.

```json
{
  "updatedAt": "2026-11-17T23:30:00+09:00",
  "inventory": [
    { "id": "inv-20261117-01", "name": "서울우유", "amount": "900ml", "qty": 1,
      "location": "냉장", "expiresAt": "2026-11-24", "addedAt": "2026-11-17T23:30:00+09:00" }
  ],
  "meals": [],
  "shopping": [
    { "id": "shop-20261117-01", "name": "대파", "from": "삐클이", "done": false,
      "addedAt": "2026-11-17T23:30:00+09:00" }
  ]
}
```

- `location` 은 `냉장` / `냉동` / `실온` 중 하나, `expiresAt` 은 `YYYY-MM-DD`.
- `id` 는 항목마다 고정으로 씁니다. 같은 `id` 는 갱신, 없는 `id` 는 새로 추가로 처리됩니다.
- `meals` 는 7개(월~일) 배열이며 각 항목은 `{ emo, day, kids, adult, ing:[{key,name}], time, steps:[], tip }` 형태입니다.
- 세화가 앱에서 직접 고친 수량·추가한 항목·지운 항목은 원격을 다시 불러와도 유지됩니다.

## 데이터 올리기

```bash
python3 tools/upload_fridge.py payload.json            # 검증 → 커밋 → 푸시 → 배포 확인까지
python3 tools/upload_fridge.py payload.json --dry-run   # 검증만
```

`payload.json` 에는 `inventory` / `shopping` / `meals` 만 담으면 `updatedAt` 은 스크립트가
지금(한국시간)으로 찍습니다. 항목 `id` 가 없으면 이름·유통기한으로 고정 id 를 만들어
다음 업데이트에서도 같은 항목으로 갱신됩니다.

## 테스트

```bash
python3 tests/run_sync_test.py   # 원격 동기화 병합 로직 검증 (node 불필요, quickjs 사용)
```
