export { AppError, type SerializedError } from './app-error'
export {
  betterErrors,
  type BetterErrorsInstance,
  type BetterErrorsOptions,
  type BetterErrorsPlugin,
  type MatchHandlers,
} from './better-errors'
export { ClientAppError, createErrorClient, type ErrorClient } from './client'
export { code, defineCodes, props } from './define-codes'
export type {
  CodeConfig,
  CodesOf,
  DetailsOf,
  MatchingAppError,
  MatchingClientAppError,
  MatchingCodes,
  MessageResolver,
  Pattern,
  ResolveMatchingCodes,
} from './types'
export {
  findBestMatchingPattern,
  getWildcardPrefix,
  isWildcardPattern,
  matchesPattern,
} from './utils/pattern-matching'
