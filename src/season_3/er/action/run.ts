import type { Creep, Flag } from 'game/prototypes'

export function run(myCreeps: Creep[], myFlag: Flag): void {
  for (const creep of myCreeps) {
    creep.moveTo(myFlag)
  }
}
