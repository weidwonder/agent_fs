// packages/storage-cloud/src/s3.ts

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

export interface S3Config {
  endpoint: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

let s3Client: S3Client | null = null;
let s3Bucket = '';

export function initS3(config: S3Config): S3Client {
  s3Client = new S3Client({
    endpoint: config.endpoint,
    region: config.region ?? 'us-east-1',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle ?? true,
  });
  s3Bucket = config.bucket;
  return s3Client;
}

export function getS3(): S3Client {
  if (!s3Client) throw new Error('S3 not initialized. Call initS3() first.');
  return s3Client;
}

export function getS3Bucket(): string {
  return s3Bucket;
}

export async function putObject(key: string, body: Buffer | string): Promise<void> {
  const client = getS3();
  await client.send(new PutObjectCommand({ Bucket: s3Bucket, Key: key, Body: body }));
}

export async function getObject(key: string): Promise<Buffer> {
  const client = getS3();
  const response = await client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  const client = getS3();
  await client.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }));
}

export async function objectExists(key: string): Promise<boolean> {
  const client = getS3();
  try {
    await client.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function listObjects(prefix: string): Promise<string[]> {
  const client = getS3();
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: s3Bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of response.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  return keys;
}
