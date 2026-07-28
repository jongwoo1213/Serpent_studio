/**
 * Vite 빌드 결과(dist-standalone/, 중간 산출물)를 자체 완결된 HTML 한 장으로 합쳐
 * release/ 폴더(프로젝트 루트, 눈에 바로 띄는 위치)에 내보낸다.
 *
 * 결과 파일은 외부 파일을 전혀 참조하지 않으므로 인터넷이 없는 PC 에서
 * 더블클릭만으로 열린다.
 */
import { readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const dist = fileURLToPath(new URL("../dist-standalone", import.meta.url));
const releaseDir = fileURLToPath(new URL("../release", import.meta.url));
const output = join(releaseDir, "serpent-studio.html");

const html = await readFile(join(dist, "index.html"), "utf8");
let result = html;

const inlined = [];

// replace() 의 치환 "문자열" 안에서는 $&, $1 같은 패턴이 특수 문자로 해석된다.
// 번들 코드에 실제로 "$&" 가 들어 있어(React 내부) 코드가 조용히 손상되므로
// 반드시 치환 "함수" 를 써서 내용을 있는 그대로 넣는다.
const putLiteral = (haystack, needle, replacement) => haystack.replace(needle, () => replacement);

// 스타일시트 <link> → <style>
for (const match of html.matchAll(/<link[^>]*?href="([^"]+\.css)"[^>]*?>/g)) {
  const css = await readFile(join(dist, match[1]), "utf8");
  result = putLiteral(result, match[0], `<style>\n${css}\n</style>`);
  inlined.push({ asset: match[1], body: css });
}

// 스크립트 <script src> → <script>
// 두 가지를 지켜야 한다.
//  1) type="module" 을 떼야 한다 — file:// 에서 CORS 로 차단된다(번들은 IIFE).
//  2) 인라인 스크립트에는 defer 가 통하지 않는다. Vite 는 모듈 스크립트를 <head> 에
//     두는데, 그대로 두면 #root 가 만들어지기 전에 실행돼 버린다. 그래서 </body>
//     직전으로 옮긴다.
const bodyScripts = [];
for (const match of html.matchAll(/<script[^>]*?src="([^"]+\.js)"[^>]*?>\s*<\/script>/g)) {
  const js = await readFile(join(dist, match[1]), "utf8");
  // 스크립트 문자열 안의 </script> 가 태그를 조기 종료시키지 않도록 escape.
  const safe = js.replace(/<\/script/gi, "<\\/script");
  result = putLiteral(result, match[0], "");
  bodyScripts.push(`<script>\n${safe}\n</script>`);
  inlined.push({ asset: match[1], body: safe });
}

if (bodyScripts.length) {
  if (!result.includes("</body>")) throw new Error("</body> 를 찾지 못했습니다.");
  result = putLiteral(result, "</body>", `${bodyScripts.join("\n")}\n</body>`);
}

// 삽입한 내용이 한 글자도 변형되지 않았는지 확인한다.
for (const { asset, body } of inlined) {
  if (!result.includes(body)) {
    throw new Error(`${asset} 내용이 삽입 과정에서 변형되었습니다.`);
  }
}

if (!inlined.length) {
  throw new Error("인라인할 자산을 찾지 못했습니다. 빌드 출력이 예상과 다릅니다.");
}

if (/<script[^>]*\btype="module"/.test(result)) {
  throw new Error("type=\"module\" 스크립트가 남아 있습니다. file:// 에서 차단됩니다.");
}

// 인라인 스크립트는 즉시 실행되므로 반드시 마운트 지점 뒤에 있어야 한다.
if (result.indexOf("<script>") < result.indexOf('id="root"')) {
  throw new Error("스크립트가 #root 보다 앞서 실행됩니다. </body> 앞으로 옮겨야 합니다.");
}

if (/<(script|link)[^>]*?(src|href)="\.?\/?assets?\//.test(result)) {
  throw new Error("외부 자산 참조가 남아 있습니다. 단일 파일로 완성되지 않았습니다.");
}

await mkdir(releaseDir, { recursive: true });
await writeFile(output, result, "utf8");

// Vite 가 만든 조각(index.html, app.js, app.css)은 이제 필요 없으니 통째로 지운다.
// 최종 산출물은 release/ 안의 파일 하나만 남는다.
await rm(dist, { recursive: true, force: true });

const { size } = await stat(output);
console.log(`완성: release/serpent-studio.html  (${(size / 1024).toFixed(0)} KB, 외부 참조 없음)`);
