import { defineCodes, errata, props } from 'errata'

export const errors = errata({
  app: 'docs',
  codes: defineCodes({
    auth: {
      invalid_credentials: {
        message: ({ details }) => `Invalid credentials for ${details.email}`,
        status: 401,
        expose: true,
        tags: ['auth', 'login'],
        details: props<{ email: string }>(),
      },
      rate_limited: {
        message: 'Too many attempts, try again later',
        status: 429,
        retryable: true,
        tags: ['auth', 'throttle'],
      },
    },
    db: {
      not_found: {
        message: ({ details }) => `${details.table} with id ${details.id} was not found`,
        status: 404,
        expose: true,
        tags: ['db'],
        details: props<{ table: string, id: string }>(),
      },
    },
  }),
})
