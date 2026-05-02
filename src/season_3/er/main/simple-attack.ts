import { Creep, StructureSpawn } from 'game/prototypes'
import { getObjectsByPrototype } from 'game/utils'
import _ from 'lodash'
import { Logger } from '@/common/logger.js'
import { attackToEnemy } from '../action/attack.js'
import { spawnAttacker } from '../spawn/spawn-attacker.js'

const _logger = new Logger('simple-attack', true)

export function loop(): void {
  const [myCreeps, enemyCreeps] = _.partition(getObjectsByPrototype(Creep), 'my')
  const [mySpawns, enemySpawns] = _.partition(getObjectsByPrototype(StructureSpawn), 'my')
  const mySpawn = _.head(mySpawns)

  if (mySpawn) {
    spawnAttacker(mySpawn)
  }

  attackToEnemy(myCreeps, enemyCreeps, enemySpawns)
}
