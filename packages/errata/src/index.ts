export {
  createErrorClient,
  ErrataClientError,
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
export { ErrataError, type SerializedError } from './errata-error'
export type {
  ClientConfig,
  ClientContext,
  CodeConfig,
  CodeConfigRecord,
  CodesOf,
  DetailsOf,
  ErrataClientErrorForCodes,
  ErrataClientPlugin,
  ErrataConfig,
  ErrataContext,
  ErrataErrorForCodes,
  ErrataPlugin,
  InternalCode,
  InternalDetails,
  MatchingCodes,
  MatchingCodesFromUnion,
  MatchingErrataClientError,
  MatchingErrataClientErrorForCodes,
  MatchingErrataError,
  MatchingErrataErrorForCodes,
  MergePluginCodes,
  MessageResolver,
  Pattern,
  PatternForCodes,
  PatternInputForCodes,
  PluginCodes,
  ResolveMatchingCodes,
  ResolveMatchingCodesFromUnion,
} from './types'
export {
  findBestMatchingPattern,
  getWildcardPrefix,
  isWildcardPattern,
  matchesPattern,
} from './utils/pattern-matching'
