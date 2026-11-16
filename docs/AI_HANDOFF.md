# AI HANDOFF

Дата: сессия после базового аудита (см. `docs/IMPLEMENTATION_PLAN.md`).

## Выполнено

### EPIC A — аудит и план
- `docs/IMPLEMENTATION_PLAN.md`: event flow, корневые причины RC1–RC6 с путями, baseline команд (все зелёные), риски, тестовая матрица.

### EPIC B/C — политика ссылок и режимы
- Протокол повышен до `PROTOCOL_VERSION = "3"`, добавлено сообщение `ds:navigate-blocked` (типизировано, валидируется: url ≤ 2048, sessionId, ограничения длины).
- Runtime (`packages/preview-runtime/src/index.ts`, browse-click handler): единая политика ссылок:
  - same-origin маршруты upstream навигируются внутри preview-хоста (`location.assign(path+search+hash)`);
  - внешние origin и `target="_blank"/_parent/_top` блокируются с уведомлением через `ds:navigate-blocked`;
  - опасные схемы (`javascript:`, `data:`, `vbscript:`, `blob:`, `about:`) блокируются — ранее исполнялись;
  - `mailto:`/`tel:` и `download`-ссылки остаются нативными.
  Это закрыло исходную проблему: клик по ссылке с изменённым в инспекторе `href` больше не выводит iframe из предпросмотра и не исполняет произвольный код.
- Webview: `PreviewContainer` пересылает `ds:navigate-blocked` → `App.handleNavigateBlocked` → статус с URL.
- Edit mode: первый клик выбирает любой элемент без активации (capture `pointerdown`+`click`, `preventDefault`+`stopImmediatePropagation`); Alt-требование удалено.
- Подписи: «Просмотр» / «Редактировать», подсказка «Кликните по элементу. Действия страницы отключены.» и статус просмотра; README, ARCHITECTURE, DEVELOPMENT_GUIDE, TROUBLESHOOTING синхронизированы (Alt+клик удалён, политика ссылок задокументирована).

### EPIC D — типизированный инспектор
- `webview/components/propertyRegistry.ts`: сериализуемые PropertyDefinition (CSS: select/color/number+unit/slider/textarea/text) и AttributeDefinition по тегам; только данные, без функций (окружение postMessage).
- Inspector: контролы по registry с draft/apply/cancel (Enter/Escape/blur; color и slider применяются сразу), классы как чипы с удалением отдельных классов и добавлением, атрибуты по тегу из whitelist протокола; при пустом наборе атрибутов секция не рендерится.
- Протокол `PROTOCOL_VERSION = "4"`: `EDITABLE_ATTRIBUTES` расширен (value, required, disabled, readonly, checked, multiple, for, target, rel, loading, action, method, autocomplete, min/max/step, minlength/maxlength, rows/cols, id, role, tabindex, muted/controls/autoplay/loop, poster, novalidate, selected); пустое значение `set-attribute` удаляет атрибут; runtime блокирует `javascript:`/`vbscript:` для `href`/`src` и зеркалирует `checked`/`disabled`/`readOnly`/`required`/`multiple`/`value` в live-свойства DOM.
- Инструкция: удаление атрибута формулируется «Атрибут удалён: name (было …)». README шаг 7 переписан (двойной клик больше не существует).

### EPIC F — security
- SSRF-гейт `src/infrastructure/preview/upstream-validation.ts`: единая проверка всех upstream — `handleProxy`, WebSocket `handleUpgrade`, sticky `setDevTarget`: только http/https, без userinfo-креденшелов, только loopback (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`, `::ffff:127.x.x.x`, `0.0.0.0`). Нормализация WHATWG отсекает десятичные/hex IPv4-обходы; 403 отдаётся до открытия сокета; DNS-имена, лишь «обычно» резолвящиеся в loopback (`localtest.me`), отклонены.
- Cross-origin 3xx `Location` и `x-action-redirect` переписываются в `/proxy/http/...` вместо сырого внешнего URL: браузер не покидает preview, каждый redirect hop перевалидируется (`redirect: manual`).
- `resolveProjectPath` канонический: `fs.realpath` корня и самого глубокого существующего предка; junction/symlink внутри workspace, ведущая наружу, — 403. Тест с junction (Windows) в `PreviewHostServer.test.ts`.
- `src/shared/url.ts`: `isLoopbackHostname` (диапазоны IPv4/IPv6/IPv4-mapped, поддомены `.localhost`), `isLocalhostUrl` отклоняет userinfo.
- Service worker review: не использует `caches`, scope ограничен preview origin; регистрация живёт на временном порту конкретной сессии. Явная unregister при закрытии панели не реализована — задокументированное ограничение в `docs/SECURITY.md`.
- Debug-лог `console.log("Design Studio runtime loaded")` удалён из runtime; `scripts/verify-build.js` переведён на стабильный маркер `initDesignStudioRuntime`.
- Документация: `docs/SECURITY.md` (SSRF-гейт, canonical jail, известные ограничения), `docs/TROUBLESHOOTING.md` (раздел про 403, удалён устаревший раздел про double-click).

### EPIC G — cleanup
- `docs/LEGACY_CLEANUP.md`: удалены мёртвые i18n-ключи (`inspector.applyClasses`, `inspector.customStyle`, `inspector.propertyPlaceholder`, `inspector.editable`, `inspector.noAttributes`, `floating.copySelected`) и неиспользуемая `isAllowedUrl`. Все 15 типов сообщений протокола и все компоненты webview подтверждены рабочими; Next.js-специфика, service worker, `candidateLoopbackTargets`, `targetFromReferer` задокументированы как действующие.

### EPIC H — регрессии после ручной проверки (текущая сессия)
- H1: `ds:set-mode` off теперь чистит `selectedElement` тоже (контур не «воскресает» при повторном входе); hover-контур усилен (2px, заливка 0.18). Проверить вручную: подсветка на hover в edit, отсутствие фокуса после выхода.
- H2: **серверный cookie jar** в `PreviewHostServer` (`rememberSetCookie`/`buildCookieHeader`) — cookies приложения живут в хосте, а не в браузере webview (кросс-сайтовый iframe → Cookie терялись → редирект на /login). Jar перекрывает браузерные cookies, чистится при смене dev target и по expiry. Тесты: jar переживает навигацию, expiry-удаление, очистка при смене target.
- H3: ошибка при создании элемента — наиболее вероятная причина та же, что H2 (Server Action без cookies). Перепроверить после пересборки; если не исчезнет — снять текст ошибки из канала «Design Studio Preview».
- H7 (регрессия подсветки): подсветка hover/selection была завязана на `requestAnimationFrame` внутри iframe приложения. В headless-воспроизведении (Chrome, iframe + throttled rAF) подтверждено: при замороженном rAF outline не отрисовывается. Исправление: курсорные пути (pointermove, sendSelection) позиционируют outline синхронно (`positionOutlinesNow`), rAF остался только для scroll/resize. Допустимая причина у пользователя: также устаревший webview без перезагрузки окна — обязателен полный reload Extension Development Host и пересоздание вкладки Design Studio. Воспроизведение описано в этом разделе (headless Chrome, iframe с троттлингом rAF).

- H8 (логин в новом проекте — РЕШЕНО, причина доказана экспериментально): пользователь сообщил, что в новом проекте не может пройти авторизацию (возврат на форму логина). Корневая причина (цепочка, все звенья воспроизведены live на реальном Next.js-проекте с dev-сервером на :3000):
  1. Дев-сервер Next 16 отклоняет кросс-доменные WS-апгрейды: апгрейд с `Origin`, не совпадающим с хостом (или `allowedDevOrigins`), отвечает `401 Unauthorized` (прямой зонд к :3000 — проверено).
  2. `PreviewHostServer.handleUpgrade` пересылал браузерный `Origin` (http://127.0.0.1:PORT) как есть → апгрейд всегда отклонялся, relay молча душил сокет при не-101 ответе → вечные ретраи HMR-клиента (симптом: спам «WebSocket connection to ws://.../_next/hmr failed»).
  3. В Next 16 dev провал HMR-WS останавливает бутстрап app-router'а: `hydrateRoot` не коммитится (0 `__react*`-ключей на DOM, `window.next` есть, ошибок в консоли нет). Доказательство причинности: прямой :3000 с заблокированным `/_next/hmr` WS (playwright routeWebSocket) даёт тот же симптом.
  4. Клик «Войти» при незагидратированной форме уходит нативным GET → middleware возвращает unauthed на `/login` → «не могу пройти дальше авторизации».
  HTML превью-хоста при этом корректен: полный diff прямого и проксированного /login совпадает байт-в-байт, кроме 131-байтной инъекции `<base>`+`__ds-runtime.js`, вставки регистрации `__ds-sw.js` и per-request случайного `__next_r` (Next генерирует его заново для каждого запроса — это не артефакт рерайта). Инъекции гидратации не мешают — каждый фактор проверен изолированно.
- **Фикс H8**: `handleUpgrade` переписывает `Origin` апгрейда на upstream origin (зеркалит существующий HTTP-путь `handleProxy`); также relay рвёт соединение и по `'end'` (полузакрытие), не только по `'close'` — иначе полузакрытый клиент оставляет навсегда открытый upstream-сокет. Регрессионный тест в `PreviewHostServer.test.ts` (стаб отвечает 101 и эхоит полученный `Origin`). E2E на реальном коде (standalone `PreviewHostServer` + playwright против реального Next-приложения): гидратация коммитится (`reactKeys:2`), консоль чистая, сабмит формы с неверным паролем остаётся на /login с клиентской ошибкой «Неверный email или пароль» вместо немого редиректа. Примечание: сервер, не читающий свои upgrade-сокеты (как в старом стабе теста), не увидит FIN — это артефакт стаба, не продукта; реальные ws-серверы (в т.ч. Next dev) читают сокеты.
  Если проект пользователя дополнительно ограничивает origins — фолбэк-совет: добавить хост превью в `allowedDevOrigins` в `next.config.ts` проекта (соответствующее предупреждение Next печатает в терминал dev-сервера).

### EPIC I — всплывающее окно выбранного компонента (попап «Перейти» / «Скопировать для ИИ»)
- `webview/components/SelectionPopup.tsx` (+ module.css): компактный попап, привязанный к выбранному элементу в edit-режиме; рендерится внутри `.frame` (`position:relative`), координаты — из `payload.rect` (origin совпадает с iframe viewport), позиция клампится в границы фрейма, снизу не влезает — раскрывается над элементом.
- Содержимое: имя компонента, кнопка «Перейти», auto-grow textarea (до 3 строк, Ctrl+Enter — копировать, Escape — снять фокус), кнопка «Скопировать для ИИ».
- Поток: `ds:select` → `PreviewContainer` сохраняет `popupTarget` (чистится при смене url/refreshKey и выключении edit) → App → `source:reveal` → расширение; копирование — существующий `ai:copyInstruction`.
- Расширение: валидация `components` (≤20, строки ≤500, line>0) в `openDesignStudio.ts`; `PromptExportService.revealComponent` открывает файл (`showTextDocument` + `revealRange(InCenter)`); новый чистый хелпер `pickRevealTarget` в `ComponentResolver.ts` — идёт по цепочке, скипает `node_modules/`, берёт первый существующий файл workspace. Тесты: 3 новых в `ComponentResolver.test.ts` (skip node_modules, bundler-префиксы, missing → undefined).

## Итоговые проверки

`npm run typecheck` — 0 ошибок; `npm run lint` — чисто; `npm test` — все тесты проходят (счётчик растёт по мере добавления регрессионных тестов); `npm run build` (включая `verify-build`) — артефакты верифицированы.

## Оставшиеся этапы

1. **Ручная проверка** в Extension Development Host (F5): демо-страница и реальный Next.js — browse/edit, инспектор, копирование инструкции. После rebuild перезагрузить окно HOST обязательно.
2. **EPIC E — Performance**: профилирование pointermove→outline (rAF уже есть) и select→inspector; debug-диагностика за флагом.
3. **Integration-фикстуры** (vanilla/Vite/Next.js внутри репо) и прогон ручной матрицы §11 инструкции.

## Точный следующий шаг

Пересобрать (`npm run build` уже выполнен) и перезагрузить Extension Development Host. Проверить вручную: (1) hover-подсветка в «Редактировать» и пропадание фокуса при выходе; (2) логин в канбан-проекте → переход по ссылкам держит сессию (`/login` больше не возвращается); (3) создание доски без ошибки; (4) попап выбранного компонента — «Перейти» открывает файл приложения (не node_modules), textarea + «Скопировать для ИИ» кладёт инструкцию в буфер. Если H3 сохранится — снять текст ошибки из канала `Design Studio Preview` и вернуться к EPIC H3 с конкретным сообщением. Затем EPIC E (профилирование) и фикстуры `docs/IMPLEMENTATION_PLAN.md` § H4–H6.


## Хендофф: серия фиксов по AI_AGENT_INSTRUCTIONS (ветка fix/ai-agent-instructions)

Работа идёт фазами по docs/AI_AGENT_INSTRUCTIONS.md. На каждую задачу: регрессионный тест (красный → зелёный), обновление затронутой документации, запись в docs/IMPLEMENTATION_PLAN.md, тематический коммит.

Сделано (Фаза 0): baseline-прогон зелёный (typecheck, lint, 178 тестов, build+verify); добавлен docs/AI_AGENT_INSTRUCTIONS.md, ссылка в docs/README.md; код не менялся.

Дальше — Фаза 1 (P0-1..P0-4), формат каждой записи: ID, корневая причина, файл/функция, тест-доказательство.

### Фаза 1 (P0-1…P0-4) — сделано, ветка fix/ai-agent-instructions

- **P0-1** base href проектных страниц: `<base>` теперь `{origin}/project/{dir}/`, авторский `<base>` не переопределяется (injectIntoHtml + respectAuthoredBase). Тесты: fixtures.test.ts (резолв styles.css/logo.svg/about.html через base, авторский base не тронут).
- **P0-2** двойная инъекция: одна точка (injectRuntimeIntoHtml удалён), runtime-экземпляр защищён re-init guard'ом (`window.__dsRuntimeInitialized`). Тесты: fixtures.test.ts (ровно один тег), packages/preview-runtime/src/index.test.ts (jsdom: повторный init не добавляет слушателей). Добавлен devDep jsdom.
- **P0-3** data-upstream-origin: injector во всех путях (proxy + project) ставит атрибут origin; runtime при отсутствии атрибута выводит origin из `<base>`/location, поэтому политика ссылок browse-режима реально работает (external/javascript: → ds:navigate-blocked, same-origin — внутри превью). Тесты: инъекция (HTTP), jsdom click-policy.
- **P0-4** гонка «Сохранить стили»: persists сериализованы (queue в openDesignStudio), requestId коррелирует persist:result с запросом, webview удаляет из очереди только подтверждённые правки (ackPendingStyles). Тесты: serializes concurrent persists (maxInflight=1, порядок), correlation, per-edit ack.

Проверка: npm run typecheck / lint / test (193 теста в 17 файлах) / build+verify — зелёные после каждого шага. Осталось: браузерная часть приёмки (Playwright, P3-6), ручная матрица.

## Фаза 1 (P1 — безопасность и надёжность) — сделано

- P1-1: postMessage webview<->runtime строго по origin (targetOrigin вместо "*", фильтр
  event.origin в webview; allowlist родителя в runtime: vscode-webview://*, data-parent-origins,
  same-origin; без trusted ping секрета — ответы строго на event.origin). Коммит a58477d.
- P1-2: preview-хост + cookie jar живут только пока открыта панель; dispose последней панели
  останавливает сервер (jar стирается), повторное открытие — новый порт/сессия; dispose-
  подписки не накапливаются. SECURITY.md дополнен. Коммит a891ec8.
- P1-3: denylist /project/ применяется к каноническому (realpath) пути; симлинк на .git/.env
  внутри корня больше не читает секреты; denylist расширен (.npmrc, .ssh, *.pem/key/p12/pfx,
  id_rsa*, credentials*, .envrc, .htpasswd и др.). Коммит 9555069.
- P1-4: входящие запросы с чужим Origin -> 403 (WS — разрыв соединения); при переписывании
  origin форвардится sec-fetch-site: same-origin (HTTP и WS). Коммит 6efade6.
- P1-5: все page-derived поля промпта (selector/classes/tag/id, имена/файлы компонентов,
  поля edits) проходят dataValue(); ai:copyInstruction валидирует edits (kind/лимиты длин).
  Коммит 39f2e17.

Проверка: typecheck/lint/build+verify зелёные; 209 тестов в 19 файлах (было 178/16 на старт
Фазы 1). Каждый фикс закрыт красным регрессионным тестом, записи в IMPLEMENTATION_PLAN.md.

Осталось вручную (автоматизация невозможна): сверить полный handshake после P1-1/P1-2 на
Next.js-фикстуре с логином (сессия живёт после навигации, server action redirect, HMR WS),
а также демо и статическую фикстуру в реальном VS Code — ручная матрица §8.

## Фаза 3 (P2 — батчи по доменам) — завершена

- 3a (протокол/типы, коммит 8c72f5f): P2-1 (types.ts реэкспортирует протокол, касты убраны),
  P2-2 (filter в STYLE_PROPS, PROTOCOL_VERSION "4"→"5"), P2-13 (ds:runtime-ready/error
  реализованы, мёртвые статусы и protocol.js удалены).
- 3b (runtime, коммит 2062c6a): P2-3 (рекурсивный collectSourceRulesFromStylesheets — @media/
  @supports/@layer видны «Сохранить стили» и промпту), P2-12 (fiber-префикс
  __reactInternalInstance$), P2-17 (getSelector уникален до body, duplicate снимает id потомков).
- 3c (tailwind, коммит 831f962): P2-4 (конфликты по оси/стороне: pt-4 больше не сносит
  px-8/py-2).
- 3d (webview UX, коммит 744a83c): P2-5 (дебаунс slider/color), P2-6 (ds:rect — попап
  следует за скроллом/ресайзом, close+Escape), P2-18 (onBlur commit), P2-19 (placeholder
  select'а), P2-20 (ErrorBoundary). PROTOCOL_VERSION "6".
- 3e (persistence): P2-7 (top-level парсер объявлений вместо regex — вложенные правила и
  комментарии больше не правятся; dirty-документ не save()'ится — чужие несохранённые правки
  пользователя не коммитятся), P2-21 (decodeVlq: throw при shift>30; normalizeCssSelector:
  :before≡::before, пробелы, escape-снятие, порядок запятых). 7 новых тестов (были красными
  до фиксов). Бaseline: typecheck/lint/test 227→234/21 файлов/build+verify — зелёные.
- 3f (preview-хост, 5 коммитов): 3f1 386a332 — P2-9 (percent-кодирование сегментов entry в
  projectUrl), P2-10 (статус по явному источнику состояния, не по подстроке URL),
  P2-22 (инлайн-тернарники в i18n, импорты наверх, кэш entries/detect с инвалидацией).
  3f2 99bcc62 — P2-14 (Range/206/416 для /project/, MIME .wasm/.map/.avif/.mp4/..., fs.promises).
  3f3 1c25020 — P2-15 (jar-ключи origin|path|name с RFC 6265 path-матчингом, LRU-лимит 512).
  3f4 2ffc5c9 — P2-16 (dual-stack probe 127.0.0.1+::1, vite preview→4173, слитный -p4000 и
  PORT=, фильтр non-dev скриптов). 3f5 e6eab90 — P3-7 (abort upstream во всех ветках прокси
  при обрыве клиента, ::1 в candidateLoopbackTargets, cookies из host jar в WS-handshake,
  периодический purge истёкших jar-записей). Тестов 246→257/21 файлов.
- 3g 99adb28 — P2-11 (toolbar.serverDown = «Сервер не запущен»; кнопка режима показывает
  целевой режим «Редактировать»/«Просмотр», i18n-ключи toEdit/toBrowse, тест паритета RU/EN
  с I18N_STRINGS) + §6 docs sync (DEVELOPMENT_GUIDE: double-click буллет/подпись кнопки/
  маркер сборки; TROUBLESHOOTING: шаги 1 и 4; README: пункт про before/after переформулирован;
  docs/README.md: ссылки на AI_HANDOFF/IMPLEMENTATION_PLAN/LEGACY_CLEANUP; SECURITY и
  политика ссылок сверены). Тестов 260/22 файлов.

Итог Фазы 3: 20 задач P2 (3a–3g) закрыты; каждый фикс с красным регрессионным тестом,
baseline (typecheck/lint/build+verify, 260 тестов в 22 файлах) зелёный после каждой задачи.
Фаза 4 (P3 инженерия: CI-матрица, ESLint 9 flat config, workspaces/tsconfig-split,
манифест/.vscodeignore, тест-инфраструктура + coverage) — следующая.
