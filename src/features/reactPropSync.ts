import * as vscode from "vscode";

interface ComponentInfo {
  name: string;
  props: string[];
}

interface UsageInfo {
  componentName: string;
  props: string[];
}

export function registerReactPropSync(context: vscode.ExtensionContext) {
  const autoSyncOnSave = vscode.workspace.onDidSaveTextDocument(async (doc) => {
    if (
      ![
        "javascriptreact",
        "typescriptreact",
        "javascript",
        "typescript",
      ].includes(doc.languageId)
    ) {
      return;
    }

    // 1) Definición -> usos
    const components = getComponentsInDocument(doc);
    if (components.length) {
      for (const c of components) {
        if (!c.props.length) {
          continue;
        }
        await syncComponentPropsUsages(c.name, c.props);
      }
    }

    // 2) Usos -> definición
    const usages = getUsagesInDocument(doc);
    if (!usages.length) {
      return;
    }

    const seen = new Set<string>();

    for (const usage of usages) {
      if (!usage.props.length) {
        continue;
      }
      if (seen.has(usage.componentName)) {
        continue;
      }
      seen.add(usage.componentName);

      await syncDefinitionFromUsage(usage);
    }
  });

  context.subscriptions.push(autoSyncOnSave);
}

// ---------------------- DEFINICIÓN ----------------------
//
// Soporta:
//  - export default function Nombre({ ... }) {}
//  - export function Nombre({ ... }) {}
//  - function Nombre({ ... }) {}
//  - export const Nombre = ({ ... }) => {}
//  - const Nombre = ({ ... }) => {}

function getComponentsInDocument(
  document: vscode.TextDocument
): ComponentInfo[] {
  const text = document.getText();

  const components: ComponentInfo[] = [];
  let match: RegExpExecArray | null;

  // funciones normales
  const fnRegex =
    /(?:export\s+default\s+|export\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(\s*{([^}]*)}\s*\)/g;

  while ((match = fnRegex.exec(text)) !== null) {
    const name = match[1];
    const propsRaw = match[2];

    const props = propsRaw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.split("=")[0].split(":")[0].replace(/\?$/, "").trim())
      .filter(Boolean);

    components.push({ name, props });
  }

  // arrow functions
  const arrowRegex =
    /(?:export\s+default\s+|export\s+)?(?:const|let)\s+([A-Z][A-Za-z0-9_]*)\s*=\s*\(\s*{([^}]*)}\s*\)\s*=>/g;

  while ((match = arrowRegex.exec(text)) !== null) {
    const name = match[1];
    const propsRaw = match[2];

    const props = propsRaw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.split("=")[0].split(":")[0].replace(/\?$/, "").trim())
      .filter(Boolean);

    components.push({ name, props });
  }

  return components;
}

function isTestFile(uri: vscode.Uri): boolean {
  const path = uri.fsPath.replace(/\\/g, "/");
  return (
    /(\.test\.|\.spec\.)/.test(path) || /\/(__tests__|tests?)\//.test(path)
  );
}

// ---------------------- USOS (REFERENCIAS) ----------------------

function getUsagesInDocument(document: vscode.TextDocument): UsageInfo[] {
  const text = document.getText();
  // Cualquier componente JSX con mayúscula inicial: <RequestForm ... />
  const tagRegex = /<([A-Z][A-Za-z0-9_]*)\b([\s\S]*?)(\/?)>/g;

  const usages: UsageInfo[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(text)) !== null) {
    const componentName = match[1];
    const attrs = match[2] || "";

    const propsSet = new Set<string>();
    const propRegex = /\b([a-zA-Z_][A-Za-z0-9_]*)\s*=/g;
    let propMatch: RegExpExecArray | null;

    while ((propMatch = propRegex.exec(attrs)) !== null) {
      propsSet.add(propMatch[1]);
    }

    if (propsSet.size) {
      usages.push({
        componentName,
        props: Array.from(propsSet),
      });
    }
  }

  return usages;
}

// uso -> definición (y luego al resto de usos)
async function syncDefinitionFromUsage(usage: UsageInfo): Promise<void> {
  const { componentName, props: usageProps } = usage;

  const files = await vscode.workspace.findFiles(
    "**/*.{tsx,jsx,ts,js}",
    "**/node_modules/**"
  );

  // patrones de definición soportados:
  const patterns = [
    // function Nombre({ ... }) {}
    `(?:export\\s+default\\s+|export\\s+)?function\\s+${componentName}\\s*\\(\\s*{([^}]*)}\\s*\\)`,
    // const Nombre = ({ ... }) => {}
    `(?:export\\s+default\\s+|export\\s+)?(?:const|let)\\s+${componentName}\\s*=\\s*\\(\\s*{([^}]*)}\\s*\\)\\s*=>`,
  ];

  let targetUri: vscode.Uri | undefined;
  let match: RegExpExecArray | null = null;
  let propsRaw: string | undefined;

  for (const uri of files) {
    if (isTestFile(uri)) {
      continue;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();

    for (const pattern of patterns) {
      const fnRegex = new RegExp(pattern);
      const m = fnRegex.exec(text);

      if (m) {
        targetUri = uri;
        match = m;
        propsRaw = m[1]; // grupo de props
        break;
      }
    }

    if (targetUri) {
      break;
    }
  }

  if (!targetUri || !propsRaw || !match) {
    // no hay definición de ese componente, nada que hacer
    return;
  }

  const defProps = propsRaw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split("=")[0].split(":")[0].replace(/\?$/, "").trim())
    .filter(Boolean);

  const allPropsSet = new Set<string>(defProps);
  for (const p of usageProps) {
    allPropsSet.add(p);
  }
  const allProps = Array.from(allPropsSet);

  const sameLength = allProps.length === defProps.length;
  const sameContent = sameLength && defProps.every((p, i) => p === allProps[i]);

  if (sameContent) {
    return;
  }

  const newPropsString = allProps.join(", ");
  const newOnly = usageProps.filter((p) => !defProps.includes(p));

  // 🟡 Botón de confirmación (definición + usos)
  const applyLabel = "Actualizar definición y usos";
  const cancelLabel = "Cancelar";

  const choice = await vscode.window.showInformationMessage(
    `Se detectaron nuevas props en <${componentName} />: ${newOnly.join(
      ", "
    )}. ¿Quieres actualizar la definición y sincronizar los usos?`,
    applyLabel,
    cancelLabel
  );

  if (choice !== applyLabel) {
    return;
  }

  const doc = await vscode.workspace.openTextDocument(targetUri);
  const fullMatch = match[0];

  const idxInFull = fullMatch.indexOf(propsRaw);
  const propStartOffset = match.index + idxInFull;
  const propEndOffset = propStartOffset + propsRaw.length;

  const startPos = doc.positionAt(propStartOffset);
  const endPos = doc.positionAt(propEndOffset);

  const edit = new vscode.WorkspaceEdit();
  edit.replace(targetUri, new vscode.Range(startPos, endPos), newPropsString);
  await vscode.workspace.applyEdit(edit);

  // Propagar al resto de usos
  await syncComponentPropsUsages(componentName, allProps);
}

// ---------------------- SYNC USOS DESDE DEFINICIÓN ----------------------

async function syncComponentPropsUsages(
  componentName: string,
  props: string[]
): Promise<void> {
  const files = await vscode.workspace.findFiles(
    "**/*.{tsx,jsx,ts,js}",
    "**/node_modules/**"
  );

  const edit = new vscode.WorkspaceEdit();
  let hasChanges = false;

  const tagRegex = new RegExp(`<${componentName}\\b([\\s\\S]*?)(/?)>`, "g");

  for (const uri of files) {
    if (isTestFile(uri)) {
      continue;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();

    tagRegex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(text)) !== null) {
      const fullMatch = match[0];
      const attrs = match[1] || "";
      const selfClosing = match[2] === "/";

      const missingProps = props.filter(
        (prop) => !new RegExp(`\\b${prop}\\s*=`).test(attrs)
      );

      if (!missingProps.length) {
        continue;
      }

      const insertParts = missingProps.map(
        (p) => ` ${p}={/* TODO: completar */}`
      );
      const insertText = insertParts.join("");

      const localIndexOfClose = fullMatch.lastIndexOf(selfClosing ? "/>" : ">");
      const absoluteInsertOffset =
        tagRegex.lastIndex - (fullMatch.length - localIndexOfClose);

      const insertPosition = doc.positionAt(absoluteInsertOffset);

      edit.insert(uri, insertPosition, insertText);
      hasChanges = true;
    }
  }

  if (!hasChanges) {
    return;
  }

  // 🟡 Botón de confirmación (solo usos)
  const applyLabel = "Aplicar cambios en los usos";
  const cancelLabel = "Cancelar";

  const choice = await vscode.window.showInformationMessage(
    `Se van a agregar props faltantes de <${componentName} /> en los usos. ¿Quieres aplicar los cambios?`,
    applyLabel,
    cancelLabel
  );

  if (choice !== applyLabel) {
    return;
  }

  await vscode.workspace.applyEdit(edit);
  vscode.window.showInformationMessage(
    `Props sincronizadas en los usos de <${componentName} />.`
  );
}
