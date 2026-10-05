# RawEnergy EC Commerce

Auditoría de tienda y coordinación Codex / Claude: [registro compartido de IHC, catálogo y checkout](docs/auditoria-ecommerce.md). Leerlo antes de continuar mejoras; incluye responsables, verificaciones y pendientes.

> La carpeta `docs/` (auditorías, evidencias y guías de despliegue, pruebas locales, panel y comercial) no se publica en este repositorio: se conserva en el equipo del propietario. Los enlaces a `docs/` de este README solo funcionan en esa copia local.

Plataforma de suplementación deportiva construida como monorepo TypeScript. Conviven tres aplicaciones independientes y dos paquetes compartidos:

```text
apps/
  api/       Apollo Server 5 + Express 5 + Mongoose
  web/       SPA de clientes (React + Apollo Client)
  admin/     Administración, inventario, gerencia y sistema (React + Apollo Client)
packages/
  shared-logic/  hooks, store, GraphQL y tipos portables a React Native
  ui-core/       tokens y utilidades de presentación
```

## Arranque rápido

Requisitos: Node.js 20 o posterior y npm 11.

```bash
npm install
npm run dev
```

- Tienda: <http://localhost:5173>
- Administración: <http://localhost:5174>
- GraphQL: <http://localhost:4000/graphql>
- Health check: <http://localhost:4000/health>

Para probar la tienda completa sin configurar nada, `npm run demo` arranca API, tienda y panel aislados (datos en memoria, sin correo ni Telegram, sin leer `.env`) e imprime el acceso al panel. `npm run demo -- --red` los abre también desde el celular. Guía: [docs/pruebas-locales.md](docs/pruebas-locales.md).

La API arranca en memoria con el catálogo inicial cuando no existe `apps/api/.env`. Para persistencia real:

```bash
docker compose up -d mongo
```

Después, copia `apps/api/.env.example` como `apps/api/.env`. Las SPA tienen sus ejemplos de configuración en sus respectivas carpetas.

## Contrato GraphQL

- `getProductsByGoal(goalSlug, limit)` para carruseles.
- `searchProducts(filters, pagination)` devuelve conexiones con cursor.
- `calculateCartTotals(cartItems)` obtiene precios y recompensas desde el servidor; no confía en valores enviados por el cliente.
- `upsertProduct(id, payload)` crea o actualiza toda la matriz de variantes en una operación validada por Zod.
- `orders(filters, limit, offset)` pagina el listado del panel y filtra por estado o por número de orden, nombre, correo y teléfono del cliente.
- `adminStats` devuelve totales calculados en el servidor: catálogo, cuentas y pedidos.
- `storeSettings` expone las reglas vigentes (persistencia, umbral de envío gratis, tarifas y métodos de pago).
- `myOrders(limit)` devuelve los pedidos del cliente en sesión. Cruza solo por identificador de usuario: cruzarlo por correo dejaría que cualquiera se registre con el correo de otro y vea sus compras.
- `linkGuestOrders(orderNumbers)` enlaza a la cuenta del cliente pedidos hechos sin sesión: exige el número del pedido y que su correo sea el de la cuenta, y un pedido con dueño no cambia. La tienda lo llama al entrar o registrarse (con los números guardados en ese navegador) y desde «Mis pedidos».
- `calculateCartTotals(cartItems, shippingMethod, discountCode)` devuelve `discount`, `discountCode`, `discountPercent` y `discountMessage`. El descuento de bienvenida (primera compra por documento, celular y correo) se confirma en `createCheckoutOrder`; si no aplica, responde `DISCOUNT_NOT_ELIGIBLE`. Se configura en `saveCommerceSettings` → `welcomeDiscount`.
- `mergeProducts(input)` (solo ADMIN) une un producto como presentaciones de otro: mueve stock, lotes, fotos y SKU, pasa pedidos y campañas al destino y archiva el origen.
- `taxonomy` agrupa categorías, objetivos y marcas con el número de productos que los usan, y `editTaxonomy` los renombra, fusiona o quita en todo el catálogo de una vez.

`variants` expone `imageUrls` como lista plana. El límite de profundidad impide atravesar `variants { images { url } }`, así que las fotos de variante viajan aplanadas junto a `sizeValue` y `sizeUnit`.

Las consultas y mutaciones internas verifican permisos en la API según el perfil ADMIN, CATALOG, WAREHOUSE o MANAGER. Un cliente o invitado no puede listar productos archivados ni consultar información interna. El menú muestra las funciones del perfil; la autorización se aplica también a peticiones GraphQL directas.

El BFF aplica rate limit (120 solicitudes/minuto/IP), límite de profundidad 4 y límite de body. `primaryImage` es una proyección deliberada para que el catálogo no atraviese `variant.images` y respete la profundidad máxima.

## Panel de administración

Para el equipo comercial, consulta [la guía de resultados, gastos y trazabilidad](docs/guia-comercial.md). El dashboard de gerencia muestra ventas, costos, gastos, resultado operativo registrado, compras pendientes y riesgos de inventario; los importes incompletos se identifican. Administración registra/corrige/anula gastos con auditoría y Gerencia los consulta. **Movimientos** incluye un recorrido visual de la mercancía.

La navegación agrupa las funciones en Inicio, Catálogo y ventas, Inventario y compras, Gerencia y Sistema. Consulta [la guía del panel](docs/panel-admin.md) para conocer los permisos, flujos, límites y configuración.

- **Inicio:** fichas incompletas, pagos pendientes, stock bajo, compras por recibir, vencimientos y fallos recientes, con enlaces a los registros.
- **Catálogo:** carga rápida/ficha completa, duplicación sin copiar existencias, variantes elegidas, borrador recuperable, fotografías, archivo/restauración y carga masiva Excel/CSV con validación previa.
- **Pedidos:** creación con reserva de stock, datos de entrega, filtros, estados e historial.
- **Inventario y compras:** ajustes con motivo, stock por SKU, proveedores, bodegas, lotes, vencimientos, traslados y compras con recepción idempotente.
- **Gerencia:** ventas por año, mes y categoría; comparación con períodos anteriores; rankings, cobertura, compras sugeridas, márgenes con costo conocido y rotación física con historial suficiente.
- **Sistema:** usuarios, roles, bloqueo, contraseñas, recuperación, sesiones, explorador de colecciones y auditoría de solo lectura con diferencias por campo y exportación.

Los módulos se cargan bajo demanda. La biblioteca y las galerías usan miniaturas; la carga muestra progreso y permite reintentar cada archivo.

## Calidad

```bash
npm run typecheck
npm test
npm run build
```

Los tres comandos recorren todos los workspaces mediante Turborepo.

## Inventario

Las reservas, pedidos, recepciones y movimientos se guardan conjuntamente en una transacción. La API exige MongoDB con replica set (Atlas o `rs0` local) y rechaza el arranque con una instancia independiente. Docker Compose configura `rs0`; la conexión local es `mongodb://127.0.0.1:27017/vital_forge?replicaSet=rs0`. No se elimina ni reinicia ningún volumen existente automáticamente.

El pedido reserva primero los lotes que vencen antes, excluyendo vencidos. Cancelarlo devuelve las unidades a sus lotes originales una sola vez. Reabrirlo vuelve a comprobar existencias y costos. Recibir una compra suma el stock una sola vez; los traslados mantienen el total. En demo, un bloqueo y restauración de estados ofrecen las mismas garantías dentro del proceso, sin persistencia tras reiniciar.

## Imágenes

Las fotos de producto se suben a `POST /media` (administración y catálogo) y se sirven desde `GET /media/:id`. El identificador es el sha256 del archivo, así que subir dos veces la misma foto no duplica bytes y la respuesta se puede cachear como inmutable. El navegador reduce la imagen antes de subirla; el servidor verifica el contenido, corrige orientación, convierte a WebP y limita a 1400 px conservando proporción y transparencia. Genera además una miniatura de 360 px (`GET /media/:id?size=thumb`). Las imágenes previas sin miniatura conservan su versión original. En el producto queda únicamente la URL.

El almacén vive en MongoDB, así que no hace falta disco en el servidor ni una cuenta de terceros. Los `data:` URI están rechazados por validación: metían la imagen entera dentro del documento del producto y reventaban el límite de 16 MB de MongoDB.

Las imágenes estáticas de `apps/web/public/assets` se resuelven contra un manifiesto generado en el arranque y en el build. La web solo pide archivos que existen, en lugar de probar extensiones y acumular respuestas 404.

## Avisos

Al entrar un pedido salen tres avisos: la confirmacion por correo al cliente, con el detalle y los datos para la transferencia; el aviso por correo al operador; y un mensaje de Telegram al telefono del operador. Cada cambio de estado avisa al cliente por correo, y reguardar el mismo estado no vuelve a escribirle.

Ningun aviso puede tumbar una compra. Los tres salen fuera del camino de la respuesta, y si alguno falla el error queda registrado y el pedido se crea igual.

### Correo

El envio va por SMTP, no por la API de un proveedor concreto, asi que sirve con Brevo, Resend, Postmark o Zoho sin tocar codigo: solo cambian las variables. Sin credenciales la tienda funciona igual y los envios quedan anotados en el log, de modo que el desarrollo no necesita cuenta de correo.

**Sin dominio propio**, la opcion que funciona hoy es Brevo con remitente verificado: se verifica una sola direccion, incluso una de Gmail, y desde ahi se puede escribir a cualquiera. Resend en su plan gratis y sin dominio solo permite enviarte correos a vos mismo, asi que no sirve para escribirle al cliente.

**Con dominio propio**, se verifica el dominio en el proveedor y `MAIL_FROM` usa una direccion de ese dominio. Es la unica forma de que los correos lleguen a bandeja de entrada de forma confiable. Migrar de un proveedor a otro es cambiar cuatro variables.

| Variable | Para que sirve |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Conexion con el proveedor. |
| `MAIL_FROM` | Remitente. Debe ser un dominio verificado en el proveedor, o los correos van a spam. |
| `MAIL_OPERATOR` | A donde llegan los avisos de pedido nuevo. Si se omite se usa `ADMIN_EMAIL`. |
| `BANK_*` | Datos de la transferencia. Si estan completos viajan en el correo y el cliente puede pagar sin esperar a que alguien le escriba. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Aviso de pedido nuevo por Telegram. |

La pantalla de confirmacion de la tienda solo promete un correo si de verdad hay uno configurado. Si no lo hay, vuelve sola al texto que dice que la tienda se pondra en contacto.

### Telegram

El aviso de pedido nuevo tambien llega por Telegram, que no necesita dominio, ni verificacion, ni preocuparse por spam. Es el canal con menos probabilidad de pasar desapercibido.

1. Crear el bot con `@BotFather` y copiar el token en `TELEGRAM_BOT_TOKEN`.
2. Escribirle algo al bot desde el telefono, o agregarlo a un grupo del equipo.
3. Correr `npm run telegram:chat -w @vital-forge/api` para ver los chat id disponibles y copiar el que corresponda en `TELEGRAM_CHAT_ID`.

Un grupo funciona mejor que un chat privado si mas de una persona atiende pedidos. El texto que escribe el cliente se escapa antes de enviarlo, de modo que un nombre con etiquetas HTML no puede deformar el mensaje.

El panel avisa en Configuracion cuando ningun canal esta configurado, porque en ese caso nadie se entera de un pedido sin abrir el panel a mano.

## Despliegue

### API

`render.yaml` es un blueprint listo para Render: instala en la raíz del monorepo (con las dependencias de desarrollo, que la compilación necesita), compila el workspace de la API con Node 22 en la región de Virginia, la más cercana a Atlas, y expone `/health` como health check. La guía paso a paso está en [docs/despliegue-web.md](docs/despliegue-web.md).

Variables obligatorias en producción, sin las cuales la API se niega a arrancar:

| Variable | Para qué sirve |
| --- | --- |
| `MONGODB_URI` | Persistencia real. Sin ella el arranque falla en lugar de servir el catálogo demo. |
| `AUTH_TOKEN_SECRET` | Firma de los tokens, mínimo 32 caracteres. Render puede generarlo. |
| `ADMIN_PASSWORD` | Contraseña de la cuenta administradora inicial. |
| `CORS_ORIGINS` | Dominios de la tienda y del panel, separados por coma. |
| `PUBLIC_API_URL` | Dominio público de la API. Se usa para construir las URL de las fotos subidas. |

Si se configura `MONGODB_URI` y MongoDB no responde o no admite transacciones, el proceso termina con error también en desarrollo. El modo demo en memoria es una comodidad de desarrollo: en producción serviría un catálogo inventado y perdería cada pedido al reiniciar.

### Tienda y panel

Ambas SPA se publican en Azure Static Web Apps con los flujos de GitHub Actions `.github/workflows/azure-tienda.yml` y `azure-panel.yml`, que compilan con las URL de producción guardadas como variables del repositorio:

```bash
# apps/web
VITE_GRAPHQL_URL=https://rawenergy-api.onrender.com/graphql
VITE_ADMIN_URL=https://<panel>.azurestaticapps.net

# apps/admin
VITE_GRAPHQL_URL=https://rawenergy-api.onrender.com/graphql
VITE_WEB_URL=https://<tienda>.azurestaticapps.net
```

Esos dos dominios de Azure son los que deben ir en `CORS_ORIGINS` de la API. Las rutas, la caché y las cabeceras de cada sitio están en su `public/staticwebapp.config.json`.

### Orden de despliegue

1. En Atlas, autoriza las IP de salida de Render (Connect → Outbound del servicio).
2. Despliega la API con `render.yaml`, carga las variables de la tabla anterior y apunta `PUBLIC_API_URL` al dominio que te asignó Render.
3. Crea en Azure dos Static Web Apps con origen «Otro», guarda sus tokens y las variables `VITE_*` en GitHub y ejecuta los dos flujos.
4. Vuelve a la API y pon los dos dominios de Azure en `CORS_ORIGINS`, `STORE_URL` y `ADMIN_APP_URL`.

El paso 4 va al final a propósito: hasta que Azure no asigna los dominios no se sabe qué autorizar. Detalle de cada paso en [docs/despliegue-web.md](docs/despliegue-web.md).
