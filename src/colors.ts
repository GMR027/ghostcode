import * as vscode from "vscode";
import {
  COLOR_FIELDS,
  DEFAULT_SCHEME,
  mergeSemanticRules,
  mergeTextMateRules,
  semanticRules,
  tokenRules,
  workbenchColors,
  type ColorField,
  type ColorScheme,
} from "./core/colors";
import {
  BRACKET_LEVELS,
  mergeBracketColors,
  normalizeBrackets,
  type BracketSettings,
} from "./core/brackets";
import { checkContrast, type ContrastCheck } from "./core/contrast";

const ACTIVE_KEY = "ghostcode.colors.active";
const BACKUP_KEY = "ghostcode.colors.backup";
const BRACKETS_KEY = "ghostcode.brackets.active";
const BRACKETS_BACKUP_KEY = "ghostcode.brackets.backup";

interface StyleBackup {
  token?: unknown;
  workbench?: unknown;
  semantic?: unknown;
}

interface BracketBackup {
  colorization?: boolean;
  pairGuides?: unknown;
  indentation?: boolean;
}

export interface ColorPanelState {
  scheme: ColorScheme;
  fields: ColorField[];
  hasBackup: boolean;
  brackets: BracketSettings;
  /** Contraste WCAG de cada color base contra el fondo. */
  contrast: Record<string, ContrastCheck>;
  /** Contraste de cada nivel de corchetes contra el fondo. */
  bracketContrast: ContrastCheck[];
}

/**
 * Aplica los colores del código en los ajustes globales. Antes de tocar nada guarda
 * una copia de los estilos que había para poder restaurarlos.
 */
export class ColorsService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async state(): Promise<ColorPanelState> {
    const scheme = this.stored() ?? DEFAULT_SCHEME;
    const brackets = this.bracketSettings();
    return {
      scheme,
      fields: COLOR_FIELDS,
      hasBackup: this.hasBackup(),
      brackets,
      contrast: checkContrast(scheme.background, { ...scheme.colors, foreground: scheme.foreground }),
      bracketContrast: brackets.levels.map((color) => checkContrast(scheme.background, { level: color }).level),
    };
  }

  /** Cambia un color base del tema actual (o parte de la paleta por defecto). */
  async setColor(key: string, value: string): Promise<void> {
    if (!/^#[0-9a-f]{6}$/i.test(value)) return;
    const base = this.stored() ?? DEFAULT_SCHEME;
    const colors = { ...base.colors };
    let background = base.background;
    let foreground = base.foreground;

    if (key === "background") background = value;
    else if (key === "foreground") foreground = value;
    else if (key in colors) colors[key as keyof typeof colors] = value;
    else return;

    await this.apply({ id: "custom", label: "Personalizado", colors, background, foreground });
  }

  /** Cambia el color de un nivel de anidamiento (0 = padre, 5 = hijo más profundo). */
  async setBracketLevel(index: number, value: string): Promise<void> {
    if (!/^#[0-9a-f]{6}$/i.test(value)) return;
    if (!Number.isInteger(index) || index < 0 || index >= BRACKET_LEVELS) return;
    const settings = this.bracketSettings();
    const levels = [...settings.levels];
    levels[index] = value;
    await this.applyBrackets({ ...settings, levels });
  }

  /** Enciende o apaga las guías de pares o las de indentación. */
  async toggleBracketOption(key: "guides" | "indentation"): Promise<void> {
    const settings = this.bracketSettings();
    await this.applyBrackets({ ...settings, [key]: !settings[key] });
  }

  /** Restaura los ajustes que había antes de aplicar estilos de GhostCode. */
  async reset(): Promise<boolean> {
    if (!this.hasBackup()) {
      void vscode.window.showInformationMessage("GhostCode: no hay estilos anteriores guardados para restaurar.");
      return false;
    }

    const answer = await vscode.window.showWarningMessage(
      "Se restaurarán los estilos que tenías antes de aplicar los cambios de GhostCode. Se perderán los colores personalizados.",
      { modal: true },
      "Restaurar Estilos",
    );
    if (answer !== "Restaurar Estilos") return false;

    const backup = this.context.globalState.get<StyleBackup>(BACKUP_KEY);
    if (backup) {
      await this.write("editor", "tokenColorCustomizations", backup.token);
      await this.write("workbench", "colorCustomizations", backup.workbench);
      await this.write("editor", "semanticTokenColorCustomizations", backup.semantic);
      await this.context.globalState.update(BACKUP_KEY, undefined);
    }

    const bracketBackup = this.context.globalState.get<BracketBackup>(BRACKETS_BACKUP_KEY);
    if (bracketBackup) {
      await this.write("editor", "bracketPairColorization.enabled", bracketBackup.colorization);
      await this.write("editor", "guides.bracketPairs", bracketBackup.pairGuides);
      await this.write("editor", "guides.indentation", bracketBackup.indentation);
      await this.context.globalState.update(BRACKETS_BACKUP_KEY, undefined);
    }

    await this.context.globalState.update(ACTIVE_KEY, undefined);
    await this.context.globalState.update(BRACKETS_KEY, undefined);
    return true;
  }

  private hasBackup(): boolean {
    return (
      this.context.globalState.get<StyleBackup>(BACKUP_KEY) !== undefined ||
      this.context.globalState.get<BracketBackup>(BRACKETS_BACKUP_KEY) !== undefined
    );
  }

  private stored(): ColorScheme | undefined {
    const value = this.context.globalState.get<ColorScheme>(ACTIVE_KEY);
    return value && typeof value === "object" ? value : undefined;
  }

  private bracketSettings(): BracketSettings {
    return normalizeBrackets(this.context.globalState.get<BracketSettings>(BRACKETS_KEY));
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

  private async applyBrackets(settings: BracketSettings): Promise<void> {
    await this.backupOnce();
    await this.backupBracketsOnce();

    const workbench = vscode.workspace.getConfiguration("workbench");
    const wb = this.global<Record<string, unknown>>("workbench", "colorCustomizations");
    await workbench.update(
      "colorCustomizations",
      mergeBracketColors(wb, settings),
      vscode.ConfigurationTarget.Global,
    );

    const editor = vscode.workspace.getConfiguration("editor");
    await editor.update("bracketPairColorization.enabled", true, vscode.ConfigurationTarget.Global);
    await editor.update("guides.bracketPairs", settings.guides, vscode.ConfigurationTarget.Global);
    // Las guías de indentación solo se activan al colorearlas; al apagarlas se
    // recupera el valor que tenía el usuario antes del primer cambio.
    const backup = this.context.globalState.get<BracketBackup>(BRACKETS_BACKUP_KEY);
    await editor.update(
      "guides.indentation",
      settings.indentation ? true : backup?.indentation,
      vscode.ConfigurationTarget.Global,
    );

    await this.context.globalState.update(BRACKETS_KEY, settings);
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

  private async backupBracketsOnce(): Promise<void> {
    if (this.context.globalState.get<BracketBackup>(BRACKETS_BACKUP_KEY) !== undefined) return;
    const backup: BracketBackup = {
      colorization: this.global("editor", "bracketPairColorization.enabled"),
      pairGuides: this.global("editor", "guides.bracketPairs"),
      indentation: this.global("editor", "guides.indentation"),
    };
    await this.context.globalState.update(BRACKETS_BACKUP_KEY, backup);
  }

  private global<T>(section: string, key: string): T | undefined {
    return vscode.workspace.getConfiguration(section).inspect<T>(key)?.globalValue;
  }

  private async write(section: string, key: string, value: unknown): Promise<void> {
    await vscode.workspace.getConfiguration(section).update(key, value, vscode.ConfigurationTarget.Global);
  }
}
