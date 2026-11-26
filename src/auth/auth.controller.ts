import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { AccountEmailService } from './account-email.service.js';
import { AuthService } from './auth.service.js';
import {
  ChangeEmailDto,
  EmailTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/account-email.dto.js';
import { AuthResponseDto } from './dto/auth-response.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import type { AuthenticatedUser } from './types.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly accountEmail: AccountEmailService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Create an account, and email a link to verify its address',
  })
  register(
    @Body() dto: RegisterDto,
    @Ip() ip: string,
  ): Promise<AuthResponseDto> {
    return this.authService.register(dto, ip);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with username/email + password' })
  login(@Body() dto: LoginDto, @Ip() ip: string): Promise<AuthResponseDto> {
    return this.authService.login(dto, ip);
  }

  @Public()
  @Post('guest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a temporary guest account and log in as it',
  })
  loginAsGuest(@Ip() ip: string): Promise<AuthResponseDto> {
    return this.authService.loginAsGuest(ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  refresh(@Body() dto: RefreshDto): Promise<AuthResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  @Public()
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Use an emailed link: confirm the address, or switch to a new one',
  })
  verifyEmail(@Body() dto: EmailTokenDto): Promise<{ email: string }> {
    return this.accountEmail.verify(dto.token);
  }

  @ApiBearerAuth()
  @Post('email/verification')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Email a new link to verify the address' })
  async resendVerification(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.accountEmail.resendVerification(user.userId);
  }

  @ApiBearerAuth()
  @Post('email/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Email a link to confirm a new address; it changes once the link is used',
  })
  async changeEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangeEmailDto,
  ): Promise<void> {
    await this.accountEmail.requestEmailChange(
      user.userId,
      dto.email,
      dto.password,
    );
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Email a reset link, if the address has an account - the reply never says whether it does',
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Ip() ip: string,
  ): Promise<void> {
    await this.accountEmail.requestPasswordReset(dto.email, ip);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set a new password from a reset link; signs every device out',
  })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.accountEmail.resetPassword(dto.token, dto.password);
  }
}
