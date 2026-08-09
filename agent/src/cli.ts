import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadLocalEnvironment, readAgentConfig } from './config.js';
import { ChatModelError } from './model.js';
import { OpenAICompatibleChatModel } from './openAiCompatibleChatModel.js';
import { loadGameKnowledge } from './team/gameData.js';
import { runTeamRecommendation } from './team/teamRecommendationGraph.js';
import { teamRecommendationInputSchema } from './team/teamRecommendationSchemas.js';

function printUsage(): void {
  console.log('Usage:');
  console.log('  pnpm smoke');
  console.log('  pnpm recommend <partial-teams.json>');
  console.log('The recommend command fills heroes, formations, rows, and skills.');
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

async function runRecommend(inputPath: string | undefined): Promise<void> {
  if (inputPath === undefined) throw new Error('recommend requires a JSON input path');
  loadLocalEnvironment();
  const config = readAgentConfig();
  const [knowledge, rawInput] = await Promise.all([
    loadGameKnowledge(),
    readFile(resolve(process.cwd(), inputPath), 'utf8'),
  ]);
  const input = teamRecommendationInputSchema.parse(JSON.parse(rawInput) as unknown);
  const model = new OpenAICompatibleChatModel(config.model);
  const result = await runTeamRecommendation(input, {
    model,
    knowledge,
    reasoningEffort: config.reasoningEffort,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'smoke') {
    await runSmoke();
    return;
  }
  if (command === 'recommend') {
    await runRecommend(process.argv[3]);
    return;
  }
  if (command !== undefined) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  printUsage();
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
