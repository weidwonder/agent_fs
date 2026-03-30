// packages/server/src/services/auth-service.ts

import { getPool } from '@agent-fs/storage-cloud';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../auth/jwt.js';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
  tenantId: string;
}

export class AuthService {
  constructor(
    private readonly jwtSecret: string,
    private readonly jwtExpiresIn: string,
    private readonly jwtRefreshExpiresIn: string,
  ) {}

  async register(email: string, password: string, tenantName: string): Promise<AuthResult> {
    if (!EMAIL_REGEX.test(email)) throw new Error('INVALID_EMAIL');
    if (password.length < 8) throw new Error('PASSWORD_TOO_SHORT');
    if (!tenantName.trim()) throw new Error('TENANT_NAME_REQUIRED');

    const pool = getPool();
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) throw new Error('EMAIL_TAKEN');

    const passwordHash = await hashPassword(password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const userResult = await client.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
        [email, passwordHash],
      );
      const userId = userResult.rows[0].id as string;
      const tenantResult = await client.query(
        'INSERT INTO tenants (name, owner_id) VALUES ($1, $2) RETURNING id',
        [tenantName, userId],
      );
      const tenantId = tenantResult.rows[0].id as string;
      await client.query(
        'INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, $3)',
        [tenantId, userId, 'owner'],
      );
      await client.query('COMMIT');

      return {
        accessToken: signAccessToken(
          { userId, tenantId, role: 'owner' },
          this.jwtSecret,
          this.jwtExpiresIn,
        ),
        refreshToken: signRefreshToken(userId, this.jwtSecret, this.jwtRefreshExpiresIn),
        userId,
        tenantId,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async login(email: string, password: string): Promise<AuthResult> {
    if (!EMAIL_REGEX.test(email)) throw new Error('INVALID_EMAIL');
    if (!password) throw new Error('PASSWORD_REQUIRED');

    const pool = getPool();
    const userResult = await pool.query(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [email],
    );
    if (userResult.rows.length === 0) throw new Error('INVALID_CREDENTIALS');

    const user = userResult.rows[0] as { id: string; password_hash: string };
    if (!(await verifyPassword(password, user.password_hash))) throw new Error('INVALID_CREDENTIALS');

    const memberResult = await pool.query(
      'SELECT tenant_id, role FROM tenant_members WHERE user_id = $1 LIMIT 1',
      [user.id],
    );
    if (memberResult.rows.length === 0) throw new Error('NO_TENANT');

    const { tenant_id: tenantId, role } = memberResult.rows[0] as {
      tenant_id: string;
      role: string;
    };
    return {
      accessToken: signAccessToken({ userId: user.id, tenantId, role }, this.jwtSecret, this.jwtExpiresIn),
      refreshToken: signRefreshToken(user.id, this.jwtSecret, this.jwtRefreshExpiresIn),
      userId: user.id,
      tenantId,
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    const payload = verifyToken(refreshToken, this.jwtSecret) as any;
    if (payload.type !== 'refresh') throw new Error('INVALID_TOKEN');

    const pool = getPool();
    const memberResult = await pool.query(
      'SELECT tenant_id, role FROM tenant_members WHERE user_id = $1 LIMIT 1',
      [payload.userId as string],
    );
    if (memberResult.rows.length === 0) throw new Error('NO_TENANT');

    const { tenant_id: tenantId, role } = memberResult.rows[0] as {
      tenant_id: string;
      role: string;
    };
    return {
      accessToken: signAccessToken(
        { userId: payload.userId as string, tenantId, role },
        this.jwtSecret,
        this.jwtExpiresIn,
      ),
    };
  }
}
