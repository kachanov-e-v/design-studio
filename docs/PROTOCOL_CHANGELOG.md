# Журнал изменений протокола preview

## Назначение и политика версионирования

Этот файл фиксирует историю версий `postMessage`-протокола между webview расширения и runtime, инжектированным в страницу preview.

- Константа `PROTOCOL_VERSION` живёт в `packages/preview-runtime/src/protocol.ts` и повышается при **каждом** новом типе сообщения или изменении полей существующих сообщений.
- Валидатор `isRuntimeMessage` требует **строгого равенства** версии (`version === PROTOCOL_VERSION`): сообщения другой версии отбрасываются обеими сторонами. Поэтому runtime-бандл и webview должны поставляться вместе — пиры с разными версиями отвергают сообщения друг друга (webview показывает статус «protocol-mismatch», ping с чужой версией не создаёт сессию).
- Каждое повышение версии получает запись в этом журнале. Текущая версия — **«9»**.

## История версий

### v1 — коммит `8470a73` (2026-11-14)

Первое введение версионированного протокола (`PROTOCOL_VERSION = "1"`).

### v2–v5

Версии существовали между коммитами `8470a73` и `227bac7`, но их точные дельты по истории репозитория не восстановлены.

### v6 — базовая линия на коммите `227bac7`

16 типов сообщений: `ds:runtime-ready`, `ds:ping`, `ds:pong`, `ds:set-mode`, `ds:mode-changed`, `ds:select`, `ds:apply-style`, `ds:style-applied`, `ds:apply-op`, `ds:op-applied`, `ds:navigate`, `ds:navigate-history`, `ds:navigate-blocked`, `ds:reload`, `ds:rect`, `ds:runtime-error`.

### v7 — промежуточная, вышла вместе с v8 в коммите `05f9b0d` (2026-11-17)

Добавлен `ds:mark` — визуальный бейдж для элементов с несинхронизированными правками/комментарием в режиме редактирования. Поля: `selector` (непустой, ≤500), `marked` (boolean). Отдельным коммитом v7 не фиксировалась.

### v8 — коммит `05f9b0d` (2026-11-17)

Добавлены `ds:undo` / `ds:undone` — откат структурных операций (`delete`, `duplicate`, `move-up`, `move-down`) по `requestId`: runtime восстанавливает DOM-снимок, сделанный до операции. Число хранимых снимков ограничено 50 (при переполнении вытесняется самый старый). Ответ `ds:undone` несёт `success`, опциональные `reason` и `payload` (обновлённый `ElementPayload` восстановленного элемента либо `null`).

### v9 — текущая (2026-11-18, IMP-A: переживание правок)

Добавлены `ds:replay` / `ds:replayed` — идемпотентное повторное применение правок по селектору, без выбора элемента и без бейджей:

- `ds:replay` (webview → runtime): `edits` — массив ≤200 записей `ReplayEdit`: `kind` (`style` | `text` | `classes` | `attribute`), `selector` (1–500), `property` (обязателен для `style` — по паттерну CSS-свойства, и для `attribute` — из whitelist `EDITABLE_ATTRIBUTES`; для `text`/`classes` отсутствует), `value` ≤5000, опциональный `forget` (boolean).
- Семантика `forget: true` — «применить и забыть»: запись удаляется из reapply-реестра runtime даже при неудачном применении (используется для отмены правки значением `before`; пустое `value` у `style` снимает inline-свойство). Обычный replay регистрирует правку в реестре (LRU ≤200), и MutationObserver (debounce 100 мс) переустанавливает «уплывшие» значения после ререндера/HMR.
- `ds:replayed` (runtime → webview): `applied` и `skipped` — неотрицательные целые (счётчики успешно применённых и пропущенных записей), опциональный `sessionId`. Один ответ на весь батч.

Replay не требует выбранного элемента; невалидный селектор или элемент вне `body`/запрещённый к выбору — запись пропускается (`skipped`). Структурные операции и комментарии через `ds:replay` не передаются (структура откатывается снимками `ds:undo`, комментарий живёт только в журнале webview).

## Каталог сообщений v9 (21 тип)

Направления проверены по `packages/preview-runtime/src/index.ts` и `webview/components/PreviewContainer.tsx`.

### Webview → runtime (9)

| Тип | Назначение | Ключевые поля и лимиты |
| --- | --- | --- |
| `ds:ping` | Handshake: установка сессии и проверка версии | `nonce` обязателен (1–128; webview использует sessionId как nonce) |
| `ds:set-mode` | Включить/выключить режим редактирования | `enabled` (boolean); runtime отвечает эхом `ds:mode-changed` |
| `ds:apply-style` | Применить CSS-свойство к выбранному элементу | `property` (по паттерну), `value` ≤500, `requestId` ≤128, `selectors` ≤20×500 |
| `ds:apply-op` | Структурная/контентная операция | `op` из whitelist (`set-text`, `delete`, `duplicate`, `move-up`, `move-down`, `set-classes`, `set-attribute`); `value` ≤5000; для `set-attribute` — `attribute` из whitelist и `value` ≤2000 |
| `ds:navigate-history` | Назад/вперёд по истории страницы | `direction`: `back` \| `forward` |
| `ds:reload` | Перезагрузить страницу preview | — |
| `ds:mark` | Бейдж «есть правки/комментарий» на элементе | `selector` (1–500), `marked` (boolean) |
| `ds:undo` | Откатить операцию по снимку | `requestId` (1–128) |
| `ds:replay` | Идемпотентно применить журнал правок по селекторам | `edits` ≤200 × `ReplayEdit` (`kind`, `selector` 1–500, `property?`, `value` ≤5000, `forget?`) |

### Runtime → webview (12)

| Тип | Назначение | Ключевые поля и лимиты |
| --- | --- | --- |
| `ds:runtime-ready` | Ранний анонс при инициализации runtime | `nonce` **опционален** (сообщение может уйти до первого ping'а, без nonce) |
| `ds:pong` | Ответ на ping, эхо nonce | `nonce` обязателен (1–128); несёт версию runtime даже при несовпадении |
| `ds:mode-changed` | Эхо принятого режима (ack для `ds:set-mode`) | `enabled` (boolean) |
| `ds:select` | Выбранный элемент | `payload` — `ElementPayload` (лимиты ниже) |
| `ds:style-applied` | Результат применения стиля | `success`, `reason` ≤500, `payload`, `requestId` |
| `ds:op-applied` | Результат операции | `success`, `reason` ≤500, `payload` (допускается `null`), `requestId` |
| `ds:navigate` | Текущий путь страницы (обновление адресной строки webview) | `path` ≤4000, начинается с `/`; шлётся при popstate/hashchange и смене режима |
| `ds:navigate-blocked` | Клик по ссылке, небезопасной для навигации в preview | `url` (1–2048) |
| `ds:undone` | Результат отката | `requestId`, `success`, `reason` ≤500, `payload` \| `null` |
| `ds:replayed` | Итог replay-батча | `applied`, `skipped` — неотрицательные целые |
| `ds:rect` | Свежий rect выбранного элемента (скролл/resize) | конечные числа `top/left/width/height` |
| `ds:runtime-error` | Диагностика ошибки runtime | `message` ≤500 |

Примечание о навигации: `ds:navigate` ходит **только** runtime → webview (уведомление о смене пути). Навигацию, инициированную webview, выполняет смена URL iframe, а не сообщение `ds:navigate`; runtime входящий `ds:navigate` не обрабатывает.

## Общий конверт и лимиты

Каждое сообщение несёт:

- `type` — один из 21 типа выше (whitelist `RUNTIME_TYPES`);
- `version` — строго `"9"` (строгое равенство, не сравнение «не ниже»);
- `sessionId` — опционален, ≤128; после установки сессии сообщения с чужим `sessionId` отбрасываются;
- `nonce` — только у `ds:ping`/`ds:pong` (обязателен, 1–128) и опционально у `ds:runtime-ready`;
- `requestId` — опционален там, где есть (1–128), связывает запрос и ack.

Ключевые лимиты полей:

- значение стиля (`ds:apply-style.value`) — ≤500;
- значение операции (`ds:apply-op.value`) — ≤5000; для `set-attribute` — ≤2000;
- селекторы (`selectors`) — массив ≤20 штук, каждый 1–500;
- `ds:mark.selector` — 1–500; `ds:navigate.path` — ≤4000 и только абсолютный путь; `ds:navigate-blocked.url` — 1–2048;
- `ds:replay.edits` — ≤200 записей; `selector` 1–500, `value` ≤5000; reapply-реестр runtime — LRU ≤200;
- `reason`/`message` — ≤500.

Лимиты `ElementPayload` (`isElementPayload`): `selector` 1–500, `selectors` ≤20×500, `tag` ≤64, конечный `rect` (неотрицательные ширина/высота), `styles` — не больше числа свойств в `STYLE_PROPS`, ключи ≤64 и значения ≤500; `text` ≤2000; `classes` ≤30×100 (токены без пробелов, кавычек, угловых скобок и обратного слеша); `attributes` — только whitelist `EDITABLE_ATTRIBUTES`, значения ≤2000; `rules` ≤8 (`href`/`selectorText` ≤2000, `cssText` ≤3000); `component` ≤6 записей.

## Дорожная карта

Планы по развитию протокола и смежных подсистем (включая CSP-preserving инжекцию runtime, эпик IMP-B) — в [IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md).