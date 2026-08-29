import { EVAL_DATASET } from './dataset';
import { intentEngine } from '../app/src/ai';

export async function runEvaluation(): Promise<{ total: number; passed: number; rate: number }> {
  let passed = 0;
  const total = EVAL_DATASET.length;

  for (const testCase of EVAL_DATASET) {
    const result = await intentEngine.parse(testCase.input, testCase.context);

    if (testCase.expectedActivity === 'unknown') {
      if (result.kind === 'clarification') {
        passed++;
      }
    } else {
      if (result.kind === 'intent') {
        let isCorrect = result.intent.activity === testCase.expectedActivity;
        if (testCase.expectedOperation) {
          isCorrect = isCorrect && result.intent.operation === testCase.expectedOperation;
        }
        if (isCorrect) {
          passed++;
        }
      }
    }
  }

  const rate = Math.round((passed / total) * 100);
  return { total, passed, rate };
}

if (require.main === module) {
  runEvaluation().then(({ total, passed, rate }) => {
    console.log(`\n========================================`);
    console.log(`  INTENT ENGINE EVALUATION RESULTS`);
    console.log(`========================================`);
    console.log(`Total Cases: ${total}`);
    console.log(`Passed:      ${passed}`);
    console.log(`Pass Rate:   ${rate}% (Target: >= 70% for Phase 1)`);
    console.log(`========================================\n`);

    if (rate < 70) {
      process.exit(1);
    }
  });
}
