import { Octokit } from "@octokit/rest";
import OpenAI from "openai";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2)
    .filter(w => !["this","that","with","from","have","when","they",
      "will","been","were","what","which","there","their"].includes(w))
    .slice(0, 8);
}

export async function resolveIssueAutonomously(event: any): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const groqKey = process.env.GROQ_API_KEY;

  if (!token || !event.repo || !event.meta?.issueNumber) return;
  if (!groqKey) {
    console.error("[issue-resolver] GROQ_API_KEY not set");
    return;
  }

  const groq = new OpenAI({
    apiKey: groqKey,
    baseURL: "https://api.groq.com/openai/v1",
  });

  const octokit = new Octokit({ auth: token });
  const { owner, name } = event.repo;
  const issueNumber = event.meta.issueNumber;
  const issueTitle = event.meta.issueTitle ?? "";
  const issueBody = event.issueDescription ?? "";

  console.log(`[issue-resolver] Resolving issue #${issueNumber}: ${issueTitle}`);

  await octokit.issues.createComment({
    owner, repo: name, issue_number: issueNumber,
    body: `**Autopm** is analyzing this issue...\n\n_Give me a moment._`,
  });

  // Get existing repo files for context
  let repoContext = "";
  try {
    const { data: tree } = await octokit.git.getTree({
      owner, repo: name,
      tree_sha: event.repo.defaultBranch,
      recursive: "1",
    });
    const files = tree.tree
      .filter((f: any) => f.type === "blob")
      .map((f: any) => f.path)
      .slice(0, 30);
    repoContext = `Existing files in repo:\n${files.join("\n")}`;
  } catch { }

  // Fetch content of relevant existing files
  const keywords = extractKeywords(issueTitle + " " + issueBody);
  const fileContents: Record<string, string> = {};

  try {
    const { data: searchResult } = await octokit.search.code({
      q: `${keywords.slice(0, 2).join(" ")} repo:${owner}/${name}`,
      per_page: 5,
    });
    for (const file of searchResult.items.slice(0, 5)) {
      try {
        const { data } = await octokit.repos.getContent({
          owner, repo: name, path: file.path,
        });
        if ("content" in data) {
          fileContents[file.path] = Buffer.from(data.content, "base64").toString("utf8");
        }
      } catch { }
      await sleep(500);
    }
  } catch { }

  const fileContext = Object.entries(fileContents)
    .map(([path, content]) => `=== ${path} ===\n${content.slice(0, 1500)}`)
    .join("\n\n");

  let diagnosis = "";
  let fixes: Record<string, string> = {};
  let newFiles: Record<string, string> = {};

  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{
        role: "user",
        content: `You are an expert software engineer fixing a GitHub issue.

ISSUE TITLE: ${issueTitle}
ISSUE DESCRIPTION: ${issueBody}

${repoContext}

${fileContext ? `Relevant existing files:\n${fileContext}` : ""}

Your task: fully resolve this issue. You can fix existing files or create new ones.

Respond in this exact JSON format only, no markdown fences:
{
  "diagnosis": "what is wrong / what is needed and why",
  "fixes": {
    "path/to/existing/file.js": "complete updated file content"
  },
  "newFiles": {
    "path/to/new/file.md": "complete new file content"
  },
  "summary": "one line summary of what was done"
}`,
      }],
      max_tokens: 4096,
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    const parsed = JSON.parse(cleaned);
    diagnosis = parsed.diagnosis ?? "";
    fixes = parsed.fixes ?? {};
    newFiles = parsed.newFiles ?? {};

    console.log(`[issue-resolver] Diagnosis: ${diagnosis.slice(0, 100)}`);
    console.log(`[issue-resolver] Fix: ${Object.keys(fixes).join(", ")}`);
    console.log(`[issue-resolver] New files: ${Object.keys(newFiles).join(", ")}`);

  } catch (err: any) {
    console.error("[issue-resolver] Groq failed:", err.message);
    await octokit.issues.createComment({
      owner, repo: name, issue_number: issueNumber,
      body: `**Autopm:** Could not analyze automatically. Please review manually.`,
    });
    return;
  }

  const allChanges = { ...fixes, ...newFiles };

  if (Object.keys(allChanges).length === 0) {
    await octokit.issues.createComment({
      owner, repo: name, issue_number: issueNumber,
      body: `**Autopm diagnosis:**\n\n${diagnosis}\n\n_No file changes needed._`,
    });
    return;
  }

  const branchName = `autopm/fix-issue-${issueNumber}`;

  try {
    const { data: refData } = await octokit.git.getRef({
      owner, repo: name,
      ref: `heads/${event.repo.defaultBranch}`,
    });

    try {
      await octokit.git.createRef({
        owner, repo: name,
        ref: `refs/heads/${branchName}`,
        sha: refData.object.sha,
      });
    } catch (e: any) {
      if (!e.message?.includes("already exists")) throw e;
    }

    for (const [filePath, content] of Object.entries(allChanges)) {
      try {
        let fileSha: string | undefined;
        try {
          const { data: existing } = await octokit.repos.getContent({
            owner, repo: name, path: filePath, ref: branchName,
          });
          if ("sha" in existing) fileSha = existing.sha;
        } catch { }

        await octokit.repos.createOrUpdateFileContents({
          owner, repo: name,
          path: filePath,
          message: `fix: resolve issue #${issueNumber} — ${issueTitle} [autopm]`,
          content: Buffer.from(content).toString("base64"),
          sha: fileSha,
          branch: branchName,
        });

        const action = newFiles[filePath] ? "Created" : "Updated";
        console.log(`[issue-resolver] ${action} ${filePath}`);
      } catch (err: any) {
        console.error(`[issue-resolver] Failed ${filePath}:`, err.message);
      }
    }

    const { data: pr } = await octokit.pulls.create({
      owner, repo: name,
      title: `fix: resolve issue #${issueNumber} — ${issueTitle}`,
      body: [
        `## Autopm Auto-fix`,
        `Automatically resolves #${issueNumber}.`,
        ``,
        `### Diagnosis`,
        diagnosis,
        ``,
        Object.keys(fixes).length > 0
          ? `### Files updated\n${Object.keys(fixes).map(f => `- \`${f}\``).join("\n")}`
          : "",
        Object.keys(newFiles).length > 0
          ? `### Files created\n${Object.keys(newFiles).map(f => `- \`${f}\``).join("\n")}`
          : "",
        ``,
        `> Generated by Autopm · Groq llama-3.3-70b`,
      ].filter(Boolean).join("\n"),
      head: branchName,
      base: event.repo.defaultBranch,
    });

    console.log(`[issue-resolver] Opened PR #${pr.number}: ${pr.html_url}`);

    await octokit.issues.createComment({
      owner, repo: name, issue_number: issueNumber,
      body: [
        `**Autopm has automatically resolved this issue.**`,
        ``,
        `### Diagnosis`,
        diagnosis,
        ``,
        `### Pull request`,
        pr.html_url,
        ``,
        Object.keys(newFiles).length > 0
          ? `**Files created:** ${Object.keys(newFiles).map(f => `\`${f}\``).join(", ")}`
          : "",
        Object.keys(fixes).length > 0
          ? `**Files updated:** ${Object.keys(fixes).map(f => `\`${f}\``).join(", ")}`
          : "",
        ``,
        `> Please review and merge when ready.`,
      ].filter(Boolean).join("\n"),
    });

  } catch (err: any) {
    console.error("[issue-resolver] Failed:", err.message);
    await octokit.issues.createComment({
      owner, repo: name, issue_number: issueNumber,
      body: `**Autopm diagnosis:**\n\n${diagnosis}\n\nCould not create PR: ${err.message}`,
    });
  }
}
