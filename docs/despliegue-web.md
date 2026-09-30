# Publicar la tienda y el panel fuera de Netlify

Registro: tarea C13 de la [auditoría ecommerce](auditoria-ecommerce.md). Responsable: Claude. Estas instrucciones no se probaron en el servidor definitivo. Antes de anunciar la tienda, hay que comprobar en ese servidor los puntos de la última sección.

## Qué se publica

| Parte | Carpeta de salida | Tipo |
| --- | --- | --- |
| API | `apps/api` (`node apps/api/dist/server.js`) | Servicio Node 20 con MongoDB. Ya existe un blueprint para Render en `render.yaml`. |
| Tienda | `apps/web/dist` | Archivos estáticos. Necesita la reescritura de rutas descrita abajo. |
| Panel | `apps/admin/dist` | Archivos estáticos. Usa rutas con `#`, así que no necesita reescritura. |

Orden: **primero la API** (añadió `productBySlug`, `featured`, campañas y destacados) y después tienda y panel. Una tienda nueva contra una API anterior falla en esas consultas.

## Variables al compilar

Vite incrusta estas variables en el build: si cambian, hay que volver a compilar.

```sh
# Tienda
VITE_GRAPHQL_URL=https://api.tu-dominio.com/graphql VITE_ADMIN_URL=https://panel.tu-dominio.com npm run build -w @vital-forge/web
# Panel
VITE_GRAPHQL_URL=https://api.tu-dominio.com/graphql VITE_WEB_URL=https://tu-dominio.com npm run build -w @vital-forge/admin
```

En la API: `CORS_ORIGINS=https://tu-dominio.com,https://panel.tu-dominio.com` (sin barra final), `PUBLIC_API_URL`, `STORE_URL` y `ADMIN_APP_URL`. Si falta un origen en `CORS_ORIGINS`, la tienda carga pero el catálogo muestra «No hay conexión con la tienda».

## Reescritura de rutas de la tienda

Regla: servir el archivo si existe; si no, responder `/index.html` con estado 200. Sin esta regla, recargar `/producto/...`, `/catalogo?...` o `/campana/...` devuelve 404.

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

`apps/web/netlify.toml` se conserva por si más adelante se usa Netlify; no afecta a otros servidores.

## Comprobación en el servidor definitivo

1. Abrir `/producto/<slug-real>`, `/catalogo?uso=energia` y `/campana/vuelve-a-tu-rutina` escribiéndolos directamente y **recargando** la página: deben cargar, no dar 404.
2. `/ruta-inventada` debe mostrar «No encontramos esta página» (dentro de la tienda).
3. En las herramientas del navegador, `index.html` con `Cache-Control: no-cache` y `assets/index-XXXXXXXX.js` con caché larga.
4. Agregar al carrito, completar datos de entrega y ver el total calculado por la API. Si aparece «No hay conexión con la tienda», revisar `CORS_ORIGINS` y `VITE_GRAPHQL_URL`.
5. HTTPS activo en tienda, panel y API. Un navegador bloquea llamadas de una tienda https a una API http.
