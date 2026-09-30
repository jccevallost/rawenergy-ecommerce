# Panel de gestión RawEnergy

## Organización y uso diario

| Área | Funciones |
| --- | --- |
| Inicio | Pendientes del día, fichas incompletas, pagos por revisar, bajo stock, compras en tránsito, vencimientos y errores recientes. |
| Catálogo y ventas | Productos, categorías/objetivos/marcas, fotografías y pedidos. |
| Inventario y compras | Existencias por SKU, mínimos, compras, proveedores, bodegas, lotes y movimientos. |
| Gerencia | Ventas, comparaciones, rankings, demanda, cobertura, margen y rotación física. |
| Sistema | Cuentas, permisos, auditoría, colecciones, configuración y sesiones. |

El menú móvil es desplegable y conserva los nombres de las secciones. Las tablas anchas se desplazan dentro de su contenedor. Los módulos muestran carga, errores y estados vacíos, con filtros y paginación. La vista principal muestra datos operativos; las referencias técnicas de auditoría están en un detalle desplegable. Los registros y filtros se conservan en la URL. Atrás/Adelante y los cambios de módulo respetan los formularios sin guardar; las cargas y guardados en curso bloquean la salida. Un fallo al actualizar la lista después de guardar se informa sin presentar el guardado como fallido.

## Permisos

| Perfil | Puede modificar | Puede consultar |
| --- | --- | --- |
| Administrador | Catálogo, inventario, pedidos, compras, proveedores, bodegas y cuentas. | Todos los módulos. |
| Catálogo | Fichas, precios, variantes, categorías, imágenes e importación; los productos nuevos tienen stock cero. | Catálogo y su propia sesión. |
| Inventario y pedidos | Stock, compras, proveedores, bodegas, traslados y pedidos. | Catálogo e información de operación. |
| Gerencia | Su propia sesión. | Catálogo, inventario, compras, pedidos, indicadores y auditoría. |
| Cliente | Su cuenta y compras a través de la tienda. | No tiene acceso al panel interno. |

Los permisos se comprueban en cada resolver y en la ruta de carga de imágenes. Ocultar controles en el menú no sustituye la autorización en el servidor. El catálogo no puede cambiar existencias mediante llamadas directas ni mediante importación.

## Productos y fotografías

1. Abre **Nuevo producto**. La carga rápida muestra los datos esenciales; la ficha completa añade identificador y beneficios comerciales.
2. Completa nombre, marca, descripción, categorías, objetivos y nutrición cuando corresponda. El sistema no inventa información nutricional.
3. Agrega sabores/colores y tamaños; confirma **Generar combinaciones**. Se conservan las variantes existentes. Puedes quitar las que no vas a vender; todas las variantes guardadas necesitan un precio válido.
4. Sube fotos o reutiliza la biblioteca. Arrastra para ordenar y mover, o usa los controles de mover/copiar entre variantes. La primera foto es portada; máximo ocho por variante.
5. Guarda. El borrador local se conserva con aviso antes de abandonar el editor; recuperar o descartar un borrador requiere una acción explícita. El borrador se separa por cuenta y producto y se valida antes de recuperarlo. El almacenamiento es local al navegador, no una copia de seguridad.

Duplicar crea un identificador/SKU nuevo y stock cero. Archivar retira un producto de la tienda y permite restaurarlo. No se pueden eliminar o cambiar SKU con existencias ni los presentes en pedidos o compras. Los cambios de stock se validan contra el valor leído al abrir el editor; el borrador conserva ese saldo original para detectar ventas posteriores. La ficha exige su revisión de origen para rechazar cambios concurrentes de precio o descripción. Regenerar combinaciones conserva los SKU existentes; los nuevos códigos se limitan a 80 caracteres y evitan colisiones. Las descripciones de fotos se conservan al recargar y editar.

Formatos admitidos: JPEG, PNG, WebP, AVIF, GIF y TIFF. Se verifica el contenido y se publica WebP estático con orientación corregida, máximo 1400 px y miniatura de 360 px. Hasta 20 MB antes de optimización en el navegador; máximo 5 MB recibidos por el servidor y 40 millones de píxeles de entrada. SVG y datos incrustados se rechazan. Las imágenes enlazadas desde servidores externos no se transforman automáticamente. Las fotos antiguas sin miniatura siguen funcionando con su archivo original.

## Excel y CSV

Descarga la plantilla desde **Productos → Importar Excel / CSV**. Excel usa la primera hoja. Cada fila representa una variante; repite el identificador y los datos generales para agrupar variantes. Usa `|` entre categorías, objetivos y enlaces de fotografías.

El archivo se limita a 5 MB, 1000 filas y 200 productos. La vista previa muestra filas, productos, variantes y stock inicial. La API vuelve a validar al confirmar y rechaza identificadores existentes. La importación crea productos nuevos y se confirma íntegra dentro de una transacción; una validación o conflicto impide el guardado parcial.

## Compras, bodegas e inventario

1. Crea el proveedor y revisa contacto y plazo de entrega.
2. Crea la compra con proveedor, bodega destino, fecha prevista, productos, cantidad, costo unitario, lote y vencimiento. Los suplementos requieren vencimiento.
3. Guarda el borrador y confirma la compra. Aparecerá **En camino**. Sus unidades reducen la sugerencia de reposición sólo si la llegada prevista está entre hoy y el final de la cobertura elegida.
4. Al recibir toda la mercancía, confirma **Recibir**. Se guarda stock, costo, lote, fecha y movimiento en conjunto. Repetir la recepción no vuelve a sumar unidades.

La recepción es completa. Para entregas separadas registra compras distintas. Los borradores se pueden editar; compras confirmadas se reciben o cancelan. Las recibidas conservan su historial; una corrección posterior usa un ajuste de inventario con motivo. No se archivan proveedores con compras pendientes, ni bodegas con mercancía física, unidades reservadas o compras pendientes. La bodega principal permanece activa.

Las existencias por posición muestran unidades físicas, reservadas y disponibles; una reserva sin saldo disponible sigue visible. Los pedidos reservan por vencimiento más próximo, excluyendo lotes vencidos. Cancelar antes del despacho devuelve las unidades a los lotes de origen. Si la bodega original ya está inactiva, la devolución va a la principal y deja constancia. Los traslados conservan cantidad, costo y vencimiento. Desde un lote se pueden registrar conteos o mermas de esa posición exacta; se comprueba el saldo leído del lote y del SKU para rechazar ajustes desactualizados. Los ingresos por compra se registran mediante recepción.

El stock previo a esta versión se reconoce como lote **INICIAL**, bodega principal, sin costo ni vencimiento conocido. No se fabrican fechas o costos históricos. El registro de movimientos empieza con las operaciones de esta versión.

## Pedidos, devoluciones y reintentos

El flujo habitual es pendiente de pago → revisión de comprobante/pago confirmado → preparación → enviado → completado. El selector ofrece sólo los pasos permitidos por la API. Cancelar está permitido antes del despacho; los cancelados no se reabren.

**Seguimiento y devoluciones** muestra el historial. Para un pedido enviado o completado se registra la devolución recibida con motivo, indicando si todas las unidades volvieron en condiciones de venta. Sin esa confirmación no se repone inventario. En cancelados/devueltos que tenían pago confirmado se puede registrar el reembolso completo con referencia. Este registro no transfiere dinero. La versión actual maneja devolución y reembolso completos; no parciales. Repetir los registros no duplica stock ni reembolsos.

La creación usa una clave única de intento, conservada al reintentar tras una respuesta perdida. La misma clave y datos recuperan el pedido original; no generan otra reserva o notificación. Una clave reutilizada con datos distintos se rechaza. Al confirmar éxito se libera la clave para una futura compra nueva.

Contratos para clientes GraphQL: `CheckoutInput.idempotencyKey` es obligatorio y debe ser UUID. Una actualización de producto requiere `expectedRevision` y `expectedStocks`. Los ajustes de lote envían `position` y `expectedLotQuantity`; los traslados, metadatos de posición y `expectedQuantity`.

## Significado de los indicadores

- Ventas: líneas de pedidos actualmente PAID, PREPARING, SHIPPED o COMPLETED. Excluye pendientes, cancelados y devueltos, y no incluye envío. Se puede elegir fecha de creación o confirmación de pago; al elegir pago, se excluyen pedidos antiguos sin fecha de pago registrada.
- Períodos: horario de Ecuador continental, UTC−5. Mes/año anterior se compara con el mismo tiempo transcurrido, limitado al cierre del período anterior. La gráfica mensual presenta todo el año, incluso cuando el ranking filtra un mes.
- Categorías: usa la clasificación guardada con la venta; pedidos antiguos pueden usar la clasificación actual. Un producto con varias categorías aparece en cada una: esos grupos no son sumables.
- Velocidad: unidades vendidas / días transcurridos del período, mínimo un día.
- Cobertura: unidades disponibles no vencidas / velocidad. Sin demanda no se presenta una división artificial.
- Compra sugerida: cubre el mayor entre demanda estimada para los días elegidos y mínimo; descuenta unidades disponibles y compras confirmadas cuya llegada prevista esté entre hoy y el horizonte de cobertura. Las atrasadas, sin fecha o posteriores no reducen la sugerencia. No considera entregas parciales ni cambios futuros de demanda.
- Margen bruto: ventas menos costo de las líneas con costo conocido al reservar. Muestra el porcentaje de ventas cubierto por esos costos. No incluye gastos operativos y no representa utilidad neta.
- Rotación física: unidades vendidas / stock registrado promedio ponderado por tiempo. Solo se presenta cuando los movimientos permiten reconstruir todo el período. No equivale a rotación contable. El stock registrado excluye reservas; los lotes vencidos siguen en ese saldo hasta registrar su salida.
- Valor del stock: precio de venta actual multiplicado por unidades en bodega; no es valoración contable a costo.

## Auditoría y colecciones

Cada mutación registra actor, solicitud, operación individual, fecha, entrada, estado previo y resultado. Inicio y resultado comparten `operationId`; `requestId` permite agrupar varias operaciones de la misma petición. Se registran intentos fallidos de autorización y consultas sensibles. Las contraseñas, tokens, claves de intento y secretos se ocultan antes de escribirlos. Los cambios comerciales capturan estados equivalentes antes/después dentro de la transacción, junto con su resultado de auditoría; un fallo al escribir ese resultado revierte el cambio. Las operaciones masivas conservan referencias a cada producto afectado.

La vista muestra operaciones completas/fallidas por defecto, etiquetas legibles, diferencias por campo, detalle técnico opcional y filtros por actor/referencia, entidad, resultado y fechas. La exportación obtiene todos los resultados filtrados hasta una fecha de corte. “En curso / sin resultado” detecta automáticamente inicios que todavía no tienen cierre. “Todos los inicios” muestra también los que ya terminaron. Las operaciones externas a la transacción comercial, como acceso y archivos, pueden conservar un inicio sin resultado si falla el registro de cierre; se informa en el log para conciliación. Un inicio pendiente puede representar una operación aún en curso: no implica por sí solo que haya fallado.

El explorador cubre productos, usuarios, pedidos, imágenes, proveedores, bodegas, compras, movimientos y auditoría. Cada colección enlaza a su módulo con las reglas de negocio. Categorías y marcas pertenecen a los productos; roles y configuración son contratos del sistema. Auditoría y movimientos son de solo lectura, para conservar trazabilidad. No se restauran automáticamente las tablas retiradas del sistema anterior.

## Accesos y configuración

Las contraseñas se guardan con scrypt y no se muestran ni exportan. Cambiar una cuenta invalida sus sesiones y enlaces de recuperación anteriores. Cerrar sesión revoca el acceso actual; **Mi acceso** permite revisar sesiones y cerrarlas todas. Un administrador no puede quitarse su acceso, y se comprueba el permiso vigente durante cambios concurrentes de administradores.

La recuperación requiere SMTP y `ADMIN_APP_URL`, por ejemplo `https://admin.ejemplo.com`. El enlace contiene un token de un solo uso, válido por 30 minutos; solo se guarda su hash. La respuesta no confirma si existe el correo. Sin SMTP, el panel indica que un administrador puede restablecer la contraseña desde cuentas.

MongoDB debe admitir transacciones: Atlas, un replica set o un clúster compatible. Docker Compose prepara `rs0`; para la API local usa `mongodb://127.0.0.1:27017/vital_forge?replicaSet=rs0`. Con una URI configurada, el servidor detiene el arranque si la conexión falla o MongoDB es independiente. Sin URI, solo en desarrollo, hay modo demo sin persistencia. No se modifican conexiones ni datos de producción al ejecutar las pruebas unitarias.

## Verificación

```sh
npm run typecheck
npm test
npm run build
```

La suite contiene 86 pruebas: 57 API, 18 panel y 11 lógica compartida. Cubre permisos, sesiones, secretos, auditoría consistente, claves de reintento, conflictos de ficha/stock/lote, reservas, cancelación, devolución/reembolso, recepción repetida, rollback, traslados, vencimientos, cobertura, márgenes, rotación, CSV, descripciones de imágenes, borradores y lógica de navegación. Las pruebas del panel verifican lógica aislada; no sustituyen la revisión visual en navegador.

`node scripts/review-admin.mjs` prepara API y panel de prueba con datos en memoria, sin SMTP/Telegram ni MongoDB, y usa un perfil temporal de Chrome para recorrer los módulos y capturar escritorio/móvil. Requiere Node.js 22 o posterior, Chrome local y permiso para abrir servidores y navegador; las capturas y resultados se guardan en una carpeta temporal. En esta revisión su ejecución no fue autorizada, al igual que la comprobación de Docker: la validación visual real y la integración contra MongoDB quedan pendientes.
