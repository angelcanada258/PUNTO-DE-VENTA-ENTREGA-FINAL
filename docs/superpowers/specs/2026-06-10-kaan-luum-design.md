# Laguna de Kaan Luum: diseño del sistema

## Objetivo

Crear una aplicación web local, usable sin internet, para registrar entradas y
salidas mediante folios de brazalete, controlar un aforo de 50 personas,
consultar historial y reportes, y exportar la operación diaria a CSV.

## Arquitectura

- Express sirve la SPA y una API REST bajo `/api`.
- `better-sqlite3` conserva cada evento en `kaan_luum.db`.
- La SPA usa HTML, CSS y JavaScript vanilla, con navegación sin recargas.
- El servidor es la única fuente de verdad. El navegador no guarda registros.

## Modelo de acceso y tarifas

La clasificación operativa requerida se mantiene en `adulto`, `niño` y
`local`. Cada entrada también conserva una tarifa comercial y servicios:

| Tarifa | Tipo | Precio |
| --- | --- | ---: |
| Niño de 3 a 11 años | niño | $100 |
| INAPAM | adulto | $150 |
| Tulumnense con INE | local | $150 |
| Mexicano / residente | adulto | $250 |
| Persona con discapacidad | adulto | $250 |
| Extranjero | adulto | $350 |

Servicios opcionales: dron $250, apnea $300 y buzo $350. Los servicios suman al
total cobrado, pero no modifican el aforo.

La tabla base conserva todos los campos e índices solicitados. Una migración
aditiva incorpora `tarifa`, `precio`, `servicios` y `total` para registrar la
información de los brazaletes sin romper el contrato original.

## Reglas

- Un folio normalizado no puede tener dos entradas abiertas el mismo día.
- Una salida requiere una entrada abierta del mismo día.
- La entrada número 51 se rechaza con HTTP 409.
- Las fechas se guardan como `YYYY-MM-DD` en horario local del servidor.
- Los errores de API usan `{ "success": false, "error": "..." }`.

## Interfaz

El lenguaje visual combina agua turquesa, piedra clara y detalles cálidos
inspirados en los letreros de madera. En Entrada, las tarifas se presentan como
brazaletes seleccionables; seleccionar uno determina el tipo y precio. La barra
lateral de escritorio se convierte en navegación inferior en móvil.

## Verificación

Las pruebas automatizadas cubren persistencia, entrada, duplicados, salida,
aforo, dashboard, historial, reportes y CSV. La verificación visual recorre los
cinco módulos en escritorio y móvil.
