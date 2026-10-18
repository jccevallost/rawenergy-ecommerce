import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { GraphQLError } from "graphql";
import mongoose from "mongoose";
import { setMongoPersistence, usesMongo } from "../lib/persistence.js";
import { z } from "zod";
import { env } from "../config/env.js";
import { UserModel } from "../models/User.js";

import { permissions, type Permission, type Role } from "./permissions.js";
import { mailService } from "./mail.service.js";
import { emailProblem } from "../data/ecuador.js";
import { blockedIdentities, blockedMessage, CANCELLATION_BLOCK_LIMIT } from "./blockedIdentities.js";
import { passwordProblem } from "../lib/passwordPolicy.js";
import { decryptSecret, encryptSecret, hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from "../lib/totp.js";

// scrypt con N=2^14, r=8, p=5: la configuración mínima que recomienda OWASP y solo
// 16 MiB por cálculo (el plan gratuito de Render tiene 512 MB). Los hashes anteriores
// («scrypt:sal:clave», p=1) se siguen aceptando y se rehacen al entrar (C60, S11).
const SCRYPT = { N: 16384, r: 8, p: 5 } as const;
const SCRYPT_PREFIX = `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$`;
type ScryptParams = { N: number; r: number; p: number };
const derive = (password: string, salt: string, params: ScryptParams) => new Promise<Buffer>((resolve, reject) => {
  crypto.scrypt(password, salt, 64, { ...params, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});
const parseHash = (hash: string): { params: ScryptParams; salt: string; key: string } | null => {
  if (hash.startsWith("scrypt$")) {
    const [, N, r, p, salt, key] = hash.split("$");
    const params = { N: Number(N), r: Number(r), p: Number(p) };
    if (!salt || !key || ![16384, 32768, 65536].includes(params.N) || params.r !== 8 || params.p < 1 || params.p > 10) return null;
    return { params, salt, key };
  }
  const [, salt, key] = hash.split(":");
  return salt && key ? { params: { N: 16384, r: 8, p: 1 }, salt, key } : null;
};
const isStaffRole = (role: Role) => role !== "CUSTOMER";
/** CLI-01: con las cuentas de clientes retiradas no se crean, no inician sesión y sus sesiones dejan de valer. Los datos se conservan. */
export const customerAccountsEnabled = () => env.CUSTOMER_ACCOUNTS === "on";
/** SEG-01: el personal sin segundo factor activo solo puede activarlo. */
export const staffMfaRequired = () => env.STAFF_MFA === "required";
export const mfaSetupPending = (user: Pick<AuthUser, "role" | "twoFactorEnabled">) => isStaffRole(user.role) && staffMfaRequired() && !user.twoFactorEnabled;
const mfaSetupError = () => new GraphQLError("Activa la verificación en dos pasos en «Mi acceso» para usar el panel. Toma un par de minutos con la app del teléfono.", { extensions: { code: "MFA_SETUP_REQUIRED" } });
export const accountsOffMessage = "La tienda ya no usa cuentas de cliente. Puedes comprar sin registrarte y consultar tu pedido con su número en «Consulta tu pedido».";
// Sesiones (C60, S10): el personal entra cada día; los clientes conservan 7 días.
const sessionSeconds = (role: Role) => isStaffRole(role) ? 12 * 3600 : 7 * 86400;
const badPassword = (message: string) => new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT", field: "password" } });
export type AuthRole = Role;
export type AuthUser = { id: string; name: string; email: string; role: AuthRole; status: "ACTIVE" | "BLOCKED"; createdAt?: Date; lastLoginAt?: Date | null; sessionId?: string; twoFactorEnabled?: boolean; emailVerified?: boolean };
type TwoFactorFields = { totpEnabled?: boolean; totpSecret?: string | null; totpPending?: string | null; totpLastStep?: number; totpRecovery?: string[] };
type MemoryUser = AuthUser & TwoFactorFields & { passwordHash: string; sessionVersion?: number; sessions?: Array<{ id: string; createdAt: Date; expiresAt: Date }>; resetHash?: string; resetExpiresAt?: Date; resetRequestedAt?: Date } & VerificationFields;
// CU04: verificación y cambio de correo del cliente.
type VerificationFields = { customerCancellations?: number; blockedReason?: string | null; emailVerifiedAt?: Date | null; verifyHash?: string; verifyExpiresAt?: Date; verifyRequestedAt?: Date; pendingEmail?: string; emailChangeHash?: string; emailChangeExpiresAt?: Date; emailChangeRequestedAt?: Date };

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(120).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(120)
});
const loginSchema = z.object({
  email: z.string().email().max(120).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(120),
  // Código de la aplicación de verificación o de recuperación (C69); solo si la cuenta lo tiene activo.
  code: z.string().trim().max(20).optional().nullable()
});
const tokenPayloadSchema = z.object({ sub: z.string(), email: z.string().email(), role: z.enum(["CUSTOMER", "CATALOG", "WAREHOUSE", "MANAGER", "STORE_MANAGER", "ADMIN"]), exp: z.number(), ver: z.number().int().optional(), sid: z.string().optional() });

const toPublicUser = (user: { _id?: unknown; id?: unknown; name: string; email: string; role: AuthRole; status: "ACTIVE" | "BLOCKED"; createdAt?: Date; lastLoginAt?: Date | null; totpEnabled?: boolean | null; emailVerifiedAt?: Date | null }): AuthUser => ({
  twoFactorEnabled: Boolean(user.totpEnabled),
  // El personal no pasa por la verificación de clientes (CU04).
  emailVerified: user.role !== "CUSTOMER" || Boolean(user.emailVerifiedAt),
  id: String(user._id ?? user.id),
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt ?? null
});

// CU04: enlaces de un solo uso. Se guarda solo el hash; el token viaja en el fragmento (#) del enlace.
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("base64url");
const VERIFY_MS = 24 * 3600_000, EMAIL_CHANGE_MS = 3600_000, RESEND_MS = 60_000;
const recent = (date?: Date | null) => Boolean(date && Date.now() - new Date(date).getTime() < RESEND_MS);
const storeLink = (key: string, token: string) => env.STORE_URL ? `${env.STORE_URL.replace(/\/$/, "")}/#${key}=${encodeURIComponent(token)}` : "";
/** «an***@correo.com»: para avisos al correo anterior sin exponer el nuevo completo. */
export const maskEmail = (email: string) => { const [user = "", domain = ""] = email.split("@"); return `${user.slice(0, 2)}***@${domain}`; };
const linkError = () => new GraphQLError("El enlace no es válido o ya venció. Pide uno nuevo.", { extensions: { code: "BAD_USER_INPUT", field: "token" } });

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
const decode = (value: string) => JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;

const adminChange = new AsyncLocalStorage<boolean>();
class AuthService {
  private adminTail = Promise.resolve();
  private async manage<T>(actor: AuthUser, work: () => Promise<T>): Promise<T> {
    const guarded = async () => {
      if (this.useMongo) { const result=await UserModel.updateOne({_id:actor.id,role:"ADMIN",status:"ACTIVE"},{$inc:{accessRevision:1}}); if(!result.matchedCount) throw new Error("El permiso de administrador cambió. Inicia sesión nuevamente."); }
      else { const current=this.memoryUsers.find(u=>u.id===actor.id); if(!current || current.role!=="ADMIN" || current.status!=="ACTIVE") throw new Error("El permiso de administrador cambió"); }
      return adminChange.run(true,work);
    };
    if(this.useMongo) return mongoose.connection.transaction(guarded);
    const previous=this.adminTail;let unlock!:()=>void;this.adminTail=new Promise<void>(r=>{unlock=r;});await previous;try{return await guarded();}finally{unlock();}
  }
  private get useMongo() { return usesMongo(); }
  private memoryUsers: MemoryUser[] = [];
  private secret = env.authTokenSecret;

  /** Fija el modo de persistencia de todo el proceso (D03); productService.connect ya lo fija con MongoDB. */
  setPersistence(useMongo: boolean) {
    setMongoPersistence(useMongo);
  }

  async bootstrapAdmin() {
    const email = env.adminEmail;
    const password = env.adminPassword;
    const name = env.adminName;
    // Solo crea la cuenta si no existe. En producción exige una contraseña que cumpla la
    // política del personal; si la cuenta ya existe, ADMIN_PASSWORD puede quitarse.
    const assertCreatable = () => {
      if (!env.isProduction) return;
      if (!password) throw new Error("No existe la cuenta de administración y falta ADMIN_PASSWORD para crearla.");
      const problem = passwordProblem(password, { staff: true, email, name });
      if (problem) throw new Error(`ADMIN_PASSWORD no cumple la política del personal: ${problem}`);
    };
    if (this.useMongo) {
      const exists = await UserModel.exists({ email });
      if (!exists) { assertCreatable(); await UserModel.create({ name, email, passwordHash: await this.hashPassword(password), role: "ADMIN", status: "ACTIVE" }); }
      return;
    }
    if (!this.memoryUsers.some((user) => user.email === email)) assertCreatable();
    if (!this.memoryUsers.some((user) => user.email === email)) {
      this.memoryUsers.push({ id: "admin-dev", name, email, passwordHash: await this.hashPassword(password), role: "ADMIN", status: "ACTIVE", createdAt: new Date(), lastLoginAt: null });
    }
  }

  async hashPassword(password: string) {
    const salt = crypto.randomBytes(16).toString("base64url");
    const key = await derive(password, salt, SCRYPT);
    return `${SCRYPT_PREFIX}${salt}$${key.toString("base64url")}`;
  }

  async verifyPassword(password: string, passwordHash: string) {
    const parsed = parseHash(passwordHash);
    if (!parsed) return false;
    const key = await derive(password, parsed.salt, parsed.params);
    const storedBuffer = Buffer.from(parsed.key, "base64url");
    if (storedBuffer.length !== key.length) return false;
    return crypto.timingSafeEqual(storedBuffer, key);
  }

  /** El hash se creó con parámetros anteriores y conviene rehacerlo. */
  needsRehash(passwordHash: string) {
    return !passwordHash.startsWith(SCRYPT_PREFIX);
  }

  // Hash de una contraseña que nadie conoce: se verifica contra él cuando la cuenta no
  // existe o está bloqueada, para que el tiempo de respuesta no lo delate (C60, S07).
  private dummyHash?: Promise<string>;
  private placeholderHash() {
    this.dummyHash ??= this.hashPassword(crypto.randomBytes(24).toString("base64url"));
    return this.dummyHash;
  }

  // Trabajo que se hace después de responder (recuperación de contraseña). Las pruebas lo esperan con flushBackground().
  private background = new Set<Promise<unknown>>();
  private runInBackground(work: () => Promise<unknown>) {
    const task = work().catch((error) => console.error("[auth] tarea en segundo plano", error)).finally(() => this.background.delete(task));
    this.background.add(task);
  }
  async flushBackground() {
    while (this.background.size) await Promise.all([...this.background]);
  }

  /** Rol de una cuenta por correo, para las alertas de seguridad; null si no existe. */
  async roleOf(email: string): Promise<AuthRole | null> {
    const normalized = email.trim().toLowerCase();
    const user = this.useMongo ? await UserModel.findOne({ email: normalized }).select("role").lean() : this.memoryUsers.find((u) => u.email === normalized);
    return (user?.role as AuthRole | undefined) ?? null;
  }

  signToken(user: AuthUser & { sessionVersion?: number }) {
    const header = encode({ alg: "HS256", typ: "JWT" });
    const payload = encode({ sub: user.id, sid: user.sessionId, ver: user.sessionVersion ?? 0, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + sessionSeconds(user.role) });
    const signature = crypto.createHmac("sha256", this.secret).update(`${header}.${payload}`).digest("base64url");
    return `${header}.${payload}.${signature}`;
  }

  verifyToken(token?: string | null) {
    if (!token) return null;
    try {
      const [header, payload, signature] = token.replace(/^Bearer\s+/i, "").split(".");
      if (!header || !payload || !signature) return null;
      const expected = crypto.createHmac("sha256", this.secret).update(`${header}.${payload}`).digest("base64url");
      const received = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expected);
      // timingSafeEqual exige buffers del mismo largo: sin este control, una firma
      // recortada lanza RangeError y convierte un 401 en un 500.
      if (received.length !== expectedBuffer.length) return null;
      if (!crypto.timingSafeEqual(received, expectedBuffer)) return null;
      const result = tokenPayloadSchema.safeParse(decode(payload));
      if (!result.success) return null;
      if (result.data.exp < Math.floor(Date.now() / 1000)) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  async issueToken(user: AuthUser & { sessionVersion?: number }) {
    const session = { id: crypto.randomUUID(), createdAt: new Date(), expiresAt: new Date(Date.now() + sessionSeconds(user.role) * 1000) };
    if (this.useMongo) await UserModel.updateOne({ _id: user.id }, { $push: { sessions: { $each: [session], $slice: -20 } } });
    else { const record = this.memoryUsers.find((u) => u.id === user.id); if (record) record.sessions = [...(record.sessions ?? []).filter((s) => s.expiresAt > new Date()), session].slice(-20); }
    return this.signToken({ ...user, sessionId: session.id });
  }

  async sessions(actor: AuthUser) {
    const user = this.useMongo ? await UserModel.findById(actor.id).lean() : this.memoryUsers.find((u) => u.id === actor.id);
    return { sessions: (user?.sessions ?? []).filter((s) => s.expiresAt && s.expiresAt > new Date()).map((s) => ({ id: s.id, createdAt: s.createdAt, expiresAt: s.expiresAt, current: s.id === actor.sessionId })), legacySession: !actor.sessionId };
  }

  async endSession(actor: AuthUser) {
    if(!actor.sessionId) return this.revokeSessions(actor);
    if(this.useMongo) await UserModel.updateOne({_id:actor.id},{$pull:{sessions:{id:actor.sessionId}}});
    else {const user=this.memoryUsers.find(u=>u.id===actor.id);if(user)user.sessions=(user.sessions??[]).filter(s=>s.id!==actor.sessionId);}
    return true;
  }

  async revokeSessions(actor: AuthUser) {
    if (this.useMongo) await UserModel.updateOne({ _id: actor.id }, { $inc: { sessionVersion: 1 }, $set: { sessions: [] } });
    else { const user = this.memoryUsers.find((u) => u.id === actor.id); if (user) { user.sessionVersion = (user.sessionVersion ?? 0) + 1; user.sessions = []; } }
    return true;
  }

  async requestReset(email: string) {
    const normalized = z.string().email().max(120).parse(email).toLowerCase();
    const reply = { accepted: true, deliveryAvailable: mailService.enabled && Boolean(env.ADMIN_APP_URL || env.STORE_URL) };
    // La búsqueda, el token y el correo van después de responder: así la respuesta tarda
    // lo mismo exista o no la cuenta (C60, S07).
    if (reply.deliveryAvailable) this.runInBackground(() => this.deliverReset(normalized));
    return reply;
  }

  private async deliverReset(normalized: string) {
    const user = this.useMongo ? await UserModel.findOne({ email: normalized }) : this.memoryUsers.find((u) => u.email === normalized);
    if (!user || user.status !== "ACTIVE" || user.role === "CUSTOMER" && !customerAccountsEnabled() || user.resetRequestedAt && Date.now() - user.resetRequestedAt.getTime() < 60000) return;
    // CU04: el cliente recupera su acceso en la tienda; el personal, en el panel.
    const customer = user.role === "CUSTOMER";
    if (customer ? !env.STORE_URL : !env.ADMIN_APP_URL) return;
    const token = crypto.randomBytes(32).toString("base64url");
    const patch = { resetHash: crypto.createHash("sha256").update(token).digest("hex"), resetExpiresAt: new Date(Date.now() + 30 * 60000), resetRequestedAt: new Date() };
    if (this.useMongo) await UserModel.updateOne({ _id: (user as { _id?: unknown })._id }, { $set: patch }); else Object.assign(user, patch);
    await mailService.sendPasswordReset(user.email, customer ? storeLink("restablecer", token) : `${env.ADMIN_APP_URL!.replace(/\/$/, "")}/#reset=${encodeURIComponent(token)}`);
  }

  async resetPassword(token: string, password: string) {
    z.string().min(30).max(100).parse(token); z.string().max(120).parse(password);
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const invalid = () => new Error("El enlace no es válido o ya venció");
    const holder = this.useMongo
      ? await UserModel.findOne({ resetHash: hash, resetExpiresAt: { $gt: new Date() }, status: "ACTIVE" }).select("email name role emailVerifiedAt").lean()
      : this.memoryUsers.find((u) => u.resetHash === hash && u.resetExpiresAt && u.resetExpiresAt > new Date() && u.status === "ACTIVE");
    if (!holder) throw invalid();
    const problem = passwordProblem(password, { staff: isStaffRole(holder.role as Role), email: holder.email, name: holder.name });
    if (problem) throw badPassword(problem);
    const passwordHash = await this.hashPassword(password);
    if (this.useMongo) {
      // CU04: usar el enlace del correo también acredita la posesión del correo de un cliente.
      const verified = holder.role === "CUSTOMER" ? { emailVerifiedAt: (holder as { emailVerifiedAt?: Date | null }).emailVerifiedAt ?? new Date() } : {};
      const result = await UserModel.updateOne({ resetHash: hash, resetExpiresAt: { $gt: new Date() }, status: "ACTIVE" }, { $set: { passwordHash, sessions: [], ...verified }, $inc: { sessionVersion: 1 }, $unset: { resetHash: 1, resetExpiresAt: 1 } });
      if (!result.modifiedCount) throw invalid();
    } else {
      const user = holder as MemoryUser;
      Object.assign(user, { passwordHash, sessions: [], sessionVersion: (user.sessionVersion ?? 0) + 1 }); delete user.resetHash; delete user.resetExpiresAt;
      if (user.role === "CUSTOMER") user.emailVerifiedAt ??= new Date();
    }
    return true;
  }

  /**
   * CU04 (D05): alta de cliente con la misma respuesta exista o no el correo, y sin sesión. Solo se responden
   * en el momento los errores que dependen de lo escrito (formato, contraseña débil); la búsqueda, el alta y
   * los correos van después de responder, para que tampoco el tiempo delate la cuenta.
   */
  async register(raw: unknown) {
    // Antes de leer los datos: con las cuentas retiradas la respuesta no depende del correo (D05).
    if (!customerAccountsEnabled()) throw new GraphQLError(accountsOffMessage, { extensions: { code: "FORBIDDEN" } });
    const input = registerSchema.parse(raw);
    const problem = passwordProblem(input.password, { email: input.email, name: input.name });
    if (problem) throw badPassword(problem);
    this.runInBackground(() => this.deliverSignUp(input));
    return { accepted: true, deliveryAvailable: mailService.enabled && Boolean(env.STORE_URL) };
  }

  private async findByEmail(email: string) {
    return this.useMongo ? UserModel.findOne({ email }).lean() : this.memoryUsers.find((u) => u.email === email) ?? null;
  }

  private async patchUser(user: { _id?: unknown; id?: unknown }, patch: Record<string, unknown>) {
    if (this.useMongo) await UserModel.updateOne({ _id: user._id ?? user.id }, { $set: patch });
    else { const record = this.memoryUsers.find((u) => u.id === String(user.id ?? user._id)); if (record) Object.assign(record, patch); }
  }

  private async deliverSignUp(input: z.infer<typeof registerSchema>) {
    const existing = await this.findByEmail(input.email);
    if (existing) {
      // El titular recibe un aviso; quien se registra no sabe si la cuenta existía.
      if (existing.status !== "ACTIVE" || recent(existing.verifyRequestedAt)) return;
      await this.patchUser(existing, { verifyRequestedAt: new Date() });
      await mailService.sendAccountExists(existing.email, env.STORE_URL ?? "");
      return;
    }
    const token = newToken();
    const fields = { name: input.name, email: input.email, passwordHash: await this.hashPassword(input.password), role: "CUSTOMER" as const, status: "ACTIVE" as const, emailVerifiedAt: null, verifyHash: hashToken(token), verifyExpiresAt: new Date(Date.now() + VERIFY_MS), verifyRequestedAt: new Date() };
    if (this.useMongo) {
      try { await UserModel.create(fields); }
      catch (error) { if ((error as { code?: number }).code === 11000) return; throw error; } // Alta simultánea del mismo correo.
    } else {
      if (this.memoryUsers.some((u) => u.email === input.email)) return;
      this.memoryUsers.push({ id: `user-${crypto.randomUUID()}`, ...fields, createdAt: new Date(), lastLoginAt: null });
    }
    await mailService.sendEmailVerification(input.email, storeLink("verificar", token));
  }

  /** Cliente ya verificado con sesión. Solo pruebas y herramientas internas: GraphQL no lo expone. */
  async createVerifiedCustomer(raw: unknown) {
    const created = await this.createAccount(raw);
    await this.patchUser(created.user, { emailVerifiedAt: new Date() });
    return { ...created, user: { ...created.user, emailVerified: true } };
  }

  /** CU04: confirma la posesión del correo con el enlace de un solo uso. No inicia sesión. */
  async verifyEmail(token: string) {
    if (!customerAccountsEnabled()) throw new GraphQLError(accountsOffMessage, { extensions: { code: "FORBIDDEN" } });
    if (!z.string().min(30).max(100).safeParse(token).success) throw linkError();
    const hash = hashToken(token);
    if (this.useMongo) {
      const result = await UserModel.updateOne({ verifyHash: hash, verifyExpiresAt: { $gt: new Date() }, status: "ACTIVE", role: "CUSTOMER" }, { $set: { emailVerifiedAt: new Date() }, $unset: { verifyHash: 1, verifyExpiresAt: 1 } });
      if (!result.modifiedCount) throw linkError();
      return true;
    }
    const user = this.memoryUsers.find((u) => u.verifyHash === hash && u.verifyExpiresAt && u.verifyExpiresAt > new Date() && u.status === "ACTIVE" && u.role === "CUSTOMER");
    if (!user) throw linkError();
    user.emailVerifiedAt = new Date(); delete user.verifyHash; delete user.verifyExpiresAt;
    return true;
  }

  /** Reenvío del enlace de confirmación con respuesta uniforme. */
  async resendVerification(email: string) {
    const normalized = z.string().trim().email().max(120).parse(email).toLowerCase();
    if (customerAccountsEnabled()) this.runInBackground(() => this.deliverVerification(normalized));
    return { accepted: true, deliveryAvailable: mailService.enabled && Boolean(env.STORE_URL) };
  }

  private async deliverVerification(email: string) {
    const user = await this.findByEmail(email);
    if (!user || user.role !== "CUSTOMER" || user.status !== "ACTIVE" || user.emailVerifiedAt || recent(user.verifyRequestedAt)) return;
    const token = newToken();
    await this.patchUser(user, { verifyHash: hashToken(token), verifyExpiresAt: new Date(Date.now() + VERIFY_MS), verifyRequestedAt: new Date() });
    await mailService.sendEmailVerification(user.email, storeLink("verificar", token));
  }

  /**
   * CU04: cambio de correo con reautenticación por contraseña. La respuesta no dice si el nuevo correo ya
   * tiene cuenta; el vigente sigue hasta confirmar el nuevo desde su enlace.
   */
  async requestEmailChange(actor: AuthUser | null | undefined, rawEmail: unknown, rawPassword: unknown) {
    const user = this.requireCustomer(actor);
    const email = z.string().trim().max(120).refine((value) => !emailProblem(value), "Escribe un correo válido, por ejemplo nombre@gmail.com.").transform((value) => value.toLowerCase()).parse(rawEmail);
    const password = z.string().min(1).max(120).parse(rawPassword);
    const record = this.useMongo ? (mongoose.isValidObjectId(user.id) ? await UserModel.findById(user.id).lean() : null) : this.memoryUsers.find((u) => u.id === user.id);
    const valid = await this.verifyPassword(password, record?.passwordHash ?? await this.placeholderHash());
    if (!record || !valid) throw new GraphQLError("La contraseña no es correcta.", { extensions: { code: "BAD_USER_INPUT", field: "password" } });
    if (email === record.email) throw new GraphQLError("Ese ya es tu correo de acceso.", { extensions: { code: "BAD_USER_INPUT", field: "email" } });
    this.runInBackground(() => this.deliverEmailChange(user.id, email));
    return { accepted: true, deliveryAvailable: mailService.enabled && Boolean(env.STORE_URL) };
  }

  private async deliverEmailChange(id: string, email: string) {
    const record = this.useMongo ? await UserModel.findById(id).lean() : this.memoryUsers.find((u) => u.id === id);
    if (!record || record.status !== "ACTIVE" || recent(record.emailChangeRequestedAt)) return;
    await this.patchUser(record, { emailChangeRequestedAt: new Date() });
    if (await this.findByEmail(email)) { await mailService.sendAccountExists(email, env.STORE_URL ?? ""); return; }
    const token = newToken();
    await this.patchUser(record, { pendingEmail: email, emailChangeHash: hashToken(token), emailChangeExpiresAt: new Date(Date.now() + EMAIL_CHANGE_MS) });
    await mailService.sendEmailChange(email, storeLink("cambio-correo", token));
    await mailService.sendEmailChangeRequested(record.email, maskEmail(email));
  }

  /**
   * Aplica el cambio de correo. El índice único decide si otro alta ganó el correo mientras tanto. Se cierran
   * todas las sesiones (el token lleva el correo) y se anulan enlaces de recuperación y verificación previos.
   * Los pedidos siguen siendo de la misma cuenta: no se mueven ni se vinculan otros.
   */
  async confirmEmailChange(token: string) {
    if (!customerAccountsEnabled()) throw new GraphQLError(accountsOffMessage, { extensions: { code: "FORBIDDEN" } });
    if (!z.string().min(30).max(100).safeParse(token).success) throw linkError();
    const hash = hashToken(token);
    const inUse = () => new GraphQLError("Ese correo ya está en uso por otra cuenta. Tu correo de acceso no cambió.", { extensions: { code: "BAD_USER_INPUT", field: "email" } });
    const clear = { pendingEmail: 1, emailChangeHash: 1, emailChangeExpiresAt: 1, resetHash: 1, resetExpiresAt: 1, verifyHash: 1, verifyExpiresAt: 1 } as const;
    let previous = "", next = "";
    if (this.useMongo) {
      const holder = await UserModel.findOne({ emailChangeHash: hash, emailChangeExpiresAt: { $gt: new Date() }, status: "ACTIVE", role: "CUSTOMER" }).lean();
      if (!holder?.pendingEmail) throw linkError();
      previous = holder.email; next = holder.pendingEmail;
      try {
        const result = await UserModel.updateOne({ _id: holder._id, emailChangeHash: hash }, { $set: { email: next, emailVerifiedAt: new Date(), sessions: [] }, $inc: { sessionVersion: 1 }, $unset: clear });
        if (!result.modifiedCount) throw linkError();
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        await UserModel.updateOne({ _id: holder._id }, { $unset: { pendingEmail: 1, emailChangeHash: 1, emailChangeExpiresAt: 1 } });
        throw inUse();
      }
    } else {
      const user = this.memoryUsers.find((u) => u.emailChangeHash === hash && u.emailChangeExpiresAt && u.emailChangeExpiresAt > new Date() && u.status === "ACTIVE" && u.role === "CUSTOMER");
      if (!user?.pendingEmail) throw linkError();
      previous = user.email; next = user.pendingEmail;
      if (this.memoryUsers.some((u) => u !== user && u.email === next)) { delete user.pendingEmail; delete user.emailChangeHash; delete user.emailChangeExpiresAt; throw inUse(); }
      Object.assign(user, { email: next, emailVerifiedAt: new Date(), sessions: [], sessionVersion: (user.sessionVersion ?? 0) + 1 });
      for (const key of Object.keys(clear)) delete (user as Record<string, unknown>)[key];
    }
    this.runInBackground(() => mailService.sendEmailChanged(previous, maskEmail(next)));
    return true;
  }

  /** Alta de la cuenta base; Administración la usa para el personal aunque las cuentas de clientes estén retiradas. */
  private async createAccount(raw: unknown) {
    const input = registerSchema.parse(raw);
    const problem = passwordProblem(input.password, { email: input.email, name: input.name });
    if (problem) throw badPassword(problem);
    if (this.useMongo) {
      const exists = await UserModel.exists({ email: input.email });
      if (exists) throw new GraphQLError("Ya existe una cuenta con ese correo", { extensions: { code: "BAD_USER_INPUT" } });
      const created = await UserModel.create({ name: input.name, email: input.email, passwordHash: await this.hashPassword(input.password), role: "CUSTOMER", status: "ACTIVE" });
      const user = toPublicUser(created);
      return { token: await this.issueToken(user), user };
    }
    if (this.memoryUsers.some((user) => user.email === input.email)) throw new GraphQLError("Ya existe una cuenta con ese correo", { extensions: { code: "BAD_USER_INPUT" } });
    const user: MemoryUser = { id: `user-${crypto.randomUUID()}`, name: input.name, email: input.email, passwordHash: await this.hashPassword(input.password), role: "CUSTOMER", status: "ACTIVE", createdAt: new Date(), lastLoginAt: null };
    this.memoryUsers.push(user);
    return { token: await this.issueToken(user), user: toPublicUser(user) };
  }

  async login(raw: unknown) {
    const input = loginSchema.parse(raw);
    const user = this.useMongo
      ? await UserModel.findOne({ email: input.email })
      : this.memoryUsers.find((candidate) => candidate.email === input.email);
    // Siempre se calcula scrypt, también si la cuenta no existe o está bloqueada (C60, S07).
    const valid = await this.verifyPassword(input.password, user?.passwordHash ?? await this.placeholderHash());
    // CU11: solo con la contraseña correcta se explica un bloqueo por cancelaciones; si no, el error de siempre.
    if (user && valid && user.status === "BLOCKED" && user.blockedReason === "CANCELLATIONS") throw new GraphQLError(blockedMessage, { extensions: { code: "ACCOUNT_BLOCKED" } });
    if (!user || user.status !== "ACTIVE" || !valid) {
      throw new GraphQLError("Correo o contraseña incorrectos", { extensions: { code: "UNAUTHENTICATED" } });
    }
    if (user.role === "CUSTOMER" && !customerAccountsEnabled()) throw new GraphQLError(accountsOffMessage, { extensions: { code: "FORBIDDEN" } });
    // CU04: con la contraseña correcta, una cuenta de cliente sin confirmar (también las anteriores a la
    // verificación) recibe un enlace nuevo; así se regulariza sin quedar bloqueada.
    if (user.role === "CUSTOMER" && !user.emailVerifiedAt) {
      this.runInBackground(() => this.deliverVerification(user.email));
      throw new GraphQLError(`Confirma tu correo para entrar. Te enviamos un enlace a ${user.email}.`, { extensions: { code: "EMAIL_NOT_VERIFIED" } });
    }
    if (user.totpEnabled) await this.checkSecondFactor(user as TwoFactorFields, input.code ?? "");
    user.lastLoginAt = new Date();
    if (this.needsRehash(user.passwordHash)) user.passwordHash = await this.hashPassword(input.password);
    if (this.useMongo && "save" in user) await user.save();
    const publicUser = toPublicUser(user);
    return { token: await this.issueToken({ ...publicUser, sessionVersion: user.sessionVersion }), user: publicUser };
  }

  /**
   * Segundo factor en el acceso (C69). Sin código: MFA_REQUIRED (la contraseña ya fue correcta).
   * Código de 6 dígitos: TOTP de la aplicación, una sola vez por paso de 30 s. XXXX-XXXX: código
   * de recuperación, que se consume. Un código incorrecto cuenta como acceso fallido.
   */
  private async checkSecondFactor(user: TwoFactorFields, code: string) {
    if (!code) throw new GraphQLError("Escribe el código de 6 dígitos de tu aplicación de verificación.", { extensions: { code: "MFA_REQUIRED" } });
    const wrong = () => new GraphQLError("Código de verificación incorrecto o ya usado.", { extensions: { code: "UNAUTHENTICATED" } });
    if (/^\d{6}$/.test(code)) {
      const step = user.totpSecret ? verifyTotp(decryptSecret(user.totpSecret, this.secret), code, user.totpLastStep ?? -1) : null;
      if (step === null) throw wrong();
      user.totpLastStep = step;
      return;
    }
    const hash = hashRecoveryCode(code);
    if (!user.totpRecovery?.includes(hash)) throw wrong();
    user.totpRecovery = user.totpRecovery.filter((item) => item !== hash);
  }

  private async twoFactorRecord(id: string) {
    if (this.useMongo) return mongoose.isValidObjectId(id) ? UserModel.findById(id) : null;
    return this.memoryUsers.find((user) => user.id === id) ?? null;
  }
  private async saveTwoFactor(id: string, patch: TwoFactorFields & { sessions?: [] }, bumpSessions = false) {
    if (this.useMongo) await UserModel.updateOne({ _id: id }, { $set: patch, ...(bumpSessions ? { $inc: { sessionVersion: 1 } } : {}) });
    else { const user = this.memoryUsers.find((candidate) => candidate.id === id); if (user) { Object.assign(user, patch); if (bumpSessions) user.sessionVersion = (user.sessionVersion ?? 0) + 1; } }
  }
  private requireStaffAccount(actor: AuthUser | null | undefined) {
    const current = this.requireUser(actor);
    if (current.role === "CUSTOMER") throw new GraphQLError("El segundo factor es para las cuentas del personal.", { extensions: { code: "FORBIDDEN" } });
    return current;
  }

  /**
   * Cambio del segundo factor con una condición sobre el estado leído (D02): si otra petición lo
   * cambió entretanto, no escribe y devuelve false. Cierra las demás sesiones de la cuenta y deja
   * solo la actual, porque pudieron abrirse con otro factor o sin ninguno.
   */
  private async changeTwoFactor(actor: AuthUser, expected: TwoFactorFields, patch: TwoFactorFields) {
    const keep = <T extends { id?: string | null }>(sessions?: T[] | null) => (sessions ?? []).filter((s) => actor.sessionId && s.id === actor.sessionId);
    if (this.useMongo) {
      const current = await UserModel.findOne({ _id: actor.id, totpEnabled: expected.totpEnabled ? true : { $ne: true }, totpPending: expected.totpPending ?? null, totpSecret: expected.totpSecret ?? null }).select("sessions").lean();
      if (!current) return false;
      const result = await UserModel.updateOne({ _id: actor.id, totpEnabled: expected.totpEnabled ? true : { $ne: true }, totpPending: expected.totpPending ?? null, totpSecret: expected.totpSecret ?? null }, { $set: { ...patch, sessions: keep(current.sessions) } });
      return result.modifiedCount === 1;
    }
    const user = this.memoryUsers.find((candidate) => candidate.id === actor.id);
    if (!user || Boolean(user.totpEnabled) !== Boolean(expected.totpEnabled) || (user.totpPending ?? null) !== (expected.totpPending ?? null) || (user.totpSecret ?? null) !== (expected.totpSecret ?? null)) return false;
    Object.assign(user, patch, { sessions: keep(user.sessions) });
    return true;
  }
  private twoFactorChanged() {
    return new GraphQLError("La verificación en dos pasos cambió mientras tanto. Recarga la página y vuelve a intentarlo.", { extensions: { code: "CONFLICT" } });
  }

  /**
   * Empieza el alta: secreto nuevo (pendiente hasta confirmarlo con un código). Con el segundo
   * factor ya activo no se puede empezar otra alta: una sesión sola no basta para sustituirlo
   * (D02). Para cambiar de teléfono, se desactiva con un código y se vuelve a activar.
   */
  async startTwoFactor(actorRaw: AuthUser | null | undefined) {
    const actor = this.requireStaffAccount(actorRaw);
    const record = await this.twoFactorRecord(actor.id) as TwoFactorFields | null;
    if (record?.totpEnabled) throw new GraphQLError("La verificación en dos pasos ya está activa. Para cambiar de teléfono, desactívala con un código y vuelve a activarla.", { extensions: { code: "BAD_USER_INPUT" } });
    const secret = newTotpSecret();
    await this.saveTwoFactor(actor.id, { totpPending: encryptSecret(secret, this.secret) });
    return { secret, otpauthUrl: otpauthUrl(env.STORE_NAME, actor.email, secret) };
  }

  /** Confirma el alta con un código de la aplicación y entrega 8 códigos de recuperación (una sola vez). */
  async confirmTwoFactor(actorRaw: AuthUser | null | undefined, code: string) {
    const actor = this.requireStaffAccount(actorRaw);
    const record = await this.twoFactorRecord(actor.id) as TwoFactorFields | null;
    if (record?.totpEnabled) throw new GraphQLError("La verificación en dos pasos ya está activa.", { extensions: { code: "BAD_USER_INPUT" } });
    if (!record?.totpPending) throw new GraphQLError("Primero genera el código para la aplicación.", { extensions: { code: "BAD_USER_INPUT" } });
    const pending = record.totpPending;
    const secret = decryptSecret(pending, this.secret);
    const step = verifyTotp(secret, code.trim());
    if (step === null) throw new GraphQLError("El código no coincide. Revisa la hora del teléfono y escribe el código actual.", { extensions: { code: "BAD_USER_INPUT", field: "code" } });
    const recoveryCodes = newRecoveryCodes();
    // Dos confirmaciones simultáneas: solo la primera encuentra el mismo secreto pendiente.
    const changed = await this.changeTwoFactor(actor, { totpEnabled: false, totpPending: pending, totpSecret: record.totpSecret ?? null }, { totpEnabled: true, totpSecret: pending, totpPending: null, totpLastStep: step, totpRecovery: recoveryCodes.map(hashRecoveryCode) });
    if (!changed) throw this.twoFactorChanged();
    return { recoveryCodes };
  }

  /** Desactiva el segundo factor de la propia cuenta con un código válido (de la aplicación o de recuperación). */
  async disableTwoFactor(actorRaw: AuthUser | null | undefined, code: string) {
    const actor = this.requireStaffAccount(actorRaw);
    const record = await this.twoFactorRecord(actor.id) as TwoFactorFields | null;
    if (!record?.totpEnabled) return true;
    const expected = { totpEnabled: true, totpPending: record.totpPending ?? null, totpSecret: record.totpSecret ?? null };
    await this.checkSecondFactor(record, code.trim());
    const changed = await this.changeTwoFactor(actor, expected, { totpEnabled: false, totpSecret: null, totpPending: null, totpLastStep: -1, totpRecovery: [] });
    if (!changed) throw this.twoFactorChanged();
    return true;
  }

  /** Administración quita el segundo factor de otra cuenta (teléfono perdido) y cierra sus sesiones. */
  async resetTwoFactor(actorRaw: AuthUser | null | undefined, id: string) {
    const actor = this.requireAdmin(actorRaw);
    if (actor.id === id) throw new GraphQLError("Para tu propia cuenta usa «Desactivar» con un código o un código de recuperación.", { extensions: { code: "BAD_USER_INPUT" } });
    if (!(await this.findUser(id))) throw new GraphQLError("Usuario no encontrado", { extensions: { code: "BAD_USER_INPUT" } });
    await this.saveTwoFactor(id, { totpEnabled: false, totpSecret: null, totpPending: null, totpLastStep: -1, totpRecovery: [], sessions: [] }, true);
    return true;
  }

  async me(authHeader?: string | null) {
    const user = await this.sessionUser(authHeader);
    // Una sesión de cliente abierta antes de retirar las cuentas deja de valer; la persona sigue comprando como invitada.
    return user && user.role === "CUSTOMER" && !customerAccountsEnabled() ? null : user;
  }

  private async sessionUser(authHeader?: string | null) {
    const token = this.verifyToken(authHeader);
    if (!token) return null;
    if (this.useMongo && mongoose.isValidObjectId(token.sub)) {
      const user = await UserModel.findById(token.sub).lean();
      // CU04: una sesión de cliente sin correo confirmado no vale (sesiones anteriores a la verificación).
      return user && user.status === "ACTIVE" && (user.role !== "CUSTOMER" || user.emailVerifiedAt) && (user.sessionVersion ?? 0) === (token.ver ?? 0) && (!token.sid || user.sessions?.some((s) => s.id === token.sid && s.expiresAt && s.expiresAt > new Date())) ? { ...toPublicUser(user), sessionId: token.sid } : null;
    }
    const user = this.memoryUsers.find((candidate) => candidate.id === token.sub && candidate.status === "ACTIVE");
    return user && (user.role !== "CUSTOMER" || user.emailVerifiedAt) && (user.sessionVersion ?? 0) === (token.ver ?? 0) && (!token.sid || user.sessions?.some((s) => s.id === token.sid && s.expiresAt > new Date())) ? { ...toPublicUser(user), sessionId: token.sid } : null;
  }

  requireUser(user: AuthUser | null | undefined) {
    if (!user) throw new GraphQLError("Debes iniciar sesión", { extensions: { code: "UNAUTHENTICATED" } });
    return user;
  }

  requirePermission(user: AuthUser | null | undefined, permission: Permission) {
    const current = this.requireUser(user);
    if (mfaSetupPending(current)) throw mfaSetupError();
    if (!permissions[current.role].includes(permission)) throw new GraphQLError("No tienes permiso para esta función", { extensions: { code: "FORBIDDEN" } });
    return current;
  }

  requireStaff(user: AuthUser | null | undefined) {
    const current = this.requireUser(user);
    if (mfaSetupPending(current)) throw mfaSetupError();
    if (current.role === "CUSTOMER") throw new GraphQLError("No tienes acceso al panel", { extensions: { code: "FORBIDDEN" } });
    return current;
  }

  /**
   * CU11: suma una cancelación directa del cliente. Al llegar al límite la cuenta queda bloqueada en la misma
   * transacción y se cierran sus sesiones. Se llama al final de la cancelación (en memoria no se revierte).
   */
  async recordCustomerCancellation(id: string): Promise<{ count: number; blocked: boolean }> {
    const missing = () => new GraphQLError("Cuenta no encontrada", { extensions: { code: "UNAUTHENTICATED" } });
    if (this.useMongo) {
      if (!mongoose.isValidObjectId(id)) throw missing();
      const updated = await UserModel.findOneAndUpdate({ _id: id, role: "CUSTOMER", status: "ACTIVE" }, { $inc: { customerCancellations: 1 } }, { new: true }).lean();
      if (!updated) throw missing();
      const count = updated.customerCancellations ?? 0;
      if (count < CANCELLATION_BLOCK_LIMIT) return { count, blocked: false };
      await UserModel.updateOne({ _id: id }, { $set: { status: "BLOCKED", blockedReason: "CANCELLATIONS", sessions: [] }, $inc: { sessionVersion: 1 } });
      return { count, blocked: true };
    }
    const user = this.memoryUsers.find((candidate) => candidate.id === id && candidate.role === "CUSTOMER" && candidate.status === "ACTIVE");
    if (!user) throw missing();
    user.customerCancellations = (user.customerCancellations ?? 0) + 1;
    if (user.customerCancellations < CANCELLATION_BLOCK_LIMIT) return { count: user.customerCancellations, blocked: false };
    Object.assign(user, { status: "BLOCKED", blockedReason: "CANCELLATIONS", sessions: [], sessionVersion: (user.sessionVersion ?? 0) + 1 });
    return { count: user.customerCancellations, blocked: true };
  }

  /** CU11: un pedido pagado o completado de la cuenta reinicia las cancelaciones seguidas. */
  async resetCustomerCancellations(id: string) {
    if (this.useMongo) { if (mongoose.isValidObjectId(id)) await UserModel.updateOne({ _id: id, customerCancellations: { $gt: 0 } }, { $set: { customerCancellations: 0 } }); return; }
    const user = this.memoryUsers.find((candidate) => candidate.id === id);
    if (user) user.customerCancellations = 0;
  }

  async customerCancellations(id: string) {
    const user = this.useMongo ? (mongoose.isValidObjectId(id) ? await UserModel.findById(id).select("customerCancellations").lean() : null) : this.memoryUsers.find((candidate) => candidate.id === id);
    return user?.customerCancellations ?? 0;
  }

  /** CU03: secciones privadas de la tienda. El personal no tiene perfil de cliente. */
  requireCustomer(user: AuthUser | null | undefined) {
    const current = this.requireUser(user);
    if (current.role !== "CUSTOMER") throw new GraphQLError("Esta sección es para cuentas de cliente", { extensions: { code: "FORBIDDEN" } });
    return current;
  }

  /**
   * CU03: `User.name` es el nombre personal canónico. Se llama dentro de la transacción del perfil;
   * en memoria (demostración) los usuarios no se revierten, por eso el perfil lo llama al final.
   */
  async renameCustomer(id: string, name: string) {
    const missing = () => new GraphQLError("Cuenta no encontrada", { extensions: { code: "UNAUTHENTICATED" } });
    if (this.useMongo) {
      if (!mongoose.isValidObjectId(id)) throw missing();
      const result = await UserModel.updateOne({ _id: id, role: "CUSTOMER", status: "ACTIVE" }, { $set: { name } });
      if (!result.matchedCount) throw missing();
      return;
    }
    const user = this.memoryUsers.find((candidate) => candidate.id === id && candidate.role === "CUSTOMER" && candidate.status === "ACTIVE");
    if (!user) throw missing();
    user.name = name;
  }

  requireAdmin(user: AuthUser | null | undefined) {
    const current = this.requireUser(user);
    if (mfaSetupPending(current)) throw mfaSetupError();
    if (current.role !== "ADMIN") throw new GraphQLError("No tienes permisos de administrador", { extensions: { code: "FORBIDDEN" } });
    return current;
  }

  /** Cambia el estado de una cuenta. Un admin no puede bloquearse a si mismo. */
  async setUserStatus(actor: AuthUser, id: string, status: "ACTIVE" | "BLOCKED"): Promise<AuthUser> {
    if(!adminChange.getStore()) return this.manage(actor,()=>this.setUserStatus(actor,id,status));
    if (actor.id === id && status === "BLOCKED") {
      throw new GraphQLError("No puedes bloquear tu propia cuenta", { extensions: { code: "BAD_USER_INPUT" } });
    }
    const target = await this.findUser(id);
    if (status === "BLOCKED" && target?.role === "ADMIN" && target.status === "ACTIVE" && await this.countActiveAdmins() <= 1) throw new Error("Debe quedar un administrador activo");
    const updated = await this.updateUser(id, { status });
    if (status === "ACTIVE") await this.clearCancellationBlock(id);
    return updated;
  }

  /**
   * CU11/CU14: el desbloqueo manual levanta también el bloqueo por identidad y reinicia el contador. Se aplica
   * desde «Usuarios y permisos» (`saveAccount`) y desde `setUserStatus`.
   */
  private async clearCancellationBlock(id: string) {
    if (this.useMongo) await UserModel.updateOne({ _id: id }, { $set: { customerCancellations: 0, blockedReason: null } });
    else { const user = this.memoryUsers.find((candidate) => candidate.id === id); if (user) Object.assign(user, { customerCancellations: 0, blockedReason: null }); }
    await blockedIdentities.removeFor(id);
  }

  /**
   * Cambia el rol de una cuenta. Un admin no puede quitarse el rol a si mismo, y
   * no se puede degradar al ultimo admin activo: dejaria el panel sin acceso.
   */
  async setUserRole(actor: AuthUser, id: string, role: AuthRole): Promise<AuthUser> {
    if(!adminChange.getStore()) return this.manage(actor,()=>this.setUserRole(actor,id,role));
    if (actor.id === id && role !== "ADMIN") {
      throw new GraphQLError("No puedes quitarte el rol de administrador", { extensions: { code: "BAD_USER_INPUT" } });
    }
    if (isStaffRole(role) && (await this.findUser(id))?.role === "CUSTOMER") throw badPassword("Para dar acceso al panel a una cuenta de cliente, edítala y asígnale una contraseña nueva de al menos 12 caracteres.");
    if (role !== "ADMIN") {
      const admins = await this.countActiveAdmins();
      const target = await this.findUser(id);
      if (target && target.role === "ADMIN" && admins <= 1) {
        throw new GraphQLError("Debe quedar al menos un administrador activo", { extensions: { code: "BAD_USER_INPUT" } });
      }
    }
    return this.updateUser(id, { role });
  }

  private async countActiveAdmins() {
    if (this.useMongo) return UserModel.countDocuments({ role: "ADMIN", status: "ACTIVE" });
    return this.memoryUsers.filter((user) => user.role === "ADMIN" && user.status === "ACTIVE").length;
  }

  async findUser(id: string) {
    if (this.useMongo) {
      if (!mongoose.isValidObjectId(id)) return null;
      const found = await UserModel.findById(id).lean();
      return found ? toPublicUser(found) : null;
    }
    const found = this.memoryUsers.find((user) => user.id === id);
    return found ? toPublicUser(found) : null;
  }

  private async updateUser(id: string, patch: { status?: "ACTIVE" | "BLOCKED"; role?: AuthRole }) {
    if (this.useMongo) {
      if (!mongoose.isValidObjectId(id)) throw new GraphQLError("Usuario no encontrado", { extensions: { code: "BAD_USER_INPUT" } });
      const updated = await UserModel.findByIdAndUpdate(id, { $set: { ...patch, sessions: [] }, $inc: { sessionVersion: 1 }, $unset: { resetHash: 1, resetExpiresAt: 1 } }, { new: true }).lean();
      if (!updated) throw new GraphQLError("Usuario no encontrado", { extensions: { code: "BAD_USER_INPUT" } });
      return toPublicUser(updated);
    }
    const user = this.memoryUsers.find((candidate) => candidate.id === id);
    if (!user) throw new GraphQLError("Usuario no encontrado", { extensions: { code: "BAD_USER_INPUT" } });
    user.sessionVersion = (user.sessionVersion ?? 0) + 1; user.sessions = []; delete user.resetHash; delete user.resetExpiresAt;
    if (patch.status) user.status = patch.status;
    if (patch.role) user.role = patch.role;
    return toPublicUser(user);
  }

  /** Totales reales de cuentas para el resumen del panel. */
  async stats() {
    if (this.useMongo) {
      const [customers, admins, blocked] = await Promise.all([
        UserModel.countDocuments({ role: "CUSTOMER" }),
        UserModel.countDocuments({ role: "ADMIN" }),
        UserModel.countDocuments({ status: "BLOCKED" })
      ]);
      return { customers, admins, blocked };
    }
    return {
      customers: this.memoryUsers.filter((user) => user.role === "CUSTOMER").length,
      admins: this.memoryUsers.filter((user) => user.role === "ADMIN").length,
      blocked: this.memoryUsers.filter((user) => user.status === "BLOCKED").length
    };
  }

  async saveAccount(actor: AuthUser, id: string | undefined, raw: unknown): Promise<AuthUser> {
    if(!adminChange.getStore()) return this.manage(actor,()=>this.saveAccount(actor,id,raw));
    const input = registerSchema.omit({ password: true }).extend({ password: z.string().min(8).max(120).optional(), role: z.enum(["CUSTOMER", "CATALOG", "WAREHOUSE", "MANAGER", "STORE_MANAGER", "ADMIN"]), status: z.enum(["ACTIVE", "BLOCKED"]) }).strict().parse(raw);
    const problem = input.password ? passwordProblem(input.password, { staff: isStaffRole(input.role), email: input.email, name: input.name }) : null;
    if (problem) throw badPassword(problem);
    if (!id) {
      if (!input.password) throw new Error("La contraseña es obligatoria para crear una cuenta");
      if (input.role === "CUSTOMER" && !customerAccountsEnabled()) throw new Error("Las cuentas de cliente están retiradas; crea solo cuentas del personal.");
      const created = await this.createAccount({ name: input.name, email: input.email, password: input.password });
      return this.updateUser(created.user.id, { role: input.role, status: input.status });
    }
    const target = await this.findUser(id);
    if (!target) throw new Error("Usuario no encontrado");
    // Una cuenta de cliente pudo crearse con 8 caracteres: al darle acceso al panel se le pone una contraseña del personal.
    if (target.role === "CUSTOMER" && isStaffRole(input.role) && !input.password) throw badPassword("Para dar acceso al panel, asigna una contraseña nueva de al menos 12 caracteres.");
    if (actor.id === id && (input.role !== "ADMIN" || input.status !== "ACTIVE")) throw new Error("No puedes quitar tu propio acceso");
    if (target.role === "ADMIN" && target.status === "ACTIVE" && (input.role !== "ADMIN" || input.status !== "ACTIVE") && await this.countActiveAdmins() <= 1) throw new Error("Debe quedar un administrador activo");
    const patch = { name: input.name, email: input.email, role: input.role, status: input.status, ...(input.password ? { passwordHash: await this.hashPassword(input.password) } : {}) };
    if (this.useMongo) {
      if (await UserModel.exists({ email: input.email, _id: { $ne: id } })) throw new Error("Ya existe una cuenta con ese correo");
      const updated = await UserModel.findByIdAndUpdate(id, { $set: { ...patch, sessions: [] }, $inc: { sessionVersion: 1 }, $unset: { resetHash: 1, resetExpiresAt: 1 } }, { new: true, runValidators: true }).lean();
      if (!updated) throw new Error("Usuario no encontrado");
      if (target.status === "BLOCKED" && input.status === "ACTIVE") await this.clearCancellationBlock(id);
      return toPublicUser(updated);
    }
    if (this.memoryUsers.some((u) => u.id !== id && u.email === input.email)) throw new Error("Ya existe una cuenta con ese correo");
    const user = this.memoryUsers.find((u) => u.id === id)!;
    Object.assign(user, patch, { sessions: [], sessionVersion: (user.sessionVersion ?? 0) + 1 }); delete user.resetHash; delete user.resetExpiresAt;
    if (target.status === "BLOCKED" && input.status === "ACTIVE") await this.clearCancellationBlock(id);
    return toPublicUser(user);
  }

  async listAccounts(raw: unknown = {}) {
    const f = z.object({ search: z.string().max(120).default(""), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(30) }).parse(raw);
    if (this.useMongo) {
      const pattern = new RegExp(f.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const query = f.search ? { $or: [{ name: pattern }, { email: pattern }] } : {};
      const [rows, total] = await Promise.all([UserModel.find(query).select("-passwordHash -sessionVersion").sort({ createdAt: -1, _id: -1 }).skip(f.offset).limit(f.limit).lean(), UserModel.countDocuments(query)]);
      return { rows: rows.map(toPublicUser), total };
    }
    const rows = this.memoryUsers.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(f.search.toLowerCase()));
    return { rows: rows.slice(f.offset, f.offset + f.limit).map(toPublicUser), total: rows.length };
  }

  async users(role?: AuthRole) {
    if (this.useMongo) {
      const query = role ? { role } : {};
      const users = await UserModel.find(query).sort({ createdAt: -1 }).limit(200).lean();
      return users.map(toPublicUser);
    }
    return this.memoryUsers.filter((user) => !role || user.role === role).map(toPublicUser);
  }
}

export const authService = new AuthService();
