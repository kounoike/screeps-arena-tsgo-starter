import { ATTACK, MOVE } from 'game/constants'
import { Creep, StructureSpawn } from 'game/prototypes'
import { getObjectsByPrototype } from 'game/utils'
import _ from 'lodash'
import { Logger } from '@/common/logger.js'

const logger = new Logger('simple-attack', true)

export function loop(): void {
  const [myCreeps, enemyCreeps] = _.partition(getObjectsByPrototype(Creep), 'my')
  const [mySpawns, enemySpawns] = _.partition(getObjectsByPrototype(StructureSpawn), 'my')
  const mySpawn = _.head(mySpawns)

  if (mySpawn) {
    const ret = mySpawn.spawnCreep([MOVE, ATTACK])
    logger.info(`Spawning creep with result: ${ret}`)
  }

  for (const creep of myCreeps) {
    const target = _.minBy(enemyCreeps, enemy => creep.getRangeTo(enemy)) ?? _.head(enemySpawns)
    if (target) {
      creep.moveTo(target)
      creep.attack(target)
    }
  }
}
