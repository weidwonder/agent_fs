// packages/server/src/auth/jwt.ts

import jwt from 'jsonwebtoken';

export interface AccessTokenPayload {
  userId: string;
  tenantId: string;
  role: string;
}

export function signAccessToken(
  payload: AccessTokenPayload,
  secret: string,
  expiresIn: string,
): string {
  return jwt.sign({ ...payload, type: 'access' }, secret, { expiresIn } as jwt.SignOptions);
}

export function signRefreshToken(userId: string, secret: string, expiresIn: string): string {
  return jwt.sign({ userId, type: 'refresh' }, secret, { expiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string, secret: string): jwt.JwtPayload {
  return jwt.verify(token, secret) as jwt.JwtPayload;
}
