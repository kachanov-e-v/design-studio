# IMPLEMENTATION PLAN (EPIC A)

> **Статус (2026-11-18): актуальный протокол — v9 (`PROTOCOL_VERSION = "9"`).**
> Этот файл — исторический аудит и ledger выполненных работ (эпики A–I, фазы 0–5,
> NAV/RT/WV/EXT/UX, PROMPT-01): версии протокола и статусы ниже зафиксированы
> на момент своих сессий и не переписываются. Актуальный роадмап —
> `docs/IMPROVEMENT_PLAN.md` (эпики IMP-A…IMP-F; IMP-A, IMP-B и IMP-G выполнены); история
> версий протокола — `docs/PROTOCOL_CHANGELOG.md`. Текущее состояние v9, security
> hardening и известные ограничения — в разделе «Текущее состояние (2026-11-18)»
> в конце файла; полная таблица сообщений — в `docs/AI_HANDOFF.md`.

Дата аудита: рабочее дерево на ветке `master` с незакоммиченным рефакторингом протокола v2/v3 (атрибуты, outlines в iframe). Задача: превратить preview в полноценный браузер с раздельными режимами, начиная с политики навигации по ссылкам.

## Baseline команд

(На момент аудита; текущий baseline — 505 тестов / 37 файлов, см. конец файла.)

| Команда | Результат |
|---|---|
| `npm ci` | ОК (предупреждение о postinstall esbuild — стандартное) |
| `npm run typecheck` | ОК, 0 ошибок |
| `npm run lint` | ОК, 0 замечаний |
| `npm test` | 121/121 прошли |
| `npm run build` | ОК, все артефакты верифицированы |

## Event flow (as-is на момент аудита; текущий протокол — v9)

```
DOM события (iframe) → packages/preview-runtime/src/index.ts (capture listeners)
  → postMessage protocol v2 (на момент аудита; сейчас v9, styled/validated) → webview/components/PreviewContainer.tsx
  → App.tsx (setSelected / handleStyleApplied / handleOpApplied)
  → Inspector.tsx (контролы) → op через PreviewContainer.applyOp
  → runtime applyElementOp → ds:op-applied → App.recordEdit → FloatingPanel (Change Journal)
```

## Корневые причины найденных проблем

### RC1. Внешние/изменённые ссылки выводят iframe из preview-хоста (главная, по запросу пользователя)

- `packages/preview-runtime/src/index.ts`, обработчик `click` в browse mode: перехватываются только ссылки с `href.origin === upstreamOrigin`; всё остальное — нативная навигация iframe.
- Следствия: клик по ссылке с внешним `href` грузит внешний сайт внутри предпросмотра (без прокси, cookies и runtime); клик по `href`, изменённому в инспекторе, уводит приложение; `javascript:`-ссылки исполняются (self-XSS); `target="_blank"` ведёт себя непредсказуемо в песочнице webview.
- План (EPIC B/C): единая политика ссылок в browse mode — same-origin маршруты навигируются внутри iframe через preview-хост; внешние/не-HTTP (`javascript:`, `data:` и т.п.) блокируются c уведомлением через новое сообщение протокола `ds:navigate-blocked`; политика задокументирована.

### RC2. Режимы правки/просмотра размазаны по слоям

- Источник истины: `editMode` в `webview/App.tsx` (useState) дублируется в `previewRef` runtime (`editMode` в index.ts), синхронизация через `ds:set-mode` / `ds:mode-changed` при handshake и при переключении. Это корректный контракт, но подписи и подсказки в UI устарели («Правка: выкл.», Alt+клик).
- План: переименование подписей режимов в «Просмотр»/«Редактировать» + подсказка при включении правки; без смены механизма (не перезагружает iframe — подтверждено: `ds:set-mode` не трогает URL).

### RC3. Alt+клик для интерактивных элементов — уже устранён в рабочем дереве

- В текущем (незакоммиченном) рефакторинге `INTERACTIVE_SELECTOR` удалён; `pointerdown`/`click` в capture-фазе перехватывают любой элемент в edit mode: `preventDefault` + `stopImmediatePropagation` + `sendSelection`. README/документация ещё описывают Alt+клик — обновить в §12.

### RC4. Инспектор — универсальные строковые контролы (EPIC D, не начат)

- `webview/components/Inspector.tsx`: свойства CSS и атрибуты — везде `<input type=text>`; нет color/select/number+unit/toggle, нет различения computed/inline/source-rule, нет значений `value`/`checked`/`required` и т.п.
- План: registry типизированных PropertyDefinition + контекстные атрибуты по тегу; расширение whitelist атрибутов протокола с поддержкой toggle (set/remove) — потребует `PROTOCOL_VERSION = 4`. (Исторический план: выполнено в EPIC D; текущий протокол — v9, whitelist — 40 атрибутов.)

### RC5. Производительность hover (EPIC E, не начат)

- `collect()` в `index.ts` вызывается только при select/операциях — уже не на pointermove. Hover только двигает outline через rAF. Остаточные пункты: разделение hover/selection payload не требуется (hover payload не отправляется вовсе); требует профилирования и проверки «не собираем ли мы что-то лишнее при select».

### RC6. Безопасность proxy/persistence (EPIC F, не начат)

- `proxy-html.ts` `targetFromProxyPath()` и `PreviewHostServer.fetchWithFallbacks()` принимают внешние URL-кандидаты; сопоставить с обещанием `docs/SECURITY.md` (только loopback), централизовать валидацию, DNS-rebinding, redirect re-validation, tests.
- `resolveProjectPath`: проверить symlink escape через realpath.

## Порядок работ (исторический: все шаги A–G закрыты, см. `docs/AI_HANDOFF.md`; актуальный план — `docs/IMPROVEMENT_PLAN.md`)

| Шаг | Содержание | Статус |
|---|---|---|
| A | Аудит, baseline, этот план | выполнено |
| B1 | Политика ссылок browse mode + `ds:navigate-blocked` + подписи режимов | в работе (эта сессия) |
| B2 | Статический preview/ручной URL — существуют; аудит краёв (target=_blank, downloads) | в работе |
| C | Edit mode: первый клик выбирает всё (уже в дереве), подсказка, очистка outlines | в работе |
| D | Inspector: registry контролов, контекстные атрибуты, draft/apply/cancel | план |
| E | Профилирование hot-path, разделение payload, rAF outline (уже частично) | план |
| F | SSRF/poolback-валидация, symlink, service worker review | план |
| G | Legacy cleanup, docs, `docs/LEGACY_CLEANUP.md` | план |

## Риски

- Прокси критичен для Next.js RSC/Server Actions/cookies: любые изменения прокси — только с integration-тестами (fixtures намечены в §11).
- Расширение whitelist атрибутов протокола должно сохранить сериализуемую валидацию (без функций).
- Повышение версии протокола делает старые собранные артефакты несовместимыми до полной пересборки — `npm run build` обязателен после правок.

## EPIC H — регрессии и остатки после ручной проверки (обновлено)

Результаты ручной проверки в Extension Development Host (канбан Next.js проект):

### H1. Подсветка в edit mode и очистка фокуса при выходе
- Симптом: контур выбранного элемента «воскресает» при повторном включении «Редактировать»; hover-подсветка слабая.
- Root cause: `ds:set-mode` disabled в runtime очищал только `hoveredElement` — `selectedElement` переживал выход из режима.
- Правка: `packages/preview-runtime/src/index.ts` — при выключении clear обоих состояний + `hideOutlines()`; hover-контур усилен (2px, заливка 0.18).

### H2. Переход по ссылкам выбрасывает на страницу авторизации
- Симптом: после логина в preview переход по ссылке возвращает на `/login`; в обычном браузере проблема отсутствует.
- Root cause: cookie-сессия приложения хранилась только в браузере webview. Приложение живёт в iframe с origin preview-хоста внутри webview (кросс-сайтовый контекст), и Chromium не гарантирует отправку Сookie (SameSite/third-party cookie policy). При жесткой навигации (клик по ссылке → полный переход) cookies теряются — auth-middleware редиректит на авторизацию.
- Решение: серверный cookie jar в `PreviewHostServer` — upstream Set-Cookie запоминаются хостом (`rememberSetCookie`), подставляются в каждый проксированный запрос (`buildCookieHeader`, jar перекрывает браузерные), jar чистится при смене dev target и при expiry/Max-Age=0. Cookie больше не зависят от браузерных политик.
- Тесты: jar переживает навигацию без браузерных cookies, удаление по expiry, очистка при смене target.

### H3. Ошибка при создании элемента (например, доска в канбан-проекте)
- Симптом: Server Action создания элемента падает в preview, в обычном браузере — нет.
- Root cause (наиболее вероятный, общий с H2): Server Action POST уходит в upstream без cookies сессии → unauthorized/error на стороне приложения. Cookie jar должен закрыть основную гипотезу.
- Действие: перепроверить вручную после H2; если ошибка сохранится — снять текст ошибки из канала `Design Studio Preview` и статуса webview, локализовать (multipartFormData/origin/flight).

### H4. Остатки EPIC E
- Профилирование pointerdown→selection и hover pipeline; debug-диагностика за флагом; метрики по §8 инструкции.

### H4a. Всплывающее окно выбранного компонента (выполнено)
- В edit-режиме при выборе элемента над ним появляется попап: имя компонента, кнопка «Перейти» (открывает файл компонента в редакторе, node_modules-компоненты пропускаются), auto-grow textarea «что изменить» и кнопка «Скопировать для ИИ» (переиспользует `ai:copyInstruction`).
- Файлы: `webview/components/SelectionPopup.tsx` (+css), `PreviewContainer.tsx` (state из `ds:select`, очистка при reload/exit edit), `App.tsx` (`source:reveal`, `onCopyInstruction`), `openDesignStudio.ts` (валидация + handler), `PromptExportService.revealComponent`, `ComponentResolver.pickRevealTarget` (skip node_modules, тесты).
- Ограничение: попап показывается только когда runtime отдал `component[]`; для элементов без компонентного контекста «Перейти» вернёт `status.sourceMissing`, но копирование инструкции работает всегда.

### H5. Integration-фикстуры из §11
- Vanilla HTML/CSS/JS, React+Vite, статический многостраничник внутри репо; автотесты browse/edit по матрице.

### H6. Ручная матрица §11
- Полный прогон в Extension Development Host: ссылки/кнопки/forms в browse, первый клик выбора в edit без активации, выход из edit мгновенно возвращает поведение, reconnect восстанавливает режим.

## Тестовая матрица (минимум, автоматизируемо)

| Сценарий | Уровень |
|---|---|
| Валидация `ds:navigate-blocked` (url, session, длина) | unit (protocol.test.ts) |
| Политика ссылок: same-origin навигируется, external/js blocked | unit (матчинг логики) + ручная |
| Первый клик в edit mode не активирует link/button/form | integration (fixture HTML) |
| Browse mode: клики проходят, per-режим listeners не вмешиваются | integration |
| before/after в Change Journal для attribute/text/classes | unit |
| SSRF-фильтр upstream, symlink escape | unit (EPIC F) |

## Дополнение: статусы после сессии (обновлено)

| Позиция | Статус |
|---|---|
| Static HTML preview | расширен: глубина 6, поддержка .htm, инъекция base+runtime для статических страниц, перезапись CSS-URL через `/project/` |
| Cross-origin CSS (статика) | root-absolute `url()` в статических CSS перезаписываются (`prependProxyOriginToPathUrls`) |
| EPIC E / H4 | инструментация select-пайплайна добавлена: `packages/preview-runtime/src/perf.ts` (PerfCollector, debugPerfEnabled, formatPerfSummary) + stage-тайминги в `buildPayload/collect` (`index.ts`); включается `?dsPerf=1` в URL страницы, вывод — `console.debug`; payload протокола не расширялся, версия не менялась |
| H5 (автоматизируемая часть) | фикстура `fixtures/static-site/` (ванильный многостраничник: index.html, about.html, styles.css, images/logo.svg, orphan.htm) + `src/infrastructure/preview/fixtures.test.ts` (5 тестов: обнаружение входов, инъекция runtime/base, same-origin ссылки, перезапись CSS-URL, раздача ассетов) |
| H5 (браузерная часть) / H6 | матрица browse/edit в Extension Development Host остаётся ручной (нужен browser harness, изменит структуру тестов) |
| findProjectEntries | вынесен в `src/infrastructure/preview/projectEntryScanner.ts` без зависимости vscode; из `openDesignStudio.ts` реэкспортируется для обратной совместимости |

---

# Технический аудит (план работ)

## A. Функциональные баги

- [x] **A1. Сохранение CSS Modules из dev-сервера не работает.** Webview отправляет в `style:persist` поле `rules` (App.tsx:183, handleSave), а расширение читает `msg.sourceRules` (openDesignStudio.ts:252). Поле всегда `undefined`, весь код с source map и эвристикой CssSourceResolver недостижим из UI. Тесты не ловят, потому что проверяют компоненты по отдельности.
- [x] **A2. Лимит в 50 CSS-файлов.** `findFiles("**/*.css", "**/node_modules/**", 50)` обрезает список молча. Папки `.next`, `dist`, `build` не исключены. Правка может уйти не в тот файл, который кажется «единственным совпадением».
- [x] **A3. Файл ищется только по имени.** При маппинге выбирается первый файл с подходящим basename (`Button.module.css`). При одинаковых именах в разных папках правка уйдёт в первый найденный — сверять путь, а не только basename.
- [x] **A4. Порядок вызовов для CSS-ответов.** В ветке text/css сначала идёт `res.writeHead`, потом `res.setHeader("Set-Cookie")` — при постановке cookie Node бросит `ERR_HTTP_HEADERS_SENT`, внешний catch допишет в тело текст ошибки.
- [x] **A5. Стриминг ломается.** Ответ целиком читается через `arrayBuffer()`, `AbortSignal.timeout(30s)` действует и на чтение тела: SSE, streaming SSR и long-poll обрываются, память не ограничена. Лимит 20 МБ для HTML/CSS молча обрезает ответ (subarray), для остальных типов проверяется после полного чтения.
- [x] **A6. WebSocket-прокси сделан грубо:**
  - [x] для https идёт обычный `net.connect`, порт по умолчанию 80 (нужен wss/TLS);
  - [x] IPv6 hostname приходит в скобках — подключение не получится;
  - [x] статус проверяется регуляркой `/101/` по всей строке;
  - [x] заголовки-массивы отбрасываются;
  - [x] таймаута на подключение нет.
- [x] **A7. Вставка runtime.** Регулярка `/<head[^>]*>/i` совпадёт и с `<header>`, если настоящего `<head>` нет.
- [x] **A8. Жизненный цикл расширения:**
  - [x] нет `panel.onDidDispose`;
  - [x] можно открыть несколько панелей, а `PreviewHostServer` общий: `setDevTarget` и `setProjectRoot` затирают друг друга и чистят cookie jar;
  - [x] учитывается только `workspaceFolders[0]` (нет поддержки multi-root);
  - [x] если сервер не стартовал, пользователь не видит ничего (только console.error), панель остаётся «пустой» — нужна явная ошибка.
- [x] **A9. Блокировка extension host.** `findSourceHints` синхронно обходит до 3000 файлов и перечитывает каждый файл для каждого токена (до 8) — десятки тысяч `readFileSync` в основном потоке. Нужен асинхронный попроходный обход с одним чтением файла.
- [x] **A10. `!important` теряется при замене значения в `editRule`** — регулярка `[^;]*` съедает его. Значения вида `url(data:...;base64,...)` она тоже ломает.

## B. Расхождения документации и кода

- [ ] **B1.** Строка `preview.selectHint` всё ещё говорит «Alt+клик», хотя Alt-режим удалён. Строка `preview.runtimeMissing` предлагает добавить `@design-studio/preview-runtime` в приложение, хотя runtime внедряет прокси.
- [x] **B2.** `docs/SECURITY.md` обещает, что все upstream проходят SSRF-гейт, но `sourceMappingURL` в CssSourceResolver скачивается без проверки на loopback, и fetch по умолчанию идёт по редиректам.
- [x] **B3.** `AI_HANDOFF.md` указывает 141 тест (фактически растёт), ссылается на коммит `f700758` и файл `DESIGN_STUDIO_AI_AGENT_INSTRUCTIONS.md`, которых в репозитории нет. Обновлять счётчики на каждом изменении или убрать конкретные числа.
- [x] **B4.** В `AI_HANDOFF.md` и `IMPLEMENTATION_PLAN.md` остались рабочие заметки агента: пути `%TEMP%`, названия чужих проектов («ProTree», «Beam 1.0»). Для публичного репозитория это лишнее — почистить.

## C. Безопасность

- [x] **C1. Авторизация preview-хоста.** Нет проверки заголовка Host и токена. Случайный порт на 127.0.0.1 — фактически открытый прокси ко всем loopback-сервисам, возможен DNS rebinding. Добавить случайный токен (в путь или cookie) и проверку Host (`127.0.0.1:port`).
- [x] **C2. Маршрут `/project/`.** Отдаёт любой файл workspace, включая `.env` и `.git/`. Исключить `.env*`, `.git`, `node_modules`.
- [x] **C3. Cookie jar.** Ключуется только по имени и общий для всех loopback-origin'ов, Path и Secure не учитываются. Cookie приложения могут уйти на другой локальный порт через `/proxy/` — разнести по origin.
- [x] **C4. CSP webview.** Разрешены `frame-src http: https:` и `img-src https:`; достаточно `http://127.0.0.1:*`.
- [x] **C5. Инъекция контента страницы в промпт ИИ.** Текст, классы, атрибуты и сниппеты вставляются без ограждения (`Text: ${ctx.text}`). Контент приложения может содержать инструкции для агента с правом записи; переводы строк дают фальшивые строки вида «User request: …». Огородить блоком данных и убрать переводы строк.
- [x] **C6. Origin-проверки runtime.** Защита sessionId/nonce не защищает от JS самой страницы (значения ей известны): `style:persist`, `source:reveal`, `ai:copyComponent` управляются недоверенными данными. Проверка CSS-свойств/значений и realpath-проверка пути сделаны хорошо и остаются. Но `postMessage(..., "*")` и условие `!parentOrigin.includes("vscode-webview")` — слабая проверка origin, заменить на точную. (Закрыто после аудита: P1-1 — явный `targetOrigin` вместо `"*"`, фильтр `event.origin`, allowlist родительских origin; в коммите 05f9b0d валидация входящих webview-сообщений дополнительно ужесточена.)
- [ ] **C7. Зависимости.** `npm audit`: 11 уязвимостей (2 critical, 1 high, 8 moderate) в dev-зависимостях (vitest/tinypool, esbuild ≤0.24). В пакет расширения не попадают, но обновить vitest/vite/esbuild.

## D. Недоработки репозитория

- [x] **D1.** Нет файла LICENSE, хотя README заявляет MIT.
- [x] **D2.** package.json: заглушка `publisher: design-studio`, нет `repository`, `icon`, `keywords`; `onCommand` в `activationEvents` избыточен.
- [x] **D3.** Нет CI (`.github` отсутствует): typecheck, lint, test, build, npm audit.
- [x] **D4.** lint не покрывает `packages/` и `scripts/`.
- [ ] **D5.** Нет тестов для openDesignStudio.ts, runtime/index.ts (711 строк), App, PreviewContainer, Inspector — там сидит баг A1.
- [x] **D6.** `webview/public/runtime.js` (1045 строк) и `protocol.js` закоммичены как сборочные артефакты. Сейчас в синхроне, но риск расхождения — добавить в `.gitignore` (учесть, что для установки из исходников нужна сборка перед упаковкой).

## E. Приоритет выполнения

1. **Срочно (функциональность):** A1 + сквозной тест на сообщение `style:persist`; A4; для CSS-поиска A2 (исключить `.next`/`dist`/`build`, переполнение лимита считать «неоднозначностью») и A3 (сверять путь, а не только basename).
2. **Безопасность:** C1, C2, B2 (source map через `isLocalhostUrl` + `redirect: "error"`), C4, C3, C5.
3. **Надёжность прокси:** A5 (потоковая передача `Readable.fromWeb` с лимитом по счётчику байт, таймаут только на заголовки), A6 (wss, IPv6, точный разбор статуса).
4. **Расширение:** A8 (одна панель на workspace с reveal, onDidDispose, явная ошибка при падении хоста, multi-root), A9, A7, A10.
5. **Публикация:** D1, D2, D3, D4, C7, B1–B4.
6. **Тесты:** интеграционный тест «webview → extension» с замоканным vscode; юнит-тесты логики runtime/index.ts в jsdom; регрессионные тесты на A4 и A5; пункты D5.

> Выполнено (приоритет 1, PR #2): A1 — поле переименовано в sourceRules через webview/persistContract.ts + контрей-тест и интеграционный тест обработчика; A2 — исключения .next/dist/build/out/coverage/.git, лимит 200 с трактовкой переполнения как неоднозначности; A3 — поиск по всем кандидатам с basename, выбор по sourcePath из source map, неоднозначность => ошибка; A4 — Set-Cookie до writeHead в CSS-ветке + регрессионный тест.

> Выполнено (приоритет 2, PR #2): C1 — проверка Host (incl. WS-upgrade); токен сознательно не вводился (SameSite ломает доставку cookie кросс-сайтовому iframe, Host-pроверка закрывает rebinding; обоснование в SECURITY.md). C2 — /project/ запрещает .env*, .git, node_modules. B2 — sourceMappingURL только loopback + redirect: "error". C4 — frame-src/img-src ограничены loopback-origin'ами. C3 — cookie jar ключуется upstream-origin|name. C5 — page-контент экранируется (dataValue) и огражден маркерами PAGE DATA START/END.

> Выполнено (приоритет 3, PR #2): A5 — таймаут только на заголовки (clearTimeout после fetch), readCappedBody для HTML/CSS/redirect вместо молчаливого subarray (честные 502/destroy при переполнении), потоковая передача прочих типов через streamUpstreamBody (Transform-лимит 20MiB, abort при обрыве клиента). A6 — wss через tls.connect (servername только для не-IP), IPv6 без скобок, порты 80/443 по умолчанию, статус строго `^HTTP/[\d.]{1,8} 101\b`, форвард заголовков-массивов построчно + writeUpgradeRequest, таймаут WS-коннекта 5с, трекинг и закрытие hijacked сокетов в stop() (acceptedSockets + closeIdleConnections/closeAllConnections). Тесты: SSE-прогрессивность, 502 на HTML-overflow, destroy на стрим-overflow, форвард дубликатов WS-заголовков, закрытие клиента при non-101.

> Выполнено (приоритет 4, PR #2): A7 — матчер `/<head(?=[\s>])[^>]*>/i` (и аналоги для body/html в proxy-html.ts, injectRuntimeIntoHtml и CSP-вставке в openDesignStudio) не путается с `<header>`; fallback на `<body>`/prepended CSP с регрессионными тестами. A8 — одна панель на workbench (повторный вызов команды делает reveal), `panel.onDidDispose` чистит ссылку, явная `showErrorMessage` при падении host-сервера, multi-root: папка выбирается по фактическому наличию сохранённой entry. A9 — `findSourceHints` асинхронный (fs/promises), каждый файл читается ровно один раз и переиспользуется между токенами вместо десятков тысяч синхронных `readFileSync`. A10 — `editRule` сохраняет `!important` при замене значения и корректно обрабатывает значения с семиколонами внутри `url(data:...;base64,...)`/кавычках; тесты на все три случая. Интеграционный тест с замоканным vscode дополнен моками reveal/onDidDispose и проверкой единственности панели.

> Выполнено (приоритет 5, PR #2): D1 — LICENSE (MIT), README ссылается. D2 — package.json: license/repository/keywords, publisher = kachanov-e-v, activationEvents очищен. D3 — .github/workflows/ci.yml (typecheck, lint, test, build + advisory npm audit) подготовлен, но не запушен: OAuth-токен gh без workflow-scope — требуется `gh auth refresh -s workflow` и ручной пуш .github. D4 — eslint покрыл packages/preview-runtime/src и scripts, webview/public исключён как сборочный артефакт. C7 — vite 7 / vitest 5 / plugin-react 5 / @types/node 24: critical (tinypool) и high закрыты; остались 7 moderate в @typescript-eslint <=8.72.2 (апстрим-фикс не выпущен). B1 — selectHint/runtimeMissing переписаны. B3/B4 — AI_HANDOFF, LEGACY_CLEANUP, IMPLEMENTATION_PLAN почищены от несуществующих ссылок, захардкоженных счётчиков и рабочих заметок.

> Выполнено (приоритет 6, PR #2): D6 — webview/public/runtime.js и protocol.js удалены из индекса и добавлены в .gitignore (перед упаковкой vsce нужна сборка npm run build — уже часть процесса). D5 (частично) — интеграционный тест webview->extension (openDesignStudio.test.ts, vi.mock vscode) был добавлен в приоритете 1; юнит-тесты App/PreviewContainer/Inspector/runtime/index.ts остаются открытыми (jsdom-инфраструктура не настраивалась, вынесено в следующий этап).

Итог аудита: A1-A10, B1-B4, C1-C7, D1-D4, D6 закрыты; D5 закрыт частично (интеграционный тест самого критичного пути); C7 — 7 moderate ждут апстрим-фикса typescript-eslint.

> Фаза 0: baseline-прогон зелёный (typecheck, lint, 178 тестов в 16 файлах, build+verify). Файл docs/AI_AGENT_INSTRUCTIONS.md добавлен, ссылка в docs/README.md. Код не менялся.
> P0-1 (статический режим /project/, base href): корневая причина — инъекция ставила `<base href={origin}>` без /project/ и директории страницы, поэтому относительные styles/images/ссылки уходили в 404; авторский `<base>` переопределялся. Фикс — `serveProjectPath` передаёт base `{origin}/project/{dir}/` (сегменты кодируются), `injectIntoHtml(..., { respectAuthoredBase: true })` не внедряет base при наличии авторского. Тест-доказательство: fixtures.test.ts — «injects a /project/ base href so relative URLs resolve», «respects an authored <base>...» (красные до фикса, зелёные после). Файлы: PreviewHostServer.ts (projectBaseHrefFor), proxy-html.ts (InjectOptions), fixtures/static-site/authored-base.html.

> P0-2 (двойная инъекция + guard): корневая причина — serveProjectPath звал и injectRuntimeIntoHtml (голый тег), и injectIntoHtml (атрибутированный тег), а в runtime не было защиты от повторного init: два экземпляра, дубли слушателей/контуров/патчей history. Фикс — одна точка инъекции (injectRuntimeIntoHtml удалён вместе со своим A7-тестом), в initDesignStudioRuntime — re-init guard по `window.__dsRuntimeInitialized`. Тест-доказательство: fixtures.test.ts «injects exactly one runtime script tag into project pages» (красный: 2 тега), packages/preview-runtime/src/index.test.ts (jsdom) — повторные вызовы init не добавляют слушателей (красный до guard). Добавлен jsdom-девдеп (нужен и для P3-6). Infrastructure-ивара: 178→182 теста.

> P0-3 (data-upstream-origin): корневая причина — injector никогда не ставил data-upstream-origin, runtime читал его, получал null и выходил из click-обработчика до политики: внешние/javascript: ссылки навигировали iframe нативно, ds:navigate-blocked не отправлялся никогда. Фикс: (1) runtimeScriptTag рендерит data-upstream-origin (с экранированием), rewriteProxiedHtml прокидывает origin upstream, проектный путь — origin preview-хоста; (2) fallback в runtime: origin из <base href> или location, когда атрибута нет (runtime, встроенный приложением). Тест-доказательство: PreviewHostServer.test.ts «stamps data-upstream-origin on the proxied runtime script» (красный), fixtures.test.ts «stamps data-upstream-origin on project runtime scripts» (красный), packages/preview-runtime/src/index.test.ts — блокировка cross-origin без атрибута (fallback), блокировка javascript: с явным атрибутом, same-origin навигируется (были красные до фикса). Файлы: proxy-html.ts, PreviewHostServer.ts, packages/preview-runtime/src/index.ts.

> P0-4 (гонка «Сохранить стили»): корневая причина — handleSave слал все pendingStyles в цикле без ожидания, обработчик style:persist не сериализовался (offset-базированные WorkspaceEdit по устаревшему тексту), а persist:result с success:true затирал ВЕСЬ queue. Фикс: (1) extension — enqueuePersist-очередь (строго по одной apply, детерминированный порядок); (2) requestId в style:persist/persist:result (экранированный стринг ≤128), persist:result всегда эхоит его; (3) webview — ackPendingStyles: правка покидает очередь только после подтверждённого успеха, отказ не теряет очередь, legacy-сообщение без requestId очередь не затирает. Тест-доказательство: openDesignStudio.test.ts «serializes concurrent persists in arrival order» (maxInflight=1, порядок r1/r2/r3 при обратном завершении — красный до), «correlates persist:result with the requestId of the request» (красный до), persistContract.test.ts — выборочное ack/сохранение при отказе/не-затирание legacy-сообщением (красные до). Файлы: openDesignStudio.ts, webview/persistContract.ts, webview/App.tsx. Cчётчик тестов: 178→193.

> P1-1 (postMessage origin policy) — FIXED: webview now posts to the iframe with an explicit
> `targetOrigin` (preview host origin) instead of `"*"` and drops incoming messages whose
> `event.origin` differs; the runtime accepts `ds:ping` only from trusted parent origins
> (`vscode-webview://*`, the `data-parent-origins` allowlist injected by the host, or same-origin),
> keeps `parentOrigin: string | null` and never posts before a trusted ping — replies go strictly
> to the ping's `event.origin`. Injection proxies `data-parent-origins` via `InjectOptions`.
> Regression tests: `webview/components/PreviewContainer.test.tsx` (explicit targetOrigin),
> `packages/preview-runtime/src/index.test.ts` (untrusted/denied origins ignored, no pre-ping posts).
> SECURITY.md updated (origin-bound messaging). Manual check of the full handshake/auth flow
> (Next.js fixture, login) still pending — see AI_HANDOFF.

> P1-2 (preview host lifetime) — FIXED: closing the (single) preview panel now stops the
> shared PreviewHostServer and wipes its cookie jar; reopening starts a fresh host on a fresh
> port without resurrecting the old application session. `ensureHostServer` replaces its
> one live dispose-subscription instead of accumulating dead ones across reopen cycles.
> Regression tests: `openDesignStudio.test.ts` (dispose stops host, reopen creates a new
> instance, no dead hosts left running) and `PreviewHostServer.test.ts` (stop() clears the
> jar — a restarted host no longer replays `sid`). SECURITY.md: new "Время жизни
> preview-хоста" section; the random-port claim is now actually true. Manual handshake/
> auth recheck (Next.js fixture) still pending — Phase 1 wrap-up note.

> P1-3 (project jail denylist) — FIXED: `resolveProjectPath` now applies the forbidden-segment
> check to the canonical realpath location (`path.relative(rootReal, real)`) and to the non-
> existing tail, in addition to the requested path. An in-root symlink to `.git`/`.env` no
> longer launders a secret past the segment check. Denylist extended with `.npmrc`, `.yarnrc`,
> `.ssh/`, `.aws/`, `.gnupg/`, `.envrc`, `.htpasswd`, `*.pem`, `*.key`, `*.p12`, `*.pfx`,
> `id_rsa*`, `credentials*`. Tests: symlink laundering red->green (junction/dir symlink where
> the platform allows), extended denylist cases, legit assets still served. SECURITY.md updated.

> P1-4 (incoming Origin policy + sec-fetch normalization) — FIXED: `handle` returns 403 and
> `handleUpgrade` tears the socket down when a request carries an `Origin` that is neither the
> preview origin nor `vscode-webview://*` (`Origin: null` rejected); absent Origin (navigations)
> still allowed. `buildForwardHeaders` and the WS handshake rewrite now set
> `sec-fetch-site: same-origin` whenever `origin` is rewritten to the upstream, so fetch-metadata
> heuristics (Next.js server actions) don't reject valid proxied calls. Tests: foreign/`null`
> Origin -> 403, local/webview/absent -> 200, upstream sees `sec-fetch-site: same-origin`;
> legacy WS test updated to send the preview origin. SECURITY.md: Origin-policy bullet added.

> P1-5 (prompt-injection flattening) — FIXED: every page-derived string in `contextToPrompt`
> now goes through `dataValue()` — selected-element tag/id/classes/selector, React component
> names/files (componentLine + owner chain), and all edit fields (selector, property,
> operation, component file/name); before/after values were already JSON-stringified.
> The `ai:copyInstruction` handler re-validates the webview edit list (`sanitizeDesignEdits`):
> kind allowlist, string bounds (selector 500, property 200, before/after 4000, operation 100,
> component 500), max 200 rows. Tests: forced newlines in selector/classes/component/edit
> fields no longer forge prompt lines at line start (red->green, en markers); legitimate
> multiline text stays readable as `\n`; handler drops malformed edits.

> P2-1 (webview protocol types) — FIXED: `webview/types.ts` now re-exports
> `EditableAttribute`/`ElementOp`/`ElementPayload`/`SourceRule` from
> `@design-studio/preview-runtime/protocol` (8-value EditableAttribute copy vs 41 is gone);
> only webview-specific `PreviewStateMessage`/`DevServerSuggestion` remain. The hidden casts
> are removed: `AttributeDefinition.name` is typed as `EditableAttribute`, `Inspector` renders
> without `as` casts, `PreviewContainer` validates incoming `attribute` via `isEditableAttribute`.
>
> P2-2 (`filter` editor without STYLE_PROPS) — FIXED: `filter` added to `STYLE_PROPS`
> (41 -> 69 entries... exact count: 69), `PROTOCOL_VERSION` bumped "4" -> "5". Regression test:
> `propertyRegistry.test.ts` parity check fails for any editor whose key is missing from
> `STYLE_PROPS` (red: `['filter']`, green).
>
> P2-13 (dead protocol entities) — FIXED by implementing producers: the runtime now posts
> `ds:runtime-ready` right after init and `ds:runtime-error` from the auto-init catch, both
> without page data and only with a concrete target origin (Chromium `ancestorOrigins`;
> never "*", otherwise ping/pong stays the fallback). `PreviewContainer` accepts a nonce-less
> `ds:runtime-ready` (origin-filtered) and resolves the handshake instantly. Unreachable
> entities removed: statuses `iframe-loading`/`blocked-or-load-error` + iframe `onError`
> branch, i18n keys `preview.iframeLoading`/`preview.blocked`, unreachable `asWebviewUri`
> demo fallback in `openDesignStudio.ts`, and `protocol.js` from copy-runtime/verify-build
> (protocol is bundled into runtime.js and the webview). Tests: runtime announcements
> (concrete origin, no "*", truncation), webview handshake on runtime-ready.

### Фаза 3 — P2 (продолжение)

> Фаза 3b (runtime): P2-3 — «Сохранить стили» видела только правила верхнего уровня
> `document.styleSheets`, @media/@supports/@layer/@container (Tailwind v4) были невидимы.
> Фикс: новый экспорт `collectSourceRulesFromStylesheets(sheets, el, opts?)` в
> `packages/preview-runtime/src/index.ts` с рекурсивным обходом CSSGroupingRule (лимиты
> maxRules=8/maxScanned=1500, дедупликация по href+selectorText+cssText); внутренняя
> `collectSourceRules` использует его для документа. P2-12 — `fiber.ts` матчил
> `"__reactInternal$"` вместо `"__reactInternalInstance$"` (React 16 keys всегда мимо);
> префикс исправлен. P2-17 — `getSelector` обрезался depth<6 (возможный неуникальный
> селектор) → теперь цепочка до body; `duplicate` сохранял id потомков → дубль id в DOM:
> id снимаются с клонированных потомков. Тесты: collectSourceRulesFromStylesheets с
> @media (@vitest jsdom), fiber-префикс, duplicate id-strip.
> Коммит: 2062c6a.

> Фаза 3c (tailwind): P2-4 — грубые группы конфликтов (добавление `pt-4` удаляло
> `px-8`/`py-2`); `conflicts()` в `src/shared/tailwind.ts` переписан через `spacingSides()`:
> конфликт по точной оси/стороне (p+m, ось p↔(px/py/pt/pb) с пересечением сторон). Старые
> ассерты переписаны на осевую модель, добавлены тесты сохранения px/py при pt/pb.
> Коммит: 831f962.

> Фаза 3d (webview UX): P2-5 — slider/color отправляли `ds:apply-style` на каждый
> `onChange` (шквал сообщений + полный collect на каждый тик): preview с дебаунсом 100 мс,
> финальный commit на pointerUp/keyup/blur. P2-6 — SelectionPopup не следовал за скроллом/
> ресайзом: протокол bump "5"→"6" + `ds:rect` (RectMessage+валидатор), runtime постит rect
> в scheduleOutlineUpdate (rAF), PreviewContainer принимает; кнопка close + Escape закрывает.
> P2-18 — текстовый инспектор коммитится по onBlur, мёртвый guard `type` удалён. P2-19 —
> пустая disabled-опция в select Toolbar'а, placeholder серверного поля больше не обещает
> путь страницы. P2-20 — ErrorBoundary оборачивает App (кнопка перезагрузки, i18n
> app.errorTitle/app.reload). Коммит: 744a83c.

> Фаза 3e (persistence): P2-7 — regex в `StylePersistenceAdapter.editRule` с разделителями
> `^|;|{`.matched первое совпадение с property, включая объявления ВЛОЖЕННЫХ правил (CSS
> nesting) и вход внутрь комментариев (упоминание `color:` в комментарии правилось как
> объявление), а `doc.save()` коммитил и несохранённые правки пользователя. Фикс: новый
> `findTopLevelDeclarations(body)` в `cssText.ts` — лексер верхнего уровня тела (комментарии,
> строки, url(...), вложенные `{}` пропускаются); замена/удаление по точному диапазону
> объявления; dirty-документ не save()'ится (правка остаётся в буфере редактора). P2-21 —
> (1) `decodeVlq` без ограничения shift (битые sourcemap декодировались в мусор через 32-бит
> переполнение) → throw при shift>30; (2) точное строковое сравнение селекторов →
> `normalizeCssSelector` (`:before`≡`::before`, коллапс пробелов, снятие escape-обратных
> слэшей) применён к обеим сторонам сравнения в findCssRules, wanted-строки со списками
> через `splitTopLevelSelectors` (порядок запятых не важен). Тест-доказательство (красные до
> фикса, зелёные после): «does not edit a declaration inside a nested rule», «ignores property
> mentions inside comments», «does not save a dirty document», «saves a clean document»,
> «matches legacy single-colon pseudo-elements», «tolerates whitespace differences»,
> «rejects overlong VLQ sequences». Счётчик тестов: 227→234 (7 новых тестов).

> Фаза 3f1 (preview-хост): P2-9 — `projectUrl` строился без percent-кодирования имени
> entry (пробел/`#`/`?` ломали URL) → каждый сегмент кодируется `encodeURIComponent`.
> P2-10 — статус состояния определялся подстрокой `url.includes("/project/")`; теперь
> явный контракт по источникам состояния (demo/entry/devserver/idle). P2-22 — инлайновые
> RU/EN тернарники вынесены в i18n-ключи (`panel.title`, `error.invalidEntry` и др.),
> импорт поднят в шапку файла, `findProjectEntries`/`detectDevServers` кэшируются с
> инвалидацией на preview:refresh/preview:demo/project:setEntry/project:setDevServer/
> project:navigate. Коммит: 386a332.

> Фаза 3f2 (preview-хост): P2-14 — статические файлы `/project/`: поддержка Range
> (`parseByteRange`: single/suffix/open-ended, multi-range → null; 206/416 с Content-Range,
> Accept-Ranges, Content-Length), MIME-таблица дополнена (.wasm/.map/.avif/.mp4/.webm/.otf/.eot),
> блокирующие `readFileSync` заменены на `fs.promises`. Коммит: 99bcc62.

> Фаза 3f3 (preview-хост): P2-15 — cookie jar ключи `origin|path|name` с RFC 6265
> path-матчингом (same-name куки разных путей больше не затирают друг друга), LRU-лимит
> 512 записей с refresh-recentency (`touchJar`), старый формат ключей дропается лениво.
> Коммит: 1c25020.

> Фаза 3f4 (preview-хост): P2-16 — `DevServerDetector`: probePort пробует оба loopback
> (127.0.0.1 + ::1), `vite preview` матчится на порт 4173, слитный `-p4000` и env `PORT=4000`
> парсятся, non-dev скрипты (build/eject/lint/test/...) отфильтровываются и в имени, и в
> команде скрипта. Коммит: 2ffc5c9.

> Фаза 3f5 (preview-хост, P3-7): (1) abort upstream при обрыве клиента регистрируется один
> раз после `fetchWithFallbacks` и покрывает ВСЕ ветки — буферные HTML/CSS/3xx раньше
> оставляли висящее upstream-соединение (abort был только в streaming-ветке); (2)
> `candidateLoopbackTargets` пробует все loopback-формы (127.0.0.1 / localhost / ::1) —
> dev-сервер, привязанный только к IPv6, больше не считается «down»; (3) WS-handshake
> подмешивает cookies из host jar (браузер в кросс-сайтовом iframe часто шлёт upgrade без
> cookies, HMR-сессия терялась); (4) периодический purge истёкших записей jar (60 c, unref,
> очищается в stop()) поверх ленивой P2-15-очистки — `purgeExpiredCookies(now)` публичен
> для детерминированного теста. Тесты: abort в каждой буферной ветке (HTML/CSS/redirect
> с RSC-телом), ::1-кандидаты, cookie-merge в upgrade, expired-purge. Счётчик тестов:
> 252→257. Коммит: e6eab90.

> Фаза 3g (i18n + docs, P2-11 + §6): `toolbar.serverDown` («Сервер обнаружен» → «Сервер не
> запущен»/«Server not running»); кнопка режима показывает действие (целевой режим):
> «Редактировать» в browse, «Просмотр» в edit (ключи `toolbar.edit/editOn` →
> `toolbar.toEdit/toBrowse`); README шаг 6 теперь соответствует UI. Экспортирована таблица
> `I18N_STRINGS`, добавлен тест паритета RU/EN. Докс-синк §6: DEVELOPMENT_GUIDE (удалён
> устаревший double-click буллет, подпись кнопки режима, маркер сборки вместо удалённого
> runtime-лога), TROUBLESHOOTING (то же в шагах 1 и 4), README (пункт про «список изменений
> до/после» переформулирован под реальный UI: счётчик правок + before/after в экспортируемой
> инструкции), docs/README.md (ссылки на AI_HANDOFF/IMPLEMENTATION_PLAN/LEGACY_CLEANUP).
> SECURITY.md и описания политики ссылок сверены — актуальны после P1-2/P0-3. Счётчик
> тестов: 257→260 (22 файла). Коммит: 99adb28.

> Фаза 4 (P3-1 CI): workflow переписан — `permissions: contents: read`, `concurrency`
> (cancel-in-progress), матрица Node 20/22 (fail-fast:false), npm audit `--audit-level=high`
> как hard-гейт (старый `npm audit --omit=dev` был no-op: в package.json нет dependencies)
> + умеренный advisory-шаг с continue-on-error; на Node 22 — `vsce package --no-dependencies`
> с загрузкой .vsix артефактом. Dependabot: npm weekly (grouped dev-minors) + github-actions.


> Фаза 4 (P3-2 линт/зависимости): ESLint 8.57 + .eslintrc.cjs → ESLint 9 flat config
> (`eslint.config.mjs`, typescript-eslint 8, react-hooks плагин: rules-of-hooks=error,
> exhaustive-deps=warn, no-explicit-any=error). esbuild 0.21.5 → 0.25.12, @types/node 24 → 22
> (выровнено с CI-матрицей 20/22). Известные 3 exhaustive-deps warning (PreviewContainer,
> SelectionPopup ref-паттерны) оставлены как warnings.

> Фаза 4 (P3-3 workspaces/tsconfig): npm workspaces `packages/*`, второй lock-файл
> packages/preview-runtime/package-lock.json удалён; build:ext получил esbuild-алиасы
> `@design-studio/preview-runtime`/`@design-studio/shared` (скрытая ловушка протокольных
> импортов закрыт); из tsconfig пакета исключены *.test.ts из emit (тесты больше не
> попадают в dist); tsconfig разделён на tsconfig.base/extension (без DOM)/webview (DOM),
> корневой — solution references; typecheck = оба проектовых прохода.

> Фаза 4 (P3-4/P3-5 манифест и упаковка): манифест — version 0.1.0, icon 128×128,
> galleryBanner, bugs/homepage, capabilities.untrustedWorkspaces=false (расширение читает/
> пишет файлы и держит loopback-сервер), virtualWorkspaces=false, extensionKind=[workspace],
> engines.node >=20.19, packageManager, NLS-заголовки команды (package.nls.json/.ru.json),
> скрипты package/publish (vsce --no-dependencies); .vscodeignore перечищен (fixtures,
> .github, конфиги, lock-файлы); CHANGELOG.md 0.1.0; README docs-ссылки → абсолютные.
> Smoke: `vsce ls` — 14 файлов в VSIX, утечек fixtures/scripts/.github/coverage нет.

> Фаза 4 (P3-6 тесты и coverage): @vitest/coverage-v8; пороги в vitest.config.ts — ≥80%
> строк для src/shared, persistence, preview и preview-runtime (провайдер v8, include
>_per-область, репортеры text+lcov); скрипт `test:coverage`; CI: шаг Test гоняется с
> coverage и порогами. Добавлены тесты: cssText (сплиттеры/поиск/валидаторы — 16),
> протокольные валидаторы (граничные длины/sessionId/selection-массивы/component/rules —
> 30 в файле), runtime-контуры сессий (set-mode/apply-style/apply-op: set-text, password
> guard, delete→parent, move без соседей, duplicate, set-classes, set-attribute с
> live-property зеркалом/javascript:-блокировкой/снятием атрибута, navigate-history;
> тест-харнесс чистит слушатели старых инстансов), persistence (invalid value,
> selectors-массив, truncated-search 200 файлов, удаление declaration, «already absent»,
> «already has this value», source-mapping heuristic через реальный loopback CSS-сервер,
> source-path неоднозначность). Итоговое покрытие: shared 89.79%, persistence 90.51%,
> preview 89.0%, runtime 88.33% строк. Счётчик тестов: 260→305, 23 файла.

> Фаза 5 (релиз-подготовка): CHANGELOG.md 0.1.0 и иконка готовы; smoke `vsce package
> --no-dependencies` — design-studio-0.1.0.vsix собран (16 файлов, 208 КБ, без мусора
> fixtures/scripts/.github/coverage). Ручная матрица проверки (Next.js+логин, Vite,
> статический проект, демо, RU/EN, Win/macOS/Linux) и публикация в Marketplace —
> вне зоны автоматизации агента, выполняются человеком.

# Ledger: план NAV/RT/WV/EXT/UX (docs/AI_AGENT_FIX_PLAN.md)

Источник задач: `docs/AI_AGENT_FIX_PLAN.md` (аудит 16.11.2026). Baseline перед
правками: typecheck/lint/test(305)/build — зелёные. Гейты после Фаз A/B — зелёные
(test 317). Ручная матрица §14 плана остаётся на пользователя (Extension
Development Host, F5).

## NAV-01 (P0) — Фаза A
- Корневая причина: `packages/preview-runtime/src/index.ts:867` сравнивал origin
  ссылки (резолвится через внедрённый `<base>` = origin прокси) только с
  `data-upstream-origin` (origin dev-сервера) — всегда не равны → все внутренние
  ссылки блокировались (политика инвертирована). Тесты не ловили: jsdom без
  атрибута, комбинация «base=прокси + attr=upstream + клик» не покрывалась.
- Исправлено: allowlist из двух origin (upstream + origin документа,
  `previewOrigin`); опасные схемы, внешние origin и target≠_self — блокируются.
  Комментарии `proxy-html.ts` (InjectOptions.upstreamOrigin) и
  `PreviewHostServer.test.ts` обновлены (двойная семантика).
- Тест: `packages/preview-runtime/src/index.test.ts` — jsdom URL
  `http://127.0.0.1:9533/boards/current` через `@vitest-environment-options`;
  кейсы NAV-01 (preview-origin navigated; absolute upstream not blocked;
  external blocked; target=_blank blocked). Красный ДО (9533≠4600 → blocked),
  зелёный ПОСЛЕ. Тестов 305→309.
- Коммит: fix(runtime): NAV-01 allow preview-host origin in browse-mode link
  policy; docs: TROUBLESHOOTING раздел с симптомом, CHANGELOG P0-3 corrected,
  план переименован `AI_AGENT_FIX_PLAN.md.md`→`.md`.

## RT-01 (P1) — Фаза B
- Корневая причина: `postRuntimeAnnouncement` брал
  `ancestorOrigins[length-1]` (topmost), а шлёт в `window.parent` — во
  вложенном webview VS Code анонс молча дропался.
- Исправлено: экспортируемая чистая `pickAnnouncementOrigin()` → `origins[0]`.
- Тест: `packages/preview-runtime/src/announcementOrigin.test.ts` (4 кейса);
  существующие анонс-тесты зелёные.
- Коммит: fix(runtime): RT-01 announce to the immediate parent origin.

## WV-01 (P1) — Фаза B
- Корневая причина: `webview/App.tsx` чистил журнал (selected/pendingStyles/
  edits/styleError) только в эффекте `[state.url]`; `ds:navigate` менял
  маршрут, журнал оставался → селекторы прошлой страницы утекали в инструкцию
  и в «Сохранить стили».
- Исправлено: `resetSessionEdits()` + `lastRouteRef` в
  `handlePreviewLocationChange` — очистка только при ИЗМЕНЕНИИ пути
  (ds:navigate шлётся и с тем же путём).
- Тест: `webview/App.test.tsx` (jsdom+testing-library, фиксированный
  randomUUID, acquireVsCodeApi-stub, полный поток сообщений). Красный ДО,
  зелёный ПОСЛЕ.
- Коммит: fix(webview): WV-01 reset edit journal on real iframe route change.

## WV-02 (P2) — Фаза B
- Корневая причина: дубль `if (sid && sid !== sessionIdRef.current) return;` в
  `PreviewContainer.tsx` (248–249); обработчик `[url]` замыкал устаревший
  `devServer` → адресная строка показывала старый origin после смены сервера.
- Исправлено: дубль удалён; `devServerRef` читается в `ds:navigate`.
- Тест: `PreviewContainer.test.tsx` describe "address freshness (WV-02)" —
  rerender с новым devServer при том же url → адрес из нового origin (красный
  на старом замыкании).
- Коммит: fix(webview): WV-02 dedupe sessionId check, fresh devServer....

## EXT-01 (P1) — Фаза B
- Корневая причина: `SourceHintFinder.ts` читал до 3000×300 КБ в Map на каждый
  «Скопировать инструкцию» (worst case ~900 МБ) без общего бюджета.
- Исправлено: `MAX_TOTAL_BYTES = 32 МБ` (+ опция `maxTotalBytes` для тестов);
  последовательное детерминированное чтение; при превышении новые файлы не
  читаются, поиск по прочитанным продолжается.
- Тест: budget-кейсы в `SourceHintFinder.test.ts` (3 файла, бюджет 10 Б →
  читается ровно 1; полный бюджет → все 3). Красный ДО.
- Коммит: fix(extension): EXT-01 cap SourceHintFinder workspace reads....

## UX-01 (P2) — Фаза B
- Корневая причина: no-op правка возвращала `success:false`
  («Property already has this value»), а `ackPendingStyles` дренирует очередь
  только по success → правка зависала в `pendingStyles` навсегда.
- Исправлено: no-op = `success:true` (message + file); реальные отказы не
  тронуты. `ackPendingStyles` принимает `message` (часть shape результата).
- Тесты: `StylePersistenceAdapter.test.ts` (no-op → success:true + file),
  `persistContract.test.ts` (такой ack осушает очередь).
- Коммит: fix(persistence): UX-01 treat no-op edits as success....

Гейты после Фаз A+B: typecheck OK, lint 0 ошибок (3 известных warning),
test 317 (25 файлов), build verify-build зелёный.

## NAV-02 (P1) — Фаза C
- Корневая причина: browse-mode клик-обработчик (`packages/preview-runtime/src/index.ts`)
  для КАЖДОЙ разрешённой ссылки делал `preventDefault()` + `location.assign(path)` →
  Next.js-роутер видел `defaultPrevented` и не работал; каждый клик = полная
  перезагрузка с потерей клиентского состояния.
- Исправлено: новый модуль `packages/preview-runtime/src/navigation.ts` —
  чистая функция `shouldHijackToAssign(locationPathname, hrefOrigin, previewOrigin)`.
  Нативный переход (без hijack) для same-origin ссылок на голых маршрутах
  (sticky-режим, pathname не начинается с `/proxy/`); hijack через `location.assign`
  сохранён только под структурированным `/proxy/…` и когда origin документа
  неопределим. Блокировки (внешние/опасные схемы/target) не изменились.
- Тесты: `index.test.ts` — same-origin клик на голом пути: `defaultPrevented === false`,
  `ds:navigate-blocked` нет (НАВ-02); preview-origin/`/proxy/`-пути: hijack сохранён.
  Протокол не менялся.
- Коммит: fix(runtime): NAV-02 pass same-origin clicks natively on bare-path routes.
- DOC: `docs/ARCHITECTURE.md` §8, `docs/TROUBLESHOOTING.md`, `CHANGELOG.md` —
  формулировка политики после NAV-02.

## Фаза D (частично, остальное — backlog)
- ENG-07: CSP webview (`src/extension/commands/openDesignStudio.ts`) — убран `data:`
  из `frame-src`. Тестов по CSP нет (строка шаблона); покрытие ручной проверкой.
- ENG-08: `.vscodeignore` — `*.map` исключены из VSIX (раньше .map шипился без
  *.ts, на которые он ссылается, — рассинхрон устранён запретом обоих).
- ENG-06: `docs/SECURITY.md` — задокументирована компенсация `Secure`/`SameSite`
  в cookie-jar для http-preview origin (`rewriteSetCookieForPreview`).
- ENG-03 (ОТКЛОНЕНИЕ ОТ ПЛАНА, осознанное): нестандартное поле `allowScripts`
  в `package.json` ОСТАВЛЕНО — современный npm потребляет это поле
  (предупреждение install-scripts), удаление меняет поведение установки.
  displayName/NLS для маркетплейса уже решены в P3-4/P3-5.
- ENG-02: `vitest.config.ts` — coverage-порог для области `webview/**` (lines 54,
  измеренный baseline 54.57%); требование поднять до 80% зафиксировано в
  комментарии. Тест: сам прогон `npm test:coverage`.
- CSS-01 (по плану «если не успеваешь — задокументируй»): НЕ реализован, требует
  protocol bump (флаг `inline` в SourceRule + обе стороны + валидаторы).
  Ограничение задокументировано в `docs/TROUBLESHOOTING.md`; остаётся в backlog.
- Не делались (backlog, требуют отдельных решений/среды): ENG-01 (E2E Playwright),
  ENG-04 (WS backpressure), ENG-05 (connect-timeout), ENG-09 (все серверы в
  Toolbar), ENG-10 (кнопка «Открыть снаружи»), ENG-11 (батч-скан CSS).

## DOC-01 (P2) — завершение
- `docs/AI_AGENT_INSTRUCTIONS.md` синхронизирован с кодом: протокол v6 (не v4),
  `EDITABLE_ATTRIBUTES` = 40, `STYLE_PROPS` = 70 (проверено по
  `packages/preview-runtime/src/protocol.ts`), P2-13 помечен закрытым
  (у runtime-ready/error есть продюсеры), добавлена ссылка на
  `docs/AI_AGENT_FIX_PLAN.md`. (Историческая запись на момент DOC-01;
  текущий протокол — v9, counts 40/70 остаются актуальными.)

Гейты после Фаз C+D+DOC-01: typecheck OK, lint OK, test OK,
build (verify-build) OK — финальный прогон см. отчёт сессии.

## RT-02 (P1) — «Не удалось определить файл компонента»
- Корневая причина: React 19 dev убрал `_debugSource` (и `_debugStack`
  фильтруется Turbopack'ом) → `collectReactComponents`
  (`packages/preview-runtime/src/fiber.ts`) возвращал имя компонента без файла
  → `pickRevealTarget`
  (`src/infrastructure/source-analysis/ComponentResolver.ts`) → undefined →
  `status.sourceMissing` в `PromptExportService.revealComponent` и
  `copyComponent`.
- Исправлено: новый экспорт `findComponentDefinition(root, name, options?)`
  в `ComponentResolver.ts` — async fs.promises, детерминированный LIFO-обход,
  SKIP_DIRS (`node_modules`, `.next`, …), бюджет 32 МБ
  (`MAX_DEFINITION_TOTAL_BYTES`), 7 паттернов объявления (export default
  function → export function/const/class → function → const|let/var → class).
  `PromptExportService`: fallback `resolveByName` в `revealComponent`; в
  `copyComponent` — fallback на `findComponentDefinition(...)?.file`, при
  полном отсутствии файла по-прежнему `sourceMissing`.
- Тесты: `ComponentResolver.test.ts` describe "findComponentDefinition
  (RT-02…)" — по имени, const/let/class-формы, не-идентификатор, бюджет
  maxTotalBytes:0 (4 теста, RED до фикса).
- Коммит: fix(component): RT-02 resolve component source by name when React
  fiber debug metadata is unavailable.

## WV-03 (P1) — hover-подсветка edit-режима не работает на первой странице
- Корневая причина: `ds:set-mode` от webview отправлялся однократно в момент
  instant-connect по `ds:runtime-ready` (`webview/components/PreviewContainer.tsx`,
  ready-ветка и effect `[editMode, runtimeStatus, url]`); если runtime ещё не
  готов принять сообщение, режим оставался выключенным без повторной отправки.
  После навигации по ссылке эффект переотправлял set-mode — поэтому
  «после перехода и обратно всё работает».
- Исправлено: resync без изменения протокола — `postSetModeWithResync()`:
  пост set-mode + повтор каждые 400 мс (до 8 попыток, MODE_RESYNC_MAX_POSTS),
  остановка по эхо `ds:mode-changed` с совпавшим `enabled`
  (`stopModeResync()`); обе точки отправки переведены на resync.
- Тесты: `PreviewContainer.test.tsx` describe "PreviewContainer mode resync
  (WV-03)" — (1) без эха счётчик постов продолжает расти (RED до фикса),
  (2) после эха с совпавшим enabled счётчик замораживается (guard).
  Гейты: typecheck OK, lint 0 ошибок, test 328 (26 файлов), build OK.
- Коммит: fix(webview): WV-03 re-post ds:set-mode until the runtime confirms.

## PROMPT-01 (P2) — запрос для ИИ: Markdown, минимум данных, явный статус правок
- Проблема: `contextToPrompt`
  (`src/domain/entities/DesignElementContext.ts`) собирал плоский список строк:
  посреди — шум (пустые стили, полные атрибуты при пустом контексте), файлы
  вышестоящих компонентов отбрасывались (в цепочке оставались только имена),
  статус «правки были / только пожелание» не формулировался явно, инструкции
  шли сплошным абзацем.
- Исправлено: переписан в Markdown с логическими блоками в фиксированном
  порядке — `# Инструкция…` → `## Задача` (проект + явный статус правок:
  «выполнено N / нет») → `PAGE DATA — START` (Элемент, Компонент + файлы
  вышестоящих компонентов, Стили и CSS — только при непустых, Возможные исходные
  файлы, Правки в редакторе) → `PAGE DATA — END` → `## Пожелание пользователя` →
  `## Порядок действий` (5 нумерованных шагов). Пустые секции пропускаются;
  вычисленные стили при пустом наборе не печатаются (раньше печаталась пустая
  строка). Каждый блок данных страницы ограждён маркерами; в конце —
  последовательные шаги: источник истины, поиск компонента, только перечисленные
  правки + пожелание, сохранение структуры/доступности/стиля, отчёт о файлах.
  Инварианты сохранены: маркеры `PAGE DATA — START/END`, `dataValue()` для всех
  страниц-производных строк (P1-5), протокол не менялся.
- Тесты: `DesignElementContext.test.ts` describe "contextToPrompt markdown
  structure" — ограждение вокруг страниц-производных данных (компонент/стили внутри,
  пожелание/шаги снаружи), явный статус правок (нет / N выполнено), стабильный
  порядок секций и пропуск пустых (3 теста). Обновлены закреплённые за старым
  форматом тесты в `SourceHintFinder.test.ts` describe "contextToPrompt" —
  сначала упали на новой структуре (RED), обновлены под неё.
- Коммит: refactor(prompt): PROMPT-01 structured Markdown AI instruction.

## Текущее состояние (2026-11-18): протокол v9

Всё выше — исторический аудит и ledger. Актуальное состояние после коммитов
`05f9b0d` (security hardening, protocol v8), `0dac41d` (IMP-G, UI фазы 1–2),
`9df444a` (IMP-A, protocol v9) и IMP-B (CSP-preserving инжекция).
Актуальный роадмап — `docs/IMPROVEMENT_PLAN.md` (IMP-A…IMP-F; IMP-A, IMP-B
и IMP-G выполнены); история версий протокола — `docs/PROTOCOL_CHANGELOG.md`; полная
таблица сообщений и handshake — в `docs/AI_HANDOFF.md`, раздел «Текущее состояние».

### Протокол v9 (кратко)

- `PROTOCOL_VERSION = "9"` (`packages/preview-runtime/src/protocol.ts`);
  каждое сообщение несёт `version` (строгое равенство `"9"` в
  `isRuntimeMessage`) и опциональный `sessionId` (≤128).
- 21 тип: `ds:runtime-ready`, `ds:ping`, `ds:pong`, `ds:set-mode`,
  `ds:mode-changed`, `ds:select`, `ds:apply-style`, `ds:style-applied`,
  `ds:apply-op`, `ds:op-applied`, `ds:navigate`, `ds:navigate-history`,
  `ds:navigate-blocked`, `ds:reload`, `ds:mark`, `ds:undo`, `ds:undone`,
  `ds:rect`, `ds:runtime-error`, `ds:replay`, `ds:replayed`.
- Добавлено после v6 (коммит 05f9b0d): `ds:mark` (бейдж элемента с
  pending-правками/комментарием) и `ds:undo`/`ds:undone` (DOM-снапшот до
  структурной операции по `requestId`, runtime хранит ≤50 снапшотов).
  `requestId` в apply-style/style-applied/apply-op/op-applied был уже в v6.
- Добавлено в v9 (IMP-A): `ds:replay` (`edits` ≤200 × `ReplayEdit`: kind
  style/text/classes/attribute, selector 1–500, property?, value ≤5000, forget?)
  и `ds:replayed` (`applied`/`skipped`, неотрицательные целые) — идемпотентное
  применение правок по селекторам без выбора элемента; `forget: true` удаляет
  запись из reapply-реестра (отмена правки).
- `ElementOp`: set-text, delete, duplicate, move-up, move-down, set-classes,
  set-attribute. `EDITABLE_ATTRIBUTES` = 40, `STYLE_PROPS` = 70. Пустое значение
  `set-attribute` удаляет атрибут; boolean-атрибуты зеркалируются в live DOM.
- Лимиты: style value ≤500, op value ≤5000, attribute value ≤2000,
  selectors ≤20×500, classes ≤30×100, text ≤2000, rules ≤8, component-цепочка ≤6,
  replay edits ≤200, replay value ≤5000.
- Handshake: runtime анонсирует `ds:runtime-ready` сразу после init (nonce
  опционален); webview шлёт `ds:ping` с nonce; все webview→iframe посты —
  с явным `targetOrigin` (preview origin), не `"*"`; ответы принимаются только
  от preview origin; `ds:set-mode` повторяется до эха `ds:mode-changed`
  (WV-03, 8×400 мс). Лимиты 64 КБ / 5 с — у WS-handshake прокси
  (`PreviewHostServer.ts`), не у postMessage.

### IMP-A: переживание правок (v9, коммит 9df444a)

- Журнал правок персистится хостом в `workspaceState` (`designStudio.journal.v1`,
  ≤20 маршрутов FIFO, sanitize полей); webview сохраняет с debounce 500 мс и
  запрашивает журнал при смене маршрута (`journal:save`/`journal:request`/
  `journal:loaded` — сообщения webview↔хост, вне ds:*-протокола).
- Runtime ведёт reapply-реестр (LRU ≤200) и переустанавливает уплывшие значения
  через MutationObserver (debounce 100 мс, проверки на равенство — без циклов).
- После reload страницы / перезагрузки окна webview реплеит журнал
  (`ds:replay`) на `ds:runtime-ready`; тост «Восстановлено правок: N».
- Undo всех видов правок: структура — снапшот `ds:undo` (только в памяти
  runtime, после reload отказ); style/text/classes/attribute — replay значения
  `before` с `forget: true`; комментарий — удаление записи журнала.

### IMP-B: CSP-preserving инжекция

- `src/infrastructure/preview/csp.ts`: адаптация CSP вместо снятия — `'self'`
  в source-списки, nonce сессии (`crypto.randomBytes(18).base64url`, на экземпляр
  хоста) в script-src/script-src-elem; nonce не добавляется к unsafe-inline-политикам
  без nonce/hash (защита inline-скриптов приложения); frame-ancestors и
  upgrade-insecure-requests удаляются; meta-CSP переписывается.
- CSP-заголовки enforce/report-only сохраняются адаптированными; nonce тот же,
  что на внешнем `/__ds-runtime.js` и inline-SW-сниппете.
- Политики с `sandbox` снимаются (fallback) с тостом в UI: хост → `onCspFallback`
  (дедуп по маршруту) → webview-сообщение `preview:csp-fallback` (вне ds:*-протокола,
  версия осталась v9).
- Fixture `fixtures/static-site/csp.html`; тесты csp/proxyHtml/PreviewHostServer.

### Security hardening (05f9b0d) — актуальное состояние

- NTFS ADS deny: сегменты пути с `:` (`.env::$DATA`) → 403.
- SSRF-гейт `upstream-validation.ts` с DNS-resolve валидацией (все адреса
  loopback), только http/https, без userinfo.
- URL-атрибуты (href/src/poster/action): `javascript:`/`vbscript:`/
  `data:text/html` блокируются (с вырезанием control-символов).
- Cookie jar изолирован по upstream-origin (`origin|path|name`, LRU 512).
- CSP страницы снимается полностью (заголовки и `<meta http-equiv>`) —
  известное ограничение, IMP-B добавит nonce-инжекцию.
  (На момент 05f9b0d; текущее поведение — IMP-B ниже.)
- Промпт ИИ: контент страницы — недоверенные PAGE DATA внутри ограждения;
  пожелание пользователя — снаружи.
- `StylePersistenceAdapter` перечитывает файл перед `WorkspaceEdit`;
  `ComponentResolver` — TTL 30 с + LRU-кэш (≤100 записей).

### Гейты и известные ограничения

- Baseline: typecheck/lint/build чистые; `npm test` — 505 тестов / 37 файлов,
  зелёные.
- Ограничения (RC1–RC5 в `docs/IMPROVEMENT_PLAN.md`): style/text/classes/attribute
  переживают reload/ререндер/HMR и перезагрузку окна (IMP-A: журнал в
  workspaceState + replay); структурные операции после reload не восстанавливаются
  (снапшоты только в памяти runtime), их undo отвечает отказом; ёмкость ≤20
  маршрутов / ≤200 reapply-записей / ≤50 снапшотов; детекция компонентов только
  в React dev mode; CSP сохраняется адаптированным (IMP-B), политики с sandbox
  снимаются с предупреждением; e2e в живом VS Code ещё нет (IMP-D).
