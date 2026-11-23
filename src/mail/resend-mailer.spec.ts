import { afterEach, describe, expect, it, vi } from 'vitest';

import { RESEND_URL, ResendMailer } from './resend-mailer.js';

describe('ResendMailer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the email to Resend with the key and sender', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);

    await new ResendMailer('re_key', 'cchess <no-reply@mail.test>').send({
      to: 'a@b.test',
      subject: 'Hi',
      text: 'Hello',
      replyTo: 'c@d.test',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(RESEND_URL);
    expect(init.headers.Authorization).toBe('Bearer re_key');
    expect(JSON.parse(init.body)).toEqual({
      from: 'cchess <no-reply@mail.test>',
      to: ['a@b.test'],
      subject: 'Hi',
      text: 'Hello',
      reply_to: 'c@d.test',
    });
  });

  it('throws with what Resend said when it refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('domain not verified', { status: 403 }),
        ),
    );
    await expect(
      new ResendMailer('k', 'f').send({
        to: 'a@b.test',
        subject: 's',
        text: 't',
      }),
    ).rejects.toThrow('Resend refused the email (403): domain not verified');
  });
});
