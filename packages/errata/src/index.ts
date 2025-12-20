export {
  ClientAppError,
  createErrorClient,
  type ErrorClient,
  type ErrorClientOptions,
} from './client'
export { code, defineClientPlugin, defineCodes, definePlugin, props } from './define'
export {
  errata,
  type ErrataInstance,
  type ErrataOptions,
  type MatchHandlers,
} from './errata'
export { AppError, type SerializedError } from './errata-error'
export type {
  ClientConfig,
  ClientContext,
  CodeConfig,
  CodeConfigRecord,
  CodesOf,
  DetailsOf,
  ErrataClientPlugin,
  ErrataConfig,
  ErrataContext,
  ErrataPlugin,
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
