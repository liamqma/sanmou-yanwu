import { z } from 'zod';

const chatMessageSchema = z.object({
  role: z.enum(['developer', 'system', 'user', 'assistant']),
  content: z.string().min(1),
});

export const agentChatRequestSchema = z
  .object({
    messages: z.array(chatMessageSchema).min(1),
    model: z.string().min(1).optional(),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
    maxCompletionTokens: z.number().int().min(1).max(100_000).optional(),
    temperature: z.number().min(-2).max(2).optional(),
  })
  .strict();
