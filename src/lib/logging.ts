import { db, schema } from '@/lib/db/client';

type LogLevel = 'info' | 'warn' | 'error';
type LogCategory = 'sync' | 'task' | 'llm' | 'auth' | 'system';

/**
 * Write a structured log entry to the app_log table.
 * Fire-and-forget — never throws.
 */
export async function log(
  level: LogLevel,
  category: LogCategory,
  message: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(schema.appLog).values({
      level,
      category,
      message,
      details: details ? JSON.stringify(details) : null,
    });
  } catch (e) {
    // Last resort — don't let logging break the app
    console.error('[appLog] Failed to write log:', e);
  }
}

// Convenience shortcuts
export const logInfo = (cat: LogCategory, msg: string, details?: Record<string, unknown>) => log('info', cat, msg, details);
export const logWarn = (cat: LogCategory, msg: string, details?: Record<string, unknown>) => log('warn', cat, msg, details);
export const logError = (cat: LogCategory, msg: string, details?: Record<string, unknown>) => log('error', cat, msg, details);
