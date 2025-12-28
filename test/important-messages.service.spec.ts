import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Context } from 'telegraf';

import { ImportantMessagesService } from '../src/modules/important-messages/important-messages.service';
import { ImportantMessagesFlow } from '../src/modules/important-messages/important-messages.flow';
import { CategorizationService } from '../src/modules/important-messages/categorization.service';
import { DictionaryService } from '../src/modules/important-messages/dictionary.service';
import { ImportantMessage } from '../src/modules/important-messages/important-message.entity';
import { DictionaryWord } from '../src/modules/important-messages/dictionary-word.entity';
import { Channel } from '../src/modules/channel/channel.entity';
import { User } from '../src/modules/user/user.entity';
import { ChannelService } from '../src/modules/channel/channel.service';
import { UserChannelsService } from '../src/modules/user-channels/user-channels.service';
import { QuestionScorer } from '../src/modules/important-messages/utils/scorers/question.scorer';
import { LeadScorer } from '../src/modules/important-messages/utils/scorers/lead.scorer';
import { NegativeScorer } from '../src/modules/important-messages/utils/scorers/negative.scorer';
import { HypeScorer } from '../src/modules/important-messages/utils/scorers/hype.scorer';
import { GroupMessageData } from '../src/telegram-bot/utils/types';

const CHANNEL_CHAT_ID = -1003005590155;
const DISCUSSION_GROUP_ID = -1003037139078;
const CHANNEL_USERNAME = 'test_channel';
const TEST_USER_ID = 136817688;

const createMockContext = (message: any): Context =>
  ({
    message,
    telegram: {
      sendMessage: jest.fn().mockResolvedValue({}),
    } as any,
    update: { update_id: 123, message },
    from: message.from,
    chat: message.chat,
  }) as any;

const createAutoForwardMessage = (
  messageId: number,
  postId: number,
  channelChatId: number,
  text = 'Test post',
) => ({
  message_id: messageId,
  from: { id: 777000, is_bot: false, first_name: 'Telegram' },
  sender_chat: { id: channelChatId, type: 'channel' },
  chat: { id: DISCUSSION_GROUP_ID, type: 'supergroup' },
  date: Math.floor(Date.now() / 1000),
  is_automatic_forward: true,
  forward_from_chat: { id: channelChatId, type: 'channel' },
  forward_from_message_id: postId,
  forward_date: Math.floor(Date.now() / 1000),
  text,
});

const createCommentMessage = (
  messageId: number,
  replyToId: number,
  text: string,
  replyToMessage?: any,
) => ({
  message_id: messageId,
  from: { id: TEST_USER_ID, is_bot: false, first_name: 'User' },
  chat: { id: DISCUSSION_GROUP_ID, type: 'supergroup', username: 'test_group' },
  date: Math.floor(Date.now() / 1000),
  message_thread_id: replyToId,
  reply_to_message:
    replyToMessage || createAutoForwardMessage(replyToId, 100, CHANNEL_CHAT_ID),
  text,
});

const createMessageData = (
  overrides: Partial<GroupMessageData>,
): GroupMessageData => ({
  chatId: DISCUSSION_GROUP_ID,
  chatType: 'supergroup',
  chatTitle: 'Test Channel Chat',
  chatUsername: 'test_group',
  messageId: 100,
  userId: TEST_USER_ID,
  text: 'Test message',
  timestamp: new Date(),
  isReply: false,
  replyToMessageId: null,
  hasPhoto: false,
  hasVideo: false,
  hasDocument: false,
  hasSticker: false,
  hasAudio: false,
  hasVoice: false,
  ...overrides,
});

describe('ImportantMessagesService (integration)', () => {
  let pg: any;
  let module: TestingModule;
  let service: ImportantMessagesService;
  let flow: ImportantMessagesFlow;
  let categorizationService: CategorizationService;

  let importantMessageRepo: Repository<ImportantMessage>;
  let channelRepo: Repository<Channel>;
  let dictionaryRepo: Repository<DictionaryWord>;

  let userChannelsService: UserChannelsService;

  // Общий канал для всех тестов
  let channel: Channel;

  const clearDatabase = async () => {
    await importantMessageRepo.query('DELETE FROM important_messages');
    await dictionaryRepo.query('DELETE FROM dictionary_words');
    await channelRepo.query('DELETE FROM channels');
  };

  const createChannel = async (): Promise<Channel> => {
    let ch = await channelRepo.findOne({
      where: { telegram_chat_id: CHANNEL_CHAT_ID },
    });

    if (!ch) {
      ch = channelRepo.create({
        telegram_chat_id: CHANNEL_CHAT_ID,
        discussion_group_id: DISCUSSION_GROUP_ID,
        username: CHANNEL_USERNAME,
      });
      ch = await channelRepo.save(ch);
    }

    return ch;
  };

  const createDictionary = async (
    category: 'question' | 'lead' | 'negative',
    type: 'base' | 'context',
    words: string[],
    channelOverride?: Channel,
  ) => {
    const dict = dictionaryRepo.create({
      category,
      type,
      words,
      channel: channelOverride || null,
    });
    return dictionaryRepo.save(dict);
  };

  beforeAll(async () => {
    jest.setTimeout(600_000);

    pg = await new PostgreSqlContainer('postgres')
      .withDatabase('important_messages_test')
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
          ImportantMessage,
          DictionaryWord,
          Channel,
          User,
        ]),
      ],
      providers: [
        ImportantMessagesService,
        ImportantMessagesFlow,
        CategorizationService,
        DictionaryService,
        ChannelService,
        QuestionScorer,
        LeadScorer,
        NegativeScorer,
        HypeScorer,
        {
          provide: UserChannelsService,
          useValue: {
            getChannelAdminsByTelegramChatId: jest
              .fn()
              .mockResolvedValue([123, 456]),
          },
        },
      ],
    }).compile();

    service = module.get(ImportantMessagesService);
    flow = module.get(ImportantMessagesFlow);
    categorizationService = module.get(CategorizationService);
    userChannelsService = module.get(UserChannelsService);

    importantMessageRepo = module.get(getRepositoryToken(ImportantMessage));
    channelRepo = module.get(getRepositoryToken(Channel));
    dictionaryRepo = module.get(getRepositoryToken(DictionaryWord));
  });

  afterAll(async () => {
    await module.close();
    await pg.stop();
  });

  beforeEach(async () => {
    await clearDatabase();
    jest.clearAllMocks();

    // Очищаем кеш DictionaryService
    const dictionaryService = module.get(DictionaryService);
    (dictionaryService as any).baseWordsCache.clear();
    (dictionaryService as any).contextWordsCache.clear();

    // Создаем канал для каждого теста
    channel = await createChannel();
  });

  // ==================== A. POST_MESSAGE_ID RESOLUTION ====================

  describe('A. POST_MESSAGE_ID Resolution', () => {
    it('1. Auto-forward from our channel → post_message_id = forward_from_message_id', async () => {
      const message = createAutoForwardMessage(
        100,
        50,
        CHANNEL_CHAT_ID,
        'Test post',
      );
      const ctx = createMockContext(message);

      const postMessageId = await service.resolvePostMessageId(ctx, channel.id);

      expect(postMessageId).toBe(50);
    });

    it('2. First comment on post → post_message_id from reply_to_message', async () => {
      const message = createCommentMessage(101, 100, 'First comment on post');
      const ctx = createMockContext(message);

      const postMessageId = await service.resolvePostMessageId(ctx, channel.id);

      expect(postMessageId).toBe(100);
    });

    it('3. Reply on comment → post_message_id from DB (via reply_to_message.message_id)', async () => {
      // Создаем комментарий в БД с post_message_id
      await importantMessageRepo.save(
        importantMessageRepo.create({
          channel,
          telegram_message_id: 101,
          telegram_user_id: TEST_USER_ID,
          text: 'First comment',
          post_message_id: 50,
          replies_count: 0,
          reactions_count: 0,
        }),
      );

      // Reply на этот комментарий
      const replyMessage = {
        message_id: 102,
        from: { id: TEST_USER_ID, is_bot: false, first_name: 'User' },
        chat: { id: DISCUSSION_GROUP_ID, type: 'supergroup' },
        date: Math.floor(Date.now() / 1000),
        message_thread_id: 100,
        reply_to_message: {
          message_id: 101,
          text: 'First comment',
        },
        text: 'Reply on comment',
      };

      const ctx = createMockContext(replyMessage);
      const postMessageId = await service.resolvePostMessageId(ctx, channel.id);

      expect(postMessageId).toBe(50);
    });

    it('4. Reply chain (reply on reply) → post_message_id inheritance', async () => {
      // Первый комментарий
      await importantMessageRepo.save(
        importantMessageRepo.create({
          channel,
          telegram_message_id: 101,
          telegram_user_id: TEST_USER_ID,
          text: 'First comment',
          post_message_id: 50,
          replies_count: 0,
          reactions_count: 0,
        }),
      );

      // Reply на комментарий
      await importantMessageRepo.save(
        importantMessageRepo.create({
          channel,
          telegram_message_id: 102,
          telegram_user_id: TEST_USER_ID,
          text: 'Reply 1',
          post_message_id: 50,
          replies_count: 0,
          reactions_count: 0,
        }),
      );

      // Reply на reply
      const replyOnReply = {
        message_id: 103,
        from: { id: TEST_USER_ID, is_bot: false },
        chat: { id: DISCUSSION_GROUP_ID, type: 'supergroup' },
        date: Math.floor(Date.now() / 1000),
        message_thread_id: 100,
        reply_to_message: {
          message_id: 102,
          text: 'Reply 1',
        },
        text: 'Reply on reply',
      };

      const ctx = createMockContext(replyOnReply);
      const postMessageId = await service.resolvePostMessageId(ctx, channel.id);

      expect(postMessageId).toBe(50);
    });

    it('5. Foreign channel forward → post_message_id = null', async () => {
      const foreignMessage = createAutoForwardMessage(
        100,
        50,
        -1009999999,
        'Foreign post',
      );
      const ctx = createMockContext(foreignMessage);

      const postMessageId = await service.resolvePostMessageId(ctx, channel.id);

      expect(postMessageId).toBeNull();
    });

    it('6. Fallback via message_thread_id → finds post_message_id', async () => {
      // Создаем запись поста (thread root)
      await importantMessageRepo.save(
        importantMessageRepo.create({
          channel,
          telegram_message_id: 100,
          telegram_user_id: 777000,
          text: 'Post',
          post_message_id: 50,
          replies_count: 0,
          reactions_count: 0,
        }),
      );

      // Сообщение без reply_to_message, но с message_thread_id
      const message = {
        message_id: 105,
        from: { id: TEST_USER_ID, is_bot: false },
        chat: { id: DISCUSSION_GROUP_ID, type: 'supergroup' },
        date: Math.floor(Date.now() / 1000),
        message_thread_id: 100,
        text: 'Comment without reply_to',
      };

      const ctx = createMockContext(message);
      const postMessageId = await service.resolvePostMessageId(ctx, channel.id);

      expect(postMessageId).toBe(50);
    });
  });

  // ==================== B. СОХРАНЕНИЕ СООБЩЕНИЙ ====================

  describe('B. Сохранение сообщений', () => {
    it('7. Auto-forward post → NOT saved', async () => {
      const message = createAutoForwardMessage(
        100,
        50,
        CHANNEL_CHAT_ID,
        'Test post',
      );
      const ctx = createMockContext(message);
      const messageData = createMessageData({
        messageId: 100,
        text: 'Test post',
      });

      const savedId = await service.saveImportantMessage(messageData, ctx);

      expect(savedId).toBeNull();

      const count = await importantMessageRepo.count();
      expect(count).toBe(0);
    });

    it('8. Comment with categories → saved with post_message_id', async () => {
      await createDictionary('question', 'base', ['как', 'что', 'зачем']);

      const message = createCommentMessage(101, 100, 'как это работает?');
      const ctx = createMockContext(message);
      const messageData = createMessageData({
        messageId: 101,
        text: 'как это работает?',
        isReply: true,
        replyToMessageId: 100,
      });

      const savedId = await service.saveImportantMessage(messageData, ctx);

      expect(savedId).toBeDefined();

      const saved = await importantMessageRepo.findOne({
        where: { id: savedId },
      });
      expect(Number(saved.post_message_id)).toBe(100);
      expect(Number(saved.telegram_message_id)).toBe(101);
    });

    it('9. Short message → saved BUT no notification (no categories)', async () => {
      const message = createCommentMessage(101, 100, 'ok');
      const ctx = createMockContext(message);
      const messageData = createMessageData({
        messageId: 101,
        text: 'ok',
        isReply: true,
        replyToMessageId: 100,
      });

      // Сохраняется
      const savedId = await service.saveImportantMessage(messageData, ctx);
      expect(savedId).toBeDefined();

      // Но категорий нет (слишком короткое)
      const categories = await service.processGroupMessage(messageData);
      expect(categories).toBeNull();
    });

    it('10. Duplicate message → returns existing.id, no new record', async () => {
      const message = createCommentMessage(101, 100, 'test message here');
      const ctx = createMockContext(message);
      const messageData = createMessageData({
        messageId: 101,
        text: 'test message here',
      });

      const firstId = await service.saveImportantMessage(messageData, ctx);
      const secondId = await service.saveImportantMessage(messageData, ctx);

      expect(firstId).toBe(secondId);

      const count = await importantMessageRepo.count();
      expect(count).toBe(1);
    });
  });

  // ==================== C. КАТЕГОРИЗАЦИЯ ====================

  describe('C. Категоризация', () => {
    it('11. Message with "?" + base word → category "question" (score >= 4)', async () => {
      await createDictionary('question', 'base', ['как', 'что', 'почему']);

      const result = await categorizationService.categorizeMessage({
        text: 'как это работает?',
        channelId: channel.id,
      });

      expect(result.categories).toContain('question');
      expect(result.scores.question).toBeGreaterThanOrEqual(4);
    });

    it('12. Message with "?" only → NO category (score < 4)', async () => {
      const result = await categorizationService.categorizeMessage({
        text: 'ты тут?',
        channelId: channel.id,
      });

      expect(result.categories).not.toContain('question');
      expect(result.scores.question).toBeLessThan(4);
    });

    it('13. Message with base lead word → category "lead" (score >= 6)', async () => {
      await createDictionary('lead', 'base', [
        'купить',
        'цена',
        'стоимость',
        'заказать',
      ]);

      const result = await categorizationService.categorizeMessage({
        text: 'где можно купить ваш продукт?',
        channelId: channel.id,
      });

      expect(result.categories).toContain('lead');
      expect(result.scores.lead).toBeGreaterThanOrEqual(6);
    });

    it('14. Message with "?" + base lead word → bonus score, category "lead"', async () => {
      await createDictionary('lead', 'base', ['купить', 'заказать']);

      const result = await categorizationService.categorizeMessage({
        text: 'как я могу купить это?',
        channelId: channel.id,
      });

      expect(result.categories).toContain('lead');
      expect(result.scores.lead).toBeGreaterThanOrEqual(6);
    });

    it('15. Message with base negative word → category "negative" (score >= 4)', async () => {
      await createDictionary('negative', 'base', [
        'не работает',
        'плохо',
        'ужасно',
      ]);

      const result = await categorizationService.categorizeMessage({
        text: 'у вас всё не работает',
        channelId: channel.id,
      });

      expect(result.categories).toContain('negative');
      expect(result.scores.negative).toBeGreaterThanOrEqual(4);
    });

    it('16. Message with multiple category words → all categories found', async () => {
      await createDictionary('question', 'base', ['как', 'что']);
      await createDictionary('lead', 'base', ['купить']);
      await createDictionary('negative', 'base', ['не работает']);

      const result = await categorizationService.categorizeMessage({
        text: 'как купить если у вас всё не работает?',
        channelId: channel.id,
      });

      expect(result.categories).toContain('question');
      expect(result.categories).toContain('lead');
      expect(result.categories).toContain('negative');
    });

    it('17. No matching words → no categories (empty array)', async () => {
      const result = await categorizationService.categorizeMessage({
        text: 'обычное сообщение без ключевых слов',
        channelId: channel.id,
      });

      expect(result.categories).toEqual([]);
    });

    it('18. Case insensitivity → "КАК" = "как" = works', async () => {
      await createDictionary('question', 'base', ['как']);

      const result = await categorizationService.categorizeMessage({
        text: 'КАК это работает?',
        channelId: channel.id,
      });

      expect(result.categories).toContain('question');
    });
  });

  // ==================== D. HYPE TRACKING ====================

  describe('D. Hype Tracking', () => {
    it('19. Reply on comment → replies_count++', async () => {
      // Создаем комментарий
      const comment = await importantMessageRepo.save(
        importantMessageRepo.create({
          channel,
          telegram_message_id: 101,
          telegram_user_id: TEST_USER_ID,
          text: 'Test comment',
          post_message_id: 50,
          replies_count: 0,
          reactions_count: 0,
        }),
      );

      // Reply на него
      await service.incrementRepliesCount(channel.id, 101);

      const updated = await importantMessageRepo.findOne({
        where: { id: comment.id },
      });
      expect(updated.replies_count).toBe(1);
    });

    it('20. Reply on auto-forward post → post NOT created (saveMessageForHypeTracking skips)', async () => {
      const replyMessage = createCommentMessage(101, 100, 'Reply on post');
      const ctx = createMockContext(replyMessage);

      await service.saveMessageForHypeTracking(channel.id, 100, ctx);

      const count = await importantMessageRepo.count({
        where: { telegram_message_id: 100 },
      });
      expect(count).toBe(0);
    });

    it('21. Reaction added → reactions_count updated correctly', async () => {
      const message = await importantMessageRepo.save(
        importantMessageRepo.create({
          channel,
          telegram_message_id: 101,
          telegram_user_id: TEST_USER_ID,
          text: 'Test',
          reactions_count: 0,
          replies_count: 0,
        }),
      );

      await service.updateReactionsCount(channel.id, 101, 3);

      const updated = await importantMessageRepo.findOne({
        where: { id: message.id },
      });
      expect(updated.reactions_count).toBe(3);
    });

    it('22. Hype threshold reached (5 reactions + 3 replies) → checkHypeThreshold = true', async () => {
      await importantMessageRepo.save(
        importantMessageRepo.create({
          channel,
          telegram_message_id: 101,
          telegram_user_id: TEST_USER_ID,
          text: 'Hyped message',
          reactions_count: 5,
          replies_count: 3,
          hype_notified_at: null,
        }),
      );

      const shouldNotify = await service.checkHypeThreshold(channel.id, 101);
      expect(shouldNotify).toBe(true);
    });

    it('23. Hype notification sent once → hype_notified_at set, second notification blocked', async () => {
      await importantMessageRepo.save(
        importantMessageRepo.create({
          channel,
          telegram_message_id: 101,
          telegram_user_id: TEST_USER_ID,
          text: 'Hyped',
          reactions_count: 5,
          replies_count: 3,
          hype_notified_at: null,
        }),
      );

      // Первый раз - должно быть true
      let shouldNotify = await service.checkHypeThreshold(channel.id, 101);
      expect(shouldNotify).toBe(true);

      // Устанавливаем hype_notified_at
      await service.updateHypeNotifiedAt(channel.id, 101);

      // Второй раз - должно быть false
      shouldNotify = await service.checkHypeThreshold(channel.id, 101);
      expect(shouldNotify).toBe(false);
    });
  });

  // ==================== E. ССЫЛКИ ====================

  describe('E. Ссылки', () => {
    it('24. Comment on our channel post → buildCommentLink(channel.username, post_id, comment_id)', async () => {
      await createDictionary('question', 'base', ['как']);

      const message = createCommentMessage(101, 100, 'как это работает?');
      const ctx = createMockContext(message);
      const messageData = createMessageData({
        messageId: 101,
        text: 'как это работает?',
        chatUsername: 'test_group',
      });

      // Сохраняем сообщение
      const savedId = await service.saveImportantMessage(messageData, ctx);

      // Проверяем что Flow формирует правильную ссылку
      const savedMessage = await service.getById(savedId);
      expect(Number(savedMessage.post_message_id)).toBe(100);
      expect(savedMessage.channel.username).toBe(CHANNEL_USERNAME);

      // Ссылка должна быть: https://t.me/test_channel/100?comment=101
    });

    it('25. Comment on foreign post → buildMessageLink(discussion_group_id, comment_id)', async () => {
      const foreignPost = createAutoForwardMessage(100, 50, -1009999999);
      const message = {
        message_id: 101,
        from: { id: TEST_USER_ID, is_bot: false },
        chat: { id: DISCUSSION_GROUP_ID, type: 'supergroup' },
        date: Math.floor(Date.now() / 1000),
        reply_to_message: foreignPost,
        text: 'comment on foreign post',
      };

      const ctx = createMockContext(message);
      const messageData = createMessageData({
        messageId: 101,
        text: 'comment on foreign post',
      });

      const savedId = await service.saveImportantMessage(messageData, ctx);
      const saved = await service.getById(savedId);

      expect(saved.post_message_id).toBeNull();
      expect(Number(saved.channel.discussion_group_id)).toBe(
        DISCUSSION_GROUP_ID,
      );

      // Ссылка должна быть: https://t.me/c/3037139078/101
    });

    it('26. Uses channel.username from DB (not messageData.chatUsername)', async () => {
      const message = await importantMessageRepo.save(
        importantMessageRepo.create({
          channel,
          telegram_message_id: 101,
          telegram_user_id: TEST_USER_ID,
          text: 'Test',
          post_message_id: 50,
          replies_count: 0,
          reactions_count: 0,
        }),
      );

      const loaded = await service.getById(message.id);
      expect(loaded.channel.username).toBe(CHANNEL_USERNAME);
      expect(loaded.channel.username).not.toBe('test_group');
    });
  });

  // ==================== F. УВЕДОМЛЕНИЯ АДМИНАМ ====================

  describe('F. Уведомления админам', () => {
    it('27. Finds admins by channel.telegram_chat_id', async () => {
      await createDictionary('question', 'base', ['как']);

      const message = createCommentMessage(101, 100, 'как это работает?');
      const ctx = createMockContext(message);
      const messageData = createMessageData({
        messageId: 101,
        text: 'как это работает?',
      });

      await flow.handleGroupMessage(ctx, messageData);

      expect(
        userChannelsService.getChannelAdminsByTelegramChatId,
      ).toHaveBeenCalledWith(
        String(CHANNEL_CHAT_ID), // TypeORM возвращает bigint как string
      );
    });

    it('28. Sends notification to all admins', async () => {
      await createDictionary('question', 'base', ['как']);

      const message = createCommentMessage(101, 100, 'как это работает?');
      const ctx = createMockContext(message);
      const messageData = createMessageData({
        messageId: 101,
        text: 'как это работает?',
      });

      await flow.handleGroupMessage(ctx, messageData);

      expect(ctx.telegram.sendMessage).toHaveBeenCalledTimes(2); // 2 админа
    });

    it('29. No admins → warning logged, no notification sent', async () => {
      await createDictionary('question', 'base', ['как']);

      (
        userChannelsService.getChannelAdminsByTelegramChatId as jest.Mock
      ).mockResolvedValueOnce([]);

      const message = createCommentMessage(101, 100, 'как это работает?');
      const ctx = createMockContext(message);
      const messageData = createMessageData({
        messageId: 101,
        text: 'как это работает?',
      });

      await flow.handleGroupMessage(ctx, messageData);

      expect(ctx.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('30. Updates notified_at after important message notification', async () => {
      await createDictionary('question', 'base', ['как']);

      const message = createCommentMessage(101, 100, 'как это работает?');
      const ctx = createMockContext(message);
      const messageData = createMessageData({
        messageId: 101,
        text: 'как это работает?',
      });

      await flow.handleGroupMessage(ctx, messageData);

      const saved = await importantMessageRepo.findOne({
        where: { telegram_message_id: 101 },
      });

      expect(saved.notified_at).not.toBeNull();
    });
  });

  // ==================== G. INTEGRATION & EDGE CASES ====================

  describe('G. Integration & Edge Cases', () => {
    it('31. Full flow: post → comment → reply → categories → notification → hype', async () => {
      await createDictionary('question', 'base', ['как']);

      // 1. Post (автофорвард) - не сохраняется
      const post = createAutoForwardMessage(100, 50, CHANNEL_CHAT_ID);
      const postCtx = createMockContext(post);
      const postData = createMessageData({ messageId: 100, text: 'Test post' });

      const postSavedId = await service.saveImportantMessage(postData, postCtx);
      expect(postSavedId).toBeNull();

      // 2. Comment - сохраняется с категорией
      const comment = createCommentMessage(101, 100, 'как это работает?');
      const commentCtx = createMockContext(comment);
      const commentData = createMessageData({
        messageId: 101,
        text: 'как это работает?',
      });

      await flow.handleGroupMessage(commentCtx, commentData);

      const savedComment = await importantMessageRepo.findOne({
        where: { telegram_message_id: 101 },
      });

      expect(savedComment).toBeDefined();
      expect(Number(savedComment.post_message_id)).toBe(100);
      expect(savedComment.notified_at).not.toBeNull();

      // 3. Reply на комментарий
      const reply = {
        message_id: 102,
        from: { id: TEST_USER_ID, is_bot: false },
        chat: { id: DISCUSSION_GROUP_ID, type: 'supergroup' },
        date: Math.floor(Date.now() / 1000),
        message_thread_id: 100,
        reply_to_message: {
          message_id: 101,
          text: 'как это работает?',
        },
        text: 'вот так',
      };

      const replyCtx = createMockContext(reply);

      await flow.handleReply(replyCtx, DISCUSSION_GROUP_ID, 101);

      const updatedComment = await importantMessageRepo.findOne({
        where: { telegram_message_id: 101 },
      });

      expect(updatedComment.replies_count).toBe(1);

      // 4. Hype - добавляем реакции и проверяем
      await service.updateReactionsCount(channel.id, 101, 5);
      await service.incrementRepliesCount(channel.id, 101);
      await service.incrementRepliesCount(channel.id, 101);

      const shouldNotify = await service.checkHypeThreshold(channel.id, 101);
      expect(shouldNotify).toBe(true);
    });

    it('32. Pagination: >100 comments on single post processed correctly', async () => {
      // Создаем 150 комментариев
      const messages = [];
      for (let i = 1; i <= 150; i++) {
        messages.push(
          importantMessageRepo.create({
            channel,
            telegram_message_id: 100 + i,
            telegram_user_id: TEST_USER_ID,
            text: `Comment ${i}`,
            post_message_id: 50,
            replies_count: 0,
            reactions_count: 0,
          }),
        );
      }

      await importantMessageRepo.save(messages);

      const count = await importantMessageRepo.count({
        where: { post_message_id: 50 },
      });

      expect(count).toBe(150);
    });

    it('33. Dictionary caching: base words cached, context words with TTL', async () => {
      const dictionaryService = module.get(DictionaryService);

      await createDictionary('question', 'base', ['как', 'что']);
      await createDictionary('question', 'context', ['продукт'], channel);

      // Первый вызов - загружает из БД
      const baseWords1 = await dictionaryService.getBaseWords('question');
      expect(baseWords1.size).toBe(2);

      // Второй вызов - берет из кеша
      const baseWords2 = await dictionaryService.getBaseWords('question');
      expect(baseWords2).toBe(baseWords1); // Тот же Set объект

      // Context словарь
      const contextWords = await dictionaryService.getContextWords(
        'question',
        channel.id,
      );
      expect(contextWords.size).toBe(1);
    });
  });
});
