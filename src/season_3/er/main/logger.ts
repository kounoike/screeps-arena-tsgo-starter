import { Logger } from '@/common/logger.js'

function raiseError(message: string): void {
  throw new Error(message)
}

export function loop(): void {
  const logger = new Logger('logger-demo')

  logger.debug('This is a debug message')
  logger.info('This is an info message')
  logger.warn('This is a warning message')
  logger.error('This is an error message')

  try {
    raiseError('This is a test error')
  } catch (e) {
    logger.showError(e, 'An error occurred in loop', 'loop')
  }

  logger.info('check unhandled error')

  raiseError('this is a test error that will not be caught')
}
