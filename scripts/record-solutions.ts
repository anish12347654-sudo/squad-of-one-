/**
 * record-solutions.ts - records scripted-bot solution replays for each level and
 * commits them as level-solution test fixtures.
 *
 * Wired at M0 but not yet implemented: there are no levels or bot controllers
 * until the content milestone (M2+). Running it now reports that there is
 * nothing to record and exits successfully so CI does not break, while making
 * the pending work explicit. Implemented in a later milestone.
 */

export {};

function main(): void {
  const levels: string[] = [];
  if (levels.length === 0) {
    console.log('record-solutions: no levels defined yet (content lands in M2+). Nothing to record.');
    return;
  }
  // Later: for each level, run its bot controller through the sim and write the
  // recorded InputFrame stream to tests/solutions/<level>.replay.
}

main();
