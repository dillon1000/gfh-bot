import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '../app/config.js';

const hasR2Config = Boolean(
  env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET,
);

let client: S3Client | null = null;

const getClient = (): S3Client => {
  if (!hasR2Config) {
    throw new Error('R2 is not configured.');
  }

  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  return client;
};

export const isR2Configured = (): boolean => hasR2Config;

export const uploadCsvToR2 = async (
  key: string,
  body: string,
): Promise<string> => {
  const s3 = getClient();

  await s3.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET!,
      Key: key,
      Body: body,
      ContentType: 'text/csv; charset=utf-8',
      ContentDisposition: `attachment; filename="${key.split('/').pop() ?? 'poll-export.csv'}"`,
    }),
  );

  if (env.R2_PUBLIC_BASE_URL) {
    return `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
  }

  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: env.R2_BUCKET!,
      Key: key,
    }),
    { expiresIn: 60 * 60 * 24 },
  );
};
