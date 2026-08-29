import { EVAL_DATASET } from './dataset';
import { intentEngine } from '../ai';

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
