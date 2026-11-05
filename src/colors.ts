import * as vscode from "vscode";
import {
  COLOR_FIELDS,
  COLOR_PRESETS,
  mergeSemanticRules,
  mergeTextMateRules,
  schemeById,
  semanticRules,
  tokenRules,
  workbenchColors,
  type ColorField,
  type ColorScheme,
} from "./core/colors";

const ACTIVE_KEY = "ghostcode.colors.active";
const BACKUP_KEY = "ghostcode.colors.backup";

interface StyleBackup {
  token?: unknown;
  workbench?: unknown;
  semantic?: unknown;
}

export interface ColorPanelState {
  presets: ColorScheme[];
  scheme: ColorScheme | null;
  fields: ColorField[];
  hasBackup: boolean;
}

/**
 * Aplica los colores del código en los ajustes globales. Antes de tocar nada guarda
 * una copia de los estilos que había para poder restaurarlos.
 */
export class ColorsService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async state(): Promise<ColorPanelState> {
    return {
      presets: COLOR_PRESETS,
      scheme: this.stored() ?? null,
      fields: COLOR_FIELDS,
      hasBackup: this.context.globalState.get<StyleBackup>(BACKUP_KEY) !== undefined,
    };
  }

  async applyPreset(id: string): Promise<boolean> {
    const preset = schemeById(id);
    if (!preset) return false;
    await this.apply(preset);
    return true;
  }

  /** Cambia un color del tema actual (o parte del preset por defecto). */
  async setColor(key: string, value: string): Promise<void> {
    if (!/^#[0-9a-f]{6}$/i.test(value)) return;
    const base = this.stored() ?? COLOR_PRESETS[0];
    const colors = { ...base.colors };
    let background = base.background;
    let foreground = base.foreground;

    if (key === "background") background = value;
    else if (key === "foreground") foreground = value;
    else if (key in colors) colors[key as keyof typeof colors] = value;
    else return;

    await this.apply({ id: "custom", label: "Personalizado", colors, background, foreground });
  }

  /** Restaura los ajustes que había antes de aplicar un tema de GhostCode. */
  async reset(): Promise<boolean> {
    const backup = this.context.globalState.get<StyleBackup>(BACKUP_KEY);
    if (!backup) {
      void vscode.window.showInformationMessage("GhostCode: no hay estilos anteriores guardados para restaurar.");
      return false;
    }

    const answer = await vscode.window.showWarningMessage(
      "Se restaurarán los estilos que tenías antes de aplicar el tema de GhostCode. Se perderán los cambios de color hechos después.",
      { modal: true },
      "Restaurar Estilos",
    );
    if (answer !== "Restaurar Estilos") return false;

    await this.write("editor", "tokenColorCustomizations", backup.token);
    await this.write("workbench", "colorCustomizations", backup.workbench);
    await this.write("editor", "semanticTokenColorCustomizations", backup.semantic);
    await this.context.globalState.update(BACKUP_KEY, undefined);
    await this.context.globalState.update(ACTIVE_KEY, undefined);
    return true;
  }

  private stored(): ColorScheme | undefined {
    const value = this.context.globalState.get<ColorScheme>(ACTIVE_KEY);
    return value && typeof value === "object" ? value : undefined;
  }

  private async apply(scheme: ColorScheme): Promise<void> {
    await this.backupOnce();
    const editor = vscode.workspace.getConfiguration("editor");
    const workbench = vscode.workspace.getConfiguration("workbench");

    const token = this.global<Record<string, unknown>>("editor", "tokenColorCustomizations");
    const nextToken = {
      ...(token && typeof token === "object" ? token : {}),
      textMateRules: mergeTextMateRules(token?.textMateRules, tokenRules(scheme)),
    };
    await editor.update("tokenColorCustomizations", nextToken, vscode.ConfigurationTarget.Global);

    const wb = this.global<Record<string, unknown>>("workbench", "colorCustomizations");
    await workbench.update(
      "colorCustomizations",
      { ...(wb && typeof wb === "object" ? wb : {}), ...workbenchColors(scheme) },
      vscode.ConfigurationTarget.Global,
    );

    const semantic = this.global<Record<string, unknown>>("editor", "semanticTokenColorCustomizations");
    await editor.update(
      "semanticTokenColorCustomizations",
      mergeSemanticRules(semantic, semanticRules(scheme)),
      vscode.ConfigurationTarget.Global,
    );

    await this.context.globalState.update(ACTIVE_KEY, scheme);
  }

  private async backupOnce(): Promise<void> {
    if (this.context.globalState.get<StyleBackup>(BACKUP_KEY) !== undefined) return;
    const backup: StyleBackup = {
      token: this.global("editor", "tokenColorCustomizations"),
      workbench: this.global("workbench", "colorCustomizations"),
      semantic: this.global("editor", "semanticTokenColorCustomizations"),
    };
    await this.context.globalState.update(BACKUP_KEY, backup);
  }

  private global<T>(section: string, key: string): T | undefined {
    return vscode.workspace.getConfiguration(section).inspect<T>(key)?.globalValue;
  }

  private async write(section: string, key: string, value: unknown): Promise<void> {
    await vscode.workspace.getConfiguration(section).update(key, value, vscode.ConfigurationTarget.Global);
  }
}
