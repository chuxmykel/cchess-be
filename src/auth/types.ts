/** The shape attached to `request.user` / socket auth after JWT verification. */
export interface AuthenticatedUser {
  userId: string;
  username: string;
  isGuest: boolean;
}

export interface AccessTokenPayload {
  sub: string;
  username: string;
  isGuest: boolean;
}
