import { createAgentHttpServer } from './httpServer.js';
import { loadLocalEnvironment, readAgentConfig } from './config.js';
import { OpenAICompatibleResponsesModel } from './openAiCompatibleResponsesModel.js';
import { loadGameKnowledge } from './team/gameData.js';
import type { TeamReviewAttemptDiagnostic } from './team/teamReviewSubgraph.js';

function logReviewAttempt(diagnostic: TeamReviewAttemptDiagnostic): void {
  console.log(JSON.stringify({ event: 'team_review_attempt', ...diagnostic }));
}

loadLocalEnvironment();
const config = readAgentConfig();
const model = new OpenAICompatibleResponsesModel(config.model);
const knowledge = await loadGameKnowledge();
const server = createAgentHttpServer({
  model,
  modelName: config.model.model,
  knowledge,
  reasoningEffort: config.reasoningEffort,
  allowedOrigins: config.allowedOrigins,
  onReviewAttempt: logReviewAttempt,
});

server.listen(config.port, config.host, () => {
  console.log(`Sanmou agent listening on http://${config.host}:${config.port}`);
  console.log(`Model: ${config.model.model}`);
  console.log(`Browser origins: ${config.allowedOrigins.join(', ')}`);
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}; shutting down`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
