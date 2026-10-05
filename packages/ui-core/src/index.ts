/**
 * Tokens de marca (C53): los mismos valores que usan la tienda (apps/web/src/styles.css)
 * y el panel (apps/admin/src/workspace.css). Contrastes medidos en docs/auditoria-visual-teclado.md.
 * Regla: el lima es acción sobre fondo oscuro o fondo de botón con texto `ink`; nunca texto sobre claro.
 */
export const brand = {
  colors: {
    ink: "#0f130e",        // fondo oscuro de la tienda; texto sobre lima 15,9:1
    lime: "#c8ff3d",       // acción principal
    limeEdge: "#4f6b00",   // borde del botón lima sobre claro (6,1:1)
    paper: "#f5f3ed",      // zona de compra
    text: "#141a12",       // texto principal (17,7:1 sobre blanco)
    textMuted: "#4d5647",  // texto secundario de la tienda (7,7:1)
    panelInk: "#17251d",   // texto y barra del panel
    panelMuted: "#65716a", // texto secundario del panel (5,1:1 sobre blanco)
    focus: "#1d5fd1",      // foco en la tienda (5,2:1 sobre papel)
    panelFocus: "#3f6f1f", // foco en el panel (3:1 o más sobre blanco y el fondo)
    success: "#2d6a1e", warning: "#8a5200", danger: "#a3261a"
  },
  radius: { sm: 8, md: 12, lg: 18 }
} as const;

export const formatMoney = (value: number, currency = "USD") =>
  new Intl.NumberFormat("es-EC", { style: "currency", currency }).format(value);

// calculateInstallment (cuotas) se retiró en C67: la tienda no ofrece pago en cuotas.
