import test from 'node:test';
import assert from 'node:assert/strict';

const K = await import(new URL('../../lib/code-kind.ts', import.meta.url).href);
const V = await import(new URL('../../lib/vercel-prep.ts', import.meta.url).href);
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const f = (file, t = '') => ({ file, data: b64(t), encoding: 'base64' });

test('html shows instantly, node uses the live server, nothing needs a key', () => {
  assert.equal(K.detectProject(['index.html', 'style.css', 'script.js']).mode, 'instant');
  assert.equal(K.detectProject(['package.json', 'src/App.jsx', 'index.html']).mode, 'live');
  assert.equal(K.detectProject([]).id, 'empty');
});

test('python / php / go / ruby web apps are previewed on Vercel; the others run on the computer', () => {
  assert.equal(K.detectProject(['app.py', 'requirements.txt', 'templates/index.html']).mode, 'vercel');
  assert.equal(K.detectProject(['manage.py', 'site/wsgi.py']).id, 'python-django');
  assert.equal(K.detectProject(['index.php']).mode, 'vercel');
  assert.equal(K.detectProject(['api/index.go', 'go.mod']).mode, 'vercel');
  assert.equal(K.detectProject(['api/index.rb']).mode, 'vercel');
  for (const files of [['pom.xml', 'src/Main.java'], ['Cargo.toml', 'src/main.rs'], ['main.cpp', 'CMakeLists.txt'], ['Program.cs', 'app.csproj'], ['main.go', 'go.mod']]) {
    const k = K.detectProject(files);
    assert.equal(k.mode, 'run', files.join());
    assert.equal(k.vercel, 'none');
  }
  assert.equal(K.detectProject(['node_modules/x/index.php', 'index.html']).id, 'html');
});

test('the agent asks for the Vercel token first only for web apps in Python / PHP / Go / Ruby', () => {
  assert.equal(K.vercelNeeded('make a flask web app for todo list'), 'Python');
  assert.equal(K.vercelNeeded('bhai python mein ek api bana do fastapi'), 'Python');
  assert.equal(K.vercelNeeded('build a laravel website'), 'PHP');
  assert.equal(K.vercelNeeded('ruby on rails app banao'), 'Ruby');
  assert.equal(K.vercelNeeded('make a landing page in html and css'), null);
  assert.equal(K.vercelNeeded('write a python script to rename my files'), null);
  assert.equal(K.vercelNeeded('make a java spring app'), null);
  assert.equal(K.vercelNeeded('flask app banao, no preview'), null);
});

test('the Vercel token is recognised in a chat message and nothing else is', () => {
  const tok = 'AbCdEfGh12345678IjKlMnOp';
  assert.equal(K.vercelTokenIntent('connect vercel ' + tok), tok);
  assert.equal(K.vercelTokenIntent('vercel token: vcp_abcdefghijklmnop1234'), 'vcp_abcdefghijklmnop1234');
  assert.equal(K.vercelTokenIntent(tok, true), tok);
  assert.equal(K.vercelTokenIntent(tok, false), null);
  assert.equal(K.vercelTokenIntent('connect vercel'), null);
  assert.equal(K.vercelTokenIntent('make me a website please'), null);
  assert.ok(K.SKIP_PREVIEW_RE.test('skip'));
  assert.ok(!K.SKIP_PREVIEW_RE.test('make it blue'));
});

test('a flask project gets the glue files and keeps its own files', () => {
  const kind = K.detectProject(['app.py']);
  const out = V.prepareForVercel([f('app.py', 'from flask import Flask\napp = Flask(__name__)\n')], kind);
  const names = out.files.map((x) => x.file).sort();
  assert.deepEqual(names, ['api/index.py', 'app.py', 'requirements.txt', 'vercel.json']);
  const wrapper = Buffer.from(out.files.find((x) => x.file === 'api/index.py').data, 'base64').toString();
  assert.match(wrapper, /from app import app as app/);
  const reqs = Buffer.from(out.files.find((x) => x.file === 'requirements.txt').data, 'base64').toString();
  assert.match(reqs, /flask/);
  const vj = JSON.parse(Buffer.from(out.files.find((x) => x.file === 'vercel.json').data, 'base64').toString());
  assert.equal(vj.rewrites[0].destination, '/api/index');
});

test('existing glue files are never overwritten; php gets its runtime', () => {
  const kind = K.detectProject(['main.py', 'api/index.py', 'vercel.json', 'requirements.txt']);
  const out = V.prepareForVercel([f('main.py'), f('api/index.py', 'mine'), f('vercel.json', '{}'), f('requirements.txt', 'x')], kind);
  assert.equal(out.added.length, 0);
  assert.equal(Buffer.from(out.files.find((x) => x.file === 'api/index.py').data, 'base64').toString(), 'mine');
  const php = V.prepareForVercel([f('index.php', '<?php echo 1;')], K.detectProject(['index.php']));
  assert.ok(php.files.some((x) => x.file === 'api/index.php'));
  const vj = JSON.parse(Buffer.from(php.files.find((x) => x.file === 'vercel.json').data, 'base64').toString());
  assert.match(vj.functions['api/*.php'].runtime, /^vercel-php@/);
});