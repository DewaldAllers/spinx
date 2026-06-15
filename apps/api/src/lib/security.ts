import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { badRequest } from './errors.js';

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function createOpaqueToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function storeSignatureDataUrl(userId: string, dataUrl: string) {
  const match = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(dataUrl);
  if (!match) {
    throw badRequest('Signature must be a PNG or JPEG data URL');
  }

  const extension = match[1]?.toLowerCase() === 'jpeg' ? 'jpg' : match[1]?.toLowerCase();
  const base64 = match[2];
  if (!base64) {
    throw badRequest('Signature image is empty');
  }

  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > 1_500_000) {
    throw badRequest('Signature image is too large');
  }

  await fs.mkdir(env.SIGNATURE_STORAGE_DIR, { recursive: true });
  const key = `${userId}-${Date.now()}.${extension}`;
  const fullPath = path.resolve(env.SIGNATURE_STORAGE_DIR, key);
  await fs.writeFile(fullPath, bytes, { mode: 0o600 });
  return key;
}
