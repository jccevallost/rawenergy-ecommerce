import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { GraphQLError } from "graphql";
import mongoose from "mongoose";
import { z } from "zod";
import { env } from "../config/env.js";
import { UserModel } from "../models/User.js";

import { permissions, type Permission, type Role } from "./permissions.js";
import { mailService } from "./mail.service.js";
export type AuthRole = Role;
export type AuthUser = { id: string; name: string; email: string; role: AuthRole; status: "ACTIVE" | "BLOCKED"; createdAt?: Date; lastLoginAt?: Date | null; sessionId?: string };
type MemoryUser = AuthUser & { passwordHash: string; sessionVersion?: number; sessions?: Array<{ id: string; createdAt: Date; expiresAt: Date }>; resetHash?: string; resetExpiresAt?: Date; resetRequestedAt?: Date };

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(120).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(120)
});
const loginSchema = z.object({
  email: z.string().email().max(120).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(120)
});
const tokenPayloadSchema = z.object({ sub: z.string(), email: z.string().email(), role: z.enum(["CUSTOMER", "CATALOG", "WAREHOUSE", "MANAGER", "ADMIN"]), exp: z.number(), ver: z.number().int().optional(), sid: z.string().optional() });

const toPublicUser = (user: { _id?: unknown; id?: unknown; name: string; email: string; role: AuthRole; status: "ACTIVE" | "BLOCKED"; createdAt?: Date; lastLoginAt?: Date | null }): AuthUser => ({
  id: String(user._id ?? user.id),
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt ?? null
});

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
  private useMongo = false;
  private memoryUsers: MemoryUser[] = [];
  private secret = env.authTokenSecret;

  setPersistence(useMongo: boolean) {
    this.useMongo = useMongo;
  }

  async bootstrapAdmin() {
    const email = env.adminEmail;
    const password = env.adminPassword;
    const name = env.adminName;
    if (this.useMongo) {
      const exists = await UserModel.exists({ email });
      if (!exists) await UserModel.create({ name, email, passwordHash: await this.hashPassword(password), role: "ADMIN", status: "ACTIVE" });
      return;
    }
    if (!this.memoryUsers.some((user) => user.email === email)) {
      this.memoryUsers.push({ id: "admin-dev", name, email, passwordHash: await this.hashPassword(password), role: "ADMIN", status: "ACTIVE", createdAt: new Date(), lastLoginAt: null });
    }
  }

  async hashPassword(password: string) {
    const salt = crypto.randomBytes(16).toString("base64url");
    const key = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, 64, (error, derivedKey) => error ? reject(error) : resolve(derivedKey));
    });
    return `scrypt:${salt}:${key.toString("base64url")}`;
  }

  async verifyPassword(password: string, passwordHash: string) {
    const [, salt, stored] = passwordHash.split(":");
    if (!salt || !stored) return false;
    const key = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, 64, (error, derivedKey) => error ? reject(error) : resolve(derivedKey));
    });
    const storedBuffer = Buffer.from(stored, "base64url");
    if (storedBuffer.length !== key.length) return false;
    return crypto.timingSafeEqual(storedBuffer, key);
  }

  signToken(user: AuthUser & { sessionVersion?: number }) {
    const header = encode({ alg: "HS256", typ: "JWT" });
    const payload = encode({ sub: user.id, sid: user.sessionId, ver: user.sessionVersion ?? 0, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 });
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
    const session = { id: crypto.randomUUID(), createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400000) };
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
    const user = this.useMongo ? await UserModel.findOne({ email: normalized }) : this.memoryUsers.find((u) => u.email === normalized);
    const reply = { accepted: true, deliveryAvailable: mailService.enabled && Boolean(env.ADMIN_APP_URL) };
    if (!reply.deliveryAvailable || !user || user.status !== "ACTIVE" || user.resetRequestedAt && Date.now() - user.resetRequestedAt.getTime() < 60000) return reply;
    const token = crypto.randomBytes(32).toString("base64url");
    const patch = { resetHash: crypto.createHash("sha256").update(token).digest("hex"), resetExpiresAt: new Date(Date.now() + 30 * 60000), resetRequestedAt: new Date() };
    if (this.useMongo) await UserModel.updateOne({ _id: (user as { _id?: unknown })._id }, { $set: patch }); else Object.assign(user, patch);
    await mailService.sendPasswordReset(user.email, `${env.ADMIN_APP_URL?.replace(/\/$/, "")}/#reset=${encodeURIComponent(token)}`);
    return reply;
  }

  async resetPassword(token: string, password: string) {
    z.string().min(30).max(100).parse(token); z.string().min(8).max(120).parse(password);
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const passwordHash = await this.hashPassword(password);
    if (this.useMongo) {
      const result = await UserModel.updateOne({ resetHash: hash, resetExpiresAt: { $gt: new Date() }, status: "ACTIVE" }, { $set: { passwordHash, sessions: [] }, $inc: { sessionVersion: 1 }, $unset: { resetHash: 1, resetExpiresAt: 1 } });
      if (!result.modifiedCount) throw new Error("El enlace no es válido o ya venció");
    } else {
      const user = this.memoryUsers.find((u) => u.resetHash === hash && u.resetExpiresAt && u.resetExpiresAt > new Date() && u.status === "ACTIVE");
      if (!user) throw new Error("El enlace no es válido o ya venció");
      Object.assign(user, { passwordHash, sessions: [], sessionVersion: (user.sessionVersion ?? 0) + 1 }); delete user.resetHash; delete user.resetExpiresAt;
    }
    return true;
  }

  async register(raw: unknown) {
    const input = registerSchema.parse(raw);
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
    if (!user || user.status !== "ACTIVE" || !(await this.verifyPassword(input.password, user.passwordHash))) {
      throw new GraphQLError("Correo o contraseña incorrectos", { extensions: { code: "UNAUTHENTICATED" } });
    }
    user.lastLoginAt = new Date();
    if (this.useMongo && "save" in user) await user.save();
    const publicUser = toPublicUser(user);
    return { token: await this.issueToken({ ...publicUser, sessionVersion: user.sessionVersion }), user: publicUser };
  }

  async me(authHeader?: string | null) {
    const token = this.verifyToken(authHeader);
    if (!token) return null;
    if (this.useMongo && mongoose.isValidObjectId(token.sub)) {
      const user = await UserModel.findById(token.sub).lean();
      return user && user.status === "ACTIVE" && (user.sessionVersion ?? 0) === (token.ver ?? 0) && (!token.sid || user.sessions?.some((s) => s.id === token.sid && s.expiresAt && s.expiresAt > new Date())) ? { ...toPublicUser(user), sessionId: token.sid } : null;
    }
    const user = this.memoryUsers.find((candidate) => candidate.id === token.sub && candidate.status === "ACTIVE");
    return user && (user.sessionVersion ?? 0) === (token.ver ?? 0) && (!token.sid || user.sessions?.some((s) => s.id === token.sid && s.expiresAt > new Date())) ? { ...toPublicUser(user), sessionId: token.sid } : null;
  }

  requireUser(user: AuthUser | null | undefined) {
    if (!user) throw new GraphQLError("Debes iniciar sesión", { extensions: { code: "UNAUTHENTICATED" } });
    return user;
  }

  requirePermission(user: AuthUser | null | undefined, permission: Permission) {
    const current = this.requireUser(user);
    if (!permissions[current.role].includes(permission)) throw new GraphQLError("No tienes permiso para esta función", { extensions: { code: "FORBIDDEN" } });
    return current;
  }

  requireStaff(user: AuthUser | null | undefined) {
    const current = this.requireUser(user);
    if (current.role === "CUSTOMER") throw new GraphQLError("No tienes acceso al panel", { extensions: { code: "FORBIDDEN" } });
    return current;
  }

  requireAdmin(user: AuthUser | null | undefined) {
    const current = this.requireUser(user);
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
    return this.updateUser(id, { status });
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
    const input = registerSchema.omit({ password: true }).extend({ password: z.string().min(8).max(120).optional(), role: z.enum(["CUSTOMER", "CATALOG", "WAREHOUSE", "MANAGER", "ADMIN"]), status: z.enum(["ACTIVE", "BLOCKED"]) }).strict().parse(raw);
    if (!id) {
      if (!input.password) throw new Error("La contraseña es obligatoria para crear una cuenta");
      const created = await this.register({ name: input.name, email: input.email, password: input.password });
      return this.updateUser(created.user.id, { role: input.role, status: input.status });
    }
    const target = await this.findUser(id);
    if (!target) throw new Error("Usuario no encontrado");
    if (actor.id === id && (input.role !== "ADMIN" || input.status !== "ACTIVE")) throw new Error("No puedes quitar tu propio acceso");
    if (target.role === "ADMIN" && target.status === "ACTIVE" && (input.role !== "ADMIN" || input.status !== "ACTIVE") && await this.countActiveAdmins() <= 1) throw new Error("Debe quedar un administrador activo");
    const patch = { name: input.name, email: input.email, role: input.role, status: input.status, ...(input.password ? { passwordHash: await this.hashPassword(input.password) } : {}) };
    if (this.useMongo) {
      if (await UserModel.exists({ email: input.email, _id: { $ne: id } })) throw new Error("Ya existe una cuenta con ese correo");
      const updated = await UserModel.findByIdAndUpdate(id, { $set: { ...patch, sessions: [] }, $inc: { sessionVersion: 1 }, $unset: { resetHash: 1, resetExpiresAt: 1 } }, { new: true, runValidators: true }).lean();
      if (!updated) throw new Error("Usuario no encontrado");
      return toPublicUser(updated);
    }
    if (this.memoryUsers.some((u) => u.id !== id && u.email === input.email)) throw new Error("Ya existe una cuenta con ese correo");
    const user = this.memoryUsers.find((u) => u.id === id)!;
    Object.assign(user, patch, { sessions: [], sessionVersion: (user.sessionVersion ?? 0) + 1 }); delete user.resetHash; delete user.resetExpiresAt;
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
