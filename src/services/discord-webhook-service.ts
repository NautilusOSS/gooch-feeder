import * as https from 'https';
import { URL } from 'url';
import { Logger } from '../utils/logger';

export interface DiscordFeederFailurePayload {
  feederId: string;
  assetSymbol: string;
  networkId?: string;
  error: string;
  /** e.g. "batch", "interval", "fallback-exhausted", "cli" */
  context?: string;
}

export interface DiscordStartupPayload {
  enabledFeeders: number;
  totalFeeders: number;
  batchMode: boolean;
  nodeEnv?: string;
}

/**
 * Optional Discord incoming webhook notifications.
 * Set DISCORD_WEBHOOK_URL to enable. Failures are never thrown to callers.
 */
export class DiscordWebhookService {
  private readonly logger = new Logger('DiscordWebhook');
  private readonly webhookUrl: string | undefined;
  private readonly minIntervalMs: number;
  private readonly lastSentByFeeder = new Map<string, number>();

  constructor() {
    const raw = process.env.DISCORD_WEBHOOK_URL?.trim();
    this.webhookUrl = raw && raw.length > 0 ? raw : undefined;
    const parsed = parseInt(process.env.DISCORD_MIN_INTERVAL_MS || '60000', 10);
    this.minIntervalMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : 60000;
  }

  public isEnabled(): boolean {
    return this.webhookUrl !== undefined;
  }

  /**
   * Whether CLI tools (test:feeder, test:all-feeders) should notify.
   * Default false to avoid spam during local testing.
   */
  public static shouldNotifyFromCli(): boolean {
    return process.env.DISCORD_NOTIFY_ON_CLI === 'true';
  }

  /**
   * One-shot startup message when the service comes online.
   * Disabled if DISCORD_NOTIFY_ON_STARTUP=false (default: on when webhook URL is set).
   */
  public static shouldNotifyOnStartup(): boolean {
    return process.env.DISCORD_NOTIFY_ON_STARTUP !== 'false';
  }

  public async notifyStartup(payload: DiscordStartupPayload): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }
    if (!DiscordWebhookService.shouldNotifyOnStartup()) {
      return;
    }

    const fields = [
      {
        name: 'Feeders',
        value: `${payload.enabledFeeders} enabled / ${payload.totalFeeders} total`,
        inline: true,
      },
      {
        name: 'Mode',
        value: payload.batchMode ? 'Batch processing' : 'Individual intervals',
        inline: true,
      },
      ...(payload.nodeEnv
        ? [{ name: 'NODE_ENV', value: truncate(payload.nodeEnv, 256), inline: true }]
        : []),
    ];

    const embed = {
      title: 'Gooch Feeder — started',
      description: 'Service is online and feeders are running.',
      color: 0x57f287,
      fields,
      timestamp: new Date().toISOString(),
    };

    try {
      await postJson(this.webhookUrl, { embeds: [embed] });
    } catch (err) {
      this.logger.warn(
        'Discord startup webhook failed:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  public async notifyFeederFailure(payload: DiscordFeederFailurePayload): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }

    const key = payload.feederId;
    if (this.minIntervalMs > 0) {
      const now = Date.now();
      const last = this.lastSentByFeeder.get(key) ?? 0;
      if (now - last < this.minIntervalMs) {
        this.logger.debug(
          `Skipping Discord notify for ${key} (within DISCORD_MIN_INTERVAL_MS=${this.minIntervalMs})`
        );
        return;
      }
      this.lastSentByFeeder.set(key, now);
    }

    const errorText = truncate(payload.error, 1000);

    const embed = {
      title: 'Gooch Feeder — failure',
      description: `**${truncate(payload.assetSymbol, 200)}** — \`${truncate(payload.feederId, 200)}\``,
      color: 0xe74c3c,
      fields: [
        ...(payload.networkId
          ? [{ name: 'Network', value: truncate(payload.networkId, 256), inline: true }]
          : []),
        ...(payload.context
          ? [{ name: 'Context', value: truncate(payload.context, 256), inline: true }]
          : []),
        { name: 'Error', value: truncate(errorText, 1024) },
      ],
      timestamp: new Date().toISOString(),
    };

    try {
      await postJson(this.webhookUrl, { embeds: [embed] });
    } catch (err) {
      this.logger.warn(
        'Discord webhook request failed:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3)}...`;
}

function postJson(webhookUrl: string, body: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(webhookUrl);
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data, 'utf8'),
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve();
            return;
          }
          const text = Buffer.concat(chunks).toString('utf8');
          reject(new Error(`HTTP ${status}: ${text}`));
        });
      }
    );
    req.on('error', reject);
    req.write(data, 'utf8');
    req.end();
  });
}
