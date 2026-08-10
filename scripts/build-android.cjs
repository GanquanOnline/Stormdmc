const {spawnSync} = require('child_process');
const fs = require('fs');
const path = require('path');

const task = process.argv[2] || 'assembleDebug';
const root = path.resolve(__dirname, '..');
const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const result = spawnSync(gradle, [task], {
	cwd: path.join(root, 'android'),
	stdio: 'inherit',
	shell: process.platform === 'win32'
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

const version = require(path.join(root, 'package.json')).version;
const outputDir = path.join(root, 'release');
fs.mkdirSync(outputDir, {recursive: true});
const releaseType = task.toLowerCase().includes('bundle') ? 'aab' : 'apk';
const source = releaseType === 'aab'
	? path.join(root, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab')
	: path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (fs.existsSync(source)) {
	const target = path.join(outputDir, `Snowstorm-${version}-Android.${releaseType}`);
	fs.copyFileSync(source, target);
	console.log(`Android ${releaseType.toUpperCase()} written to ${path.relative(root, target)}`);
} else {
	console.warn(`Gradle completed, but no expected ${releaseType.toUpperCase()} was found at ${source}`);
}
