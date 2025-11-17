import * as vscode from "vscode";

interface ComponentInfo {
  name: string;
  props: string[];
}

interface UsageInfo {
  componentName: string;
  props: string[];
}

// cache en memoria de props conocidas por componente
const componentPropsCache = new Map<string, string[]>();

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

    // 1) Definición -> usos (def es fuente de verdad para add + delete)
    const components = getComponentsInDocument(doc);
    if (components.length) {
      for (const c of components) {
        if (!c.props.length) {
          continue;
        }

        const prevProps = componentPropsCache.get(c.name) || [];
        const removedProps = prevProps.filter(
          (p) => !c.props.includes(p)
        );

        // actualizamos cache con la nueva firma
        componentPropsCache.set(c.name, c.props);

        await syncComponentPropsUsages(c.name, c.props, removedProps);
      }
    }

    // 2) Usos -> definición (uso puede agregar props a la definición)
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

// ---------------------- uso -> definición (y luego al resto de usos) ----------------------

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

  // canonical: unión de props existentes + props que vimos en el uso
  const allPropsSet = new Set<string>(defProps);
  for (const p of usageProps) {
    allPropsSet.add(p);
  }
  const allProps = Array.from(allPropsSet);

  const sameLength = allProps.length === defProps.length;
  const sameContent =
    sameLength && defProps.every((p, i) => p === allProps[i]);

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

  // no esperamos removals aquí porque usamos unión (solo añade)
  componentPropsCache.set(componentName, allProps);

  // Propagar al resto de usos (solo añade props que falten)
  await syncComponentPropsUsages(componentName, allProps);
}

// ---------------------- helper: parseo de atributos JSX ----------------------

interface ParsedAttr {
  name: string | null; // null para cosas tipo `{...rest}` o chunks raros
  text: string;        // texto completo del atributo incluyendo espacios iniciales
}

function parseJsxAttributes(attrs: string): ParsedAttr[] {
  const res: ParsedAttr[] = [];
  const n = attrs.length;
  let i = 0;

  while (i < n) {
    let start = i;

    // incluir espacios iniciales en el atributo
    while (i < n && /\s/.test(attrs[i])) i++;
    if (i >= n) {
      break;
    }

    // si empieza con '{' -> algo tipo `{...rest}`
    if (attrs[i] === "{") {
      let depth = 0;
      const exprStart = i;
      while (i < n) {
        const c = attrs[i];
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      const text = attrs.slice(start, i);
      res.push({ name: null, text });
      continue;
    }

    const first = attrs[i];

    // si no es letra/underscore -> chunk raro, lo dejamos tal cual
    if (!/[A-Za-z_$]/.test(first)) {
      while (i < n && !/\s/.test(attrs[i])) i++;
      const text = attrs.slice(start, i);
      res.push({ name: null, text });
      continue;
    }

    // nombre del atributo
    const nameStart = i;
    while (i < n && /[A-Za-z0-9_$]/.test(attrs[i])) i++;
    const name = attrs.slice(nameStart, i);

    // espacios después del nombre
    while (i < n && /\s/.test(attrs[i])) i++;

    // boolean prop sin '='
    if (i >= n || attrs[i] !== "=") {
      const text = attrs.slice(start, i);
      res.push({ name, text });
      continue;
    }

    // hay '='
    i++; // skip '='
    while (i < n && /\s/.test(attrs[i])) i++;
    if (i >= n) {
      const text = attrs.slice(start, i);
      res.push({ name, text });
      break;
    }

    const valueStart = i;
    let valueEnd = i;
    const ch = attrs[i];

    if (ch === "{") {
      let depth = 0;
      while (i < n) {
        const c = attrs[i];
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      valueEnd = i;
    } else if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < n) {
        const c = attrs[i];
        if (c === quote && attrs[i - 1] !== "\\") {
          i++;
          break;
        }
        i++;
      }
      valueEnd = i;
    } else {
      while (
        i < n &&
        !/\s/.test(attrs[i]) &&
        attrs[i] !== ">" &&
        attrs[i] !== "/"
      ) {
        i++;
      }
      valueEnd = i;
    }

    const text = attrs.slice(start, valueEnd);
    res.push({ name, text });
  }

  return res;
}

// ---------------------- SYNC USOS DESDE DEFINICIÓN ----------------------

async function syncComponentPropsUsages(
  componentName: string,
  props: string[],
  removedProps: string[] = []
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

      const parsed = parseJsxAttributes(attrs);
      const existingNames = new Set(
        parsed.filter((a) => a.name).map((a) => a.name as string)
      );

      const missingProps = props.filter((p) => !existingNames.has(p));
      const toRemoveSet = new Set(
        removedProps.filter((p) => existingNames.has(p))
      );

      if (missingProps.length === 0 && toRemoveSet.size === 0) {
        continue;
      }

      const newParts: string[] = [];

      // mantenemos todos los atributos excepto los que queremos eliminar
      for (const a of parsed) {
        if (a.name && toRemoveSet.has(a.name)) {
          continue; // eliminar este prop
        }
        newParts.push(a.text);
      }

      // añadimos props que faltan (con TODO)
      for (const p of missingProps) {
        newParts.push(` ${p}={/* TODO: completar */}`);
      }

      const newAttrs = newParts.join("");
      const newFull = `<${componentName}${newAttrs}${
        selfClosing ? "/>" : ">"
      }`;

      const startOffset = match.index!;
      const endOffset = startOffset + fullMatch.length;
      const startPos = doc.positionAt(startOffset);
      const endPos = doc.positionAt(endOffset);

      edit.replace(uri, new vscode.Range(startPos, endPos), newFull);
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
    `Se van a sincronizar las props de <${componentName} /> en sus usos (añadir y eliminar según la definición). ¿Quieres aplicar los cambios?`,
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
