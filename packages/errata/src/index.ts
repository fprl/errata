export {
  type ClientMatchHandlers,
  createErrataClient,
  type ErrataClient,
  ErrataClientError,
  type ErrataClientOptions,
} from './client'
export { code, defineClientPlugin, defineCodes, definePlugin, props } from './define'
export { errata, type ErrataInstance, type ErrataOptions, type MatchHandlers } from './errata'
export { ErrataError, type SerializedError } from './errata-error'
export type {
  CodeConfig,
  CodeConfigRecord,
  ErrataClientPlugin,
  ErrataPlugin,
} from './types'
