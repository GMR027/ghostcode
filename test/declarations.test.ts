import assert from "node:assert/strict";
import { test } from "node:test";
import { blockEnd, extractDeclarations, outlineOf, receiverClass, referencedNames } from "../src/core/declarations";

const names = (src: string) => extractDeclarations(src).map((d) => `${d.kind}:${d.name}${d.container ? `@${d.container}` : ""}`);

test("PHP: clase, herencia, propiedades y métodos", () => {
  const src = `<?php
namespace Models;
class Usuario extends ActiveRecord {
  protected static $tabla = 'usuarios';
  public $email;

  public function __construct($args = []) {
    $this->email = $args['email'] ?? '';
  }

  public static function find($id) {
    $query = "SELECT * FROM " . static::$tabla;
    return self::consultarSQL($query);
  }
}`;
  const d = extractDeclarations(src);
  assert.deepEqual(names(src), ["class:Usuario", "field:tabla@Usuario", "field:email@Usuario", "function:__construct@Usuario", "function:find@Usuario"]);
  assert.equal(d[0].parent, "ActiveRecord");
  assert.equal(d[0].end, 14);
  assert.equal(outlineOf(d, d[0]), [
    "class Usuario extends ActiveRecord {",
    "  protected static $tabla = 'usuarios'",
    "  public $email",
    "  public function __construct($args = [])",
    "  public static function find($id)",
    "}",
  ].join("\n"));
});

test("JavaScript / TypeScript: funciones, flechas, clases y métodos", () => {
  const src = `export class Api extends Base {
  private url: string;
  async getUser(id: number): Promise<User> {
    return fetch(this.url + id);
  }
  static create() {
    return new Api();
  }
}
function mostrarSeccion() {
  if (x) {
    seccion.classList.add('mostrar');
  }
}
const sumar = (a, b) => a + b;
export const cargar = async function (url) {};
describe('x', () => {
  it('y', () => {});
});
mostrarSeccion();`;
  assert.deepEqual(names(src), ["class:Api", "field:url@Api", "function:getUser@Api", "function:create@Api", "function:mostrarSeccion", "function:sumar", "function:cargar"]);
});

test("Python: clases, métodos y bloques por indentación", () => {
  const src = `class Repo(BaseRepo):
    def __init__(self, db):
        self.db = db

    async def find(self, id):
        return await self.db.get(id)

def main():
    repo = Repo(db)
    print(repo)

x = main()`;
  const d = extractDeclarations(src);
  assert.deepEqual(names(src), ["class:Repo", "function:__init__@Repo", "function:find@Repo", "function:main"]);
  assert.equal(d[0].parent, "BaseRepo");
  assert.equal(d[0].end, 5);
  assert.equal(d[3].end, 9);
});

test("Java, C#, Go, Rust, Kotlin, Swift, Ruby, Lua, C y SQL", () => {
  const cases: [string, string[]][] = [
    ["public class UserService {\n  private final Repo repo;\n  public List<User> findAll() {\n    return repo.all();\n  }\n}", ["class:UserService", "field:repo@UserService", "function:findAll@UserService"]],
    ["public sealed class Cart : Base\n{\n    public decimal Total(int x)\n    {\n        return 0;\n    }\n}", ["class:Cart", "function:Total@Cart"]],
    ["type Server struct {\n\tAddr string\n}\n\nfunc (s *Server) Start(port int) error {\n\treturn nil\n}\n\nfunc main() {\n}", ["class:Server", "function:Start", "function:main"]],
    ["pub struct Point { x: f64 }\nimpl Point {\n    pub fn dist(&self) -> f64 {\n        0.0\n    }\n}\nfn main() {}", ["class:Point", "class:Point", "function:dist@Point", "function:main"]],
    ["data class User(val name: String)\nfun greet(u: User): String {\n  return u.name\n}", ["class:User", "function:greet"]],
    ["struct Item {\n  let id: Int\n}\nfunc load(id: Int) -> Item {\n  return Item(id: id)\n}", ["class:Item", "field:id@Item", "function:load"]],
    ["class Car < Vehicle\n  def drive(speed)\n    @speed = speed\n  end\n\n  def self.build\n  end\nend", ["class:Car", "function:drive@Car", "function:build@Car"]],
    ["local function helper(x)\n  return x\nend\nfunction M.run(cfg)\nend", ["function:helper", "function:run"]],
    ["static int sum(int a, int b) {\n  return a + b;\n}\nint main(void) {\n  printf(\"%d\", sum(1, 2));\n  return 0;\n}", ["function:sum", "function:main"]],
    ["CREATE TABLE IF NOT EXISTS usuarios (\n  id INT PRIMARY KEY,\n  email VARCHAR(100)\n);\nCREATE OR REPLACE FUNCTION total() RETURNS int AS $$ $$;", ["class:usuarios", "function:total"]],
  ];
  for (const [src, expected] of cases) assert.deepEqual(names(src), expected, src.split("\n")[0]);
});

test("no confunde llamadas, condiciones ni comentarios con declaraciones", () => {
  const src = `if (x) {
  foo(a,
    b);
  return bar(x);
}
// function comentada() {}
/*
class Comentada {}
*/
$resultado = self::consultarSQL($query);
for (let i = 0; i < 3; i++) {}
else if (y) {}`;
  assert.deepEqual(names(src), []);
});

test("fin de bloque: llaves (ignorando las de cadenas) e indentación", () => {
  const lines = ["function f() {", "  const s = '}';", "  if (a) {", "  }", "}", "after()"];
  assert.equal(blockEnd(lines, 0), 4);
  const py = ["def f():", "    x = 1", "", "    return x", "y = 2"];
  assert.equal(blockEnd(py, 0), 3);
  const rb = ["def f", "  1", "end", "puts 2"];
  assert.equal(blockEnd(rb, 0), 2);
});

test("nombres referenciados cerca del cursor, del más cercano al más lejano", () => {
  const text = "$usuario = new Usuario($_POST);\n$alertas = $usuario->validarIngreso();\n$tipos = TipoRecordatorio::";
  assert.deepEqual(referencedNames(text).slice(0, 5), ["TipoRecordatorio", "tipos", "validarIngreso", "usuario", "alertas"]);
});

test("contexto del proyecto: clase usada + su clase padre, sin el archivo actual ni otros lenguajes", async () => {
  const { DeclarationIndex } = await import("../src/core/projectContext");
  const idx = new DeclarationIndex();
  idx.set("models/ActiveRecord.php", "<?php\nclass ActiveRecord {\n    public static function all() {\n        return [];\n    }\n    public function guardar() {\n    }\n}");
  idx.set("models/TipoRecordatorio.php", "<?php\nclass TipoRecordatorio extends ActiveRecord {\n  protected static $tabla = 'tipos';\n  public $nombre;\n}");
  idx.set("src/js/app.js", "class TipoRecordatorio {}\nfunction consultarAPI() {}");
  idx.set("controllers/ApiController.php", "<?php\nclass ApiController {\n  public static function index() {}\n}");
  const s = idx.snippetsFor(["TipoRecordatorio", "ApiController"], "controllers/ApiController.php");
  assert.deepEqual(s.map((x) => x.path), ["models/TipoRecordatorio.php"]);
  assert.equal(
    s[0].text,
    "class TipoRecordatorio extends ActiveRecord {\n  protected static $tabla = 'tipos'\n  public $nombre\n  // heredado de ActiveRecord:\n  public static function all()\n  public function guardar()\n}",
  );
  // Re-indexar un archivo reemplaza sus declaraciones.
  idx.set("models/ActiveRecord.php", "<?php\nclass Otra {}");
  assert.equal(idx.lookup("ActiveRecord").length, 0);
  assert.equal(idx.snippetsFor(["consultarAPI"], "src/js/main.js")[0].text, "function consultarAPI()");
});

test("clase de la variable antes de -> / . / ::", () => {
  assert.equal(receiverClass("$ingreso = new Usuario($_POST);\n$x = 1;\n$alertas = $ingreso->"), "Usuario");
  assert.equal(receiverClass("const api = new Api(url);\nawait api.get"), "Api");
  assert.equal(receiverClass("repo = Repo(db)\nrepo."), "Repo");
  assert.equal(receiverClass("s := &Server{Addr: x}\ns."), "Server");
  assert.equal(receiverClass("val u = User(\"a\")\nu."), "User");
  assert.equal(receiverClass("public function f(Usuario $u) {\n  $u->"), "Usuario");
  assert.equal(receiverClass("function f(u: Usuario) {\n  u."), "Usuario");
  assert.equal(receiverClass("$x = 1;\n$x->"), undefined);
  assert.equal(receiverClass("total = a + b"), undefined);
});
