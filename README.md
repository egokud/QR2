# 📦 Сканер посылок

Веб-приложение для сортировки посылок по трек-кодам из Google Таблицы.

## Как использовать

1. Задеплой на Vercel (просто подключи этот репозиторий)
2. Настрой Google Apps Script (см. ниже)
3. Открой сайт на телефоне, вставь URL скрипта

## Настройка Google Apps Script

Открой Google Таблицу → **Расширения → Apps Script** → вставь код:

```javascript
const SHEET_NAME = 'Лист1'; // название листа в твоей таблице

function doGet(e) {
  const track = e.parameter.track;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  // Ищем первую неотмеченную строку с этим треком
  for (let i = 1; i < data.length; i++) {
    const rowTrack = String(data[i][1]).trim();
    const checked = data[i][0];
    if (rowTrack === track && !checked) {
      sheet.getRange(i + 1, 1).setValue(true);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ok', warehouse: data[i][2] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // Проверяем — может уже отмечен
  for (let i = 1; i < data.length; i++) {
    const rowTrack = String(data[i][1]).trim();
    if (rowTrack === track && data[i][0]) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'already', warehouse: data[i][2] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'not_found' }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

После вставки:
- **Развернуть → Новое развертывание**
- Тип: **Веб-приложение**
- Доступ: **Все**
- Нажми **Развернуть** → скопируй URL

## Структура таблицы

| A (Отметка) | B (Трек-код) | C (Склад) |
|---|---|---|
| ☐ | jt5477931681682 | Алеся |
| ☐ | 777402207338908 | Аня |

## Деплой на Vercel

1. Загрузи этот репозиторий на GitHub
2. Зайди на vercel.com → **New Project**
3. Выбери репозиторий → **Deploy**
4. Готово! Открывай ссылку на телефоне
