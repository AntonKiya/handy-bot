import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

import { CoreChannelUsersService } from '../src/modules/core-channel-users/core-channel-users.service';
import { Channel } from '../src/modules/channel/channel.entity';
import { ChannelPost } from '../src/modules/channel-posts/channel-post.entity';
import {
  CoreChannelUsersComment,
  CoreCommentAuthorType,
} from '../src/modules/core-channel-users/core-channel-users-comment.entity';
import { CoreChannelUsersPostCommentsSync } from '../src/modules/core-channel-users/core-channel-users-post-comments-sync.entity';
import { CoreChannelUsersChannelSync } from '../src/modules/core-channel-users/core-channel-users-channel-sync.entity';
import { User } from '../src/modules/user/user.entity';
import { TelegramCoreService } from '../src/telegram-core/telegram-core.service';
import { Api } from 'telegram';

import {
  MEDIUM_POST_DAYS,
  MEDIUM_RESYNC_INTERVAL_MS,
  MS_PER_DAY,
  SYNC_COOLDOWN_DAYS,
  SYNC_WINDOW_DAYS,
} from '../src/modules/core-channel-users/core-channel-users.constants';

// ----- Константы для тестов -----

const TEST_USER_ID_BASE = 1000;
const TEST_COMMENT_ID_BASE = 600;
const TEST_OLD_USER_ID_BASE = 9000;

const telegramChatId = -1001234567890;
const channelUsername = 'core_users_test_channel';

// ----- Мок клиента Telegram (работает поверх простого сценария постов/комментов) -----

class FakeTelegramClient {
  constructor(private scenarios: Record<string, any>) {}

  async getEntity(username: string) {
    const scenario = this.scenarios[username];
    if (!scenario) {
      throw new Error(`Unknown channel username: ${username}`);
    }
    return { id: telegramChatId, username };
  }

  async getMessages(channel: any, options: any) {
    const username = channel.username;
    const scenario = this.scenarios[username];
    if (!scenario) return [];

    // Комментарии
    if (options && typeof options.replyTo === 'number') {
      const allComments = scenario.commentsByPostId[options.replyTo] || [];
      const limit = options.limit ?? allComments.length;

      let filtered = allComments;

      if (typeof options.offsetId === 'number' && options.offsetId > 0) {
        // ИДЁМ ВПЕРЁД по id, а не назад
        filtered = allComments.filter((c) => c.id > options.offsetId);
      }

      return filtered.slice(0, limit).map((c) => ({
        id: c.id,
        date: Math.floor(c.date.getTime() / 1000),
        fromId: new Api.PeerUser({ userId: BigInt(c.authorTelegramId) as any }),
      }));
    }

    // Посты
    let filtered = scenario.posts as {
      id: number;
      date: Date;
      repliesCount?: number;
    }[];

    if (typeof options.minId === 'number') {
      filtered = filtered.filter((p) => p.id > options.minId);
    }

    if (typeof options.offsetId === 'number' && options.offsetId > 0) {
      filtered = filtered.filter((p) => p.id < options.offsetId);
    }

    const limit = options.limit ?? filtered.length;
    const slice = filtered.slice(0, limit);

    return slice.map((p) => ({
      id: p.id,
      date: Math.floor(p.date.getTime() / 1000),
      replies: p.repliesCount ? { replies: p.repliesCount } : undefined,
    }));
  }
}

// ----- Мок сервиса TelegramCoreService -----

class TelegramCoreServiceMock {
  getClient = jest.fn<Promise<FakeTelegramClient>, []>();
}

// ----- Хелперы для создания сценариев -----

const createScenario = (
  posts: Array<{ id: number; date: Date; repliesCount?: number }>,
  commentsByPostId: Record<
    number,
    Array<{
      id: number;
      date: Date;
      authorTelegramId: number;
      authorType: CoreCommentAuthorType;
    }>
  >,
) => ({
  posts,
  commentsByPostId,
});

describe('CoreChannelUsersService (integration)', () => {
  let pg: any;
  let module: TestingModule;
  let service: CoreChannelUsersService;

  let channelRepo: Repository<Channel>;
  let channelPostRepo: Repository<ChannelPost>;
  let commentRepo: Repository<CoreChannelUsersComment>;
  let postSyncRepo: Repository<CoreChannelUsersPostCommentsSync>;
  let channelSyncRepo: Repository<CoreChannelUsersChannelSync>;
  let userRepo: Repository<User>;
  let telegramCoreService: TelegramCoreServiceMock;

  const setTelegramScenario = (scenario: any) => {
    const client = new FakeTelegramClient({
      [channelUsername]: scenario,
    });
    telegramCoreService.getClient.mockResolvedValue(client);
  };

  const createChannel = async (): Promise<Channel> => {
    // ВАЖНО: именно findOne, НЕ find
    let ch = await channelRepo.findOne({
      where: { telegram_chat_id: telegramChatId },
    });

    if (!ch) {
      ch = channelRepo.create({
        telegram_chat_id: telegramChatId,
        username: channelUsername,
      });
      ch = await channelRepo.save(ch);
    }

    return ch;
  };

  const clearDatabase = async () => {
    // порядок важен: сначала дети, потом родители

    await commentRepo
      .createQueryBuilder()
      .delete()
      .from(CoreChannelUsersComment)
      .execute();

    await postSyncRepo
      .createQueryBuilder()
      .delete()
      .from(CoreChannelUsersPostCommentsSync)
      .execute();

    await channelSyncRepo
      .createQueryBuilder()
      .delete()
      .from(CoreChannelUsersChannelSync)
      .execute();

    await channelPostRepo
      .createQueryBuilder()
      .delete()
      .from(ChannelPost)
      .execute();

    await userRepo.createQueryBuilder().delete().from(User).execute();

    await channelRepo.createQueryBuilder().delete().from(Channel).execute();
  };

  beforeAll(async () => {
    jest.setTimeout(600_000);

    pg = await new PostgreSqlContainer('postgres')
      .withDatabase('tgma_core_users')
      .withUsername('postgres')
      .withPassword('1234')
      .start();

    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: `postgresql://${pg.getUsername()}:${pg.getPassword()}@${pg.getHost()}:${pg.getPort()}/${pg.getDatabase()}`,
          autoLoadEntities: true,
          synchronize: true,
        }),
        TypeOrmModule.forFeature([
          Channel,
          ChannelPost,
          CoreChannelUsersComment,
          CoreChannelUsersPostCommentsSync,
          CoreChannelUsersChannelSync,
          User,
        ]),
      ],
      providers: [
        CoreChannelUsersService,
        {
          provide: TelegramCoreService,
          useClass: TelegramCoreServiceMock,
        },
      ],
    }).compile();

    service = module.get(CoreChannelUsersService);
    channelRepo = module.get(getRepositoryToken(Channel));
    channelPostRepo = module.get(getRepositoryToken(ChannelPost));
    commentRepo = module.get(getRepositoryToken(CoreChannelUsersComment));
    postSyncRepo = module.get(
      getRepositoryToken(CoreChannelUsersPostCommentsSync),
    );
    channelSyncRepo = module.get(
      getRepositoryToken(CoreChannelUsersChannelSync),
    );
    userRepo = module.get(getRepositoryToken(User));
    telegramCoreService = module.get(TelegramCoreService);
  });

  afterAll(async () => {
    await module.close();
    await pg.stop();
  });

  beforeEach(async () => {
    await clearDatabase();
    jest.clearAllMocks();
  });

  // 1. Канал не найден по telegram_chat_id
  it('1. returns no-data when channel is not found', async () => {
    const result = await service.buildCoreUsersReportForChannel(telegramChatId);

    expect(result.type).toBe('no-data');
    expect(result.syncedWithTelegram).toBe(false);
    expect(result.items).toHaveLength(0);
  });

  // 2, 5, 7. Канал найден, но cooldown; channelSync создаётся / обновляется, sync не вызывается
  // 2, 5, 7. Канал найден, но cooldown; channelSync создаётся / обновляется, sync не вызывается, если cooldown не прошёл
  it('2/5/7. channelSync is created, cooldown respected, sync not called if cooldown not passed', async () => {
    await createChannel();

    setTelegramScenario(createScenario([], {}));

    const firstResult =
      await service.buildCoreUsersReportForChannel(telegramChatId);

    expect(firstResult.syncedWithTelegram).toBe(true);

    let channelSync = await channelSyncRepo.findOne({ where: {} });
    expect(channelSync).toBeDefined();
    const firstSyncedAt = channelSync!.lastSyncedAt;

    const secondResult =
      await service.buildCoreUsersReportForChannel(telegramChatId);

    // второй вызов — внутри cooldown
    expect(secondResult.syncedWithTelegram).toBe(false);

    channelSync = await channelSyncRepo.findOne({ where: {} });
    expect(channelSync!.lastSyncedAt.getTime()).toBe(firstSyncedAt.getTime());
  });

  // 3. Канал найден, sync разрешён, но в окне нет комментариев
  it('3. returns no-data when channel synced but there are no comments in the window', async () => {
    const now = new Date();
    await createChannel();

    const oldPostDate = new Date(
      now.getTime() - (SYNC_WINDOW_DAYS + 5) * MS_PER_DAY,
    );

    setTelegramScenario(
      createScenario(
        [
          {
            id: 1,
            date: oldPostDate,
            repliesCount: 1,
          },
        ],
        {
          1: [
            {
              id: 1,
              date: oldPostDate,
              authorTelegramId: TEST_USER_ID_BASE + 1,
              authorType: 'user',
            },
          ],
        },
      ),
    );

    const result = await service.buildCoreUsersReportForChannel(telegramChatId);

    expect(result.syncedWithTelegram).toBe(true);
    expect(result.type).toBe('no-data');
    expect(result.items).toHaveLength(0);

    const comments = await commentRepo.find();
    expect(comments).toHaveLength(0);
  });

  // 4, 21, 23. Нормальный отчёт, корректный подсчёт, полный сценарий
  it('4/21/23. full scenario: sync allowed, data loaded, top users computed correctly', async () => {
    const now = new Date();
    await createChannel();

    const freshPostDate = new Date(now.getTime() - MS_PER_DAY);

    setTelegramScenario(
      createScenario(
        [
          {
            id: 1,
            date: freshPostDate,
            repliesCount: 3,
          },
        ],
        {
          1: [
            {
              id: 101,
              date: new Date(now.getTime() - 12 * 60 * 60 * 1000),
              authorTelegramId: 1,
              authorType: 'user',
            },
            {
              id: 102,
              date: new Date(now.getTime() - 10 * 60 * 60 * 1000),
              authorTelegramId: 1,
              authorType: 'user',
            },
            {
              id: 103,
              date: new Date(now.getTime() - 8 * 60 * 60 * 1000),
              authorTelegramId: 2,
              authorType: 'user',
            },
          ],
        },
      ),
    );

    const result = await service.buildCoreUsersReportForChannel(telegramChatId);

    expect(result.type).toBe('ok');
    expect(result.syncedWithTelegram).toBe(true);
    expect(result.items.length).toBe(2);

    const user1 = result.items.find((i) => i.telegramUserId === 1)!;
    const user2 = result.items.find((i) => i.telegramUserId === 2)!;

    expect(user1.commentsCount).toBe(2);
    expect(user1.postsCount).toBe(1);
    expect(user1.avgCommentsPerActivePost).toBe(2);

    expect(user2.commentsCount).toBe(1);
    expect(user2.postsCount).toBe(1);
    expect(user2.avgCommentsPerActivePost).toBe(1);
  });

  // 6. При последующих синках обновляется lastSyncedAt (если cooldown прошёл)
  it('6. lastSyncedAt is updated on subsequent sync when cooldown passed', async () => {
    const channel = await createChannel();
    const now = new Date();

    const oldSyncedAt = new Date(
      now.getTime() - (SYNC_COOLDOWN_DAYS + 1) * MS_PER_DAY,
    );

    await channelSyncRepo.save(
      channelSyncRepo.create({
        channel,
        channelId: channel.id,
        lastSyncedAt: oldSyncedAt,
      }),
    );

    setTelegramScenario(createScenario([], {}));

    const result = await service.buildCoreUsersReportForChannel(telegramChatId);
    expect(result.syncedWithTelegram).toBe(true);

    const channelSync = await channelSyncRepo.findOne({
      where: { channelId: channel.id },
    });

    expect(channelSync).toBeDefined();
    expect(channelSync!.lastSyncedAt.getTime()).toBeGreaterThanOrEqual(
      oldSyncedAt.getTime(),
    );
  });

  // 8. Новые посты (0–FRESH_POST_DAYS) всегда пересинхронизируются
  // 8. fresh posts (0–FRESH_POST_DAYS) are always resynced and pick up new comments
  it('8. fresh posts (0–FRESH_POST_DAYS) are always resynced and pick up new comments', async () => {
    const now = new Date();
    const channel = await createChannel();

    const freshPostDate = new Date(now.getTime() - MS_PER_DAY);

    // Первый прогон — один комментарий
    setTelegramScenario(
      createScenario([{ id: 1, date: freshPostDate, repliesCount: 1 }], {
        1: [
          {
            id: 201,
            date: new Date(now.getTime() - 12 * 60 * 60 * 1000),
            authorTelegramId: 1,
            authorType: 'user',
          },
        ],
      }),
    );

    await service.buildCoreUsersReportForChannel(telegramChatId);

    let comments = await commentRepo.find();
    expect(comments).toHaveLength(1);

    // Проверим, что postSync создался
    const postSync = await postSyncRepo.findOne({ where: {} });
    expect(postSync).toBeDefined();

    // ВАЖНО: откручиваем lastSyncedAt так, чтобы cooldown прошёл
    const channelSync = await channelSyncRepo.findOne({
      where: { channel: { id: channel.id } },
      relations: ['channel'],
    });
    expect(channelSync).toBeDefined();

    channelSync!.lastSyncedAt = new Date(
      now.getTime() - (SYNC_COOLDOWN_DAYS + 1) * MS_PER_DAY,
    );
    await channelSyncRepo.save(channelSync!);

    // Второй прогон — появился второй комментарий
    setTelegramScenario(
      createScenario([{ id: 1, date: freshPostDate, repliesCount: 2 }], {
        1: [
          {
            id: 201,
            date: new Date(now.getTime() - 12 * 60 * 60 * 1000),
            authorTelegramId: 1,
            authorType: 'user',
          },
          {
            id: 202,
            date: new Date(now.getTime() - 6 * 60 * 60 * 1000),
            authorTelegramId: 2,
            authorType: 'user',
          },
        ],
      }),
    );

    await service.buildCoreUsersReportForChannel(telegramChatId);

    comments = await commentRepo.find();
    const ids = comments
      .map((c) => Number(c.telegram_comment_id))
      .sort((a, b) => a - b);

    expect(ids).toEqual([201, 202]);
  });

  // 9. Посты средней давности (FRESH_POST_DAYS–MEDIUM_POST_DAYS) пересинхронизируются только если прошло ≥ 48 часов
  it('9. medium-age posts (FRESH_POST_DAYS–MEDIUM_POST_DAYS) are resynced only if last sync ≥ MEDIUM_RESYNC_INTERVAL_MS', async () => {
    await createChannel();
    const now = new Date();

    const mediumPostDate = new Date(now.getTime() - 5 * MS_PER_DAY);

    const baseScenario = createScenario(
      [{ id: 1, date: mediumPostDate, repliesCount: 2 }],
      {
        1: [
          {
            id: 301,
            date: new Date(now.getTime() - 2 * MS_PER_DAY),
            authorTelegramId: 1,
            authorType: 'user',
          },
          {
            id: 302,
            date: new Date(now.getTime() - MS_PER_DAY),
            authorTelegramId: 2,
            authorType: 'user',
          },
        ],
      },
    );

    setTelegramScenario(baseScenario);

    // 1. Первый синк — создаём postSync и channelSync
    await service.buildCoreUsersReportForChannel(telegramChatId);

    let comments = await commentRepo.find();
    expect(comments.length).toBe(2);

    const channel = await channelRepo.findOne({
      where: { telegram_chat_id: telegramChatId },
    });
    const channelPost = await channelPostRepo.findOne({
      where: { telegram_post_id: 1, channel: { id: channel!.id } },
      relations: ['channel'],
    });

    // 2. Сценарий "менее 48 часов" — синк канала разрешаем, но для поста ставим last_synced_at < MEDIUM_RESYNC_INTERVAL_MS
    await channelSyncRepo.save(
      channelSyncRepo.create({
        channel: channel!,
        channelId: channel!.id,
        lastSyncedAt: new Date(
          Date.now() - (SYNC_COOLDOWN_DAYS + 1) * MS_PER_DAY,
        ),
      }),
    );

    await postSyncRepo.save(
      postSyncRepo.create({
        post: channelPost!,
        last_synced_at: new Date(now.getTime() - MEDIUM_RESYNC_INTERVAL_MS / 2),
      }),
    );

    const scenarioWithExtraComment = createScenario(
      [{ id: 1, date: mediumPostDate, repliesCount: 3 }],
      {
        1: [
          ...baseScenario.commentsByPostId[1],
          {
            id: 303,
            date: new Date(now.getTime() - 6 * 60 * 60 * 1000),
            authorTelegramId: 3,
            authorType: 'user',
          },
        ],
      },
    );

    setTelegramScenario(scenarioWithExtraComment);

    // Второй запуск: cooldown по каналу снят, но postSync слишком свежий — не ресинкаем
    await service.buildCoreUsersReportForChannel(telegramChatId);

    comments = await commentRepo.find();
    expect(comments.length).toBe(2);

    // 3. Теперь имитируем "прошло > MEDIUM_RESYNC_INTERVAL_MS" и по каналу, и по посту
    await channelSyncRepo.save(
      channelSyncRepo.create({
        channel: channel!,
        channelId: channel!.id,
        lastSyncedAt: new Date(
          Date.now() - (SYNC_COOLDOWN_DAYS + 1) * MS_PER_DAY,
        ),
      }),
    );

    await postSyncRepo.save(
      postSyncRepo.create({
        post: channelPost!,
        last_synced_at: new Date(
          now.getTime() - MEDIUM_RESYNC_INTERVAL_MS - 60 * 60 * 1000,
        ),
      }),
    );

    // Третий запуск: и cooldown по каналу прошёл, и postSync старый — должна быть ресинка и подтянется 303-й коммент
    await service.buildCoreUsersReportForChannel(telegramChatId);

    comments = await commentRepo.find();
    expect(comments.length).toBe(3);
  });

  // 10. Старые посты (> MEDIUM_POST_DAYS) никогда не пересинхронизируем
  it('10. old posts (> MEDIUM_POST_DAYS) are never resynced even if new comments exist', async () => {
    const now = new Date();
    const channel = await createChannel();
    const oldPostDate = new Date(
      now.getTime() - (MEDIUM_POST_DAYS + 5) * MS_PER_DAY,
    ); // старше MEDIUM_POST_DAYS, но всё ещё внутри 90-дневного окна

    setTelegramScenario(
      createScenario([{ id: 1, date: oldPostDate, repliesCount: 1 }], {
        1: [
          {
            id: 401,
            date: new Date(now.getTime() - 5 * MS_PER_DAY),
            authorTelegramId: 1,
            authorType: 'user',
          },
        ],
      }),
    );

    await service.buildCoreUsersReportForChannel(telegramChatId);

    let comments = await commentRepo.find();
    expect(comments.length).toBe(1);

    const post = await channelPostRepo.findOne({
      where: { telegram_post_id: 1, channel: { id: channel.id } },
      relations: ['channel'],
    });

    await postSyncRepo.save(
      postSyncRepo.create({
        post: post!,
        last_synced_at: new Date(now.getTime() - 30 * MS_PER_DAY),
      }),
    );

    setTelegramScenario(
      createScenario([{ id: 1, date: oldPostDate, repliesCount: 2 }], {
        1: [
          {
            id: 401,
            date: new Date(now.getTime() - 5 * MS_PER_DAY),
            authorTelegramId: 1,
            authorType: 'user',
          },
          {
            id: 402,
            date: new Date(now.getTime() - MS_PER_DAY),
            authorTelegramId: 2,
            authorType: 'user',
          },
        ],
      }),
    );

    await service.buildCoreUsersReportForChannel(telegramChatId);

    comments = await commentRepo.find();
    expect(comments.length).toBe(1);
  });

  // 11. Новые посты внутри окна добавляются и синкаются
  it('11. new posts inside sync window are added to channel_posts and synced', async () => {
    const now = new Date();
    await createChannel();

    const post1Date = new Date(now.getTime() - 2 * MS_PER_DAY);
    const post2Date = new Date(now.getTime() - MS_PER_DAY);

    setTelegramScenario(
      createScenario(
        [
          { id: 1, date: post1Date, repliesCount: 1 },
          { id: 2, date: post2Date, repliesCount: 2 },
        ],
        {
          1: [
            {
              id: 501,
              date: new Date(now.getTime() - MS_PER_DAY),
              authorTelegramId: 1,
              authorType: 'user',
            },
          ],
          2: [
            {
              id: 502,
              date: new Date(now.getTime() - 12 * 60 * 60 * 1000),
              authorTelegramId: 1,
              authorType: 'user',
            },
            {
              id: 503,
              date: new Date(now.getTime() - 10 * 60 * 60 * 1000),
              authorTelegramId: 2,
              authorType: 'user',
            },
          ],
        },
      ),
    );

    await service.buildCoreUsersReportForChannel(telegramChatId);

    const posts = await channelPostRepo.find();
    expect(posts.length).toBe(2);

    const postSyncs = await postSyncRepo.find();
    expect(postSyncs.length).toBe(2);

    const comments = await commentRepo.find();
    expect(comments.length).toBe(3);
  });

  // 13. Пагинация по постам — все страницы обрабатываются
  it('13. all posts are processed even when there are more than one page (posts pagination)', async () => {
    const now = new Date();
    await createChannel();

    const posts: {
      id: number;
      date: Date;
      repliesCount?: number;
    }[] = [];
    const commentsByPostId: Record<
      number,
      {
        id: number;
        date: Date;
        authorTelegramId: number;
        authorType: CoreCommentAuthorType;
      }[]
    > = {};

    for (let i = 1; i <= 120; i++) {
      const date = new Date(now.getTime() - 2 * MS_PER_DAY);
      posts.push({
        id: i,
        date,
        repliesCount: 1,
      });
      commentsByPostId[i] = [
        {
          id: TEST_COMMENT_ID_BASE + i,
          date: new Date(now.getTime() - MS_PER_DAY),
          authorTelegramId: 1,
          authorType: 'user',
        },
      ];
    }

    setTelegramScenario(createScenario(posts, commentsByPostId));

    await service.buildCoreUsersReportForChannel(telegramChatId);

    const dbPosts = await channelPostRepo.find();
    expect(dbPosts.length).toBe(120);

    const comments = await commentRepo.find();
    expect(comments.length).toBe(120);
  });

  // 14. Пагинация по комментариям — все комментарии учитываются
  it('14. all comments of a post are processed even when there are more than one page (comments pagination)', async () => {
    const now = new Date();
    await createChannel();

    const postDate = new Date(now.getTime() - 2 * MS_PER_DAY);
    const comments: {
      id: number;
      date: Date;
      authorTelegramId: number;
      authorType: CoreCommentAuthorType;
    }[] = [];

    for (let i = 1; i <= 250; i++) {
      comments.push({
        id: i,
        date: new Date(now.getTime() - MS_PER_DAY),
        authorTelegramId: TEST_USER_ID_BASE + i,
        authorType: 'user',
      });
    }

    setTelegramScenario(
      createScenario([{ id: 1, date: postDate, repliesCount: 250 }], {
        1: comments,
      }),
    );

    await service.buildCoreUsersReportForChannel(telegramChatId);

    const dbComments = await commentRepo.find();
    expect(dbComments.length).toBe(250);
  });

  // 15. Повторный sync не создаёт дублей комментариев
  it('15. repeated sync of the same range does not create duplicate comments', async () => {
    const now = new Date();
    await createChannel();

    const postDate = new Date(now.getTime() - 2 * MS_PER_DAY);

    const scenario = createScenario(
      [{ id: 1, date: postDate, repliesCount: 2 }],
      {
        1: [
          {
            id: 701,
            date: new Date(now.getTime() - MS_PER_DAY),
            authorTelegramId: 1,
            authorType: 'user',
          },
          {
            id: 702,
            date: new Date(now.getTime() - 12 * 60 * 60 * 1000),
            authorTelegramId: 2,
            authorType: 'user',
          },
        ],
      },
    );

    setTelegramScenario(scenario);

    await service.buildCoreUsersReportForChannel(telegramChatId);
    await service.buildCoreUsersReportForChannel(telegramChatId);

    const comments = await commentRepo.find();
    expect(comments.length).toBe(2);

    const ids = comments
      .map((c) => Number(c.telegram_comment_id))
      .sort((a, b) => a - b);
    expect(ids).toEqual([701, 702]);
  });

  // 16. Комментарии старше окна не попадают в БД
  it('16. comments older than the window are not stored in DB', async () => {
    const now = new Date();
    await createChannel();

    const insideWindowDate = new Date(
      now.getTime() - (SYNC_WINDOW_DAYS - 5) * MS_PER_DAY,
    );
    const outsideWindowDate = new Date(
      now.getTime() - (SYNC_WINDOW_DAYS + 5) * MS_PER_DAY,
    );

    setTelegramScenario(
      createScenario([{ id: 1, date: insideWindowDate, repliesCount: 2 }], {
        1: [
          {
            id: 801,
            date: insideWindowDate,
            authorTelegramId: 1,
            authorType: 'user',
          },
          {
            id: 802,
            date: outsideWindowDate,
            authorTelegramId: 2,
            authorType: 'user',
          },
        ],
      }),
    );

    await service.buildCoreUsersReportForChannel(telegramChatId);

    const comments = await commentRepo.find();
    expect(comments.length).toBe(1);
    expect(Number(comments[0].telegram_comment_id)).toBe(801);
  });

  // 17. cleanupOldComments удаляет всё, что вышло за окно
  it('17. cleanupOldComments removes comments that left the window', async () => {
    const now = new Date();
    const channel = await createChannel();

    const post = await channelPostRepo.save(
      channelPostRepo.create({
        channel,
        telegram_post_id: 1,
        published_at: new Date(now.getTime() - 10 * MS_PER_DAY),
      }),
    );

    const user1 = await userRepo.save(
      userRepo.create({ telegram_user_id: TEST_OLD_USER_ID_BASE + 1 } as any),
    );
    const user2 = await userRepo.save(
      userRepo.create({ telegram_user_id: TEST_OLD_USER_ID_BASE + 2 } as any),
    );

    await commentRepo.save(
      commentRepo.create({
        post,
        user: user1,
        telegram_comment_id: 901,
        commented_at: new Date(
          now.getTime() - (SYNC_WINDOW_DAYS + 1) * MS_PER_DAY,
        ),
        author_type: 'user' as CoreCommentAuthorType,
      } as any),
    );

    await commentRepo.save(
      commentRepo.create({
        post,
        user: user2,
        telegram_comment_id: 902,
        commented_at: new Date(
          now.getTime() - (SYNC_WINDOW_DAYS - 1) * MS_PER_DAY,
        ),
        author_type: 'user' as CoreCommentAuthorType,
      } as any),
    );

    setTelegramScenario(createScenario([], {}));

    await service.buildCoreUsersReportForChannel(telegramChatId);

    const comments = await commentRepo.find();
    const ids = comments
      .map((c) => Number(c.telegram_comment_id))
      .sort((a, b) => a - b);
    expect(ids).toEqual([902]);
  });
});
