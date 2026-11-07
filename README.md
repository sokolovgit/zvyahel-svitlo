# Світло · Звягель

Віджет для iPhone з графіком погодинних відключень світла в Звягелі: чи є зараз світло, коли наступне відключення, шкала на добу.

Дані беруться з [Житомиробленерго](https://www.ztoe.com.ua/unhooking-search.php) і оновлюються кожні 10 хвилин.

## Встановлення (2 хвилини)

1. Встанови безкоштовний застосунок [Scriptable](https://apps.apple.com/app/scriptable/id1405459188).
2. Відкрий Scriptable → «+» (новий скрипт) → встав код нижче → назви скрипт, напр. **Світло** → Done.

   ```js
   const URL = "https://raw.githubusercontent.com/sokolovgit/zvyahel-svitlo/main/scriptable/svitlo.js";
   const fm = FileManager.local();
   const path = fm.joinPath(fm.libraryDirectory(), "zvyahel-svitlo.js");
   const stale = !fm.fileExists(path) || Date.now() - fm.modificationDate(path).getTime() > 6 * 3600 * 1000;
   if (stale) {
     try {
       const req = new Request(URL);
       req.timeoutInterval = 10;
       const code = await req.loadString();
       if (req.response.statusCode === 200 && code.includes("Script.complete")) fm.writeString(path, code);
     } catch (e) {}
   }
   const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
   await new AsyncFunction(fm.readString(path))();
   ```

3. Запусти скрипт (натисни на нього) → **«Знайти підчергу за адресою»** → введи вулицю й номер будинку. Підчерга збережеться.
4. Додай віджет: довге натискання на домашньому екрані → «+» → Scriptable → розмір → натисни на віджет → *Script*: **Світло**.

Віджет сам підтягує оновлення коду — перевстановлювати нічого не треба.

### Кілька підчерг

У полі **Parameter** віджета можна вписати підчергу (напр. `3.2`) — тоді цей віджет показує її, а не збережену адресу. Так можна мати віджети для дому, батьків тощо.

### Розміри

- **Середній** — статус, поточне/наступне відключення, шкала на добу.
- **Малий** — статус і час наступної зміни.
- **Великий** — як середній + графік усіх 12 підчерг.
- **Екран блокування** — рядок / прямокутник / коло.

## Як це працює

```
ztoe.com.ua ──(GitHub Actions, кожні 10 хв)──▶ data/schedule.json ──▶ віджет
             ──(щотижня)──────────────────────▶ data/addresses.json ──▶ пошук адреси
```

- `scraper/` — парсер сторінки Житомиробленерго (Node, без залежностей).
- `data/schedule.json` — графік: для кожної підчерги рядок з 48 символів (півгодинні слоти, `1` — відключення, `0` — світло є).
- `data/addresses.json` — вулиці й будинки Звягеля → підчерга.
- `scriptable/svitlo.js` — сам віджет; `scriptable/install.js` — лоадер з інструкції вище.

```sh
npm run schedule    # оновити графік
npm run addresses   # оновити адреси (~3 хв)
npm run check       # прогнати віджет у Node зі заглушками Scriptable
```

Графік — інформаційний. Аварійні відключення сайт обленерго (і віджет) не показує.
