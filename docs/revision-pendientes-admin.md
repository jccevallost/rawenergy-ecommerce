# Revisión y correcciones del panel administrativo

Actualizado: 11 de septiembre de 2026. Alcance: panel React, contratos GraphQL, servicios, permisos, formularios y trazabilidad. Este documento sustituye el listado inicial de errores por el estado de las correcciones y conserva las ampliaciones todavía pendientes.

## Correcciones implementadas

| Hallazgo | Comportamiento corregido | Evidencia automatizada |
| --- | --- | --- |
| Cancelar un pedido entregado reponía stock sin devolución física. | API y selector ofrecen transiciones permitidas. Cancelación sólo antes del despacho; cancelados no se reabren. Devolución recibida y registro de reembolso completo son acciones separadas, con motivo e historial. | Estados inválidos, cancelación, devolución con/sin reposición y reembolso repetido. |
| Una bodega con reservas podía archivarse. | Existencia física, reserva y disponibilidad separadas. No se archivan bodegas con mercancía física, reservas o compras pendientes. Devoluciones a una bodega ya inactiva se redirigen a la principal dejando motivo. | Reservas sin disponibilidad, archivo bloqueado y destino de devolución. |
| Un reintento podía duplicar pedidos y reservas. | Clave única de intento en API y formularios; repetirla recupera el pedido original. Con otros datos se rechaza. Envío bloqueado antes de preparar la clave. El carrito permite recuperar confirmación aunque la reserva original haya agotado stock. | Creaciones concurrentes, una reserva/notificación, contenido incompatible, recuperación de clave y almacenamiento bloqueado. |
| Ajustes/traslados podían afectar otra posición del mismo lote. | Selección por bodega, lote, vencimiento y costo; se valida el saldo leído del lote además del SKU. Se rechazan posiciones ambiguas o desactualizadas. | Lotes con igual nombre y metadatos diferentes; traslado repetido; ajuste desactualizado sin cambio del total del SKU. |
| Auditoría comparaba un producto completo con un resumen. | Estados equivalentes dentro de la operación. Resultado de cambios comerciales guardado en la transacción. Cambios masivos enlazados a cada producto. Filtro automático de inicios sin resultado. Login atribuido a la cuenta y pedido invitado con estado completo. | Comparación de ajuste, rollback al fallar auditoría, búsquedas de operaciones sin cierre/cambios masivos, invitado y login. |
| Se perdían las descripciones de fotos al editar. | imageAlts viaja junto a las URL y se conserva al reconstruir/guardar la ficha. | Consulta GraphQL y recorrido consulta → formulario → cambio de nombre → payload, preservando descripciones. |
| Un borrador podía sobrescribir ficha y stock recientes. | Revisión y saldos originales conservados; rechazo de cambios concurrentes. Borradores por cuenta/producto y validación antes de recuperar. Los antiguos sin saldo original usan el stock actual. | Revisión desactualizada, integridad, aislamiento de claves y saldo de origen. |
| Regenerar variantes podía cambiar SKU publicados o generar códigos largos. | Conservación de SKU existentes; actualización automática sólo en fichas nuevas. Códigos generados limitados a 80 caracteres y sin colisiones dentro de la matriz. | Escritura de identidad, SKU manual/publicado, longitud y opciones que se normalizan igual. |
| Navegación y formularios perdían contexto o confundían éxito/error. | Rutas con registro/filtros, Atrás/Adelante y restauración al cancelar salida. Confirmaciones concurrentes no se sobrescriben. Protección de formularios/cargas y éxito separado de fallo de actualización. Categorías conservan texto si falla guardado. Biblioteca incrustada con filtros propios. | Rutas, navegación cancelada, conservación de filtros, páginas inválidas y decisiones concurrentes. La interacción visual sigue pendiente. |
| Compras tardías reducían artificialmente la reposición. | Sólo llegadas fechadas desde hoy hasta la cobertura reducen la sugerencia. Las atrasadas, sin fecha o posteriores siguen visibles en tránsito. | Compras dentro/fuera del horizonte, atrasadas y sin fecha. |
| Indicadores recorrían todo el historial por cada variante. | Movimientos del período más saldo anterior por SKU, agrupación calculada una vez y compras filtradas en tránsito. Inventario omite comparaciones gerenciales innecesarias. | Cálculo de ventas, costos y rotación; falta medición de carga real. |

Los cambios están en [servicios de API](../apps/api/src/services), [panel](../apps/admin/src), [lógica compartida](../packages/shared-logic/src) y [carrito](../apps/web/src/components/CartDrawer.tsx). Las regresiones de negocio se concentran en [admin-regressions.test.ts](../apps/api/src/services/admin-regressions.test.ts).

## Validación realizada y límites

- npm run typecheck: correcto en todo el monorepo.
- npm run build: correcto; API, tienda y panel compilan para producción.
- npm test: 86 pruebas correctas: 57 API, 18 panel y 11 lógica compartida. El paquete web no tiene pruebas propias de componentes; comparte lógica probada y comprobación de tipos/compilación.
- Las pruebas API usan datos temporales en memoria y ejecución GraphQL aislada. No demuestran transacciones ni concurrencia contra MongoDB real.
- [review-admin.mjs](../scripts/review-admin.mjs) se actualizó para el contrato de pedidos y los diálogos; pasó comprobación sintáctica. No se ejecutó el navegador.
- Pendientes: revisión visual de escritorio/móvil, MongoDB con transacciones, entrega real de correo y medición con volumen representativo. No se volvieron a ejecutar navegador/Docker cuya autorización fue rechazada anteriormente.
- No se modificaron datos de producción, no se desplegó ni se enviaron mensajes reales de prueba.

## Cobertura actual

| Área | Funciones disponibles |
| --- | --- |
| Organización | Inicio, catálogo y ventas, inventario y compras, gerencia y sistema; menú según rol. |
| Catálogo | Crear, editar, duplicar, archivar/restaurar; variantes, nutrición, precios, categorías, marcas e importación CSV/Excel de productos nuevos. |
| Fotografías | Biblioteca, progreso/reintento de cargas, orden/traslado entre variantes, WebP y miniaturas para nuevas cargas. |
| Operación | Pedidos, estados, devoluciones/reembolsos completos, ajustes, proveedores, bodegas, lotes, compras y movimientos. |
| Gerencia | Mes/año/categoría, rankings, comparaciones, velocidad, cobertura, reposición y margen con costo registrado. |
| Sistema | Cuentas, correo, roles, bloqueo, restablecimiento de contraseña, sesiones, auditoría y nueve colecciones. |

## Ampliaciones funcionales pendientes

Estas funciones requieren implementación adicional; no se presentan como terminadas por haber corregido los errores anteriores.

| Prioridad | Área | Pendiente |
| --- | --- | --- |
| Alta | Reposición | Asociar productos a proveedores y convertir sugerencias en compras precargadas. |
| Alta | Compras | Recepción parcial, diferencias pedido/recibido, devolución al proveedor y documentos. La recepción actual es completa. |
| Alta | Catálogo | Edición masiva por selección y actualización de productos desde Excel. La importación actual crea productos. |
| Alta | Pedidos | Devoluciones/reembolsos parciales, comprobantes adjuntos, transporte y presentación completa de lotes reservados. Hay historial de eventos y referencia de pago. |
| Media | Fotografías | Optimización de archivos antiguos y tratamiento de imágenes externas; nuevas cargas ya se transforman. |
| Media | Gerencia | Rango libre, filtros por marca/bodega/proveedor, antigüedad sin venta y prioridad económica de reposición. |
| Media | Configuración | Edición de datos comerciales, envío y parámetros con permisos/historial. Hoy se consulta configuración del servidor. |
| Media | Catálogos auxiliares | Categorías/marcas independientes, preparables antes del producto. |
| Media | Acceso | Cambio de contraseña propia, dispositivos y cierre de una sesión concreta; hoy se revisan y cierran todas. |
| Media | Notificaciones | Historial de entrega y cola persistente de reintentos. |
| Antes de crecer | Rendimiento | Paginación de existencias/compras en API y medición con volumen real. Se optimizó gerencia, sin prometer tiempos no medidos. |

El explorador comprende productos, usuarios, pedidos, imágenes, proveedores, bodegas, compras, movimientos y auditoría. No recupera las tablas retiradas del sistema anterior. Auditoría/movimientos conservan el historial: las correcciones requieren operaciones compensatorias. Las contraseñas se cambian/restablecen y se almacenan como hash no reversible.

Para cerrar la validación operativa faltan recorridos reales por rol en escritorio/móvil, concurrencia/recuperación en MongoDB, correo y restauración de una copia de seguridad en un entorno aislado. Guía: [panel-admin.md](panel-admin.md).
