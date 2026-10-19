// claude -p result handling, now on top of the harness-neutral one-shot parser in llm.mjs.
import { answerJson, parseOneShot } from './llm.mjs';

export { cliError, InterruptError, isInterrupt, isQuotaError as isQuota } from './llm.mjs';

// The JSON object in a claude -p result: the CLI's own error, else the answer text's JSON object.
export function resultJson(stdout) {
  const { text, error } = parseOneShot('claude-code', stdout);
  if (error) throw new Error(error);
  if (text === null) throw new Error('no claude -p JSON result');
  return answerJson(text);
}
