import { Langfuse } from 'langfuse';

/**
 * Shared Langfuse client singleton.
 * Only active when LANGFUSE_SECRET_KEY is configured.
 * Import this in all modules that need Langfuse tracing.
 */
export const langfuse = process.env.LANGFUSE_SECRET_KEY
  ? new Langfuse({
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY || '',
      baseUrl: process.env.LANGFUSE_BASE_URL || 'https://us.cloud.langfuse.com',
    })
  : null;
