import { Injectable } from '@nestjs/common';

export type UserStateScope =
  | 'summary-channel'
  | 'important-messages'
  | 'core-channel-users';

export type UserStateStep =
  | 'waiting_for_summary_channel_name'
  | 'waiting_for_important_messages_channel_name'
  | 'waiting_for_core_channel_users_channel_name';

export interface UserState {
  scope: UserStateScope;
  step: UserStateStep;
  meta?: Record<string, any>;
}

@Injectable()
export class UserStateService {
  private readonly stateMap = new Map<number, UserState>();

  async get(userId: number): Promise<UserState | null> {
    return this.stateMap.get(userId) ?? null;
  }

  async set(userId: number, state: UserState): Promise<void> {
    this.stateMap.set(userId, state);
  }

  async clear(userId: number): Promise<void> {
    this.stateMap.delete(userId);
  }
}
