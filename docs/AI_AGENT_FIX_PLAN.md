# Инструкция для ИИ-агента: починка навигации и закрытие аудита Design Studio

> Файл: `docs/AI_AGENT_FIX_PLAN.md`
> Репозиторий: `kachanov-e-v/design-studio`, ветка `master` (HEAD 48a1c5a, 16.11.2026).
> Основание: полный аудит исходников. Главный баг (NAV-01) подтверждён трассировкой кода
> и симуляцией URL-логики. Этот файл дополняет и частично ЗАМЕЩАЕТ устаревшие места
> `docs/AI_AGENT_INSTRUCTIONS.md` (там указан протокол v4 — актуальный v6; STYLE_PROPS=70,
> EDITABLE_ATTRIBUTES=40; у ds:runtime-ready/error продюсеры уже есть).

---

## 1. Роль и жёсткие ограничения

Ты — кодовый агент в этом репозитории. Цель: восстановить навигацию по ссылкам внутри
превью (главный пользовательский симптом), затем закрыть подтверждённые недочёты,
не ослабив безопасность и не сломав архитектуру.

**Неприкосновенные инварианты (не ослаблять):**
- SSRF-гейт `src/infrastructure/preview/upstream-validation.ts`: только loopback
  (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`, `::ffff:127.x.x.x`, `0.0.0.0`),
  только http/https, без userinfo; проверка ДО открытия сокета (HTTP, WS, редиректы).
- `PreviewHostServer.hostAllowed` (Host-проверка, анти-DNS-rebinding) и `originAllowed`.
- Канонический jail `resolveProjectPath` (realpath корня и глубочайшего предка) + denylist.
- Лимиты: тело запроса 10 МБ, ответ 20 МБ, таймаут заголовков 30 с, WS-connect 5 с.
- Валидаторы протокола (`isRuntimeMessage`, `isElementPayload`) и лимиты длин; origin-пиннинг
  postMessage (никаких `"*"`); sessionId/nonce/requestId корреляция.
- Маркеры `PAGE DATA — START/END` и `dataValue()` в промпте; буфер обмена — только по кнопке.
- Никаких внешних ИИ-сервисов, MCP, телеметрии.
- Паритет RU/EN в `src/shared/i18n.ts`.
- Сборочный конвейер и маркеры `scripts/verify-build.js`; артефакты
  `webview/public/runtime.js` не коммитить (генерируются `scripts/copy-runtime.js`).
- При изменении протокола: обновить ОБЕ стороны (runtime + webview), валидаторы, тесты,
  `PROTOCOL_VERSION` (сейчас "6") и пересобрать `npm run build`.

**Baseline перед правками (всё зелёное):**
```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

**Definition of Done каждой задачи:** код + регрессионный тест (красный ДО фикса,
зелёный ПОСЛЕ) + typecheck/lint/test/build зелёные + обновлены затронутые docs +
запись в `docs/IMPLEMENTATION_PLAN.md` и `docs/AI_HANDOFF.md`. Коммиты маленькие,
тематические, conventional commits со ссылкой на ID задачи.

**Запрещено:** коммитить `dist/`, `webview/public/runtime.js`, `node_modules/`, `*.vsix`;
менять публичный протокол без version bump; «чинить» тесты подгонкой ожиданий вместо фикса.

---

## 2. Контекст: как устроено превью (прочитай перед правками)

- `src/extension/commands/openDesignStudio.ts` — панель-webview, singleton
  `PreviewHostServer` (случайный порт на 127.0.0.1), sticky dev target, состояние
  demo/project/devserver, обработчики сообщений webview.
- `src/infrastructure/preview/PreviewHostServer.ts` — HTTP-хост: явные маршруты
  `/proxy/{http|https}/{host}{path}`, голые маршруты приложения (sticky target / Referer),
  `/project/` (jail), `/demo.html`, `/__ds-runtime.js`, `/__ds-sw.js`, host cookie jar, WS-relay.
  HTML dev-сервера отдаётся через `rewriteProxiedHtml` (строка ~1004).
- `src/infrastructure/preview/proxy-html.ts` — инъекция `<base>` + runtime-тега,
  переписывание CSS `url(/…)`, service worker. Ключевое: `rewriteProxiedHtml` (строка 156)
  ставит `<base href="{proxyOrigin}{appPath}">`, но `data-upstream-origin="{upstreamOrigin}"`
  (строка 160) — это origin РЕАЛЬНОГО dev-сервера, не прокси.
- `packages/preview-runtime/src/index.ts` — runtime в iframe: handshake, выбор/правки,
  контуры, browse-mode link policy (клик-обработчик, строки ~840–879), патчи history.
- `webview/components/PreviewContainer.tsx` — iframe + handshake + приём `ds:*`;
  `webview/App.tsx` — журнал правок, статусы, персистентность.

Поток: webview ⇄ extension ⇄ runtime (протокол `ds:*` v6) ⇄ preview-хост ⇄ dev-сервер.
В dev-режиме страницы живут на ГОЛЫХ маршрутах origin прокси
(`http://127.0.0.1:PORT/boards/…`), а не под `/proxy/…`.

---

## 3. NAV-01 (P0, ГЛАВНАЯ): все внутренние ссылки блокируются в dev-режиме

**Симптом пользователя:** клик по ссылке в превью даёт статус
«Ссылка не открывается в предпросмотре: http://127.0.0.1:9533/boards/… .
Маршруты исходного сервера работают.» Маршруты из адресной строки при этом работают.

**Корневая причина (доказана):**
1. `rewriteProxiedHtml` (`proxy-html.ts:156–163`) внедряет `<base>` с origin ПРОКСИ
   и `data-upstream-origin` с origin UPSTREAM (например `http://localhost:3000`).
2. Runtime (`index.ts`, клик-обработчик) резолвит `anchor.href` через `<base>` →
   origin ссылки = origin прокси (`http://127.0.0.1:9533`).
3. Проверка `href.origin !== upstreamOrigin` (`index.ts:867`) всегда истинна →
   `preventDefault()` + `ds:navigate-blocked` → `App.handleNavigateBlocked` →
   i18n `status.externalLinkBlocked` (`i18n.ts:96`). Политика инвертирована:
   блокируются рабочие ссылки на прокси-origins, пропускаются абсолютные на upstream.
4. Демо и `/project/` не затронуты: там `upstreamOrigin` = origin прокси
   (`PreviewHostServer.ts:618`) или fallback на `location.origin`.

**Почему тесты не ловят:** jsdom-тесты (`index.test.ts`, describe "browse-mode link policy")
спавнят runtime без атрибута (fallback = location.origin); тест инъекции
(`PreviewHostServer.test.ts`, "stamps data-upstream-origin…") закрепляет attr=upstream;
фикстуры покрывают только `/project/`. Комбинация «base=прокси + attr=upstream + клик»
не тестируется нигде.

**Фикс (runtime-side, минимальный):**
1. В `packages/preview-runtime/src/index.ts` в browse-mode клик-обработчике замени
   условие блокировки на allowlist из ДВУХ origin:
   ```ts
   // The preview host serves the app both at its own origin (sticky bare paths,
   // /proxy/ routes) and at the upstream origin: a link is navigable when it
   // targets either of them. Everything else stays blocked.
   const previewOrigin = (() => {
     try { return window.location.origin; } catch { return null; }
   })();
   const navigable =
     href.origin === upstreamOrigin ||
     (previewOrigin !== null && previewOrigin !== "null" && href.origin === previewOrigin);
   if (dangerousScheme || !navigable || escapesFrame) {
     event.preventDefault();
     postToParent({ type: "ds:navigate-blocked", version: PROTOCOL_VERSION,
       url: href.toString().slice(0, 2048), sessionId: activeSessionId || undefined });
     return;
   }
   ```
   Сохрани: опасные схемы (`javascript:`, `data:`, `vbscript:`, `blob:`, `about:`),
   `mailto:`/`tel:` нативно, `download` нативно, `target≠_self` блокируется,
   модификаторы (ctrl/meta/shift/alt) не перехватываются.
2. Инъекцию (`proxy-html.ts`) НЕ меняй: attr=upstream остаётся (он нужен для ссылок,
   указывающих напрямую на dev-сервер). Обнови комментарий у `InjectOptions.upstreamOrigin`:
   политика пропускает И upstream origin, И origin документа.
3. Обнови комментарий в `PreviewHostServer.test.ts` у теста инъекции, поясняющий
   двойную семантику (сам тест остаётся зелёным).

**Регрессионный тест (красный → зелёный):**
- В `packages/preview-runtime/src/index.test.ts` задай jsdom URL, совпадающий с
  origin прокси, через docblock в шапке файла:
  `// @vitest-environment-options {"url": "http://127.0.0.1:9533/boards/current"}`
  (существующие тесты файла проверь — они должны остаться зелёными).
- Новый тест в describe "browse-mode link policy":
  ```ts
  it("NAV-01: navigates preview-origin links when data-upstream-origin points at the dev server", async () => {
    await prepared(' data-upstream-origin="http://127.0.0.1:4600"'); // реальный upstream
    document.body.innerHTML = '<a id="board" href="/boards/cmwgbjgec0002veccx0ufeoyh">board</a>';
    const posted = withClick("board");
    expect(posted.event.defaultPrevented).toBe(true); // hijack в location.assign
    expect(posted.messages.find((p) => p.msg.type === "ds:navigate-blocked")).toBeUndefined();
  });
  ```
  ДО фикса: заблокирована (origin 9533 ≠ 4600) → тест красный. ПОСЛЕ: зелёный.
- Добавь парные тесты: абсолютная ссылка на upstream (`http://127.0.0.1:4600/x`) —
  не блокируется; внешняя (`https://example.com/`) — блокируется; `javascript:` —
  блокируется; `target="_blank"` на внутренний маршрут — блокируется.

**Критерии приёмки:**
- jsdom-тесты выше зелёные; весь `npm test` зелёный.
- Ручная проверка (F5, Extension Development Host, реальный Next.js-проект с
  авторизацией и маршрутами вида `/boards/<id>`): в режиме «Просмотр» клик по
  внутренней ссылке открывает маршрут ВНУТРИ превью, сессия не теряется, адресная
  строка обновляется; внешняя ссылка по-прежнему даёт уведомление.
- Обновлены: `docs/TROUBLESHOOTING.md` (новый раздел с точным симптомом и ссылкой
  на NAV-01), `docs/ARCHITECTURE.md` §8 (формулировка политики), CHANGELOG.

---

## 4. NAV-02 (P1): browse-режим убивает SPA-навигацию (полная перезагрузка на каждый клик)

**Где:** `index.ts:877–878` — для каждой разрешённой ссылки `preventDefault()` +
`window.location.assign(path)`. Роутер Next.js видит `defaultPrevented` и не работает.
**Следствия:** каждый клик = полный reload (медленно, теряется клиентское состояние),
противоречит README/ARCHITECTURE («SPA-навигация работает штатно»).
**Фикс:** для документов на ГОЛЫХ маршрутах (sticky-режим, `location.pathname` не
начинается с `/proxy/`).same-origin клики пропускай нативно (без preventDefault/assign) —
прокси + service worker и так удерживают iframe. Hijack через `location.assign` сохрани
ТОЛЬКО для документов под структурированным `/proxy/…` (там нативная SPA-навигация
выломится из префикса). Блокировки (внешние/опасные/target) не меняются.
**Тест:** jsdom, location на голом пути → клик по same-origin ссылке:
`defaultPrevented === false`, `ds:navigate-blocked` нет; location под `/proxy/http/host/…`
→ hijack сохранён. Протокол не меняется.
**Приёмка:** ручная проверка на Next.js: клик по `<Link>` navigates без полной
перезагрузки (сеть: нет document-запроса, есть RSC-fetch), адрес обновляется через
`ds:navigate`; после формы/редиректа сессия жива.

---

## 5. RT-01 (P1): ds:runtime-ready уходит не тому предку

**Где:** `index.ts`, `postRuntimeAnnouncement` (~строка 119):
`origins[origins.length - 1]` — это origin САМОГО ВЕРХНЕГО фрейма, а сообщение шлётся
в `window.parent` (непосредственный родитель). Вложенный webview VS Code: анонс молча
дропается, мгновенное подключение (P2-13) не работает, handshake ждёт ping-таймауты.
**Фикс:** вынеси выбор origin в чистую экспортируемую функцию
`pickAnnouncementOrigin(origins: DOMStringList | undefined): string | null`,
возвращающую `origins[0]` (непосредственный родитель); используй её.
**Тест:** юнит на чистую функцию: `["vscode-webview://abc", "vscode-file://vscode-app"]`
→ `"vscode-webview://abc"`; пустой список → null. Существующие тесты анонсов зелёные.

---

## 6. WV-01 (P1): журнал правок переживает навигацию внутри iframe

**Где:** `webview/App.tsx` — очистка `selected/pendingStyles/edits/styleError` только
в эффекте `[state.url]` (строка ~107). `ds:navigate` (клик по ссылке, SPA pushState)
меняет маршрут, но журнал остаётся: селекторы прошлой страницы уходят в инструкцию
для ИИ и в «Сохранить стили» (может отредактировать правило, подобранное на другой странице).
**Фикс:** в `handlePreviewLocationChange(path)` сравнивай с последним запомненным
маршрутом (ref); при реальной смене пути выполняй ту же очистку, что и при смене
`state.url` (вынеси общий хелпер `resetSessionEdits()`). `ds:navigate` шлётся и на
set-mode с тем же путём — очистка только при ИЗМЕНЕНИИ пути.
**Тест:** webview-тест (jsdom + testing-library): select → edit → симулировать
`ds:navigate` с новым path → edits/pendingStyles пусты; тот же path → журнал сохранён.

---

## 7. WV-02 (P2): PreviewContainer — дубль строки и устаревший devServer в замыкании

**Где:** `webview/components/PreviewContainer.tsx:248–249` — дважды подряд
`if (sid && sid !== sessionIdRef.current) return;`; эффект обработчика сообщений
с deps `[url]` захватывает `devServer` (адресная строка может показывать старый
origin после смены сервера без смены url).
**Фикс:** удали дубль; добавь `devServerRef` (по образцу существующих ref-ов) и читай
`devServerRef.current` в обработчике `ds:navigate`.
**Тест:** существующие PreviewContainer-тесты зелёные + новый: смена devServer без
смены url → адрес в `ds:navigate` строится из нового origin.

---

## 8. EXT-01 (P1): SourceHintFinder — неограниченное чтение workspace в память

**Где:** `src/infrastructure/source-analysis/SourceHintFinder.ts` — до 3000 файлов ×
300 КБ читаются в Map `contents` на каждый «Скопировать инструкцию» (worst case ~900 МБ
на extension host).
**Фикс:** добавь общий бюджет `MAX_TOTAL_BYTES` (например 32 МБ): при чтении файлов
накапливай суммарный размер и прекращай читать новые файлы при превышении (поиск по
уже прочитанным продолжается). Сохрани детерминированный порядок обхода.
**Тест:** синтетический workspace с файлами, суммарно превышающими бюджет →
суммарный объём прочитанного ≤ бюджет + размер одного файла; hints всё ещё находятся
в прочитанных файлах.

---

## 9. UX-01 (P2): no-op персистентность зависает в очереди навсегда

**Где:** `src/infrastructure/persistence/StylePersistenceAdapter.ts`, `editRule`:
если значение уже равно целевому → `{ success:false, message:"Property already has this value" }`.
`webview/persistContract.ts ackPendingStyles` удаляет из очереди только успешные →
правка не уходит из `pendingStyles`, кнопка «Сохранить стили» вечно активна.
**Фикс:** трактуй no-op как успех (`success:true`, message «Property already has this
value», file) — очередь дренируется. Не трогай семантику реальных отказов.
**Тест:** StylePersistenceAdapter.test.ts: повторное применение того же значения →
success:true; persistContract.test.ts: такой ack удаляет правку из очереди.

---

## 10. CSS-01 (P2, опционально): inline <style> правила не собираются

**Где:** `index.ts`, `collectSourceRules` пропускает листы без `href` → Tailwind JIT,
styled-jsx, CSS-in-JS не попадают в `sourceRules` → персистентность слепа к ним.
**Фикс (осторожно, требует protocol bump):** добавь в `SourceRule` флаг `inline?: boolean`
и собирай inline-листы с маркером вместо href; `CssSourceResolver` обязан пропускать
inline-правила (не пытаться fetch). Обнови валидаторы, ОБЕ стороны, `PROTOCOL_VERSION`,
тесты. Если не успеваешь — задокументируй ограничение в `docs/SECURITY.md`/TROUBLESHOOTING
и оставь в backlog. Не ломай существующий сбор по href.

---

## 11. DOC-01 (P2): синхронизация документации с кодом

- `docs/AI_AGENT_INSTRUCTIONS.md`: протокол v6 (не v4), STYLE_PROPS=70,
  EDITABLE_ATTRIBUTES=40, у runtime-ready/error есть продюсеры; добавь ссылку на этот файл.
- `CHANGELOG.md`: запись P0-3 «link policy works» уточнить — в proxy-режиме политика
  была инвертирована, исправлено NAV-01.
- `docs/TROUBLESHOOTING.md`: раздел «Клик по ссылке даёт "Ссылка не открывается
  в предпросмотре: http://127.0.0.1:…"» — причина NAV-01, проверка сборки/перезагрузки.
- `docs/ARCHITECTURE.md` §8 и README: формулировка link policy (два допустимых origin;
  после NAV-02 — нативная SPA-навигация на голых маршрутах).
- `docs/IMPLEMENTATION_PLAN.md` + `docs/AI_HANDOFF.md`: ledger по каждой задаче
  (ID, корневая причина, файл/функция, тест-доказательство).

---

## 12. ENG-бэклог (P3, после основных фиксов; по одному коммиту на пункт)

| ID | Задача | Где |
| --- | --- | --- |
| ENG-01 | E2E-smoke Playwright: standalone PreviewHostServer + stub upstream + клик по ссылке в iframe (поймал бы NAV-01). Закрыть P3-6/H6 плана | новый `e2e/`, CI-шаг опционально |
| ENG-02 | Coverage-пороги для `webview/components/**` (сейчас только 4 области) | `vitest.config.ts` |
| ENG-03 | Убрать нестандартное поле `allowScripts` из package.json; решить displayName/NLS для маркетплейса | `package.json` |
| ENG-04 | WS-relay: backpressure (pause/resume вместо голого write) | `PreviewHostServer.handleUpgrade` |
| ENG-05 | `fetchWithFallbacks`: короткий connect-timeout вместо 30 с на каждый из 3 кандидатов | `PreviewHostServer.ts` |
| ENG-06 | Cookie: документировать/адаптировать `Secure`/`SameSite` для http-preview origin (jar уже компенсирует) | `rewriteSetCookieForPreview`, SECURITY.md |
| ENG-07 | CSP webview: убрать `data:` из `frame-src` | `openDesignStudio.getWebviewHtml` |
| ENG-08 | `.vscodeignore`: решить судьбу sourcemap (не shipать *.ts, но shipать .map — рассинхрон) | `.vscodeignore`, build:ext |
| ENG-09 | Toolbar: показывать ВСЕ обнаруженные серверы, а не один | `Toolbar.tsx` |
| ENG-10 | Кнопка «Открыть снаружи» (vscode.env.openExternal) для заблокированных внешних ссылок + i18n RU/EN | App/PreviewContainer, extension |
| ENG-11 | Батч-скан CSS: переиспользовать результат findFiles между правками одного «Сохранить стили» | `StylePersistenceAdapter`, очередь в openDesignStudio |

---

## 13. Порядок выполнения (фазы)

1. **Фаза A (немедленно):** NAV-01 + тесты + DOC-01 (TROUBLESHOOTING/CHANGELOG).
   Пересобрать `npm run build`, перезагрузить Extension Development Host,
   проверить вручную на проекте пользователя (канбан, `/boards/<id>`).
2. **Фаза B:** RT-01, WV-01, WV-02, EXT-01, UX-01 (каждая — отдельный коммит с тестом).
3. **Фаза C:** NAV-02 (поведенческое изменение, обязательная ручная проверка на Next.js).
4. **Фаза D:** CSS-01 (если берёшься — только с protocol bump), ENG-бэклог по приоритету.

После каждой фазы: `npm run typecheck && npm run lint && npm test && npm run build` —
зелёные; запись в IMPLEMENTATION_PLAN/AI_HANDOFF.

## 14. Ручная матрица приёмки (Extension Development Host, F5)

- [ ] Dev-сервер Next.js с авторизацией: логин → клик по внутренней ссылке
      (`/boards/<id>`) открывает маршрут внутри превью, сессия жива, адрес обновился.
- [ ] Кнопки «Назад/Вперёд/Обновить» работают после навигации по ссылкам.
- [ ] Внешняя ссылка → уведомление, iframe не покидает preview; `javascript:`-ссылка
      (после правки href в инспекторе) заблокирована.
- [ ] Режим «Редактировать»: hover-подсветка, клик выбирает без активации;
      выход из режима гасит контуры.
- [ ] «Сохранить стили»: правка уходит в файл, очередь дренируется, no-op не зависает.
- [ ] «Скопировать инструкцию»: журнал содержит правки ТОЛЬКО текущей страницы.
- [ ] Демо и `/project/`-режим не регрессировали.
- [ ] Output «Design Studio Preview»: нет 502/403 на штатных маршрутах.

## 15. Формат отчётности

После каждой задачи: ID, корневая причина (файл:строка), что изменено, имя
регрессионного теста и доказательство «красный→зелёный», риски отката.
В PR: список ID, сводка проверок (typecheck/lint/test/build), пункты ручной матрицы.
Не коммить артефакты сборки. Не добавлять сетевые вызовы к внешним сервисам.