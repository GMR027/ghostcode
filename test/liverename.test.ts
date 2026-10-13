import assert from "node:assert/strict";
import { test } from "node:test";
import { applyBemEdits, openAncestors, parseBemNames, parseMarkup, planBem, suggestElementName } from "../src/core/bem";
import {
  applySpans, classTokenSpans, contextAt, diffClassAttr, diffIdentifier, diffSelectorClass, jsClassSpans, parseJudge, selectorSpans,
  styleBlocks, wordSpans,
} from "../src/core/liveRename";

test("detecta el renombrado de un identificador (con $ de PHP)", () => {
  assert.deepEqual(diffIdentifier("foreach ($lista as $indice) {", "foreach ($lista as $i) {"), { old: "$indice", new: "$i", col: 19 });
  assert.deepEqual(diffIdentifier("const total = 1;", "const suma = 1;")?.new, "suma");
  assert.equal(diffIdentifier("let a = 1;", "let a = 12;"), null); // un número no es un nombre
  assert.equal(diffIdentifier("let total = 1;", "let total = suma + 1;"), null); // más de una palabra
  assert.equal(diffIdentifier("let total = 1;", "let if = 1;"), null); // palabra reservada
  assert.equal(diffIdentifier("let total = 1;", "let t = 1;")?.old, "total");
});

test("las coincidencias son por palabra completa", () => {
  const t = "$i = 0; $ii = $i + 1; i = 2; $indice";
  assert.equal(wordSpans(t, "$i").length, 2);
  assert.equal(wordSpans(t, "i").length, 1);
  assert.equal(wordSpans(t, "$i", { start: 0, end: 7 }).length, 1);
});

test("contexto de una coincidencia", () => {
  assert.equal(contextAt("x = total;", 4), "code");
  assert.equal(contextAt("obj.total = 1", 4), "member");
  assert.equal(contextAt("$a->total = 1", 4), "member");
  assert.equal(contextAt("echo 'el total es'", 10), "string");
  assert.equal(contextAt("x = 1; // el total", 14), "comment");
});

test("clases: token en class=, selector CSS y BEM", () => {
  assert.deepEqual(diffClassAttr('<p class="hola mundo">', '<p class="hi mundo">'), { old: "hola", new: "hi", col: 3 });
  assert.equal(diffClassAttr('<p class="hola">', '<p class="hola extra">'), null); // se añadió, no se renombró
  assert.equal(diffClassAttr('<p class="card">', '<p class="card-">'), null); // a medio escribir
  assert.deepEqual(diffSelectorClass(".hola { color: red }", ".hi { color: red }"), { old: "hola", new: "hi", col: 1 });

  const html = '<div class="hola"><p class="hola__t hola--x otro">';
  assert.equal(classTokenSpans(html, "hola").length, 1);
  assert.equal(classTokenSpans(html, "hola", true).length, 3);
  const css = ".hola{} .hola:hover{} .holas{} a.hola__t{} .x .hola .y{} 0.hola";
  assert.equal(selectorSpans(css, "hola").length, 3);
  assert.equal(selectorSpans(css, "hola", true).length, 4);
  assert.equal(applySpans(css, selectorSpans(css, "hola"), "hi"), ".hi{} .hi:hover{} .holas{} a.hola__t{} .x .hi .y{} 0.hola");
  assert.equal(styleBlocks("<style>.a{}</style><p>").length, 1);
});

test("clases escritas en JavaScript", () => {
  const js = "const a = document.querySelector('.mostrar'); b.classList.remove('mostrar'); c.classList.add('x', 'mostrar-no'); document.querySelector('.tabs .mostrar:hover');";
  assert.equal(jsClassSpans(js, "mostrar").length, 3);
  assert.equal(applySpans(js, jsClassSpans(js, "mostrar"), "show"), js.replace(/\.mostrar'\)/, ".show')").replace("remove('mostrar')", "remove('show')").replace(".mostrar:hover", ".show:hover"));
});

test("respuesta del juez de la IA", () => {
  assert.deepEqual(parseJudge('```json\n{"rename":[1,3,9]}\n```', [1, 2, 3]), [1, 3]);
  assert.deepEqual(parseJudge("no sé", [1]), []);
});

const page = `<section>
  <h2>Ofertas del mes</h2>
  <ul><li><a href="#">Uno</a></li><li class="keep">Dos</li></ul>
  <img src="a.png">
</section>`;

test("BEM: lee el árbol y propone bloque y elementos", () => {
  const nodes = parseMarkup(page);
  assert.deepEqual(nodes.map((n) => n.tag), ["section", "h2", "ul", "li", "a", "li", "img"]);
  assert.equal(nodes[1].text, "Ofertas del mes");
  assert.equal(suggestElementName(nodes, 1, "ofertas-mes"), "ofertas-mes__title");
  assert.equal(suggestElementName(nodes, 2, "x"), "x__list");
});

test("BEM: aplica solo donde no hay clase y respeta lo del usuario", () => {
  const nodes = parseMarkup(page);
  const { edits, block } = planBem(nodes, 0, "class");
  assert.equal(block, "ofertas-mes");
  const out = applyBemEdits(page, edits);
  assert.match(out, /<section class="ofertas-mes">/);
  assert.match(out, /<h2 class="ofertas-mes__title">/);
  assert.match(out, /<ul class="ofertas-mes__list">/);
  assert.match(out, /<li class="ofertas-mes__item"><a href="#" class="ofertas-mes__link">/);
  assert.match(out, /<li class="keep">/); // el usuario ya le puso clase: intacta
  assert.match(out, /<img src="a.png" class="ofertas-mes__image">/);
  // Segunda pasada: nada que cambiar (lo generado ya tiene clase y lo del usuario no se toca).
  assert.equal(planBem(parseMarkup(out), 0, "class").edits.length, 0);
});

test("BEM: bloque heredado, className y etiquetas autocerradas", () => {
  const src = '<div class="card"><span>Precio</span><img src="x" /></div>';
  const nodes = parseMarkup(src);
  const { edits } = planBem(nodes, 1, "className");
  assert.equal(applyBemEdits(src, edits), '<div class="card"><span className="card__label">Precio</span><img src="x" /></div>');
  const all = planBem(nodes, 0, "class", { names: new Map([[1, "price"]]) });
  assert.equal(applyBemEdits(src, all.edits), '<div class="card"><span class="card__price">Precio</span><img src="x" class="card__image" /></div>');
  // class="" vacío se rellena
  assert.equal(applyBemEdits('<p class="">x</p>', planBem(parseMarkup('<p class="">x</p>'), 0, "class", { block: "intro" }).edits), '<p class="intro">x</p>');
});

test("BEM: ancestros abiertos y nombres de la IA", () => {
  const anc = openAncestors('<div class="card"><ul class="card__list"><li>x</li><li ');
  assert.deepEqual(anc.map((n) => n.tag), ["div", "ul"]);
  assert.deepEqual([...parseBemNames('{"1":"Price tag","7":"x"}', [1, 2])], [[1, "price-tag"]]);
});
