import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  NTFY_JOB_TOPIC: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  DIGEST_EMAIL: z.string().email(),
  RESEND_FROM: z.string().min(1),
  ADZUNA_APP_ID: z.string().min(1),
  ADZUNA_APP_KEY: z.string().min(1),
  REED_API_KEY: z.string().min(1),
});

export const env = schema.parse(process.env);
