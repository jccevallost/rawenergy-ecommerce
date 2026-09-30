# Coordinación del sistema

Antes de editar, leer [el registro compartido](docs/auditoria-ecommerce.md) y las instrucciones específicas del área si existen.

- Todo cambio debe tener tarea registrada, responsable real (Codex o Claude), alcance y verificación prevista antes de editar.
- Antes de intervenir una tarea «En proceso», escanear archivos y pruebas actuales: comprobar qué funciona, qué falta y si ya puede cerrarse. No sobrescribir trabajo de otro agente.
- Cerrar con `[x] ~~Tarea~~` solo tras verificarla. Quitar la etiqueta temporal «En proceso» y conservar autor, cambios, evidencia y límites en la bitácora.
- No asignar resultados a Claude ni declarar una revisión cruzada sin su participación real.
- El repositorio contiene una migración y cambios preexistentes extensos. Preservarlos; no restaurar ni confirmar en bloque archivos ajenos a la tarea.
- Mantener validación de precio/stock/envío en servidor, permisos, reserva e idempotencia. No inventar datos comerciales, fotografías, descuentos ni garantías.
- Las cifras de rendimiento deben indicar entorno, red y contenido medido. Las comprobaciones locales no certifican producción.

Las instrucciones expresas del usuario prevalecen. Estas reglas organizan el trabajo; no introducen una aprobación adicional para cambios ya autorizados.
