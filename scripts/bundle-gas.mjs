/**
 * Apps Script 배포 준비: apps-script/gateway-api 의 파일을 build-gas/gateway-api 로 복사하고
 * 붙여넣기용 단일 파일(build-gas/gateway-api.bundle.js)을 만든다.
 * clasp 사용 시:  cd build-gas/gateway-api && clasp push   (.clasp.json 은 .gitignore 대상)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'apps-script/gateway-api');
const out = path.join(root, 'build-gas/gateway-api');
fs.rmSync(path.join(root, 'build-gas'), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const files = fs.readdirSync(src).filter((f) => f.endsWith('.js')).sort();
let bundle = `// PROFCYS Gateway API bundle — generated ${new Date().toISOString()} — DO NOT EDIT (source: apps-script/gateway-api)\n`;
for (const f of files) {
  const code = fs.readFileSync(path.join(src, f), 'utf8');
  fs.copyFileSync(path.join(src, f), path.join(out, f));
  bundle += `\n// ===== ${f} =====\n${code}\n`;
}
fs.copyFileSync(path.join(src, 'appsscript.json'), path.join(out, 'appsscript.json'));
if (fs.existsSync(path.join(root, '.clasp.json'))) fs.copyFileSync(path.join(root, '.clasp.json'), path.join(out, '.clasp.json'));
fs.writeFileSync(path.join(root, 'build-gas/gateway-api.bundle.js'), bundle);
const shared = path.join(root, 'apps-script/shared-auth/ProfcysAuth.js');
fs.copyFileSync(shared, path.join(root, 'build-gas/ProfcysAuth.js'));
console.log(`build-gas/gateway-api: ${files.length} files, bundle ${Math.round(bundle.length / 1024)} KB, appsscript.json, ProfcysAuth.js`);
