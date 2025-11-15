import * as vscode from "vscode";

type SelectorKind = "class" | "id";

export function activate(context: vscode.ExtensionContext) {
  const selector: vscode.DocumentSelector = [
    { language: "javascriptreact", scheme: "file" },
    { language: "typescriptreact", scheme: "file" },
    { language: "javascript", scheme: "file" },
    { language: "typescript", scheme: "file" },
  ];

  const definitionProvider: vscode.DefinitionProvider = {
    provideDefinition(
      document: vscode.TextDocument,
      position: vscode.Position,
      _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition> {
      const range = document.getWordRangeAtPosition(position, /[-A-Za-z0-9_]+/);
      if (!range) {
        return;
      }

      const name = document.getText(range);
      const lineText = document.lineAt(position.line).text;

      const kind = getSelectorKind(lineText, range.start.character);
      if (!kind) {
        return;
      }

      return findCssLocations(name, kind);
    },
  };

  const hoverProvider: vscode.HoverProvider = {
    provideHover(
      document: vscode.TextDocument,
      position: vscode.Position,
      _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
      const range = document.getWordRangeAtPosition(position, /[-A-Za-z0-9_]+/);
      if (!range) {
        return;
      }

      const name = document.getText(range);
      const lineText = document.lineAt(position.line).text;

      const kind = getSelectorKind(lineText, range.start.character);
      if (!kind) {
        return;
      }

      return createCssHover(name, kind);
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(selector, definitionProvider),
    vscode.languages.registerHoverProvider(selector, hoverProvider)
  );

  console.log(
    "React Sirius: definition + hover con múltiples coincidencias activos"
  );
}

interface CssMatch {
  uri: vscode.Uri;
  line: number;
  character: number;
  lines: string[];
}


function getSelectorKind(
  lineText: string,
  charPos: number
): SelectorKind | undefined {
  const beforeWord = lineText.substring(0, charPos);
  const attrRegex = /(class(Name)?|id)\s*=/g;

  let match: RegExpExecArray | null;
  let lastKind: SelectorKind | undefined;

  while ((match = attrRegex.exec(beforeWord)) !== null) {
    const attr = match[1];
    if (attr.startsWith("class")) {
      lastKind = "class";
    } else if (attr === "id") {
      lastKind = "id";
    }
  }

  return lastKind;
}


async function findCssMatches(
  name: string,
  kind: SelectorKind
): Promise<CssMatch[]> {
  const prefix = kind === "class" ? "." : "#";
  const regex = new RegExp("\\" + prefix + escapeRegExp(name) + "\\b");

  const cssFiles = await vscode.workspace.findFiles(
    "**/*.css",
    "**/node_modules/**"
  );
  const results: CssMatch[] = [];

  for (const uri of cssFiles) {
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    const lines = text.split(/\r?\n/);

    for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
      const lineText = lines[lineNumber];
      const match = regex.exec(lineText);
      if (match && match.index !== undefined) {
        const character = match.index + 1; 
        results.push({ uri, line: lineNumber, character, lines });
      }
    }
  }

  return results;
}


async function findCssLocations(
  name: string,
  kind: SelectorKind
): Promise<vscode.Location[] | undefined> {
  const matches = await findCssMatches(name, kind);
  if (!matches.length) {
    return;
  }

  return matches.map((m) => {
    const position = new vscode.Position(m.line, m.character);
    return new vscode.Location(m.uri, position);
  });
}


async function createCssHover(
  name: string,
  kind: SelectorKind
): Promise<vscode.Hover | undefined> {
  const matches = await findCssMatches(name, kind);
  if (!matches.length) {
    return;
  }

  const md = new vscode.MarkdownString(undefined, true);
  const symbol = kind === "class" ? "." : "#";

  md.appendMarkdown(
    `**${symbol}${name}** — ${matches.length} coincidencia${
      matches.length > 1 ? "s" : ""
    }\n\n`
  );

  const maxBlocks = 3; 
  const slice = matches.slice(0, maxBlocks);

  slice.forEach((m, index) => {
    const relPath = vscode.workspace.asRelativePath(m.uri);
    const snippet = extractCssBlock(m.lines, m.line);

    md.appendMarkdown(`_${relPath}_\n`);
    md.appendCodeblock(snippet, "css");

    if (index < slice.length - 1) {
      md.appendMarkdown("\n---\n");
    }
  });

  if (matches.length > maxBlocks) {
    md.appendMarkdown(
      `\n_Más resultados disponibles, usa **F12** para verlos todos._`
    );
  }

  return new vscode.Hover(md);
}


function extractCssBlock(lines: string[], startLine: number): string {
  let openBraces = 0;
  let endLine = startLine;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    const opens = (line.match(/{/g) || []).length;
    const closes = (line.match(/}/g) || []).length;

    openBraces += opens;
    openBraces -= closes;

    endLine = i;

    if (openBraces === 0 && i > startLine) {
      break;
    }
  }

  return lines.slice(startLine, endLine + 1).join("\n");
}


function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function deactivate() {}
