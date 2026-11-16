# IMPLEMENTATION PLAN (EPIC A)

Дата аудита: рабочее дерево на ветке `master` с незакоммиченным рефакторингом протокола v2/v3 (атрибуты, outlines в iframe). Задача: превратить preview в полноценный браузер с раздельными режимами, начиная с политики навигации по ссылкам.

## Baseline команд

| Команда | Результат |
|---|---|
| `npm ci` | ОК (предупреждение о postinstall esbuild — стандартное) |
| `npm run typecheck` | ОК, 0 ошибок |
| `npm run lint` | ОК, 0 замечаний |
| `npm test` | 121/121 прошли |
| `npm run build` | ОК, все артефакты верифицированы |

## Event flow (as-is)

```
DOM события (iframe) → packages/preview-runtime/src/index.ts (capture listeners)
  → postMessage protocol v2 (styled/validated) → webview/components/PreviewContainer.tsx
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
- План: registry типизированных PropertyDefinition + контекстные атрибуты по тегу; расширение whitelist атрибутов протокола с поддержкой toggle (set/remove) — потребует `PROTOCOL_VERSION = 4`.

### RC5. Производительность hover (EPIC E, не начат)

- `collect()` в `index.ts` вызывается только при select/операциях — уже не на pointermove. Hover только двигает outline через rAF. Остаточные пункты: разделение hover/selection payload не требуется (hover payload не отправляется вовсе); требует профилирования и проверки «не собираем ли мы что-то лишнее при select».

### RC6. Безопасность proxy/persistence (EPIC F, не начат)

- `proxy-html.ts` `targetFromProxyPath()` и `PreviewHostServer.fetchWithFallbacks()` принимают внешние URL-кандидаты; сопоставить с обещанием `docs/SECURITY.md` (только loopback), централизовать валидацию, DNS-rebinding, redirect re-validation, tests.
- `resolveProjectPath`: проверить symlink escape через realpath.

## Порядок работ

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
- [ ] **C6. Origin-проверки runtime.** Защита sessionId/nonce не защищает от JS самой страницы (значения ей известны): `style:persist`, `source:reveal`, `ai:copyComponent` управляются недоверенными данными. Проверка CSS-свойств/значений и realpath-проверка пути сделаны хорошо и остаются. Но `postMessage(..., "*")` и условие `!parentOrigin.includes("vscode-webview")` — слабая проверка origin, заменить на точную.
- [ ] **C7. Зависимости.** `npm audit`: 11 уязвимостей (2 critical, 1 high, 8 moderate) в dev-зависимостях (vitest/tinypool, esbuild ≤0.24). В пакет расширения не попадают, но обновить vitest/vite/esbuild.

## D. Недоработки репозитория

- [ ] **D1.** Нет файла LICENSE, хотя README заявляет MIT.
- [ ] **D2.** package.json: заглушка `publisher: design-studio`, нет `repository`, `icon`, `keywords`; `onCommand` в `activationEvents` избыточен.
- [ ] **D3.** Нет CI (`.github` отсутствует): typecheck, lint, test, build, npm audit.
- [ ] **D4.** lint не покрывает `packages/` и `scripts/`.
- [ ] **D5.** Нет тестов для openDesignStudio.ts, runtime/index.ts (711 строк), App, PreviewContainer, Inspector — там сидит баг A1.
- [ ] **D6.** `webview/public/runtime.js` (1045 строк) и `protocol.js` закоммичены как сборочные артефакты. Сейчас в синхроне, но риск расхождения — добавить в `.gitignore` (учесть, что для установки из исходников нужна сборка перед упаковкой).

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
