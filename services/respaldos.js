/**
 * services/respaldos.js
 * Respaldos automáticos de la BD y reportes HTML imprimibles.
 *
 * - El .db se copia con timestamp `kaan_luum-YYYY-MM-DD_HH-mm-ss.db` en cada
 *   apertura y cierre de turno (incluye archivos -wal/-shm para una copia íntegra).
 * - Los reportes se guardan como HTML con CSS imprimible: el usuario los abre
 *   con doble clic y los manda a imprimir con Ctrl+P.
 *
 * Si no hay `KAAN_DATA_DIR` (modo `npm start` web), el servicio queda en no-op.
 */

const fs = require('node:fs');
const path = require('node:path');

const METODO_LABEL = {
  efectivo: 'Efectivo',
  visa: 'Visa',
  mastercard: 'Mastercard',
  credito: 'Crédito',
  dolar: 'Dólar',
  transferencia: 'Transferencia',
  cortesia: 'Cortesía'
};

function pad(n) { return String(n).padStart(2, '0'); }

function timestampParaArchivo(date = new Date()) {
  return [
    date.getFullYear(), '-', pad(date.getMonth() + 1), '-', pad(date.getDate()),
    '_', pad(date.getHours()), '-', pad(date.getMinutes()), '-', pad(date.getSeconds())
  ].join('');
}

function fechaCorta(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatoFechaLarga(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' });
}

function mxn(n) {
  const valor = Number(n) || 0;
  return valor.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function noopService() {
  return {
    enabled: false,
    respaldarDb: () => {},
    escribirReporteCorte: () => {},
    escribirReporteDiario: () => {}
  };
}

function plantillaHtml({ titulo, encabezado, cuerpo }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(titulo)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#1f2933;margin:0;padding:32px;background:#f5f3ef}
  .sheet{max-width:780px;margin:0 auto;background:#fff;border:1px solid #d8d4cb;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.07);padding:32px}
  h1{margin:0 0 4px;font-family:Georgia,serif;font-size:28px;color:#5c3a1f;letter-spacing:.5px}
  h2{margin:24px 0 10px;font-size:15px;text-transform:uppercase;letter-spacing:.14em;color:#6b4a2f;border-bottom:1px solid #e6e1d6;padding-bottom:6px}
  .meta{color:#6b6b6b;font-size:13px;margin-bottom:8px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px 24px;font-size:14px}
  .grid div{display:flex;justify-content:space-between;border-bottom:1px dashed #e6e1d6;padding:6px 0}
  .grid div strong{color:#1f2933}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
  th,td{padding:8px 10px;border-bottom:1px solid #ece8df;text-align:left}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#6b6b6b;background:#faf7f0}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .total{font-family:Georgia,serif;font-size:22px;color:#5c3a1f;text-align:right;margin-top:10px}
  .diff-pos{color:#0a7c4d;font-weight:700}
  .diff-neg{color:#b3261e;font-weight:700}
  .firmas{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px}
  .firma-linea{border-top:1px solid #1f2933;margin-top:48px}
  .firma-label{text-align:center;font-size:12px;color:#6b6b6b;margin-top:6px}
  .pie{margin-top:28px;font-size:11px;color:#8a8a8a;text-align:center;border-top:1px dashed #e6e1d6;padding-top:14px}
  .print-btn{position:fixed;top:18px;right:18px;background:#5c3a1f;color:#fff;border:none;padding:10px 16px;border-radius:8px;font-weight:700;cursor:pointer;box-shadow:0 4px 10px rgba(0,0,0,.12)}
  @media print{
    body{background:#fff;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .sheet{box-shadow:none;border:none;border-radius:0;max-width:100%;padding:18px 22px}
    .print-btn{display:none}
    @page{size:A4;margin:14mm}
  }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">Imprimir</button>
<div class="sheet">
  <h1>Laguna Kaan Luum · Tulum</h1>
  <div class="meta">${encabezado}</div>
  ${cuerpo}
  <div class="pie">Generado por Kaan Luum POS · ${escapeHtml(new Date().toLocaleString('es-MX'))}</div>
</div>
</body>
</html>`;
}

function renderTablaPorMetodo(porMetodo) {
  const filas = Object.entries(porMetodo || {})
    .filter(([_, v]) => v && v.conteo)
    .map(([metodo, datos]) => `
      <tr>
        <td>${escapeHtml(METODO_LABEL[metodo] || metodo)}</td>
        <td class="num">${datos.conteo}</td>
        <td class="num">${mxn(datos.mxn)}</td>
        <td class="num">${metodo === 'dolar' ? 'US$ ' + (datos.usd || 0).toFixed(2) : '—'}</td>
      </tr>`).join('');
  if (!filas) return '<p class="meta">Sin pagos registrados.</p>';
  return `<table>
    <thead><tr><th>Método</th><th class="num">Pagos</th><th class="num">Importe MXN</th><th class="num">Origen</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>`;
}

function renderMovimientos(movs) {
  if (!movs || !movs.length) return '<p class="meta">Sin depósitos ni retiros.</p>';
  return `<table>
    <thead><tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th>Operador</th><th class="num">Monto</th></tr></thead>
    <tbody>${movs.map((m) => `
      <tr>
        <td>${escapeHtml(new Date(m.timestamp).toLocaleTimeString('es-MX'))}</td>
        <td>${escapeHtml(m.tipo === 'deposito' ? 'Depósito' : 'Retiro')}</td>
        <td>${escapeHtml(m.concepto)}</td>
        <td>${escapeHtml(m.operador)}</td>
        <td class="num">${mxn(m.monto)}</td>
      </tr>`).join('')}</tbody>
  </table>`;
}

function fmtDuracion(ms) {
  if (!ms || ms < 0) return '—';
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return (h ? h + ' h ' : '') + m + ' min';
}

function renderBrazaletesTabla(items) {
  if (!items || !items.length) return '<p class="meta">Sin brazaletes vendidos.</p>';
  return `<table>
    <thead><tr><th>Brazalete</th><th>Color</th><th class="num">Cantidad</th><th class="num">Cancelados</th><th class="num">Total</th></tr></thead>
    <tbody>${items.map((b) => `
      <tr>
        <td>${escapeHtml(b.nombre)}</td>
        <td>${escapeHtml(b.color)}</td>
        <td class="num">${b.cantidad}</td>
        <td class="num">${b.cancelados || 0}</td>
        <td class="num">${mxn(b.total)}</td>
      </tr>`).join('')}</tbody>
  </table>`;
}

function renderReporteCorte(corte) {
  const turno = corte.turno;
  const op = corte.operaciones || {};
  const fondo = turno.fondo_inicial || 0;
  const esperadoMxn = corte.efectivo_esperado ?? 0;
  const esperadoUsd = corte.usd_esperado ?? 0;
  const contadoMxn = turno.efectivo_contado ?? null;
  const diferencia = turno.diferencia ?? (contadoMxn !== null ? contadoMxn - esperadoMxn : null);
  const cerrado = !!turno.cerrado_en;
  const tc = Number(turno.tipo_cambio_usd) || 0;

  const encabezado = `Corte de caja · Turno #${turno.id} · ${cerrado ? 'CERRADO' : 'EN CURSO'}`;
  const cuerpo = `
    <h2>Datos del turno</h2>
    <div class="grid">
      <div><span>Operador apertura</span><strong>${escapeHtml(turno.operador_apertura)}</strong></div>
      <div><span>Apertura</span><strong>${escapeHtml(formatoFechaLarga(turno.abierto_en))}</strong></div>
      <div><span>Operador cierre</span><strong>${escapeHtml(turno.operador_cierre || '—')}</strong></div>
      <div><span>Cierre</span><strong>${escapeHtml(turno.cerrado_en ? formatoFechaLarga(turno.cerrado_en) : '—')}</strong></div>
      <div><span>Duración</span><strong>${escapeHtml(fmtDuracion(op.duracion_ms))}</strong></div>
      <div><span>Fondo inicial</span><strong>${mxn(fondo)}</strong></div>
      <div><span>Tipo de cambio USD</span><strong>$${tc.toFixed(2)}</strong></div>
      <div><span>Cortesías</span><strong>${corte.cortesias?.cantidad || 0} · ${mxn(corte.cortesias?.valor_comercial || 0)}</strong></div>
    </div>

    <h2>Operaciones</h2>
    <div class="grid">
      <div><span>Ventas cobradas</span><strong>${op.ventas_cobradas || 0}</strong></div>
      <div><span>Total cobrado</span><strong>${mxn(op.monto_cobrado || 0)}</strong></div>
      <div><span>Ticket promedio</span><strong>${mxn(op.ticket_promedio || 0)}</strong></div>
      <div><span>Total ventas (incl. cortesías)</span><strong>${mxn(corte.total_ventas)}</strong></div>
      <div><span>Primera venta</span><strong>${escapeHtml(op.primera_venta ? new Date(op.primera_venta).toLocaleTimeString('es-MX') : '—')}</strong></div>
      <div><span>Última venta</span><strong>${escapeHtml(op.ultima_venta ? new Date(op.ultima_venta).toLocaleTimeString('es-MX') : '—')}</strong></div>
    </div>

    <h2>Ventas por método de pago</h2>
    ${renderTablaPorMetodo(corte.por_metodo)}

    <h2>Brazaletes vendidos</h2>
    ${renderBrazaletesTabla(corte.brazaletes_por_tipo)}

    <h2>Depósitos y retiros</h2>
    ${renderMovimientos(corte.movimientos_caja)}

    <h2>Arqueo y diferencias</h2>
    <div class="grid">
      <div><span>Efectivo esperado MXN</span><strong>${mxn(esperadoMxn)}</strong></div>
      <div><span>Efectivo contado MXN</span><strong>${contadoMxn === null ? '—' : mxn(contadoMxn)}</strong></div>
      <div><span>Dólares esperados</span><strong>US$ ${esperadoUsd.toFixed(2)}</strong></div>
      <div><span>Depósitos</span><strong>${mxn(corte.depositos)}</strong></div>
      <div><span>Retiros</span><strong>${mxn(corte.retiros)}</strong></div>
    </div>
    ${diferencia !== null ? `
      <div class="total">
        Diferencia MXN:
        <span class="${diferencia >= 0 ? 'diff-pos' : 'diff-neg'}">
          ${diferencia >= 0 ? '+' : ''}${mxn(diferencia)}
        </span>
      </div>` : ''}

    <div class="firmas">
      <div class="firma"><div class="firma-linea"></div><div class="firma-label">Firma del cajero</div></div>
      <div class="firma"><div class="firma-linea"></div><div class="firma-label">Firma del supervisor</div></div>
    </div>
  `;
  return plantillaHtml({ titulo: `Corte turno #${turno.id}`, encabezado, cuerpo });
}

function renderReporteDiario({ fecha, turnos, totalesDia }) {
  const encabezado = `Reporte diario · ${escapeHtml(fecha)}`;
  const filasTurnos = turnos.map((t) => `
    <tr>
      <td>#${t.id}</td>
      <td>${escapeHtml(t.operador_apertura)} → ${escapeHtml(t.operador_cierre || '—')}</td>
      <td>${escapeHtml(new Date(t.abierto_en).toLocaleTimeString('es-MX'))}</td>
      <td>${escapeHtml(t.cerrado_en ? new Date(t.cerrado_en).toLocaleTimeString('es-MX') : '—')}</td>
      <td class="num">${mxn(t.totales?.totalVentas || 0)}</td>
      <td class="num ${(t.diferencia ?? 0) >= 0 ? 'diff-pos' : 'diff-neg'}">${t.diferencia !== null && t.diferencia !== undefined ? mxn(t.diferencia) : '—'}</td>
    </tr>`).join('');
  const cuerpo = `
    <h2>Turnos del día</h2>
    ${turnos.length ? `<table>
      <thead><tr><th>Turno</th><th>Operador</th><th>Apertura</th><th>Cierre</th><th class="num">Ventas</th><th class="num">Dif.</th></tr></thead>
      <tbody>${filasTurnos}</tbody>
    </table>` : '<p class="meta">Sin turnos cerrados este día.</p>'}

    <h2>Totales del día por método de pago</h2>
    ${renderTablaPorMetodo(totalesDia.porMetodo)}

    <div class="total">Total ventas del día: ${mxn(totalesDia.totalVentas)}</div>
  `;
  return plantillaHtml({ titulo: `Reporte diario ${fecha}`, encabezado, cuerpo });
}

function sumarPorMetodo(target, fuente) {
  for (const [metodo, datos] of Object.entries(fuente || {})) {
    if (!target[metodo]) target[metodo] = { mxn: 0, usd: 0, conteo: 0 };
    target[metodo].mxn += datos.mxn || 0;
    target[metodo].usd += datos.usd || 0;
    target[metodo].conteo += datos.conteo || 0;
  }
}

function createRespaldos({ dataDir, repository, maxRespaldos = 90 } = {}) {
  if (!dataDir || !repository) return noopService();

  const dbFile = path.join(dataDir, 'kaan_luum.db');
  const backupDir = path.join(dataDir, 'backups');
  const cortesDir = path.join(dataDir, 'reportes', 'cortes');
  const diariosDir = path.join(dataDir, 'reportes', 'diarios');

  for (const d of [dataDir, backupDir, cortesDir, diariosDir]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch {}
  }

  function limpiarRespaldos() {
    try {
      const copias = fs.readdirSync(backupDir)
        .filter((n) => /^kaan_luum-.+\.db$/.test(n))
        .sort();
      const sobran = copias.length - maxRespaldos;
      for (let i = 0; i < sobran; i++) {
        const base = copias[i];
        for (const sufijo of ['', '-wal', '-shm']) {
          const f = path.join(backupDir, base + sufijo);
          if (fs.existsSync(f)) fs.rmSync(f, { force: true });
        }
      }
    } catch (err) {
      console.error('[respaldos] limpieza falló:', err);
    }
  }

  function respaldarDb(evento = 'manual') {
    try {
      if (!fs.existsSync(dbFile)) return null;
      const stamp = timestampParaArchivo();
      const destino = path.join(backupDir, `kaan_luum-${stamp}_${evento}.db`);
      for (const sufijo of ['', '-wal', '-shm']) {
        const origen = dbFile + sufijo;
        if (fs.existsSync(origen)) fs.copyFileSync(origen, destino + sufijo);
      }
      console.log(`[respaldos] BD copiada a ${destino}`);
      limpiarRespaldos();
      return destino;
    } catch (err) {
      console.error('[respaldos] respaldo .db falló:', err);
      return null;
    }
  }

  function escribirReporteCorte(turno) {
    try {
      // Usamos obtenerCorteDeTurno (datos completos: operaciones, brazaletes,
      // cortesías, métodos, movimientos). Es independiente del turno abierto.
      const corte = repository.obtenerCorteDeTurno(turno.id);
      const html = renderReporteCorte(corte);
      const stamp = timestampParaArchivo();
      const archivo = path.join(cortesDir, `corte-${stamp}_turno-${turno.id}.html`);
      fs.writeFileSync(archivo, html, 'utf8');
      console.log(`[respaldos] Reporte corte: ${archivo}`);
      return archivo;
    } catch (err) {
      console.error('[respaldos] reporte de corte falló:', err);
      return null;
    }
  }

  function escribirReporteDiario() {
    try {
      const hoy = new Date();
      const fecha = fechaCorta(hoy);
      const inicioDelDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
      const finDelDia = inicioDelDia + 24 * 60 * 60 * 1000;

      const cerrados = repository.listarTurnosCerrados(200)
        .filter((t) => t.cerrado_en && t.cerrado_en >= inicioDelDia && t.cerrado_en < finDelDia);

      const totalesDia = { porMetodo: {}, totalVentas: 0 };
      for (const t of cerrados) {
        sumarPorMetodo(totalesDia.porMetodo, t.totales?.porMetodo);
        totalesDia.totalVentas += t.totales?.totalVentas || 0;
      }

      const html = renderReporteDiario({ fecha, turnos: cerrados, totalesDia });
      const stamp = timestampParaArchivo();
      const archivo = path.join(diariosDir, `diario-${fecha}_${stamp}.html`);
      fs.writeFileSync(archivo, html, 'utf8');
      console.log(`[respaldos] Reporte diario: ${archivo}`);
      return archivo;
    } catch (err) {
      console.error('[respaldos] reporte diario falló:', err);
      return null;
    }
  }

  return {
    enabled: true,
    dataDir,
    respaldarDb,
    escribirReporteCorte,
    escribirReporteDiario
  };
}

module.exports = { createRespaldos };
