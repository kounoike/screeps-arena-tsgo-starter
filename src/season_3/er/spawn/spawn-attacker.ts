import { ATTACK, MOVE } from 'game/constants'
import type { StructureSpawn } from 'game/prototypes'

export function spawnAttacker(spawn: StructureSpawn): void {
  spawn.spawnCreep([MOVE, ATTACK])
}
