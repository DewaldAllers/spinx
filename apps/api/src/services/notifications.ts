import { Expo } from 'expo-server-sdk';
import { Prisma, type PrismaClient, type NotificationType } from '@prisma/client';
import { env } from '../config/env.js';

const expo = new Expo(env.EXPO_ACCESS_TOKEN ? { accessToken: env.EXPO_ACCESS_TOKEN } : undefined);

export async function notifyUser(
  prisma: PrismaClient,
  input: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  },
) {
  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: (input.data ?? {}) as Prisma.InputJsonValue,
    },
  });

  const tokens = await prisma.pushToken.findMany({ where: { userId: input.userId } });
  const messages = tokens
    .filter((token) => Expo.isExpoPushToken(token.token))
    .map((token) => ({
      to: token.token,
      sound: 'default' as const,
      title: input.title,
      body: input.body,
      data: input.data ?? {},
    }));

  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (error) {
      console.error('Failed to send push notification chunk', error);
    }
  }
}

export async function notifyAdmins(
  prisma: PrismaClient,
  input: {
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  },
) {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });

  await Promise.all(admins.map((admin) => notifyUser(prisma, { ...input, userId: admin.id })));
}
