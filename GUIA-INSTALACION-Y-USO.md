# Kaan Luum POS — Guía completa de instalación y uso

Sistema de punto de venta y control de brazaletes para la Laguna de Kaan Luum (Tulum).
Esta guía está escrita para que **cualquier persona, sin conocimientos técnicos**, pueda
instalar, usar y mantener el sistema en la computadora del negocio.

---

## 1. ¿Qué hace este sistema?

- Registra entradas/salidas y cobros de brazaletes.
- Funciona como una **aplicación de escritorio de Windows** (no es una página web).
- Se abre en **pantalla completa** (modo kiosko) y se inicia **sola al encender la PC**.
- Imprime tickets en la **impresora térmica predeterminada** automáticamente.
- Guarda toda la información en la propia computadora y hace **respaldos automáticos diarios**.

El personal **nunca necesita usar comandos ni la terminal**.

---

## 2. Generar el instalador (esto se hace UNA sola vez, en la PC del desarrollador)

> Este paso requiere internet y Node.js. Se hace una vez para **crear** el instalador.
> La computadora del negocio **no** necesita Node.js.

1. Instala **Node.js 20 o superior** desde https://nodejs.org (botón "LTS").
2. Copia la carpeta del proyecto (`kaan-luum-pos`) a la PC.
3. Abre **PowerShell** o **CMD** dentro de esa carpeta y ejecuta, en orden:

   ```
   npm install
   npm run dist
   ```

4. Al terminar, dentro de la carpeta **`dist/`** encontrarás:
   - **`Kaan Luum POS Setup 1.0.0.exe`** → instalador profesional (este es el que usarás).
   - **`Kaan Luum POS 1.0.0.exe`** → versión portable (no instala, solo ejecuta; opcional).

Eso es todo lo que tienes que ejecutar. El archivo **`Kaan Luum POS Setup 1.0.0.exe`** es el
instalador final que llevarás a la computadora del negocio.

---

## 3. Instalar en una computadora NUEVA (paso a paso)

En la computadora del negocio (Windows 10 u 11, 64 bits):

1. Copia el archivo **`Kaan Luum POS Setup 1.0.0.exe`** (con una USB o por correo).
2. Haz **doble clic** en el instalador.
   - Si Windows muestra un aviso azul ("Windows protegió tu PC"), haz clic en
     **"Más información" → "Ejecutar de todas formas"**. Esto ocurre porque el instalador
     no está firmado digitalmente; es normal.
3. El programa se instala solo y al terminar:
   - Crea el acceso directo **"Kaan Luum POS"** en el **Escritorio**.
   - Crea el acceso directo **"Kaan Luum - Respaldar datos"** en el Escritorio.
   - Se abre automáticamente.
4. **Conecta y enciende la impresora térmica** y déjala como **impresora predeterminada**:
   - Windows → *Configuración* → *Bluetooth y dispositivos* → *Impresoras y escáneres*
   - Abre tu impresora → marca **"Establecer como predeterminada"**.
5. Listo. A partir de ahora, **cada vez que enciendas la PC, el sistema se abrirá solo**.

### Cambiar los PINs (¡IMPORTANTE antes de operar con dinero!)

El sistema viene con usuarios de fábrica:

| Usuario | PIN de fábrica | Rol           |
|---------|----------------|---------------|
| admin   | 1234           | Administrador |
| cajera  | 0000           | Cajera        |

Cámbialos desde la misma aplicación: entra como **admin**, ve a la sección **Usuarios**
y edita el PIN de cada usuario. No dejes los PINs de fábrica.

---

## 4. Uso diario

- **Encender:** prende la computadora. El sistema se abre solo en pantalla completa.
- **Operar:** inicia sesión con tu usuario y PIN, abre el turno (fondo de caja) y empieza a cobrar.
- **Apagar al final del día:** en el menú lateral presiona el botón rojo **"⏻ Salir / Apagar"**.
  Te pedirá el **PIN de administrador** (para que un cliente no pueda cerrarlo). Tras salir,
  apaga la computadora normalmente desde Windows.

> El sistema bloquea atajos como Alt+F4 o F11 para que nadie cierre la app por accidente.
> La **única** forma de salir es el botón "Salir / Apagar" con el PIN de admin.

---

## 5. Respaldos de la información (ventas)

### Respaldo automático (ya activado)
Cada día, **al abrir el sistema**, se crea automáticamente una copia de la base de datos en:

```
C:\Users\<USUARIO>\AppData\Roaming\kaan-luum-control\backups\
```

Se conservan los **últimos 30 días**. No tienes que hacer nada.

### Respaldo manual (recomendado semanalmente, a una USB)
Haz **doble clic** en el acceso directo del Escritorio **"Kaan Luum - Respaldar datos"**.
Se creará una copia con fecha y hora en:

```
Escritorio\Respaldos Kaan Luum\
```

Copia esa carpeta a una **memoria USB o a la nube** de vez en cuando. Si la computadora
se daña o se la roban, con ese archivo recuperas todas las ventas.

### Restaurar un respaldo
1. Cierra el sistema con el botón **"Salir / Apagar"**.
2. Abre el Menú Inicio → carpeta **"Kaan Luum POS"** → **"Restaurar base de datos"**.
   (o ejecuta `herramientas\Restaurar-base-de-datos.bat`).
3. Escribe el nombre del archivo de respaldo que quieras restaurar y confirma.
4. Vuelve a abrir Kaan Luum POS.

---

## 6. ¿Se pierden las ventas si se reinicia o se va la luz?

**No.** La información se guarda en disco de forma segura:

- La base de datos vive en `AppData\Roaming\kaan-luum-control\kaan_luum.db`, **fuera** del
  programa, así que **no se borra al actualizar ni al reinstalar**.
- Se usa el modo **WAL + `synchronous=FULL`** de SQLite: cada venta confirmada se escribe
  físicamente al disco, por lo que sobrevive a un **apagón o reinicio inesperado**.
- Además están los **respaldos automáticos diarios** como segunda red de seguridad.

> Recomendación para un negocio: usa un **No-Break (UPS)** en la computadora y la impresora.
> Protege contra apagones bruscos y alarga la vida del equipo.

---

## 7. Notas de seguridad y rendimiento (revisión técnica)

- **Acceso solo local:** el servidor interno escucha únicamente en `127.0.0.1`. **No** está
  expuesto a la red WiFi, así que nadie más en la red puede registrar ventas ni leer la caja.
- **PINs cifrados:** los PINs se guardan con hash PBKDF2 (no en texto plano).
- **Cambia los PINs de fábrica** antes de operar con dinero (ver sección 3).
- **Una sola instancia:** el sistema impide abrir dos copias a la vez (evita conflictos de datos).
- **Rendimiento:** SQLite local es muy rápido para el volumen de un punto de venta; no depende
  de internet para funcionar.
- **Mantenimiento:** revisa una vez al mes que los respaldos en la USB existan y se puedan abrir.

---

## 8. Problemas comunes

| Síntoma | Solución |
|---|---|
| No imprime el ticket | Verifica que la impresora térmica esté encendida y sea la **predeterminada** de Windows. |
| No se abrió sola al encender | Abre el acceso directo "Kaan Luum POS" del Escritorio una vez; el arranque automático se activa al instalar. |
| "Windows protegió tu PC" al instalar | "Más información" → "Ejecutar de todas formas" (instalador sin firma, es normal). |
| Olvidé el PIN de admin | Restaura un respaldo anterior o contacta al desarrollador para reiniciar credenciales. |
| Quiero mover el sistema a otra PC | Instala el Setup en la PC nueva y restaura el último respaldo (sección 5). |

---

## 9. Resumen de comandos (solo para generar el instalador)

```
npm install        # instala dependencias (una vez)
npm run dist       # genera dist\Kaan Luum POS Setup 1.0.0.exe
```

El archivo a instalar en el negocio es: **`dist\Kaan Luum POS Setup 1.0.0.exe`**
