import { renderJson, renderJsonSummary } from "./json.js";
import { renderTableReport, renderModuleDetail, renderWhatIf, findModule } from "./table.js";
import { renderMarkdown } from "./markdown.js";
import { renderHtml } from "./html.js";
import { renderSarif } from "./sarif.js";
import { renderDot } from "./dot.js";
import { renderDiff } from "./diff.js";
import type { Report } from "../types.js";

export type Format = "json" | "table" | "markdown" | "html" | "sarif" | "dot";

export const FORMATS: readonly Format[] = ["json", "table", "markdown", "html", "sarif", "dot"];

export function render(report: Report, format: Format, options: { verbose?: boolean } = {}): string {
  switch (format) {
    case "json":
      return renderJson(report);
    case "markdown":
      return renderMarkdown(report);
    case "html":
      return renderHtml(report);
    case "sarif":
      return renderSarif(report);
    case "dot":
      return renderDot(report);
    case "table":
    default:
      return renderTableReport(report, options);
  }
}

export {
  renderJson,
  renderJsonSummary,
  renderTableReport,
  renderModuleDetail,
  renderWhatIf,
  renderMarkdown,
  renderHtml,
  renderSarif,
  renderDot,
  renderDiff,
  findModule,
};
