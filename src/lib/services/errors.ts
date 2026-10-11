/** Errors safe to show to the user (no internals, no secrets). */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export class NotFoundError extends UserError {
  constructor(what = "Record") {
    super(`${what} not found for the active profile.`);
    this.name = "NotFoundError";
  }
}
