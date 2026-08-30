import { describe, it, expect } from '@jest/globals';
import { runEvaluation } from '../../evals/intentEval';

describe('Evaluation Harness (Task S8)', () => {
  it('achieves >= 70% accuracy on the 40-case eval dataset', async () => {
    const { total, passed, rate } = await runEvaluation();
    console.log(`Eval Results: ${passed}/${total} passed (${rate}%)`);
    expect(rate).toBeGreaterThanOrEqual(70);
  });
});
