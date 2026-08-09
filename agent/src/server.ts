import { createAgentHttpServer } from './httpServer.js';
import { loadLocalEnvironment, readAgentConfig } from './config.js';
import { OpenAICompatibleChatModel } from './openAiCompatibleChatModel.js';

loadLocalEnvironment();
const config = readAgentConfig();
const model = new OpenAICompatibleChatModel(config.model);
const server = createAgentHttpServer({ model, modelName: config.model.model });

server.listen(config.port, config.host, () => {
  console.log(`Sanmou agent listening on http://${config.host}:${config.port}`);
  console.log(`Model: ${config.model.model}`);
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
