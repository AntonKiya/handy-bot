import { Injectable, Logger } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

@Injectable()
export class TelegramCoreService {
  private readonly logger = new Logger(TelegramCoreService.name);

  private client: TelegramClient | null = null;
  private initPromise: Promise<TelegramClient> | null = null;

  /**
   * Ленивая инициализация клиента.
   */
  async getClient(): Promise<TelegramClient> {
    if (this.client) {
      return this.client;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.initClient();
    return this.initPromise;
  }

  private async initClient(): Promise<TelegramClient> {
    const apiIdRaw = process.env.TG_API_ID;
    const apiHash = process.env.TG_API_HASH;
    const sessionString = process.env.TG_SESSION;

    if (!apiIdRaw || !apiHash || !sessionString) {
      throw new Error(
        'TG_API_ID, TG_API_HASH, or TG_SESSION are not set in the environment variables.',
      );
    }

    const apiId = Number(apiIdRaw);
    if (!Number.isFinite(apiId)) {
      throw new Error(
        `TG_API_ID must be a number, but received: "${apiIdRaw}"`,
      );
    }

    const stringSession = new StringSession(sessionString);

    this.logger.log('Creating TelegramClient (GramJS)...');

    const client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
    });

    await client.connect();
    this.logger.log('TelegramClient successfully connected to the Core API.');

    this.client = client;
    return client;
  }
}
