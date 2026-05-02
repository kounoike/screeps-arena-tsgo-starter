import { getTicks } from 'game/utils'
import { Logger } from '@/common/logger.js'

const logger = new Logger('simple-run', true)

export function loop() {
  logger.info(`tick: ${getTicks()}`)
}
