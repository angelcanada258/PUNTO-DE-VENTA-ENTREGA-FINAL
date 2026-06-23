# Kaan Luum POS Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar el núcleo operativo con operador, turno, catálogo de tickets, venta grupal, folios individuales y entrada/salida separadas.

**Architecture:** Se añadirá un repositorio POS transaccional con implementaciones SQLite y PostgreSQL, consumido por servicios de dominio independientes de Express. Las rutas nuevas convivirán con `registros` como fuente legacy y la SPA migrará Caja, Entrada y Salida sin romper la PWA.

**Tech Stack:** Node.js, Express, better-sqlite3, Neon PostgreSQL, HTML, CSS, JavaScript vanilla y Node Test Runner.

---

### Task 1: Contrato del repositorio POS y esquema SQLite

**Files:**
- Create: `test/pos-repository.test.js`
- Create: `migrations/001-pos-core-sqlite.sql`
- Create: `repositories/sqlite-pos-repository.js`
- Modify: `database.js`

- [ ] **Step 1: Escribir pruebas fallidas del esquema y transacciones**

Probar que el repositorio expone:

```js
const repository = createDatabase(':memory:');
repository.pos.listarTickets();
repository.pos.obtenerTurnoAbierto();
repository.pos.transaction((tx) => tx.abrirTurno({...}));
```

Verificar catálogos iniciales, turno único y rollback al lanzar una excepción.

- [ ] **Step 2: Ejecutar la prueba y confirmar el fallo**

Run: `node --test test/pos-repository.test.js`

Expected: FAIL porque `repository.pos` no existe.

- [ ] **Step 3: Crear esquema y repositorio mínimo**

Crear tablas `configuracion`, `operadores`, `turnos`, `tickets`, `ventas`,
`venta_items`, `brazaletes` y `movimientos`. Insertar los siete tickets
iniciales mediante `INSERT OR IGNORE`. Exponer una transacción síncrona que
entregue las mismas funciones del repositorio POS.

- [ ] **Step 4: Ejecutar pruebas**

Run: `node --test test/pos-repository.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add migrations repositories database.js test/pos-repository.test.js
git commit -m "feat: add transactional POS repository"
```

### Task 2: Servicios de turno y venta

**Files:**
- Create: `test/pos-services.test.js`
- Create: `services/domain-error.js`
- Create: `services/turn-service.js`
- Create: `services/sale-service.js`

- [ ] **Step 1: Escribir pruebas fallidas**

Cubrir:

```js
await turnService.abrir({ operador: 'Ana', depositoInicial: 2000 });
await saleService.crear({
  operador: 'Ana',
  metodoPago: 'efectivo',
  items: [
    { ticketId: 'nacional', cantidad: 2 },
    { ticketId: 'nino', cantidad: 1 }
  ]
});
```

Esperar tres folios consecutivos, brazaletes `pendiente`, total correcto,
movimiento de venta y rechazo sin turno o con folio manual duplicado.

- [ ] **Step 2: Ejecutar y confirmar el fallo**

Run: `node --test test/pos-services.test.js`

Expected: FAIL por módulos inexistentes.

- [ ] **Step 3: Implementar servicios**

`turn-service` valida operador, depósito y turno único. `sale-service` valida
un método entre `efectivo`, `tarjeta`, `transferencia` y `cortesia`, exige
motivo para cortesía, genera un brazalete por persona y copia precio, nombre,
tipo y color del ticket.

- [ ] **Step 4: Ejecutar pruebas**

Run: `node --test test/pos-services.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services test/pos-services.test.js
git commit -m "feat: add shift and ticket sale services"
```

### Task 3: Servicio de acceso

**Files:**
- Modify: `test/pos-services.test.js`
- Create: `services/access-service.js`

- [ ] **Step 1: Añadir pruebas fallidas**

Crear una venta y comprobar:

```js
await accessService.registrarEntrada({ folio, operador: 'Ana' });
await accessService.registrarSalida({ folio, operador: 'Luis' });
```

Verificar estados `adentro` y `salido`, operadores, timestamps, movimientos,
rechazo de folio desconocido, doble entrada, salida sin entrada y aforo.

- [ ] **Step 2: Ejecutar y confirmar el fallo**

Run: `node --test test/pos-services.test.js`

Expected: FAIL porque no existe `access-service`.

- [ ] **Step 3: Implementar acceso transaccional**

Entrada exige turno abierto y brazalete `pendiente`. Salida exige `adentro`.
Ambas actualizan estado y movimiento en una sola transacción. El aforo cuenta
solo brazaletes nuevos `adentro`.

- [ ] **Step 4: Ejecutar pruebas**

Run: `node --test test/pos-services.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/access-service.js test/pos-services.test.js
git commit -m "feat: validate sold wristbands at access"
```

### Task 4: API REST del núcleo

**Files:**
- Create: `routes/pos-routes.js`
- Modify: `create-app.js`
- Modify: `test/api.test.js`

- [ ] **Step 1: Añadir pruebas fallidas de API**

Cubrir:

- `GET /api/operadores`
- `POST /api/operadores/activo`
- `GET /api/turnos/activo`
- `POST /api/turnos/abrir`
- `GET /api/tickets`
- `POST /api/ventas`
- `GET /api/ventas/:id`
- `GET /api/brazaletes/:folio`
- `POST /api/entrada`
- `POST /api/salida`

Verificar códigos `201`, `400`, `404` y `409`, además del contrato JSON.

- [ ] **Step 2: Ejecutar y confirmar fallos**

Run: `node --test test/api.test.js`

Expected: FAIL porque las rutas POS no existen.

- [ ] **Step 3: Montar rutas y adaptar compatibilidad**

Inyectar `repository.pos` en los servicios. Reemplazar la escritura legacy de
`/api/entrada` y `/api/salida` por validación de brazaletes vendidos. Mantener
los endpoints legacy de lectura hasta la Entrega 4.

- [ ] **Step 4: Ejecutar pruebas**

Run: `npm test`

Expected: todas las pruebas en verde.

- [ ] **Step 5: Commit**

```bash
git add routes create-app.js test/api.test.js
git commit -m "feat: expose POS core API"
```

### Task 5: Repositorio PostgreSQL

**Files:**
- Create: `migrations/001-pos-core-postgres.sql`
- Create: `repositories/postgres-pos-repository.js`
- Modify: `database-postgres.js`
- Modify: `repository.js`
- Create: `test/pos-repository-contract.test.js`

- [ ] **Step 1: Definir contrato compartido**

Verificar que SQLite y un adaptador PostgreSQL simulado exponen los mismos
métodos y normalizan identificadores, importes y timestamps.

- [ ] **Step 2: Ejecutar y confirmar el fallo**

Run: `node --test test/pos-repository-contract.test.js`

Expected: FAIL por adaptador PostgreSQL inexistente.

- [ ] **Step 3: Implementar esquema y transacciones Neon**

Crear las mismas tablas, restricciones e índices. Usar transacciones SQL para
reservar consecutivos, crear ventas y cambiar estados. Extender el repositorio
seleccionado con la propiedad `pos`.

- [ ] **Step 4: Ejecutar pruebas**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add migrations repositories database-postgres.js repository.js test/pos-repository-contract.test.js
git commit -m "feat: support POS core on Neon"
```

### Task 6: Interfaz de operador, turno y Caja

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`
- Modify: `public/app.js`
- Modify: `test/pwa.test.js`

- [ ] **Step 1: Añadir prueba estructural fallida**

Exigir pantalla `page-caja`, control de operador, apertura de turno, filas de
ticket, selector de pago, resumen y lista de folios generados.

- [ ] **Step 2: Ejecutar y confirmar el fallo**

Run: `node --test test/pwa.test.js`

Expected: FAIL porque Caja no existe.

- [ ] **Step 3: Implementar UI**

Añadir Caja al sidebar, modal inicial de operador/turno y carrito de tickets.
La venta debe mostrar total antes de confirmar y, después, cada folio generado.
Guardar solo el nombre del operador activo en `sessionStorage`; todos los datos
operativos provienen de la API.

- [ ] **Step 4: Migrar Entrada y Salida**

Eliminar tarifa y cobro de Entrada. Mostrar datos del brazalete vendido antes
de confirmar acceso. Salida conserva escaneo rápido y usa el nuevo estado.

- [ ] **Step 5: Ejecutar pruebas**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public test/pwa.test.js
git commit -m "feat: add cashier workflow to SPA"
```

### Task 7: Dashboard y verificación de Entrega 1

**Files:**
- Modify: `create-app.js`
- Modify: `public/app.js`
- Modify: `README.md`
- Create: `test/pos-flow.test.js`

- [ ] **Step 1: Escribir flujo completo fallido**

Abrir turno, vender dos nacionales y un niño, registrar una entrada y salida,
y verificar dashboard, venta, folios y movimientos.

- [ ] **Step 2: Ejecutar y confirmar el fallo**

Run: `node --test test/pos-flow.test.js`

Expected: FAIL hasta integrar dashboard POS.

- [ ] **Step 3: Integrar métricas**

El dashboard nuevo cuenta brazaletes vendidos, pendientes, adentro, salidos y
ventas del turno. Los registros legacy siguen visibles en su historial, pero no
se suman a caja ni aforo nuevo.

- [ ] **Step 4: Documentar operación**

Describir selección de operador, apertura de turno, venta, entrada, salida,
persistencia local y producción Neon.

- [ ] **Step 5: Verificación final**

Run:

```powershell
npm test
node --check public/app.js
Invoke-WebRequest http://localhost:3000/api/dashboard
```

Expected: pruebas en verde, sintaxis válida y HTTP `200`.

- [ ] **Step 6: Commit**

```bash
git add create-app.js public/app.js README.md test/pos-flow.test.js
git commit -m "feat: complete POS core delivery"
```
