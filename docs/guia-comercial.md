# Guía comercial de RawEnergy

## Qué revisar cada día

**Inicio** muestra ventas, gastos y resultado del período para Administración y Gerencia. **Ventas y resultados** amplía ese resumen con gráficos, evolución por mes y accesos a los registros que explican cada indicador.

1. Revisa los pedidos esperando pago y los pagos por confirmar.
2. Confirma compras y registra la recepción de la mercadería con costo, lote y vencimiento.
3. Consulta los productos que más venden y los que necesitan reposición.
4. Revisa vencimientos y compras atrasadas.
5. Registra los gastos del negocio y consulta el resultado.

Los gráficos usan datos reales. Una tienda recién configurada mostrará pocos datos o valores cero hasta que se registren operaciones. Los meses futuros no muestran un resultado inventado.

## Cómo leer el resultado

| Indicador | Qué representa |
| --- | --- |
| Ventas de productos | Importe de productos en pedidos actualmente pagados, en preparación, enviados o completados. Excluye envío. |
| Ganancia bruta de productos | Ventas con costo conocido menos el costo guardado con esas ventas. Si falta algún costo, se indica que es parcial. |
| Envíos cobrados | Envío de los pedidos incluidos en las ventas, contado una sola vez por pedido. |
| Gastos | Registros vigentes de publicidad, sueldos, transporte, arriendo, servicios, comisiones, mermas y otros gastos. |
| Resultado registrado | Ventas + envíos cobrados − costo de productos vendidos − gastos registrados. Un resultado negativo es una pérdida según estos registros. |
| Por cobrar ahora | Pedidos sin pago confirmado de toda la tienda, con envío incluido. No forma parte del ingreso confirmado. |
| Compras en camino | Valor de compras confirmadas que aún no se reciben. No significa dinero pagado ni gasto operativo. |
| Inventario a costo | Costo registrado de las unidades físicas en bodega, incluidas las reservadas y vencidas. Las unidades sin costo quedan fuera del importe y se indican aparte. |

El resultado queda **por completar** si alguna unidad vendida no tiene costo registrado. Un costo desconocido no se trata como cero. Si no hay gastos ingresados, el resultado se muestra como provisional. La aplicación no puede detectar gastos que no se hayan registrado.

Las compras de mercadería se registran en **Órdenes de compra**: su costo se descuenta conforme se vende. Volver a registrarlas como gastos descontaría el mismo costo dos veces. El transporte de entrega, publicidad y demás gastos van en **Gastos del negocio**. Si un costo ya está incluido en el costo unitario de compra, no lo dupliques como gasto.

Los gastos usan su fecha registrada, en horario de Ecuador. En ventas puedes elegir fecha de creación del pedido o de confirmación del pago. Las comparaciones usan el mismo tiempo transcurrido. Al filtrar una categoría se mantiene visible el gasto global, pero no se calcula el resultado de esa categoría: todavía no existe distribución de gastos por producto/categoría.

El resultado sigue el estado actual de los pedidos; una devolución posterior puede modificar el período original. Es un control operativo, no una contabilidad con cierres mensuales, saldo de caja o conciliación bancaria. No incluye gastos, obligaciones o impuestos que no se registren.

## Registrar y corregir gastos

En **Gastos del negocio**, Administración puede crear un gasto con fecha, categoría, importe, concepto y referencia opcional de factura/comprobante. Gerencia puede consultar y exportar; no puede modificar gastos.

- **Corregir** conserva quién registró el gasto y deja en auditoría el valor anterior y el nuevo.
- **Anular** exige un motivo, conserva el registro y deja de descontarlo del resultado.
- Si dos personas editan el mismo gasto, se rechaza la revisión desactualizada.
- Reintentar un alta tras un fallo de conexión usa el mismo identificador del formulario y recupera el registro, sin duplicar el importe. El identificador se conserva mientras el formulario siga abierto.
- La anulación y el cambio de gasto se guardan junto con su auditoría en una transacción de MongoDB.
- La exportación de gastos contiene la página visible; la de resultados incluye los indicadores del período y el resultado por mes.

Para registrar una merma efectiva, usa el costo de la mercancía perdida, la categoría **Mermas y pérdidas** y una referencia del lote. Registra también la salida en **Bodegas y lotes**. El gasto no modifica existencias automáticamente; un ajuste de existencias tampoco crea un gasto automáticamente. Una reserva o traslado no se considera pérdida.

## Trazabilidad de productos y compras

**Movimientos** presenta un recorrido cronológico con producto, código, lote, bodega, responsable, fecha, motivo y saldo anterior/nuevo. La tabla detallada y la referencia de auditoría siguen disponibles. Las compras y ventas registran movimientos desde la incorporación de ese control; no se fabrica historial anterior.

Desde un producto vendido en el dashboard puedes abrir su recorrido. Las compras en camino enlazan con su orden de compra, y las alertas de vencimiento enlazan con la búsqueda del código en bodegas y lotes.

## Qué falta para cerrar el control operativo

La primera tarea es completar los **datos reales**: costos de existencias iniciales, lotes/vencimientos, compras, gastos y pedidos. Cambiar un costo actual no modifica automáticamente el costo histórico guardado en una venta.

Las ampliaciones que siguen pendientes son:

- Conciliación de caja/banco y registro de pagos a proveedores; hoy compra confirmada/recibida no equivale a pagada.
- Comprobantes adjuntos: gastos admite una referencia de texto, no archivo de factura.
- Cierres de períodos y tratamiento contable de devoluciones, impuestos y obligaciones.
- Recepciones, devoluciones y reembolsos parciales.
- Registro conjunto de merma física y gasto, para evitar que el equipo omita uno de los dos pasos.
- Asociación producto/proveedor y creación de compras desde la sugerencia de reposición.
- Copias de seguridad verificadas y prueba de restauración; monitoreo y entrega de notificaciones.
- Publicación del panel y la API para que el socio pueda acceder desde su equipo. Atlas guarda la base en la nube, pero el panel en `localhost` sigue dependiendo de esta laptop.

## Verificación técnica

Las pruebas de gastos cubren reintentos, edición concurrente, anulación, permisos, auditoría y rollback. Los cálculos incluyen pérdidas, gastos sin ventas, envíos contados una vez, costos faltantes, filtro de categoría y límites de fecha de Ecuador.

`node scripts/review-admin.mjs` revisa navegación por roles y escritorio/móvil con datos temporales en memoria, separados de Atlas. Incluye alta/corrección/anulación de gasto y su efecto en los totales, dashboard comercial y recorrido visual de mercancía. Guarda capturas y un reporte en una carpeta temporal.
