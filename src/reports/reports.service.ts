import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import { RefreshToken } from '../auth/entities/refresh-token.entity.js';
import { DOMAIN_EVENTS } from '../common/events.js';
import { SlidingWindowLimiter } from '../common/sliding-window-limiter.js';
import type { AppConfig } from '../config/configuration.js';
import { GameChatMessage } from '../games/entities/game-chat-message.entity.js';
import { Mailer } from '../mail/mailer.js';
import { DirectMessage } from '../messages/entities/direct-message.entity.js';
import { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import type { CreateReportDto } from './dto/create-report.dto.js';
import { Report, type ReportStatus } from './entities/report.entity.js';
import { reportEmail } from './report-email.js';

export const REPORTS_PER_HOUR = { messages: 10, perMs: 60 * 60 * 1000 };

/** Players reporting players, and what the support address does about
 * it: suspending an account, taking a message down, closing the report. */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly limiter = new SlidingWindowLimiter(
    REPORTS_PER_HOUR,
    'Too many reports - try again later',
  );

  constructor(
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly events: EventEmitter2,
  ) {}

  async create(reporterId: string, dto: CreateReportDto): Promise<Report> {
    const reporter = await this.usersService.findByIdOrThrow(reporterId);
    const reported = await this.usersService.findByUsername(dto.username);
    if (!reported || reported.accountDeletedAt) {
      throw new NotFoundException('User not found');
    }
    if (reported.id === reporterId) {
      throw new BadRequestException("You can't report yourself");
    }
    if (this.config.get('authRateLimits', { infer: true })) {
      this.limiter.recordOrThrow(reporterId);
    }
    const messageText = dto.messageId
      ? await this.reportedMessage(dto, reporterId, reported.id)
      : null;

    const report = await this.reports.save(
      this.reports.create({
        reporterId,
        reportedUserId: reported.id,
        reason: dto.reason,
        details: dto.details?.trim() || null,
        gameId: dto.gameId ?? null,
        messageId: dto.messageId ?? null,
        messageText,
        status: 'open',
      }),
    );
    try {
      await this.mailer.send({
        to: this.config.get('mail.supportEmail', { infer: true }),
        ...reportEmail(report, reporter.username, reported.username),
      });
    } catch (error) {
      this.logger.error(
        `could not mail report ${report.id}: ${(error as Error).message}`,
      );
    }
    return report;
  }

  /** The words of the message reported - only one the reported player
   * wrote, and the reporter could see. */
  private async reportedMessage(
    dto: CreateReportDto,
    reporterId: string,
    reportedId: string,
  ): Promise<string> {
    if (dto.gameId) {
      const message = await this.dataSource
        .getRepository(GameChatMessage)
        .findOne({
          where: { id: dto.messageId, gameId: dto.gameId, userId: reportedId },
          relations: { game: true },
        });
      const game = message?.game;
      if (
        message &&
        game &&
        (game.whiteId === reporterId || game.blackId === reporterId)
      ) {
        return message.text;
      }
    } else {
      const message = await this.dataSource
        .getRepository(DirectMessage)
        .findOne({
          where: {
            id: dto.messageId,
            senderId: reportedId,
            recipientId: reporterId,
          },
        });
      if (message) return message.text;
    }
    throw new NotFoundException('Message not found');
  }

  list(status: ReportStatus = 'open'): Promise<Report[]> {
    return this.reports.find({
      where: { status },
      relations: { reporter: true, reportedUser: true },
      order: { createdAt: 'ASC' },
    });
  }

  async resolve(reportId: string): Promise<void> {
    const { affected } = await this.reports.update(
      { id: reportId },
      { status: 'resolved' },
    );
    if (!affected) throw new NotFoundException('Report not found');
  }

  /** Signs the player out everywhere and keeps them out until unsuspended. */
  async suspend(username: string): Promise<void> {
    const user = await this.userOrThrow(username);
    await this.dataSource
      .getRepository(User)
      .update({ id: user.id }, { suspendedAt: new Date() });
    await this.dataSource
      .getRepository(RefreshToken)
      .update({ userId: user.id, revoked: false }, { revoked: true });
    this.events.emit(DOMAIN_EVENTS.USER_SUSPENDED, { userId: user.id });
  }

  async unsuspend(username: string): Promise<void> {
    const user = await this.userOrThrow(username);
    await this.dataSource
      .getRepository(User)
      .update({ id: user.id }, { suspendedAt: null });
  }

  /** Marks an account a computer opponent (User.isBot), or no longer. A
   * seek already waiting keeps what it was until it's made again. */
  async setBot(username: string, isBot: boolean): Promise<void> {
    const user = await this.userOrThrow(username);
    await this.dataSource
      .getRepository(User)
      .update({ id: user.id }, { isBot });
  }

  /** Takes a message down - soft-deleted, gone from both players at once
   * and erased for good by the purge; its copy kept in the report. */
  async deleteMessage(
    kind: 'game-chat' | 'direct-message',
    messageId: string,
  ): Promise<void> {
    const { affected } = await this.dataSource
      .getRepository(kind === 'game-chat' ? GameChatMessage : DirectMessage)
      // deletedAt in the criteria: one already taken down is not found.
      .softDelete({ id: messageId, deletedAt: IsNull() });
    if (!affected) throw new NotFoundException('Message not found');
  }

  private async userOrThrow(username: string): Promise<User> {
    const user = await this.usersService.findByUsername(username);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
