# Инструкция для ИИ-агента: исправление и развитие Design Studio

> Файл: `docs/AI_AGENT_INSTRUCTIONS.md`
> Репозиторий: `kachanov-e-v/design-studio`, ветка `master`, коммит `46c1fe5` (16.11.2026).
> Основание: полный аудит исходников, конфигов, тестов и документации; ключевые баги
> подтверждены воспроизведением логики кода. Работай фазами, каждое исправление —
> с регрессионным тестом и обновлением документации.
> См. также актуальный план закрытия аудита: `docs/AI_AGENT_FIX_PLAN.md` (навигация,
> runtime-анонс, журнал правок, бюджеты; частично замещает устаревшие места этого файла).

---

## 1. Роль, цель и жёсткие ограничения

Ты — кодовый агент, работающий в этом репозитории. Цель: исправить подтверждённые ошибки,
закрыть недочёты и подготовить расширение к публикации, не сломав существующую архитектуру.

**Неприкосновенные инварианты (не ослаблять ни при каких правках):**
- SSRF-гейт `src/infrastructure/preview/upstream-validation.ts`: только loopback-upstream
  (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`, `::ffff:127.x.x.x`, `0.0.0.0`), только
  http/https, без userinfo. Проверяется ДО открытия сокета, включая WebSocket-upgrade и редиректы.
- Проверка `Host` в `PreviewHostServer.hostAllowed` (защита от DNS rebinding).
- Канонический jail `resolveProjectPath` (realpath корня и глубочайшего существующего предка).
- Лимиты: тело запроса 10 МБ, ответ 20 МБ, таймаут заголовков 30 с, WS-connect 5 с.
- Валидация всех сообщений протокола (`isRuntimeMessage`, `isElementPayload`) и лимиты длин.
- Маркеры `PAGE DATA — START/END` и экранирование переводов строк в промпте (`dataValue`).
- Расширение НЕ вызывает ИИ-сервисы, MCP, агентские API; буфер обмена — только по кнопке пользователя.
- Паритет RU/EN (`src/shared/i18n.ts`); язык интерфейса и инструкции связан.
- Сборочный конвейер и маркеры `scripts/verify-build.js` (`initDesignStudioRuntime`, IIFE
  `DesignStudioRuntime`); сборочные артефакты `webview/public/runtime.js|protocol.js` не коммитить.
- При изменении протокола: обновлять ОБЕ стороны (runtime + webview), валидаторы, тесты и
  `PROTOCOL_VERSION` (на момент написания — "6"; текущая версия — в `docs/PROTOCOL_CHANGELOG.md`); пересобирать `npm run build`.

**Baseline перед любыми правками (всё должно быть зелёным):**

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src webview packages/preview-runtime/src scripts
npm test            # vitest run (178 тестов в 16 файлах)
npm run build       # ext → runtime → copy → webview → inline demo → verify
```

**Definition of Done для каждой задачи:** код + регрессионный тест (красный до фикса, зелёный
после) + typecheck/lint/test/build зелёные + обновлены затронутые docs + запись в
`docs/IMPLEMENTATION_PLAN.md` (ledger проекта). Коммиты — маленькие, тематические, в стиле
истории репозитория (conventional commits, ссылки на ID задач ниже).

---

## 2. Карта проекта (что где лежит)

| Путь | Ответственность |
| --- | --- |
| `src/extension/extension.ts` | Активация, команда `design-studio.open` |
| `src/extension/commands/openDesignStudio.ts` | Панель-webview, singleton `PreviewHostServer`, обработчики сообщений webview, CSP, состояние проекта/сервера/демо |
| `src/infrastructure/preview/PreviewHostServer.ts` | Loopback HTTP-хост: `/proxy/...`, голые маршруты (sticky target/Referer), `/project/` jail, `/demo.html`, `/__ds-runtime.js`, `/__ds-sw.js`, cookie jar, WS-relay |
| `src/infrastructure/preview/proxy-html.ts` | Инъекция `<base>`+runtime, переписывание CSS `url()`, `HEADERS_TO_STRIP`, service worker |
| `src/infrastructure/preview/DevServerDetector.ts` | Кандидаты из package.json, TCP/HTTP-пробы, fingerprint, title-match |
| `src/infrastructure/preview/projectEntryScanner.ts` | Поиск `.html/.htm` в проекте (depth ≤ 6, ≤ 200) |
| `src/infrastructure/persistence/*` | `StylePersistenceAdapter` (поиск правила, WorkspaceEdit), `CssSourceResolver` (source maps, VLQ), `cssText` (рукописный CSS-парсер) |
| `src/infrastructure/source-analysis/*` | `ComponentResolver` (bundler-пути), `SourceHintFinder` (токен-поиск по workspace) |
| `src/infrastructure/ai/PromptExportService.ts` | Экспорт инструкции/исходника в буфер, reveal компонента |
| `src/domain/entities/*` | `DesignEdit`, `DesignElementContext` (сборка промпта) |
| `src/shared/*` | `url.ts` (loopback), `i18n.ts`, `tailwind.ts`, `protocol.ts` (реэкспорт) |
| `packages/preview-runtime/src/*` | Браузерный runtime: `index.ts` (выбор/правки/контуры/клики), `protocol.ts` (контракты+валидаторы), `fiber.ts` (React owner chain), `perf.ts` |
| `webview/*` | React UI: `App.tsx`, `PreviewContainer.tsx` (iframe+handshake), `Inspector.tsx`, `propertyRegistry.ts`, `Toolbar.tsx`, `SelectionPopup.tsx`, `FloatingPanel.tsx`, `bridge.ts`, `persistContract.ts`, `types.ts` |
| `scripts/*` | `copy-runtime.js`, `inline-demo-runtime.js`, `verify-build.js` |
| `fixtures/static-site/*` | Статическая фикстура для интеграционных тестов |
| `docs/*` | ARCHITECTURE, DEVELOPMENT_GUIDE, TROUBLESHOOTING, SECURITY, AI_HANDOFF, IMPLEMENTATION_PLAN, LEGACY_CLEANUP |

Поток данных: webview (React) ⇄ extension (`postMessage`) ⇄ runtime в iframe
(версионированный протокол `ds:*`, sessionId/nonce/requestId) ⇄ preview-хост ⇄ dev-сервер.

---

## 3. P0 — Критические функциональные ошибки (исправлять первыми)

### P0-1. Статический режим `/project/`: `<base>` ломает все относительные URL
**Где:** `PreviewHostServer.serveProjectPath` → `injectIntoHtml(htmlContent, "/__ds-runtime.js", this.origin)`.
**Суть:** в HTML проекта внедряется `<base href="http://127.0.0.1:PORT">` — БЕЗ `/project/` и без
директории страницы. В браузере `href="styles.css"`, `src="images/logo.svg"`, `href="about.html"`
(фикстура `fixtures/static-site/index.html`) резолвятся в `http://127.0.0.1:PORT/styles.css` и т.п.
Голый путь без `/proxy/`-Referer и без sticky target (в проектном режиме `devTarget = null`) → **404**.
Не работают стили, картинки и межстраничная навигация статического режима.
**Почему тесты зелёные:** `fixtures.test.ts` проверяет только наличие подстрок (`"<base"`,
`'<script src="/__ds-runtime.js"></script>'`) и ходит напрямую на `/project/styles.css` —
резолвинг относительных URL браузером не проверяется.
**Воспроизведение:** сериализуй `serveProjectPath` на фикстуре — в `<head>` окажутся
`<base href="http://127.0.0.1:PORT">` и два runtime-скрипта; относительный `styles.css` → `/styles.css`.
**Фикс:**
1. Передавать в `injectIntoHtml` base вида `${this.origin}/project/${posixDirname(relativePath)}/`
   (для `/project/` → `/project/`; кодировать сегменты, см. P2-9).
2. Не внедрять `<base>`, если в документе уже есть свой `<base>` (уважать авторский base;
   сейчас инъекция ставится ПЕРЕД ним и переопределяет его).
3. Альтернатива/дополнение: переписывать относительные `href/src` в HTML проекта на `/project/...`
   (как сделано для CSS `url()`), тогда base не нужен.
**Приёмка:** браузерный тест (Playwright, см. §7): открыть `/project/index.html` фикстуры —
`styles.css` и `logo.svg` загружены (200), клик по `about.html` открывает `/project/about.html`,
заголовок страницы виден. Юнит-тест: base содержит `/project/` и директорию вложенной страницы.

### P0-2. Двойная инъекция runtime + отсутствие guard повторной инициализации
**Где:** `serveProjectPath` вызывает `injectRuntimeIntoHtml` (тег без defer) И `injectIntoHtml`
(тег `data-design-studio="1" defer`) — два одинаковых `src="/__ds-runtime.js"`.
`packages/preview-runtime/src/index.ts`: автозапуск `initDesignStudioRuntime()` в конце модуля,
внутри функции НЕТ защиты от повторного вызова.
**Следствия:** два экземпляра runtime: дублированные `pointerdown/click/message`-слушатели
(двойные `ds:select`), 4 outline-div, двойной патч `history.pushState/replaceState`
(двойные `ds:navigate`), двойная обработка `ds:apply-op`.
**Фикс:**
1. Одна точка инъекции для проектных страниц (убрать `injectRuntimeIntoHtml` из `serveProjectPath`,
   оставить `injectIntoHtml`; либо сделать `injectIntoHtml` идемпотентным по маркеру
   `data-design-studio`/`/__ds-runtime.js`).
2. Guard в runtime: `if ((window as any).__dsRuntimeInitialized) return; (window as any).__dsRuntimeInitialized = true;`
   в начале `initDesignStudioRuntime` (защита от любых будущих повторных инъекций, в т.ч. HMR).
**Приёмка:** тест: в HTML проекта ровно один тег runtime; jsdom-тест: повторный вызов
`initDesignStudioRuntime()` не добавляет слушатели/контуры; браузерный тест: один `ds:select` на клик.

### P0-3. Политика ссылок browse-режима мертва: `data-upstream-origin` нигде не устанавливается
**Где:** runtime `index.ts` читает `runtimeScript?.dataset.upstreamOrigin`;
`proxy-html.ts`: `RUNTIME_SCRIPT_ATTRS = ' data-design-studio="1" defer'` — атрибута
`data-upstream-origin` нет ни в `buildInjectedHead`, ни в `rewriteProxiedHtml`, ни в проектном пути.
**Следствия:** `upstreamOrigin === null` → обработчик `click` в browse-mode выходит на
`if (!anchor || !upstreamOrigin ...) return;` → ВСЕ ссылки работают нативно:
- внешние ссылки уводят iframe из превью (ломается сессия/прокси);
- `javascript:`/`data:`/`blob:`-ссылки не блокируются;
- `ds:navigate-blocked` не отправляется никогда; UI-статус `externalLinkBlocked` недостижим.
Это прямо противоречит README, ARCHITECTURE.md §8, SECURITY.md, AI_HANDOFF (EPIC B/C) и
IMPLEMENTATION_PLAN (RC-описание кликов).
**Фикс:**
1. Прокинуть upstream origin в инъекцию: `rewriteProxiedHtml(html, finalTargetUrl, ...)` уже знает
   `targetOriginPrefix(finalTargetUrl)` — добавить в тег runtime
   `data-upstream-origin="${new URL(finalTargetUrl).origin}"` (расширить `buildInjectedHead`/`injectIntoHtml`
   параметром, экранировать кавычки).
2. Для проектного режима политика не нужна (все ссылки same-origin `/project/`), но dangerous-schemes
   стоит блокировать и там: передавать origin preview-хоста либо отдельный флаг.
3. Fallback в runtime: если атрибута нет — выводить origin из `<base href>`/`location` (но основной
   путь — явный атрибут).
**Приёмка:** юнит-тест инъекции (атрибут присутствует, значение = origin upstream);
jsdom/браузерный тест: клик по внешней ссылке в browse → `ds:navigate-blocked`, iframe не покидает
preview; клик по `javascript:`-ссылке заблокирован; same-origin ссылка навигируется внутри.

### P0-4. «Сохранить стили»: гонка параллельных записей + потеря очереди
**Где:** `webview/App.tsx handleSave` шлёт ВСЕ `pendingStyles` циклом без ожидания;
`openDesignStudio.ts` обработчик `style:persist` асинхронный и не сериализован;
`StylePersistenceAdapter.apply` каждый раз сканирует до 200 CSS-файлов и делает `WorkspaceEdit`
по offset'ам из `doc.getText()`.
**Следствия:**
- две правки в один файл: второй edit считается по устаревшему тексту/версии документа →
  `applyEdit` падает («Failed to apply edit») или правит не то место;
- `App` на `persist:result` с `success: true` делает `setPendingStyles([])` — первый успех
  очищает ВСЮ очередь, последующие отказы теряются для пользователя;
- N правок = N полных сканов workspace (тормоза).
**Фикс:**
1. Сериализовать персист в extension: очередь/mutex на `style:persist` (или один батч-месседж
   `style:persist-batch` с массивом правок и ОДНИМ `WorkspaceEdit` на файл).
2. Добавить `requestId` в `style:persist`/`persist:result` (по аналогии со стилями) и удалять
   из `pendingStyles` только подтверждённые правки; показывать per-edit статус.
3. Переиспользовать результат скана CSS между правками одного батча.
**Приёмка:** интеграционный тест (mock vscode): 3 правки в один файл — все применены, порядок
детерминирован; при отказе второй правки первая и третья не теряются из очереди; тест на
корреляцию requestId.

---

## 4. P1 — Безопасность и надёжность

### P1-1. `postMessage("*")` в обе стороны + отсутствие проверки `event.origin`
**Где:** `PreviewContainer.tsx` — все `iframe.contentWindow.postMessage(..., "*")`;
обработчик `message` проверяет только `event.source === iframe.contentWindow`, но не `event.origin`.
Runtime `index.ts`: `parentOrigin = "*"` до ping; `ds:ping` принимается от ЛЮБОГО родителя
(`event.source === window.parent`), `postToParent` шлёт с `"*"`.
**Векторы:**
- пока preview-хост жив, любая веб-страница может встроить `http://127.0.0.1:PORT` в iframe,
  прислать `ds:ping`, получить сессию и читать данные элементов (`ds:select` уходит с `"*"`) —
  эксфильтрация содержимого проектных страниц;
- прокси сознательно отпускает внешние редиректы (OAuth) нативно: iframe может оказаться на
  чужом origin, а webview продолжит слать туда `ds:ping`/`ds:apply-*` с sessionId и payload'ами;
  чужая страница, зная sessionId, может слать поддельные `ds:select` → prompt-injection в инструкцию.
**Фикс:**
1. Webview → iframe: `targetOrigin = new URL(url).origin` вместо `"*"` (все вызовы).
2. В обработчике webview: `if (event.origin !== expectedOrigin) return;` (expectedOrigin из `state.url`).
3. Runtime: принимать `ds:ping` только от доверенных origin (allowlist `vscode-webview://*` +
   явный список, передаваемый при инъекции) ЛИБО требовать секрет, передаваемый в URL/атрибуте
   скрипта при инъекции (nonce, который знает только extension); отвечать строго на
   `event.origin` ping'а, никогда на `"*"`.
4. После навигации iframe на внешний origin — прекращать отправку (проверять origin перед каждым send).
**Приёмка:** тесты: сообщение с чужого origin игнорируется; ping без секрета/от недоверенного
origin не активирует сессию; postMessage вызывается с конкретным targetOrigin.

### P1-2. Preview-хост и cookie jar живут после закрытия панели
**Где:** `openDesignStudio.ts`: `sharedHostServer` останавливается только через
`context.subscriptions` (деактивация расширения). `panel.onDidDispose` лишь обнуляет `activePanel`.
**Следствия:** после закрытия панели порт продолжает обслуживать `/project/` (файлы проекта),
прокси и cookie jar с сессией приложения. `docs/SECURITY.md` утверждает «порт живёт только пока
открыт preview» — документация не соответствует коду.
**Фикс:** останавливать сервер (`stop()`, очистка jar) при dispose последней панели; либо
idle-таймаут (например, 5 минут без запросов) + явная очистка jar при закрытии. Синхронизировать
SECURITY.md. Учесть: `ensureHostServer` пушит новый dispose-subscription на каждое создание —
не накапливать подписки.
**Приёмка:** тест: dispose панели → `server.running === false`, jar пуст; повторное открытие —
новый порт, старая сессия не переиспользуется.

### P1-3. Обход блокировки `.git/.env` через симлинк внутри проекта + узкий denylist
**Где:** `resolveProjectPath`: сегменты `.git`, `node_modules`, `.env*` проверяются по
ЗАПРОШЕННОМУ пути, а не по каноническому (realpath). Симлинк `assets → .git` внутри workspace
проходит сегмент-проверку и realpath-jail (цель внутри корня) → читается `.git/config` и т.п.
Прочие секреты (`.npmrc`, `.ssh/`, `*.pem`, `*.key`, `id_rsa`, `credentials*`, `.envrc`) отдаются как есть.
**Фикс:** после вычисления `real` проверять denylist по сегментам `path.relative(rootReal, real)`;
расширить denylist (минимум: `.npmrc`, `.yarnrc`, `.ssh`, `.aws`, `.gnupg`, `*.pem`, `*.key`,
`*.p12`, `*.pfx`, `id_rsa*`, `.envrc`, `.htpasswd`); рассмотреть allowlist расширений для `/project/`.
**Приёмка:** тесты с симлинком на `.git` и на `.env` внутри корня → 403; тест denylist по realpath.

### P1-4. Нет проверки Origin у входящих запросов preview-хоста; sec-fetch-* не нормализуются
**Где:** `PreviewHostServer.handle`/`handleUpgrade` — Host-проверка есть, Origin-проверки нет.
`buildForwardHeaders` переписывает `origin`/`referer`, но форвардит `sec-fetch-site: cross-site`
как есть.
**Векторы/эффекты:** вредоносная страница может слать no-cors GET/POST на loopback-порт
(Host совпадает) — использовать хост как прокси к другим loopback-сервисам и читать файлы
`/project/` через сайд-эффекты; Next.js server actions могут отклонять запросы по
`Sec-Fetch-Site`/`Origin`-эвристике.
**Фикс:**
1. Отклонять запросы, у которых `Origin` присутствует и не равен preview-origin /
   `vscode-webview://*` (для навигаций Origin может отсутствовать — это нормально).
2. При проксировании: если переписан `origin`, приводить `sec-fetch-site` к `same-origin`
   (и `sec-fetch-mode`/`dest` оставлять как есть) — задокументировать.
**Приёмка:** тест: POST с `Origin: https://evil.example` → 403; тест: upstream получает
`sec-fetch-site: same-origin` и свой origin.

### P1-5. Prompt-injection: не все page-derived поля экранируются
**Где:** `DesignElementContext.contextToPrompt`: `dataValue()` применён к text/styles/rules/hints,
но НЕ к `edit.selector`, `edit.operation`, `edit.component.file/name`, `componentLine` (file/name),
`ctx.selector`, `ctx.classes`. Значения приходят со страницы (fiber-пути, классы) и из webview.
Страница может подделать `_debugSource.fileName` с переводами строк → форжировать строки промпта
внутри блока данных.
**Фикс:** пропускать ВСЕ page-derived строки через `dataValue()` (включая поля edits и компонентов);
валидировать edits в обработчике `ai:copyInstruction` (kind/selector/property — строки с лимитами).
**Приёмка:** тест: payload с `\n` в selector/file/classes → в промпте нет сырых переводов строк
внутри DATA-блока; маркеры не форжируются.

---

## 5. P2 — Недочёты (функциональные и UX)

| ID | Где | Проблема | Фикс |
| --- | --- | --- | --- |
| P2-1 | `webview/types.ts` | Дублирует типы протокола; `EditableAttribute` = 8 значений против 40 в `protocol.ts`; `ElementPayload`/`ElementOp`/`SourceRule` копируются. Касты `as EditableAttribute` в Inspector скрывают расхождение | Импортировать типы из `@design-studio/preview-runtime/protocol`; `types.ts` оставить только для webview-специфичного (`PreviewStateMessage`, `DevServerSuggestion`) |
| P2-2 | `propertyRegistry.ts` + `protocol.ts` | Редактор `filter` есть, но `filter` нет в `STYLE_PROPS` → значение никогда не собирается/не показывается, before-value пустой | Добавить `filter` в `STYLE_PROPS` (и иные редакторы без пары — сверить полным diff), bump `PROTOCOL_VERSION`, обновить тесты валидатора |
| P2-3 | runtime `collectSourceRules` | Итерирует только верхний уровень `cssRules`: правила внутри `@media/@supports/@layer/@container` (Tailwind v4!) невидимы для «Сохранить стили» и промпта | Рекурсивно обходить `CSSGroupingRule.cssRules` (с общим лимитом scanned); тест с @media-правилом |
| P2-4 | `tailwind.ts conflicts()` | Грубые группы: добавление `pt-4` удаляет `px-8`/`py-2` (все `p*` конфликтуют со всеми `p*`); теряются несоответствующие оси/стороны | Конфликт по точной оси/стороне (p↔p/px/py/pt..., pt↔pt/py/p), аналогично m; тесты на сохранение px при pt |
| P2-5 | `Inspector.tsx` | slider/color применяют значение на каждый `onChange` → шквал `ds:apply-style` + полный `collect()` на каждый тик | Троттлинг rAF/debounce ~100 мс, финальный commit на `onPointerUp`/`change`; одна запись в journal на жест |
| P2-6 | `SelectionPopup.tsx` | Не следует за скроллом/ресайзом iframe (rect снят при клике); нет кнопки закрытия; Escape лишь blur'ит textarea | Runtime: постить обновлённый rect по scroll/resize (новое сообщение `ds:rect` либо повторный select-lite); скрывать/перепозиционировать popup; добавить close |
| P2-7 | `StylePersistenceAdapter.editRule` | Regex может попасть в объявление ВЛОЖЕННОГО правила (CSS nesting) или в комментарий; `doc.save()` сохраняет и чужие unsaved-изменения пользователя | Парсить объявления только верхнего уровня тела (учёт вложенных `{}`/комментариев; лучше — postcss); сохранять только свой edit (или предупреждать о dirty-документе) |
| P2-8 | `SourceHintFinder` | Держит в памяти содержимое до 3000 файлов × 300 КБ (сотни МБ в монорепо) | Сканировать потоково/чанками без удержания всех текстов; хранить только найденные сниппеты; снизить лимиты |
| P2-9 | `openDesignStudio.projectUrl` | Entry не кодируется: пробелы/`#`/`?` в имени файла ломают URL | `encodeURIComponent` по сегментам; тест с `my page#1.html` |
| P2-10 | `openDesignStudio.postState` | `status` определяется `url.includes("/project/")` — dev-маршрут `/project/x` классифицируется как project | Явный режим в состоянии (entry/demo/devserver), не подстрока URL |
| P2-11 | `i18n.ts` + `Toolbar.tsx` | `toolbar.serverDown` = «Сервер обнаружен» (должно быть «не запущен»); кнопка режима показывает СОСТОЯНИЕ («Просмотр»), а README говорит «Нажмите Редактировать» | Исправить подпись serverDown; кнопку сделать действием («Редактировать»/«Просмотр» как целевой режим) либо синхронизировать README/docs; `toolbar.edit/editOn` переименовать по смыслу |
| P2-12 | `fiber.ts findFiber` | `startsWith("__reactInternal$")` никогда не матчит React 16 `__reactInternalInstance$...` | Исправить префикс или убрать legacy-ветку с комментарием |
| P2-13 | протокол/статусы | Аудит считал `ds:runtime-ready` и `ds:runtime-error` мёртвыми сущностями; с тех пор продюсеры реализованы (runtime-ready отправляется runtime-ом после init, runtime-error — из catch), статус мгновенного подключения работает | Закрыто; webview слушает оба события (см. `docs/AI_AGENT_FIX_PLAN.md`, RT-01 — origin непосредственного родителя) |
| P2-14 | `PreviewHostServer` | `MIME_TYPES` без `.wasm/.map/.avif/.mp4/.webm/.otf/.eot`; нет Range для `/project/` (seek видео не работает); синхронные `fs.readFileSync` блокируют extension host | Дополнить MIME; поддержать Range/206 для статики; перевести чтение на `fs.promises`/streams |
| P2-15 | cookie jar | Ключ `origin\|name` игнорирует Path — одноимённые cookie разных путей затирают друг друга; jar не ограничен по размеру | Ключ `origin\|path\|name` с матчингом путей (или документировать упрощение); LRU-лимит |
| P2-16 | `DevServerDetector` | `probePort` только 127.0.0.1 (серверы на ::1 считаются «down»); `vite preview` → порт 5173 вместо 4173; `-p4000` и `PORT=4000` не парсятся; `build`-скрипты дают кандидатов | Пробовать оба loopback; паттерн `vite preview`→4173; парсить слитный `-p` и env `PORT=`; фильтровать не-dev скрипты |
| P2-17 | runtime `getSelector`/`duplicate` | Обрезанный до 6 уровней селектор может быть неуникальным; клон сохраняет id потомков (дубли id в DOM) | Проверять уникальность `querySelectorAll` и добавлять nth-цепочку до body; при duplicate снимать id у потомков (или помечать) |
| P2-18 | `Inspector.tsx` | Текстовое поле не коммитится по blur (README обещает); мёртвый guard `def.name === "type" && def.tags.length === 0` | Добавить onBlur commit; убрать мёртвый guard |
| P2-19 | `Toolbar.tsx` | `select value=""` в idle не матчит ни одной option (React warning); placeholder серверного поля обещает «путь страницы», но `project:setDevServer` пути отклоняет | Добавить пустую disabled-option; уточнить placeholder/подсказку |
| P2-20 | `App.tsx` | Нет React ErrorBoundary — падение компонента обнуляет панель | Обернуть App в ErrorBoundary с кнопкой перезагрузки |
| P2-21 | `CssSourceResolver`/`cssText` | Точное строковое сравнение селекторов: `:before` vs `::before`, разный порядок запятых, escape-нормализация браузера → ложные «не найдено»; VLQ-декодер без ограничения shift | Нормализовать селекторы (псевдо-элементы, пробелы) перед сравнением; ограничить shift в decodeVlq |
| P2-22 | `openDesignStudio` | Часть строк RU/EN зашита инлайн-тернарниками мимо `i18n.ts`; `import` в середине файла; `findProjectEntries`/`detectDevServers` запускаются на каждый postState (в т.ч. в демо) | Все строки — в i18n; импорты наверх; кэшировать entries/детект с инвалидацией по refresh |

---

## 6. P2-D — Устаревшая документация (синхронизировать с кодом)

1. `docs/DEVELOPMENT_GUIDE.md`:
   - «дважды кликните неинтерактивный элемент…» — double-click удалён (в runtime нет dblclick-обработчика);
   - «Кнопка **Правка: вкл./выкл.**» — реальные подписи «Просмотр»/«Редактировать» (см. P2-11);
   - «Runtime выводит `Design Studio runtime loaded`» — лог удалён (LEGACY_CLEANUP), маркер теперь `initDesignStudioRuntime`.
2. `docs/TROUBLESHOOTING.md`: тот же удалённый `console.log` в шаге 4; «Правка: вкл.» в шаге 1.
3. `README.md`: «список изменений со значениями до и после» — в UI есть только счётчик правок
   (`FloatingPanel`), список before/after существует лишь в экспортируемом тексте. Либо добавить
   UI-список (см. P3-8), либо переформулировать. Шаг 6 «Нажмите Редактировать» — см. P2-11.
4. `docs/SECURITY.md`: «порт… живёт только пока открыт preview» — неверно до фикса P1-2.
5. `docs/README.md`: нет ссылок на AI_HANDOFF / IMPLEMENTATION_PLAN / LEGACY_CLEANUP.
6. После фикса P0-3: проверить, что описания политики ссылок соответствуют реально работающему коду.

---

## 7. P3 — Инженерия, тулинг, публикация

### P3-1. CI (`.github/workflows/ci.yml`)
- `npm audit --omit=dev` — NO-OP: в `package.json` НЕТ `dependencies` (все dev). Заменить на
  `npm audit --audit-level=high` (по всем) и убрать `continue-on-error` для high/critical
  (moderate — advisory-шаг отдельно).
- Добавить `permissions: contents: read`, `concurrency` (group по ref, cancel-in-progress).
- Матрица Node 20/22 (vite 7 требует ≥20.19/22.12); `@types/node ^24` не соответствует CI Node 20 —
  выровнять (types 20/22 либо CI 22+).
- Шаг упаковки: `npx @vscode/vsce package` + upload `.vsix` артефактом; smoke `verify-build`.
- Кэш npm уже есть; добавить кэш для `packages/preview-runtime` после перевода на workspaces.

### P3-2. Зависимости и линт
- ESLint 8.57 + `.eslintrc.cjs` — EOL. Мигрировать на ESLint 9 flat config (`eslint.config.mjs`) +
  `typescript-eslint` 8 (закроет оставшиеся 7 moderate из аудита C7) + `eslint-plugin-react-hooks`
  (обязательно: в App/PreviewContainer много ref-паттернов) + `eslint-plugin-jsx-a11y` (опц.).
- esbuild 0.21.5 → ^0.25.x (в т.ч. advisory GHSA-67mh-4wv8-2f99 для dev-сервера esbuild ≤0.24.2).
- React 18.3.1 — допустимо; обновление до 19 — отдельной задачей (fiber.ts уже учитывает React 19).
- Добавить `.github/dependabot.yml` (npm, weekly, grouped dev-minors).

### P3-3. Монорепо и сборка
- Перевести на npm workspaces (`"workspaces": ["packages/*"]`), удалить второй lock-файл
  `packages/preview-runtime/package-lock.json` (дрейф версий esbuild).
- `packages/preview-runtime/tsconfig.json`: исключить `*.test.ts` из emit (сейчас тесты попадают в dist);
  убрать дублирующий `build:types`.
- Разделить tsconfig: `tsconfig.extension.json` (node, без DOM), `tsconfig.webview.json` (DOM),
  runtime — свой; корневой — solution references. Сейчас DOM-lib доступен расширению, а node-типы — webview.
- Унифицировать импорты протокола: сейчас три стиля (`@design-studio/preview-runtime/*` в webview,
  `../../packages/...` в src, реэкспорт `src/shared/protocol.ts`). Оставить алиасы везде и добавить
  соответствующие alias в esbuild-команду `build:ext` (сейчас их там НЕТ — скрытая ловушка).
- DX: watch-таски (`esbuild --watch`, `vite build --watch`, `tsc -w`) и облегчённый `preLaunchTask`
  (полный `npm run build` на каждый F5 — медленно); `.editorconfig` + prettier (опц.).

### P3-4. Манифест расширения (`package.json`)
- Marketplace: `icon` (128×128 PNG), `galleryBanner`, `bugs`, `homepage`, уточнить `categories`;
  версия 0.0.1 → 0.1.0 к первому релизу; `CHANGELOG.md`.
- `capabilities`: `untrustedWorkspaces: { supported: false, description: ... }` (расширение читает/пишет
  файлы и поднимает сервер), `virtualWorkspaces: false` (нужна реальная FS).
- `extensionKind: ["workspace"]` (сервер и FS должны жить там, где проект; важно для Remote/WSL).
- `engines.node`, `packageManager`; скрипты `"package": "vsce package"`, `"publish": "vsce publish"`;
  devDep `@vscode/vsce`.
- Заголовок команды локализовать через `package.nls.json`/`package.nls.ru.json` (`%designStudio.open.title%`).

### P3-5. Упаковка (`.vscodeignore`)
- Сейчас в VSIX попадают `fixtures/**`, `scripts/**`, `.github/**`, корневой `package-lock.json`,
  `.gitignore` — добавить исключения.
- `docs/**` исключён, но README ссылается на docs относительными ссылками — на Marketplace они
  битые: заменить на абсолютные `https://github.com/kachanov-e-v/design-studio/blob/master/docs/...`.

### P3-6. Тесты (закрыть открытый пункт D5 плана)
- Инфраструктура: `vitest` environment `happy-dom`/`jsdom` для `packages/preview-runtime` и `webview`
  (отдельный workspace/projects конфиг), `@testing-library/react`.
- Юнит-тесты runtime `index.ts`: handshake (ping/pong, версии, sessionId), set-mode, select-payload,
  все ops (включая блокировки javascript:/password), apply-style лимиты, double-init guard (P0-2),
  link-policy (P0-3), collectSourceRules с @media (P2-3).
- Тесты webview: App (journal/recordEdit merge, pendingStyles lifecycle после P0-4), PreviewContainer
  (handshake retry/timeout, origin-фильтр P1-1), Inspector (draft/commit/Escape, registry-рендер),
  Toolbar (переключение режимов/подписи).
- Браузерный harness (Playwright + реальный `PreviewHostServer`): фикстура static-site —
  загрузка CSS/картинок/навигация (P0-1), один runtime (P0-2), hover/select/outline, browse-link
  policy (P0-3), проксирование Next-подобного upstream (mock-сервер с RSC-заголовками, WS-echo).
- Coverage: пороги для `src/shared`, `persistence`, `preview`, runtime ≥ 80% строк; отчёт в CI.
- Каждый фикс P0/P1 — с регрессионным тестом, воспроизводящим баг ДО фикса.

### P3-7. Надёжность прокси (мелкие улучшения)
- Буферизованные ветки (HTML/CSS/3xx): abort upstream при обрыве клиента (`res.on("close")`),
  сейчас abort регистрируется только в streaming-ветке.
- `candidateLoopbackTargets`: добавить fallback `::1` (серверы, привязанные только к IPv6).
- WS-handshake: подмешивать cookies из jar (если браузерные не дошли).
- Ограничить рост cookie jar; очищать по таймеру истёкшие записи.

### P3-8. Продуктовые улучшения (по приоритету после фиксов)
1. UI-список правок с before/after и кнопками «отменить правку»/«очистить» (закрывает обещание README);
   undo для структурных операций (снапшоты DOM или журнал обратных ops).
2. Персист SCSS/LESS (хотя бы поиск правила в `.scss` с тем же парсером; запись с сохранением синтаксиса).
3. Адресная строка и навигация в статическом режиме (сейчас бар только для devserver).
4. Настройки (`contributes.configuration`): авто-открытие, лимиты байт/таймауты, язык по умолчанию,
   включение perf-инструментации (`dsPerf`).
5. Троттлинг/кэш `detectDevServers` и `findProjectEntries`; индикатор загрузки в Toolbar.
6. Сохранение журнала правок между сессиями (workspaceState) с явной кнопкой очистки.
7. Экспорт инструкции в файл (`.design-studio/instruction.md`) как альтернатива буферу.
8. Подсказка «откройте DevTools превью» при статусе missing/protocol-mismatch (кнопка-действие).

---

## 8. Порядок выполнения (фазы)

**Фаза 0 — подготовка (1 PR).** Baseline-прогон; завести ветку; добавить этот файл в docs;
обновить `docs/README.md`. Ничего не менять в коде.

**Фаза 1 — P0 (по PR на задачу, порядок: P0-1 → P0-2 → P0-3 → P0-4).**
Каждый PR: красный тест → фикс → зелёный baseline → обновить затронутые docs → запись в ledger.
P0-1 и P0-2 трогать вместе осторожно (оба в `serveProjectPath`), но коммиты раздельные.

**Фаза 2 — P1 (порядок: P1-1 → P1-2 → P1-3 → P1-4 → P1-5).**
После P1-1/P1-2 обязательно перепроверить handshake и авторизацию вручную (Next.js fixture/login).
Обновить `docs/SECURITY.md` (модель угроз: embedder, lifetime сервера, Origin-политика).

**Фаза 3 — P2 батчами по доменам:**
(a) протокол/типы: P2-1, P2-2, P2-13 (один PR с bump версии, если меняется payload);
(b) runtime: P2-3, P2-12, P2-17;
(c) tailwind: P2-4;
(d) webview UX: P2-5, P2-6, P2-18, P2-19, P2-20;
(e) persistence: P2-7, P2-21;
(f) preview-хост: P2-9, P2-10, P2-14, P2-15, P2-16, P2-22, P3-7;
(g) i18n/docs: P2-11 + §6 целиком.

**Фаза 4 — P3 инженерия:** CI (P3-1) → линт/зависимости (P3-2) → workspaces/tsconfig (P3-3) →
манифест/.vscodeignore (P3-4/5) → тестовая инфраструктура и покрытие (P3-6).

**Фаза 5 — релиз:** CHANGELOG, иконка, `vsce package`, ручная матрица (Next.js dev с авторизацией,
Vite, статический проект, демо; RU/EN; Windows/macOS/Linux), публикация.

**Ручная матрица после каждой фазы (минимум):** демо-страница (выбор/правки/копия инструкции);
статическая фикстура (стили/картинки/навигация); Next.js-приложение с логином (сессия живёт после
навигации), server action redirect, HMR WebSocket; «Сохранить стили» на обычном CSS и CSS Modules.

---

## 9. Формат отчётности агента

После каждой фазы обновляй `docs/IMPLEMENTATION_PLAN.md` (чекбоксы + краткий итог, как принято в
репозитории) и `docs/AI_HANDOFF.md` (что сделано, как проверено, что осталось). В PR-описании:
ID задач (P0-1…), корневая причина, файл/функция, тест-доказательство, риски отката.
Не коммить: `dist/`, `webview/public/runtime.js|protocol.js`, `node_modules/`, `.vsix`.
Не добавляй сетевые вызовы к внешним сервисам, телеметрию, MCP — это противоречит концепции продукта.

---

## 10. Приложение: ключевые контракты (справка)

- Протокол `ds:*` v6: ping/pong (nonce+sessionId), set-mode/mode-changed, select (ElementPayload),
  apply-style/style-applied (requestId), apply-op/op-applied (op, attribute, requestId),
  navigate/navigate-history/navigate-blocked/reload; runtime-ready/runtime-error отправляются
  runtime-ом (ready после init, error из catch). Валидаторы: `isRuntimeMessage`, `isElementPayload`,
  `isValidClassListValue`, `STYLE_PROPERTY_PATTERN`, `EDITABLE_ATTRIBUTES` (40), `STYLE_PROPS` (70).
- Пути preview-хоста: `/proxy/{http|https}/{host}{path}` (явный), голые маршруты (sticky/Referer),
  `/project/{rel}` (jail), `/demo.html`, `/__ds-runtime.js`, `/__ds-sw.js`.
- Инъекция в проксированный HTML: `<base href=previewOrigin+appPath>` + runtime (defer) +
  SW-регистрация; CSS `url(/...)` → `/proxy/{scheme}/{host}/...`; в проектном HTML — `/project/...`.
- Cookie: host-jar `origin|name`, браузерные Set-Cookie переписываются (Domain снят, Path=/).
- Сборка: `build:ext` (esbuild, cjs, external vscode) → `build:runtime` (tsc + esbuild IIFE
  `DesignStudioRuntime`) → `copy:runtime` → `build:webview` (vite, alias на src пакетов) →
  `inline:demo` → `verify:build`.