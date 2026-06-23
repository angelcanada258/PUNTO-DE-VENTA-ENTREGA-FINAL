# Laguna de Kaan Luum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el sistema local completo de control de acceso, tarifas y reportes.

**Architecture:** Express expone una API REST e inyecta un repositorio SQLite.
Una SPA vanilla consume la API y representa los cinco módulos solicitados.

**Tech Stack:** Node.js, Express, better-sqlite3, HTML, CSS y JavaScript.

---

### Task 1: Persistencia

**Files:**
- Create: `database.js`
- Test: `test/api.test.js`

- [ ] Escribir una prueba que cree una base en memoria e inserte eventos.
- [ ] Ejecutar `npm test` y confirmar que falla porque no existe `database.js`.
- [ ] Crear el esquema, migraciones y las cuatro funciones públicas solicitadas.
- [ ] Ejecutar `npm test` y confirmar la persistencia.

### Task 2: API

**Files:**
- Create: `server.js`
- Test: `test/api.test.js`

- [ ] Probar entrada válida, duplicada, aforo, salida válida e inválida.
- [ ] Ejecutar las pruebas y confirmar los fallos esperados.
- [ ] Implementar validaciones, dashboard, historial, adentro, reportes y CSV.
- [ ] Ejecutar `npm test` y confirmar que todos los casos pasan.

### Task 3: SPA

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`
- Create: `public/app.js`

- [ ] Crear la estructura accesible de los cinco módulos.
- [ ] Implementar el diseño responsive y los brazaletes de tarifas.
- [ ] Conectar formularios, filtros, refresco y reportes a la API.
- [ ] Verificar manualmente teclado, Enter, foco y navegación móvil.

### Task 4: Documentación y verificación

**Files:**
- Create: `README.md`

- [ ] Documentar instalación, arranque, red local, respaldo y tarifas.
- [ ] Ejecutar `npm test`.
- [ ] Arrancar en el puerto 3000 y consultar los endpoints principales.
- [ ] Abrir la SPA y verificar escritorio y móvil.
