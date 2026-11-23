/** What decides whether a game's two players can chat. */
export interface ChatPlayer {
  isGuest: boolean;
  /** Whether they chat with players who aren't their friends. */
  chatWithStrangers: boolean;
}

/** Friends always can; anyone else only when both have chosen to chat
 * with strangers. Never a guest - too easy to make anew to block - and
 * never two players either of whom has blocked the other. */
export function chatAllowed(
  white: ChatPlayer,
  black: ChatPlayer,
  between: { friends: boolean; blocked: boolean },
): boolean {
  if (white.isGuest || black.isGuest || between.blocked) return false;
  return (
    between.friends || (white.chatWithStrangers && black.chatWithStrangers)
  );
}
