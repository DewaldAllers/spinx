import type { PrismaClient, Role, MemberStatus } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      role: Role;
      status: MemberStatus;
    };
    user: {
      sub: string;
      role: Role;
      status: MemberStatus;
    };
  }
}
