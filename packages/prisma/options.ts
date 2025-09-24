import type { Prisma } from "@calcom/prisma/client";

export const buildPrismaClientOptions = (): Prisma.PrismaClientOptions => {
  const options: Prisma.PrismaClientOptions = {};

  const loggerLevel = parseInt(process.env.NEXT_PUBLIC_LOGGER_LEVEL ?? "", 10);

  if (!isNaN(loggerLevel)) {
    switch (loggerLevel) {
      case 5:
      case 6:
        options.log = ["error"];
        break;
      case 4:
        options.log = ["warn", "error"];
        break;
      case 3:
        options.log = ["info", "error", "warn"];
        break;
      default:
        // For values 0, 1, 2 (or anything else below 3)
        options.log = ["query", "info", "error", "warn"];
        break;
    }
  }

  return options;
};
