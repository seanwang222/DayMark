/**
 * 将 dist/ 目录下的 HTML + JS + CSS 合并成单文件 HTML
 * 用字符串拼接而非模板字符串，避免 JS 内容中的特殊字符（如 `、$）干扰
 * 用法: node build-standalone.cjs
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
const outputFile = path.join(distDir, 'index-standalone.html');

// 1. 读取 CSS（按 mtime 选最新，避免 build 残留导致选到旧 hash 文件）
const cssFiles = fs.readdirSync(path.join(distDir, 'assets')).filter((f) => f.endsWith('.css'));
let cssContent = '';
if (cssFiles.length > 0) {
  const cssLatest = cssFiles
    .map((f) => ({ f, m: fs.statSync(path.join(distDir, 'assets', f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0].f;
  cssContent = fs.readFileSync(path.join(distDir, 'assets', cssLatest), 'utf-8');
}

// 2. 读取 JS（按 mtime 选最新，避免 build 残留导致选到旧 hash 文件）
const jsFiles = fs.readdirSync(path.join(distDir, 'assets')).filter((f) => f.endsWith('.js'));
let jsContent = '';
if (jsFiles.length > 0) {
  const jsLatest = jsFiles
    .map((f) => ({ f, m: fs.statSync(path.join(distDir, 'assets', f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0].f;
  jsContent = fs.readFileSync(path.join(distDir, 'assets', jsLatest), 'utf-8');
}

// 3. 读取原始 HTML 模板
const originalHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');

// 4. 移除外部 <link rel="stylesheet"> 和 <script type="module">
let html = originalHtml;
html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
html = html.replace(/<script[^>]*type=["']module["'][^>]*>[^<]*<\/script>/gi, '');

// 5. 构造最终 HTML（用字符串拼接，绝不用模板字符串）
const headTag = '</head>';
const bodyTag = '</body>';
const headIdx = html.indexOf(headTag);
const bodyIdx = html.indexOf(bodyTag);

let finalHtml = '';
finalHtml += html.substring(0, headIdx);  // <html>...<head>... 
finalHtml += '  <style>\n' + cssContent + '\n  </style>\n';
finalHtml += '  </head>\n';  // restore closing
finalHtml += html.substring(headIdx + headTag.length, bodyIdx).replace(/^[\s\S]*?<body[^>]*>/i, '<body>');  // body content
finalHtml += '    <script>\n' + jsContent + '\n    </script>\n';
finalHtml += '  </body>\n</html>\n';

// 6. 写入
fs.writeFileSync(outputFile, finalHtml, 'utf-8');

const sizeKB = (fs.statSync(outputFile).size / 1024).toFixed(1);
console.log('OK: ' + outputFile);
console.log('Size: ' + sizeKB + ' KB');

// 7. 验证
const verification = fs.readFileSync(outputFile, 'utf-8');
const scriptMatch = verification.match(/<script>([\s\S]*?)<\/script>/);
const scriptContent = scriptMatch ? scriptMatch[1] : '';
console.log('Script length: ' + scriptContent.length);
console.log('Has DOCTYPE in script: ' + scriptContent.includes('DOCTYPE'));
console.log('Has $1$ in script: ' + scriptContent.includes('$1$`$1'));

try {
  new Function(scriptContent);
  console.log('JS syntax: OK');
} catch (e) {
  console.log('JS syntax error: ' + e.message);
}
