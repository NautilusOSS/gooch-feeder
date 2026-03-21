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

export interface DiscordStartupBalanceRow {
  networkId: string;
  networkLabel: string;
  /** null when fetch failed (see `error`) */
  balanceMicro: number | null;
  error?: string;
}

export interface DiscordStartupAlgodRow {
  networkId: string;
  networkName: string;
  /** Resolved Algod base URL and port (same rules as `[ALGOD CONFIG]` logs) */
  endpoint: string;
}

export interface DiscordStartupPayload {
  enabledFeeders: number;
  totalFeeders: number;
  batchMode: boolean;
  nodeEnv?: string;
  /** Shortened signer address */
  signerAddressShort?: string;
  /** Native balance (µ) for each monitored network (e.g. Algorand + Voi) */
  balances?: DiscordStartupBalanceRow[];
  /** Same threshold as low-balance alerts (for context in embed) */
  thresholdMicro?: number;
  /** Resolved Algod endpoint per enabled network */
  algodEndpoints?: DiscordStartupAlgodRow[];
}

export interface DiscordLowBalancePayload {
  networkId: string;
  networkLabel: string;
  address: string;
  balanceMicro: number;
  thresholdMicro: number;
}

/**
 * Optional Discord incoming webhook notifications.
 * Set DISCORD_WEBHOOK_URL to enable. Failures are never thrown to callers.
 */
export class DiscordWebhookService {
  private readonly logger = new Logger('DiscordWebhook');
  private readonly webhookUrl: string | undefined;
  private readonly minIntervalMs: number;
  private readonly balanceMinIntervalMs: number;
  private readonly lastSentByFeeder = new Map<string, number>();
  /** Throttle repeat low-balance alerts per network */
  private readonly lastBalanceAlertByNetwork = new Map<string, number>();

  constructor() {
    const raw = process.env.DISCORD_WEBHOOK_URL?.trim();
    this.webhookUrl = raw && raw.length > 0 ? raw : undefined;
    const parsed = parseInt(process.env.DISCORD_MIN_INTERVAL_MS || '60000', 10);
    this.minIntervalMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : 60000;
    const balParsed = parseInt(process.env.DISCORD_BALANCE_MIN_INTERVAL_MS || '3600000', 10);
    this.balanceMinIntervalMs = Number.isFinite(balParsed) && balParsed >= 0 ? balParsed : 3600000;
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

  /**
   * Low native balance (ALGO/VOI) alerts. Requires DISCORD_WEBHOOK_URL.
   * Set DISCORD_NOTIFY_BALANCE=false to disable.
   */
  public static shouldNotifyBalance(): boolean {
    return process.env.DISCORD_NOTIFY_BALANCE !== 'false';
  }

  /** Call when balance is back above threshold so the next dip can alert immediately. */
  public clearBalanceThrottle(networkId: string): void {
    this.lastBalanceAlertByNetwork.delete(`balance:${networkId}`);
  }

  public async notifyLowBalance(payload: DiscordLowBalancePayload): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }
    if (!DiscordWebhookService.shouldNotifyBalance()) {
      return;
    }

    const key = `balance:${payload.networkId}`;
    if (this.balanceMinIntervalMs > 0) {
      const now = Date.now();
      const last = this.lastBalanceAlertByNetwork.get(key) ?? 0;
      if (now - last < this.balanceMinIntervalMs) {
        this.logger.debug(
          `Skipping Discord low-balance for ${payload.networkId} (within DISCORD_BALANCE_MIN_INTERVAL_MS=${this.balanceMinIntervalMs})`
        );
        return;
      }
      this.lastBalanceAlertByNetwork.set(key, now);
    }

    const addrShort =
      payload.address.length > 12
        ? `${payload.address.slice(0, 6)}…${payload.address.slice(-4)}`
        : payload.address;

    const embed = {
      title: 'Gooch Feeder — low wallet balance',
      description: `Signer balance is below the configured threshold on **${truncate(payload.networkLabel, 120)}**.`,
      color: 0xf0ad4e,
      fields: [
        { name: 'Network', value: truncate(payload.networkId, 256), inline: true },
        { name: 'Address', value: `\`${addrShort}\``, inline: true },
        {
          name: 'Balance (µ)',
          value: `${payload.balanceMicro} (threshold: ${payload.thresholdMicro})`,
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };

    try {
      await postJson(this.webhookUrl, { embeds: [embed] });
    } catch (err) {
      this.logger.warn(
        'Discord low-balance webhook failed:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  public async notifyStartup(payload: DiscordStartupPayload): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }
    if (!DiscordWebhookService.shouldNotifyOnStartup()) {
      return;
    }

    const balanceLines: string[] = [];
    if (payload.balances && payload.balances.length > 0) {
      for (const b of payload.balances) {
        if (b.error) {
          balanceLines.push(`**${truncate(b.networkLabel, 80)}**: ⚠ ${truncate(b.error, 200)}`);
        } else if (b.balanceMicro !== null) {
          const low =
            payload.thresholdMicro !== undefined && b.balanceMicro < payload.thresholdMicro;
          const flag = low ? ' ⚠ below threshold' : '';
          balanceLines.push(
            `**${truncate(b.networkLabel, 80)}** (\`${b.networkId}\`): **${b.balanceMicro.toLocaleString('en-US')}** µ${flag}`
          );
        }
      }
    }

    const algodLines: string[] = [];
    if (payload.algodEndpoints && payload.algodEndpoints.length > 0) {
      for (const a of payload.algodEndpoints) {
        algodLines.push(
          `**${truncate(a.networkName, 80)}** (\`${a.networkId}\`): \`${truncate(a.endpoint, 200)}\``
        );
      }
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
      ...(payload.signerAddressShort
        ? [{ name: 'Signer', value: `\`${payload.signerAddressShort}\``, inline: false }]
        : []),
      ...(payload.thresholdMicro !== undefined
        ? [
            {
              name: 'Low-balance warn threshold',
              value: `${payload.thresholdMicro.toLocaleString('en-US')} µ (same as DISCORD_BALANCE_THRESHOLD_MICRO)`,
              inline: false,
            },
          ]
        : []),
      ...(balanceLines.length > 0
        ? [
            {
              name: 'Native balances (µ)',
              value: truncate(balanceLines.join('\n'), 1024),
              inline: false,
            },
          ]
        : []),
      ...(algodLines.length > 0
        ? [
            {
              name: 'Algod endpoints',
              value: truncate(algodLines.join('\n'), 1024),
              inline: false,
            },
          ]
        : []),
    ];

    const embed = {
      title: 'Gooch Feeder — started',
      description:
        'Service is online and feeders are running.' +
        (balanceLines.length > 0 ? ' Balances are in micro-units (µ); 1 ALGO / 1 VOI = 1e6 µ.' : ''),
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
