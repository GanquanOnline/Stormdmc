const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const webDir = path.join(root, 'android-web');
const packageVersion = require(path.join(root, 'package.json')).version;
const versionParts = packageVersion.split('.').map(part => parseInt(part, 10) || 0);
const versionCode = versionParts[0] * 10000 + versionParts[1] * 100 + versionParts[2];

const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
if (fs.existsSync(gradlePath)) {
	let gradle = fs.readFileSync(gradlePath, 'utf8');
	gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
	gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${packageVersion}"`);
	fs.writeFileSync(gradlePath, gradle);
}

fs.rmSync(webDir, {recursive: true, force: true});
fs.mkdirSync(path.join(webDir, 'dist'), {recursive: true});

for (const file of ['index.html', 'favicon.ico', 'icon.png', 'manifest.webmanifest']) {
	const source = path.join(root, file);
	if (fs.existsSync(source)) fs.copyFileSync(source, path.join(webDir, file));
}

fs.cpSync(path.join(root, 'dist'), path.join(webDir, 'dist'), {recursive: true});
console.log(`Prepared Capacitor web assets in ${path.relative(root, webDir)}`);
