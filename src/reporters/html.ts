import type { Report } from "../types.js";

/**
 * Data actually needed by the page. The full report is often megabytes; the
 * HTML only carries what it draws, so the file stays openable.
 */
function projectReport(report: Report): unknown {
  return {
    tool: report.tool,
    project: { root: report.project.root, fileCount: report.project.fileCount },
    application: report.application,
    applications: report.applications.map((scope) => ({
      name: scope.name,
      entrypoint: scope.entrypoint,
      maintainabilityLevel: scope.maintainabilityLevel,
      grade: scope.grade,
      k: scope.k,
      meanCoupling: scope.meanCoupling,
    })),
    thresholds: report.config.thresholds,
    weights: report.config.weights,
    modules: report.modules.map((module) => ({
      id: module.id,
      name: module.name,
      file: module.file,
      kind: module.kind,
      global: module.global,
      ml: module.maintainabilityLevel,
      grade: module.grade,
      ci: module.coupling.ci,
      Ca: module.coupling.Ca,
      Ce: module.coupling.Ce,
      CaFiles: module.coupling.CaFiles,
      CeFiles: module.coupling.CeFiles,
      I: module.coupling.instability,
      A: module.coupling.abstractness,
      D: module.coupling.distanceFromMainSequence,
      deps: module.coupling.efferentModules,
      dependents: module.coupling.afferentModules,
      cohesion: module.cohesion.structural,
      lcom4Max: module.cohesion.lcom4Max,
      lcom4Mean: module.cohesion.lcom4Mean,
      splitClasses: module.cohesion.lcom4Classes
        .filter((entry) => entry.counted && entry.lcom4 > 1)
        .slice(0, 8)
        .map((entry) => ({
          name: entry.class,
          file: entry.file,
          line: entry.line,
          lcom4: entry.lcom4,
          components: entry.components,
        })),
      cogP90: module.complexity.cognitive.p90,
      cogMax: module.complexity.cognitive.max,
      cycP90: module.complexity.cyclomatic.p90,
      functions: module.complexity.functionCount,
      hotFunctions: module.complexity.aboveThreshold.slice(0, 8),
      statements: module.size.statements,
      fileCount: module.files.length,
      largestFile: module.size.largestFile,
      blast: module.blastRadius.ratio,
      blastModules: module.blastRadius.moduleCount,
      domainAlignment: module.partitioning.domainAlignment,
      classification: module.partitioning.classification,
      penalties: module.penalties,
    })),
    violations: report.boundaryViolations.map((violation) => ({
      from: violation.from,
      to: violation.to,
      fromModule: violation.fromModule,
      toModule: violation.toModule,
      kind: violation.kind,
      typeOnly: violation.typeOnly,
      line: violation.line,
    })),
    refactors: report.refactorCandidates,
    warnings: report.warnings.slice(0, 300),
    warningCount: report.warnings.length,
  };
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #ffffff; --panel: #f6f7f9; --border: #e2e5ea; --text: #14181f;
  --muted: #626b7a; --accent: #2b6cb0; --shadow: rgba(15, 23, 42, 0.08);
  --a: #2f855a; --b: #68a04a; --c: #d69e2e; --d: #dd6b20; --f: #c53030;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12151b; --panel: #1a1f27; --border: #2a313c; --text: #e6e9ee;
    --muted: #94a0b3; --accent: #63a4ff; --shadow: rgba(0, 0, 0, 0.4);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
header { padding: 24px 28px 12px; border-bottom: 1px solid var(--border); }
h1 { font-size: 18px; margin: 0 0 2px; letter-spacing: -0.01em; }
h2 { font-size: 15px; margin: 0 0 10px; }
.sub { color: var(--muted); font-size: 12px; }
.tiles { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.tile {
  background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 14px; min-width: 150px;
}
.tile .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.tile .value { font-size: 22px; font-weight: 650; margin-top: 2px; font-variant-numeric: tabular-nums; }
.tile .note { font-size: 11px; color: var(--muted); margin-top: 2px; }
nav { display: flex; gap: 4px; padding: 12px 28px 0; border-bottom: 1px solid var(--border); }
nav button {
  background: none; border: none; border-bottom: 2px solid transparent; color: var(--muted);
  padding: 8px 12px; font: inherit; cursor: pointer; border-radius: 6px 6px 0 0;
}
nav button:hover { color: var(--text); }
nav button[aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
main { padding: 20px 28px 60px; }
section[hidden] { display: none; }
.split { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; align-items: start; }
@media (max-width: 900px) { .split { grid-template-columns: minmax(0, 1fr); } }
.card {
  background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
  padding: 14px 16px; box-shadow: 0 1px 2px var(--shadow);
}
svg { width: 100%; height: auto; display: block; touch-action: none; }
.node { cursor: pointer; }
.node text { font-size: 9px; fill: var(--text); pointer-events: none; }
.link { stroke: var(--muted); stroke-opacity: 0.35; }
.link.violation { stroke: var(--f); stroke-opacity: 0.75; stroke-dasharray: 4 3; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: right; padding: 5px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
th:first-child, td:first-child { text-align: left; white-space: normal; }
th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); cursor: pointer; }
tbody tr { cursor: pointer; }
tbody tr:hover { background: var(--border); }
.scroll { overflow-x: auto; }
.pill { display: inline-block; padding: 1px 7px; border-radius: 999px; color: #fff; font-size: 11px; font-weight: 650; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.muted { color: var(--muted); }
ul.plain { list-style: none; padding: 0; margin: 0; }
ul.plain li { padding: 5px 0; border-bottom: 1px solid var(--border); font-size: 12.5px; }
.bar { height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; margin-top: 3px; }
.bar > span { display: block; height: 100%; }
.legend { font-size: 11px; color: var(--muted); margin-top: 8px; }
.axis { stroke: var(--border); }
.axis-label { font-size: 10px; fill: var(--muted); }
.mainseq { stroke: var(--accent); stroke-dasharray: 5 4; stroke-opacity: 0.8; }
footer { padding: 20px 28px 40px; color: var(--muted); font-size: 12px; border-top: 1px solid var(--border); }
`;

const SCRIPT = String.raw`
(function () {
  var data = window.__NEST_ML__;
  var GRADE_COLOURS = { A: "#2f855a", B: "#68a04a", C: "#d69e2e", D: "#dd6b20", F: "#c53030" };
  var byId = {};
  data.modules.forEach(function (m) { byId[m.id] = m; });

  function el(tag, attrs, children) {
    var node = document.createElementNS(
      tag === "svg" || SVG_TAGS.indexOf(tag) >= 0 ? "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xhtml",
      tag
    );
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === "text") node.textContent = attrs[key];
      else if (key === "html") node.innerHTML = attrs[key];
      else if (key.slice(0, 2) === "on") node.addEventListener(key.slice(2), attrs[key]);
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { node.appendChild(child); });
    return node;
  }
  var SVG_TAGS = ["g", "circle", "line", "text", "path", "rect", "title"];

  function esc(value) {
    return String(value).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }

  // ---------------------------------------------------------------- tabs
  var tabs = document.querySelectorAll("nav button");
  var sections = document.querySelectorAll("main > section");
  Array.prototype.forEach.call(tabs, function (tab) {
    tab.addEventListener("click", function () {
      Array.prototype.forEach.call(tabs, function (other) {
        other.setAttribute("aria-selected", String(other === tab));
      });
      Array.prototype.forEach.call(sections, function (section) {
        section.hidden = section.id !== tab.dataset.target;
      });
    });
  });

  // ------------------------------------------------------------- details
  var detail = document.getElementById("detail");
  function pct(value) { return Math.round(value * 100) + "%"; }

  function showModule(id) {
    var m = byId[id];
    if (!m) return;
    var parts = [];
    parts.push('<h2>' + esc(m.name) + '</h2>');
    parts.push('<div class="sub mono">' + esc(m.file || "pseudo-module") + '</div>');
    parts.push('<p><span class="pill" style="background:' + GRADE_COLOURS[m.grade] + '">' +
      m.ml.toFixed(1) + " " + m.grade + '</span> <span class="muted">maintainability</span></p>');

    parts.push('<h2>Score breakdown</h2><table><tbody>');
    var rows = [
      ["coupling", m.penalties.coupling, data.weights.coupling],
      ["cohesion", m.penalties.cohesion, data.weights.cohesion],
      ["complexity", m.penalties.complexity, data.weights.complexity],
      ["size", m.penalties.size, data.weights.size],
      ["partitioning", m.penalties.partitioning, data.weights.partitioning]
    ];
    rows.forEach(function (row) {
      parts.push('<tr><td>' + row[0] + '</td><td>' + row[1].toFixed(3) +
        '</td><td class="muted">x ' + row[2].toFixed(2) + '</td><td>' +
        (row[1] * row[2]).toFixed(3) + '</td></tr>');
    });
    parts.push('</tbody></table>');

    parts.push('<h2>Coupling</h2><ul class="plain">');
    parts.push('<li>Ca <b>' + m.Ca + '</b> (' + m.CaFiles + ' files) &middot; Ce <b>' + m.Ce +
      '</b> (' + m.CeFiles + ' files) &middot; c_i <b>' + m.ci.toFixed(3) + '</b></li>');
    parts.push('<li>Instability ' + m.I.toFixed(2) + ' &middot; Abstractness ' + m.A.toFixed(2) +
      ' &middot; distance from main sequence ' + m.D.toFixed(2) + '</li>');
    parts.push('<li>Blast radius <b>' + m.blastModules + '</b> modules (' + pct(m.blast) + ' of the app)</li>');
    parts.push('</ul>');

    if (m.dependents.length) {
      parts.push('<h2>Depended on by</h2><ul class="plain">');
      m.dependents.forEach(function (dep) {
        parts.push('<li><a href="#" data-goto="' + esc(dep) + '">' + esc((byId[dep] || {}).name || dep) + '</a></li>');
      });
      parts.push('</ul>');
    }

    parts.push('<h2>Cohesion</h2><ul class="plain">');
    parts.push('<li>Structural ' + m.cohesion.toFixed(3) + ' &middot; LCOM4 max ' + m.lcom4Max +
      ', mean ' + m.lcom4Mean.toFixed(2) + '</li>');
    m.splitClasses.forEach(function (cls) {
      parts.push('<li><b>' + esc(cls.name) + '</b> splits into ' + cls.lcom4 +
        '<div class="mono muted">' + esc(cls.file) + ':' + cls.line + '</div>' +
        cls.components.map(function (component) {
          return '<div class="mono">{' + esc(component.join(", ")) + '}</div>';
        }).join("") + '</li>');
    });
    parts.push('</ul>');

    parts.push('<h2>Complexity &amp; size</h2><ul class="plain">');
    parts.push('<li>Cognitive p90 <b>' + m.cogP90 + '</b>, max ' + m.cogMax +
      ' &middot; cyclomatic p90 ' + m.cycP90 + ' (' + m.functions + ' functions)</li>');
    parts.push('<li>' + m.statements + ' statements in ' + m.fileCount + ' files</li>');
    if (m.largestFile) {
      parts.push('<li class="mono muted">largest: ' + esc(m.largestFile.path) + ' (' + m.largestFile.statements + ')</li>');
    }
    m.hotFunctions.forEach(function (fn) {
      parts.push('<li class="mono">' + esc(fn.name) + ' <span class="muted">' + esc(fn.file) + ':' + fn.line +
        '</span> cyc ' + fn.cyclomatic + ' / cog ' + fn.cognitive + '</li>');
    });
    parts.push('</ul>');

    var related = data.violations.filter(function (v) {
      return v.fromModule === m.id || v.toModule === m.id;
    });
    if (related.length) {
      parts.push('<h2>Boundary violations (' + related.length + ')</h2><ul class="plain">');
      related.slice(0, 25).forEach(function (v) {
        parts.push('<li class="mono">' + esc((byId[v.fromModule] || {}).name || v.fromModule) + ' &rarr; ' +
          esc((byId[v.toModule] || {}).name || v.toModule) + '<div class="muted">' + esc(v.from) + ':' + v.line + '</div></li>');
      });
      parts.push('</ul>');
    }

    detail.innerHTML = parts.join("");
    Array.prototype.forEach.call(detail.querySelectorAll("[data-goto]"), function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        showModule(link.dataset.goto);
      });
    });
  }

  // --------------------------------------------------------- force graph
  var WIDTH = 900, HEIGHT = 620;
  var svg = document.getElementById("graph");
  svg.setAttribute("viewBox", "0 0 " + WIDTH + " " + HEIGHT);

  var maxStatements = Math.max.apply(null, data.modules.map(function (m) { return m.statements; }).concat([1]));
  var nodes = data.modules.map(function (m, index) {
    var angle = (index / data.modules.length) * Math.PI * 2;
    return {
      id: m.id, m: m,
      x: WIDTH / 2 + Math.cos(angle) * 220,
      y: HEIGHT / 2 + Math.sin(angle) * 220,
      vx: 0, vy: 0,
      r: 6 + 26 * Math.sqrt(m.statements / maxStatements)
    };
  });
  var index = {};
  nodes.forEach(function (node) { index[node.id] = node; });

  var violationPairs = {};
  data.violations.forEach(function (v) { violationPairs[v.fromModule + " " + v.toModule] = true; });

  var links = [];
  data.modules.forEach(function (m) {
    m.deps.forEach(function (target) {
      if (index[target]) {
        links.push({ source: index[m.id], target: index[target], violation: !!violationPairs[m.id + " " + target] });
      }
    });
  });

  // Deterministic seeded jitter keeps the layout identical between reloads.
  var seed = 42;
  function random() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

  function step() {
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      for (var j = i + 1; j < nodes.length; j++) {
        var b = nodes[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var force = (2600 + (a.r + b.r) * 40) / (distance * distance);
        var ux = dx / distance, uy = dy / distance;
        a.vx -= ux * force; a.vy -= uy * force;
        b.vx += ux * force; b.vy += uy * force;
      }
    }
    links.forEach(function (link) {
      var dx = link.target.x - link.source.x, dy = link.target.y - link.source.y;
      var distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
      var target = 120 + link.source.r + link.target.r;
      var force = (distance - target) * 0.012;
      var ux = dx / distance, uy = dy / distance;
      link.source.vx += ux * force; link.source.vy += uy * force;
      link.target.vx -= ux * force; link.target.vy -= uy * force;
    });
    nodes.forEach(function (node) {
      node.vx += (WIDTH / 2 - node.x) * 0.0016;
      node.vy += (HEIGHT / 2 - node.y) * 0.0016;
      node.vx *= 0.86; node.vy *= 0.86;
      node.x += node.vx; node.y += node.vy;
      node.x = Math.max(node.r + 4, Math.min(WIDTH - node.r - 4, node.x));
      node.y = Math.max(node.r + 4, Math.min(HEIGHT - node.r - 4, node.y));
    });
  }

  nodes.forEach(function (node) { node.x += random() * 6; node.y += random() * 6; });
  for (var tick = 0; tick < 420; tick++) step();

  var linkLayer = el("g", {});
  var nodeLayer = el("g", {});
  svg.appendChild(linkLayer);
  svg.appendChild(nodeLayer);

  var linkElements = links.map(function (link) {
    var line = el("line", { class: "link" + (link.violation ? " violation" : ""), "stroke-width": link.violation ? 1.6 : 1 });
    linkLayer.appendChild(line);
    return line;
  });

  var nodeElements = nodes.map(function (node) {
    var group = el("g", { class: "node", onclick: function () { showModule(node.id); } });
    var circle = el("circle", {
      r: node.r,
      fill: GRADE_COLOURS[node.m.grade],
      "fill-opacity": node.m.kind === "synthetic" ? 0.55 : 0.9,
      stroke: node.m.kind === "synthetic" ? GRADE_COLOURS[node.m.grade] : "none",
      "stroke-dasharray": node.m.kind === "synthetic" ? "3 2" : "0"
    });
    var title = el("title", {
      text: node.m.name + "  ML " + node.m.ml.toFixed(1) + " (" + node.m.grade + ")\n" +
        "Ca " + node.m.Ca + " / Ce " + node.m.Ce + "\n" + node.m.statements + " statements"
    });
    var label = el("text", { "text-anchor": "middle", dy: node.r + 10, text: node.m.name });
    group.appendChild(circle); group.appendChild(title); group.appendChild(label);
    nodeLayer.appendChild(group);
    return { group: group, circle: circle, label: label, node: node };
  });

  function draw() {
    linkElements.forEach(function (line, i) {
      line.setAttribute("x1", links[i].source.x); line.setAttribute("y1", links[i].source.y);
      line.setAttribute("x2", links[i].target.x); line.setAttribute("y2", links[i].target.y);
    });
    nodeElements.forEach(function (entry) {
      entry.circle.setAttribute("cx", entry.node.x);
      entry.circle.setAttribute("cy", entry.node.y);
      entry.label.setAttribute("x", entry.node.x);
      entry.label.setAttribute("y", entry.node.y);
    });
  }
  draw();

  var dragging = null;
  svg.addEventListener("pointerdown", function (event) {
    var point = toSvg(event);
    var closest = null, best = Infinity;
    nodes.forEach(function (node) {
      var d = Math.hypot(node.x - point.x, node.y - point.y);
      if (d < node.r && d < best) { best = d; closest = node; }
    });
    if (closest) { dragging = closest; svg.setPointerCapture(event.pointerId); }
  });
  svg.addEventListener("pointermove", function (event) {
    if (!dragging) return;
    var point = toSvg(event);
    dragging.x = point.x; dragging.y = point.y; dragging.vx = 0; dragging.vy = 0;
    for (var i = 0; i < 6; i++) step();
    draw();
  });
  svg.addEventListener("pointerup", function () { dragging = null; });

  function toSvg(event) {
    var rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT
    };
  }

  // ------------------------------------------------------------ scatter
  var scatter = document.getElementById("scatter");
  var SW = 760, SH = 560, PAD = 56;
  scatter.setAttribute("viewBox", "0 0 " + SW + " " + SH);
  var px = function (value) { return PAD + value * (SW - PAD * 2); };
  var py = function (value) { return SH - PAD - value * (SH - PAD * 2); };

  scatter.appendChild(el("line", { class: "axis", x1: PAD, y1: SH - PAD, x2: SW - PAD, y2: SH - PAD }));
  scatter.appendChild(el("line", { class: "axis", x1: PAD, y1: PAD, x2: PAD, y2: SH - PAD }));
  scatter.appendChild(el("line", { class: "mainseq", x1: px(0), y1: py(1), x2: px(1), y2: py(0) }));
  scatter.appendChild(el("text", { class: "axis-label", x: SW / 2, y: SH - 18, "text-anchor": "middle",
    text: "Instability I = Ce / (Ca + Ce)   ->   less stable" }));
  scatter.appendChild(el("text", { class: "axis-label", x: 16, y: SH / 2, "text-anchor": "middle",
    transform: "rotate(-90 16 " + SH / 2 + ")", text: "Abstractness A   ->   more abstract" }));
  scatter.appendChild(el("text", { class: "axis-label", x: px(0.08), y: py(0.06), text: "zone of pain" }));
  scatter.appendChild(el("text", { class: "axis-label", x: px(0.62), y: py(0.94), text: "zone of uselessness" }));
  scatter.appendChild(el("text", { class: "axis-label", x: px(0.52), y: py(0.55), text: "main sequence" }));

  data.modules.forEach(function (m) {
    var group = el("g", { class: "node", onclick: function () { showModule(m.id); } });
    group.appendChild(el("circle", {
      cx: px(m.I), cy: py(m.A), r: 4 + 14 * Math.sqrt(m.statements / maxStatements),
      fill: GRADE_COLOURS[m.grade], "fill-opacity": 0.75
    }));
    group.appendChild(el("title", { text: m.name + "  I " + m.I.toFixed(2) + ", A " + m.A.toFixed(2) + ", D " + m.D.toFixed(2) }));
    group.appendChild(el("text", { x: px(m.I) + 8, y: py(m.A) + 3, class: "axis-label", text: m.name }));
    scatter.appendChild(group);
  });

  // -------------------------------------------------------------- table
  var tbody = document.getElementById("modules-body");
  var sortKey = "ml", sortAsc = true;
  function renderRows() {
    var rows = data.modules.slice().sort(function (a, b) {
      var va = a[sortKey], vb = b[sortKey];
      if (typeof va === "string") return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortAsc ? va - vb : vb - va;
    });
    tbody.innerHTML = rows.map(function (m) {
      return '<tr data-id="' + esc(m.id) + '">' +
        '<td>' + esc(m.name) + (m.kind === "synthetic" ? ' <span class="muted">(pseudo)</span>' : "") + '</td>' +
        '<td><span class="pill" style="background:' + GRADE_COLOURS[m.grade] + '">' + m.ml.toFixed(0) + '</span></td>' +
        '<td>' + m.ci.toFixed(2) + '</td><td>' + m.Ca + '</td><td>' + m.Ce + '</td>' +
        '<td>' + m.I.toFixed(2) + '</td><td>' + m.cohesion.toFixed(2) + '</td><td>' + m.lcom4Max + '</td>' +
        '<td>' + m.cogP90 + '</td><td>' + m.statements + '</td><td>' + pct(m.blast) + '</td></tr>';
    }).join("");
    Array.prototype.forEach.call(tbody.querySelectorAll("tr"), function (row) {
      row.addEventListener("click", function () { showModule(row.dataset.id); });
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll("#modules-table th"), function (th) {
    th.addEventListener("click", function () {
      var key = th.dataset.key;
      if (!key) return;
      if (sortKey === key) sortAsc = !sortAsc; else { sortKey = key; sortAsc = key === "name" || key === "ml"; }
      renderRows();
    });
  });
  renderRows();

  if (data.modules.length) showModule(data.modules[0].id);
})();
`;

/**
 * A single self-contained file: no CDN, no fetch, no external fonts. It opens
 * from a file:// URL on a laptop with no network, which is the only way an
 * artifact like this actually gets looked at.
 */
export function renderHtml(report: Report): string {
  const data = projectReport(report);
  const app = report.application;
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");

  const tile = (label: string, value: string, note: string): string =>
    `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="note">${note}</div></div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Maintainability - ${escapeHtml(report.project.root)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>${escapeHtml(report.tool.name)} <span class="sub">v${escapeHtml(report.tool.version)}</span></h1>
  <div class="sub">${escapeHtml(report.project.root)} &middot; ${report.project.fileCount} files &middot; ${app.k} modules</div>
  <div class="tiles">
    ${tile("Maintainability", `${app.maintainabilityLevel.toFixed(1)} ${app.grade}`, "size-weighted mean of module ML")}
    ${tile("Coupling", app.meanCoupling.toFixed(2), `mean c_i across ${app.k} modules &middot; lower is better`)}
    ${tile("Partitioning", app.partitioning.verdict, `confidence ${app.partitioning.confidence.toFixed(2)} (heuristic)`)}
    ${tile("Violations", String(report.boundaryViolations.length), `${report.warnings.length} warnings`)}
  </div>
</header>

<nav>
  <button data-target="tab-graph" aria-selected="true">Module graph</button>
  <button data-target="tab-scatter" aria-selected="false">Main sequence</button>
  <button data-target="tab-modules" aria-selected="false">Modules</button>
  <button data-target="tab-issues" aria-selected="false">Issues</button>
</nav>

<main>
  <section id="tab-graph">
    <div class="split">
      <div class="card">
        <h2>Module dependency graph</h2>
        <svg id="graph" role="img" aria-label="Force-directed module dependency graph"></svg>
        <div class="legend">
          Node size is statements, colour is maintainability level. Dashed outlines are synthetic
          pseudo-modules. Red dashed edges are dependencies that no <span class="mono">@Module({ imports })</span>
          declares. Drag a node to untangle it; click for detail.
        </div>
      </div>
      <div class="card" id="detail"></div>
    </div>
  </section>

  <section id="tab-scatter" hidden>
    <div class="split">
      <div class="card">
        <h2>Instability vs abstractness</h2>
        <svg id="scatter" role="img" aria-label="Instability against abstractness, with the main sequence"></svg>
        <div class="legend">
          Robert Martin's main sequence. Modules far below the line are concrete and heavily
          depended upon (hard to change); modules far above it are abstract and unused.
          Abstractness counts interfaces, type aliases and abstract classes against concrete classes,
          so a module of plain services sits at A = 0 by construction.
        </div>
      </div>
      <div class="card" id="detail-scatter"><p class="muted">Click a point to open it in the Module graph tab's detail panel.</p></div>
    </div>
  </section>

  <section id="tab-modules" hidden>
    <div class="card scroll">
      <h2>Modules</h2>
      <table id="modules-table">
        <thead><tr>
          <th data-key="name">Module</th><th data-key="ml">ML</th><th data-key="ci">c_i</th>
          <th data-key="Ca">Ca</th><th data-key="Ce">Ce</th><th data-key="I">I</th>
          <th data-key="cohesion">Coh</th><th data-key="lcom4Max">LCOM4</th>
          <th data-key="cogP90">CogP90</th><th data-key="statements">Stmts</th><th data-key="blast">Blast</th>
        </tr></thead>
        <tbody id="modules-body"></tbody>
      </table>
      <div class="legend">Click a column header to sort, a row to open the detail panel.</div>
    </div>
  </section>

  <section id="tab-issues" hidden>
    <div class="card">
      <h2>Highest-leverage refactors</h2>
      <ul class="plain">
        ${report.refactorCandidates
          .map(
            (candidate) =>
              `<li><b>${escapeHtml(candidate.name)}</b> <span class="muted">score ${candidate.score.toFixed(3)}</span><div class="muted">${escapeHtml(candidate.reason)}</div></li>`,
          )
          .join("")}
      </ul>
    </div>
    <p></p>
    <div class="card">
      <h2>Boundary violations (${report.boundaryViolations.length})</h2>
      <ul class="plain">
        ${report.boundaryViolations
          .slice(0, 200)
          .map((violation) => {
            const from = report.modules.find((m) => m.id === violation.fromModule)?.name ?? violation.fromModule;
            const to = report.modules.find((m) => m.id === violation.toModule)?.name ?? violation.toModule;
            return `<li>${escapeHtml(from)} &rarr; ${escapeHtml(to)} <span class="mono muted">${escapeHtml(violation.from)}:${violation.line}</span> <span class="muted">[${violation.kind}${violation.typeOnly ? ", type-only" : ""}]</span></li>`;
          })
          .join("")}
      </ul>
    </div>
    <p></p>
    <div class="card">
      <h2>Warnings (${report.warnings.length})</h2>
      <p class="muted">Dependencies the analysis could not resolve. They still exist at runtime.</p>
      <ul class="plain">
        ${report.warnings
          .slice(0, 200)
          .map(
            (warning) =>
              `<li><b>${escapeHtml(warning.code)}</b> <span class="mono muted">${escapeHtml(warning.file ?? "")}${warning.line ? `:${warning.line}` : ""}</span> ${escapeHtml(warning.message)}</li>`,
          )
          .join("")}
      </ul>
    </div>
  </section>
</main>

<footer>
  The absolute score is weakly meaningful and cross-project comparison is meaningless. The trend
  within one project is where the value is: commit a baseline and diff against it.
</footer>

<script>window.__NEST_ML__ = ${payload};</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
