# Kaan Luum POS y Control Operativo

## Objetivo

Evolucionar el control de brazaletes existente a un sistema de punto de venta,
acceso, caja, inventario y reportes sin reescribir la aplicación ni alterar los
registros históricos.

La nueva versión conserva Node.js, Express, SQLite local, Neon PostgreSQL en
Vercel y la PWA en HTML, CSS y JavaScript vanilla.

## Principios aprobados

- Caja vende primero y genera brazaletes en estado `pendiente`.
- Entrada solamente valida folios vendidos y cambia `pendiente` a `adentro`.
- Salida solamente acepta folios `adentro` y cambia su estado a `salido`.
- Cada visitante recibe un folio único, aunque pertenezca a una venta grupal.
- Los folios se generan automáticamente; la asignación manual es opcional y
  queda marcada para auditoría.
- No se permite operar sin operador activo ni turno abierto.
- Solo puede existir un turno abierto por caja.
- Cada operación usa un único método de pago.
- Las cancelaciones normales solo aplican a brazaletes `pendiente`.
- Después del acceso solo existe el reembolso excepcional auditado.
- Los consumibles se descuentan definitivamente.
- Los recursos rentables se ocupan temporalmente y se liberan en la devolución
  o salida, salvo incidencia registrada.
- Toda operación crítica es transaccional.
- La tabla `registros` se conserva intacta como fuente `legacy`.

## Arquitectura

El backend se dividirá gradualmente:

```text
routes/          Endpoints y validación HTTP
services/        Reglas de negocio y coordinación transaccional
repositories/    Persistencia común para SQLite y PostgreSQL
migrations/      Esquema versionado y datos iniciales
public/          SPA y módulos de interfaz
```

Los servicios no dependerán directamente de SQL ni de Express. Recibirán un
repositorio transaccional y devolverán resultados de dominio o errores
tipificados.

SQLite utilizará transacciones de `better-sqlite3`. PostgreSQL utilizará una
conexión transaccional compatible con Neon. Una operación no podrá confirmar
solo parte de sus cambios.

## Modelo de datos

### Configuración

Guarda nombre del negocio, aforo máximo, siguiente consecutivo general,
fecha de activación del modelo nuevo y preferencias operativas.

### Operadores

Catálogo simple de nombres activos. No incluye contraseñas ni permisos.
La sesión guarda el operador seleccionado, pero cada petición que modifica
datos enviará el nombre y el backend validará que esté activo.

### Turnos

Contiene responsable de apertura, depósito inicial, apertura, cierre, estado y
resumen final. Solo puede existir un turno `abierto`.

Cambiar el operador activo no cambia el turno. Cada acción conserva tanto
`turno_id` como el operador que la ejecutó.

### Tickets

Catálogo editable con nombre, precio, color sugerido, prefijo opcional y estado:

- Nacional
- Extranjero
- Agencia
- Niño
- Local / Tulumense
- INAPAM
- Cortesía

El color es informativo; precio y tipo siempre provienen del registro oficial.

### Ventas y partidas

Una venta guarda turno, operador, método de pago, totales, estado y marcas de
tiempo. Sus partidas guardan una copia histórica del nombre y precio unitario
para que los cambios futuros del catálogo no alteren ventas anteriores.

Una venta puede contener múltiples tickets y servicios. Cada ticket genera un
brazalete individual. Los servicios ligados a una persona guardan su folio.

### Brazaletes

Campos principales:

- Folio único.
- Ticket, tipo de visitante, color y precio histórico.
- Estado: `pendiente`, `adentro`, `salido` o `cancelado`.
- Venta y turno asociados.
- Generación automática o asignación manual.
- Operadores y fechas de creación, entrada y salida.

El folio automático usa `KL-00001`. El consecutivo se reserva dentro de la
misma transacción que crea la venta.

### Servicios

Catálogo con nombre, precio, tipo, inventariable, inventario asociado y estado.
Incluye inicialmente Dron, Kayak, Paddle Board, Apnea, Buzo, Locker y Chaleco.

### Inventario

Cada artículo tiene categoría, modalidad `consumible` o `rentable`, existencia
total, stock mínimo, unidad y estado.

Los consumibles mantienen `stock_actual`. Los rentables mantienen cantidad
total y disponibilidad calculada a partir de asignaciones activas.

### Asignaciones rentables

Relacionan folio, servicio, cantidad, entrega, devolución y posible incidencia.
Una incidencia exige tipo, nota y operador; mientras siga abierta, el recurso
no vuelve a estar disponible.

### Movimientos

Libro inmutable para auditoría. Registra:

- Venta.
- Entrada y salida.
- Servicio adicional.
- Cancelación y reembolso.
- Ingreso y egreso de caja.
- Ajuste de inventario.
- Apertura y corte de turno.
- Incidencias de recursos.

Cada movimiento guarda turno, operador, tipo, referencias, método de pago,
monto, cantidad, fecha y metadatos JSON. No se edita ni elimina; las
correcciones generan movimientos compensatorios.

### Movimientos de caja

Las entradas y salidas manuales exigen concepto, monto, método, operador y
nota. Solo los movimientos en efectivo afectan el efectivo esperado.

### Cortes

El corte conserva una fotografía de:

- Depósito inicial.
- Ventas por método.
- Cancelaciones y reembolsos por método.
- Ingresos y egresos en efectivo.
- Efectivo esperado y contado.
- Diferencia.
- Operador y cierre.

Una vez cerrado, el turno y su corte son históricos e inmutables.

## Flujos transaccionales

### Abrir turno

1. Validar que no exista otro turno abierto.
2. Validar operador y depósito.
3. Crear turno.
4. Crear movimiento de apertura.
5. Confirmar.

### Crear venta

1. Validar turno, operador, catálogos, cantidades y método de pago.
2. Validar stock de consumibles y recursos.
3. Reservar folios automáticos y validar manuales.
4. Crear venta y partidas.
5. Crear un brazalete `pendiente` por visitante.
6. Descontar consumibles y crear asignaciones rentables si corresponden.
7. Insertar movimientos de venta e inventario.
8. Confirmar o revertir todo.

Las cortesías tienen monto cero y motivo obligatorio.

### Registrar entrada

1. Validar turno y operador.
2. Buscar brazalete.
3. Exigir estado `pendiente`.
4. Validar aforo.
5. Cambiar a `adentro` y guardar fecha y operador.
6. Crear movimiento de entrada.
7. Confirmar.

Los folios desconocidos, cancelados, adentro o salidos se rechazan.

### Agregar servicios

1. Validar turno, operador y folio `pendiente` o `adentro`.
2. Validar servicios y disponibilidad.
3. Crear una operación adicional con un método de pago.
4. Crear partidas y asignaciones.
5. Actualizar inventario.
6. Crear movimientos financieros y de inventario.
7. Confirmar.

Esta operación nunca modifica el estado de acceso.

### Registrar salida

1. Exigir brazalete `adentro`.
2. Revisar asignaciones rentables activas.
3. Liberarlas automáticamente, salvo excepciones indicadas.
4. Crear incidencias obligatorias para recursos no devueltos.
5. Cambiar el brazalete a `salido`.
6. Crear movimientos de devolución, incidencia y salida.
7. Confirmar.

### Cancelar

Solo permite brazaletes `pendiente`. Exige motivo y genera movimientos
compensatorios para venta, caja e inventario. Una venta grupal puede cancelarse
completa o por brazalete, recalculando su saldo cancelado.

### Reembolso excepcional

Disponible para brazaletes `adentro` o `salido`. Exige motivo, responsable que
autoriza, monto, método y nota. No cambia automáticamente el estado del acceso.

### Cerrar turno

1. Calcular totales exclusivamente desde operaciones confirmadas del turno.
2. Calcular:

```text
efectivo esperado =
  depósito inicial
  + ventas en efectivo
  - cancelaciones y reembolsos en efectivo
  + ingresos manuales en efectivo
  - egresos manuales en efectivo
```

3. Capturar efectivo contado.
4. Calcular diferencia.
5. Guardar corte y movimiento.
6. Cerrar turno.
7. Bloquear nuevas operaciones asociadas.

## API prevista

La API se agrupará por módulos:

- `/api/operadores`
- `/api/turnos`
- `/api/tickets`
- `/api/ventas`
- `/api/brazaletes`
- `/api/accesos`
- `/api/servicios`
- `/api/adicionales`
- `/api/inventario`
- `/api/caja`
- `/api/cortes`
- `/api/historial`
- `/api/reportes`
- `/api/configuracion`
- `/api/respaldos`

Las rutas actuales se conservarán durante la transición. Al migrar Entrada y
Salida, `/api/entrada` y `/api/salida` delegarán en los nuevos servicios.

Todos los errores mantendrán:

```json
{ "success": false, "error": "mensaje descriptivo" }
```

Se usarán `400` para datos inválidos, `404` para referencias inexistentes,
`409` para conflictos de estado o inventario y `500` para fallos internos.

## Interfaz

El sidebar final contendrá:

- Panel.
- Caja.
- Entrada.
- Adicionales.
- Salida.
- Inventario.
- Movimientos de caja.
- Historial.
- Reportes.
- Corte de caja.
- Configuración.

La aplicación seguirá siendo SPA y PWA. En móvil, la navegación inferior no
mostrará once botones simultáneos: tendrá cinco accesos principales y un menú
`Más` para el resto.

Al abrir la aplicación:

1. Se selecciona o captura operador.
2. Se abre o recupera el turno activo.
3. Sin turno abierto, solo se permiten apertura, historial, configuración y
   consulta de cortes.

Las acciones destructivas usarán confirmación explícita y mostrarán el impacto
financiero o de inventario antes de ejecutarse.

## Historial y legacy

`registros` no será migrada ni modificada. El historial unificado consultará:

- Movimientos nuevos.
- Entradas y salidas antiguas transformadas únicamente en la respuesta como
  registros `legacy`.

Los datos legacy no participarán en cortes, inventario ni ventas nuevas. Los
reportes permitirán distinguir operación nueva de historial heredado.

## Respaldo y exportación

- CSV por módulo y corte.
- JSON completo de las tablas nuevas y configuración.
- Importación JSON solo mediante validación de versión y transacción.
- La importación no sobrescribirá `registros`.
- Neon será la fuente persistente de producción; SQLite seguirá siendo la
  fuente local.

## Entregas

### Entrega 1: Núcleo

Operadores, turnos, catálogos, ventas, folios y entrada/salida. Incluye
compatibilidad legacy y migraciones iniciales.

### Entrega 2: Adicionales e inventario

Servicios adicionales, consumibles, recursos rentables, devoluciones e
incidencias.

### Entrega 3: Caja y control financiero

Movimientos manuales, cancelaciones, reembolsos excepcionales y cortes.

### Entrega 4: Cierre operativo

Historial unificado, reportes, configuración, CSV, respaldo e importación JSON.

Cada entrega debe desplegarse solo después de pasar pruebas locales para SQLite,
pruebas de servicios y API, y una verificación de producción con Neon.

## Estrategia de pruebas

- Pruebas unitarias para cálculos, estados y validaciones.
- Pruebas contractuales comunes para repositorios SQLite y PostgreSQL.
- Pruebas de API con SQLite en memoria.
- Pruebas de transacción que fuercen un fallo intermedio y demuestren rollback.
- Pruebas de concurrencia para folios, aforo, stock y turno único.
- Pruebas de regresión para PWA, dashboard y datos legacy.
- Casos completos de venta, acceso, adicional, salida, cancelación y corte.

No se considerará terminada una entrega si quedan operaciones parciales tras un
fallo o si los totales del corte no pueden reconstruirse desde movimientos.

## Decisiones conservadoras

- Importes se almacenan como enteros en pesos mientras no se requieran
  centavos.
- Fechas operativas conservan `timestamp` y `fecha` local de Cancún.
- Los precios históricos se copian en partidas y brazaletes.
- Los movimientos son inmutables.
- Los pagos combinados, autenticación y permisos quedan fuera del MVP.
- Una sola caja y un solo turno abierto quedan dentro del MVP.
- Los recursos no devueltos permanecen ocupados hasta resolver su incidencia.
