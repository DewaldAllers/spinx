import { PrismaClient, Role, MemberStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const adminEmail = process.env.ADMIN_SEED_EMAIL ?? 'admin@spinx.local';
const adminPassword = process.env.ADMIN_SEED_PASSWORD ?? 'ChangeMe123!';

async function main() {
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash,
      role: Role.ADMIN,
      status: MemberStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
    create: {
      email: adminEmail,
      passwordHash,
      role: Role.ADMIN,
      status: MemberStatus.ACTIVE,
      firstName: 'SpinX',
      lastName: 'Admin',
      mobile: '+27000000000',
      emergencyContact: 'Studio owner',
      emailVerifiedAt: new Date(),
      acceptedAgreementVersion: 'offline-admin',
      agreementAcceptedAt: new Date(),
      signatureSignedAt: new Date(),
      contractSignedOffline: true,
    },
  });

  await prisma.appSetting.upsert({
    where: { key: 'noShowThreshold' },
    update: {},
    create: { key: 'noShowThreshold', value: 3 },
  });

  await prisma.appSetting.upsert({
    where: { key: 'paymentGraceDays' },
    update: {},
    create: { key: 'paymentGraceDays', value: 3 },
  });

  console.log(`Seeded admin user ${adminEmail}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
