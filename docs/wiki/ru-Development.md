# Разработка

## Структура

```
backend/app/
  domain/        сущности-значения и ошибки
  ports.py       абстракции внешних систем
  adapters/      Amnezia (SSH), MikroTik (SSH), OpenBao, ClickHouse, DB-IP, Telegram
  db/            модели SQLAlchemy, Database, репозитории
  services/      бизнес-логика
  api/           роутеры FastAPI, схемы, зависимости
  cluster.py     шина событий, выбор лидера, распределённые блокировки
  workers.py     планировщик периодических задач
  container.py   composition root
  cli.py         сброс пароля, резервное копирование и восстановление
frontend/src/
  lib/           HttpClient и ресурсные API, SSE, уведомления, форматирование, хуки
  components/    UI-примитивы, графики, карта, макет, клиенты, администрирование
  pages/         страницы SPA
flow-collector/  goflow2 + обогащение потоков
awg-client/      образ клиента AmneziaWG для шлюза
openbao/         конфигурация и bootstrap
clickhouse/      ограничения ресурсов
mikrotik/        скрипты настройки и отката роутера
```

## Принципы

- **SOLID**: сервисы зависят от абстракций в `ports.py`; конкретные адаптеры создаются только в `container.py`.
  Новый тип роутера или хранилища секретов — новый адаптер без изменения сервисов.
- **DRY**: общий `Repository[T]`, единый `ServerConfigEditor` для всех изменений конфига сервера,
  `useAction` (мутация + уведомление + инвалидация), `notify` для всех сообщений и `Resource` на фронтенде.
- Сервер AmneziaWG — источник истины для пиров; PostgreSQL хранит метаданные и статистику; ключи — только в OpenBao.
- Изменения сначала применяются к серверу, затем к БД; расхождения устраняет синхронизация.
- Асинхронный ввод-вывод везде; CPU-ёмкое — в пуле потоков.

## Локальный запуск фронтенда

```bash
cd frontend
npm install
VITE_API_TARGET=http://<host>:8080 npm run dev
```

## Сборка

```bash
docker compose build backend frontend flow-collector
docker compose up -d
```

Сборка фронтенда выполняет проверку типов (`tsc -b`).

## Добавление измерения потоков

1. Добавьте `Field` в `backend/app/services/flowfilter.py` (имя, тип, колонка, подпись, SQL-выражение измерения).
2. При необходимости — колонку в `FlowSchema` и заполнение в `flow-collector/collector.py`.
3. Фронтенд получает список полей из `/api/flows/fields` автоматически.
