import { loadLocalEnvironment, readAgentConfig } from './config.js';
import { ChatModelError } from './model.js';
import { OpenAICompatibleChatModel } from './openAiCompatibleChatModel.js';

function printUsage(): void {
  console.log('Usage: pnpm smoke');
  console.log('Runs one synthetic completion through the configured model provider.');
}

async function runSmoke(): Promise<void> {
  loadLocalEnvironment();
  const config = readAgentConfig();
  const model = new OpenAICompatibleChatModel(config.model);
  const result = await model.complete({
    messages: [{ role: 'user', content: 'Reply with exactly: agent-smoke-ok' }],
    maxCompletionTokens: 64,
  });
  console.log(
    JSON.stringify(
      {
        model: result.model,
        content: result.content,
        usage: result.usage,
      },
      null,
      2
    )
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== 'smoke') {
    printUsage();
    process.exitCode = command === undefined ? 0 : 1;
    return;
  }
  await runSmoke();
}

main().catch((error: unknown) => {
  if (error instanceof ChatModelError) {
    console.error(`Model request failed: ${error.message}`);
    if (error.statusCode !== null) console.error(`Upstream HTTP status: ${error.statusCode}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
