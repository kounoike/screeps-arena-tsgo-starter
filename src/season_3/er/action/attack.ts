import type { Creep, StructureSpawn } from 'game/prototypes'
import _ from 'lodash'

export function attackToEnemy(myCreeps: Creep[], enemyCreeps: Creep[], enemySpawns: StructureSpawn[]): void {
  for (const creep of myCreeps) {
    const target = _.minBy(enemyCreeps, enemy => creep.getRangeTo(enemy)) ?? _.head(enemySpawns)
    if (target) {
      creep.moveTo(target)
      creep.attack(target)
    }
  }
}
