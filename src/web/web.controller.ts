import { Controller, Get, Header, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';

import { MIN_PASSWORD_LENGTH } from '../auth/dto/register.dto.js';
import { Public } from '../common/decorators/public.decorator.js';
import type { AppConfig } from '../config/configuration.js';
import { PRIVACY_VERSION, TERMS_VERSION } from '../legal/legal.js';
import { androidAssetLinks, appleAppSiteAssociation } from './app-links.js';
import {
  deleteAccountPage,
  privacyPage,
  termsPage,
} from './pages/legal-pages.js';
import { resetPasswordPage, verifyEmailPage } from './pages/link-pages.js';

const HTML = 'text/html; charset=utf-8';

/** What the app reads before signing in, and what the stores and the
 * players' browsers need from the server: the legal pages, how to delete
 * an account, the pages behind email links, and the app-link files. */
@ApiTags('app')
@Public()
@Controller()
export class WebController {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  private get supportEmail(): string {
    return this.config.get('mail.supportEmail', { infer: true });
  }

  @Get('app/config')
  @ApiOperation({
    summary:
      'What the app checks on launch: the oldest version still supported, the terms in force, where to get help',
  })
  appConfig() {
    const base = this.config.get('publicUrl', { infer: true });
    return {
      minimumVersion: this.config.get('app.minimumVersion', { infer: true }),
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      supportEmail: this.supportEmail,
      termsUrl: `${base}/legal/terms`,
      privacyUrl: `${base}/legal/privacy`,
      deleteAccountUrl: `${base}/account/delete`,
    };
  }

  @Get('legal/privacy')
  @Header('Content-Type', HTML)
  @ApiExcludeEndpoint()
  privacy(): string {
    return privacyPage(this.supportEmail, PRIVACY_VERSION);
  }

  @Get('legal/terms')
  @Header('Content-Type', HTML)
  @ApiExcludeEndpoint()
  terms(): string {
    return termsPage(this.supportEmail, TERMS_VERSION);
  }

  @Get('account/delete')
  @Header('Content-Type', HTML)
  @ApiExcludeEndpoint()
  deleteAccount(): string {
    return deleteAccountPage(this.supportEmail);
  }

  @Get('app/verify-email')
  @Header('Content-Type', HTML)
  @ApiExcludeEndpoint()
  verifyEmail(): string {
    return verifyEmailPage(this.supportEmail);
  }

  @Get('app/reset-password')
  @Header('Content-Type', HTML)
  @ApiExcludeEndpoint()
  resetPassword(): string {
    return resetPasswordPage(MIN_PASSWORD_LENGTH, this.supportEmail);
  }

  @Get('.well-known/apple-app-site-association')
  @Header('Content-Type', 'application/json')
  @ApiExcludeEndpoint()
  appleAppSiteAssociation(): object {
    const association = appleAppSiteAssociation(
      this.config.get('app.appleTeamId', { infer: true }),
      this.config.get('app.bundleId', { infer: true }),
    );
    if (!association) throw new NotFoundException();
    return association;
  }

  @Get('.well-known/assetlinks.json')
  @ApiExcludeEndpoint()
  assetLinks(): object[] {
    return androidAssetLinks(
      this.config.get('app.bundleId', { infer: true }),
      this.config.get('app.androidCertSha256', { infer: true }),
    );
  }
}
