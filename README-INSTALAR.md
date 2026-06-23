# Kaan Luum POS — Instalación rápida

> Guía completa y para personal no técnico: **`GUIA-INSTALACION-Y-USO.md`**

## Generar el instalador (una sola vez, requiere Node.js 20+)

En la carpeta del proyecto:

```
npm install
npm run dist
```

Resultado en `dist/`:
- `Kaan Luum POS Setup 1.0.0.exe` → **instalador** (este se lleva al negocio).
- `Kaan Luum POS 1.0.0.exe` → versión portable (opcional).

## Instalar en la PC del negocio

1. Doble clic en `Kaan Luum POS Setup 1.0.0.exe`.
   - Si aparece "Windows protegió tu PC": *Más información → Ejecutar de todas formas*.
2. Se instala solo, crea accesos directos en el Escritorio y se abre.
3. El **arranque automático al encender Windows ya queda activado** (no hay que hacer nada).
4. Deja la impresora térmica como **predeterminada** en Windows.

## Cosas que ya NO necesitas hacer

- ❌ Ya no hace falta `npm run dev` ni nodemon (eliminados; el proyecto está en modo producción).
- ❌ Ya no hace falta copiar manualmente accesos directos a `shell:startup`.
- ❌ Ya no hace falta `curl` para cambiar PINs → se hace desde la sección **Usuarios** de la app.

## Salir / Apagar

Botón rojo **"⏻ Salir / Apagar"** en el menú lateral → pide PIN de administrador.

## Base de datos y respaldos

Datos en: `C:\Users\<USUARIO>\AppData\Roaming\Kaan Luum POS\kaan_luum.db`

- Respaldo **automático diario** en `...\Kaan Luum POS\backups\` (últimos 30 días).
- Respaldo **manual**: acceso directo del Escritorio *"Kaan Luum - Respaldar datos"*.
- Restaurar: Menú Inicio → *Kaan Luum POS → Restaurar base de datos*.

## Usuarios de fábrica (¡cambiar los PINs!)

| Usuario | PIN  | Rol    |
|---------|------|--------|
| admin   | 1234 | admin  |
| cajera  | 0000 | cajera |

Cámbialos desde la app (sección **Usuarios**, como admin) antes de operar con dinero.

## Requisitos de la PC del negocio

- Windows 10 / 11 (64 bits). **No** necesita Node.js.
- Impresora térmica configurada como predeterminada.
- Recomendado: No-Break (UPS) para proteger contra apagones.
