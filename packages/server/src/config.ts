// packages/server/src/config.ts

export interface ServerConfig {
  port: number;
  host: string;
  databaseUrl: string;
  s3Endpoint: string;
  s3Bucket: string;
  s3AccessKey: string;
  s3SecretKey: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtRefreshExpiresIn: string;
}

export function loadConfig(): ServerConfig {
  return {
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    host: process.env['HOST'] ?? '0.0.0.0',
    databaseUrl: process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/agent_fs',
    s3Endpoint: process.env['S3_ENDPOINT'] ?? 'http://localhost:9000',
    s3Bucket: process.env['S3_BUCKET'] ?? 'agent-fs',
    s3AccessKey: process.env['S3_ACCESS_KEY'] ?? 'minioadmin',
    s3SecretKey: process.env['S3_SECRET_KEY'] ?? 'minioadmin',
    jwtSecret: process.env['JWT_SECRET'] ?? 'change-me-in-production',
    jwtExpiresIn: process.env['JWT_EXPIRES_IN'] ?? '15m',
    jwtRefreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
  };
}
