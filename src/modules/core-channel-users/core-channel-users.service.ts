import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, In } from 'typeorm';
import { Channel } from '../channel/channel.entity';
import { ChannelPost } from '../channel-posts/channel-post.entity';
import {
  CoreChannelUsersComment,
  CoreCommentAuthorType,
} from './core-channel-users-comment.entity';
import { CoreChannelUsersPostCommentsSync } from './core-channel-users-post-comments-sync.entity';
import { CoreChannelUsersChannelSync } from './core-channel-users-channel-sync.entity';
import { User } from '../user/user.entity';
import { TelegramCoreService } from '../../telegram-core/telegram-core.service';
import { Api } from 'telegram';
import {
  SYNC_WINDOW_DAYS,
  SYNC_COOLDOWN_DAYS,
  TOP_USERS_AMOUNT,
  MS_PER_DAY,
  FRESH_POST_DAYS,
  MEDIUM_POST_DAYS,
  MEDIUM_RESYNC_INTERVAL_MS,
} from './core-channel-users.constants';

export interface CoreUserReportItem {
  telegramUserId: number;
  username: string | null;
  commentsCount: number;
  postsCount: number;
  avgCommentsPerActivePost: number;
}

export type CoreChannelUsersReportResult = {
  type: 'ok' | 'no-data';
  syncedWithTelegram: boolean;
  items: CoreUserReportItem[];
  windowFrom: Date;
  windowTo: Date;
};

@Injectable()
export class CoreChannelUsersService {
  private readonly logger = new Logger(CoreChannelUsersService.name);

  constructor(
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
    @InjectRepository(ChannelPost)
    private readonly channelPostRepo: Repository<ChannelPost>,
    @InjectRepository(CoreChannelUsersComment)
    private readonly commentRepo: Repository<CoreChannelUsersComment>,
    @InjectRepository(CoreChannelUsersPostCommentsSync)
    private readonly postSyncRepo: Repository<CoreChannelUsersPostCommentsSync>,
    @InjectRepository(CoreChannelUsersChannelSync)
    private readonly channelSyncRepo: Repository<CoreChannelUsersChannelSync>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly telegramCoreService: TelegramCoreService,
  ) {}

  /**
   * Строит отчёт по ядру комментаторов для канала:
   * - Проверяет cooldown (не чаще 1 раза в день);
   * - При необходимости синхронизирует посты и комментарии (гибридная схема 0–3 / 3–10 / >10 дней);
   * - Чистит комментарии, вышедшие за окно;
   * - Считает топ N пользователей по числу комментариев за окно.
   */
  async buildCoreUsersReportForChannel(
    telegramChatId: number,
  ): Promise<CoreChannelUsersReportResult> {
    // TODO: TIMEZONE - Некорректная обработка timezone
    // Проблема: В разных окружениях (сервер UTC, локалка в другом timezone) будут разные результаты расчета окон
    // Решение: Явно работать в UTC везде, использовать date-fns с UTC
    const now = new Date();
    const windowTo = now;
    const windowFrom = new Date(now.getTime() - SYNC_WINDOW_DAYS * MS_PER_DAY);

    // 1. Находим канал по telegram_chat_id
    const channel = await this.channelRepo.findOne({
      where: { telegram_chat_id: telegramChatId },
    });

    if (!channel) {
      this.logger.warn(
        `buildCoreUsersReportForChannel: channel with telegram_chat_id=${telegramChatId} not found`,
      );
      return {
        type: 'no-data',
        syncedWithTelegram: false,
        items: [],
        windowFrom,
        windowTo,
      };
    }

    // 2. Проверяем лимиты и при необходимости синкаем
    const { synced } = await this.syncChannel(channel, windowFrom);

    // 3. Чистим устаревшие комментарии за пределами окна
    // TODO: CLEANUP - Cleanup без limit
    // Проблема: DELETE без limit. При миллионах старых комментариев может заблокировать таблицу надолго
    // Решение: Батчевое удаление по 10K записей с паузами
    await this.cleanupOldComments(windowFrom);

    // 4. Считаем топ пользователей
    // TODO: CACHE - Отсутствие кэширования
    // Проблема: Каждый запрос делает тяжелый SQL запрос, даже если данные не менялись
    // Решение: Кэшировать результат на 5-10 минут с инвалидацией при синке
    const items = await this.loadTopUsersForChannel(
      channel,
      windowFrom,
      windowTo,
    );

    if (!items.length) {
      return {
        type: 'no-data',
        syncedWithTelegram: synced,
        items: [],
        windowFrom,
        windowTo,
      };
    }

    return {
      type: 'ok',
      syncedWithTelegram: synced,
      items,
      windowFrom,
      windowTo,
    };
  }

  /**
   * Проверка cooldown по каналу и запуск синка.
   *
   * ВАЖНО:
   * - Если cooldown ещё не прошёл, в Telegram не идём, возвращаем synced=false.
   * - Если синк разрешён, мы ВСЕГДА обновляем lastSyncedAt для канала,
   *   даже если новых/подходящих постов не нашлось (чтобы нельзя было абузить).
   */
  private async syncChannel(
    channel: Channel,
    windowFrom: Date,
  ): Promise<{ synced: boolean }> {
    // TODO: RACE_CONDITION - Race Condition в syncChannel
    // Проблема: Два одновременных запроса могут синкать один канал → двойная нагрузка на Telegram API → возможный ban
    // Решение: Добавить Redis distributed lock или pessimistic lock в БД перед проверкой cooldown
    // Пример: const lock = await redis.set(`sync:${channel.id}`, 'locked', 'EX', 600, 'NX');

    // TODO: RATE_LIMIT - Отсутствие rate limiting на уровне приложения
    // Проблема: Если у пользователя 100 каналов, он может запустить синк всех сразу → массовая нагрузка на API
    // Решение: Глобальный rate limiter (например, 10 синков в минуту для всего приложения)

    const now = new Date();
    const cooldownMs = SYNC_COOLDOWN_DAYS * MS_PER_DAY;

    let channelSync = await this.channelSyncRepo.findOne({
      where: { channel: { id: channel.id } },
      relations: ['channel'],
    });

    if (
      channelSync &&
      now.getTime() - channelSync.lastSyncedAt.getTime() < cooldownMs
    ) {
      this.logger.debug(
        `syncChannel: channel=${channel.id}, cooldown not passed, skip sync`,
      );
      return { synced: false };
    }

    // Проверяем username ДО начала синка и обновления lastSyncedAt
    if (!channel.username) {
      this.logger.warn(
        `syncChannel: channel ${channel.id} has no username, cannot sync`,
      );
      return { synced: false };
    }

    // Перед синком фиксируем максимальный telegram_post_id, который уже есть в БД.
    const lastPostBefore = await this.channelPostRepo
      .createQueryBuilder('p')
      .where('p.channel_id = :channelId', { channelId: channel.id })
      .orderBy('p.telegram_post_id', 'DESC')
      .getOne();

    const maxTelegramPostIdBefore = lastPostBefore
      ? Number(lastPostBefore.telegram_post_id)
      : 0;

    await this.channelPostRepo.manager.transaction(
      async (transactionalEntityManager) => {
        await this.syncPostsAndCommentsForChannel(
          channel,
          windowFrom,
          now,
          maxTelegramPostIdBefore,
          transactionalEntityManager,
        );
      },
    );

    // Обновляем lastSyncedAt только после успешного завершения синка
    if (!channelSync) {
      channelSync = this.channelSyncRepo.create({
        channel,
        channelId: channel.id,
        lastSyncedAt: now,
      });
    } else {
      channelSync.lastSyncedAt = now;
    }

    await this.channelSyncRepo.save(channelSync);

    return { synced: true };
  }

  /**
   * Гибридная синхронизация:
   * 1) Сначала подтягиваем ВСЕ новые посты (id > maxTelegramPostIdBefore),
   *    для каждого сразу синкаем все комментарии.
   * 2) Затем для уже существующих постов внутри окна:
   *    - 0–3 дней: всегда пересинхронизируем комментарии;
   *    - 3–10 дней: пересинхронизируем, если прошло >= 48 часов с последнего синка поста;
   *    - >10 дней: больше не трогаем (используем только уже накопленные комментарии).
   */
  private async syncPostsAndCommentsForChannel(
    channel: Channel,
    windowFrom: Date,
    now: Date,
    maxTelegramPostIdBefore: number,
    manager: EntityManager,
  ): Promise<void> {
    // TODO: RETRY - Отсутствие retry механизма для Telegram API
    // Проблема: При FLOOD_WAIT, timeout или network error весь синк падает
    // Решение: Обернуть все вызовы client.getMessages() в retry wrapper с обработкой FLOOD_WAIT
    // Пример: await this.executeWithRetry(() => client.getMessages(...))

    // TODO: API_ERRORS - Отсутствие обработки ошибок Telegram API
    // Проблема: Нет обработки конкретных ошибок (CHANNEL_PRIVATE, AUTH_KEY_UNREGISTERED и т.д.)
    // Решение: Catch и обрабатывать разные типы ошибок с понятными сообщениями для пользователя

    const client = await this.telegramCoreService.getClient();
    const username = channel.username;

    this.logger.debug(
      `syncPostsAndCommentsForChannel: syncing posts & comments for @${username}`,
    );

    const tgChannel = await client.getEntity(username);

    // 1) Новые посты (id > maxTelegramPostIdBefore)
    await this.syncNewPosts(
      client,
      tgChannel,
      channel,
      windowFrom,
      now,
      maxTelegramPostIdBefore,
      manager,
    );

    // 2) Ресинк уже существующих постов
    await this.syncExistingPosts(
      client,
      tgChannel,
      channel,
      windowFrom,
      now,
      maxTelegramPostIdBefore,
      manager,
    );
  }

  /**
   * Синхронизируем только новые посты (id > maxTelegramPostIdBefore)
   * и все комментарии к ним (с пагинацией по комментариям).
   */
  private async syncNewPosts(
    client: any,
    tgChannel: any,
    channel: Channel,
    windowFrom: Date,
    now: Date,
    maxTelegramPostIdBefore: number,
    manager: EntityManager,
  ): Promise<void> {
    let minId = maxTelegramPostIdBefore;
    const channelPostRepo = manager.getRepository(ChannelPost);

    this.logger.debug(
      `syncNewPosts: start fetching posts for channel=${channel.id} with minId=${minId}`,
    );

    while (true) {
      const messages = await client.getMessages(tgChannel, {
        limit: 100,
        minId,
      });

      if (!messages || messages.length === 0) {
        break;
      }

      // Собираем все посты из батча для batch операций
      const postsToProcess: Array<{
        postId: number;
        publishedAt: Date;
        hasComments: boolean;
      }> = [];

      let batchMaxId = minId;

      for (const msg of messages) {
        const post = msg as Api.Message;
        if (!post || typeof post.id !== 'number') continue;

        const postId = post.id;

        if (!Number.isFinite(postId) || postId <= 0) {
          this.logger.warn(`syncNewPosts: invalid post ID: ${postId}`);
          continue;
        }

        if (postId <= minId) {
          continue;
        }

        const rawPostDate: any = (post as any).date;
        const publishedAt =
          rawPostDate instanceof Date
            ? rawPostDate
            : new Date(rawPostDate * 1000);

        const hasComments =
          post.replies && post.replies.replies && post.replies.replies > 0;

        postsToProcess.push({ postId, publishedAt, hasComments });

        if (postId > batchMaxId) {
          batchMaxId = postId;
        }
      }

      if (postsToProcess.length === 0) {
        break;
      }

      // Batch select существующих постов
      const existingPosts = await channelPostRepo.find({
        where: {
          channel: { id: channel.id },
          telegram_post_id: In(postsToProcess.map((p) => p.postId)),
        },
        relations: ['channel'],
      });

      const existingPostIds = new Set(
        existingPosts.map((p) => Number(p.telegram_post_id)),
      );

      // Batch insert новых постов
      const newPostsToCreate = postsToProcess
        .filter((p) => !existingPostIds.has(p.postId))
        .map((p) => ({
          channel: { id: channel.id },
          telegram_post_id: p.postId,
          published_at: p.publishedAt,
        }));

      if (newPostsToCreate.length > 0) {
        await channelPostRepo.insert(newPostsToCreate);
      }

      // Получаем все посты для дальнейшей обработки
      const allPosts = await channelPostRepo.find({
        where: {
          channel: { id: channel.id },
          telegram_post_id: In(postsToProcess.map((p) => p.postId)),
        },
        relations: ['channel'],
      });

      const postMap = new Map(
        allPosts.map((p) => [Number(p.telegram_post_id), p]),
      );

      // Синкаем комментарии для постов, где они есть
      for (const postData of postsToProcess) {
        const channelPost = postMap.get(postData.postId);
        if (!channelPost) {
          this.logger.warn(
            `syncNewPosts: post ${postData.postId} not found after insert/select`,
          );
          continue;
        }

        if (postData.hasComments) {
          await this.syncCommentsForPost(
            client,
            tgChannel,
            channelPost,
            windowFrom,
            now,
            manager,
          );
        } else {
          // Пост без комментариев, просто фиксируем синк
          await this.touchPostSync(channelPost, now, manager);
        }
      }

      if (batchMaxId === minId) {
        break;
      }

      minId = batchMaxId;

      if (messages.length < 100) {
        break;
      }
    }
  }

  /**
   * Гибридный ресинк уже существующих постов (которые были в БД до этого синка):
   *
   * - Берём посты с telegram_post_id <= maxTelegramPostIdBefore
   *   и published_at в диапазоне последних 10 дней.
   * - Для постов 0–3 дней - всегда обновляем комментарии.
   * - Для постов 3–10 дней - обновляем, только если с последнего синка поста прошло >= 48 часов.
   * - Посты старше 10 дней не попадают в выборку и не ресинкутся вообще.
   */
  private async syncExistingPosts(
    client: any,
    tgChannel: any,
    channel: Channel,
    windowFrom: Date,
    now: Date,
    maxTelegramPostIdBefore: number,
    manager: EntityManager,
  ): Promise<void> {
    // TODO: DELETED_POSTS - Отсутствие обработки удаленных постов/комментариев
    // Проблема: Если пост удален в Telegram, он остается в БД навсегда (до выхода за окно 90 дней)
    // Решение: Добавить флаг is_deleted и логику мягкого удаления при обнаружении отсутствия поста в API

    const mediumFromDate = new Date(
      now.getTime() - MEDIUM_POST_DAYS * MS_PER_DAY,
    );

    const channelPostRepo = manager.getRepository(ChannelPost);

    // Используем строгое неравенство для выборки постов
    // Берём все посты канала, которые:
    // - были созданы раньше/равно maxTelegramPostIdBefore;
    // - моложе 10 дней (т.е. published_at > mediumFromDate, строго больше чтобы исключить граничный случай).
    const posts = await channelPostRepo
      .createQueryBuilder('p')
      .innerJoin('p.channel', 'ch')
      .where('ch.id = :channelId', { channelId: channel.id })
      .andWhere('p.telegram_post_id <= :maxId', {
        maxId: maxTelegramPostIdBefore,
      })
      .andWhere('p.published_at > :from', { from: mediumFromDate })
      .getMany();

    if (!posts.length) {
      return;
    }

    const postSyncRepo = manager.getRepository(
      CoreChannelUsersPostCommentsSync,
    );

    for (const channelPost of posts) {
      const ageMs = now.getTime() - channelPost.published_at.getTime();
      const ageDays = ageMs / MS_PER_DAY;

      let needResync = false;

      // TODO: BOUNDARY - Граничный случай: пост ровно 3 дня
      // Проблема: Пост ровно 3.0000 дня попадает в FRESH, а 3.0001 в MEDIUM. Неоднозначность
      // Решение: Использовать строгое неравенство < вместо <=

      // Используем строгое неравенство
      if (ageDays < FRESH_POST_DAYS) {
        // Пост младше 3 дней - всегда ресинк.
        needResync = true;
      } else if (ageDays < MEDIUM_POST_DAYS) {
        // 3–10 дней - ресинк по интервалу 48 часов
        const postSync = await postSyncRepo.findOne({
          where: { post: { id: channelPost.id } },
          relations: ['post'],
        });

        if (!postSync) {
          needResync = true;
        } else {
          const diffMs = now.getTime() - postSync.last_synced_at.getTime();
          if (diffMs >= MEDIUM_RESYNC_INTERVAL_MS) {
            needResync = true;
          }
        }
      } else {
        // >=10 дней - игнорируем (не пересинхронизируем совсем)
        needResync = false;
      }

      if (!needResync) {
        continue;
      }

      await this.syncCommentsForPost(
        client,
        tgChannel,
        channelPost,
        windowFrom,
        now,
        manager,
      );
    }
  }

  /**
   * Синхронизирует ВСЕ комментарии к конкретному посту:
   * - Полноценная пагинация по комментариям (limit=100, offsetId),
   * - Отсечение по окну по дате комментария,
   * - orIgnore по (post_id, telegram_comment_id), чтобы не плодить дубли,
   * - Обновление last_synced_at для CoreChannelUsersPostCommentsSync.
   */
  private async syncCommentsForPost(
    client: any,
    tgChannel: any,
    channelPost: ChannelPost,
    windowFrom: Date,
    now: Date,
    manager: EntityManager,
  ): Promise<void> {
    // TODO: DEADLOCK - Возможность дедлока при параллельном синке
    // Проблема: Два процесса синкают разные каналы, но у них общие пользователи → возможен deadlock на уровне БД
    // Решение: Обрабатывать deadlock exception и retry с exponential backoff

    const postId = Number(channelPost.telegram_post_id);
    let offsetId = 0;
    let stopByWindow = false;

    const userRepo = manager.getRepository(User);
    const commentRepo = manager.getRepository(CoreChannelUsersComment);

    this.logger.debug(
      `syncCommentsForPost: syncing comments for post ${postId} (channelPost.id=${channelPost.id})`,
    );

    while (!stopByWindow) {
      const replies = await client.getMessages(tgChannel, {
        replyTo: postId,
        limit: 100,
        offsetId,
      });

      if (!replies || replies.length === 0) {
        break;
      }

      // Накапливаем данные для batch операций
      const authorsToUpsert = new Map<number, CoreCommentAuthorType>();
      const commentsData: Array<{
        authorTelegramId: number;
        authorUsername: string | null;
        authorType: CoreCommentAuthorType;
        telegramCommentId: number;
        commentedAt: Date;
      }> = [];

      for (const reply of replies) {
        const r = reply as Api.Message;
        if (!r) continue;

        const rawCommentDate: any = (r as any).date;
        const commentedAt =
          rawCommentDate instanceof Date
            ? rawCommentDate
            : new Date(rawCommentDate * 1000);

        // Сразу выходим из цикла при встрече старого комментария
        if (commentedAt < windowFrom) {
          stopByWindow = true;
          break;
        }

        const telegramCommentId = Number(r.id);

        // Валидация ID комментария
        if (!Number.isFinite(telegramCommentId) || telegramCommentId <= 0) {
          this.logger.warn(
            `syncCommentsForPost: invalid comment ID: ${telegramCommentId}`,
          );
          continue;
        }

        // Определяем автора комментария по fromId:
        let authorTelegramId: number | undefined;
        let authorUsername: string | null = null;
        let authorType: CoreCommentAuthorType;

        const fromId = r.fromId;

        if (fromId instanceof Api.PeerUser) {
          authorTelegramId = Number(fromId.userId);
          authorType = 'user';

          // Пытаемся получить username из объекта сообщения
          // TODO: USERNAME_EXTRACTION - Неполная информация о username
          // Проблема: В Api.Message может не быть полной информации о пользователе
          // Решение: Использовать client.getEntity() для получения полной информации о пользователе
          try {
            const sender = await r.getSender();
            if (sender && 'username' in sender) {
              authorUsername = (sender as any).username ?? null;
            }
          } catch (e) {
            this.logger.debug(
              `syncCommentsForPost: failed to get sender for comment ${telegramCommentId}`,
            );
          }
        } else if (fromId instanceof Api.PeerChannel) {
          authorTelegramId = Number(fromId.channelId);
          authorType = 'channel';

          // Для каналов также пытаемся получить username
          try {
            const sender = await r.getSender();
            if (sender && 'username' in sender) {
              authorUsername = (sender as any).username ?? null;
            }
          } catch (e) {
            this.logger.debug(
              `syncCommentsForPost: failed to get sender channel for comment ${telegramCommentId}`,
            );
          }
        } else if (fromId instanceof Api.PeerChat) {
          authorTelegramId = Number(fromId.chatId);
          authorType = 'chat';
        } else {
          this.logger.debug(
            `syncCommentsForPost: skip comment without resolvable author (messageId=${telegramCommentId})`,
          );
          continue;
        }

        // Валидация author ID
        if (!Number.isFinite(authorTelegramId) || authorTelegramId <= 0) {
          this.logger.warn(
            `syncCommentsForPost: invalid author ID: ${authorTelegramId}`,
          );
          continue;
        }

        // TODO: BIGINT - Некорректная обработка bigint
        // Проблема: Telegram ID могут быть больше Number.MAX_SAFE_INTEGER. При конвертации bigint → number потеря точности
        // Решение: Использовать bigint тип или string для больших ID с соответствующими transformer в Entity

        authorsToUpsert.set(authorTelegramId, authorType);
        commentsData.push({
          authorTelegramId,
          authorUsername,
          authorType,
          telegramCommentId,
          commentedAt,
        });
      }

      if (authorsToUpsert.size === 0) {
        break;
      }

      // Batch upsert всех авторов с username
      const authorsArray = Array.from(authorsToUpsert.keys()).map((id) => {
        // Ищем username для этого автора в commentsData
        const commentData = commentsData.find((c) => c.authorTelegramId === id);
        return {
          telegram_user_id: id,
          username: commentData?.authorUsername ?? null,
        };
      });
      await userRepo.upsert(authorsArray, {
        conflictPaths: ['telegram_user_id'],
      });

      // Batch select всех авторов
      const users = await userRepo.find({
        where: {
          telegram_user_id: In(Array.from(authorsToUpsert.keys())),
        },
      });

      // map для быстрого поиска
      const userMap = new Map<number, User>();
      users.forEach((u) => userMap.set(Number(u.telegram_user_id), u));

      // Подготавливаем данные для batch insert
      const commentsToInsert = commentsData
        .map((data) => {
          const user = userMap.get(data.authorTelegramId);
          if (!user) {
            this.logger.warn(
              `syncCommentsForPost: user not found after upsert, telegram_user_id=${data.authorTelegramId}`,
            );
            return null;
          }

          return {
            post: { id: channelPost.id },
            user: { id: user.id },
            telegram_comment_id: data.telegramCommentId,
            author_type: data.authorType,
            commented_at: data.commentedAt,
          };
        })
        .filter((c) => c !== null);

      // Batch insert комментариев
      if (commentsToInsert.length > 0) {
        await commentRepo
          .createQueryBuilder()
          .insert()
          .into(CoreChannelUsersComment)
          .values(commentsToInsert)
          .orIgnore()
          .execute();
      }

      const last = replies[replies.length - 1] as Api.Message;
      if (!last || typeof last.id !== 'number') {
        break;
      }

      offsetId = last.id;

      if (replies.length < 100) {
        break;
      }
    }

    await this.touchPostSync(channelPost, now, manager);
  }

  /**
   * Обновляет / создаёт запись синка по посту.
   */
  private async touchPostSync(
    channelPost: ChannelPost,
    now: Date,
    manager: EntityManager,
  ): Promise<void> {
    const postSyncRepo = manager.getRepository(
      CoreChannelUsersPostCommentsSync,
    );

    let postSync = await postSyncRepo.findOne({
      where: { post: { id: channelPost.id } },
      relations: ['post'],
    });

    if (!postSync) {
      postSync = postSyncRepo.create({
        post: channelPost,
        post_id: channelPost.id,
        last_synced_at: now,
      });
    } else {
      postSync.last_synced_at = now;
    }

    await postSyncRepo.save(postSync);
  }

  /**
   * Удаляем комментарии, которые вышли за пределы окна.
   */
  private async cleanupOldComments(windowFrom: Date): Promise<void> {
    this.logger.debug(
      `cleanupOldComments: deleting comments older than ${windowFrom.toISOString()}`,
    );

    await this.commentRepo
      .createQueryBuilder()
      .delete()
      .where('commented_at < :from', { from: windowFrom })
      .execute();
  }

  /**
   * Загружает топ N пользователей по числу комментариев за окно по конкретному каналу.
   * Считает количество постов, в которых пользователь комментировал,
   * и среднее число комментариев на активный пост для этого пользователя.
   * Возвращает также username пользователя.
   */
  private async loadTopUsersForChannel(
    channel: Channel,
    windowFrom: Date,
    windowTo: Date,
  ): Promise<CoreUserReportItem[]> {
    // TODO: MONITORING - Отсутствие мониторинга
    // Проблема: Нет метрик: сколько длится запрос, сколько ошибок, использование памяти
    // Решение: Добавить логирование метрик (duration, query time, результаты) и Prometheus metrics

    const qb = this.commentRepo
      .createQueryBuilder('c')
      .innerJoin('c.post', 'p')
      .innerJoin('p.channel', 'ch')
      .innerJoin('c.user', 'u')
      .where('ch.id = :channelId', { channelId: channel.id })
      .andWhere('c.commented_at BETWEEN :from AND :to', {
        from: windowFrom,
        to: windowTo,
      })
      .select('u.telegram_user_id', 'telegram_user_id')
      .addSelect('u.username', 'username')
      .addSelect('COUNT(*)', 'comments_count')
      .addSelect('COUNT(DISTINCT c.post_id)', 'posts_count')
      .groupBy('u.telegram_user_id')
      .addGroupBy('u.username')
      .orderBy('comments_count', 'DESC')
      .limit(TOP_USERS_AMOUNT);

    const raw = await qb.getRawMany<{
      telegram_user_id: string;
      username: string | null;
      comments_count: string;
      posts_count: string;
    }>();

    return raw.map((row) => {
      const commentsCount = Number(row.comments_count) || 0;
      const postsCount = Number(row.posts_count) || 0;

      const avg = postsCount > 0 ? commentsCount / postsCount : 0;

      return {
        telegramUserId: Number(row.telegram_user_id),
        username: row.username,
        commentsCount,
        postsCount,
        avgCommentsPerActivePost: avg,
      };
    });
  }
}
