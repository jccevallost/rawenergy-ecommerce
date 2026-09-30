# Probar la tienda en tu computadora

Guía para probar RawEnergy completo (tienda, panel y API) antes de publicarlo. No necesitas MongoDB, correo ni Telegram.

## Primera vez

1. Instala Node.js 20 o superior (https://nodejs.org).
2. En una terminal, dentro de la carpeta del proyecto:

   ```bash
   npm install
   ```

## Arrancar

```bash
npm run demo
```

En unos segundos se abren la tienda y el panel en el navegador, y la terminal muestra:

| | Dirección |
|---|---|
| Tienda | http://localhost:5173 |
| Panel | http://localhost:5174 |
| Acceso al panel | `admin@demo.local` / `Demo-RawEnergy-2026` |

Para cerrar todo: `Ctrl + C` en la terminal.

**Modo aislado.** Los datos viven en memoria: al cerrar se borran pedidos, cambios y fotos subidas, y al volver a arrancar se carga otra vez el catálogo inicial de 20 productos. No se envían correos ni avisos de Telegram. El botón de WhatsApp sí abre un chat real con el 593983368127.

## Probar desde el celular

Con la computadora y el celular en la misma red Wi-Fi:

```bash
npm run demo -- --red
```

La terminal muestra direcciones del tipo `http://192.168.1.20:5173`. Ábrelas en el celular. Si no cargan, el firewall de la computadora puede estar bloqueando los puertos 4000, 5173 y 5174.

## Qué probar

Las reglas vigentes se pueden cambiar en el panel, en **Configuración → Pagos y envíos**.

**Compra por transferencia**
- Agrega productos, abre el carrito y completa la entrega. Provincia y ciudad se eligen de las listas de Ecuador; el celular debe tener 10 dígitos y empezar con 09; el correo debe existir (prueba `nombre@gmial.com` para ver la sugerencia). El documento para la factura es obligatorio: cédula (10 dígitos) o RUC, que se verifican al escribir, o pasaporte para extranjeros (no se verifica).
- Al confirmar aparece «Continuar mi compra por WhatsApp»: abre el chat del 593983368127 con el pedido completo (productos, totales, entrega, forma de pago). La web no muestra la cuenta bancaria; se da por WhatsApp. Se ve la hora límite de pago (24 horas).
- En el panel, en **Pedidos**, el pedido aparece como «Pendiente de pago». Cambia el estado a «Pago confirmado» y luego a «Preparando».

**Contra entrega**
- Disponible sin monto mínimo, con envío express (Quito y Rumiñahui). Si cambias a otra ciudad, vuelve sola a transferencia.
- Al confirmar aparece «Confirmar mi pedido por WhatsApp» y el plazo para hacerlo (4 horas). En el chat pides la ubicación.
- En el panel, en **Pedidos**, el pedido dice «Por confirmar por WhatsApp» con la hora en que se cancela solo. Pega la ubicación (opcional) y pulsa «Confirmado por WhatsApp»; recién entonces puede pasar a «Preparando». Sin confirmar, a las 4 horas se cancela y el stock vuelve al catálogo (la revisión corre cada 5 minutos).
- Un pedido contra entrega no se marca pagado al prepararlo ni despacharlo; el pago se registra al marcarlo «Completado».
- Las horas de plazo se cambian en **Configuración → Pagos y envíos**.

**Envíos**
- Express Quito y Valles: USD 4, gratis desde USD 75 de subtotal. Nacional por Servientrega: USD 5 siempre.
- El express solo aparece para Quito (con Cumbayá, Tumbaco y Conocoto) y Rumiñahui (Sangolquí).
- En **Configuración → Pagos y envíos** puedes cambiar tarifas, el umbral, qué envíos son gratis, el mínimo de contra entrega y si la cuenta bancaria se muestra en la web.

**Consulta de pedido sin cuenta**
- En la tienda, **Consultar mi pedido**, con el número y el correo o teléfono de la compra.

**Panel**
- **Campañas de portada**: crea, pausa o programa una campaña y mira la portada.
- **Productos**: la estrella marca un producto como destacado en la tienda.
- **Configuración → Pagos y envíos**: al cambiar la cuenta bancaria, el panel pide confirmación.

**Varias pestañas y pedidos repetidos**
- Abre la tienda en dos pestañas, agrega productos en ambas: el carrito conserva lo de las dos.
- Confirma un pedido y, en menos de 30 minutos, intenta confirmar exactamente los mismos productos: la tienda avisa y ofrece ver el pedido anterior.

**Avisos de pedidos**
- En el panel, **Configuración → Avisos de pedidos** muestra los avisos en cola o fallidos. En la demo aislada no hay correo ni Telegram, así que se omiten y no aparecen como fallidos.

**Textos legales**
- Pie de página: envíos y pagos, cambios y devoluciones, términos y privacidad. Revisa que digan lo que quieres. El nombre legal, el RUC y la dirección aparecen cuando los configures.

## Probar con tu configuración real

```bash
npm run demo -- --con-env
```

Usa `apps/api/.env`: tu base de datos MongoDB, tu correo y tu Telegram. **Los pedidos quedan guardados y los avisos se envían de verdad.** El acceso al panel es el `ADMIN_EMAIL` y el `ADMIN_PASSWORD` de ese archivo.

## Pasar a MongoDB las fotos que subiste en la demo

La demo guarda las fotos en memoria. Para no perderlas:

1. **Capturarlas** (con la demo abierta): `npm run fotos:capturar`. Crea `exports/fotos-<fecha>/` con cada foto y `manifest.json`, que anota a qué producto y presentación va cada una. La carpeta `exports/` no se sube a git.
2. **Cerrar la demo y arrancar con tu base**: `npm run demo -- --con-env`. Necesitas una red que deje salir por el puerto 27017, o se ve «Could not connect to any servers».
3. **Probar sin escribir**: en otra terminal, `npm run fotos:sincronizar -- --simular`.
4. **Sincronizar**: `npm run fotos:sincronizar`. Si la base está vacía, usa `npm run fotos:sincronizar -- --cargar-catalogo`: crea primero los 20 productos iniciales, con precios y stock de referencia que debes revisar en el panel.

La sincronización sube solo las fotos de productos que existen en la base, reemplaza únicamente las fotos de esas presentaciones y se niega a escribir en una API en memoria. Si alguien cambió el producto a la vez, se rechaza en lugar de pisar el cambio. Repetirla no duplica fotos.

## Problemas comunes

| Mensaje | Qué hacer |
|---|---|
| «El puerto 4000 está ocupado» | Ya hay otra copia abierta (`npm run dev` o `npm run demo`). Ciérrala con `Ctrl + C`. |
| «Faltan dependencias» | Ejecuta `npm install`. |
| Los productos muestran el logo o el nombre de la marca en lugar de una foto | El catálogo inicial no trae fotos propias. Súbelas en el panel, en **Fotografías** o en cada producto. |

## Qué no prueba esta demo

- El comportamiento en el servidor donde se publique (velocidad real, dominio, HTTPS).
- Correo y Telegram, salvo con `--con-env`.
- Varias instancias de la API a la vez.
