# Legacy cleanup

Аудит мёртвого кода (EPIC G). Перед удалением
каждого кандидата проверялись все usages (`grep` по `src`, `webview`, `packages`),
dynamic usage (ключи i18n могли читаться через `translate(language, key)`), тесты и документация.

## Удалено

| Кандидат | Где | Почему удалено | Как проверено |
|---|---|---|---|
| `isAllowedUrl` | `src/shared/url.ts` | Функция разрешала любой http/https URL и использовалась только в собственном тесте. Её роль с релиза SSRF-гейта полностью покрывает `isLocalhostUrl`/`isLoopbackHostname` + `validateUpstreamTarget` | grep по `src`, `webview`, `packages` — единственное обращение — `url.test.ts` |
| `floating.copySelected` | `src/shared/i18n.ts` | Ключ остался от старой панели; сейчас копирование исходника компонента оформлено в инспекторе | 0 usages в `webview`, `packages`, `src` |
| `inspector.applyClasses` | `src/shared/i18n.ts` | Инспектор заменён на registry-контролы (`propertyRegistry.ts`); отдельная кнопка «Применить классы» не существует | 0 usages |
| `inspector.customStyle` | `src/shared/i18n.ts` | Секция «своё CSS-свойство» удалена при переходе на registry (EPIC D) | 0 usages; `npm run typecheck`/`lint` |
| `inspector.propertyPlaceholder` | `src/shared/i18n.ts` | Универсальное строковое поле для CSS-свойств заменено типизированными контролами | 0 usages |
| `inspector.editable` | `src/shared/i18n.ts` | Старый заголовок списка редактируемых свойств; новый инспектор не рендерит его | 0 usages |
| `inspector.noAttributes` | `src/shared/i18n.ts` | В новом инспекторе пустой список атрибутов просто не рендерится | 0 usages |
| `console.log("Design Studio runtime loaded")` | `packages/preview-runtime/src/index.ts` и маркер в `scripts/verify-build.js` | Legacy debug-лог, попавший в каждую PROD-страницу preview; верификатор сборки опирался на него и заменён стабильным маркером `initDesignStudioRuntime` | удалён; `npm run build` (с `verify-build`) проходит |

## Проверено и оставлено (действующие возможности)

| Фрагмент | Почему оставлено |
|---|---|
| Специальная обработка Next.js в proxy (cookies, RSC, Server Actions, `x-action-redirect`) | Основной сценарий расширения; покрыт тестами `PreviewHostServer.test.ts` |
| `candidateLoopbackTargets` (localhost ↔ 127.0.0.1) | Dev-серверы бывают привязаны только к одному из loopback-имён; оставлено как Fallback с единственной целью — loopback |
| `targetFromReferer` | Критичен для RSC-запросов и навигации по SPA-маршрутам после hard navigation |
| SVG/Tailwind/CSS Modules heuristics в source-analysis | Действующие hints для инструкции ИИ; используются при выгрузке контекста |
| `HEADERS_TO_STRIP` с CSP/X-Frame-Options | Требуется для встраивания в iframe; применяется только на preview host |
| Service worker `/__ds-sw.js` | Перенаправление same-origin-запросов для routing в проксированных документах; не кэширует, scope ограничен preview origin |
| Message types протокола `ds:ping/pong`, `ds:mode-changed`, `ds:navigate-history` и пр. | Все 15 типов имеют как минимум один рабочий producer/consumer; проверено grep-обходом |

## Команды / components

- package.json объявляет единственную команду `design-studio.open` — она же регистрируется в `src/extension/extension.ts`.
- Все компоненты webview (`FloatingPanel`, `Inspector`, `PreviewContainer`, `Toolbar`) импортируются из `App.tsx`; мёртвых hooks не найдено.

## Дата аудита

См. `docs/AI_HANDOFF.md` — там же результат прогонов typecheck/lint/test/build.
