import { GoogleGenAI } from "@google/genai";
import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { AIMessage } from "@langchain/core/messages";
import "dotenv/config";
import { LLM } from "@/core/interfaces/llm.interface";

export class GeminiFlash implements LLM {
  private ai: GoogleGenAI;
  private modelName: string = "gemini-3-flash-preview";

  constructor() {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set");
    }
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  private convertMessages(messages: BaseMessage[]): {
    system: string;
    contents: any[];
  } {
    let system = "";
    const contents: any[] = [];

    for (const msg of messages) {
      if (msg instanceof SystemMessage) {
        system = typeof msg.content === "string"
          ? msg.content
          : (msg.content as any[]).map((c: any) => c.text ?? "").join("\n");
        continue;
      }

      const role = msg instanceof HumanMessage ? "user" : "model";
      const parts: any[] = [];

      if (typeof msg.content === "string") {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content as any[]) {
          if (part.type === "text") {
            parts.push({ text: part.text });
          } else if (part.type === "image_url") {
            const url: string = part.image_url?.url ?? "";
            if (url.startsWith("data:")) {
              const [meta, data] = url.split(",");
              const mimeType = meta.split(":")[1].split(";")[0];
              parts.push({ inlineData: { mimeType, data } });
            } else {
              parts.push({ text: `[Image: ${url}]` });
            }
          }
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    return { system, contents };
  }

  async invokeAndParse<T extends Record<string, any>>(
    messages: BaseMessage[],
    parser: JsonOutputParser<T>,
  ): Promise<T> {
    const { system, contents } = this.convertMessages(messages);

    const response = await this.ai.models.generateContent({
      model:    this.modelName,
      contents,
      config: {
        systemInstruction: system,
        temperature:       0,
        maxOutputTokens:   8192,
      },
    });

    const rawText = response.text;

    if (!rawText) {
      throw new Error("Gemini returned empty response");
    }

    const cleaned = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const fakeMsg = new AIMessage(cleaned);
    return parser.invoke(fakeMsg);
  }
}