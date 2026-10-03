# Publicar la API, la tienda y el panel

Registro: tareas C13 (otros servidores) y C55 (Render y Azure) de la [auditoría ecommerce](auditoria-ecommerce.md). Responsable: Claude. Lo de este documento se probó en local (compilación como en Render desde una copia limpia, API en modo producción contra Atlas y tienda y panel en el emulador oficial de Azure Static Web Apps), no en los servidores definitivos. Antes de anunciar la tienda hay que repasar la [comprobación final](#6-comprobación-final).

## Dónde va cada parte

| Parte | Servicio | Qué lo publica |
| --- | --- | --- |
| API (`apps/api`) | Render, servicio web Node 22 `rawenergy-api`, región Virginia | [`render.yaml`](../render.yaml) |
| Tienda (`apps/web`) | Azure Static Web Apps, plan Free | [`.github/workflows/azure-tienda.yml`](../.github/workflows/azure-tienda.yml) |
| Panel (`apps/admin`) | Azure Static Web Apps, plan Free | [`.github/workflows/azure-panel.yml`](../.github/workflows/azure-panel.yml) |
| Datos y fotos | MongoDB Atlas, AWS São Paulo (`SA_EAST_1`), base `rawenergy_ec` | Ya en uso |

Render no tiene región en Sudamérica: Virginia es la más cercana a Atlas. La región no se puede cambiar después de crear el servicio.

Orden: **primero la API** (hace falta su dirección para compilar la tienda y el panel), después tienda y panel, y al final se le dicen a la API las direcciones de ambos.

## Direcciones actuales (2026-10-02)

| Parte | Dirección |
| --- | --- |
| API (Render) | https://rawenergy-ecommerce.onrender.com |
| Tienda (Azure, sitio `lively-flower-016983b10`) | https://lively-flower-016983b10.3.azurestaticapps.net |
| Panel (Azure, sitio `icy-meadow-0e332cb10`) | https://icy-meadow-0e332cb10.1.azurestaticapps.net |

Variables de GitHub ya creadas: `VITE_GRAPHQL_URL=https://rawenergy-ecommerce.onrender.com/graphql`, `VITE_WEB_URL` (tienda) y `VITE_ADMIN_URL` (panel). En Render faltan `CORS_ORIGINS`, `PUBLIC_API_URL`, `STORE_URL` y `ADMIN_APP_URL` con estas direcciones (paso 5).

## 0. Antes de empezar

- Los archivos de este documento tienen que estar en la rama `main` de `jccevallost/rawenergy-ecommerce`: Render y GitHub Actions leen el repositorio, no este equipo.
- Cuentas: Render y Azure (con una suscripción). GitHub ya está.
- A mano: la cadena de conexión de Atlas (la de `apps/api/.env`) y el correo y la contraseña de administración. No se escriben en ningún archivo del repositorio.

## 1. Atlas: dejar entrar a Render

En Render, el servicio muestra sus IP de salida en **Connect → Outbound**. En Atlas, **Network Access → Add IP Address**, agregar esos rangos. La otra opción, `0.0.0.0/0`, deja entrar a cualquier IP: la base sigue pidiendo usuario y contraseña, pero es menos estricta.

Si la API arranca y falla con `MongooseServerSelectionError`, casi siempre es este paso.

## 2. Render: crear la API

1. Render → **New → Blueprint** → elegir el repositorio. Render lee `render.yaml` y propone `rawenergy-api`.
2. Completar las variables que pide:
   - **Obligatorias:** `MONGODB_URI` (con `/rawenergy_ec` en la ruta), `ADMIN_EMAIL` y `ADMIN_PASSWORD`. Sin ellas la API no arranca en producción.
   - `AUTH_TOKEN_SECRET` la genera Render; no hay que escribirla.
   - Correo (`SMTP_*`, `MAIL_*`), banco (`BANK_*`), Telegram e identidad legal (`STORE_LEGAL_NAME`, `STORE_RUC`…): opcionales. Lo que falte simplemente no se usa.
   - `CORS_ORIGINS`, `STORE_URL` y `ADMIN_APP_URL` se completan en el paso 5.
3. Cuando termine, copiar la dirección del servicio (por ejemplo `https://rawenergy-api.onrender.com`; si el nombre está tomado, Render agrega un sufijo) y ponerla en `PUBLIC_API_URL`.
4. Abrir `https://<api>/health`: debe responder `{"status":"ok"}`.

`ADMIN_EMAIL` y `ADMIN_PASSWORD` solo crean la cuenta si ese correo no existe. Con la base de Atlas actual, la cuenta ya existe: cambiar la variable después **no** cambia la contraseña; eso se hace desde el panel.

El plan gratuito se duerme tras unos minutos sin visitas, y el primer cliente que llega espera a que despierte. Para la tienda abierta al público conviene un plan pago; se cambia en Render sin tocar el archivo.

## 3. Azure: crear la tienda y el panel

Dos recursos iguales, uno para la tienda y otro para el panel (por ejemplo `rawenergy-tienda` y `rawenergy-panel`):

1. Portal de Azure → **Crear un recurso → Static Web App**.
2. Plan de hospedaje: **Free**. Región: cualquiera (el contenido se sirve desde la red global de Azure).
3. Detalles de la implementación, origen: **Otro** (*Other*). Con «GitHub», Azure agrega su propio flujo al repositorio y compilaría sin las variables de producción; los flujos correctos ya están en `.github/workflows/`.
4. Crear. En la página del recurso, copiar la **URL** (`https://<nombre>.azurestaticapps.net`) y, en **Administrar token de implementación** (*Manage deployment token*), el token.

## 4. GitHub: secretos, variables y primera publicación

En el repositorio → **Settings → Secrets and variables → Actions**:

| Tipo | Nombre | Valor |
| --- | --- | --- |
| Secreto | `AZURE_STATIC_WEB_APPS_API_TOKEN_TIENDA` | token del recurso de la tienda |
| Secreto | `AZURE_STATIC_WEB_APPS_API_TOKEN_PANEL` | token del recurso del panel |
| Variable | `VITE_GRAPHQL_URL` | `https://<api>/graphql` |
| Variable | `VITE_WEB_URL` | URL de la tienda en Azure |
| Variable | `VITE_ADMIN_URL` | URL del panel en Azure |

Si al crear el recurso se eligió GitHub como origen, Azure ya guardó el token como secreto con un nombre propio (`AZURE_STATIC_WEB_APPS_API_TOKEN_<NOMBRE_DEL_SITIO>`) y agregó al repositorio un flujo `azure-static-web-apps-<nombre>.yml` que compila mal (desde la raíz, sin las URL de producción y buscando una carpeta `build` que no existe). En ese caso: borrar ese flujo y usar en `azure-tienda.yml` o `azure-panel.yml` el nombre del secreto que creó Azure. Así está hecho hoy: la tienda usa `AZURE_STATIC_WEB_APPS_API_TOKEN_LIVELY_FLOWER_016983B10` y el panel `AZURE_STATIC_WEB_APPS_API_TOKEN_ICY_MEADOW_0E332CB10`.

Desde una terminal con `gh` también sirve (pide el valor sin mostrarlo): `gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN_TIENDA` y `gh variable set VITE_GRAPHQL_URL --body "https://<api>/graphql"`.

Después: pestaña **Actions → «Tienda en Azure» → Run workflow**, y lo mismo con **«Panel en Azure»**. Desde ahí, cada cambio que llegue a `main` en `apps/web` o `apps/admin` se publica solo. Si falta un secreto o una variable, o una dirección no empieza con `https://`, el flujo se detiene antes de compilar y dice cuál.

## 5. Render: presentar la tienda y el panel a la API

En el servicio → **Environment**:

| Variable | Valor |
| --- | --- |
| `CORS_ORIGINS` | `https://<tienda>.azurestaticapps.net,https://<panel>.azurestaticapps.net` (con `https`, sin barra final) |
| `STORE_URL` | URL de la tienda |
| `ADMIN_APP_URL` | URL del panel (enlace para restablecer la contraseña y «Abrir el panel» del aviso de pedido nuevo) |
| `PUBLIC_API_URL` | dirección de la API (si no se puso en el paso 2) |

Al guardar, Render vuelve a desplegar. Sin `CORS_ORIGINS` la tienda abre pero muestra «No hay conexión con la tienda».

## 6. Comprobación final

1. `https://<api>/health` responde `{"status":"ok"}`.
2. En la tienda, abrir escribiéndolas y **recargando** `/producto/<slug-real>`, `/catalogo?uso=energia` y `/campana/<slug>`: deben cargar, no dar 404. `/ruta-inventada` muestra «No encontramos esta página».
3. Las fotos cargan y su dirección empieza con la de la API en Render (no con `localhost`).
4. Agregar al carrito y completar la entrega: el total lo calcula la API. Un pedido de prueba queda en Atlas y reserva stock: luego se cancela desde el panel.
5. Panel: entrar, abrir un producto y subir una foto de prueba.
6. En las herramientas del navegador: `index.html` con `Cache-Control: no-cache`, `assets/index-XXXXXXXX.js` con `max-age=31536000, immutable`, y el panel con `X-Robots-Tag: noindex, nofollow`.
7. Probarla en un teléfono real (Safari y Chrome).

## Dominio propio (cuando lo haya)

1. Azure → recurso → **Custom domains**, para la tienda y el panel; Render → servicio → **Custom Domains**, para la API.
2. Actualizar en Render `CORS_ORIGINS`, `STORE_URL`, `ADMIN_APP_URL` y `PUBLIC_API_URL`, y en GitHub las tres variables `VITE_*`; luego volver a ejecutar los dos flujos.
3. Las fotos ya guardadas siguen funcionando: la API rehace su dirección con `PUBLIC_API_URL` al servirlas.

## Qué hace cada archivo

- `render.yaml`: instala con `npm ci --include=dev` (con `NODE_ENV=production`, `npm ci` omite TypeScript y la compilación falla), fija Node 22, solo vuelve a desplegar cuando cambia la API y lista las variables.
- `apps/web/public/staticwebapp.config.json` y `apps/admin/public/staticwebapp.config.json` (se copian a `dist/`): toda ruta sin archivo responde con la aplicación; un archivo que falta en `/assets` da 404 de verdad; caché de un año para los archivos con huella (`/assets/*.js|css|woff2`) y revalidación para el resto; cabeceras `nosniff`, `X-Frame-Options: DENY` y `Referrer-Policy`; el panel además con `noindex`.
- `.github/workflows/azure-tienda.yml` y `azure-panel.yml`: revisan la configuración, compilan con Node 22 y las URL de producción y suben `dist/` a Azure.

## Variables al compilar

Vite incrusta estas variables en el build: si cambian, hay que volver a compilar (en Azure, volver a ejecutar el flujo).

```sh
# Tienda
VITE_GRAPHQL_URL=https://api.tu-dominio.com/graphql VITE_ADMIN_URL=https://panel.tu-dominio.com npm run build -w @vital-forge/web
# Panel
VITE_GRAPHQL_URL=https://api.tu-dominio.com/graphql VITE_WEB_URL=https://tu-dominio.com npm run build -w @vital-forge/admin
```

## Otros servidores para tienda y panel

Regla para la tienda: servir el archivo si existe; si no, responder `/index.html` con estado 200. Sin esta regla, recargar `/producto/...`, `/catalogo?...` o `/campana/...` devuelve 404. El panel usa rutas con `#` y no la necesita.

**Apache / cPanel.** Ya viene incluida: `apps/web/public/.htaccess` se copia a `dist/`. Requiere `mod_rewrite` y `AllowOverride All` (o el equivalente del proveedor). Si el panel del hosting oculta los archivos que empiezan con punto, hay que activar «mostrar archivos ocultos» antes de subir `dist/`.

**Nginx.**

```nginx
server {
  server_name tu-dominio.com;
  root /var/www/rawenergy/web;   # contenido de apps/web/dist
  location / { try_files $uri $uri/ /index.html; }
  location = /index.html { add_header Cache-Control "no-cache"; }
  location ~ ^/assets/[^/]+-[A-Za-z0-9_-]{8}\.(js|css)$ { add_header Cache-Control "public, max-age=31536000, immutable"; }
}
```

**Caddy.**

```caddy
tu-dominio.com {
  root * /var/www/rawenergy/web
  try_files {path} /index.html
  file_server
}
```

**Render (sitio estático).** Build command `npm ci && npm run build -w @vital-forge/web` y publish directory `apps/web/dist`. En *Redirects/Rewrites* añadir: origen `/*`, destino `/index.html`, acción **Rewrite**.

**Vercel.** Añadir `vercel.json` en la raíz del proyecto de la tienda: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`. Los archivos existentes se sirven antes que la regla.

`apps/web/netlify.toml` y `apps/admin/netlify.toml` se conservan por si más adelante se usa Netlify; no afectan a otros servidores.
