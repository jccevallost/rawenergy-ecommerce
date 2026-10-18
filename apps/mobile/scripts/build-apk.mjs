// APK-01 y APK-02: compila el APK firmado de la app administrativa o de clientes.
// Uso: npm run build:admin -w @vital-forge/mobile   |   npm run build:tienda -w @vital-forge/mobile
// Variables: RAWENERGY_APP_VERSION (1.0.0), RAWENERGY_PANEL_URL, RAWENERGY_STORE_URL, ANDROID_HOME, JAVA_HOME.
// La clave de firma vive fuera del repositorio, en ~/RawEnergy-firma. Si se pierde, las apps instaladas ya no
// se pueden actualizar: respáldala junto con su contraseña.
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = process.argv[2] === "tienda" ? "tienda" : "admin";
const version = process.env.RAWENERGY_APP_VERSION ?? "1.0.0";
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("RAWENERGY_APP_VERSION debe tener la forma 1.2.3");
const [major, minor, patch] = version.split(".").map(Number);
const versionCode = major * 10000 + minor * 100 + patch;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = join(root, app === "admin" ? "android-admin" : "android-tienda");
const env = {
  ...process.env, RAWENERGY_APP: app, RAWENERGY_APP_VERSION: version,
  // Gradle de Capacitor 8 necesita Java 21 (brew install openjdk@21); el Java 25 de Android Studio no sirve.
  JAVA_HOME: process.env.JAVA_HOME ?? "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
  ANDROID_HOME: process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk")
};
// Los argumentos pueden llevar la contraseña de firma: nunca se muestran.
const run = (command, args, cwd = root) => { const r = spawnSync(command, args, { cwd, env, stdio: "inherit" }); if (r.status !== 0) throw new Error(`Falló: ${command} ${args[0] ?? ""}`); };

if (!existsSync(androidDir)) run("npx", ["cap", "add", "android"]);
run("npx", ["cap", "sync", "android"]);
// Icono de la marca y versión de la app.
cpSync(join(root, "resources/android-icons"), join(androidDir, "app/src/main/res"), { recursive: true });
const gradleFile = join(androidDir, "app/build.gradle");
writeFileSync(gradleFile, readFileSync(gradleFile, "utf8").replace(/versionCode \d+/, `versionCode ${versionCode}`).replace(/versionName "[^"]*"/, `versionName "${version}"`));

const keyDir = join(homedir(), "RawEnergy-firma"), keystore = join(keyDir, "rawenergy-android.jks"), passwordFile = join(keyDir, "clave-android.txt");
if (!existsSync(keystore)) {
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  const password = randomBytes(24).toString("base64url");
  writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });
  run(join(env.JAVA_HOME, "bin/keytool"), ["-genkeypair", "-v", "-keystore", keystore, "-alias", "rawenergy", "-keyalg", "RSA", "-keysize", "4096", "-validity", "10000", "-storepass", password, "-keypass", password, "-dname", "CN=RawEnergy, O=RawEnergy, C=EC"]);
  chmodSync(keystore, 0o600);
  console.log(`Clave de firma creada en ${keyDir}. Respáldala con su contraseña: sin ella no se pueden actualizar las apps.`);
}
const password = readFileSync(passwordFile, "utf8").trim();
run("./gradlew", ["assembleRelease", "--no-daemon", "-q",
  `-Pandroid.injected.signing.store.file=${keystore}`, `-Pandroid.injected.signing.store.password=${password}`,
  "-Pandroid.injected.signing.key.alias=rawenergy", `-Pandroid.injected.signing.key.password=${password}`], androidDir);
const outDir = join(homedir(), "RawEnergy-instaladores");
mkdirSync(outDir, { recursive: true });
const apk = join(androidDir, "app/build/outputs/apk/release/app-release.apk");
const target = join(outDir, `rawenergy-${app === "admin" ? "gestion" : "tienda"}-${version}.apk`);
copyFileSync(apk, target);
console.log(`APK firmado: ${target}`);
