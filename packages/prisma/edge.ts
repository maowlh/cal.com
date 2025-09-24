import { getRequestContext } from "@cloudflare/next-on-pages";
import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient as PrismaEdgeClient } from "@prisma/client/edge";

import type { PrismaClient as PrismaNodeClient, Prisma } from "@calcom/prisma/client";

import { bookingIdempotencyKeyExtension } from "./extensions/booking-idempotency-key";
import { disallowUndefinedDeleteUpdateManyExtension } from "./extensions/disallow-undefined-delete-update-many";
import { eventTypeTimestampsExtension } from "./extensions/event-type-timestamps";
import { excludeLockedUsersExtension } from "./extensions/exclude-locked-users";
import { excludePendingPaymentsExtension } from "./extensions/exclude-pending-payment-teams";
import { usageTrackingExtention } from "./extensions/usage-tracking";
import { bookingReferenceMiddleware } from "./middleware";
import { buildPrismaClientOptions } from "./options";

type D1Database = ConstructorParameters<typeof PrismaD1>[0];

type EnvWithDatabaseBinding = {
  CALCOM_DB?: D1Database;
  DB?: D1Database;
  DATABASE?: D1Database;
  [key: string]: unknown;
};

const prismaOptions = buildPrismaClientOptions();

const clientCache = new WeakMap<D1Database, PrismaNodeClient>();

const getDatabaseBinding = (): D1Database => {
  const { env } = getRequestContext();
  const bindings = env as EnvWithDatabaseBinding | undefined;

  const database = bindings?.CALCOM_DB ?? bindings?.DB ?? bindings?.DATABASE;

  if (!database) {
    throw new Error(
      "No Cloudflare D1 database binding (CALCOM_DB) was found. Ensure wrangler.toml defines the binding and it is available in the current request context."
    );
  }

  return database;
};

const extendClient = (client: PrismaNodeClient, baseClient: PrismaNodeClient) =>
  client
    .$extends(usageTrackingExtention(baseClient))
    .$extends(excludeLockedUsersExtension())
    .$extends(excludePendingPaymentsExtension())
    .$extends(bookingIdempotencyKeyExtension())
    .$extends(eventTypeTimestampsExtension())
    .$extends(disallowUndefinedDeleteUpdateManyExtension()) as unknown as PrismaNodeClient;

const createClient = (database: D1Database, options?: Prisma.PrismaClientOptions): PrismaNodeClient => {
  const edgeClient = new PrismaEdgeClient({
    ...prismaOptions,
    ...options,
    adapter: new PrismaD1(database),
  });

  bookingReferenceMiddleware(edgeClient as unknown as PrismaNodeClient);

  return extendClient(edgeClient as unknown as PrismaNodeClient, edgeClient as unknown as PrismaNodeClient);
};

const getOrCreateClient = (options?: Prisma.PrismaClientOptions): PrismaNodeClient => {
  const database = getDatabaseBinding();

  if (options) {
    return createClient(database, options);
  }

  const cached = clientCache.get(database);

  if (cached) {
    return cached;
  }

  const client = createClient(database);
  clientCache.set(database, client);

  return client;
};

const prismaProxy = new Proxy({} as PrismaNodeClient, {
  get(_target, property, receiver) {
    const client = getOrCreateClient();
    const value = Reflect.get(client as unknown as object, property, receiver);

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  },
  has(_target, property) {
    const client = getOrCreateClient();
    return Reflect.has(client as unknown as object, property);
  },
  ownKeys() {
    const client = getOrCreateClient();
    return Reflect.ownKeys(client as unknown as object);
  },
  getOwnPropertyDescriptor(_target, property) {
    const client = getOrCreateClient();
    return Reflect.getOwnPropertyDescriptor(client as unknown as object, property);
  },
});

export const prisma = prismaProxy as unknown as PrismaNodeClient;

export const customPrisma = (options?: Prisma.PrismaClientOptions) => getOrCreateClient(options);

export const readonlyPrisma = prisma;

type OmitPrismaClient = Omit<
  PrismaNodeClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export type { OmitPrismaClient as PrismaTransaction, PrismaNodeClient as PrismaClient };

export default prisma;
export * from "./selects";
