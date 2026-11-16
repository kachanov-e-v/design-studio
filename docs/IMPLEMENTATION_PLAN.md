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
