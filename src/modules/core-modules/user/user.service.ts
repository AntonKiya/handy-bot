import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async upsertTelegramUser(
    telegramUserId: number,
    username: string | null,
  ): Promise<User> {
    const existing = await this.userRepository.findOne({
      where: { telegram_user_id: telegramUserId },
    });

    if (!existing) {
      const created = this.userRepository.create({
        telegram_user_id: telegramUserId,
        username,
      });

      return this.userRepository.save(created);
    }

    if (existing.username !== username) {
      existing.username = username;
      return this.userRepository.save(existing);
    }

    return existing;
  }
}
