import * as vscode from "vscode";

type SelectorKind = "class" | "id";

export function activate(context: vscode.ExtensionContext) {
  const selector: vscode.DocumentSelector = [
    { language: "javascriptreact", scheme: "file" },
    { language: "typescriptreact", scheme: "file" },
    { language: "javascript", scheme: "file" },
    { language: "typescript", scheme: "file" },
  ];

  // 1) Ir a la definición en CSS
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

      // Devolvemos TODAS las coincidencias -> VS Code muestra lista para elegir
      return findCssLocations(name, kind);
    },
  };

  // 2) Hover con uno o varios bloques CSS
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

/**
 * Determina si la palabra está en un atributo class/className o id,
 * y cuál fue el último antes de la palabra.
 */
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

/**
 * Busca TODAS las coincidencias de .name o #name en los .css del workspace
 */
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
        const character = match.index + 1; // justo sobre el nombre de la clase/id
        results.push({ uri, line: lineNumber, character, lines });
      }
    }
  }

  return results;
}

/**
 * Para Ctrl+Click / F12 -> varias Locations si hay varias definiciones
 */
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

/**
 * Crea el hover con uno o varios bloques CSS
 */
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

  const maxBlocks = 3; // para no hacer el hover infinito
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

/**
 * Devuelve el bloque CSS desde la línea donde está el selector
 * hasta que se cierran las llaves.
 */
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

/**
 * Escapa caracteres especiales para usar en RegExp
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function deactivate() {}
