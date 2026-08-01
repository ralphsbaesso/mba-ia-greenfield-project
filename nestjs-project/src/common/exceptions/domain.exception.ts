export abstract class DomainException extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class EmailAlreadyExistsException extends DomainException {
  constructor() {
    super('EMAIL_ALREADY_EXISTS', 409, 'Email is already registered');
  }
}

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
}

export class EmailNotConfirmedException extends DomainException {
  constructor() {
    super('EMAIL_NOT_CONFIRMED', 403, 'Email address has not been confirmed');
  }
}

export class InvalidTokenException extends DomainException {
  constructor() {
    super('INVALID_TOKEN', 401, 'Token is invalid');
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super('TOKEN_EXPIRED', 401, 'Token has expired');
  }
}

/**
 * Phase 02 creates the channel at signup with `cascade`, so a `sub` that resolves
 * to no channel is an invariant violation, not a user-facing input error
 * (video-authorization-and-metadata/TD-02).
 */
export class ChannelMissingForUserException extends DomainException {
  constructor() {
    super('CHANNEL_MISSING_FOR_USER', 500, 'Authenticated user has no channel');
  }
}

/**
 * Also the answer for an owner route reached by a non-owner: a `403` would confirm
 * the video exists, turning the route into an existence oracle
 * (video-authorization-and-metadata/TD-03).
 */
export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

/** A guarded transition was rejected (phase-03-videos/TD-12, TD-13, TD-14). */
export class InvalidVideoStateException extends DomainException {
  constructor() {
    super(
      'INVALID_VIDEO_STATE',
      409,
      'Video is not in a state that allows this operation',
    );
  }
}

export class TokenReuseDetectedException extends DomainException {
  constructor() {
    super(
      'TOKEN_REUSE_DETECTED',
      401,
      'Token reuse detected — all sessions revoked',
    );
  }
}
