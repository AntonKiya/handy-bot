import { Injectable, Logger } from '@nestjs/common';
import {
  UserState,
  UserStateService,
} from '../../common/state/user-state.service';

@Injectable()
export class SummaryChannelService {
  private readonly logger = new Logger(SummaryChannelService.name);

  private readonly channelsByUser = new Map<number, string[]>();

  constructor(private readonly userStateService: UserStateService) {}

  /**
   * Старт сценария "добавить канал".
   * Здесь:
   *  - ставим пользователю state
   *  - возвращаем текст, который нужно показать в UI
   */
  async startAddChannel(userId: number): Promise<{ message: string }> {
    await this.userStateService.set(userId, {
      scope: 'summary:channel',
      step: 'waiting_for_summary_channel_name',
    });

    this.logger.debug(
      `State set to waiting_for_channel_name for user ${userId}`,
    );

    return {
      message: 'Введите название канала начиная с @',
    };
  }

  async handleState(
    userId: number,
    text: string,
    state: UserState,
  ): Promise<void> {
    this.logger.debug(
      `handleState() for user ${userId}, scope=${state.scope}, step=${state.step}, text="${text}"`,
    );

    switch (state.step) {
      case 'waiting_for_summary_channel_name':
        await this.handleChannelNameInput(userId, text);
        break;

      default:
        this.logger.warn(
          `Unknown step "${state.step}" for scope "${state.scope}" and user ${userId}`,
        );
    }
  }

  private async handleChannelNameInput(
    userId: number,
    rawText: string,
  ): Promise<void> {
    const channelName = rawText.trim();

    if (!channelName.startsWith('@')) {
      this.logger.warn(
        `Invalid channel name "${channelName}" from user ${userId}, expected @...`,
      );

      return;
    }

    const existing = this.channelsByUser.get(userId) ?? [];
    existing.push(channelName);
    this.channelsByUser.set(userId, existing);

    this.logger.debug(
      `Channel "${channelName}" added for user ${userId}. Total channels: ${existing.length}`,
    );

    await this.userStateService.clear(userId);
  }

  getChannelsForUser(userId: number): string[] {
    return this.channelsByUser.get(userId) ?? [];
  }
}
