/**
 * Errors the user is expected to hit and can act on: a missing path, a config
 * typo, a baseline that is not there. The CLI prints these as a single line
 * without a stack trace, and reserves the stack for genuine bugs.
 */
export class NestMaintainabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NestMaintainabilityError";
  }
}
