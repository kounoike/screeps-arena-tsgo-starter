import { Creep, Flag } from 'game/prototypes'
import { getObjectsByPrototype, getTicks } from 'game/utils'
import { Logger } from '@/common/logger.js'
import { run as runToFlag } from '../action/run.js'

const logger = new Logger('simple-run', true)

export function loop(): void {
  const myCreeps = getObjectsByPrototype(Creep).filter(creep => creep.my)
  const myFlag = getObjectsByPrototype(Flag).find(flag => flag.my)
  if (!myFlag) {
    return
  }
  logger.info(`Running to flag: #${myFlag.id} tick: ${getTicks()}`)
  runToFlag(myCreeps, myFlag)
}
