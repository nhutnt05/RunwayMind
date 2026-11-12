// Audit trail (docs/05 §11, docs/09 AuditLog). The agent package defines the port; the backend persists rows with
// Prisma. Audit writes never throw into the caller: a failed write is logged and the business flow continues.
import type { AuditEventType } from '@runwaymind/shared';

export type AuditEntityType = 'DECISION' | 'ACTION' | 'OBLIGATION' | 'SETTINGS' | 'KEEPER' | 'NL' | 'SNAPSHOT' | 'TRANSACTION';

export interface AuditEntry {
  eventType: AuditEventType;
  /** Address or `system`. */
  actor: string;
  entityType?: AuditEntityType | null;
  entityId?: string | null;
  payload: unknown;
}

export interface AuditSink {
  write(entry: AuditEntry): Promise<void>;
}

/** Minimal structured logger (docs/05 §11: JSON lines; never log keys, prompts with secrets or session tokens). */
export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/**
 * Rule 7: RPC providers put API keys in the URL path or query (e.g. `…/v2/<key>`), and viem error messages embed the
 * request URL. Every logged string keeps only `scheme://host/…`.
 */
export function redactUrls(text: string): string {
  return text.replace(/\b(https?|wss?):\/\/([^\s/"'?#]+)[^\s"']*/g, (_m, scheme: string, host: string) => `${scheme}://${host}/…`);
}

const line = (level: string, module: string, msg: string, fields?: Record<string, unknown>) =>
  redactUrls(
    JSON.stringify({ ts: new Date().toISOString(), level, module, msg, ...fields }, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    ),
  );

export function jsonLogger(module: string): Logger {
  return {
    info: (m, f) => console.log(line('info', module, m, f)),
    warn: (m, f) => console.warn(line('warn', module, m, f)),
    error: (m, f) => console.error(line('error', module, m, f)),
  };
}

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export class AuditLogger {
  constructor(
    private readonly sink: AuditSink,
    private readonly log: Logger = silentLogger,
  ) {}

  async record(
    eventType: AuditEventType,
    payload: unknown,
    opts: { actor?: string; entityType?: AuditEntityType; entityId?: string } = {},
  ): Promise<void> {
    const entry: AuditEntry = {
      eventType,
      actor: opts.actor ?? 'system',
      entityType: opts.entityType ?? null,
      entityId: opts.entityId ?? null,
      payload,
    };
    try {
      await this.sink.write(entry);
    } catch (e) {
      this.log.error('audit write failed', { eventType, entityId: opts.entityId, error: (e as Error).message });
    }
  }
}

/** In-memory sink for tests and tooling. */
export class MemoryAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = [];
  async write(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}
