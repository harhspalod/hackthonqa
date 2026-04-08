/**
 * AutoPM VS Code Extension
 * ──────────────────────────
 * AI-powered code review, generation, and GitHub integration
 * directly inside VS Code.
 *
 * Commands:
 *  - AutoPM: Review This File
 *  - AutoPM: Review Selected Code
 *  - AutoPM: Generate Fix from Issue
 *  - AutoPM: Push to GitHub
 *  - AutoPM: Run Full Pipeline
 */

import * as vscode from "vscode";
import * as http from "http";
import * as https from "https";
import * as path from "path";

// ─── Types ──────────────────────────────────────────────────────

interface ReviewIssue {
  severity: "CRITICAL" | "WARNING" | "INFO" | "SUGGESTION";
  category: string;
  line: number | null;
  message: string;
  suggestion: string | null;
}

interface ReviewResponse {
  overall_score: number;
  verdict: string;
  issues: ReviewIssue[];
  improved_code: string | null;
  summary: string;
  stats: Record<string, unknown>;
}

interface GenerateResponse {
  issue_id: string;
  generated_code: string;
  explanation: string;
  changes_summary: string;
  language: string;
}

interface GitHubResponse {
  success: boolean;
  branch_name: string;
  commit_sha: string | null;
  pr_number: number | null;
  pr_url: string | null;
  message: string;
}

interface PipelineResponse {
  issue_id: string;
  generation: GenerateResponse;
  review: ReviewResponse;
  github: GitHubResponse | null;
  pipeline_status: string;
  dashboard?: {
    review_score: number;
    review_verdict: string;
    issues_found: number;
    github_pushed: boolean;
    pr_number: number | null;
    pr_url: string | null;
    pipeline_status: string;
  };
}

// ─── Diagnostics Collection ─────────────────────────────────────

let diagnosticCollection: vscode.DiagnosticCollection;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

// ─── Activation ─────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  // Initialize
  diagnosticCollection =
    vscode.languages.createDiagnosticCollection("autopm");
  outputChannel = vscode.window.createOutputChannel("AutoPM");
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.text = "$(shield) AutoPM";
  statusBarItem.tooltip = "AutoPM — AI Code Review Ready";
  statusBarItem.command = "autopm.reviewFile";
  statusBarItem.show();

  outputChannel.appendLine("🚀 AutoPM Extension activated!");

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("autopm.reviewFile", reviewCurrentFile),
    vscode.commands.registerCommand(
      "autopm.reviewSelection",
      reviewSelection
    ),
    vscode.commands.registerCommand("autopm.generateFix", generateFix),
    vscode.commands.registerCommand("autopm.pushToGitHub", pushToGitHub),
    vscode.commands.registerCommand("autopm.runPipeline", runPipeline),
    diagnosticCollection,
    statusBarItem,
    outputChannel
  );

  // Auto-review on save (if enabled)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      const config = vscode.workspace.getConfiguration("autopm");
      if (config.get<boolean>("autoReviewOnSave")) {
        await reviewDocument(doc);
      }
    })
  );

  outputChannel.appendLine("✅ All commands registered");
}

// ─── Review Current File ────────────────────────────────────────

async function reviewCurrentFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No file is currently open.");
    return;
  }
  await reviewDocument(editor.document);
}

async function reviewDocument(document: vscode.TextDocument) {
  const code = document.getText();
  const language = document.languageId;
  const filename = document.fileName.split("/").pop() || document.fileName;

  if (!code.trim()) {
    vscode.window.showWarningMessage("File is empty.");
    return;
  }

  // Update status
  statusBarItem.text = "$(sync~spin) AutoPM: Reviewing...";
  statusBarItem.tooltip = `Reviewing ${filename}...`;
  outputChannel.appendLine(`\n📝 Reviewing: ${filename} (${language})`);

  try {
    const result = await apiRequest<ReviewResponse>("/api/review-code", {
      code,
      language,
      filename,
      context: `File from VS Code: ${filename}`,
      review_level: "thorough",
    });

    // Show diagnostics
    showDiagnostics(document, result);

    // Show result in output
    outputChannel.appendLine(`\n${"═".repeat(60)}`);
    outputChannel.appendLine(`📊 Review Results for ${filename}`);
    outputChannel.appendLine(`${"═".repeat(60)}`);
    outputChannel.appendLine(`Score: ${result.overall_score}/10`);
    outputChannel.appendLine(`Verdict: ${result.verdict}`);
    outputChannel.appendLine(`Issues: ${result.issues.length}`);
    outputChannel.appendLine(`Summary: ${result.summary}`);
    outputChannel.appendLine(`${"═".repeat(60)}\n`);

    for (const issue of result.issues) {
      outputChannel.appendLine(
        `  [${issue.severity}] ${issue.category} (line ${issue.line ?? "?"}): ${issue.message}`
      );
      if (issue.suggestion) {
        outputChannel.appendLine(`    💡 Fix: ${issue.suggestion}`);
      }
    }

    // Update status bar with result
    const emoji =
      result.overall_score >= 8
        ? "$(check)"
        : result.overall_score >= 5
          ? "$(warning)"
          : "$(error)";
    statusBarItem.text = `${emoji} AutoPM: ${result.overall_score}/10`;
    statusBarItem.tooltip = `${result.verdict} — ${result.issues.length} issues`;

    // Show notification
    const scoreMsg = `AutoPM: ${result.verdict} — Score ${result.overall_score}/10 (${result.issues.length} issues)`;
    if (result.overall_score >= 8) {
      vscode.window.showInformationMessage(`✅ ${scoreMsg}`);
    } else if (result.overall_score >= 5) {
      const action = await vscode.window.showWarningMessage(
        `⚠️ ${scoreMsg}`,
        "Show Details",
        "Apply Fixes"
      );
      if (action === "Show Details") {
        outputChannel.show();
      } else if (action === "Apply Fixes" && result.improved_code) {
        await applyImprovedCode(document, result.improved_code);
      }
    } else {
      const action = await vscode.window.showErrorMessage(
        `❌ ${scoreMsg}`,
        "Show Details",
        "Apply Fixes"
      );
      if (action === "Show Details") {
        outputChannel.show();
      } else if (action === "Apply Fixes" && result.improved_code) {
        await applyImprovedCode(document, result.improved_code);
      }
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    statusBarItem.text = "$(error) AutoPM: Error";
    vscode.window.showErrorMessage(`AutoPM review failed: ${errorMsg}`);
    outputChannel.appendLine(`❌ Error: ${errorMsg}`);
  }
}

// ─── Review Selection ───────────────────────────────────────────

async function reviewSelection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No file is currently open.");
    return;
  }

  const selection = editor.selection;
  const code = editor.document.getText(selection);

  if (!code.trim()) {
    vscode.window.showWarningMessage("No code selected.");
    return;
  }

  statusBarItem.text = "$(sync~spin) AutoPM: Reviewing selection...";
  outputChannel.appendLine(`\n📝 Reviewing selected code...`);

  try {
    const result = await apiRequest<ReviewResponse>("/api/review-code", {
      code,
      language: editor.document.languageId,
      filename: editor.document.fileName.split("/").pop(),
      context: "Selected code block from VS Code",
      review_level: "thorough",
    });

    showDiagnostics(editor.document, result, selection.start.line);

    // Show as info panel
    const panel = vscode.window.createWebviewPanel(
      "autopmReview",
      `AutoPM Review — ${result.overall_score}/10`,
      vscode.ViewColumn.Beside,
      { enableScripts: false }
    );

    panel.webview.html = buildReviewHTML(result);

    statusBarItem.text = `$(shield) AutoPM: ${result.overall_score}/10`;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    statusBarItem.text = "$(error) AutoPM: Error";
    vscode.window.showErrorMessage(`AutoPM review failed: ${errorMsg}`);
  }
}

// ─── Generate Fix ───────────────────────────────────────────────

async function generateFix() {
  outputChannel.show(true);
  outputChannel.appendLine(`\n⚡ Command started: AutoPM Generate Fix`);

  const issueTitle = await vscode.window.showInputBox({
    prompt: "Issue Title",
    placeHolder: "e.g., Export feature crashes on large datasets",
  });
  if (!issueTitle) {
    outputChannel.appendLine("ℹ️ Generate Fix canceled: missing issue title.");
    vscode.window.showInformationMessage("AutoPM: Generate Fix canceled.");
    return;
  }

  const issueDescription = await vscode.window.showInputBox({
    prompt: "Issue Description",
    placeHolder: "Describe the problem in detail...",
  });
  if (!issueDescription) {
    outputChannel.appendLine("ℹ️ Generate Fix canceled: missing issue description.");
    vscode.window.showInformationMessage("AutoPM: Generate Fix canceled.");
    return;
  }

  const editor = vscode.window.activeTextEditor;
  const existingCode = editor ? editor.document.getText() : undefined;
  const language = editor ? editor.document.languageId : "python";
  const filename = editor ? getRepoRelativePath(editor.document) : undefined;

  statusBarItem.text = "$(sync~spin) AutoPM: Generating fix...";
  outputChannel.appendLine(`\n⚡ Generating fix for: ${issueTitle}`);

  try {
    const result = await apiRequest<GenerateResponse>("/api/generate-code", {
      issue_id: `ISS-${Date.now().toString(36).toUpperCase()}`,
      title: issueTitle,
      description: issueDescription,
      language,
      affected_file: filename,
      existing_code: existingCode,
    });

    outputChannel.appendLine(`✅ Code generated!`);
    outputChannel.appendLine(`Explanation: ${result.explanation}`);
    outputChannel.appendLine(`Changes: ${result.changes_summary}`);

    // Show generated code in a new document
    const doc = await vscode.workspace.openTextDocument({
      content: result.generated_code,
      language: result.language,
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);

    statusBarItem.text = "$(check) AutoPM: Fix Generated";
    vscode.window.showInformationMessage(
      `✅ AutoPM: Fix generated — ${result.explanation}`,
      "Apply to File"
    ).then(async (action) => {
      if (action === "Apply to File" && editor) {
        await applyImprovedCode(editor.document, result.generated_code);
      }
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    statusBarItem.text = "$(error) AutoPM: Error";
    outputChannel.appendLine(`❌ Generate Fix failed: ${errorMsg}`);
    vscode.window.showErrorMessage(`AutoPM generation failed: ${errorMsg}`);
  }
}

// ─── Push to GitHub ─────────────────────────────────────────────

async function pushToGitHub() {
  outputChannel.show(true);
  outputChannel.appendLine(`\n🚀 Command started: AutoPM Push to GitHub`);

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    outputChannel.appendLine("⚠️ Push canceled: no active editor.");
    vscode.window.showWarningMessage("No file open to push.");
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: "PR Title",
    placeHolder: "e.g., Fix export timeout issue",
  });
  if (!title) {
    outputChannel.appendLine("ℹ️ Push canceled: missing PR title.");
    vscode.window.showInformationMessage("AutoPM: Push to GitHub canceled.");
    return;
  }

  const description = await vscode.window.showInputBox({
    prompt: "PR Description",
    placeHolder: "Describe what this change does...",
  });
  if (!description) {
    outputChannel.appendLine("ℹ️ Push canceled: missing PR description.");
    vscode.window.showInformationMessage("AutoPM: Push to GitHub canceled.");
    return;
  }

  statusBarItem.text = "$(sync~spin) AutoPM: Pushing to GitHub...";
  outputChannel.appendLine(`\n🚀 Pushing to GitHub: ${title}`);

  try {
    const result = await apiRequest<GitHubResponse>("/api/push-to-github", {
      issue_id: `ISS-${Date.now().toString(36).toUpperCase()}`,
      title,
      description,
      file_path: getRepoRelativePath(editor.document),
      code: editor.document.getText(),
    });

    if (result.success) {
      statusBarItem.text = "$(check) AutoPM: PR Created";
      const action = await vscode.window.showInformationMessage(
        `✅ PR #${result.pr_number} created!`,
        "Open PR"
      );
      if (action === "Open PR" && result.pr_url) {
        vscode.env.openExternal(vscode.Uri.parse(result.pr_url));
      }
      outputChannel.appendLine(`✅ PR: ${result.pr_url}`);
    } else {
      throw new Error(result.message);
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    statusBarItem.text = "$(error) AutoPM: Push Failed";
    outputChannel.appendLine(`❌ GitHub push failed: ${errorMsg}`);
    vscode.window.showErrorMessage(`GitHub push failed: ${errorMsg}`);
  }
}

// ─── Full Pipeline ──────────────────────────────────────────────

async function runPipeline() {
  outputChannel.show(true);
  outputChannel.appendLine(`\n🚀 Command started: AutoPM Run Full Pipeline`);

  const issueTitle = await vscode.window.showInputBox({
    prompt: "Issue Title",
    placeHolder: "e.g., Login page crashes on invalid input",
  });
  if (!issueTitle) {
    outputChannel.appendLine("ℹ️ Pipeline canceled: missing issue title.");
    vscode.window.showInformationMessage("AutoPM: Pipeline canceled.");
    return;
  }

  const issueDescription = await vscode.window.showInputBox({
    prompt: "Issue Description",
    placeHolder: "Describe the problem...",
  });
  if (!issueDescription) {
    outputChannel.appendLine("ℹ️ Pipeline canceled: missing issue description.");
    vscode.window.showInformationMessage("AutoPM: Pipeline canceled.");
    return;
  }

  const autoPush = await vscode.window.showQuickPick(
    ["Yes — auto-push to GitHub", "No — just generate and review"],
    { placeHolder: "Auto-push to GitHub if review passes?" }
  );
  if (!autoPush) {
    outputChannel.appendLine("ℹ️ Pipeline canceled: auto-push choice not selected.");
    vscode.window.showInformationMessage("AutoPM: Pipeline canceled.");
    return;
  }

  const editor = vscode.window.activeTextEditor;
  const language = editor ? editor.document.languageId : "python";
  const filename = editor ? getRepoRelativePath(editor.document) : undefined;

  statusBarItem.text = "$(sync~spin) AutoPM: Running pipeline...";
  outputChannel.appendLine(
    `\n🚀 Full Pipeline: ${issueTitle}`
  );

  try {
    const result = await apiRequest<PipelineResponse>("/api/pipeline", {
      issue_id: `ISS-${Date.now().toString(36).toUpperCase()}`,
      title: issueTitle,
      description: issueDescription,
      language,
      affected_file: filename,
      existing_code: editor ? editor.document.getText() : undefined,
      auto_push: autoPush?.startsWith("Yes") ?? false,
    });

    // Show results
    outputChannel.appendLine(`\n${"═".repeat(60)}`);
    outputChannel.appendLine(`🚀 PIPELINE RESULTS`);
    outputChannel.appendLine(`${"═".repeat(60)}`);
    outputChannel.appendLine(
      `📝 Generated: ${result.generation.explanation}`
    );
    outputChannel.appendLine(
      `🔍 Review: ${result.review.overall_score}/10 — ${result.review.verdict}`
    );
    outputChannel.appendLine(
      `📊 Issues: ${result.review.issues.length}`
    );
    if (result.github) {
      outputChannel.appendLine(`🔗 PR: ${result.github.pr_url}`);
    }
    if (result.dashboard) {
      outputChannel.appendLine(
        `📌 Dashboard: score=${result.dashboard.review_score}/10, pr=${result.dashboard.pr_url ?? "n/a"}`
      );
    }
    outputChannel.appendLine(`Status: ${result.pipeline_status}`);
    outputChannel.appendLine(`${"═".repeat(60)}\n`);

    // Show generated code
    const doc = await vscode.workspace.openTextDocument({
      content: result.generation.generated_code,
      language: result.generation.language,
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);

    // Show review panel
    const panel = vscode.window.createWebviewPanel(
      "autopmPipeline",
      `AutoPM Pipeline — ${result.review.overall_score}/10`,
      vscode.ViewColumn.Two,
      { enableScripts: false }
    );
    panel.webview.html = buildPipelineHTML(result);

    statusBarItem.text = `$(shield) AutoPM: ${result.pipeline_status}`;

    if (result.github?.pr_url) {
      const action = await vscode.window.showInformationMessage(
        `✅ Pipeline complete! PR #${result.github.pr_number} created.`,
        "Open PR"
      );
      if (action === "Open PR") {
        vscode.env.openExternal(
          vscode.Uri.parse(result.github.pr_url)
        );
      }
    } else {
      vscode.window.showInformationMessage(
        `✅ Pipeline: ${result.pipeline_status} — Score ${result.review.overall_score}/10`
      );
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    statusBarItem.text = "$(error) AutoPM: Pipeline Failed";
    outputChannel.appendLine(`❌ Pipeline failed: ${errorMsg}`);
    vscode.window.showErrorMessage(`Pipeline failed: ${errorMsg}`);
  }
}

// ─── Diagnostics (Inline Warnings/Errors) ───────────────────────

function showDiagnostics(
  document: vscode.TextDocument,
  review: ReviewResponse,
  lineOffset: number = 0
) {
  const diagnostics: vscode.Diagnostic[] = [];

  for (const issue of review.issues) {
    const line = (issue.line ?? 1) - 1 + lineOffset;
    const safeLine = Math.min(line, document.lineCount - 1);
    const range = document.lineAt(Math.max(0, safeLine)).range;

    const severity =
      issue.severity === "CRITICAL"
        ? vscode.DiagnosticSeverity.Error
        : issue.severity === "WARNING"
          ? vscode.DiagnosticSeverity.Warning
          : issue.severity === "INFO"
            ? vscode.DiagnosticSeverity.Information
            : vscode.DiagnosticSeverity.Hint;

    const diag = new vscode.Diagnostic(
      range,
      `[${issue.category}] ${issue.message}`,
      severity
    );
    diag.source = "AutoPM";
    diag.code = issue.category;

    if (issue.suggestion) {
      diag.relatedInformation = [
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(document.uri, range),
          `💡 ${issue.suggestion}`
        ),
      ];
    }

    diagnostics.push(diag);
  }

  diagnosticCollection.set(document.uri, diagnostics);
}

// ─── Apply Improved Code ────────────────────────────────────────

async function applyImprovedCode(
  document: vscode.TextDocument,
  improvedCode: string
) {
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length)
  );
  edit.replace(document.uri, fullRange, improvedCode);
  await vscode.workspace.applyEdit(edit);
  vscode.window.showInformationMessage("✅ AutoPM: Improved code applied!");
}

// ─── API Helper ─────────────────────────────────────────────────

function apiRequest<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const config = vscode.workspace.getConfiguration("autopm");
  const serverUrl = config.get<string>("serverUrl") || "http://localhost:8000";
  const url = new URL(endpoint, serverUrl);

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 120000, // 2 min timeout for AI calls
      },
      (res) => {
        let responseData = "";
        res.on("data", (chunk: Buffer) => {
          responseData += chunk.toString();
        });
        res.on("end", () => {
          try {
            if (res.statusCode && res.statusCode >= 400) {
              const error = JSON.parse(responseData);
              reject(
                new Error(error.detail || `HTTP ${res.statusCode}`)
              );
            } else {
              resolve(JSON.parse(responseData) as T);
            }
          } catch {
            reject(new Error(`Invalid response: ${responseData.substring(0, 200)}`));
          }
        });
      }
    );

    req.on("error", (err: Error) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    req.write(data);
    req.end();
  });
}

function getRepoRelativePath(document: vscode.TextDocument): string {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    return path.basename(document.fileName);
  }

  const relativePath = path.relative(
    workspaceFolder.uri.fsPath,
    document.fileName
  );

  if (!relativePath || relativePath.startsWith("..")) {
    return path.basename(document.fileName);
  }

  return relativePath.split(path.sep).join("/");
}

// ─── HTML Builders (for Webview Panels) ─────────────────────────

function buildReviewHTML(review: ReviewResponse): string {
  const scoreColor =
    review.overall_score >= 8
      ? "#22c55e"
      : review.overall_score >= 5
        ? "#f59e0b"
        : "#ef4444";

  const issuesHTML = review.issues
    .map((issue) => {
      const severityColor =
        issue.severity === "CRITICAL"
          ? "#ef4444"
          : issue.severity === "WARNING"
            ? "#f59e0b"
            : issue.severity === "INFO"
              ? "#3b82f6"
              : "#8b5cf6";

      return `
      <div style="border-left: 3px solid ${severityColor}; padding: 8px 12px; margin: 8px 0; background: #1e1e2e; border-radius: 4px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="color: ${severityColor}; font-weight: bold;">${issue.severity}</span>
          <span style="color: #888; font-size: 12px;">${issue.category} ${issue.line ? `• line ${issue.line}` : ""}</span>
        </div>
        <div style="color: #cdd6f4;">${issue.message}</div>
        ${issue.suggestion ? `<div style="color: #94e2d5; margin-top: 4px; font-size: 13px;">💡 ${issue.suggestion}</div>` : ""}
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Segoe UI', sans-serif; background: #11111b; color: #cdd6f4; padding: 20px; }
    h1 { color: #cba6f7; }
    .score { font-size: 48px; font-weight: bold; color: ${scoreColor}; }
    .verdict { font-size: 18px; color: #89b4fa; margin-top: 4px; }
    .summary { color: #a6adc8; margin: 16px 0; line-height: 1.6; }
    .section-title { color: #f5c2e7; margin-top: 24px; font-size: 16px; font-weight: bold; }
  </style>
</head>
<body>
  <h1>🛡️ AutoPM Code Review</h1>
  <div class="score">${review.overall_score}/10</div>
  <div class="verdict">${review.verdict.replace(/_/g, " ")}</div>
  <div class="summary">${review.summary}</div>
  <div class="section-title">Issues Found (${review.issues.length})</div>
  ${issuesHTML || '<div style="color: #a6e3a1">No issues found! 🎉</div>'}
</body>
</html>`;
}

function buildPipelineHTML(pipeline: PipelineResponse): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Segoe UI', sans-serif; background: #11111b; color: #cdd6f4; padding: 20px; }
    h1 { color: #cba6f7; }
    .step { background: #1e1e2e; padding: 16px; border-radius: 8px; margin: 12px 0; border-left: 3px solid #89b4fa; }
    .step-title { color: #89b4fa; font-weight: bold; font-size: 14px; margin-bottom: 8px; }
    .step-content { color: #a6adc8; font-size: 13px; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; margin-top: 16px; }
    .status-success { background: #22c55e22; color: #22c55e; }
    .status-warning { background: #f59e0b22; color: #f59e0b; }
    pre { background: #181825; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
    code { color: #a6e3a1; }
  </style>
</head>
<body>
  <h1>🚀 AutoPM Pipeline Results</h1>
  <div class="status ${pipeline.pipeline_status.includes("deployed") ? "status-success" : "status-warning"}">
    ${pipeline.pipeline_status.toUpperCase()}
  </div>

  <div class="step">
    <div class="step-title">⚡ Step 1: Code Generation</div>
    <div class="step-content">${pipeline.generation.explanation}</div>
    <div class="step-content" style="margin-top:4px; color:#f5c2e7;">${pipeline.generation.changes_summary}</div>
  </div>

  <div class="step">
    <div class="step-title">🔍 Step 2: AI Code Review — ${pipeline.review.overall_score}/10</div>
    <div class="step-content">${pipeline.review.summary}</div>
    <div class="step-content" style="margin-top:4px;">Verdict: <strong style="color: #cba6f7;">${pipeline.review.verdict}</strong> | Issues: ${pipeline.review.issues.length}</div>
  </div>

  ${
    pipeline.github
      ? `<div class="step" style="border-left-color: #a6e3a1;">
    <div class="step-title" style="color: #a6e3a1;">🔗 Step 3: GitHub PR Created</div>
    <div class="step-content">Branch: <code>${pipeline.github.branch_name}</code></div>
    <div class="step-content">PR: <a href="${pipeline.github.pr_url}" style="color: #89b4fa;">#${pipeline.github.pr_number}</a></div>
  </div>`
      : `<div class="step" style="border-left-color: #f59e0b;">
    <div class="step-title" style="color: #f59e0b;">⏸️ Step 3: GitHub Push Skipped</div>
    <div class="step-content">Auto-push was disabled or review did not pass.</div>
  </div>`
  }
</body>
</html>`;
}

// ─── Deactivation ───────────────────────────────────────────────

export function deactivate() {
  diagnosticCollection?.dispose();
  statusBarItem?.dispose();
  outputChannel?.dispose();
}
