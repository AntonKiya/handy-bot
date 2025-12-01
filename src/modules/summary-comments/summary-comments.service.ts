import { Injectable, Logger } from '@nestjs/common';
import {
  UserState,
  UserStateService,
} from '../../common/state/user-state.service';
import { TelegramCoreService } from '../../telegram-core/telegram-core.service';
import { Api } from 'telegram';

export type SummaryCommentsStateResult =
  | { type: 'none' }
  | {
      type: 'comments-fetched';
      channel: string;
      comments: ParsedComment[];
    };

export interface ParsedComment {
  postId: number;
  text: string;
}

@Injectable()
export class SummaryCommentsService {
  private readonly logger = new Logger(SummaryCommentsService.name);

  constructor(
    private readonly userStateService: UserStateService,
    private readonly telegramCoreService: TelegramCoreService,
  ) {}

  /**
   * Старт сценария "саммари комментариев по каналу".
   */
  async startAddChannelForComments(
    userId: number,
  ): Promise<{ message: string }> {
    await this.userStateService.set(userId, {
      scope: 'summary:comments',
      step: 'waiting_for_summary_comments_channel_name',
    });

    this.logger.debug(
      `State set to waiting_for_comments_channel_name for user ${userId}`,
    );

    return {
      message: 'Введите название канала для анализа комментариев, начиная с @',
    };
  }

  async handleState(
    userId: number,
    text: string,
    state: UserState,
  ): Promise<SummaryCommentsStateResult> {
    this.logger.debug(
      `handleState() for user ${userId}, scope=${state.scope}, step=${state.step}, text="${text}"`,
    );

    switch (state.step) {
      case 'waiting_for_summary_comments_channel_name':
        return this.handleChannelNameInput(userId, text);

      default:
        this.logger.warn(
          `Unknown step "${state.step}" for scope "${state.scope}" and user ${userId}`,
        );
        return { type: 'none' };
    }
  }

  private async handleChannelNameInput(
    userId: number,
    rawText: string,
  ): Promise<SummaryCommentsStateResult> {
    const channelName = rawText.trim();

    if (!channelName.startsWith('@')) {
      this.logger.warn(
        `Invalid channel name "${channelName}" from user ${userId}, expected @...`,
      );
      return { type: 'none' };
    }

    const comments = await this.fetchCommentsFromLastPosts(channelName);

    await this.userStateService.clear(userId);

    return {
      type: 'comments-fetched',
      channel: channelName,
      comments,
    };
  }

  async cancelAddChannel(userId: number): Promise<void> {
    this.logger.debug(
      `Cancelling comments summary flow for user ${userId}, clearing state`,
    );
    await this.userStateService.clear(userId);
  }

  /**
   * MVP-вариант:
   * - Берём последние 3 поста канала
   * - Для каждого забираем комментарии (replies) через Core API
   */
  async fetchCommentsFromLastPosts(
    channelNameWithAt: string,
    postsCount = 3,
  ): Promise<ParsedComment[]> {
    const username = channelNameWithAt.replace(/^@/, '');
    this.logger.debug(
      `Fetching comments for last posts of channel ${username}`,
    );

    const client = await this.telegramCoreService.getClient();

    // 1. Получаем сущность канала
    const channel = await client.getEntity(username);

    // 2. Берём последние N постов канала
    const posts = await client.getMessages(channel, {
      limit: postsCount,
    });

    const comments: ParsedComment[] = [];

    for (const msg of posts) {
      const post = msg as Api.Message;

      if (!post || typeof post.id !== 'number') {
        continue;
      }

      const postId = post.id;

      // Если у поста нет ответов — пропускаем
      if (
        !post.replies ||
        !post.replies.replies ||
        post.replies.replies === 0
      ) {
        continue;
      }

      // 3. Получаем реплаи (комментарии) к этому посту
      const replies = await client.getMessages(channel, {
        replyTo: postId,
        limit: 100, // MVP вариант, позже можно параметризовать
      });

      for (const reply of replies) {
        const r = reply as Api.Message;

        const rawText = (r as any).message as string | undefined;
        const text = rawText?.trim();

        // Игнорируем сообщения без текста (гифки/стикеры/фото без подписи)
        if (!text) continue;

        comments.push({
          postId,
          text,
        });
      }
    }

    this.logger.debug(
      `Fetched ${comments.length} comments for channel ${username}`,
    );

    return comments;
  }
}
