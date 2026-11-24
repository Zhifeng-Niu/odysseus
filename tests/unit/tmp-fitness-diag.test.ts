import { test } from 'vitest';
import { measureFitness } from '../../src/eval/fitness.js';

test('real fitness (quiet machine)', async () => {
  const r = await measureFitness(process.cwd());
  console.log(`DIAG real fitness: score=${r.score.toFixed(2)} scriptedRate=${r.scriptedSuccessRate.toFixed(2)} unit=${r.unitPassed}`);
}, 300000);
