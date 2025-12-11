export { AppError, type SerializedError } from './app-error'
export {
  betterErrors,
  type BetterErrorsInstance,
  type BetterErrorsOptions,
  type MatchHandlers,
} from './better-errors'
export {
  ClientAppError,
  createErrorClient,
  type ErrorClient,
  type ErrorClientOptions,
} from './client'
export { code, defineCodes, props } from './define-codes'
export type {
  BetterErrorsClientPlugin,
  BetterErrorsConfig,
  BetterErrorsContext,
  BetterErrorsPlugin,
  ClientConfig,
  ClientContext,
  CodeConfig,
  CodeConfigRecord,
  CodesOf,
  DetailsOf,
  MatchingAppError,
  MatchingClientAppError,
  MatchingCodes,
  MergePluginCodes,
  MessageResolver,
  Pattern,
  PluginCodes,
  ResolveMatchingCodes,
} from './types'
export {
  findBestMatchingPattern,
  getWildcardPrefix,
  isWildcardPattern,
  matchesPattern,
} from './utils/pattern-matching'
