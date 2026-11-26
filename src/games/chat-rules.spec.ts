import { describe, expect, it } from 'vitest';

import { chatAllowed } from './chat-rules.js';

const player = (chatWithStrangers = false, isGuest = false) => ({
  isGuest,
  chatWithStrangers,
});
const strangers = { friends: false, blocked: false };
const friends = { friends: true, blocked: false };

describe('chatAllowed', () => {
  it('lets friends chat whatever their setting', () => {
    expect(chatAllowed(player(), player(), friends)).toBe(true);
  });

  it('lets strangers chat only when both have chosen to', () => {
    expect(chatAllowed(player(), player(), strangers)).toBe(false);
    expect(chatAllowed(player(true), player(), strangers)).toBe(false);
    expect(chatAllowed(player(true), player(true), strangers)).toBe(true);
  });

  it('never lets a guest chat, or two players with a block', () => {
    expect(chatAllowed(player(true, true), player(true), strangers)).toBe(
      false,
    );
    expect(
      chatAllowed(player(), player(), { friends: true, blocked: true }),
    ).toBe(false);
  });
});
