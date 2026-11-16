# IMPLEMENTATION PLAN (EPIC A)

Дата аудита: рабочее дерево на ветке `master`, базовый коммит `f700758` + незакоммиченный рефакторинг протокола v2/v3 (атрибуты, outlines в iframe). Задача: превратить preview в полноценный браузер с раздельными режимами, начиная с политики навигации по ссылкам.

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
