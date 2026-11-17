'use strict';
const sql = require('mssql');
const bcrypt = require('bcryptjs');
const cfg = require('./config');

const dbConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD,
    server: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'thalassa',
    options: {
        encrypt: false,
        trustServerCertificate: true
    },
    port: parseInt(process.env.DB_PORT, 10) || 1433,
};

let poolPromise;

/** Единый пул соединений (создаётся при первом обращении) */
function getPool() {
    if (!poolPromise) {
        poolPromise = new sql.ConnectionPool(dbConfig).connect().catch((err) => {
            poolPromise = null; // позволяем повторить попытку
            throw err;
        });
    }
    return poolPromise;
}

/** query('SELECT ... WHERE id = @id', { id: 5 }) → recordset (массив строк) */
async function query(text, params = {}) {
    const pool = await getPool();
    const req = pool.request();
    for (const [k, v] of Object.entries(params)) req.input(k, v);
    return (await req.query(text)).recordset || [];
}

/** Как query, но возвращает только первую строку (или undefined) */
async function one(text, params) {
    return (await query(text, params))[0];
}

/** Выполняет fn(tx) в транзакции; tx.query(text, params) работает так же, как query() */
async function transaction(fn) {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    const run = async (text, params = {}) => {
        const req = new sql.Request(tx);
        for (const [k, v] of Object.entries(params)) req.input(k, v);
        return (await req.query(text)).recordset || [];
    };
    try {
        const result = await fn({ query: run });
        await tx.commit();
        return result;
    } catch (err) {
        try { await tx.rollback(); } catch { /* транзакция уже закрыта */ }
        throw err;
    }
}

async function initializeDatabase() {
    const pool = await getPool();

    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='users' and xtype='U')
        CREATE TABLE users (
            id            INT IDENTITY(1,1) PRIMARY KEY,
            name          NVARCHAR(255) NOT NULL,
            email         NVARCHAR(255) NOT NULL UNIQUE,
            phone         NVARCHAR(50) NOT NULL DEFAULT '',
            password_hash NVARCHAR(255) NOT NULL,
            role          NVARCHAR(20) NOT NULL DEFAULT 'client' CHECK (role IN ('client','admin')),
            created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );

        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='menu_items' and xtype='U')
        CREATE TABLE menu_items (
            id          INT IDENTITY(1,1) PRIMARY KEY,
            category    NVARCHAR(100) NOT NULL,
            name        NVARCHAR(255) NOT NULL,
            description NVARCHAR(MAX) NOT NULL,
            price_cents INT NOT NULL CHECK (price_cents > 0),
            image       NVARCHAR(255),
            available   INT NOT NULL DEFAULT 1,
            sort        INT NOT NULL DEFAULT 0
        );

        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='orders' and xtype='U')
        CREATE TABLE orders (
            id                 INT IDENTITY(1,1) PRIMARY KEY,
            user_id            INT NOT NULL FOREIGN KEY REFERENCES users(id) ON DELETE CASCADE,
            status             NVARCHAR(50) NOT NULL DEFAULT 'new' CHECK (status IN ('new','cooking','delivering','done','cancelled')),
            address            NVARCHAR(MAX) NOT NULL,
            phone              NVARCHAR(50) NOT NULL,
            deliver_at         NVARCHAR(50) NOT NULL,
            comment            NVARCHAR(MAX) NOT NULL DEFAULT '',
            payment            NVARCHAR(50) NOT NULL,
            subtotal_cents     INT NOT NULL,
            delivery_fee_cents INT NOT NULL,
            total_cents        INT NOT NULL,
            created_at         DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );

        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='order_items' and xtype='U')
        CREATE TABLE order_items (
            id          INT IDENTITY(1,1) PRIMARY KEY,
            order_id    INT NOT NULL FOREIGN KEY REFERENCES orders(id) ON DELETE CASCADE,
            item_id     INT,
            name        NVARCHAR(255) NOT NULL,
            price_cents INT NOT NULL,
            qty         INT NOT NULL
        );

        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='tables_cafe' and xtype='U')
        CREATE TABLE tables_cafe (
            id    INT PRIMARY KEY,
            zone  NVARCHAR(50) NOT NULL CHECK (zone IN ('hall','veranda')),
            seats INT NOT NULL,
            shape NVARCHAR(20) NOT NULL CHECK (shape IN ('round','rect')),
            x     INT NOT NULL,
            y     INT NOT NULL,
            w     INT NOT NULL,
            h     INT NOT NULL
        );

        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='reservations' and xtype='U')
        CREATE TABLE reservations (
            id         INT IDENTITY(1,1) PRIMARY KEY,
            user_id    INT NOT NULL FOREIGN KEY REFERENCES users(id) ON DELETE CASCADE,
            table_id   INT NOT NULL FOREIGN KEY REFERENCES tables_cafe(id),
            date       NVARCHAR(50) NOT NULL,
            start_min  INT NOT NULL,
            guests     INT NOT NULL,
            name       NVARCHAR(255) NOT NULL,
            phone      NVARCHAR(50) NOT NULL,
            comment    NVARCHAR(MAX) NOT NULL DEFAULT '',
            status     NVARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
            created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );

        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='reviews' and xtype='U')
        CREATE TABLE reviews (
            id          INT IDENTITY(1,1) PRIMARY KEY,
            user_id     INT NULL FOREIGN KEY REFERENCES users(id) ON DELETE SET NULL,
            author_name NVARCHAR(255) NOT NULL,
            rating      INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
            text        NVARCHAR(MAX) NOT NULL,
            created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
    `);

    await migrate(pool);
    await seed(pool);
    console.log('★ Подключено к MS SQL Server, база готова');
}

/** Колонки, которые могли отсутствовать в таблицах, созданных старой версией проекта */
const EXPECTED_COLUMNS = {
    users: {
        name: "NVARCHAR(255) NOT NULL DEFAULT ''",
        email: "NVARCHAR(255) NOT NULL DEFAULT ''",
        phone: "NVARCHAR(50) NOT NULL DEFAULT ''",
        password_hash: "NVARCHAR(255) NOT NULL DEFAULT ''",
        role: "NVARCHAR(20) NOT NULL DEFAULT 'client'",
        created_at: 'DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()',
    },
    menu_items: {
        category: "NVARCHAR(100) NOT NULL DEFAULT ''",
        name: "NVARCHAR(255) NOT NULL DEFAULT ''",
        description: "NVARCHAR(MAX) NOT NULL DEFAULT ''",
        price_cents: 'INT NOT NULL DEFAULT 0',
        image: 'NVARCHAR(255) NULL',
        available: 'INT NOT NULL DEFAULT 1',
        sort: 'INT NOT NULL DEFAULT 0',
    },
    orders: {
        user_id: 'INT NULL',
        status: "NVARCHAR(50) NOT NULL DEFAULT 'new'",
        address: "NVARCHAR(MAX) NOT NULL DEFAULT ''",
        phone: "NVARCHAR(50) NOT NULL DEFAULT ''",
        deliver_at: "NVARCHAR(50) NOT NULL DEFAULT 'asap'",
        comment: "NVARCHAR(MAX) NOT NULL DEFAULT ''",
        payment: "NVARCHAR(50) NOT NULL DEFAULT 'cash'",
        subtotal_cents: 'INT NOT NULL DEFAULT 0',
        delivery_fee_cents: 'INT NOT NULL DEFAULT 0',
        total_cents: 'INT NOT NULL DEFAULT 0',
        created_at: 'DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()',
    },
    order_items: {
        order_id: 'INT NULL',
        item_id: 'INT NULL',
        name: "NVARCHAR(255) NOT NULL DEFAULT ''",
        price_cents: 'INT NOT NULL DEFAULT 0',
        qty: 'INT NOT NULL DEFAULT 1',
    },
    tables_cafe: {
        zone: "NVARCHAR(50) NOT NULL DEFAULT 'hall'",
        seats: 'INT NOT NULL DEFAULT 2',
        shape: "NVARCHAR(20) NOT NULL DEFAULT 'round'",
        x: 'INT NOT NULL DEFAULT 0',
        y: 'INT NOT NULL DEFAULT 0',
        w: 'INT NOT NULL DEFAULT 0',
        h: 'INT NOT NULL DEFAULT 0',
    },
    reservations: {
        user_id: 'INT NULL',
        table_id: 'INT NULL',
        date: "NVARCHAR(50) NOT NULL DEFAULT ''",
        start_min: 'INT NOT NULL DEFAULT 0',
        guests: 'INT NOT NULL DEFAULT 1',
        name: "NVARCHAR(255) NOT NULL DEFAULT ''",
        phone: "NVARCHAR(50) NOT NULL DEFAULT ''",
        comment: "NVARCHAR(MAX) NOT NULL DEFAULT ''",
        status: "NVARCHAR(20) NOT NULL DEFAULT 'pending'",
        created_at: 'DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()',
    },
    reviews: {
        user_id: 'INT NULL',
        author_name: "NVARCHAR(255) NOT NULL DEFAULT ''",
        rating: 'INT NOT NULL DEFAULT 5',
        text: "NVARCHAR(MAX) NOT NULL DEFAULT ''",
        created_at: 'DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()',
    },
};

/** Старые «лишние» колонки (которых нет в нашей схеме) с NOT NULL без значения по умолчанию
 *  сломали бы INSERT — делаем их необязательными. */
async function relaxLegacyColumns(pool) {
    const { recordset } = await pool.request().query(`
        SELECT c.TABLE_NAME AS t, c.COLUMN_NAME AS c, c.DATA_TYPE AS dt, c.CHARACTER_MAXIMUM_LENGTH AS len,
               c.NUMERIC_PRECISION AS prec, c.NUMERIC_SCALE AS scale
        FROM INFORMATION_SCHEMA.COLUMNS c
        WHERE c.IS_NULLABLE = 'NO' AND c.COLUMN_DEFAULT IS NULL
          AND COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsIdentity') = 0
          AND COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsComputed') = 0
          AND c.DATA_TYPE NOT IN ('timestamp', 'rowversion')
          AND NOT EXISTS (SELECT 1 FROM sys.index_columns ic
                          JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id AND i.is_primary_key = 1
                          WHERE ic.object_id = OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME)
                            AND COL_NAME(ic.object_id, ic.column_id) = c.COLUMN_NAME)`);
    for (const r of recordset) {
        const table = r.t.toLowerCase();
        const known = EXPECTED_COLUMNS[table];
        if (!known || r.c.toLowerCase() === 'id' || Object.keys(known).some((k) => k.toLowerCase() === r.c.toLowerCase())) continue;
        let type = r.dt;
        if (['nvarchar', 'varchar', 'nchar', 'char', 'varbinary', 'binary'].includes(r.dt)) type += `(${r.len === -1 ? 'MAX' : r.len})`;
        else if (['decimal', 'numeric'].includes(r.dt)) type += `(${r.prec},${r.scale})`;
        try {
            await pool.request().query(`ALTER TABLE ${r.t} ALTER COLUMN [${r.c}] ${type} NULL`);
            console.log(`★ Колонка ${r.t}.${r.c} сделана необязательной`);
        } catch (e) {
            console.warn(`  (не удалось изменить ${r.t}.${r.c}: ${e.message})`);
        }
    }
}

/** Допустимые значения колонок: [таблица, колонка, значения, значение по умолчанию] */
const ENUM_COLUMNS = [
    ['users', 'role', ['client', 'admin'], 'client'],
    ['orders', 'status', ['new', 'cooking', 'delivering', 'done', 'cancelled'], 'new'],
    ['reservations', 'status', ['pending', 'confirmed', 'cancelled'], 'pending'],
];

/** Заменяет старые CHECK-ограничения (из прежних версий таблиц) на актуальные */
async function migrateChecks(pool) {
    for (const [table, col, allowed, def] of ENUM_COLUMNS) {
        const ours = `CK_${table}_${col}`;
        const { recordset: found } = await pool.request().query(
            `SELECT cc.name FROM sys.check_constraints cc
             WHERE cc.parent_object_id = OBJECT_ID('${table}')
               AND cc.definition LIKE '%${col}%'`);
        if (found.length === 1 && found[0].name === ours) continue;

        for (const { name } of found) {
            await pool.request().query(`ALTER TABLE ${table} DROP CONSTRAINT [${name}]`);
        }
        const list = allowed.map((v) => `'${v}'`).join(',');
        // значения, которых нет в новом списке (напр. 'user'), приводим к значению по умолчанию
        await pool.request().query(`UPDATE ${table} SET ${col} = LOWER(${col}) WHERE ${col} <> LOWER(${col})`);
        await pool.request().query(`UPDATE ${table} SET ${col} = '${def}' WHERE ${col} NOT IN (${list}) OR ${col} IS NULL`);
        await pool.request().query(`ALTER TABLE ${table} ADD CONSTRAINT ${ours} CHECK (${col} IN (${list}))`);
        console.log(`★ Обновлено ограничение ${table}.${col}`);
    }
}

/** Добавляет недостающие колонки в уже существующие таблицы */
async function migrate(pool) {
    const { recordset } = await pool.request().query(
        'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS');
    const have = new Set(recordset.map((r) => `${r.t.toLowerCase()}.${r.c.toLowerCase()}`));
    for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
        for (const [col, ddl] of Object.entries(cols)) {
            if (have.has(`${table}.${col}`)) continue;
            await pool.request().query(`ALTER TABLE ${table} ADD ${col} ${ddl}`);
            console.log(`★ Добавлена колонка ${table}.${col}`);
        }
    }
    await relaxLegacyColumns(pool);
    await migrateChecks(pool);
}

const TABLES = [
    [1, 'hall', 2, 'round', 100, 125, 26, 26],
    [2, 'hall', 2, 'round', 100, 235, 26, 26],
    [3, 'hall', 4, 'rect', 250, 135, 92, 56],
    [4, 'hall', 4, 'rect', 250, 265, 92, 56],
    [5, 'hall', 6, 'rect', 395, 200, 112, 62],
    [6, 'hall', 4, 'round', 110, 395, 34, 34],
    [7, 'hall', 4, 'rect', 270, 405, 92, 56],
    [8, 'hall', 8, 'rect', 360, 520, 150, 62],
    [9, 'veranda', 2, 'round', 620, 105, 26, 26],
    [10, 'veranda', 2, 'round', 780, 105, 26, 26],
    [11, 'veranda', 4, 'round', 620, 225, 34, 34],
    [12, 'veranda', 4, 'round', 780, 225, 34, 34],
    [13, 'veranda', 6, 'rect', 620, 355, 112, 62],
    [14, 'veranda', 6, 'rect', 780, 355, 112, 62],
    [15, 'veranda', 4, 'round', 620, 485, 34, 34],
    [16, 'veranda', 4, 'round', 780, 485, 34, 34],
];

const MENU = [
    ["salads", "Хориатики", "Классический деревенский салат: спелые томаты, хрустящие огурцы, красный лук, оливки Каламата, ломтик феты и орегано.", 950, "photo-1625944230945-1b7dd3b949ab"],
    ["salads", "Арбуз с фетой и мятой", "Холодный сладкий арбуз, солёная фета, свежая мята, бальзамическая глазурь и капля оливкового масла.", 900, "photo-1690921349852-7694d2b2c447"],
    ["salads", "Цитрусовый салат с рукколой", "Апельсин, грейпфрут, рукола, фисташки и лёгкая заправка из лимона и мёда.", 1050, "photo-1516554646385-7642248096d1"],
    ["salads", "Дакос", "Критский ячменный сухарик, тёртые томаты, фета, каперсы и оливковое масло холодного отжима.", 850, "photo-1635432877848-9c86755eb2f9"],
    ["starters", "Хумус с оливковым маслом", "Нежный нутовый хумус с тахини, паприкой и тёплой питой.", 650, "photo-1637949385162-e416fb15b2ce"],
    ["starters", "Сырная тарелка с мёдом", "Фета, графавьера, инжир, грецкие орехи и тимьяновый мёд.", 1200, "photo-1661349008073-136bed6e6788"],
    ["starters", "Креветки-гриль с лимоном", "Королевские креветки на шпажках, чесночное масло, лимон и свежая зелень.", 1350, "photo-1645060809993-461b21c1921c"],
    ["starters", "Осьминог на углях", "Нежный осьминог с древесным дымком, картофель, каперсы и лимонная заправка.", 1500, "photo-1572438631563-a3429408a845"],
    ["drinks", "Домашний лимонад с мятой", "Свежие лимоны, мята, мёд и лёд. Холодный, кислый, солнечный.", 450, "photo-1690983322317-c0437262f0cb"],
    ["drinks", "Греческий фраппе", "Взбитый ледяной кофе с молоком — главный напиток греческих пляжей.", 400, "photo-1517701550927-30cf4ba1dba5"],
    ["drinks", "Кофе-тоник с апельсином", "Холодный эспрессо, тоник, долька апельсина и лёд.", 500, "photo-1527156231393-7023794f363c"],
    ["drinks", "Коктейль «Закат над Эгейским»", "Цитрусовый коктейль с просекко, апельсиновым биттером и свежими фруктами.", 800, "photo-1762883469110-cc07660a8036"],
    ["mains", "Дорадо на гриле", "Целая дорада на углях с овощным салатом, лимоном и оливковым маслом.", 2100, "photo-1600699899970-b1c9fadd8f9e"],
    ["mains", "Сибас с запечёнными овощами", "Филе сибаса, цукини, баклажан, томаты черри и свежие травы.", 2200, "photo-1519708227418-c8fd9a32b7a2"],
    ["mains", "Сувлаки из курицы с питой", "Сочные шашлычки из курицы, тёплая пита, маринованные овощи и соус цацики.", 1450, "photo-1777891257551-bd5ecdb71c7e"],
    ["mains", "Шашлычки из ягнёнка", "Мягкая ягнятина на шпажках, лимонный картофель и йогуртовый соус.", 1700, "photo-1767974968707-db3d448d4ef3"],
    ["mains", "Гирос с говядиной", "Тонко нарезанная говядина в тёплой лепёшке с томатами, луком и цацики.", 1250, "photo-1529006557810-274b9b2fc783"],
    ["desserts", "Греческий йогурт с мёдом", "Густой йогурт, тимьяновый мёд, грецкие орехи и свежие фрукты.", 600, "photo-1722607571891-7ab5396a1b83"],
    ["desserts", "Пахлава с фисташками", "Слоёное тесто, фисташки и медовый сироп с корицей.", 650, "photo-1561708666-988573bf15ec"],
    ["desserts", "Йогуртовая чаша с фруктами", "Йогурт, сезонные фрукты, гранола и капелька мёда.", 700, "photo-1646343588889-07753bb55abf"],
    ["desserts", "Лукумадес", "Тёплые медовые пончики с корицей и грецким орехом.", 650, "photo-1547318643-84d5cec56519"],
];

async function seed(pool) {
    const tablesCheck = await pool.request().query('SELECT COUNT(*) AS c FROM tables_cafe');
    if (tablesCheck.recordset[0].c === 0) {
        for (const t of TABLES) {
            await pool.request()
                .input('id', sql.Int, t[0])
                .input('zone', sql.NVarChar, t[1])
                .input('seats', sql.Int, t[2])
                .input('shape', sql.NVarChar, t[3])
                .input('x', sql.Int, t[4])
                .input('y', sql.Int, t[5])
                .input('w', sql.Int, t[6])
                .input('h', sql.Int, t[7])
                .query('INSERT INTO tables_cafe (id, zone, seats, shape, x, y, w, h) VALUES (@id, @zone, @seats, @shape, @x, @y, @w, @h)');
        }
    }

    const menuCheck = await pool.request().query('SELECT COUNT(*) AS c FROM menu_items');
    if (menuCheck.recordset[0].c === 0) {
        for (const [i, m] of MENU.entries()) {
            await pool.request()
                .input('category', sql.NVarChar, m[0])
                .input('name', sql.NVarChar, m[1])
                .input('description', sql.NVarChar, m[2])
                .input('price', sql.Int, m[3])
                .input('image', sql.NVarChar, m[4])
                .input('sort', sql.Int, i)
                .query('INSERT INTO menu_items (category, name, description, price_cents, image, sort) VALUES (@category, @name, @description, @price, @image, @sort)');
        }
    }

    await seedAdmin(pool);
}

async function seedAdmin(pool) {
    const adminCheck = await pool.request()
        .input('email', sql.NVarChar, cfg.adminEmail)
        .query("SELECT COUNT(*) AS c FROM users WHERE role='admin' AND email = @email");

    if (adminCheck.recordset[0].c > 0) return;

    if (cfg.isProd && cfg.adminPassword === cfg.DEFAULT_ADMIN_PASSWORD) {
        throw new Error('В production задайте ADMIN_PASSWORD.');
    }

    const hash = bcrypt.hashSync(cfg.adminPassword, cfg.bcryptRounds);
    await pool.request()
        .input('name', sql.NVarChar, 'Администратор')
        .input('email', sql.NVarChar, cfg.adminEmail)
        .input('pass', sql.NVarChar, hash)
        .query("INSERT INTO users (name, email, phone, password_hash, role) VALUES (@name, @email, '', @pass, 'admin')");

    console.log(`★ Создан администратор: ${cfg.adminEmail}`);
}

/** Создаёт таблицы и стартовые данные. Вызывается один раз из server.js перед запуском сервера. */
const init = initializeDatabase;

module.exports = { getPool, query, one, transaction, init, sql };