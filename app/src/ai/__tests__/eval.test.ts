import { describe, it, expect } from '@jest/globals';
import { runEvaluation } from '../../evals/intentEval';

describe('Evaluation Harness (Task S8 & Phase 6 S6.5)', () => {
  it('achieves >= 90% accuracy on the 70-case eval dataset', async () => {
    const { total, passed, rate } = await runEvaluation();
    console.log(`Eval Results: ${passed}/${total} passed (${rate}%)`);
    expect(rate).toBeGreaterThanOrEqual(90);
  });
});
