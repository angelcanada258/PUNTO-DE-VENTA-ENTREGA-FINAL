const express = require('express');

function createCajaRouter(repository, opciones = {}) {
  const router = express.Router();
  if (!repository) return router;

  const respaldos = opciones.respaldos || null;
  function disparar(fn) {
    if (!respaldos || !respaldos.enabled) return;
    // Fire-and-forget: no bloqueamos la respuesta HTTP; los errores se loguean.
    setImmediate(() => { try { fn(); } catch (err) { console.error('[respaldos] hook falló:', err); } });
  }

  router.post('/login', async (req, res, next) => {
    try {
      const result = await repository.login({
        usuario: req.body?.usuario,
        pin: req.body?.pin
      });
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/cambiar-pin', async (req, res, next) => {
    try {
      const result = await repository.cambiarPin({
        usuario: req.body?.usuario,
        pinActual: req.body?.pin_actual,
        pinNuevo: req.body?.pin_nuevo
      });
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/usuarios', async (_req, res, next) => {
    try {
      res.json({ success: true, usuarios: await repository.listarUsuarios() });
    } catch (error) {
      next(error);
    }
  });

  router.post('/usuarios', async (req, res, next) => {
    try {
      const usuario = await repository.crearUsuario({
        usuario: req.body?.usuario,
        pin: req.body?.pin,
        rol: req.body?.rol
      });
      res.status(201).json({ success: true, ...usuario });
    } catch (error) {
      next(error);
    }
  });

  router.put('/usuarios/:usuario', async (req, res, next) => {
    try {
      const result = await repository.editarUsuario({
        usuario: req.params.usuario,
        nuevoUsuario: req.body?.usuario,
        nuevoPin: req.body?.pin,
        nuevoRol: req.body?.rol
      });
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/usuarios/:usuario', async (req, res, next) => {
    try {
      const result = await repository.eliminarUsuario(req.params.usuario);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/usuarios/:usuario/desactivar', async (req, res, next) => {
    try {
      const result = await repository.desactivarUsuario(req.params.usuario);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/usuarios/:usuario/activar', async (req, res, next) => {
    try {
      const result = await repository.activarUsuario(req.params.usuario);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/tickets', async (_req, res, next) => {
    try {
      res.json({ success: true, tickets: await repository.listarTickets() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/inventario', async (_req, res, next) => {
    try {
      res.json({ success: true, inventario: await repository.obtenerInventarioColores() });
    } catch (error) {
      next(error);
    }
  });

  router.post('/inventario/recargar', async (req, res, next) => {
    try {
      const result = await repository.recargarStock({
        color: req.body?.color,
        folio_inicio: req.body?.folio_inicio,
        folio_fin: req.body?.folio_fin,
        operador: req.body?.operador
      });
      res.status(201).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/turno-activo', async (_req, res, next) => {
    try {
      res.json({ success: true, turno: await repository.obtenerTurnoAbierto() });
    } catch (error) {
      next(error);
    }
  });

  router.post('/turnos/abrir', async (req, res, next) => {
    try {
      const turno = await repository.abrirTurno({
        operador: req.body?.operador,
        fondo_inicial: req.body?.fondo_inicial,
        tipo_cambio_usd: req.body?.tipo_cambio_usd
      });
      disparar(() => respaldos.respaldarDb('apertura'));
      res.status(201).json({ success: true, turno });
    } catch (error) {
      next(error);
    }
  });

  router.post('/turnos/cerrar', async (req, res, next) => {
    try {
      const turno = await repository.cerrarTurno({
        operador: req.body?.operador,
        efectivo_contado: req.body?.efectivo_contado
      });
      disparar(() => {
        respaldos.respaldarDb('cierre');
        respaldos.escribirReporteCorte(turno);
        respaldos.escribirReporteDiario();
      });
      res.json({ success: true, turno });
    } catch (error) {
      next(error);
    }
  });

  router.get('/turnos/cerrados', async (req, res, next) => {
    try {
      const limite = Number(req.query.limite) || 30;
      res.json({ success: true, turnos: await repository.listarTurnosCerrados(limite) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/ventas', async (req, res, next) => {
    try {
      const result = await repository.crearVenta({
        operador: req.body?.operador,
        items: req.body?.items,
        pagos: req.body?.pagos,
        motivo_cortesia: req.body?.motivo_cortesia,
        autorizado_por: req.body?.autorizado_por
      });
      res.status(201).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/movimientos', async (req, res, next) => {
    try {
      const corte = await repository.registrarMovimientoCaja({
        operador: req.body?.operador,
        tipo: req.body?.tipo,
        monto: req.body?.monto,
        concepto: req.body?.concepto
      });
      res.status(201).json({ success: true, corte });
    } catch (error) {
      next(error);
    }
  });

  router.get('/corte', async (_req, res, next) => {
    try {
      res.json({ success: true, ...(await repository.obtenerCorte()) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/dashboard', async (_req, res, next) => {
    try {
      res.json({ success: true, ...(await repository.obtenerDashboard()) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/historial', async (req, res, next) => {
    try {
      const turnoId = req.query.turno_id ? Number(req.query.turno_id) : undefined;
      const limite = Number(req.query.limite) || 200;
      res.json({
        success: true,
        movimientos: await repository.obtenerHistorialTurno(turnoId, limite)
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createCajaRouter };
