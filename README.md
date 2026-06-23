# Kaan Luum · Punto de Venta

Punto de venta para la venta de boletos (brazaletes) de la Laguna de Kaan Luum,
Tulum. Pensado para correr de forma local en una terminal touch dedicada, en
modo kiosko, con impresora térmica de tickets.

## Requisitos

- Node.js 20, 22, 23 o 24
- npm
- Windows 10/11 con Google Chrome o Microsoft Edge instalado (para el modo
  kiosko)
- Impresora térmica configurada como impresora predeterminada de Windows

## Instalación

```powershell
cd "punto de venta kaam luum 22-06-2026"
npm install
npm start
```

Abre `http://localhost:3000` en el navegador de la terminal.

## Arranque automático en la terminal touch

`scripts/iniciar-pos.bat` levanta el servidor local y abre el navegador en
modo kiosko (pantalla completa, sin barra de direcciones, **impresión
silenciosa** a la impresora térmica predeterminada — sin diálogo de impresión
en cada venta):

1. Confirma que la impresora térmica esté configurada como predeterminada en
   Windows (Configuración → Impresoras y escáneres).
2. Prueba el arranque manual: doble clic en `scripts\iniciar-pos.bat`.
3. Para que la terminal quede lista sola al encender la máquina: crea un
   acceso directo a `iniciar-pos.bat` dentro de la carpeta de inicio de
   Windows (`Win+R` → escribe `shell:startup` → Enter → pega el acceso
   directo ahí).

El ancho del ticket impreso se controla con una sola variable en
`public/index.html` (`--receipt-width`, dentro de `:root`). Por defecto está
en `80mm`; cámbiala a `58mm` si el rollo de la impresora es angosto.

## Usuarios

El sistema viene con dos usuarios de fábrica:

| Usuario | PIN  | Rol     |
|---------|------|---------|
| admin   | 1234 | admin   |
| cajera  | 0000 | cajera  |

Los PIN se guardan **hasheados** en la base de datos (nunca en texto plano ni
en el código del navegador). Cámbialos antes de operar con dinero real
llamando una vez a:

```powershell
curl -X POST http://localhost:3000/api/caja/cambiar-pin -H "content-type: application/json" -d "{\"usuario\":\"admin\",\"pin_actual\":\"1234\",\"pin_nuevo\":\"TU-PIN-NUEVO\"}"
```

El rol **admin** ve Panel, Inventario, Corte e Historial además de Caja. El
rol **cajera** solo ve Caja.

## Flujo operativo

1. Inicia sesión con usuario y PIN.
2. Abre el turno: captura el fondo inicial en efectivo y el tipo de cambio del
   día (1 USD = ? MXN). La caja queda bloqueada hasta hacer esto.
3. En **Caja**, selecciona la cantidad de cada tipo de brazalete y agrega uno
   o varios pagos (efectivo, tarjeta, dólar, transferencia o cortesía) hasta
   cubrir el total. El sistema calcula el cambio en efectivo automáticamente.
4. Al confirmar, se genera un folio individual por visitante y se imprime el
   ticket.
5. Al final del turno, ve a **Corte**: captura el efectivo contado en caja, el
   sistema muestra la diferencia contra lo esperado, e imprime el resumen.
6. **Cerrar turno** guarda ese corte de forma permanente (queda en
   "Turnos anteriores" dentro de Historial) y cancela cualquier brazalete que
   haya quedado sin registrar salida.

## Tarifas configuradas

| Brazalete  | Color    | Precio | Tipo   |
|------------|----------|--------|--------|
| Nacional   | Rosa     | $250   | Adulto |
| Extranjero | Rojo     | $350   | Adulto |
| Agencia    | Azul     | $200   | Adulto |
| INAPAM     | Naranja  | $150   | Adulto |
| Local / Tulumense | Verde | $150 | Local |
| Niño (3 a 11 años) | Amarillo | $150 | Niño |
| Cortesía   | Blanco   | $0     | Adulto |

Las tarifas viven en la tabla `tickets` de la base de datos, no en el código
del navegador — para cambiarlas, actualiza esa tabla (o pide que se agregue
una pantalla de administración de tarifas).

## Inventario de brazaletes

Cada color tiene 100 brazaletes físicos disponibles (configurable en la tabla
`caja_inventario_color`). El stock se descuenta de por vida, no por turno: una
vez vendido un brazalete de un color, ese número ya no vuelve a estar
disponible (salvo que se cancele por cierre de turno sin haberlo entregado).

## Datos y respaldo

La base se crea como `kaan_luum.db` en la carpeta del proyecto. Con el
servidor detenido, respalda ese archivo para conservar ventas, turnos y
corte de caja. Los archivos `kaan_luum.db-wal` y `kaan_luum.db-shm` son
normales mientras el servidor está encendido.

## Pruebas

```powershell
npm test
```

## API (Caja)

- `POST /api/caja/login`
- `POST /api/caja/cambiar-pin`
- `GET /api/caja/tickets`
- `GET /api/caja/inventario`
- `GET /api/caja/turno-activo`
- `POST /api/caja/turnos/abrir`
- `POST /api/caja/turnos/cerrar`
- `GET /api/caja/turnos/cerrados`
- `POST /api/caja/ventas`
- `POST /api/caja/movimientos`
- `GET /api/caja/corte`
- `GET /api/caja/dashboard`
- `GET /api/caja/historial`

## Notas para quien siga desarrollando esto

- Este proyecto corre 100% local (Express + SQLite vía `better-sqlite3`). No
  necesita internet para operar ni depende de Vercel/Postgres — esas piezas
  (`database-postgres.js`, `repository.js`) siguen en el repo por si algún día
  se quiere una instancia en la nube, pero no se usan en la instalación local
  y no se mantienen activamente.
- `routes/pos-routes.js`, `services/pos-core-service.js` y el namespace `pos`
  de `database.js` son un backend anterior (tickets/turnos/ventas con un solo
  método de pago, brazaletes con entrada/salida) que ya no usa el frontend.
  Tienen sus propias pruebas y siguen pasando, pero son candidatos a
  eliminarse si nadie los necesita.
- Las rutas legacy basadas en la tabla `registros` (`/api/historial`,
  `/api/reportes`, `/api/exportar`, `/api/adentro`, `/api/catalogo` dentro de
  `create-app.js`) tampoco las usa la Caja actual; existen desde antes de
  este rediseño.
