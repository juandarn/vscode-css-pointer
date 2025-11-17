import * as vscode from "vscode";
import { registerCssPointer } from "./features/cssPointer";
import { registerReactPropSync } from "./features/reactPropSync";

export function activate(context: vscode.ExtensionContext) {
  registerCssPointer(context);
  registerReactPropSync(context);

}

export function deactivate() {}
