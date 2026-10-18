import { randomUUID } from "node:crypto";
import { ApolloServer } from "@apollo/server";
import { describe, expect, it } from "vitest";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { authService, type AuthUser } from "./auth.service.js";
import { MAX_CUSTOMER_ADDRESSES } from "../validation/customerProfile.js";

// CU03: perfil y libreta de direcciones (plan de cuenta, §5 y §12 «Datos» y «Direcciones»).
const server = new ApolloServer({ typeDefs, resolvers });
const FIELDS = "name email phone altPhone revision complete missing defaultAddressId maxAddresses billing { name idType idNumber email } addresses { id label city address recipientName recipientPhone isDefault }";
const PROFILE = `query { myProfile { ${FIELDS} } }`;
const CONTACT = `mutation($i: CustomerContactInput!, $r: Int!) { updateMyContact(input: $i, revision: $r) { ${FIELDS} } }`;
const BILLING = `mutation($i: CustomerBillingInput, $r: Int!) { updateMyBilling(input: $i, revision: $r) { ${FIELDS} } }`;
const ADD = `mutation($i: CustomerAddressInput!, $r: Int!, $d: Boolean) { addMyAddress(input: $i, revision: $r, makeDefault: $d) { addressId duplicate madeDefault profile { ${FIELDS} } } }`;
const EDIT = `mutation($id: ID!, $i: CustomerAddressInput!, $r: Int!) { updateMyAddress(id: $id, input: $i, revision: $r) { ${FIELDS} } }`;
const REMOVE = `mutation($id: ID!, $r: Int!, $n: ID) { removeMyAddress(id: $id, revision: $r, nextDefaultId: $n) { ${FIELDS} } }`;
const REMOVE_NO_NEXT = `mutation($id: ID!, $r: Int!) { removeMyAddress(id: $id, revision: $r) { ${FIELDS} } }`;
const DEFAULT = `mutation($id: ID!, $r: Int!) { setMyDefaultAddress(id: $id, revision: $r) { ${FIELDS} } }`;

type Result = { data?: Record<string, any> | null; errors?: Array<{ message: string; extensions?: { code?: string; field?: string } }> };
async function run(query: string, variables: Record<string, unknown>, user: AuthUser | null): Promise<Result> {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user: user as never, requestId: randomUUID(), ip: "198.51.100.20" } });
  if (response.body.kind !== "single") throw new Error("single");
  return response.body.singleResult as Result;
}
const customer = async (name = "Ana Pérez") => (await authService.createVerifiedCustomer({ name, email: `perfil-${randomUUID()}@example.test`, password: "Perfil-prueba-123!" })).user as AuthUser;
const home = { label: "Casa", province: "Pichincha", city: "Quito", address: "Av. Amazonas N24-100 y Colón", reference: "Edificio azul" };

describe("perfil del cliente", () => {
  it("un perfil nuevo existe vacío con revisión 0 y dice qué falta", async () => {
    const user = await customer();
    const { data, errors } = await run(PROFILE, {}, user);
    expect(errors).toBeUndefined();
    expect(data!.myProfile).toMatchObject({ name: "Ana Pérez", revision: 0, complete: false, missing: ["phone", "billing", "address"], addresses: [], maxAddresses: MAX_CUSTOMER_ADDRESSES });
  });

  it("guarda nombre Unicode y celulares normalizados, y sincroniza el nombre de la cuenta", async () => {
    const user = await customer();
    const { data, errors } = await run(CONTACT, { i: { name: "  María José O'Neil  Núñez ", phone: "+593 99 123 4567", altPhone: "098-765-4321" }, r: 0 }, user);
    expect(errors).toBeUndefined();
    expect(data!.updateMyContact).toMatchObject({ name: "María José O'Neil Núñez", phone: "0991234567", altPhone: "0987654321", revision: 1 });
    expect((await authService.findUser(user.id))?.name).toBe("María José O'Neil Núñez");
  });

  it("rechaza alternativo igual al principal tras normalizar, celulares inválidos y campos inesperados", async () => {
    const user = await customer();
    expect((await run(CONTACT, { i: { name: "Ana Pérez", phone: "0991234567", altPhone: "+593991234567" }, r: 0 }, user)).errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
    expect((await run(CONTACT, { i: { name: "Ana Pérez", phone: "12345" }, r: 0 }, user)).errors).toBeDefined();
    expect((await run(CONTACT, { i: { name: "Ana\u0000Pérez" }, r: 0 }, user)).errors).toBeDefined();
    // Un campo fuera del contrato (rol, userId) no llega ni a validarse.
    expect((await run(CONTACT, { i: { name: "Ana Pérez", role: "ADMIN" }, r: 0 }, user)).errors).toBeDefined();
    expect((await run(PROFILE, {}, user)).data!.myProfile.revision).toBe(0);
  });

  it("facturación: conserva ceros iniciales, valida el documento y se puede borrar", async () => {
    const user = await customer();
    // Dígito verificador incorrecto → rechazo; luego una cédula válida con cero inicial.
    const saved = await run(BILLING, { i: { name: "Ana Pérez", idNumber: "0926687857" }, r: 0 }, user);
    expect(saved.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
    const ok = await run(BILLING, { i: { name: "Ana Pérez", idNumber: "0926687856", email: "Factura@Correo.com" }, r: 0 }, user);
    expect(ok.errors).toBeUndefined();
    expect(ok.data!.updateMyBilling.billing).toEqual({ name: "Ana Pérez", idType: "CEDULA", idNumber: "0926687856", email: "factura@correo.com" });
    const cleared = await run(BILLING, { i: null, r: 1 }, user);
    expect(cleared.data!.updateMyBilling.billing).toBeNull();
  });

  it("la revisión obsoleta no pisa cambios de otra pestaña", async () => {
    const user = await customer();
    await run(CONTACT, { i: { name: "Ana Pérez", phone: "0991234567" }, r: 0 }, user);
    const stale = await run(CONTACT, { i: { name: "Ana Pérez", phone: "0987654321" }, r: 0 }, user);
    expect(stale.errors?.[0]?.extensions?.code).toBe("CONFLICT");
    expect((await run(PROFILE, {}, user)).data!.myProfile.phone).toBe("0991234567");
  });
});

describe("libreta de direcciones", () => {
  it("la primera dirección queda predeterminada y la cuenta queda completa con celular y factura", async () => {
    const user = await customer();
    await run(CONTACT, { i: { name: "Ana Pérez", phone: "0991234567" }, r: 0 }, user);
    await run(BILLING, { i: { name: "Ana Pérez", idNumber: "0926687856" }, r: 1 }, user);
    const { data, errors } = await run(ADD, { i: { ...home, city: "Sangolquí", province: "pichincha" }, r: 2 }, user);
    expect(errors).toBeUndefined();
    expect(data!.addMyAddress).toMatchObject({ duplicate: false, madeDefault: true });
    expect(data!.addMyAddress.profile).toMatchObject({ complete: true, missing: [], defaultAddressId: data!.addMyAddress.addressId });
    expect(data!.addMyAddress.profile.addresses[0]).toMatchObject({ city: "Rumiñahui", isDefault: true });
  });

  it("una dirección repetida (doble clic o reintento) no se duplica aunque la revisión sea vieja", async () => {
    const user = await customer();
    const first = await run(ADD, { i: home, r: 0 }, user);
    const again = await run(ADD, { i: { ...home, address: "  av. amazonas n24-100 y colón ", reference: "EDIFICIO AZUL" }, r: 0 }, user);
    expect(again.errors).toBeUndefined();
    expect(again.data!.addMyAddress).toMatchObject({ duplicate: true, addressId: first.data!.addMyAddress.addressId });
    expect(again.data!.addMyAddress.profile.addresses).toHaveLength(1);
    // Mismas calles con otro destinatario sí es otra dirección.
    const other = await run(ADD, { i: { ...home, recipientName: "Luis Pérez", recipientPhone: "0987654321" }, r: 1 }, user);
    expect(other.data!.addMyAddress).toMatchObject({ duplicate: false, madeDefault: false });
  });

  it("valida provincia y cantón, destinatario con celular y longitudes", async () => {
    const user = await customer();
    expect((await run(ADD, { i: { ...home, province: "Guayas", city: "Quito" }, r: 0 }, user)).errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
    expect((await run(ADD, { i: { ...home, recipientName: "Luis Pérez" }, r: 0 }, user)).errors).toBeDefined();
    expect((await run(ADD, { i: { ...home, address: "corta" }, r: 0 }, user)).errors).toBeDefined();
    expect((await run(ADD, { i: { ...home, label: "x".repeat(41) }, r: 0 }, user)).errors).toBeDefined();
  });

  it(`admite hasta ${MAX_CUSTOMER_ADDRESSES} direcciones`, async () => {
    const user = await customer();
    for (let i = 0; i < MAX_CUSTOMER_ADDRESSES; i++) expect((await run(ADD, { i: { ...home, address: `Calle número ${i + 1} y Principal` }, r: i }, user)).errors).toBeUndefined();
    const over = await run(ADD, { i: { ...home, address: "Calle número 99 y Principal" }, r: MAX_CUSTOMER_ADDRESSES }, user);
    expect(over.errors?.[0]?.extensions?.field).toBe("addresses");
  });

  it("borrar la predeterminada exige elegir la siguiente o ninguna; nunca se elige sola", async () => {
    const user = await customer();
    const a = (await run(ADD, { i: home, r: 0 }, user)).data!.addMyAddress.addressId;
    const b = (await run(ADD, { i: { ...home, label: "Oficina", address: "Av. República E7-123" }, r: 1 }, user)).data!.addMyAddress.addressId;
    const refused = await run(REMOVE_NO_NEXT, { id: a, r: 2 }, user);
    expect(refused.errors?.[0]?.extensions?.field).toBe("nextDefaultId");
    const none = await run(REMOVE, { id: a, r: 2, n: null }, user);
    expect(none.data!.removeMyAddress).toMatchObject({ defaultAddressId: null, missing: expect.arrayContaining(["address"]) });
    const chosen = await run(DEFAULT, { id: b, r: 3 }, user);
    expect(chosen.data!.setMyDefaultAddress.defaultAddressId).toBe(b);
    // La última dirección se puede borrar sin elegir: no queda ninguna.
    const last = await run(REMOVE_NO_NEXT, { id: b, r: 4 }, user);
    expect(last.data!.removeMyAddress).toMatchObject({ addresses: [], defaultAddressId: null });
  });

  it("editar no puede convertir una dirección en copia de otra", async () => {
    const user = await customer();
    await run(ADD, { i: home, r: 0 }, user);
    const b = (await run(ADD, { i: { ...home, label: "Oficina", address: "Av. República E7-123" }, r: 1 }, user)).data!.addMyAddress.addressId;
    expect((await run(EDIT, { id: b, i: { ...home, label: "Oficina" }, r: 2 }, user)).errors?.[0]?.extensions?.field).toBe("address");
    const edited = await run(EDIT, { id: b, i: { ...home, label: "Oficina", address: "Av. República E7-200" }, r: 2 }, user);
    expect(edited.data!.updateMyAddress.addresses.find((x: { id: string }) => x.id === b).address).toBe("Av. República E7-200");
  });
});

describe("propiedad y acceso", () => {
  it("el cliente B no puede editar, borrar ni marcar direcciones de A; la respuesta no distingue ajena de inexistente", async () => {
    const a = await customer(), b = await customer();
    const id = (await run(ADD, { i: home, r: 0 }, a)).data!.addMyAddress.addressId;
    for (const [query, vars] of [[EDIT, { id, i: home, r: 0 }], [REMOVE, { id, r: 0, n: null }], [DEFAULT, { id, r: 0 }]] as const) {
      const foreign = await run(query, vars, b);
      const missing = await run(query, { ...vars, id: randomUUID() }, b);
      expect(foreign.errors?.[0]?.message).toBe("No encontramos esa dirección en tu cuenta.");
      expect(missing.errors?.[0]?.message).toBe(foreign.errors?.[0]?.message);
    }
    expect((await run(PROFILE, {}, a)).data!.myProfile.addresses).toHaveLength(1);
    expect((await run(PROFILE, {}, b)).data!.myProfile.addresses).toHaveLength(0);
  });

  it("sin sesión o con una cuenta del personal no hay perfil de cliente", async () => {
    expect((await run(PROFILE, {}, null)).errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    const staff = { id: `u-${randomUUID()}`, name: "Personal", email: "staff@example.test", role: "WAREHOUSE", status: "ACTIVE" } as AuthUser;
    expect((await run(PROFILE, {}, staff)).errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    expect((await run(ADD, { i: home, r: 0 }, staff)).errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });
});
