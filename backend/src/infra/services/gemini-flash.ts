import Groq from 'groq-sdk';
import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { AIMessage } from '@langchain/core/messages';
import 'dotenv/config';
import { LLM } from '@/core/interfaces/llm.interface';

export class GeminiFlash implements LLM {
  private client:    Groq;
  private modelName: string = 'meta-llama/llama-4-scout-17b-16e-instruct';

  constructor() {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is not set');
    }
    this.client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }

  private convertMessages(messages: BaseMessage[]): any[] {
    const result: any[] = [];

    for (const msg of messages) {
      if (msg instanceof SystemMessage) {
        result.push({
          role:    'system',
          content: typeof msg.content === 'string'
            ? msg.content
            : (msg.content as any[]).map((c: any) => c.text ?? '').join('\n'),
        });
        continue;
      }

      const role = msg instanceof HumanMessage ? 'user' : 'assistant';

      if (typeof msg.content === 'string') {
        result.push({ role, content: msg.content });
        continue;
      }

      const parts: any[] = [];
      for (const part of msg.content as any[]) {
        if (part.type === 'text') {
          parts.push({ type: 'text', text: part.text });
        } else if (part.type === 'image_url') {
          parts.push({
            type:      'image_url',
            image_url: { url: part.image_url?.url ?? '' },
          });
        }
      }

      if (parts.length > 0) result.push({ role, content: parts });
    }

    return result;
  }

  async invokeAndParse<T extends Record<string, any>>(
  messages: BaseMessage[],
  parser:   JsonOutputParser<T>,
): Promise<T> {
  // add explicit JSON reminder to last message
  const jsonReminder = {
    role:    'user' as const,
    content: 'IMPORTANT: Respond with ONLY valid JSON. No explanations, no markdown, no text before or after the JSON object.',
  };

  const converted = [...this.convertMessages(messages), jsonReminder];

  const completion = await this.client.chat.completions.create({
    model:            this.modelName,
    messages:         converted,
    temperature:      0,
    max_tokens:       8192,
    response_format:  { type: 'json_object' },  // force JSON mode
  });

  const rawText = completion.choices[0]?.message?.content ?? '';

  if (!rawText) throw new Error('Groq returned empty response');

  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i,     '')
    .replace(/```\s*$/i,     '')
    .trim();

  const fakeMsg = new AIMessage(cleaned);
  return parser.invoke(fakeMsg);
}
}
