# Guia de assets — apps/web

Estos archivos van en `public/assets/` y se sirven tal cual (no pasan por Vite). Si un archivo no existe con el nombre exacto esperado, la web cae a un icono o a un fondo de respaldo — nunca se rompe, pero conviene usar los nombres correctos para que se vea la imagen real. La web no descarga imagenes de terceros: lo que no este en esta carpeta o en la base de datos, no se muestra.

La carpeta se lee al arrancar el servidor de desarrollo y al compilar, y solo se piden archivos que existen: no hay peticiones fallidas por probar extensiones. Al agregar un archivo nuevo en desarrollo la pagina se recarga sola; si compilaste antes de agregarlo, hay que volver a compilar.

Las fotos de producto cargadas desde el panel no van aqui: se suben al servidor y quedan en la base de datos.

## Formato de imagen (C64)
- **Logos e iconos: SVG** (vectorial, pocos KB, nítido en cualquier pantalla). Si solo hay mapa de bits, **WebP con transparencia** al doble del tamaño en que se muestra. No usar PNG grandes: en la portada móvil los logos PNG pesaban 526 KB de 713 KB; en WebP pesan 71 KB.
- **Fotos de producto: WebP** (la API las convierte sola al subirlas desde el panel). Subir originales de al menos 1.200 × 1.200 px, cuadrados, con fondo claro uniforme y el envase centrado. Nunca SVG para fotos.

## Logo principal
- Colocar en `store/`.
- Nombre esperado: `logo` (ej. `logo.svg` o `logo.webp`).
- Respaldo aceptado: `rawenergy-logo`.
- Formatos, en orden de prioridad: `.svg`, `.webp`, `.png`.
- Recomendacion: exportar sin fondo, recortado al borde real del logo. Hoy hay `logo.webp` (320 px, 14 KB) y el `logo.png` original como respaldo.

## Logos de marcas
- Colocar en `brands/`.
- Nombres esperados (uno por marca): `dragon-pharma`, `raw-nutrition`, `evogen`, `muscletech`, `nutrex`, `optimum-nutrition`, `gold-standard`, `kevin-levrone`, `dymatize`, `insane-labz`.
- Formatos, en orden de prioridad: `.svg`, `.webp`, `.png`. Cada marca tiene hoy su `.webp` (hasta 460 px) y el `.png` original como respaldo.
- Pendiente del propietario: logo de Gold Standard y un logo de Raw Nutrition sin el fondo de cemento.

## Fotos de producto
- Colocar en `products/`.
- Nombre esperado: el `slug` del producto (ej. `gold-standard-100-whey.jpg`).
- Respaldo aceptado: el titulo del producto convertido a slug.
- Formatos, en orden de prioridad: `.webp`, `.png`, `.jpg`.
- Si no se coloca ningun archivo, se usa automaticamente la imagen que ya tiene el producto en la base de datos (URL de `primaryImage`/`variants[0].images[0]`).

## Portada
- No usa fotos fijas: cada diapositiva muestra la foto de un producto real con existencias, distinta por diapositiva, tomada del catálogo (`HeroCarousel`).
- Para que la portada se vea bien, cada producto debe tener su foto cargada desde el panel o en `products/`.

## Revisión pendiente de logos
- El archivo que se llamaba `brands/gold-standard.png` mostraba el logo de **Insane Labz**; se renombró a `brands/insane-labz.png` (2026-09-26). La tarjeta de **Gold Standard** muestra su nombre en texto hasta que se coloque `brands/gold-standard.png` con el logo correcto.

## Fotos pendientes del catálogo inicial
Mientras un producto no tiene foto, la tienda muestra el logo de su marca en el recuadro (nunca una foto de otro producto). Nombres esperados en `products/` (o sube las fotos desde el panel en cada variante):
`gold-standard-100-whey`, `gold-standard-100-isolate`, `dragon-pharma-creatine-monohydrate`, `dragon-pharma-iso-phorm`, `insane-labz-psychotic-gold`, `insane-labz-psychotic`, `optimum-nutrition-micronized-creatine`, `optimum-nutrition-serious-mass`, `dymatize-iso100`, `dymatize-elite-100-whey`, `muscletech-nitro-tech-whey-gold`, `muscletech-platinum-creatine`, `nutrex-lipo-6-black-uc`, `nutrex-outlift`, `evogen-evp-3d`, `evogen-isoject`, `kevin-levrone-anabolic-mass`, `kevin-levrone-levro-whey-supreme`, `raw-nutrition-cbum-thavage`, `raw-nutrition-cbum-itholate` (con extensión `.webp`, `.png` o `.jpg`).
