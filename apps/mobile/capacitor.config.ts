// APK-01 y APK-02: una configuración por app. La app abre el panel o la tienda publicados, así cada despliegue
// web llega sin publicar otra versión; se identifica con «RawEnergyShell/<plataforma>/<versión>» para que el
// servidor aplique la versión mínima (VER-01). Los enlaces a otros dominios (WhatsApp, bancos) se abren fuera.
import type { CapacitorConfig } from "@capacitor/cli";

const app = process.env.RAWENERGY_APP === "tienda" ? "tienda" : "admin";
const version = process.env.RAWENERGY_APP_VERSION ?? "1.0.0";
const urls = {
  admin: process.env.RAWENERGY_PANEL_URL ?? "https://icy-meadow-0e332cb10.1.azurestaticapps.net",
  tienda: process.env.RAWENERGY_STORE_URL ?? "https://lively-flower-016983b10.3.azurestaticapps.net"
};
const config: CapacitorConfig = {
  appId: app === "admin" ? "ec.rawenergy.gestion" : "ec.rawenergy.tienda",
  appName: app === "admin" ? "RawEnergy Gestión" : "RawEnergy",
  webDir: "www",
  appendUserAgent: `RawEnergyShell/${app === "admin" ? "panel-android" : "tienda-android"}/${version}`,
  // http solo para pruebas locales en el emulador (10.0.2.2); las direcciones publicadas son https.
  server: { url: urls[app], cleartext: urls[app].startsWith("http://"), androidScheme: "https" },
  android: { path: app === "admin" ? "android-admin" : "android-tienda", allowMixedContent: false, captureInput: true, webContentsDebuggingEnabled: false }
};
export default config;
