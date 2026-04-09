import { config } from "dotenv";
config({ path: require("path").join(__dirname, "../.env") });

import { Octokit } from "@octokit/rest";
import OpenAI from "openai";

const groq = new OpenAI({
  apiKey: process.env.GROK_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});
