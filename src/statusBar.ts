import * as vscode from "vscode";

type State = "idle" | "loading" | "error" | "off";

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private label = "GhostCode";
  private state: State = "idle";
  private inflight = 0;
  private lastLatency?: number;
  private errorMsg?: string;

  constructor() {
    this.item.command = "ghostcode.selectMode";
    this.item.name = "GhostCode";
    this.render();
    this.item.show();
  }

  setBackend(label: string | undefined): void {
    this.label = label ?? "Desactivado";
    this.state = label ? "idle" : "off";
    this.errorMsg = undefined;
    this.render();
  }

  begin(): void {
    this.inflight++;
    if (this.state !== "off") this.state = "loading";
    this.render();
  }

  end(latencyMs?: number): void {
    this.inflight = Math.max(0, this.inflight - 1);
    if (latencyMs !== undefined) {
      this.lastLatency = latencyMs;
      this.errorMsg = undefined;
    }
    if (this.inflight === 0 && this.state === "loading") this.state = this.errorMsg ? "error" : "idle";
    this.render();
  }

  error(msg: string): void {
    this.errorMsg = msg;
    this.state = "error";
    this.render();
  }

  private render(): void {
    const icon =
      this.state === "loading" ? "$(loading~spin)"
      : this.state === "error" ? "$(warning)"
      : this.state === "off" ? "$(circle-slash)"
      : "$(sparkle)";
    this.item.text = `${icon} ${this.label}`;
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**GhostCode** — ${this.label}\n\n`);
    if (this.errorMsg) md.appendMarkdown(`$(warning) ${this.errorMsg}\n\n`);
    if (this.lastLatency !== undefined) md.appendMarkdown(`Última sugerencia: ${this.lastLatency} ms\n\n`);
    md.appendMarkdown("Clic para cambiar de modo (Local / API / Desactivado)");
    this.item.tooltip = md;
    this.item.backgroundColor =
      this.state === "error" ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}
